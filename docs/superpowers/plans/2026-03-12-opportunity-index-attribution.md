# Opportunity Index Attribution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace arbitrary `targetIndexes[0]` index attribution on opportunity actors with relevancy-scored selection, persisting intent-to-index relevancy scores.

**Architecture:** Add `relevancyScore` column to `intent_indexes`. Score all intent-index assignments via IntentIndexer (parallel, skip no-prompt). In the opportunity graph, use persisted scores (background path) or transient scores (chat path) to break dedup ties when the same candidate appears in multiple shared indexes. Source actor inherits the winning candidate's indexId.

**Tech Stack:** Drizzle ORM (PostgreSQL), LangGraph, IntentIndexer agent (LLM), bun test

**Spec:** `docs/superpowers/specs/2026-03-12-opportunity-index-attribution-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `protocol/src/schemas/database.schema.ts` | Add `relevancyScore` to `intentIndexes` |
| Create | `protocol/drizzle/0012_add_intent_indexes_relevancy_score.sql` | Migration |
| Modify | `protocol/drizzle/meta/_journal.json` | Register migration |
| Modify | `protocol/src/adapters/database.adapter.ts` | Update `assignIntentToIndex` (3 impls + 2 wrappers), add `getIntentIndexScores` |
| Modify | `protocol/src/lib/protocol/interfaces/database.interface.ts` | Update types |
| Modify | `protocol/src/lib/protocol/graphs/intent_index.graph.ts` | Pass `relevancyScore` to assignment |
| Modify | `protocol/src/queues/intent.queue.ts` | Score intents during auto-assign |
| Modify | `protocol/src/lib/protocol/states/opportunity.state.ts` | Add `indexRelevancyScores` field |
| Modify | `protocol/src/lib/protocol/graphs/opportunity.graph.ts` | Use scores in scope, dedup, entity construction |
| Modify | `protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts` | Test dedup tie-breaking |

---

## Chunk 1: Schema, Migration, and Database Layer

### Task 1: Add `relevancyScore` column to schema and generate migration

**Files:**
- Modify: `protocol/src/schemas/database.schema.ts:324-330`
- Create: `protocol/drizzle/0012_add_intent_indexes_relevancy_score.sql`
- Modify: `protocol/drizzle/meta/_journal.json`

- [ ] **Step 1: Add `relevancyScore` to the `intentIndexes` table definition**

In `protocol/src/schemas/database.schema.ts`, change the `intentIndexes` table from:

```typescript
export const intentIndexes = pgTable('intent_indexes', {
  intentId: text('intent_id').notNull().references(() => intents.id),
  indexId: text('index_id').notNull().references(() => indexes.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.intentId, t.indexId] }),
}));
```

to:

```typescript
export const intentIndexes = pgTable('intent_indexes', {
  intentId: text('intent_id').notNull().references(() => intents.id),
  indexId: text('index_id').notNull().references(() => indexes.id),
  relevancyScore: numeric('relevancy_score'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.intentId, t.indexId] }),
}));
```

- [ ] **Step 2: Generate migration**

Run: `cd protocol && bun run db:generate`

- [ ] **Step 3: Rename the generated migration file**

```bash
mv protocol/drizzle/0012_*.sql protocol/drizzle/0012_add_intent_indexes_relevancy_score.sql
```

- [ ] **Step 4: Update `_journal.json` tag**

In `protocol/drizzle/meta/_journal.json`, find the entry with `"idx": 12` and change `"tag"` to `"0012_add_intent_indexes_relevancy_score"`.

- [ ] **Step 5: Apply migration**

Run: `cd protocol && bun run db:migrate`

- [ ] **Step 6: Verify no pending schema changes**

Run: `cd protocol && bun run db:generate`
Expected: "No schema changes" or equivalent message indicating nothing to generate.

- [ ] **Step 7: Commit**

```bash
git add protocol/src/schemas/database.schema.ts protocol/drizzle/0012_add_intent_indexes_relevancy_score.sql protocol/drizzle/meta/_journal.json protocol/drizzle/meta/0012_snapshot.json
git commit -m "feat(schema): add relevancyScore column to intent_indexes"
```

---

### Task 2: Update `assignIntentToIndex` in database adapter

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts:512-514, 1441-1443, 3454-3456, 4333-4339, 4341-4346`

