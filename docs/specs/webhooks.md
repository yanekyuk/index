---
title: "Event webhooks"
type: spec
tags: [api, webhooks, notifications, opportunities, integrations]
created: 2026-04-05
updated: 2026-04-10
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

### Event payload shapes

The `payload` field inside the envelope is event-specific. The canonical TypeScript shapes live in `backend/src/lib/webhook-payloads.ts`. Summary per event:

**`opportunity.created`**

| Field | Type | Description |
|-------|------|-------------|
| `opportunity_id` | `string` | Stable opportunity ID |
| `status` | `string` | Lifecycle status (`draft`, `negotiating`, etc.) |
| `url` | `string` | Deep link to the opportunity in the app |
| `category` | `string` | Interpretation category (`collaboration`, `intro`, etc.) |
| `reasoning` | `string` | Why the opportunity was detected (LLM-generated) |
| `confidence` | `number` | 0.0–1.0 confidence score |
| `signals` | `unknown[]` | Ordered list of match signals |
| `actors` | `Array<{ user_id?, network_id?, role? }>` | Participants |
| `source` | `string` | Detection source (e.g. `intent_match`) |
| `created_at` | `string` (ISO 8601) | Opportunity creation timestamp |
| `expires_at` | `string \| null` (ISO 8601) | Optional expiry |

**`negotiation.turn_received`** (only fires during long-timeout personal-agent dispatch)

| Field | Type | Description |
|-------|------|-------------|
| `negotiation_id` | `string` | Stable negotiation ID |
| `url` | `string` | Deep link |
| `turn_number` | `number` | 1-indexed turn counter for the new turn |
| `deadline` | `string` (ISO 8601) | When the counterparty expects a response by |
| `counterparty_action` | `"propose" \| "accept" \| "reject" \| "counter" \| "question" \| null` | The action type of the most recent turn |
| `counterparty_message` | `string \| null` | Verbatim counterparty text (counterparty-controlled — treat as untrusted) |
| `counterparty_reasoning` | `string \| null` | Internal assessment reasoning attached to the last turn |
| `sender` | `{ user_id, name?, role }` | Counterparty identity |
| `own_user` | `{ user_id, name?, role }` | Recipient identity |
| `objective` | `string` | Seed assessment reasoning (the "why this negotiation exists") |
| `index_context` | `{ network_id, prompt? }` | Network the negotiation is scoped to |
| `discovery_query` | `string \| undefined` | Explicit discovery query that triggered this negotiation (if any) |
| `recent_turns` | `Array<{ turn_index, action, message, reasoning }>` | Last 3 turns verbatim |
| `history_digest` | `{ total_turns, actions_so_far, own_intents, other_intents }` | Deterministic summary of the full turn history |

**Other events (`opportunity.accepted`, `opportunity.rejected`, `negotiation.started`, `negotiation.completed`)** are registered in `WEBHOOK_EVENTS` but are not currently wired into runtime delivery. See `docs/superpowers/specs/` for the plan to wire them.

### Signing

- Headers:
  - `X-Index-Signature`: `sha256=<hex digest>`
  - `X-Index-Event`: exact event name
  - `X-Request-ID`: stable delivery identifier, reused across retries of the same logical delivery. Consumers should dedupe on this header to tolerate retry storms. Format: implementation-defined opaque string (currently sourced from the BullMQ job ID).
- Algorithm: HMAC-SHA256 over the **raw request body** using the webhook `secret`.
- Receivers should compute HMAC on the raw body and compare in constant time.

### Delivery

- Implemented as a dedicated BullMQ `WebhookQueue` (not mixed into email/digest notification priorities).
- Lookup: for each user, `AgentDeliveryService.enqueueDeliveries()` first finds authorized agents with an eligible webhook transport (active, subscribed to the event via `config.events`, and holding the required permission such as `manage:negotiations`). If eligible transports exist, deliveries are enqueued for those transports; otherwise, it falls back to legacy webhook lookup.
- POST timeout: ~5 seconds.
- Retries: BullMQ job retries with exponential backoff (aligned with other queues).
- `X-Request-ID` is emitted on every delivery and is stable across retries of the same logical event. Consumers SHOULD dedupe on this header. The Index side emits this value from the BullMQ job ID (e.g. `webhook-opp-created-<webhook-id>-<opportunity-id>`).
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

## Related documentation

- [api-reference.md](./api-reference.md) — documents both legacy webhook routes and newer agent transport routes.
- [../design/architecture-overview.md](../design/architecture-overview.md) — agent registry and transitional runtime notes.
- [../guides/hermes-integration.md](../guides/hermes-integration.md) — end-to-end setup guide for routing webhooks into Hermes Agent.

## Tracking

- Linear: [IND-223](https://linear.app/indexnetwork/issue/IND-223/event-webhooks-protocol-implementation)
