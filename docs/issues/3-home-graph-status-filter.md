# Issue 3: Home graph default status filter

**Spec:** [`docs/superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md` § Issue 3](../superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md#issue-3--home-graph-default-status-filter)
**Plan:** [`docs/superpowers/plans/2026-04-15-openclaw-opportunity-delivery.md` § Issue 3](../superpowers/plans/2026-04-15-openclaw-opportunity-delivery.md)
**Dependencies:** none
**Blocks:** Issue 5
**Layer:** Protocol (`@indexnetwork/protocol` package) + backend database adapter

## Goal

Narrow the home feed to actionable lifecycle stages by default (`latent`, `stalled`, `pending`) — with a parameterizable override for callers that need other statuses (admin/debug, future history surface). Push the filter into SQL so we don't fetch rows we'll discard.

## Context

The home graph currently returns all visible + actionable opportunities regardless of lifecycle stage, meaning `accepted`/`rejected` items linger in the feed. Post-Issue 3 the default narrows to the three statuses a user can act on today. The change is small but touches a heavily-used code path, so it's isolated in its own issue with its own test coverage.

## Scope

### In
- `HomeGraphInvokeInput` in `packages/protocol/src/opportunity/feed/feed.graph.ts` gains optional `statuses?: OpportunityStatus[]`.
- New exports `DEFAULT_HOME_STATUSES` and `ALL_OPPORTUNITY_STATUSES` from the same file.
- Filter applied as a **third orthogonal predicate** alongside `canUserSeeOpportunity` and `isActionableForViewer` — do **not** fold into either helper.
- Database adapter `getOpportunitiesForUser` in `backend/src/adapters/database.adapter.ts` (and its aligned type in protocol interface) accepts `statuses?: OpportunityStatus[]` and pushes the filter into SQL `WHERE status = ANY($statuses)`.
- Unit test verifying default filter application when `statuses` is omitted.
- Unit test verifying override works (passing explicit `statuses`).
- Regression test: existing home-feed flow returns the expected narrowed set.

### Out
- A separate "history" UI surface for accepted/rejected opportunities (flagged as follow-up in spec).
- Changes to presenter, negotiation, or delivery.

## Acceptance Criteria

- [ ] `HomeGraphInvokeInput.statuses` is optional and defaults to `['latent', 'stalled', 'pending']`.
- [ ] `DEFAULT_HOME_STATUSES` and `ALL_OPPORTUNITY_STATUSES` are exported constants.
- [ ] Passing `statuses: ALL_OPPORTUNITY_STATUSES` returns the pre-Issue-3 behavior (all statuses except `draft`, which remains excluded via `isActionableForViewer` as before).
- [ ] The database query pushes the status filter into SQL — verifiable by inspecting the generated query or running against a seed dataset where `accepted` rows exist but don't appear in the default-filter result.
- [ ] Existing home-feed UI test (or a new one in this issue) confirms the narrowed default is intentional.

## Implementation Notes

- `OpportunityStatus` enum lives at `packages/protocol/src/shared/interfaces/database.interface.ts`.
- `feed.graph.ts` already applies two predicates; add the third after them (or push status into the DB call and drop the in-memory status filter — see plan).
- Adapter edit needs the aligned type change on the protocol's `OpportunityDatabase` interface.
- Full task-level breakdown: megaplan Issue 3 section.
