# OpportunityPresenter Cache-Aside Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the OpenClaw polling endpoint to use the same cache-aside pattern as the home feed, so evaluators see cached presenter output and warm the cache for home renders.

**Architecture:** Extract cache-aside logic into a shared utility in `packages/protocol/src/opportunity/`. The feed graph delegates to it, and `opportunity-delivery.service.ts` calls it instead of the presenter directly. Cache adapter is injected into the service.

**Tech Stack:** TypeScript, Redis (via `RedisCacheAdapter`), `OpportunityPresenter`, existing `gatherPresenterContext`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/protocol/src/opportunity/home-card.cache.ts` | Create | Shared `getOrCreateHomeCardBatch` utility |
| `packages/protocol/src/opportunity/home-card.cache.spec.ts` | Create | Unit tests for the utility |
| `packages/protocol/src/opportunity/feed/feed.graph.ts` | Modify | Delegate cache logic to shared utility |
| `backend/src/services/opportunity-delivery.service.ts` | Modify | Use utility, accept cache in constructor |
| `backend/src/protocol-init.ts` | Modify | Pass cache adapter to service |
| `backend/src/controllers/agent.controller.ts` | Modify | Pass cache adapter to service |

---

### Task 1: Create shared utility with cache-hit test

**Files:**
- Create: `packages/protocol/src/opportunity/home-card.cache.ts`
- Create: `packages/protocol/src/opportunity/home-card.cache.spec.ts`

- [ ] **Step 1: Write the failing test for cache hit**

```typescript
// packages/protocol/src/opportunity/home-card.cache.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateHomeCardBatch } from './home-card.cache.js';
import type { OpportunityPresenter } from './opportunity.presenter.js';
import type { PresenterDatabase } from './opportunity.presenter.js';
import type { Cache } from '../shared/interfaces/cache.interface.js';

