---
title: "Event webhooks"
type: spec
tags: [api, webhooks, notifications, opportunities, integrations]
created: 2026-04-05
updated: 2026-04-05
---

> **Status:** Aspirational — the webhook infrastructure described here has not yet been implemented. No `webhooks` table, controller, or queue exists in the current codebase.

## Purpose

Allow external systems (agents, CRMs, custom bots) to receive signed HTTP callbacks when protocol events occur. The infrastructure is **domain-agnostic**: new event types are registered in code and emitted at the right lifecycle points without schema or queue changes.

## Behavior

### Event registry

Supported event names are defined in `protocol/src/lib/webhook-events.ts` as `WEBHOOK_EVENTS`. The API validates subscription lists against this registry.

**v1:**

- `opportunity.created` — a new opportunity exists and the subscribed user is an actor on that opportunity.

**Planned (same infrastructure):**

- `opportunity.accepted` / `opportunity.rejected`
- `intent.created` / `intent.updated`, `intent.matched`
- `member.added`, `index.updated`

### Data model

Table `webhooks` (see `protocol/src/schemas/database.schema.ts`):

| Column | Description |
|--------|-------------|
| `id` | UUID primary key |
| `user_id` | Owner; FK to `users`, cascade delete |
| `url` | HTTPS endpoint to POST payloads |
| `secret` | HMAC signing key (generated at creation; shown once on register response) |
| `events` | Text array of subscribed event names |
| `active` | Whether deliveries run |
| `description` | Optional label |
| `failure_count` | Consecutive delivery failures (for auto-disable) |
| `created_at` / `updated_at` | Timestamps |

### HTTP API

All routes require session auth unless noted otherwise.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/webhooks/events` | List available event names from `WEBHOOK_EVENTS` |
| POST | `/api/webhooks` | Create webhook: `{ url, events: string[], description? }` — returns `secret` once |
| GET | `/api/webhooks` | List current user’s webhooks (secrets masked) |
| DELETE | `/api/webhooks/:id` | Delete by id (owner only) |
| POST | `/api/webhooks/:id/test` | POST a test envelope to the registered URL |

### Payload envelope

Every delivery uses the same JSON shape:

```json
{
  "event": "opportunity.created",
  "timestamp": "2026-04-05T12:00:00.000Z",
  "webhookId": "<webhook row id>",
  "data": {}
}
```

- `data` is event-specific; consumers branch on `event`.
- Body is serialized as a stable string for signing (same bytes as the request body).

### Signing

- Header: `X-Index-Signature` (or as implemented in code — document the exact header name in the controller TSDoc).
- Algorithm: HMAC-SHA256 over the **raw request body** using the webhook `secret`.
- Receivers should compute HMAC on the raw body and compare in constant time.

### Delivery

- Implemented as a dedicated BullMQ `WebhookQueue` (not mixed into email/digest notification priorities).
- Lookup: active webhooks for `user_id` where `events` contains the fired event name.
- POST timeout: ~5 seconds.
- Retries: BullMQ job retries with exponential backoff (aligned with other queues).
- Success (2xx): reset failure tracking as specified in implementation.
- After repeated failures: increment `failure_count`; auto-disable when count reaches threshold (e.g. 10 consecutive failures). Successful test delivery may re-enable per implementation.

### Wiring (v1)

On `opportunity.created`, enqueue deliveries for each **actor** `user_id` on the opportunity who has a webhook subscribed to `opportunity.created`.

Subscription point: `OpportunityService` lifecycle / `main.ts` composition root — must not require services to import the queue directly in a way that violates layering; prefer wiring in `main.ts` or a small orchestration helper.

## Constraints

- Webhook URLs must be validated (HTTPS in production; optional dev allowances per existing URL validation patterns).
- Secrets are not returned after create except in the initial response.
- Layering: controllers delegate to `WebhookService`; queue performs HTTP only; services do not import adapters from unrelated domains.
- Adding a new event type does **not** require a DB migration — only registry + emit site + tests.

## Acceptance Criteria

1. Migration adds `webhooks` table with indexes appropriate for lookup by `user_id`.
2. `GET /api/webhooks/events` returns the canonical list of event strings.
3. `POST /api/webhooks` creates a row, returns `secret` once, validates `events` ⊆ `WEBHOOK_EVENTS`.
4. `GET /api/webhooks` lists owned webhooks without exposing full secrets.
5. `DELETE /api/webhooks/:id` removes only the owner’s webhook.
6. `POST /api/webhooks/:id/test` sends a test payload and records success/failure per delivery rules.
7. When an opportunity is created, subscribed users who are actors receive a signed POST with `event: opportunity.created` and opportunity-shaped `data`.
8. Invalid signature on receiver side would fail verification — document verification steps for integrators in this spec or API reference.
9. Auto-disable after sustained delivery failures; documented behavior matches implementation.
10. Unit/integration tests cover signing, queue job, and controller validation paths.

## Related documentation

- [api-reference.md](./api-reference.md) — add a **Webhooks** section when endpoints ship.

## Tracking

- Linear: [IND-223](https://linear.app/indexnetwork/issue/IND-223/event-webhooks-protocol-implementation)