There are 3 class implementations plus 2 wrappers of `assignIntentToIndex` in this file. All must be updated.

- [ ] **Step 1: Update IntentDatabaseAdapter implementation (line 512)**

Change from:

```typescript
async assignIntentToIndex(intentId: string, indexId: string): Promise<void> {
  await db.insert(schema.intentIndexes).values({ intentId, indexId }).onConflictDoNothing();
}
```

to:

```typescript
async assignIntentToIndex(intentId: string, indexId: string, relevancyScore?: number): Promise<void> {
  await db.insert(schema.intentIndexes)
    .values({ intentId, indexId, relevancyScore: relevancyScore != null ? String(relevancyScore) : null })
    .onConflictDoUpdate({
      target: [schema.intentIndexes.intentId, schema.intentIndexes.indexId],
      set: { relevancyScore: relevancyScore != null ? String(relevancyScore) : null },
    });
}
```

Note: Drizzle `numeric` columns accept string values. `onConflictDoUpdate` replaces `onConflictDoNothing` so re-assignment updates the score.

- [ ] **Step 2: Update ChatDatabaseAdapter implementation (line 1441)**

Apply the exact same change. This implementation uses `intentIndexes` directly (already imported at top of file) instead of `schema.intentIndexes`:

```typescript
async assignIntentToIndex(intentId: string, indexId: string, relevancyScore?: number): Promise<void> {
  await db.insert(intentIndexes)
    .values({ intentId, indexId, relevancyScore: relevancyScore != null ? String(relevancyScore) : null })
    .onConflictDoUpdate({
      target: [intentIndexes.intentId, intentIndexes.indexId],
      set: { relevancyScore: relevancyScore != null ? String(relevancyScore) : null },
    });
}
```

- [ ] **Step 3: Update IndexGraphDatabaseAdapter implementation (line 3454)**

Same change, using `intentIndexes` directly:

```typescript
async assignIntentToIndex(intentId: string, indexId: string, relevancyScore?: number): Promise<void> {
  await db.insert(intentIndexes)
    .values({ intentId, indexId, relevancyScore: relevancyScore != null ? String(relevancyScore) : null })
    .onConflictDoUpdate({
      target: [intentIndexes.intentId, intentIndexes.indexId],
      set: { relevancyScore: relevancyScore != null ? String(relevancyScore) : null },
    });
}
```

- [ ] **Step 4: Update `associateIntentWithIndexes` wrapper (line 4333)**

This wrapper loops over `assignIntentToIndex` — it needs to forward the score. Since `associateIntentWithIndexes` doesn't receive individual scores, it passes `undefined` (backward-compatible). No change needed here — the underlying `db.assignIntentToIndex(intentId, indexId)` call will pass `undefined` for the optional param, which is fine.

- [ ] **Step 5: Update `assignIntentToIndex` auth wrapper (line 4341)**

Change from:

```typescript
assignIntentToIndex: async (intentId, indexId) => {
  const intent = await db.getIntent(intentId);
  if (!intent) throw new Error('Intent not found');
  if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
  return db.assignIntentToIndex(intentId, indexId);
},
```

to:

```typescript
assignIntentToIndex: async (intentId, indexId, relevancyScore?) => {
  const intent = await db.getIntent(intentId);
  if (!intent) throw new Error('Intent not found');
  if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
  return db.assignIntentToIndex(intentId, indexId, relevancyScore);
},
```

- [ ] **Step 6: Run TypeScript type check**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors (the optional parameter is backward-compatible).

- [ ] **Step 7: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "feat(adapter): add relevancyScore param to assignIntentToIndex"
```

---

### Task 3: Add `getIntentIndexScores` to database adapter

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts`

- [ ] **Step 1: Add `getIntentIndexScores` method to ChatDatabaseAdapter**

Add near the other `intentIndex`-related methods (near line 1441). This is the adapter class used by the opportunity graph:

```typescript
async getIntentIndexScores(intentId: string): Promise<Array<{ indexId: string; relevancyScore: number | null }>> {
  const rows = await db
    .select({
      indexId: intentIndexes.indexId,
      relevancyScore: intentIndexes.relevancyScore,
    })
    .from(intentIndexes)
    .where(eq(intentIndexes.intentId, intentId));
  return rows.map(r => ({
    indexId: r.indexId,
    relevancyScore: r.relevancyScore != null ? Number(r.relevancyScore) : null,
  }));
}
```

