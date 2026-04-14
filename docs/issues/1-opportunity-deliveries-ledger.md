# Issue 1: `opportunity_deliveries` ledger + pending-pickup endpoints

**Spec:** [`docs/superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md` § Issue 1](../superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md#issue-1--opportunity_deliveries-ledger--pending-pickup-endpoints)
**Plan:** [`docs/superpowers/plans/2026-04-15-openclaw-opportunity-delivery.md` § Issue 1](../superpowers/plans/2026-04-15-openclaw-opportunity-delivery.md)
**Dependencies:** Issue 0 (for the reservation pattern precedent; not a hard blocker, but Issue 4 needs both)
**Blocks:** Issues 4, 5
**Layer:** Protocol (backend)

## Goal

Persist per-(user, opportunity, channel, status) delivery state and expose backend endpoints for OpenClaw agents to pick up freshly-pending opportunities with server-rendered presenter cards.

## Context

When an opportunity passes negotiation and becomes `pending`, the user needs to be notified. A single opportunity has multiple actors and must be delivered independently per user, so the delivery state can't live on the `opportunities` row. We add a join table `opportunity_deliveries` as the authoritative ledger: which (user × opportunity × channel × status) tuples have been delivered. The pickup endpoint uses it for dedupe; the confirm endpoint commits after the plugin successfully dispatches.

## Scope

### In
- New table `opportunity_deliveries` in `backend/src/schemas/database.schema.ts` with the schema described in the spec.
- Migration file (renamed and journaled per `CLAUDE.md`).
- `POST /agents/:agentId/opportunities/pickup` — resolves agent → user, finds next eligible pending opportunity, inserts reservation row, runs presenter (using Issue 2's enriched context when available), returns `{ opportunityId, reservationToken, reservationExpiresAt, rendered }` or `204`.
- `POST /agents/:agentId/opportunities/:opportunityId/delivered` — commits `delivered_at` on the reservation row.
- `OpportunityDeliveryService` encapsulating eligibility query, reservation insert, confirm commit, and lazy cleanup of expired reservations.
- Unit tests covering: eligibility dedupe, reservation TTL behavior, confirm path, contention (two concurrent pickups get different rows).

### Out
- Morning digest endpoints (Issue 5).
- Test-message channel (Issue 0).
- Plugin-side polling (Issue 4).
- Presenter enrichment (Issue 2 — but the controller calls the presenter with whatever context is available; the presenter gracefully handles `negotiationContext` being undefined in pre-Issue-2 state).

## Acceptance Criteria

- [ ] Migration applies cleanly against a fresh database.
- [ ] Pickup returns `204` when no pending opportunity is visible to the agent's user.
- [ ] Pickup returns a rendered card + reservation when one is available.
- [ ] Two concurrent pickup calls for the same user return different opportunities (or one returns `204`).
- [ ] Confirm commits `delivered_at`; a second confirm with the same token returns `404`.
- [ ] Expired reservations (>60s) are eligible for re-pickup.
- [ ] Delivered opportunities are excluded from subsequent pickups for the same `(user, opportunity, channel, status)` tuple.
- [ ] If the same opportunity transitions status (e.g. `pending → stalled` — hypothetical re-negotiation), a fresh delivery becomes eligible.
- [ ] Auth: pickup and confirm require API key + matching `agentId`.

## Implementation Notes

- Controller: `backend/src/controllers/opportunity-delivery.controller.ts`.
- Service: `backend/src/services/opportunity-delivery.service.ts`.
- Schema change: `backend/src/schemas/database.schema.ts` + one migration file renamed per the project's naming convention.
- Unique index `(user_id, opportunity_id, channel, delivered_at_status) WHERE delivered_at IS NOT NULL`.
- Partial index `(user_id, channel, reserved_at) WHERE delivered_at IS NULL` for expired-reservation cleanup.
- Reservation TTL: 60s, implemented as `now() - reserved_at < interval '60 seconds'` in the eligibility predicate; no separate cron needed.
- Full task-level breakdown: megaplan Issue 1 section.
