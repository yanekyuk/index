---
trigger: "IND-253 — Expose introducer opportunities to notification pollers"
type: feat
branch: feat/introducer-pending-opps
base-branch: dev
created: 2026-05-06
version-bump: minor
linear-issue: IND-253
---

## Related Files
- backend/src/services/opportunity-delivery.service.ts
- backend/src/controllers/agent.controller.ts
- backend/src/adapters/database.adapter.ts
- packages/protocol/src/opportunity/opportunity.utils.ts
- packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts
- packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts
- docs/specs/api-reference.md

## Relevant Docs
- docs/domain/opportunities.md
- docs/specs/api-reference.md
- docs/specs/introducer-discovery.md
- docs/domain/feed-and-maintenance.md
- docs/specs/2026-05-06-expose-introducer-opportunities-to-pollers-design.md

## Related Issues
- IND-253 Expose introducer opportunities to notification pollers (Triage)
- IND-247 Seren's Telegram message formatting for all notification types (Todo) — blocked by this
- IND-246 Telegram accept redirect deep links (Done)
- IND-241 Investigate: introducer-discovery detection.source and initial status mismatch (Done)

## Scope
See design spec at `docs/specs/2026-05-06-expose-introducer-opportunities-to-pollers-design.md`.

Rewrite `fetchPendingCandidates` in `OpportunityDeliveryService` to use the `getOpportunitiesForUser` database adapter (same as the feed graph) instead of raw SQL. Widen status filter to include `latent` alongside `pending` and `draft`. Apply `canUserSeeOpportunity` + `isActionableForViewer` JS filters (mirroring feed graph). Move delivery dedup to a batch JS filter. Add `feedCategory: 'connection' | 'connector-flow'` per item via `classifyOpportunity()`. Add `totalPending` count to the response envelope. Update controller response shape and API docs. Does NOT include openclaw-plugin prompt changes (deferred to IND-247).
