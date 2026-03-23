# Feed Health & Proactive Maintenance Design

**Issue**: [IND-193](https://linear.app/indexnetwork/issue/IND-193/agent-wake-up-cap-feed-3-connections-2-connector-initiators-max-2)
**Date**: 2026-03-23

## Problem

The home feed has no composition awareness — it shows whatever opportunities exist without regard for balance. Self-healing only triggers on a completely empty feed. Opportunity expiration is manual (CLI only). Active users can see degraded feeds with no automatic recovery.

## Design

### 1. Feed Health Score

**File**: `protocol/src/lib/protocol/support/feed.health.ts`

Pure function, no LLM. Takes current feed state, returns a 0–1 score.

**Inputs**:
- List of actionable opportunities (with actor roles, statuses)
- Timestamp of last rediscovery for this user
- Count of recently expired items

**Sub-scores** (each 0–1, weighted):

| Factor | Weight | Logic |
|--------|--------|-------|
| Composition fit | 0.4 | How close to soft targets (~3 connections, ~2 connector-flow, ≤2 expired). Penalize when a category is over/under-represented |
| Freshness | 0.3 | Decays linearly from 1.0 → 0.0 over a configurable window (e.g. 12h since last rediscovery) |
| Expiration ratio | 0.3 | `1 - (expiredCount / totalCount)`. All expired = 0, none expired = 1 |

**Output**:
```typescript
{
  score: number;
  breakdown: { composition: number; freshness: number; expirationRatio: number };
  shouldMaintain: boolean; // score < threshold (default 0.5)
}
```

### 2. Opportunity Classification

**File**: `protocol/src/lib/protocol/support/opportunity.utils.ts` (extend existing)

Classifies actionable opportunities into feed categories. Only receives opportunities that already passed `isActionableForViewer`.

```typescript
type FeedCategory = 'connection' | 'connector-flow' | 'expired';
```

**Rules**:
- `expired` → `status === 'expired'`
- `connector-flow` → has an actor with `role: 'introducer'`, and is actionable
- `connection` → no introducer, and is actionable

Accepted, rejected, draft, and other non-actionable statuses are filtered out before classification.

**Soft targets** (exported constants):
```typescript
const FEED_SOFT_TARGETS = {
  connection: 3,
  connectorFlow: 2,
  expired: 2,
};
```

### 3. Maintenance Graph

**Files**: `protocol/src/lib/protocol/graphs/maintenance.graph.ts` + `protocol/src/lib/protocol/states/maintenance.state.ts`

Write path — evaluate feed health, rediscover if needed. Separate from the read-only home graph.

**State**: `userId`, `activeIntents[]`, `currentOpportunities[]`, `healthScore` + breakdown, `rediscoveryResults[]`, `error?`

**Nodes**:
1. **loadCurrentFeed** — fetch actionable opportunities + last rediscovery timestamp + expired count
2. **scoreFeedHealth** — call `computeFeedHealth()` from `feed.health.ts`
3. **conditional: shouldRediscover** — if `shouldMaintain === true` → rediscover; otherwise → END
4. **rediscover** — enqueue discovery jobs for user's active intents (reuse existing `opportunity.queue` pattern)
5. **logMaintenance** — log health score, breakdown, and actions taken

**Factory**: `MaintenanceGraphFactory(database, cache, queue)` — DI, no hardcoded dependencies.

Does NOT delete, re-rank, or mutate existing opportunities. Only triggers new discovery when the feed is unhealthy.

### 4. Triggers

Two entry points invoke the maintenance graph:

#### A. Session open (home view request)

In `opportunity.service.ts` `getHomeView()` — after building the home view, compute feed health score. If `shouldMaintain === true`, enqueue a maintenance job (fire-and-forget). Don't block the response. User sees whatever the current feed has; maintenance runs in the background.

**Replaces** the current `triggerRediscoveryIfNeeded` (empty-feed-only check). The health score subsumes it — an empty feed scores 0.

#### B. Intent change (event-driven)

Hook into `IntentEvents.onCreated`, `IntentEvents.onUpdated`, `IntentEvents.onArchived` — enqueue a maintenance job for that user.

**Throttling**: Both paths use bucketed job IDs (reuse existing `rediscovery:{userId}:{intentId}:{6hBucket}` pattern) to avoid duplicate work.

### 5. Opportunity Expiration Cron

**File**: `protocol/src/queues/opportunity.queue.ts` (extend existing)

BullMQ repeatable job, registered in `opportunityQueue.startCrons()` called from `main.ts` (same pattern as `hydeQueue.startCrons()`).

**Schedule**: Every 15 minutes.

**Handler**:
1. Query opportunities where `expiresAt <= now()` AND `status NOT IN ('accepted', 'rejected', 'expired')`
2. Batch update `status = 'expired'`, `updatedAt = now()`
3. Log count of transitioned opportunities

Reuses logic from existing `expire-opportunities.ts` CLI.

### 6. Home Graph — Composition-Aware Slicing

**File**: `protocol/src/lib/protocol/graphs/home.graph.ts` — modify `loadOpportunitiesNode`

After existing dedup and sort, add composition-aware selection before slicing to `state.limit`:

1. Classify all deduped opportunities using `classifyOpportunity()`
2. Fill buckets using soft targets: pick ~3 connections, ~2 connector-flow, ~2 expired
3. If a bucket is underrepresented, redistribute slots to other buckets
4. Within each bucket, preserve existing confidence + recency sort order

Everything downstream (presenter, categorizer, normalizer) stays unchanged.