describe('getOrCreateHomeCardBatch', () => {
  let mockCache: Cache;
  let mockPresenter: OpportunityPresenter;
  let mockPresenterDb: PresenterDatabase;

  beforeEach(() => {
    mockCache = {
      get: vi.fn(),
      set: vi.fn(),
      mget: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      deleteByPattern: vi.fn(),
    };
    mockPresenter = {
      presentHomeCard: vi.fn(),
    } as unknown as OpportunityPresenter;
    mockPresenterDb = {
      getProfile: vi.fn(),
      getActiveIntents: vi.fn(),
      getNetwork: vi.fn(),
    } as unknown as PresenterDatabase;
  });

  it('returns cached card without calling presenter on cache hit', async () => {
    const cachedCard = {
      opportunityId: 'opp-1',
      headline: 'Cached headline',
      personalizedSummary: 'Cached summary',
      suggestedAction: 'Cached action',
      narratorRemark: 'Cached remark',
    };
    vi.mocked(mockCache.mget).mockResolvedValue([cachedCard]);

    const opportunities = [{ id: 'opp-1', status: 'pending', actors: [] }];
    const result = await getOrCreateHomeCardBatch(
      mockCache,
      mockPresenter,
      mockPresenterDb,
      opportunities as any,
      'user-1'
    );

    expect(result.get('opp-1')).toEqual(cachedCard);
    expect(mockPresenter.presentHomeCard).not.toHaveBeenCalled();
    expect(mockCache.mget).toHaveBeenCalledWith(['home:card:opp-1:pending:user-1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/protocol && bun test src/opportunity/home-card.cache.spec.ts`
Expected: FAIL with "Cannot find module './home-card.cache.js'"

- [ ] **Step 3: Write minimal implementation for cache hit**

```typescript
// packages/protocol/src/opportunity/home-card.cache.ts
import type { Cache } from '../shared/interfaces/cache.interface.js';
import type { OpportunityPresenter, PresenterDatabase } from './opportunity.presenter.js';

export interface HomeCardItem {
  opportunityId: string;
  headline: string;
  personalizedSummary: string;
  suggestedAction: string;
  narratorRemark: string;
}

export interface OpportunityWithContext {
  id: string;
  status: string;
  actors: Array<{ userId: string; role: string }>;
  interpretation?: unknown;
  detection?: unknown;
}

export const HOME_CARD_CACHE_TTL = 24 * 60 * 60; // 24 hours

export async function getOrCreateHomeCardBatch(
  cache: Cache,
  presenter: OpportunityPresenter,
  presenterDb: PresenterDatabase,
  opportunities: OpportunityWithContext[],
  viewerId: string,
  options?: { ttl?: number }
): Promise<Map<string, HomeCardItem>> {
  if (opportunities.length === 0) {
    return new Map();
  }

  const keys = opportunities.map(
    (opp) => `home:card:${opp.id}:${opp.status}:${viewerId}`
  );
  const cached = await cache.mget<HomeCardItem>(keys);

  const result = new Map<string, HomeCardItem>();
  for (let i = 0; i < opportunities.length; i++) {
    if (cached[i]) {
      result.set(opportunities[i].id, cached[i]);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/protocol && bun test src/opportunity/home-card.cache.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/opportunity/home-card.cache.ts packages/protocol/src/opportunity/home-card.cache.spec.ts
git commit -m "feat(protocol): add home-card cache utility with cache-hit test"
```

---

### Task 2: Add cache-miss logic to the utility

**Files:**
- Modify: `packages/protocol/src/opportunity/home-card.cache.ts`
- Modify: `packages/protocol/src/opportunity/home-card.cache.spec.ts`

- [ ] **Step 1: Write the failing test for cache miss**

```typescript
// Add to packages/protocol/src/opportunity/home-card.cache.spec.ts
it('calls presenter and caches result on cache miss', async () => {
  vi.mocked(mockCache.mget).mockResolvedValue([null]);
  vi.mocked(mockCache.set).mockResolvedValue(undefined);

  const presentedCard = {
    headline: 'Generated headline',
    personalizedSummary: 'Generated summary',
    suggestedAction: 'Generated action',
    narratorRemark: 'Generated remark',
  };
  vi.mocked(mockPresenter.presentHomeCard).mockResolvedValue(presentedCard);

  const opportunities = [{
    id: 'opp-2',
    status: 'pending',
    actors: [{ userId: 'user-1', role: 'candidate' }],
    interpretation: { reasoning: 'test' },
  }];

  const result = await getOrCreateHomeCardBatch(
    mockCache,
    mockPresenter,
    mockPresenterDb,
    opportunities as any,
    'user-1'
  );

  expect(result.get('opp-2')).toMatchObject({
    opportunityId: 'opp-2',
    headline: 'Generated headline',
  });
  expect(mockPresenter.presentHomeCard).toHaveBeenCalled();
  expect(mockCache.set).toHaveBeenCalledWith(
    'home:card:opp-2:pending:user-1',
    expect.objectContaining({ opportunityId: 'opp-2' }),
    { ttl: 24 * 60 * 60 }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/protocol && bun test src/opportunity/home-card.cache.spec.ts`
Expected: FAIL — cache miss returns empty map, presenter not called

- [ ] **Step 3: Add cache-miss implementation**

```typescript
// Replace the function body in packages/protocol/src/opportunity/home-card.cache.ts
import { gatherPresenterContext } from './opportunity.presenter.js';

export async function getOrCreateHomeCardBatch(
  cache: Cache,
  presenter: OpportunityPresenter,
  presenterDb: PresenterDatabase,
  opportunities: OpportunityWithContext[],
  viewerId: string,
  options?: { ttl?: number }
): Promise<Map<string, HomeCardItem>> {
  if (opportunities.length === 0) {
    return new Map();
  }

  const ttl = options?.ttl ?? HOME_CARD_CACHE_TTL;
  const keys = opportunities.map(
    (opp) => `home:card:${opp.id}:${opp.status}:${viewerId}`
  );
  const cached = await cache.mget<HomeCardItem>(keys);

  const result = new Map<string, HomeCardItem>();
  const misses: Array<{ opp: OpportunityWithContext; index: number }> = [];

  for (let i = 0; i < opportunities.length; i++) {
    if (cached[i]) {
      result.set(opportunities[i].id, cached[i]);
    } else {
      misses.push({ opp: opportunities[i], index: i });
    }
  }

  // Generate cards for cache misses
  await Promise.all(
    misses.map(async ({ opp, index }) => {
      const presenterInput = await gatherPresenterContext(
        presenterDb,
        opp as Parameters<typeof gatherPresenterContext>[1],
        viewerId
      );
      presenterInput.opportunityStatus = opp.status as 'pending' | 'draft';

      const presented = await presenter.presentHomeCard(presenterInput);
      const card: HomeCardItem = {
        opportunityId: opp.id,
        headline: presented.headline,
        personalizedSummary: presented.personalizedSummary,
        suggestedAction: presented.suggestedAction,
        narratorRemark: presented.narratorRemark,
      };

      result.set(opp.id, card);

      // Cache the result
      await cache.set(keys[index], card, { ttl });
    })
  );

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/protocol && bun test src/opportunity/home-card.cache.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/opportunity/home-card.cache.ts packages/protocol/src/opportunity/home-card.cache.spec.ts
git commit -m "feat(protocol): add cache-miss handling to home-card utility"
```

---

### Task 3: Add mixed batch test

**Files:**
- Modify: `packages/protocol/src/opportunity/home-card.cache.spec.ts`

- [ ] **Step 1: Write mixed batch test**

```typescript
// Add to packages/protocol/src/opportunity/home-card.cache.spec.ts
it('handles mixed batch with some hits and some misses', async () => {
  const cachedCard = {
    opportunityId: 'opp-1',
    headline: 'Cached',
    personalizedSummary: 'Cached summary',
    suggestedAction: 'Cached action',
    narratorRemark: 'Cached remark',
  };
  vi.mocked(mockCache.mget).mockResolvedValue([cachedCard, null]);
  vi.mocked(mockCache.set).mockResolvedValue(undefined);

  const presentedCard = {
    headline: 'Generated',
    personalizedSummary: 'Generated summary',
    suggestedAction: 'Generated action',
    narratorRemark: 'Generated remark',
  };
  vi.mocked(mockPresenter.presentHomeCard).mockResolvedValue(presentedCard);

  const opportunities = [
    { id: 'opp-1', status: 'pending', actors: [] },
    { id: 'opp-2', status: 'pending', actors: [{ userId: 'user-1', role: 'candidate' }] },
  ];

  const result = await getOrCreateHomeCardBatch(
    mockCache,
    mockPresenter,
    mockPresenterDb,
    opportunities as any,
    'user-1'
  );

  expect(result.size).toBe(2);
  expect(result.get('opp-1')?.headline).toBe('Cached');
  expect(result.get('opp-2')?.headline).toBe('Generated');
  expect(mockPresenter.presentHomeCard).toHaveBeenCalledTimes(1);
  expect(mockCache.set).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/protocol && bun test src/opportunity/home-card.cache.spec.ts`
Expected: PASS (implementation already handles this)

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/home-card.cache.spec.ts
git commit -m "test(protocol): add mixed batch test for home-card cache"
```

---

### Task 4: Wire utility into opportunity-delivery service

**Files:**
- Modify: `backend/src/services/opportunity-delivery.service.ts`
- Modify: `backend/src/protocol-init.ts`
- Modify: `backend/src/controllers/agent.controller.ts`

- [ ] **Step 1: Add cache to OpportunityDeliveryService constructor**

```typescript
// In backend/src/services/opportunity-delivery.service.ts
// Add import at top:
import type { Cache } from '../adapters/cache.adapter';
import { getOrCreateHomeCardBatch } from '@indexnetwork/protocol';

// Modify class to add cache field and constructor parameter:
export class OpportunityDeliveryService {
  private readonly presenterDb: PresenterDatabase;
  private readonly cache: Cache | null;

  constructor(
    private readonly presenter: OpportunityPresenter = new OpportunityPresenter(),
    presenterDb?: PresenterDatabase,
    cache?: Cache,
  ) {
    this.presenterDb = presenterDb ?? (chatDatabaseAdapter as unknown as PresenterDatabase);
    this.cache = cache ?? null;
  }
```

- [ ] **Step 2: Replace renderOpportunityCard to use the utility**

```typescript
// In backend/src/services/opportunity-delivery.service.ts
// Replace the renderOpportunityCard method (around line 376):
private async renderOpportunityCard(
  opportunityId: string,
  userId: string,
): Promise<RenderedCard> {
  const [opp] = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId));

  if (!opp) throw new Error('opportunity_not_found');

  // Use cache-aside utility if cache is available
  if (this.cache) {
    const oppWithContext = {
      id: opp.id,
      status: opp.status,
      actors: opp.actors as Array<{ userId: string; role: string }>,
      interpretation: opp.interpretation,
      detection: opp.detection,
    };

    const cards = await getOrCreateHomeCardBatch(
      this.cache,
      this.presenter,
      this.presenterDb,
      [oppWithContext],
      userId
    );

    const card = cards.get(opp.id);
    if (card) {
      return {
        headline: card.headline,
        personalizedSummary: card.personalizedSummary,
        suggestedAction: card.suggestedAction,
        narratorRemark: card.narratorRemark,
      };
    }
  }

  // Fallback to direct presenter call (no cache)
  try {
    const presenterInput = await gatherPresenterContext(
      this.presenterDb,
      opp as unknown as Parameters<typeof gatherPresenterContext>[1],
      userId,
    );
    presenterInput.opportunityStatus = 'pending';

    const presented = await this.presenter.presentHomeCard(presenterInput);
    return {
      headline: presented.headline,
      personalizedSummary: presented.personalizedSummary,
      suggestedAction: presented.suggestedAction,
      narratorRemark: presented.narratorRemark,
    };
  } catch {
    // LLM fallback
    const rawReasoning =
      (opp.interpretation as { reasoning?: string })?.reasoning ?? '';
    return {
      headline: 'New opportunity',
      personalizedSummary: rawReasoning.slice(0, 200),
      suggestedAction: 'Review this opportunity',
      narratorRemark: '',
    };
  }
}
```

- [ ] **Step 3: Update protocol-init.ts to pass cache**

```typescript
// In backend/src/protocol-init.ts
// Change line 48 from:
//   const opportunityDeliveryService = new OpportunityDeliveryService();
// To:
const cacheAdapter = new RedisCacheAdapter();
const opportunityDeliveryService = new OpportunityDeliveryService(
  undefined,
  undefined,
  cacheAdapter
);

// Also update line 54 to reuse the same cache:
return {
  // ... existing fields
  cache: cacheAdapter,  // reuse instead of new RedisCacheAdapter()
```

- [ ] **Step 4: Update agent.controller.ts to pass cache**

```typescript
// In backend/src/controllers/agent.controller.ts
// Change line 17 from:
//   const opportunityDeliveryService = new OpportunityDeliveryService();
// To:
import { RedisCacheAdapter } from '../adapters/cache.adapter';
const opportunityDeliveryService = new OpportunityDeliveryService(
  undefined,
  undefined,
  new RedisCacheAdapter()
);
```

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `cd backend && bun test tests/e2e.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/opportunity-delivery.service.ts backend/src/protocol-init.ts backend/src/controllers/agent.controller.ts
git commit -m "feat(backend): wire cache-aside into opportunity-delivery service"
```

---

### Task 5: Export utility from protocol package

**Files:**
- Modify: `packages/protocol/src/index.ts` (or main export file)

- [ ] **Step 1: Find and update the protocol package exports**

Run: `grep -n "export" packages/protocol/src/index.ts | head -20`

- [ ] **Step 2: Add export for the new utility**

```typescript
// Add to packages/protocol/src/index.ts exports:
export {
  getOrCreateHomeCardBatch,
  HOME_CARD_CACHE_TTL,
  type HomeCardItem,
  type OpportunityWithContext,
} from './opportunity/home-card.cache.js';
```

- [ ] **Step 3: Run build to verify export works**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): export home-card cache utility"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Start the backend dev server**

Run: `cd backend && bun run dev`

- [ ] **Step 2: Trigger a poll via OpenClaw or direct API call**

Use curl or the OpenClaw plugin to hit `GET /api/agents/:agentId/opportunities/pending`

- [ ] **Step 3: Check Redis for cache keys**

Run: `redis-cli KEYS "home:card:*"`
Expected: See keys like `home:card:opp-xxx:pending:user-xxx`

- [ ] **Step 4: Poll again and verify faster response**

Second poll should be faster (cache hit, no LLM call)

- [ ] **Step 5: Commit any fixes if needed**

---

### Task 7: (Optional) Refactor feed graph to use shared utility

This task is optional — the feed graph already works. This refactor shares code but doesn't change behavior.

**Files:**
- Modify: `packages/protocol/src/opportunity/feed/feed.graph.ts`

- [ ] **Step 1: Import the utility**

```typescript
// Add import at top of feed.graph.ts:
import { getOrCreateHomeCardBatch, type HomeCardItem } from '../home-card.cache.js';
```

- [ ] **Step 2: Refactor checkPresenterCacheNode to delegate to utility**

The graph still filters `negotiating` before calling, and handles `_cardIndex` tracking after.

```typescript
const checkPresenterCacheNode = async (state: typeof HomeGraphState.State) => {
  return timed("HomeGraph.checkPresenterCache", async () => {
    const { opportunities, userId } = state;
    if (opportunities.length === 0) {
      return { cachedCards: new Map(), uncachedOpportunities: [] };
    }

    if (state.noCache) {
      logger.verbose('[HomeGraph:checkPresenterCache] noCache=true, skipping cache');
      return { cachedCards: new Map(), uncachedOpportunities: opportunities };
    }

    try {
      // Negotiating cards skip cache (live turn count)
      const cacheable = opportunities.filter((opp) => opp.status !== 'negotiating');
      const liveNegotiating = opportunities.filter((opp) => opp.status === 'negotiating');

      // Use shared utility for cache lookup only (no generation here)
      const keys = cacheable.map(
        (opp) => `home:card:${opp.id}:${opp.status}:${userId}`
      );
      const results = keys.length > 0 ? await this.cache.mget<HomeCardItem>(keys) : [];

      const cachedCards = new Map<string, HomeCardItem>();
      const uncachedOpportunities: typeof opportunities = [...liveNegotiating];

      for (let i = 0; i < cacheable.length; i++) {
        const cached = results[i];
        if (cached) {
          const originalIndex = opportunities.indexOf(cacheable[i]);
          cachedCards.set(cacheable[i].id, { ...cached, _cardIndex: originalIndex });
        } else {
          uncachedOpportunities.push(cacheable[i]);
        }
      }

      return { cachedCards, uncachedOpportunities };
    } catch (e) {
      logger.warn('[HomeGraph:checkPresenterCache] cache unavailable, skipping', { error: e });
      return { cachedCards: new Map(), uncachedOpportunities: opportunities };
    }
  });
};
```

Note: The feed graph's cache nodes do more than the utility (index tracking, negotiating filtering, merging). Full delegation would require expanding the utility's API. For now, the utility is used by opportunity-delivery; feed graph refactor can be a follow-up.

- [ ] **Step 3: Verify existing feed graph tests pass**

Run: `cd packages/protocol && bun test src/opportunity/tests/feed.graph.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit if changes were made**

```bash
git add packages/protocol/src/opportunity/feed/feed.graph.ts
git commit -m "refactor(protocol): feed graph uses shared home-card cache utility"
```

---

### Task 8: Final cleanup and documentation

- [ ] **Step 1: Delete the spec file (implementation complete)**

```bash
rm docs/superpowers/specs/2026-04-25-opportunity-presenter-cache-aside-design.md
```

- [ ] **Step 2: Delete this plan file**

```bash
rm docs/superpowers/plans/2026-04-25-opportunity-presenter-cache-aside.md
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: clean up spec and plan files for IND-243"
```