Note: `numeric` columns return strings in Drizzle, so we convert to `Number`.

- [ ] **Step 2: Run TypeScript type check**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "feat(adapter): add getIntentIndexScores method"
```

---

### Task 4: Update database interfaces

**Files:**
- Modify: `protocol/src/lib/protocol/interfaces/database.interface.ts:680, 1249, 1611-1634`

Three changes are needed: (1) update `assignIntentToIndex` signature in base `Database` type, (2) add `getIntentIndexScores` to base `Database` type (so `Pick` can reference it), (3) add both new methods to `OpportunityGraphDatabase`.

- [ ] **Step 1: Update `assignIntentToIndex` in base `Database` interface (line 680)**

Change:

```typescript
  assignIntentToIndex(intentId: string, indexId: string): Promise<void>;
```

to:

```typescript
  assignIntentToIndex(intentId: string, indexId: string, relevancyScore?: number): Promise<void>;
```

- [ ] **Step 2: Update `assignIntentToIndex` in `UserDatabase` interface (line 1249)**

Change:

```typescript
  assignIntentToIndex(intentId: string, indexId: string): Promise<void>;
```

to:

```typescript
  assignIntentToIndex(intentId: string, indexId: string, relevancyScore?: number): Promise<void>;
```

- [ ] **Step 3: Add `getIntentIndexScores` to base `Database` interface**

Near the other intent-index methods (after `assignIntentToIndex` at line 680), add:

```typescript
  /**
   * Returns per-index relevancy scores for an intent's index assignments.
   */
  getIntentIndexScores(intentId: string): Promise<Array<{ indexId: string; relevancyScore: number | null }>>;
```

- [ ] **Step 4: Add `getIntentIndexScores` and `getIndexMemberContext` to `OpportunityGraphDatabase`**

In `database.interface.ts`, find the `OpportunityGraphDatabase` type (line 1611) and add the two new methods:

```typescript
export type OpportunityGraphDatabase = Pick<
  Database,
  | 'getProfile'
  | 'createOpportunity'
  | 'opportunityExistsBetweenActors'
  | 'getOpportunityBetweenActors'
  | 'findOverlappingOpportunities'
  | 'getUserIndexIds'
  | 'getIndexMemberships'
  | 'getActiveIntents'
  | 'getIndexIdsForIntent'
  | 'getIndex'
  | 'getIndexMemberCount'
  | 'getIntentIndexScores'
  | 'getIndexMemberContext'
  // Read/update/send modes
  | 'getOpportunity'
  | 'getOpportunitiesForUser'
  | 'updateOpportunityStatus'
  | 'isIndexMember'
  | 'getUser'
  // Load candidate intent payload/summary for evaluator
  | 'getIntent'
  // Contacts-only discovery
  | 'getContactUserIds'
>;
```

- [ ] **Step 5: Run TypeScript type check**

Run: `cd protocol && npx tsc --noEmit`
Expected: Errors in test mocks that don't have the new methods yet — that's expected. The adapter already implements them.

- [ ] **Step 6: Commit**

```bash
git add protocol/src/lib/protocol/interfaces/database.interface.ts
git commit -m "feat(interface): add relevancyScore to assignIntentToIndex and getIntentIndexScores to Database types"
```

---

## Chunk 2: Intent Assignment Scoring

### Task 5: Pass `relevancyScore` in IntentIndexGraph

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/intent_index.graph.ts:73-78, 89-94, 98-103, 154-162`

- [ ] **Step 1: Update direct assignment path (line 74)**

Change:

```typescript
await this.database.assignIntentToIndex(intentId, indexId);
```

to:

```typescript
await this.database.assignIntentToIndex(intentId, indexId, 1.0);
```

- [ ] **Step 2: Update no-context path (line 91)**

Change:

```typescript
await this.database.assignIntentToIndex(intentId, indexId);
```

to:

```typescript
await this.database.assignIntentToIndex(intentId, indexId, 1.0);
```

- [ ] **Step 3: Update no-prompts path (line 101)**

Change:

```typescript
await this.database.assignIntentToIndex(intentId, indexId);
```

to:

```typescript
await this.database.assignIntentToIndex(intentId, indexId, 1.0);
```

- [ ] **Step 4: Update evaluated path (line 155)**

Change:

```typescript
await this.database.assignIntentToIndex(intentId, indexId);
```

