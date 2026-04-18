# Issue 5: Morning home-digest endpoint + plugin cron

**Spec:** [`docs/superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md` § Issue 5](../superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md#issue-5--morning-home-digest-endpoint--plugin-cron)
**Plan:** [`docs/superpowers/plans/2026-04-15-openclaw-opportunity-delivery.md` § Issue 5](../superpowers/plans/2026-04-15-openclaw-opportunity-delivery.md)
**Dependencies:** Issue 0 (`dispatchDelivery`), Issue 1 (ledger + reservation pattern), Issue 2 (enriched presenter), Issue 3 (home graph default filter)
**Blocks:** none
**Layer:** Backend (protocol) + OpenClaw plugin

## Goal

Fire a once-daily home-graph digest per OpenClaw agent, batching all actionable opportunities (`latent`, `stalled`, `pending`) into one rendered message delivered via the existing primitive. Schedule lives inside the plugin (`node-cron`) so the fire time is user-local automatically.

## Context

Pending-opportunity delivery (Issue 4) handles the real-time "just passed negotiation" case. Issue 5 complements it with a batched morning summary that also surfaces `latent` items (matches not yet negotiated) and `stalled` items (negotiations that went inconclusive) — the kinds of things the user should consider or re-engage. The digest reuses the `opportunity_deliveries` ledger from Issue 1 for per-(user, opportunity, status) dedupe, so a pending opportunity already delivered in real time is excluded.

## Scope

### In
- `POST /agents/:agentId/home-digest` — runs the home graph with the default filter (Issue 3), filters out already-delivered items (per ledger), renders each via the presenter (Issue 2), returns `{ digestId, reservationExpiresAt, items: [...] }`; `204` if nothing actionable.
- `POST /agents/:agentId/home-digest/:digestId/confirm` — body `{ deliveredTokens }` commits the listed reservations; unconfirmed tokens expire naturally.
- Backend service extension (likely an `OpportunityDeliveryService` method added by this issue, not a new service class) wiring home-graph → presenter → reservation inserts.
- Plugin `node-cron` dependency + new module `packages/openclaw-plugin/src/digest.scheduler.ts` registering a cron in `register()` with default schedule `'0 8 * * *'` read from `pluginConfig.digestCron`.
- On fire: POST digest endpoint → build single `DeliveryRequest` concatenating items under a digest-framing template → `dispatchDelivery` once → POST confirm with all tokens.
- Session key `index:delivery:digest:<digestId>`, idempotency key `index:delivery:digest:<digestId>`.
- Integration test: cron fires → N-item digest → single subagent dispatch → all tokens committed; empty case yields `204` + no dispatch; offline-overnight case yields yesterday's items in tomorrow's digest.

### Out
- Per-user timezone configuration on the backend (the cron's local-host time is acceptable for v1; a `pluginConfig.digestTimezone` override is flagged in the spec as an optional addition).
- Frontend observability for "next digest at HH:MM" (optional follow-up).
- Alternative delivery channels.

## Acceptance Criteria

- [ ] `POST /agents/:agentId/home-digest` with no actionable items returns `204` and writes no ledger rows.
- [ ] With actionable items, response includes one entry per opportunity with `reservationToken` + rendered presenter card.
- [ ] All rows written by the endpoint have `trigger='morning_digest'` and the same `digestId`.
- [ ] Confirm endpoint commits tokens listed in the body; omitted tokens stay `NULL` and expire.
- [ ] Plugin cron fires at `'0 8 * * *'` local time by default and is configurable via `pluginConfig.digestCron`.
- [ ] A single `subagent.run` dispatch delivers the whole batch (one message, not N).
- [ ] If the plugin is offline when the cron should fire, the next day's digest naturally includes yesterday's missed items (because dedupe is by `(user, opportunity, channel, status)` and undelivered items still qualify).
- [ ] A pending opportunity delivered in real time (Issue 4) is excluded from the next digest (same-status dedupe).

## Implementation Notes

- Endpoints on the existing `OpportunityDeliveryController` from Issue 1 (new routes on the same controller).
- Service method, e.g. `OpportunityDeliveryService.buildDigest(userId, agentId)`, calls the home graph, filters by ledger, batch-inserts reservation rows in one transaction.
- `node-cron`'s default is local time on the host; nothing extra needed for v1.
- Digest framing template (plugin-side): something like *"Good morning. Here are N opportunities worth your attention today:"* followed by the rendered items separated by a divider token the subagent understands.
- Full task-level breakdown: megaplan Issue 5 section.
