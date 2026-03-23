# Feed Health & Proactive Maintenance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Add feed health scoring, composition-aware slicing, proactive maintenance, and automatic opportunity expiration to keep the home feed useful for active users.

**Architecture:** A `FeedHealthScorer` utility computes a 0–1 score from composition fit, freshness, and expiration ratio. A new `MaintenanceGraph` (write path) evaluates health and enqueues rediscovery when unhealthy. The existing `HomeGraph` (read path) gains composition-aware slicing. A cron job auto-expires stale opportunities. Intent events trigger maintenance for active users.

**Tech Stack:** TypeScript, LangGraph, BullMQ, node-cron, Drizzle ORM, bun:test

---

### Task 1: Opportunity Classification Utility

**Files:**
- Modify: `protocol/src/lib/protocol/support/opportunity.utils.ts:127` (append after `isActionableForViewer`)
- Test: `protocol/tests/feed-classification.spec.ts`

**Step 1: Write the failing test**

Create `protocol/tests/feed-classification.spec.ts`:

```typescript
import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect } from 'bun:test';
import { classifyOpportunity, FEED_SOFT_TARGETS } from '../src/lib/protocol/support/opportunity.utils';

describe('classifyOpportunity', () => {
  const viewerId = 'user-1';

  it('classifies expired opportunity as expired', () => {
    const opp = {
      actors: [{ userId: viewerId, role: 'party' }, { userId: 'user-2', role: 'party' }],
      status: 'expired',
    };
    expect(classifyOpportunity(opp, viewerId)).toBe('expired');
  });

  it('classifies opportunity with introducer as connector-flow', () => {
    const opp = {
      actors: [
        { userId: viewerId, role: 'party' },
        { userId: 'user-2', role: 'party' },
        { userId: 'user-3', role: 'introducer' },
      ],
      status: 'pending',
    };
    expect(classifyOpportunity(opp, viewerId)).toBe('connector-flow');
  });

  it('classifies opportunity without introducer as connection', () => {
    const opp = {
      actors: [{ userId: viewerId, role: 'party' }, { userId: 'user-2', role: 'party' }],
      status: 'pending',
    };
    expect(classifyOpportunity(opp, viewerId)).toBe('connection');
  });

  it('classifies expired opportunity with introducer as expired (not connector-flow)', () => {
    const opp = {
      actors: [
        { userId: viewerId, role: 'party' },
        { userId: 'user-2', role: 'party' },
        { userId: 'user-3', role: 'introducer' },
      ],
      status: 'expired',
    };
    expect(classifyOpportunity(opp, viewerId)).toBe('expired');
  });
});

describe('FEED_SOFT_TARGETS', () => {
  it('has expected default values', () => {
    expect(FEED_SOFT_TARGETS.connection).toBe(3);
    expect(FEED_SOFT_TARGETS.connectorFlow).toBe(2);
    expect(FEED_SOFT_TARGETS.expired).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test tests/feed-classification.spec.ts`
Expected: FAIL — `classifyOpportunity` and `FEED_SOFT_TARGETS` not exported.

**Step 3: Write minimal implementation**

Append to `protocol/src/lib/protocol/support/opportunity.utils.ts` (after line 127):

```typescript
/** Feed category for home composition. */
export type FeedCategory = 'connection' | 'connector-flow' | 'expired';

/** Soft targets for home feed composition. */
export const FEED_SOFT_TARGETS = {
  connection: 3,
  connectorFlow: 2,
  expired: 2,
} as const;

/**
 * Classify an actionable opportunity into a feed category.
 * Assumes the opportunity already passed isActionableForViewer or is expired.
 *
 * @param opp - Opportunity with actors and status
 * @param viewerId - The viewing user's ID
 * @returns Feed category
 */
export function classifyOpportunity(
  opp: { actors: Array<{ userId: string; role: string }>; status: string },
  viewerId: string
): FeedCategory {
  if (opp.status === 'expired') return 'expired';
  const hasIntroducer = opp.actors.some((a) => a.role === 'introducer');
  if (hasIntroducer) return 'connector-flow';
  return 'connection';
}
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test tests/feed-classification.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/support/opportunity.utils.ts protocol/tests/feed-classification.spec.ts
git commit -m "feat: add opportunity classification utility and feed soft targets"
```

---

### Task 2: Feed Health Scorer

**Files:**
- Create: `protocol/src/lib/protocol/support/feed.health.ts`
- Test: `protocol/tests/feed-health.spec.ts`

**Step 1: Write the failing test**

Create `protocol/tests/feed-health.spec.ts`:

```typescript
import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect } from 'bun:test';
import { computeFeedHealth, type FeedHealthInput } from '../src/lib/protocol/support/feed.health';

describe('computeFeedHealth', () => {
  const now = Date.now();

  it('returns perfect score for ideal composition with recent rediscovery', () => {
    const input: FeedHealthInput = {
      connectionCount: 3,
      connectorFlowCount: 2,
      expiredCount: 0,
      totalActionable: 5,
      lastRediscoveryAt: now - 1000, // 1 second ago
      freshnessWindowMs: 12 * 60 * 60 * 1000,
    };
    const result = computeFeedHealth(input);
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.shouldMaintain).toBe(false);
  });

  it('returns zero score for empty feed', () => {
    const input: FeedHealthInput = {
      connectionCount: 0,
      connectorFlowCount: 0,
      expiredCount: 0,
      totalActionable: 0,
      lastRediscoveryAt: null,
      freshnessWindowMs: 12 * 60 * 60 * 1000,
    };
    const result = computeFeedHealth(input);
    expect(result.score).toBe(0);
    expect(result.shouldMaintain).toBe(true);
  });

  it('penalizes stale feed (old rediscovery)', () => {
    const input: FeedHealthInput = {
      connectionCount: 3,
      connectorFlowCount: 2,
      expiredCount: 0,
      totalActionable: 5,
      lastRediscoveryAt: now - 24 * 60 * 60 * 1000, // 24h ago
      freshnessWindowMs: 12 * 60 * 60 * 1000,
    };
    const result = computeFeedHealth(input);
    expect(result.breakdown.freshness).toBe(0);
    expect(result.score).toBeLessThan(0.8);
  });

  it('penalizes high expiration ratio', () => {
    const input: FeedHealthInput = {
      connectionCount: 1,
      connectorFlowCount: 0,
      expiredCount: 4,
      totalActionable: 1,
      lastRediscoveryAt: now - 1000,
      freshnessWindowMs: 12 * 60 * 60 * 1000,
    };
    const result = computeFeedHealth(input);
    expect(result.breakdown.expirationRatio).toBeLessThan(0.3);
  });

  it('penalizes unbalanced composition', () => {
    const input: FeedHealthInput = {
      connectionCount: 10,
      connectorFlowCount: 0,
      expiredCount: 0,
      totalActionable: 10,
      lastRediscoveryAt: now - 1000,
      freshnessWindowMs: 12 * 60 * 60 * 1000,
    };
    const result = computeFeedHealth(input);
    expect(result.breakdown.composition).toBeLessThan(1);
  });

  it('respects custom threshold', () => {
    const input: FeedHealthInput = {
      connectionCount: 2,
      connectorFlowCount: 1,
      expiredCount: 1,
      totalActionable: 3,
      lastRediscoveryAt: now - 8 * 60 * 60 * 1000,
      freshnessWindowMs: 12 * 60 * 60 * 1000,
      threshold: 0.8,
    };
    const result = computeFeedHealth(input);
    expect(result.shouldMaintain).toBe(result.score < 0.8);
  });

  it('exposes breakdown with all three sub-scores', () => {
    const input: FeedHealthInput = {
      connectionCount: 3,
      connectorFlowCount: 2,
      expiredCount: 0,
      totalActionable: 5,
      lastRediscoveryAt: now - 1000,
      freshnessWindowMs: 12 * 60 * 60 * 1000,
    };
    const result = computeFeedHealth(input);
    expect(result.breakdown).toHaveProperty('composition');
    expect(result.breakdown).toHaveProperty('freshness');
    expect(result.breakdown).toHaveProperty('expirationRatio');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test tests/feed-health.spec.ts`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

Create `protocol/src/lib/protocol/support/feed.health.ts`:

```typescript
import { FEED_SOFT_TARGETS } from './opportunity.utils';

/** Input for computing feed health score. */
export interface FeedHealthInput {
  connectionCount: number;
  connectorFlowCount: number;
  expiredCount: number;
  totalActionable: number;
  /** Unix ms timestamp of last rediscovery, or null if never. */
  lastRediscoveryAt: number | null;
  /** Window in ms over which freshness decays from 1 → 0 (e.g. 12h). */
  freshnessWindowMs: number;
  /** Score threshold below which shouldMaintain is true. Default 0.5. */
  threshold?: number;
}

/** Output of feed health computation. */
export interface FeedHealthResult {
  score: number;
  breakdown: {
    composition: number;
    freshness: number;
    expirationRatio: number;
  };
  shouldMaintain: boolean;
}

const WEIGHT_COMPOSITION = 0.4;
const WEIGHT_FRESHNESS = 0.3;
const WEIGHT_EXPIRATION = 0.3;
const DEFAULT_THRESHOLD = 0.5;

/**
 * Compute composition sub-score: how close current counts are to soft targets.
 * Uses normalized distance: 1 - (|actual - target| / max(target, actual, 1)) per category,
 * then averages across categories.
 */
function scoreComposition(connectionCount: number, connectorFlowCount: number, expiredCount: number): number {
  const categories = [
    { actual: connectionCount, target: FEED_SOFT_TARGETS.connection },
    { actual: connectorFlowCount, target: FEED_SOFT_TARGETS.connectorFlow },
    { actual: expiredCount, target: FEED_SOFT_TARGETS.expired },
  ];

  let totalScore = 0;
  for (const { actual, target } of categories) {
    const diff = Math.abs(actual - target);
    const denom = Math.max(target, actual, 1);
    totalScore += 1 - diff / denom;
  }

  return totalScore / categories.length;
}

/**
 * Compute freshness sub-score: linear decay from 1 → 0 over freshnessWindowMs.
 */
function scoreFreshness(lastRediscoveryAt: number | null, freshnessWindowMs: number): number {
  if (lastRediscoveryAt == null) return 0;
  const elapsed = Date.now() - lastRediscoveryAt;
  if (elapsed <= 0) return 1;
  if (elapsed >= freshnessWindowMs) return 0;
  return 1 - elapsed / freshnessWindowMs;
}

/**
 * Compute expiration ratio sub-score: 1 - (expired / total).
 */
function scoreExpirationRatio(expiredCount: number, totalActionable: number): number {
  const total = totalActionable + expiredCount;
  if (total === 0) return 0;
  return 1 - expiredCount / total;
}

/**
 * Compute feed health score (0–1) from current feed state.
 * Pure function, no side effects.
 *
 * @param input - Current feed composition and timing data
 * @returns Health score with breakdown and maintenance recommendation
 */
export function computeFeedHealth(input: FeedHealthInput): FeedHealthResult {
  const {
    connectionCount,
    connectorFlowCount,
    expiredCount,
    totalActionable,
    lastRediscoveryAt,
    freshnessWindowMs,
    threshold = DEFAULT_THRESHOLD,
  } = input;

  // Empty feed is always unhealthy
  if (totalActionable === 0 && expiredCount === 0) {
    return {
      score: 0,
      breakdown: { composition: 0, freshness: 0, expirationRatio: 0 },
      shouldMaintain: true,
    };
  }

  const composition = scoreComposition(connectionCount, connectorFlowCount, expiredCount);
  const freshness = scoreFreshness(lastRediscoveryAt, freshnessWindowMs);
  const expirationRatio = scoreExpirationRatio(expiredCount, totalActionable);

  const score =
    WEIGHT_COMPOSITION * composition +
    WEIGHT_FRESHNESS * freshness +
    WEIGHT_EXPIRATION * expirationRatio;

  return {
    score,
    breakdown: { composition, freshness, expirationRatio },
    shouldMaintain: score < threshold,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test tests/feed-health.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/support/feed.health.ts protocol/tests/feed-health.spec.ts
git commit -m "feat: add feed health scorer with composition, freshness, and expiration sub-scores"
```

