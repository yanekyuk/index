---
title: "Event webhooks"
type: spec
tags: [api, webhooks, notifications, opportunities, integrations]
created: 2026-04-05
updated: 2026-04-11
---

> **Status:** Transitional. Legacy webhook storage and controller routes still exist for API compatibility. Runtime fanout now prefers eligible agent-registry webhook transports and falls back to legacy `webhooks` only when no eligible agent transport exists.

## Purpose

Allow external systems (agents, CRMs, custom bots) to receive signed HTTP callbacks when protocol events occur, while documenting the current cutover between the legacy webhook runtime and the newer agent registry.

## Current architecture

- Legacy webhook runtime remains active for backward compatibility:
  - persistence in the `webhooks` table
  - controller routes under `/api/webhooks`
  - async delivery via `backend/src/queues/webhook.queue.ts`
- Agent registry is now the primary delivery path:
  - `agents` stores agent identities
  - `agent_transports` stores transport definitions such as `webhook` and `mcp`
  - `agent_permissions` stores agent authorization scope
- `AgentDeliveryService` orchestrates runtime fanout:
  - Prefers agent-registry webhook transports that are both authorized (via `agent_permissions`) and subscribed to the target event (via `transport.config.events`)
  - Falls back to legacy `webhooks` only when no eligible agent transport exists for the target user/event
- Webhook-compatible MCP tooling still coexists for compatibility during this transition.

## Behavior

### Event registry

Supported event names are defined in `backend/src/lib/webhook-events.ts` as `WEBHOOK_EVENTS`. The API validates subscription lists against this registry.

**Currently emitted by runtime delivery wiring:**

- `opportunity.created` — a new opportunity exists and the subscribed user is an actor on that opportunity.
- `negotiation.started`
- `negotiation.turn_received`
- `negotiation.completed`

**Registered but not currently emitted by the legacy runtime wiring in this branch:**

- `opportunity.accepted` / `opportunity.rejected`

### Data model

Legacy runtime table `webhooks` (still used for delivery lookup and signing secrets):

| Column | Description |
|--------|-------------|
| `id` | Text primary key (UUID-shaped string by default) |
| `user_id` | Owner; FK to `users`, cascade delete |
| `url` | Delivery endpoint URL (must use `https:` in production) |
| `secret` | HMAC signing key (generated at creation; shown once on register response) |
| `events` | Text array of subscribed event names |
| `active` | Whether deliveries run |
| `description` | Optional label |
| `failure_count` | Consecutive delivery failures (for auto-disable) |
| `created_at` / `updated_at` | Timestamps |

Agent-registry tables also exist in the same branch:

- `agents`
- `agent_transports`
- `agent_permissions`

Those tables are the primary source of truth for webhook delivery. Legacy `webhooks` are used only as a fallback when no eligible agent transport exists.

### HTTP API

All routes require session auth unless noted otherwise.

