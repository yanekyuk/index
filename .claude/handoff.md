---
trigger: "Fix broken introducer discovery pipeline (BullMQ colon job IDs, silent error swallowing, invisible log metadata), add LOG_LEVEL verbose support, add noCache query param for debugging, and ensure introducer opportunities appear after normal connections in the feed"
type: fix
branch: fix/introducer-discovery-fixes
base-branch: dev
created: 2026-03-29
linear-issue: IND-216
---

## Related Files
- protocol/src/startup.env.ts (LOG_LEVEL Zod enum missing verbose)
- protocol/src/lib/protocol/support/introducer.discovery.ts (colon job IDs, silent errors, metadata-only logs)
- protocol/src/lib/protocol/graphs/maintenance.graph.ts (colon job IDs, silent rediscovery errors, metadata-only logs)
- protocol/src/main.ts (colon in rediscovery job ID)
- protocol/src/queues/notification.queue.ts (colon in email job ID)
- protocol/src/queues/queue.template.md (template uses colons)
- protocol/src/controllers/opportunity.controller.ts (noCache query param)
- protocol/src/services/opportunity.service.ts (noCache passthrough)
- protocol/src/lib/protocol/graphs/home.graph.ts (noCache cache bypass, HomeGraphInvokeInput)
- protocol/src/lib/protocol/states/home.state.ts (noCache annotation)
- frontend/src/services/opportunities.ts (noCache option + skip in-memory cache)
- frontend/src/components/ChatContent.tsx (read noCache from browser URL)
- protocol/src/lib/protocol/support/opportunity.utils.ts (feed ordering — introducer after connections)

## Relevant Docs
- docs/specs/introducer-discovery.md
- docs/domain/feed-and-maintenance.md

## Related Issues
- IND-216 Railway deployment hangs in restart loop when env validation fails (Triage)

## Scope

### Bug fixes
1. **BullMQ colon job IDs**: BullMQ rejects `:` in custom job IDs. All introducer discovery, rediscovery, and notification email jobs were silently failing. Replace colons with dashes in job ID separators across all queue callers (introducer.discovery.ts, maintenance.graph.ts, main.ts, notification.queue.ts, queue.template.md).

2. **Silent error swallowing**: `Promise.allSettled` in introducer.discovery.ts and maintenance.graph.ts absorbs rejected promises without logging. Add per-job error logging before re-throwing so failures are visible in Railway logs.

3. **Invisible log metadata**: Railway log capture only preserves the `message` field, dropping JSON metadata passed as a second argument to the logger. Inline key values (userId, contacts, enqueued, connectorFlow counts) directly into the log message string.

4. **LOG_LEVEL validation**: The Zod enum in startup.env.ts did not include `verbose`, even though log.ts supports it. Setting LOG_LEVEL=verbose on Railway caused a boot crash and restart loop.

### Feature: noCache bypass
Add `?noCache=1` or `?noCache=true` query param to `GET /opportunities/home` that bypasses both presenter and categorizer Redis caches, plus the frontend in-memory dedup cache. Flows through: browser URL → ChatContent.tsx → opportunities service → controller → home graph state → cache check nodes.

### Feed ordering fix
Introducer-discovered opportunities (connector-flow) should appear AFTER normal connection opportunities in the home feed. Update selectByComposition or the normalizeAndSort node in home.graph.ts to ensure connections are prioritized over connector-flow items in section ordering.