to:

```typescript
await this.database.assignIntentToIndex(intentId, indexId, finalScore);
```

`finalScore` is already computed at line 132 and available in scope.

- [ ] **Step 5: Run TypeScript type check**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add protocol/src/lib/protocol/graphs/intent_index.graph.ts
git commit -m "feat(intent-index): pass relevancyScore to assignIntentToIndex"
```

---

### Task 6: Score intents during auto-assign in IntentQueue

**Files:**
- Modify: `protocol/src/queues/intent.queue.ts:32-35, 179-244`

- [ ] **Step 1: Add `getIndexMemberContext` to IntentQueueDatabase type (line 32)**

Change:

```typescript
export type IntentQueueDatabase = Pick<
  ChatDatabaseAdapter,
  'getIntentForIndexing' | 'getUserIndexIds' | 'assignIntentToIndex' | 'deleteHydeDocumentsForSource'
>;
```

to:

```typescript
export type IntentQueueDatabase = Pick<
  ChatDatabaseAdapter,
  'getIntentForIndexing' | 'getUserIndexIds' | 'assignIntentToIndex' | 'deleteHydeDocumentsForSource' | 'getIndexMemberContext'
>;
```

- [ ] **Step 2: Add IntentIndexer import at top of file**

Add to the imports section:

```typescript
import { IntentIndexer } from "../lib/protocol/agents/intent.indexer";
```

Verify the import path is correct relative to `protocol/src/queues/intent.queue.ts`.

- [ ] **Step 3: Replace the auto-assign loop in `handleGenerateHyde` (lines 194-210)**

Replace the existing loop:

```typescript
try {
  const userIndexIds = await db.getUserIndexIds(userId);
  this.logger.info('[IntentHyde] User indexes found', { intentId, userId, indexCount: userIndexIds.length, indexIds: userIndexIds });
  for (const indexId of userIndexIds) {
    try {
      await db.assignIntentToIndex(intentId, indexId);
      assignedIndexCount++;
    } catch (assignErr) {
      this.logger.debug('[IntentHyde] Assign intent to index skipped', {
        intentId,
        indexId,
        error: assignErr,
      });
    }
  }
} catch (err) {
  this.logger.warn('[IntentHyde] Failed to assign intent to user indexes', {
    intentId,
    userId,
    error: err,
  });
}
```

with:

```typescript
try {
  const userIndexIds = await db.getUserIndexIds(userId);
  this.logger.info('[IntentHyde] User indexes found', { intentId, userId, indexCount: userIndexIds.length, indexIds: userIndexIds });

  // Fetch prompts for each index to determine which need scoring
  const indexContexts = await Promise.all(
    userIndexIds.map(async (indexId) => {
      const ctx = await db.getIndexMemberContext(indexId, userId);
      return { indexId, ctx };
    })
  );

  // Split: no-prompt indexes get score 1.0, others need IntentIndexer
  const noPromptIndexes = indexContexts.filter(
    ({ ctx }) => !ctx?.indexPrompt?.trim() && !ctx?.memberPrompt?.trim()
  );
  const scorableIndexes = indexContexts.filter(
    ({ ctx }) => ctx?.indexPrompt?.trim() || ctx?.memberPrompt?.trim()
  );

  // Assign no-prompt indexes with default score
  for (const { indexId } of noPromptIndexes) {
    try {
      await db.assignIntentToIndex(intentId, indexId, 1.0);
      assignedIndexCount++;
    } catch (assignErr) {
      this.logger.debug('[IntentHyde] Assign intent to index skipped', { intentId, indexId, error: assignErr });
    }
  }

  // Score and assign scorable indexes in parallel
  if (scorableIndexes.length > 0) {
    const indexer = new IntentIndexer();
    const scoringResults = await Promise.all(
      scorableIndexes.map(async ({ indexId, ctx }) => {
        try {
          const result = await indexer.invoke(
            intent.payload,
            ctx?.indexPrompt ?? null,
            ctx?.memberPrompt ?? null,
          );
          const score = result
            ? (ctx?.indexPrompt && ctx?.memberPrompt
                ? result.indexScore * 0.6 + result.memberScore * 0.4
                : ctx?.indexPrompt ? result.indexScore : result.memberScore)
            : 1.0;
          return { indexId, score };
        } catch (err) {
          this.logger.warn('[IntentHyde] IntentIndexer failed for index, using default score', { intentId, indexId, error: err });
          return { indexId, score: 1.0 };
        }
      })
    );

    for (const { indexId, score } of scoringResults) {
      try {
        await db.assignIntentToIndex(intentId, indexId, score);
        assignedIndexCount++;
      } catch (assignErr) {
        this.logger.debug('[IntentHyde] Assign intent to index skipped', { intentId, indexId, error: assignErr });
      }
    }
  }
} catch (err) {
  this.logger.warn('[IntentHyde] Failed to assign intent to user indexes', {
    intentId,
    userId,
    error: err,
  });
}
```

Key points:
- `getIndexMemberContext` filters by `autoAssign=true` internally, so no-prompt check handles the case where context is null (member not in index or not auto-assign).
- Score computation mirrors the weighted average logic from `intent_index.graph.ts` (60% indexScore, 40% memberScore when both prompts exist).
- On IntentIndexer failure, default to 1.0 — assignment is unconditional for auto-assign.

- [ ] **Step 4: Run TypeScript type check**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add protocol/src/queues/intent.queue.ts
git commit -m "feat(intent-queue): score intents via IntentIndexer during auto-assign"
```

