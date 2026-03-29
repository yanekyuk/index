---
trigger: "Home feed shows 0 connector-flow opportunities because fetchLimit formula (limit*3=15) cuts off older introducer opportunities before selectByComposition sees them. Maintenance graph fetches 150 and counts 19 connector-flow, but home graph only fetches 15 newest rows — all connections."
type: fix
branch: fix/home-feed-fetch-limit
base-branch: dev
created: 2026-03-29
version-bump: patch
---

## Related Files
- protocol/src/lib/protocol/graphs/home.graph.ts (line 164 — fetchLimit formula; line 193 — selectByComposition call)
- protocol/src/lib/protocol/support/opportunity.utils.ts (lines 166-223 — selectByComposition with FEED_SOFT_TARGETS totaling 7)
- protocol/src/lib/protocol/graphs/maintenance.graph.ts (line 69 — fetches with limit: 150, correctly counts 19 connector-flow)

## Relevant Docs
- docs/domain/feed-and-maintenance.md
- docs/domain/opportunities.md

## Related Issues
- None directly — discovered during debugging why Seref's home feed shows 0 introducer cards despite having 19 connector-flow opportunities

## Scope
The home graph's `fetchLimit` formula at line 164 is:
```typescript
const fetchLimit = Math.min(150, Math.max(state.limit * 3, state.limit));
```

With `state.limit=5` (default from frontend), this produces `fetchLimit=15`. The DB query returns the 15 newest opportunities ordered by `createdAt DESC`. If connector-flow (introducer) opportunities are older than recent connections, they never make it into the candidate pool.

After filtering through `canUserSeeOpportunity` → `isActionableForViewer` → dedup, all 15 survivors are connections. `selectByComposition` sees `connector-flow=0` and outputs only connection cards.

Meanwhile, the maintenance graph fetches with `limit: 150` and correctly finds 19 connector-flow opportunities using the same classification logic.

Fix: The fetchLimit should be high enough for `selectByComposition` to fill all category buckets. Options:
1. Use a fixed minimum like `Math.max(50, state.limit * 3)` to ensure enough candidates across categories
2. Match maintenance's approach and always fetch 150
3. Decouple the DB fetch limit from `state.limit` entirely — fetch a generous pool, let composition do the trimming

The composition soft targets total 7 (3+2+2), but we need headroom for filtering and dedup. A fetchLimit of 50-100 would be safe.
