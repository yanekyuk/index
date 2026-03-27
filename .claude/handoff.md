---
trigger: "IND-193: Reintegrate feed composition caps and proactive maintenance. Building blocks exist (feed health scorer, maintenance graph, composition utilities, tests) but were reverted in commit 775e81b60. Need to re-wire selectByComposition() in home.graph.ts, instantiate and invoke MaintenanceGraph from opportunity.service.ts, replace empty-feed-only check with health-scored maintenance trigger, and add intent event listeners for maintenance on create/update/archive."
type: feat
branch: feat/feed-maintenance-reintegration
created: 2026-03-27
---

## Related Files
- protocol/src/lib/protocol/graphs/home.graph.ts (line 192 — plain .slice() instead of composition-aware selection)
- protocol/src/services/opportunity.service.ts (lines 76-159 — constructor missing MaintenanceGraph, getHomeView uses empty-feed-only check)
- protocol/src/lib/protocol/support/opportunity.utils.ts (lines 130-219 — FEED_SOFT_TARGETS, classifyOpportunity, selectByComposition — implemented but not called)
- protocol/src/lib/protocol/graphs/maintenance.graph.ts (full file — complete but not instantiated anywhere)
- protocol/src/lib/protocol/support/feed.health.ts (full file — computeFeedHealth implemented but unused)
- protocol/src/lib/protocol/states/maintenance.state.ts (full file — complete state definition)
- protocol/src/queues/opportunity.queue.ts (lines 156-169 — expiration cron, already working)
- protocol/src/events/intent.event.ts (intent lifecycle events — need to hook maintenance triggers)
- protocol/tests/feed-health.spec.ts (existing tests)
- protocol/tests/feed-composition-slicing.spec.ts (existing tests)
- protocol/tests/maintenance-graph.spec.ts (existing tests)

## Relevant Docs
- docs/domain/feed-and-maintenance.md — full design spec for composition targets and health scoring
- docs/domain/opportunities.md — opportunity lifecycle, actionability rules, valency roles

## Related Issues
- IND-193 Agent wake up: cap feed (3 connections, 2 connector initiators, max 2 expired) + proactive agent self-maintenance (In Progress)
- IND-145 Gain knowledge and refactor opportunity expiration paths (Todo)

## Scope
Reintegrate feed composition caps and proactive maintenance that were built and tested but reverted in commit 775e81b60:

1. **Feed composition caps (home.graph.ts)**: Replace plain `.slice(0, state.limit)` at line 192 with `selectByComposition(deduped, state.userId)` to enforce ~3 connection, ~2 connector-flow, ~2 expired soft targets. Import `selectByComposition` from opportunity.utils.

2. **Maintenance graph wiring (opportunity.service.ts)**: Instantiate `MaintenanceGraphFactory` in the OpportunityService constructor with database, cache, and queue dependencies. Replace the empty-feed-only rediscovery check in `getHomeView()` with a fire-and-forget call to the maintenance graph, which uses health scoring to decide whether rediscovery is needed.

3. **Intent event listeners**: Hook into IntentEvents (onCreated, onUpdated, onArchived) to trigger maintenance when a user's intents change, not only when they view the home feed.

4. **Observability**: Add logging when maintenance is triggered and include `meta.maintenanceTriggered` in the home view response so the frontend/debug tools can observe maintenance activity.

5. **Verify existing tests pass**: Run feed-health, feed-composition-slicing, and maintenance-graph tests to ensure building blocks still work before and after integration.