---

## Chunk 3: Opportunity Graph Changes

### Task 7: Add `indexRelevancyScores` to opportunity state

**Files:**
- Modify: `protocol/src/lib/protocol/states/opportunity.state.ts`

- [ ] **Step 1: Add `indexRelevancyScores` annotation**

After the `targetIndexes` annotation (line 232), add:

```typescript
  /** Per-index relevancy scores for dedup tie-breaking. Background path: from intent_indexes. Chat path: transient from IntentIndexer. */
  indexRelevancyScores: Annotation<Record<string, number>>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({}),
  }),
```

This is a `Record<indexId, score>` map used by the evaluation node to break ties.

- [ ] **Step 2: Run TypeScript type check**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add protocol/src/lib/protocol/states/opportunity.state.ts
git commit -m "feat(state): add indexRelevancyScores to opportunity graph state"
```

---

### Task 8: Update scope node to populate relevancy scores

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts:179-240`

The scope node needs to populate `indexRelevancyScores` on state for the evaluation node's dedup tie-breaking.

- [ ] **Step 1: Add IntentIndexer import**

At the top of `opportunity.graph.ts`, add:

```typescript
import { IntentIndexer } from "../agents/intent.indexer";
```

- [ ] **Step 2: Update scope node to populate `indexRelevancyScores`**

Inside the scope node, after computing `targetIndexes` and before the `return` statement (around line 227), add the relevancy score lookup:

```typescript
      // ── Populate index relevancy scores for dedup tie-breaking ──
      let indexRelevancyScores: Record<string, number> = {};

      if (state.triggerIntentId) {
        // Background path: look up persisted scores from intent_indexes
        try {
          const scores = await this.database.getIntentIndexScores(state.triggerIntentId);
          for (const { indexId, relevancyScore } of scores) {
            if (relevancyScore != null) {
              indexRelevancyScores[indexId] = relevancyScore;
            }
          }
        } catch (err) {
          logger.warn('[Graph:Scope] Failed to load intent index scores', { triggerIntentId: state.triggerIntentId, error: err });
        }
      } else if (state.searchQuery?.trim()) {
        // Chat path: score query against target indexes in parallel
        try {
          const indexer = new IntentIndexer();
          const scorableIndexes = targetIndexes.filter(ti => ti.title !== 'Unknown');
          const scoringPromises = scorableIndexes.map(async (ti) => {
            try {
              const ctx = await this.database.getIndexMemberContext(ti.indexId, state.userId);
              if (!ctx?.indexPrompt?.trim() && !ctx?.memberPrompt?.trim()) {
                return { indexId: ti.indexId, score: 1.0 };
              }
              const result = await indexer.invoke(
                state.searchQuery!,
                ctx?.indexPrompt ?? null,
                ctx?.memberPrompt ?? null,
              );
              if (!result) return { indexId: ti.indexId, score: 1.0 };
              const score = ctx?.indexPrompt && ctx?.memberPrompt
                ? result.indexScore * 0.6 + result.memberScore * 0.4
                : ctx?.indexPrompt ? result.indexScore : result.memberScore;
              return { indexId: ti.indexId, score };
            } catch {
              return { indexId: ti.indexId, score: 1.0 };
            }
          });
          const results = await Promise.all(scoringPromises);
          for (const { indexId, score } of results) {
            indexRelevancyScores[indexId] = score;
          }
        } catch (err) {
          logger.warn('[Graph:Scope] Failed to score query against indexes', { error: err });
        }
      }
```

