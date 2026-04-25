# OpportunityPresenter Cache-Aside for OpenClaw Pollers

**Date:** 2026-04-25  
**Linear:** IND-243  
**Status:** Design approved

## Problem

The OpenClaw pollers (digest and ambient evaluators) fetch pending opportunities via `GET /agents/:agentId/opportunities/pending`. This endpoint calls `OpportunityPresenter.presentHomeCard()` directly for each opportunity, bypassing the Redis cache that the home feed uses.

**Result:** Every poll hits the LLM, even when the same card is already cached from a home feed render.

## Goal

Wire `fetchPendingCandidates` to use the same cache-aside pattern as the home feed:
- Cache hit → return immediately, no LLM call
- Cache miss → call presenter, cache result, return

This ensures OpenClaw evaluators see the same presented text users see, and warms the cache for home feed renders.

## Design

### 1. Shared Utility

**File:** `packages/protocol/src/opportunity/home-card.cache.ts`

```typescript
async function getOrCreateHomeCardBatch(
  cache: CacheAdapter,
  presenter: OpportunityPresenter,
  presenterDb: PresenterDatabase,
  opportunities: OpportunityWithContext[],
  viewerId: string,
  options?: { ttl?: number }
): Promise<Map<string, HomeCardItem>>
```

**Logic:**
1. Build cache keys: `home:card:{oppId}:{status}:{viewerId}`
2. `mget` all keys in one Redis call
3. For cache misses: call `gatherPresenterContext` → `presenter.presentHomeCard` → cache result
4. Return `Map<opportunityId, HomeCardItem>`

**Constants:** `HOME_CARD_CACHE_TTL = 24 * 60 * 60` (24 hours)

**Types:**
- `OpportunityWithContext`: The opportunity record with `id`, `status`, `actors`, `interpretation`, `detection` — same shape already passed to `gatherPresenterContext`
- `HomeCardItem`: `{ headline, personalizedSummary, suggestedAction, narratorRemark }` — matches existing `RenderedCard` in opportunity-delivery service

### 2. Feed Graph Integration

**File:** `packages/protocol/src/opportunity/feed/feed.graph.ts`

- `checkPresenterCacheNode` and `cachePresenterResultsNode` delegate to `getOrCreateHomeCardBatch`
- Graph nodes still exist as part of LangGraph flow, but core logic is shared
- `negotiating` filtering remains in the graph (before calling the utility)

### 3. Opportunity-Delivery Service Integration

**File:** `backend/src/services/opportunity-delivery.service.ts`

- `renderOpportunityCard` replaces direct presenter call with `getOrCreateHomeCardBatch` (single-item batch)
- Inject `CacheAdapter` into the service constructor alongside existing `presenter` and `presenterDb`
- Use the same Redis cache adapter instance used elsewhere in backend (from `src/adapters/cache.adapter.ts`)

### 4. Testing

**Unit tests** (`home-card.cache.spec.ts`):
- Cache hit → returns cached card, no presenter call
- Cache miss → calls presenter, caches result
- Mixed batch → correct split between hits and misses
- Presenter failure → graceful fallback

**Integration:**
- Existing feed graph tests pass unchanged
- New test for `fetchPendingCandidates` verifying cache is used

**Manual:**
- Poll via OpenClaw → verify Redis `home:card:*` keys created
- Second poll → confirm faster response (cache hit, no LLM)

## Files Changed

| File | Change |
|------|--------|
| `packages/protocol/src/opportunity/home-card.cache.ts` | New — shared cache-aside utility |
| `packages/protocol/src/opportunity/feed/feed.graph.ts` | Refactor cache nodes to use utility |
| `backend/src/services/opportunity-delivery.service.ts` | Use utility, inject cache adapter |
| `packages/protocol/src/opportunity/home-card.cache.spec.ts` | New — unit tests |
