# Fix Empty Discover Page (IND-183) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Fix the discover/home page showing zero opportunities when a user has 121 opportunities (84 draft, 37 expired) by fixing the enricher status resolution bug and adding a re-discovery mechanism for stale intents.

**Architecture:** Two-part fix: (1) Fix `resolveEnrichedStatus` in the opportunity enricher so broker-created `latent` opportunities are not downgraded to `draft` when merging with existing chat drafts. (2) Add a throttled re-discovery trigger in `OpportunityService.getHomeView()` that re-queues opportunity discovery for users with active intents but zero actionable opportunities.

**Tech Stack:** TypeScript, Bun test, BullMQ (opportunity queue), Redis (throttle cache)

---

### Task 1: Fix enricher status resolution — test

**Files:**
- Modify: `protocol/src/lib/protocol/support/tests/opportunity.enricher.spec.ts`

**Step 1: Write the failing test**

Add a new test after the existing draft-preserving tests (after line 371):

```typescript
test('when incoming status is latent and enrichment merges with draft, resolved status stays latent (broker should not be downgraded by chat draft)', async () => {
  const sharedIntent = MEANINGFUL.intentIds.aliceMlCofounder;
  const existing = existingOpportunity(
    'opp-draft',
    [
      { indexId: 'idx-1', userId: 'user-a', role: 'agent', intent: sharedIntent },
      { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
    ],
    'Short.',
    // Note: existingOpportunity helper doesn't support 'draft' in the status union.
    // We need to cast or update the helper. See Step 1b.
  );
  // Force draft status on the existing opportunity
  (existing as any).status = 'draft';
  const db = { findOverlappingOpportunities: async () => [existing] };
  const embedder = { generate: async () => [] } as unknown as Embedder;
  const newData: CreateOpportunityData = {
    ...minimalNewData(['user-a', 'user-b'], 'idx-1', 'Hi'),
    status: 'latent',
    actors: [
      { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: sharedIntent },
      { indexId: 'idx-1', userId: 'user-b', role: 'party' },
    ],
  };
  const result = await enrichOrCreate(db, embedder, newData);
  expect(result.enriched).toBe(true);
  if (result.enriched) {
    expect(result.expiredIds).toEqual(['opp-draft']);
    // Key assertion: incoming latent should NOT be downgraded to draft
    expect(result.resolvedStatus).toBe('latent');
  }
});
```

**Step 1b: Update `existingOpportunity` helper to accept `'draft'` status**