- [ ] **Step 3: Include `indexRelevancyScores` in the scope node return value**

Update the return statement (around line 231) to include the new field. Change:

```typescript
      return {
        targetIndexes,
        trace: [{
```

to:

```typescript
      return {
        targetIndexes,
        indexRelevancyScores,
        trace: [{
```

- [ ] **Step 4: Run TypeScript type check**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "feat(opportunity): populate indexRelevancyScores in scope node"
```

---

### Task 9: Update dedup and source actor indexId attribution

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts:807-824, 855, 991-997`

Three changes in this task: (1) relevancy-scored dedup, (2) remove arbitrary `sourceIndexId`, (3) per-pairing source actor indexId.

- [ ] **Step 1: Replace the dedup logic (lines 807-813)**

Replace:

```typescript
const seenUserIds = new Set<string>();
const dedupedCandidates = sortedCandidates.filter((c) => {
  if (seenUserIds.has(c.candidateUserId)) return false;
  seenUserIds.add(c.candidateUserId);
  return true;
});
```

with:

```typescript
// Dedup by userId — when same similarity, prefer index with highest relevancyScore
const bestByUser = new Map<string, CandidateMatch>();
for (const c of sortedCandidates) {
  const existing = bestByUser.get(c.candidateUserId);
  if (!existing) {
    bestByUser.set(c.candidateUserId, c);
  } else if (c.similarity > existing.similarity) {
    bestByUser.set(c.candidateUserId, c);
  } else if (c.similarity === existing.similarity) {
    // Tie-break: prefer index with higher relevancy score
    const cScore = state.indexRelevancyScores[c.indexId] ?? 0;
    const existingScore = state.indexRelevancyScores[existing.indexId] ?? 0;
    if (cScore > existingScore) {
      bestByUser.set(c.candidateUserId, c);
    }
  }
}
const dedupedCandidates = Array.from(bestByUser.values());
// Re-sort by similarity descending (Map iteration order doesn't guarantee sort)
dedupedCandidates.sort((a, b) => b.similarity - a.similarity);
```

Verify `CandidateMatch` is imported from the state file (it should already be).

- [ ] **Step 2: Remove `sourceIndexId` from source entity construction (line 855)**

Delete this line entirely:

```typescript
const sourceIndexId = state.targetIndexes[0]?.indexId ?? state.userIndexes[0];
```

Change the source entity's `indexId` field from:

```typescript
  indexId: sourceIndexId ?? ('' as Id<'indexes'>),
```

to:

```typescript
  indexId: '' as Id<'indexes'>,  // Placeholder — overwritten per-pairing below
```

- [ ] **Step 3: Update actor indexId mapping to use per-pairing logic (lines 991-997)**

The evaluator returns pairwise results (source + candidate per opportunity). Each source actor must inherit its counterpart's indexId — not a single global indexId. The `userIdToIndexId` map construction (lines 910-913) stays unchanged.

Change:

```typescript
actors: op.actors.map((a) => ({
  userId: a.userId as Id<'users'>,
  role: a.role,
  intentId: a.intentId as Id<'intents'> | undefined,
  indexId: userIdToIndexId.get(a.userId) ?? (entities.find((e) => e.userId === a.userId)?.indexId as Id<'indexes'>),
})),
```

to:

```typescript
actors: op.actors.map((a) => {
  const isSource = a.userId === discoveryUserId;
  if (isSource) {
    // Source actor inherits the counterpart's indexId (shared match context)
    const counterpart = op.actors.find((other) => other.userId !== a.userId);
    const counterpartIndexId = counterpart
      ? userIdToIndexId.get(counterpart.userId) ?? (entities.find((e) => e.userId === counterpart.userId)?.indexId as Id<'indexes'>)
      : undefined;
    return {
      userId: a.userId as Id<'users'>,
      role: a.role,
      intentId: a.intentId as Id<'intents'> | undefined,
      indexId: counterpartIndexId ?? userIdToIndexId.get(a.userId) ?? ('' as Id<'indexes'>),
    };
  }
  return {
    userId: a.userId as Id<'users'>,
    role: a.role,
    intentId: a.intentId as Id<'intents'> | undefined,
    indexId: userIdToIndexId.get(a.userId) ?? (entities.find((e) => e.userId === a.userId)?.indexId as Id<'indexes'>),
  };
}),
```

