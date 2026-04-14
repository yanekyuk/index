# Issue 4: OpenClaw plugin — pending-opportunity poller

**Spec:** [`docs/superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md` § Issue 4](../superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md#issue-4--openclaw-plugin-pending-opportunity-poller)
**Plan:** [`docs/superpowers/plans/2026-04-15-openclaw-opportunity-delivery.md` § Issue 4](../superpowers/plans/2026-04-15-openclaw-opportunity-delivery.md)
**Dependencies:** Issue 0 (`dispatchDelivery` helper), Issue 1 (pickup/confirm endpoints), Issue 2 (enriched presenter cards)
**Blocks:** none (Issue 5 runs in parallel once 0–3 land)
**Layer:** OpenClaw plugin

## Goal

Extend the plugin's poll loop to pick up freshly-pending opportunities from the backend and deliver them to the user via `dispatchDelivery`. Mark the existing negotiation poller as **alpha** in the install instructions, positioning pending-opportunity delivery as the v1 supported feature.

## Context

With Issue 0's delivery primitive and Issue 1's pickup endpoints in place, all the plugin needs is a third endpoint in its poll loop. The handling mirrors the test-message pickup from Issue 0 verbatim, except the rendered payload comes from the opportunity presenter (enriched by Issue 2) instead of a plain-text test string.

## Scope

### In
- Extend the poll loop in `packages/openclaw-plugin/src/index.ts` to call three endpoints per cycle (negotiations → opportunities → test-messages, in that order).
- New prompt `packages/openclaw-plugin/src/prompts/opportunity-delivery.prompt.ts` — variant of the test-delivery prompt framing the content as an opportunity card.
- Call `dispatchDelivery` on pickup success; POST `/agents/:agentId/opportunities/:opportunityId/delivered` with reservation token afterward.
- Session key format: `index:delivery:opportunity:<opportunityId>`; idempotency key: `index:delivery:opportunity:<opportunityId>:<reservationToken>`.
- README update in `packages/openclaw-plugin/README.md` (or equivalent) tagging the negotiation poller as **alpha** and documenting the pending-opportunity poller as v1.
- Integration test: create a pending opportunity in backend → plugin polls → subagent runs → confirm committed → ledger has one row.

### Out
- Digest (Issue 5).
- Any backend changes (all come from Issues 1+2).

## Acceptance Criteria

- [ ] Poll cycle calls all three endpoints in the documented order.
- [ ] On `200` from opportunities/pickup, `dispatchDelivery` is called with the payload's `rendered` block.
- [ ] On successful subagent dispatch, the confirm endpoint is POSTed with the reservation token.
- [ ] On non-2xx confirm (e.g. `409` expired), the plugin logs and lets the reservation release naturally.
- [ ] Plugin restart mid-cycle does not silently lose a delivery — the reservation expires and the next poll re-picks it.
- [ ] Backoff state is shared across all three endpoints (a failure from any resets the backoff multiplier uniformly).
- [ ] README reflects alpha/v1 status of the two pollers.

## Implementation Notes

- Extends the same polling function introduced in Issue 0, adding one more HTTP call between `negotiations` and `test-messages`.
- The subagent prompt is short — relay the rendered card, preserve substance, format for gateway.
- Integration test may live in `packages/openclaw-plugin/tests/` or the backend's e2e harness; see plan.
- Full task-level breakdown: megaplan Issue 4 section.