The helper's status parameter type is `'latent' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired'`. Add `'draft'` to the union:

```typescript
function existingOpportunity(
  id: string,
  actors: Array<{ indexId: string; userId: string; role: string; intent?: string }>,
  reasoning: string,
  status: 'latent' | 'draft' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired' = 'pending'
): Opportunity {
```

Then the test can use `'draft'` directly instead of casting.

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/lib/protocol/support/tests/opportunity.enricher.spec.ts`
Expected: FAIL — the new test expects `resolvedStatus` to be `'latent'` but gets `'draft'`

---

### Task 2: Fix enricher status resolution — implementation

**Files:**
- Modify: `protocol/src/lib/protocol/support/opportunity.enricher.ts:66-73`

**Step 1: Fix `resolveEnrichedStatus`**

Change line 71 from:
```typescript
if (incomingStatus === 'draft' || statuses.includes('draft')) return 'draft';
```
to:
```typescript
if (incomingStatus === 'draft') return 'draft';
```

And update the JSDoc comment (lines 58-65) to reflect the new behavior:

```typescript
/**
 * Resolve enriched opportunity status from related opportunities' statuses and the incoming status.
 * Priority: accepted > pending > rejected > draft (only when incoming is draft) > latent.
 * The incoming status is included so we do not wrongly downgrade when the new opportunity has a higher-priority status.
 * When incoming is 'draft' (e.g. from in-chat discovery), we preserve draft so the opportunity stays chat-only and
 * does not appear on the home view (home excludes draft).
 * When incoming is NOT draft (e.g. 'latent' from the background broker), existing draft status does NOT contaminate
 * the result — the broker-created opportunity retains its own status and can appear on the home view.
 */
```

**Step 2: Run test to verify it passes**

Run: `cd protocol && bun test src/lib/protocol/support/tests/opportunity.enricher.spec.ts`
Expected: ALL PASS (including the new test from Task 1)

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/support/opportunity.enricher.ts protocol/src/lib/protocol/support/tests/opportunity.enricher.spec.ts
git commit -m "fix: enricher no longer downgrades latent→draft when merging with existing drafts

When the background broker creates a latent opportunity that overlaps with an
existing chat draft, the enricher previously returned 'draft' (because
statuses.includes('draft') matched). This meant broker-discovered opportunities
could never appear on the home page if the user had already found that
counterpart in chat.

Now only the INCOMING status is checked for draft, so broker latent
opportunities stay latent and correctly appear on the home view.

Fixes IND-183"
```

---

### Task 3: Add re-discovery trigger for stale intents — implementation

When the home view returns 0 actionable opportunities but the user has active intents and expired opportunities, the system should automatically re-queue discovery. This self-healing mechanism ensures the discover page repopulates after opportunities expire.

**Files:**
- Modify: `protocol/src/services/opportunity.service.ts`

**Step 1: Add throttled re-discovery logic to `getHomeView`**

After the home graph invocation returns, check if the result has 0 sections/items but the user has active intents. If so, enqueue re-discovery (throttled by a cache key).

At the top of the file, add the import:
```typescript
import { opportunityQueue } from '../queues/opportunity.queue';
```

In the `getHomeView` method, after line ~140 (after `result.sections` check), add:

```typescript
// Self-healing: when no actionable opportunities exist, re-queue discovery for active intents
const totalItems = (result.sections ?? []).reduce(
  (sum: number, s: { items: unknown[] }) => sum + (s.items?.length ?? 0), 0
);
if (totalItems === 0) {
  this.triggerRediscoveryIfNeeded(userId).catch((err) =>
    logger.warn('[OpportunityService] Rediscovery trigger failed', { userId, error: err })
  );
}
```

Add a new private method:

```typescript
/**
 * Re-queue opportunity discovery for a user's active intents when no actionable
 * opportunities exist. Throttled to once per 6 hours per user via cache key.
 */
private async triggerRediscoveryIfNeeded(userId: string): Promise<void> {
  const cacheKey = `rediscovery:throttle:${userId}`;
  const existing = await this.cache.get(cacheKey);
  if (existing) return; // Already triggered recently

  const activeIntents = await (this.db as any).getActiveIntents(userId);
  if (!activeIntents?.length) return;

  // Mark as triggered (6-hour cooldown)
  await this.cache.set(cacheKey, { triggeredAt: new Date().toISOString() }, { ttl: 6 * 60 * 60 });

  logger.info('[OpportunityService] Triggering rediscovery for stale user', {
    userId,
    intentCount: activeIntents.length,
  });

  // Enqueue discovery for each active intent
  for (const intent of activeIntents) {
    await opportunityQueue.addJob(
      { intentId: intent.id, userId },
      { priority: 10 } // Lower priority than user-triggered discovery
    ).catch((err) =>
      logger.warn('[OpportunityService] Failed to enqueue rediscovery job', {
        userId,
        intentId: intent.id,
        error: err,
      })
    );
  }
}
```

**Step 2: Verify `getActiveIntents` is available on the database interface**

Check that `OpportunityControllerDatabase` (or `HomeGraphDatabase`) exposes `getActiveIntents`. If not, it needs to be added.

Search: `grep -n 'getActiveIntents' protocol/src/lib/protocol/interfaces/database.interface.ts`

If not present on `OpportunityControllerDatabase`, add it or cast through the adapter (the `ChatDatabaseAdapter` already implements it).

**Step 3: Run the protocol dev server to verify no type errors**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add protocol/src/services/opportunity.service.ts
git commit -m "feat: trigger re-discovery when home view has zero actionable opportunities

When getHomeView returns an empty result for a user who has active intents,
automatically re-queue opportunity discovery jobs (throttled to once per 6h
per user). This self-healing mechanism ensures the discover page repopulates
after all existing opportunities expire.

Refs IND-183"
```

---

### Task 4: Type check and final verification

**Step 1: Run type checker**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors

**Step 2: Run enricher tests**

Run: `cd protocol && bun test src/lib/protocol/support/tests/opportunity.enricher.spec.ts`
Expected: ALL PASS

**Step 3: Run any home graph tests if they exist**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/home.graph.spec.ts`
Expected: ALL PASS (or skip if tests require live DB/Redis)

---

## Summary

| Task | What | File(s) |
|------|------|---------|
| 1 | Add failing test for latent→draft downgrade | `opportunity.enricher.spec.ts` |
| 2 | Fix `resolveEnrichedStatus` to not downgrade latent | `opportunity.enricher.ts` |
| 3 | Add throttled re-discovery in home view | `opportunity.service.ts` |
| 4 | Type check + test verification | — |

**Root cause:** `resolveEnrichedStatus` checked `statuses.includes('draft')` which includes existing (related) opportunity statuses. When a broker `latent` opportunity was enriched with an existing chat `draft`, the result was `draft` — making it invisible on the home page.

**Fix:** Only check `incomingStatus === 'draft'` (the new opportunity's status), not existing related statuses.

**Self-healing:** When the home page is empty but the user has active intents, re-queue discovery jobs (throttled) so the pipeline eventually produces fresh actionable opportunities.