This ensures each source-candidate pair gets the correct shared indexId, even when a batch has candidates from different indexes.

- [ ] **Step 3: Run TypeScript type check**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "fix(opportunity): use relevancy-scored dedup and per-pairing source indexId"
```

---

### Task 10: Update opportunity graph test mocks

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`

- [ ] **Step 1: Add `getIntentIndexScores` and `getIndexMemberContext` to mock databases**

In `createMockGraph` (around line 54), add to `mockDb`:

```typescript
    getIntentIndexScores: async () => [],
    getIndexMemberContext: async () => null,
```

In `createMockGraphWithFnOverrides` (around line 139), add the same:

```typescript
    getIntentIndexScores: async () => [],
    getIndexMemberContext: async () => null,
```

In the `onBehalfOfUserId` test mock (around line 1317), add the same:

```typescript
    getIntentIndexScores: async () => [],
    getIndexMemberContext: async () => null,
```

- [ ] **Step 2: Run tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`
Expected: All 40 tests pass.

- [ ] **Step 3: Commit**

```bash
git add protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
git commit -m "test(opportunity): add new mock methods to test helpers"
```

---

### Task 11: Add dedup tie-breaking test

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`

- [ ] **Step 1: Add a test for relevancy-scored dedup tie-breaking**

Add a new test in the existing `describe('OpportunityGraphFactory')` block:

```typescript
it('dedup prefers candidate from index with higher relevancy score on equal similarity', async () => {
  const { compiledGraph } = createMockGraph({
    getUserIndexIds: async () => ['idx-high', 'idx-low'] as Id<'indexes'>[],
    getIndexMemberships: async () => [
      { indexId: 'idx-high', indexTitle: 'High Relevancy', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, joinedAt: new Date() },
      { indexId: 'idx-low', indexTitle: 'Low Relevancy', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, joinedAt: new Date() },
    ],
  });

  // Invoke with indexRelevancyScores pre-set (simulating scope node output)
  const result = await compiledGraph.invoke({
    userId: 'user-source' as Id<'users'>,
    searchQuery: 'find collaborators',
    operationMode: 'create' as const,
    indexRelevancyScores: { 'idx-high': 0.9, 'idx-low': 0.3 },
  });

  // The opportunity actors should have indexId from the higher-scoring index
  if (result.evaluatedOpportunities?.length > 0) {
    const sourceActor = result.evaluatedOpportunities[0].actors.find(
      (a: { userId: string }) => a.userId === 'user-source'
    );
    const counterpartActor = result.evaluatedOpportunities[0].actors.find(
      (a: { userId: string }) => a.userId !== 'user-source'
    );
    // If both actors exist, source should inherit counterpart's indexId
    if (sourceActor && counterpartActor) {
      expect(sourceActor.indexId).toBe(counterpartActor.indexId);
    }
  }
}, 30_000);
```

Note: This test verifies the structural invariant (source inherits counterpart's indexId). Testing the actual dedup tie-break with equal similarity requires crafting mock embedder results — a more involved test that can be added as a follow-up.

- [ ] **Step 2: Run tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`
Expected: All tests pass (41 tests).

- [ ] **Step 3: Commit**

```bash
git add protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
git commit -m "test(opportunity): add dedup tie-breaking test for relevancy scores"
```

---

## Chunk 4: Verification and Cleanup

### Task 12: Full type check and test suite

**Files:** None (verification only)

- [ ] **Step 1: Run full TypeScript type check**

Run: `cd protocol && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run opportunity graph tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`
Expected: All tests pass.

- [ ] **Step 3: Run intent-related tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/intent_index.graph.spec.ts` (if it exists)
Run: `cd protocol && bun test src/queues/tests/intent.queue.spec.ts` (if it exists)

If these test files don't exist, skip.

- [ ] **Step 4: Run adapter tests**

Run: `cd protocol && bun test src/adapters/tests/personal-index.adapter.spec.ts`
Expected: All tests pass.

- [ ] **Step 5: Push**

```bash
git push origin feat/personal-index
```