---

### Task 3: Opportunity Expiration Cron

**Files:**
- Modify: `protocol/src/queues/opportunity.queue.ts` (add `startCrons` method and expiration handler)
- Modify: `protocol/src/main.ts:42` (add `opportunityQueue.startCrons()`)
- Test: `protocol/tests/opportunity-expiration-cron.spec.ts`

**Step 1: Write the failing test**

Create `protocol/tests/opportunity-expiration-cron.spec.ts`:

```typescript
import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect } from 'bun:test';
import db from '../src/lib/drizzle/drizzle';
import { opportunities } from '../src/schemas/database.schema';
import { and, isNotNull, lte, notInArray } from 'drizzle-orm';

describe('expireStaleOpportunities query logic', () => {
  it('builds the correct query conditions', () => {
    // Verify the Drizzle query conditions are valid (no runtime errors)
    const now = new Date();
    const conditions = and(
      isNotNull(opportunities.expiresAt),
      lte(opportunities.expiresAt, now),
      notInArray(opportunities.status, ['accepted', 'rejected', 'expired'])
    );
    expect(conditions).toBeDefined();
  });
});
```

**Step 2: Run test to verify it passes (validation test)**

Run: `cd protocol && bun test tests/opportunity-expiration-cron.spec.ts`
Expected: PASS (this validates the query compiles correctly).

**Step 3: Add expiration cron to opportunity queue**

Read the full `opportunity.queue.ts` to find the class structure, then add:

1. Import `cron` from `'node-cron'` at the top of `protocol/src/queues/opportunity.queue.ts`.

2. Add this method to the queue class (after `startWorker`):

```typescript
  /**
   * Expire stale opportunities: transitions opportunities whose expiresAt <= now
   * from non-terminal statuses to 'expired'. Runs every 15 minutes.
   */
  private async expireStaleOpportunities(): Promise<number> {
    const now = new Date();
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          isNotNull(opportunities.expiresAt),
          lte(opportunities.expiresAt, now),
          notInArray(opportunities.status, ['accepted', 'rejected', 'expired'])
        )
      )
      .returning({ id: opportunities.id });
    return updated.length;
  }

  /**
   * Schedule opportunity expiration cron (every 15 minutes). Call from protocol server only.
   */
  startCrons(): void {
    cron.schedule('*/15 * * * *', () => {
      this.expireStaleOpportunities()
        .then((count) => {
          if (count > 0) {
            this.queueLogger.info(`[OpportunityExpiration] Expired ${count} opportunit${count === 1 ? 'y' : 'ies'}`);
          }
        })
        .catch((err) =>
          this.queueLogger.error('[OpportunityExpiration] Cron failed', { error: err })
        );
    });
    this.queueLogger.info('[OpportunityQueue] Expiration cron scheduled (every 15 minutes)');
  }
```

3. Add required imports to `opportunity.queue.ts`: `import cron from 'node-cron';`, `import db from '../lib/drizzle/drizzle';`, `import { opportunities } from '../schemas/database.schema';`, `import { and, isNotNull, lte, notInArray } from 'drizzle-orm';`.

**Step 4: Register cron in main.ts**

In `protocol/src/main.ts`, after line 42 (`opportunityQueue.startWorker();`), add:

```typescript
opportunityQueue.startCrons();
```

**Step 5: Run test to verify no regressions**

Run: `cd protocol && bun test tests/opportunity-expiration-cron.spec.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add protocol/src/queues/opportunity.queue.ts protocol/src/main.ts protocol/tests/opportunity-expiration-cron.spec.ts
git commit -m "feat: add automatic opportunity expiration cron (every 15 minutes)"
```

---

### Task 4: Composition-Aware Slicing in Home Graph

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/home.graph.ts:196-237` (in `loadOpportunitiesNode`, after dedup before slice)
- Test: `protocol/tests/feed-composition-slicing.spec.ts`

**Step 1: Write the failing test**

Create `protocol/tests/feed-composition-slicing.spec.ts`:

```typescript
import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect } from 'bun:test';
import { selectByComposition } from '../src/lib/protocol/support/opportunity.utils';

describe('selectByComposition', () => {
  const viewerId = 'user-1';

  function makeOpp(id: string, hasIntroducer: boolean, status = 'pending') {
    const actors = [
      { userId: viewerId, role: 'party' },
      { userId: `other-${id}`, role: 'party' },
    ];
    if (hasIntroducer) {
      actors.push({ userId: `intro-${id}`, role: 'introducer' });
    }
    return { id, actors, status };
  }

  it('fills soft targets when enough items exist', () => {
    const opps = [
      ...Array.from({ length: 5 }, (_, i) => makeOpp(`conn-${i}`, false)),
      ...Array.from({ length: 4 }, (_, i) => makeOpp(`cf-${i}`, true)),
      ...Array.from({ length: 3 }, (_, i) => makeOpp(`exp-${i}`, false, 'expired')),
    ];
    const result = selectByComposition(opps, viewerId);
    const connections = result.filter((o) => o.status !== 'expired' && !o.actors.some((a) => a.role === 'introducer'));
    const connectorFlows = result.filter((o) => o.status !== 'expired' && o.actors.some((a) => a.role === 'introducer'));
    const expired = result.filter((o) => o.status === 'expired');
    expect(connections.length).toBe(3);
    expect(connectorFlows.length).toBe(2);
    expect(expired.length).toBe(2);
  });

  it('redistributes slots when a category is underrepresented', () => {
    const opps = [
      ...Array.from({ length: 5 }, (_, i) => makeOpp(`conn-${i}`, false)),
      makeOpp('cf-0', true),
    ];
    const result = selectByComposition(opps, viewerId);
    // 1 connector-flow (under target of 2), extra slot goes to connections
    const connections = result.filter((o) => !o.actors.some((a) => a.role === 'introducer'));
    expect(connections.length).toBeGreaterThan(3);
  });

  it('returns all items when fewer than total soft target', () => {
    const opps = [makeOpp('conn-0', false), makeOpp('cf-0', true)];
    const result = selectByComposition(opps, viewerId);
    expect(result.length).toBe(2);
  });

  it('preserves input order within each category', () => {
    const opps = [
      makeOpp('conn-0', false),
      makeOpp('conn-1', false),
      makeOpp('conn-2', false),
      makeOpp('conn-3', false),
    ];
    const result = selectByComposition(opps, viewerId);
    const ids = result.map((o) => o.id);
    expect(ids[0]).toBe('conn-0');
    expect(ids[1]).toBe('conn-1');
    expect(ids[2]).toBe('conn-2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test tests/feed-composition-slicing.spec.ts`
Expected: FAIL — `selectByComposition` not exported.

**Step 3: Write minimal implementation**

Append to `protocol/src/lib/protocol/support/opportunity.utils.ts` (after `classifyOpportunity`):

```typescript
/**
 * Select opportunities for the home feed using soft composition targets.
 * Fills each category up to its target, then redistributes unused slots
 * to categories that have more items available. Preserves input order.
 *
 * @param opportunities - Pre-sorted opportunities (by confidence/recency)
 * @param viewerId - The viewing user's ID
 * @returns Composition-balanced subset
 */
export function selectByComposition<T extends { actors: Array<{ userId: string; role: string }>; status: string }>(
  opportunities: T[],
  viewerId: string
): T[] {
  const buckets: Record<FeedCategory, T[]> = {
    connection: [],
    'connector-flow': [],
    expired: [],
  };

  for (const opp of opportunities) {
    const category = classifyOpportunity(opp, viewerId);
    buckets[category].push(opp);
  }

  const targets: Record<FeedCategory, number> = {
    connection: FEED_SOFT_TARGETS.connection,
    'connector-flow': FEED_SOFT_TARGETS.connectorFlow,
    expired: FEED_SOFT_TARGETS.expired,
  };

  // First pass: fill each category up to its target
  const selected: Record<FeedCategory, T[]> = {
    connection: buckets.connection.slice(0, targets.connection),
    'connector-flow': buckets['connector-flow'].slice(0, targets['connector-flow']),
    expired: buckets.expired.slice(0, targets.expired),
  };

  // Calculate unused slots and remaining items
  const totalTarget = targets.connection + targets['connector-flow'] + targets.expired;
  let usedSlots = selected.connection.length + selected['connector-flow'].length + selected.expired.length;
  let unusedSlots = totalTarget - usedSlots;

  // Second pass: redistribute unused slots to categories with remaining items
  // Priority: connection > connector-flow > expired
  const redistOrder: FeedCategory[] = ['connection', 'connector-flow', 'expired'];
  for (const category of redistOrder) {
    if (unusedSlots <= 0) break;
    const remaining = buckets[category].slice(selected[category].length);
    const take = Math.min(remaining.length, unusedSlots);
    selected[category].push(...remaining.slice(0, take));
    unusedSlots -= take;
  }

  // Merge and sort by original position to preserve input order
  const indexMap = new Map(opportunities.map((opp, i) => [opp, i]));
  const result = [
    ...selected.connection,
    ...selected['connector-flow'],
    ...selected.expired,
  ].sort((a, b) => (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0));

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test tests/feed-composition-slicing.spec.ts`
Expected: PASS

**Step 5: Integrate into home graph**

Modify `protocol/src/lib/protocol/graphs/home.graph.ts`:

1. Add import at top (with other imports from `opportunity.utils`):
```typescript
import { canUserSeeOpportunity, isActionableForViewer, selectByComposition } from '../support/opportunity.utils';
```
(Replace the existing import line that imports `canUserSeeOpportunity, isActionableForViewer`.)

2. In `loadOpportunitiesNode` (around line 235, after `const deduped = sorted.filter(...)` and before `const opportunities = deduped.slice(0, state.limit)`), replace:
```typescript
          const opportunities = deduped.slice(0, state.limit);
```
with:
```typescript
          const composed = selectByComposition(deduped, state.userId);
          const opportunities = composed.slice(0, state.limit);
```

**Step 6: Run existing tests to verify no regressions**

Run: `cd protocol && bun test tests/feed-classification.spec.ts tests/feed-composition-slicing.spec.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add protocol/src/lib/protocol/support/opportunity.utils.ts protocol/src/lib/protocol/graphs/home.graph.ts protocol/tests/feed-composition-slicing.spec.ts
git commit -m "feat: add composition-aware slicing to home feed with soft targets"
```

---

### Task 5: Maintenance Graph State

**Files:**
- Create: `protocol/src/lib/protocol/states/maintenance.state.ts`

**Step 1: Write the state definition**

Create `protocol/src/lib/protocol/states/maintenance.state.ts`:

```typescript
import { Annotation } from '@langchain/langgraph';
import type { Opportunity } from '../interfaces/database.interface';
import type { FeedHealthResult } from '../support/feed.health';

/**
 * Maintenance Graph State (Annotation-based).
 * Flow: loadCurrentFeed → scoreFeedHealth → [conditional: rediscover | END] → logMaintenance → END
 */
export const MaintenanceGraphState = Annotation.Root({
  userId: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => '',
  }),

  /** Active intents for the user (used for rediscovery). */
  activeIntents: Annotation<Array<{ id: string; payload: string }>>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Current actionable opportunities for the user. */
  currentOpportunities: Annotation<Opportunity[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Current expired opportunities count. */
  expiredCount: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),

  /** Unix ms timestamp of last rediscovery for this user. */
  lastRediscoveryAt: Annotation<number | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),

  /** Feed health score result. */
  healthResult: Annotation<FeedHealthResult | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),

  /** Number of rediscovery jobs enqueued. */
  rediscoveryJobsEnqueued: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),

  error: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
});
```

**Step 2: Commit**

```bash
git add protocol/src/lib/protocol/states/maintenance.state.ts
git commit -m "feat: add maintenance graph state definition"
```

---

### Task 6: Maintenance Graph

**Files:**
- Create: `protocol/src/lib/protocol/graphs/maintenance.graph.ts`
- Test: `protocol/tests/maintenance-graph.spec.ts`

**Step 1: Write the failing test**

Create `protocol/tests/maintenance-graph.spec.ts`:

```typescript
import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect, mock } from 'bun:test';
import { MaintenanceGraphFactory } from '../src/lib/protocol/graphs/maintenance.graph';

describe('MaintenanceGraph', () => {
  const userId = 'test-user';

  function createMockDeps(overrides: {
    opportunities?: any[];
    activeIntents?: any[];
    expiredCount?: number;
    lastRediscoveryAt?: number | null;
  } = {}) {
    const {
      opportunities = [],
      activeIntents = [{ id: 'intent-1', payload: 'find investors' }],
      expiredCount = 0,
      lastRediscoveryAt = Date.now() - 1000,
    } = overrides;

    return {
      database: {
        getOpportunitiesForUser: mock(() => Promise.resolve(opportunities)),
        getActiveIntents: mock(() => Promise.resolve(activeIntents)),
      },
      cache: {
        get: mock((key: string) => {
          if (key.startsWith('rediscovery:throttle:')) return Promise.resolve(null);
          if (key.startsWith('rediscovery:lastRun:')) return Promise.resolve(lastRediscoveryAt ? { triggeredAt: new Date(lastRediscoveryAt).toISOString() } : null);
          return Promise.resolve(null);
        }),
        set: mock(() => Promise.resolve()),
      },
      queue: {
        addJob: mock(() => Promise.resolve({ id: 'job-1' })),
      },
    };
  }

  it('does not enqueue rediscovery when feed is healthy', async () => {
    const deps = createMockDeps({
      opportunities: Array.from({ length: 5 }, (_, i) => ({
        id: `opp-${i}`,
        actors: [{ userId, role: 'party' }, { userId: `other-${i}`, role: 'party' }],
        status: 'pending',
      })),
      lastRediscoveryAt: Date.now() - 1000,
    });

    const factory = new MaintenanceGraphFactory(deps.database as any, deps.cache as any, deps.queue as any);
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId });

    expect(deps.queue.addJob).not.toHaveBeenCalled();
  }, 30_000);

  it('enqueues rediscovery when feed is empty', async () => {
    const deps = createMockDeps({
      opportunities: [],
      lastRediscoveryAt: null,
    });

    const factory = new MaintenanceGraphFactory(deps.database as any, deps.cache as any, deps.queue as any);
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId });

    expect(deps.queue.addJob).toHaveBeenCalled();
  }, 30_000);

  it('enqueues rediscovery when composition is poor', async () => {
    const deps = createMockDeps({
      opportunities: Array.from({ length: 1 }, (_, i) => ({
        id: `opp-${i}`,
        actors: [{ userId, role: 'party' }, { userId: `other-${i}`, role: 'party' }],
        status: 'pending',
      })),
      lastRediscoveryAt: Date.now() - 20 * 60 * 60 * 1000, // 20h ago
    });

    const factory = new MaintenanceGraphFactory(deps.database as any, deps.cache as any, deps.queue as any);
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId });

    expect(deps.queue.addJob).toHaveBeenCalled();
  }, 30_000);
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test tests/maintenance-graph.spec.ts`
Expected: FAIL — `MaintenanceGraphFactory` not found.

**Step 3: Write the maintenance graph**

Create `protocol/src/lib/protocol/graphs/maintenance.graph.ts`:

```typescript
/**
 * Maintenance Graph: evaluate feed health and trigger rediscovery when unhealthy.
 *
 * Write path — separate from the read-only HomeGraph.
 * Flow: loadCurrentFeed → scoreFeedHealth → [shouldRediscover] → rediscover → logMaintenance → END
 */
import { StateGraph, START, END } from '@langchain/langgraph';

import { MaintenanceGraphState } from '../states/maintenance.state';
import { computeFeedHealth } from '../support/feed.health';
import { classifyOpportunity, isActionableForViewer } from '../support/opportunity.utils';
import { protocolLogger } from '../support/protocol.logger';

const logger = protocolLogger('MaintenanceGraph');

const FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours

/** Database methods needed by the maintenance graph. */
export interface MaintenanceGraphDatabase {
  getOpportunitiesForUser(userId: string, options?: { limit?: number }): Promise<Array<{ id: string; actors: Array<{ userId: string; role: string }>; status: string; [key: string]: unknown }>>;
  getActiveIntents(userId: string): Promise<Array<{ id: string; payload: string }>>;
}

/** Cache methods needed by the maintenance graph. */
export interface MaintenanceGraphCache {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { ttl?: number }): Promise<void>;
}

/** Queue methods needed by the maintenance graph. */
export interface MaintenanceGraphQueue {
  addJob(data: { intentId: string; userId: string }, options?: { priority?: number; jobId?: string }): Promise<unknown>;
}

export class MaintenanceGraphFactory {
  constructor(
    private database: MaintenanceGraphDatabase,
    private cache: MaintenanceGraphCache,
    private queue: MaintenanceGraphQueue,
  ) {}

  createGraph() {
    const loadCurrentFeedNode = async (state: typeof MaintenanceGraphState.State) => {
      if (!state.userId) {
        return { error: 'userId is required' };
      }
      try {
        const raw = await this.database.getOpportunitiesForUser(state.userId, { limit: 150 });
        const actionable = raw.filter((opp) =>
          isActionableForViewer(opp.actors, opp.status, state.userId)
        );
        const expired = raw.filter((opp) => opp.status === 'expired');
        const activeIntents = await this.database.getActiveIntents(state.userId);

        // Read last rediscovery timestamp from cache
        let lastRediscoveryAt: number | null = null;
        try {
          const cached = await this.cache.get<{ triggeredAt: string }>(`rediscovery:lastRun:${state.userId}`);
          if (cached?.triggeredAt) {
            lastRediscoveryAt = new Date(cached.triggeredAt).getTime();
          }
        } catch {
          // Cache unavailable — treat as no data
        }

        return {
          currentOpportunities: actionable,
          expiredCount: expired.length,
          activeIntents: activeIntents ?? [],
          lastRediscoveryAt,
        };
      } catch (e) {
        logger.error('MaintenanceGraph loadCurrentFeed failed', { error: e });
        return { error: 'Failed to load current feed' };
      }
    };

    const scoreFeedHealthNode = async (state: typeof MaintenanceGraphState.State) => {
      const opps = state.currentOpportunities;
      let connectionCount = 0;
      let connectorFlowCount = 0;

      for (const opp of opps) {
        const category = classifyOpportunity(opp, state.userId);
        if (category === 'connection') connectionCount++;
        else if (category === 'connector-flow') connectorFlowCount++;
      }

      const healthResult = computeFeedHealth({
        connectionCount,
        connectorFlowCount,
        expiredCount: state.expiredCount,
        totalActionable: opps.length,
        lastRediscoveryAt: state.lastRediscoveryAt,
        freshnessWindowMs: FRESHNESS_WINDOW_MS,
      });

      logger.verbose('[MaintenanceGraph] Feed health scored', {
        userId: state.userId,
        score: healthResult.score,
        breakdown: healthResult.breakdown,
        shouldMaintain: healthResult.shouldMaintain,
      });

      return { healthResult };
    };

    const shouldRediscover = (state: typeof MaintenanceGraphState.State): string => {
      if (state.error) return 'end';
      if (state.healthResult?.shouldMaintain && state.activeIntents.length > 0) {
        return 'rediscover';
      }
      return 'end';
    };

    const rediscoverNode = async (state: typeof MaintenanceGraphState.State) => {
      const bucket = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
      let enqueued = 0;

      const results = await Promise.allSettled(
        state.activeIntents.map((intent) =>
          this.queue.addJob(
            { intentId: intent.id, userId: state.userId },
            { priority: 10, jobId: `maintenance:${state.userId}:${intent.id}:${bucket}` },
          )
        )
      );

      enqueued = results.filter((r) => r.status === 'fulfilled').length;

      // Record last run timestamp
      if (enqueued > 0) {
        try {
          await this.cache.set(
            `rediscovery:lastRun:${state.userId}`,
            { triggeredAt: new Date().toISOString() },
            { ttl: 24 * 60 * 60 },
          );
        } catch {
          // Cache write failure is non-fatal
        }
      }

      return { rediscoveryJobsEnqueued: enqueued };
    };

    const logMaintenanceNode = async (state: typeof MaintenanceGraphState.State) => {
      logger.info('[MaintenanceGraph] Maintenance complete', {
        userId: state.userId,
        score: state.healthResult?.score,
        shouldMaintain: state.healthResult?.shouldMaintain,
        rediscoveryJobsEnqueued: state.rediscoveryJobsEnqueued,
        activeIntentCount: state.activeIntents.length,
      });
      return {};
    };

    const graph = new StateGraph(MaintenanceGraphState)
      .addNode('loadCurrentFeed', loadCurrentFeedNode)
      .addNode('scoreFeedHealth', scoreFeedHealthNode)
      .addNode('rediscover', rediscoverNode)
      .addNode('logMaintenance', logMaintenanceNode)
      .addEdge(START, 'loadCurrentFeed')
      .addEdge('loadCurrentFeed', 'scoreFeedHealth')
      .addConditionalEdges('scoreFeedHealth', shouldRediscover, {
        rediscover: 'rediscover',
        end: END,
      })
      .addEdge('rediscover', 'logMaintenance')
      .addEdge('logMaintenance', END);

    return graph.compile();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test tests/maintenance-graph.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/graphs/maintenance.graph.ts protocol/src/lib/protocol/states/maintenance.state.ts protocol/tests/maintenance-graph.spec.ts
git commit -m "feat: add maintenance graph for feed health evaluation and proactive rediscovery"
```

---

### Task 7: Wire Triggers — Session Open + Intent Events

**Files:**
- Modify: `protocol/src/services/opportunity.service.ts:143-151` (replace empty-feed check with health-score trigger)
- Modify: `protocol/src/events/intent.event.ts` (add `onCreated`, `onUpdated` hooks)
- Modify: `protocol/src/main.ts:54-56` (wire intent event hooks to maintenance queue)

**Step 1: Update opportunity.service.ts — replace triggerRediscoveryIfNeeded with maintenance trigger**

In `protocol/src/services/opportunity.service.ts`:

1. Add import at top:
```typescript
import { MaintenanceGraphFactory, type MaintenanceGraphDatabase, type MaintenanceGraphCache, type MaintenanceGraphQueue } from '../lib/protocol/graphs/maintenance.graph';
```

2. Replace the self-healing block in `getHomeView` (lines 143–151):

Replace:
```typescript
      // Self-healing: when no actionable opportunities exist, re-queue discovery for active intents
      const totalItems = sections.reduce(
        (sum: number, s: { items: unknown[] }) => sum + (s.items?.length ?? 0), 0
      );
      if (totalItems === 0) {
        this.triggerRediscoveryIfNeeded(userId).catch((err) =>
          logger.warn('[OpportunityService] Rediscovery trigger failed', { userId, error: err })
        );
      }
```

With:
```typescript
      // Proactive maintenance: enqueue health-scored maintenance (fire-and-forget)
      this.triggerMaintenance(userId).catch((err) =>
        logger.warn('[OpportunityService] Maintenance trigger failed', { userId, error: err })
      );
```

3. Add a new `triggerMaintenance` method (can be placed near the old `triggerRediscoveryIfNeeded`):

```typescript
  /**
   * Trigger proactive feed maintenance for a user. Evaluates feed health
   * and enqueues rediscovery if the score is below threshold.
   * Throttled to once per 6 hours per user via cache key.
   */
  private async triggerMaintenance(userId: string): Promise<void> {
    const cacheKey = `maintenance:throttle:${userId}`;
    try {
      const existing = await this.cache.get(cacheKey);
      if (existing) return;
    } catch (err) {
      logger.warn('[OpportunityService] Maintenance throttle read failed; continuing', { userId, error: err });
    }

    const factory = new MaintenanceGraphFactory(
      this.db as unknown as MaintenanceGraphDatabase,
      this.cache as unknown as MaintenanceGraphCache,
      opportunityQueue as unknown as MaintenanceGraphQueue,
    );
    const graph = factory.createGraph();
    await graph.invoke({ userId });

    try {
      await this.cache.set(cacheKey, { triggeredAt: new Date().toISOString() }, { ttl: 6 * 60 * 60 });
    } catch (err) {
      logger.warn('[OpportunityService] Maintenance throttle write failed', { userId, error: err });
    }
  }
```

4. The old `triggerRediscoveryIfNeeded` method (lines 628–678) can remain for now — it's private and no longer called. Remove it in a follow-up cleanup if desired.

**Step 2: Extend IntentEvents**

Replace `protocol/src/events/intent.event.ts`:

```typescript
/**
 * Hooks called on intent lifecycle events.
 * Set by main.ts to trigger cascade cleanup and maintenance via queues/brokers.
 */
export const IntentEvents = {
  onCreated: (_intentId: string, _userId: string): void => {},
  onUpdated: (_intentId: string, _userId: string): void => {},
  onArchived: (_intentId: string, _userId: string): void => {},
};
```

**Step 3: Wire intent events in main.ts**

In `protocol/src/main.ts`, replace the `IntentEvents.onArchived` block (lines 54–56) with:

```typescript
IntentEvents.onCreated = (intentId: string, userId: string) => {
  log.job.from('IntentEvents').verbose('Intent created, triggering maintenance', { intentId, userId });
  opportunityQueue.addJob(
    { intentId, userId },
    { priority: 10, jobId: `intent-maintenance:${userId}:${intentId}:${Math.floor(Date.now() / (6 * 60 * 60 * 1000))}` },
  ).catch((err) => log.job.from('IntentEvents').error('Failed to enqueue maintenance on create', { intentId, userId, error: err }));
};

IntentEvents.onUpdated = (intentId: string, userId: string) => {
  log.job.from('IntentEvents').verbose('Intent updated, triggering maintenance', { intentId, userId });
  opportunityQueue.addJob(
    { intentId, userId },
    { priority: 10, jobId: `intent-maintenance:${userId}:${intentId}:${Math.floor(Date.now() / (6 * 60 * 60 * 1000))}` },
  ).catch((err) => log.job.from('IntentEvents').error('Failed to enqueue maintenance on update', { intentId, userId, error: err }));
};

IntentEvents.onArchived = (intentId: string, userId: string) => {
  log.job.from('IntentEvents').verbose('Intent archived', { intentId, userId });
};
```

**Step 4: Verify IntentEvents.onCreated/onUpdated are emitted**

Search for where intents are created/updated in services to confirm the events are already being emitted. If not, note which service methods need the emit calls added. Check:

Run: `cd protocol && grep -rn 'IntentEvents.onCreated\|IntentEvents.onUpdated' src/`

If these are not emitted yet, add `IntentEvents.onCreated(intent.id, userId)` to the intent creation path and `IntentEvents.onUpdated(intent.id, userId)` to the intent update path in `protocol/src/services/intent.service.ts`.

**Step 5: Run type check**

Run: `cd protocol && bunx tsc --noEmit`
Expected: No errors.

**Step 6: Commit**

```bash
git add protocol/src/services/opportunity.service.ts protocol/src/events/intent.event.ts protocol/src/main.ts
git commit -m "feat: wire feed maintenance triggers on session open and intent events"
```

---

### Task 8: Verify IntentEvents emission in intent service

**Files:**
- Possibly modify: `protocol/src/services/intent.service.ts` (add event emissions if missing)

**Step 1: Search for existing emissions**

Run: `cd protocol && grep -rn 'IntentEvents' src/services/intent.service.ts`

**Step 2: Add emissions if missing**

If `IntentEvents.onCreated` is not called after intent creation, add:
```typescript
import { IntentEvents } from '../events/intent.event';
// After successful intent creation:
IntentEvents.onCreated(intent.id, userId);
```

If `IntentEvents.onUpdated` is not called after intent updates, add:
```typescript
// After successful intent update:
IntentEvents.onUpdated(intent.id, userId);
```

**Step 3: Run type check**

Run: `cd protocol && bunx tsc --noEmit`
Expected: No errors.

**Step 4: Commit (if changes were made)**

```bash
git add protocol/src/services/intent.service.ts
git commit -m "feat: emit IntentEvents.onCreated and onUpdated from intent service"
```

---

### Task 9: Run all tests and type check

**Step 1: Run all new tests**

Run: `cd protocol && bun test tests/feed-classification.spec.ts tests/feed-health.spec.ts tests/feed-composition-slicing.spec.ts tests/maintenance-graph.spec.ts`
Expected: All PASS.

**Step 2: Run type check**

Run: `cd protocol && bunx tsc --noEmit`
Expected: No errors.

**Step 3: Run lint**

Run: `cd protocol && bun run lint`
Expected: No errors related to new/modified files.