Legacy webhook routes:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/webhooks/events` | List available event names from `WEBHOOK_EVENTS` (public) |
| POST | `/api/webhooks` | Create webhook: `{ url, events: string[], description? }` — returns `secret` once |
| GET | `/api/webhooks` | List current user’s webhooks (secrets masked) |
| DELETE | `/api/webhooks/:id` | Delete by id (owner only) |
| POST | `/api/webhooks/:id/test` | POST a test envelope to the registered URL |

Agent-registry transport routes also exist separately for personal agents, including `webhook` and `mcp` channels under `/api/agents/:id/transports`. They coexist with `/api/webhooks` for compatibility; agent transports are now the primary source of truth for runtime delivery.

The `list_webhooks` MCP tool returns a **unified view** of both storage layers. Each returned row carries a `source` discriminator (`"legacy"` or `"agent-registry"`). Agent-registry rows also include `agentId`. Consumers that want only legacy rows can filter by `source === "legacy"`; consumers that want only the primary delivery path can filter by `source === "agent-registry"`. Secrets are never returned from either layer.

### Payload envelope

Every delivery uses the same JSON shape:

```json
{
  "event": "opportunity.created",
  "timestamp": "2026-04-05T12:00:00.000Z",
  "payload": {}
}
```

- `payload` is event-specific; consumers branch on `event`.
- Body is serialized as a stable string for signing (same bytes as the request body).

### Signing

- Headers:
  - `X-Index-Signature`: `sha256=<hex digest>`
  - `X-Index-Event`: exact event name
- Algorithm: HMAC-SHA256 over the **raw request body** using the webhook `secret`.
- Receivers should compute HMAC on the raw body and compare in constant time.

### Delivery

- Implemented as a dedicated BullMQ `WebhookQueue` (not mixed into email/digest notification priorities).
- Lookup: for each user, `AgentDeliveryService.enqueueDeliveries()` first finds authorized agents with an eligible webhook transport (active, subscribed to the event via `config.events`, and holding the required permission such as `manage:negotiations`). If eligible transports exist, deliveries are enqueued for those transports; otherwise, it falls back to legacy webhook lookup.
- POST timeout: ~5 seconds.
- Retries: BullMQ job retries with exponential backoff (aligned with other queues).
- Success (2xx): reset failure tracking as specified in implementation.
- After repeated failures: increment `failure_count`; auto-disable when count reaches threshold (e.g. 10 consecutive failures).
- Runtime fanout is orchestrated through `AgentDeliveryService`, which prefers agent-registry webhook transports (dual-gate: permission + subscribed event) and falls back to legacy webhook lookup when no eligible transport exists.

### Wiring

Current runtime wiring:

- On `opportunity.created`, enqueue deliveries for each actor `user_id` on the opportunity — first checking for eligible agent transports with `manage:intents` permission, then falling back to legacy webhooks.
- On `negotiation.started`, `negotiation.turn_received`, and `negotiation.completed`, enqueue deliveries for the affected `user_id` — first checking for eligible agent transports with `manage:negotiations` permission, then falling back to legacy webhooks.
- The composition root wiring lives in `backend/src/main.ts`.

## Constraints

- Webhook URLs must parse as valid URLs; `https:` is enforced in production.
- Secrets are not returned after create except in the initial response.
- Layering: controllers delegate to `WebhookService`; queue performs HTTP only; services do not import adapters from unrelated domains.
- Adding a new event type does **not** require a DB migration — only registry + emit site + tests.
- Registered events and actually emitted events are not currently identical; consumers should treat `/api/webhooks/events` as the subscription registry, not a guarantee that every event is already wired to runtime fanout.
- Runtime delivery now prefers agent-registry webhook transports gated by permission + subscribed event; legacy `webhooks` are only used as fallback.

## Current guarantees

1. Legacy `/api/webhooks` routes remain available.
2. `GET /api/webhooks/events` returns the canonical registry from `WEBHOOK_EVENTS`.
3. Runtime delivery currently signs requests with `X-Index-Signature` and includes `X-Index-Event`.
4. Runtime payloads use the `{ event, timestamp, payload }` envelope.
5. Runtime delivery prefers agent-registry webhook transports when eligible (dual gate: permission + event subscription), falling back to legacy `webhooks` when no eligible transport exists.
6. `opportunity.accepted` and `opportunity.rejected` are registered for subscription validation but are not yet wired into runtime delivery in this branch.
7. Agent-registry transports (`webhook`, `mcp`) coexist with legacy webhooks during the transition.

## Observability

### Per-attempt delivery logging

`backend/src/queues/webhook.queue.ts#handleDelivery` emits a structured `[WebhookJob] Delivery attempt failed` warning before re-throwing so BullMQ still sees the failure and schedules retries. Each attempt records:

- `webhookId` — the transport or legacy row the delivery targets.
- `event` — event name being delivered.
- `url` — destination URL.
- `attemptsMade` — BullMQ retry counter (1 on first attempt).
- On HTTP errors: `status` and truncated `responseBody` (≤500 bytes).
- On network errors: `errorCode` (`"timeout"` or the thrown error's `code` field) and `errorMessage`.

The `[WebhookJob] All retries exhausted, recorded failure` log emitted from the queue-events listener still marks the final failure and still increments the webhook's consecutive failure counter.

### Secrets are redacted from tool invocation logs

`ToolRegistry` logs each tool call via `logger.verbose('Tool: <name>', { context, query })`. Query payloads pass through `redactSensitiveFields` in `packages/protocol/src/shared/agent/tool.helpers.ts` before logging, so known-sensitive field names (`secret`, `webhookSecret`, `apiKey`, `token`, `accessToken`, `refreshToken`, `password`, `privateKey`, `authToken`, `bearerToken`, `clientSecret` — matched case-insensitively and ignoring underscores) are replaced with `"[redacted]"`. This applies to `add_webhook_transport`, `register_agent`, and any other tool that accepts a secret.

## Related documentation

- [api-reference.md](./api-reference.md) — documents both legacy webhook routes and newer agent transport routes.
- [../design/architecture-overview.md](../design/architecture-overview.md) — agent registry and transitional runtime notes.

## Tracking

- Linear: [IND-223](https://linear.app/indexnetwork/issue/IND-223/event-webhooks-protocol-implementation)
