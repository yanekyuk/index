# Opportunity Dedup & Actor Guardrails Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix opportunity deduplication so it finds existing opportunities regardless of actor count, enforce strict 2-actor constraints on discovery-mode opportunities, and add a status-aware dedup policy (drafts are recreatable, non-drafts block creation).

**Architecture:** Three layered fixes: (1) change the DB query from exact-set to containment matching, (2) add a post-evaluator guard in the graph's persist node that enforces exactly 2 actors for discovery-mode opportunities (viewer + candidate), (3) make the dedup policy status-aware so drafts pass through while accepted/pending/etc. block creation.

**Tech Stack:** PostgreSQL (jsonb containment `@>`), Drizzle ORM (`sql` template tag), Bun test framework, TypeScript.

---

## Background & Root Cause

**Symptom:** User has an accepted opportunity with Elena Petrova. When asking "any python developers?" again, the system creates a NEW draft with Elena instead of detecting the existing one.

**Root cause (3 layers):**

1. **DB query uses exact set match.** `findOverlappingOpportunities` aggregates all non-introducer actor userIds into an array and compares with `=`. An opportunity with actors `[Elena, Alex, You]` (3 actors) does NOT match a query for `[Elena, You]` (2 actors) because `{A,B,C} ≠ {A,B}`.

2. **Evaluator creates multi-actor opportunities.** The entity-bundle evaluator (`invokeEntityBundle`) receives all candidates in one bundle and can propose opportunities between arbitrary entity subsets. It created an opportunity with Alex Chen as a third actor, even though the discovery was triggered by the viewer for Elena. The persist node writes evaluator output verbatim with no guard on actor count.

3. **Dedup blocks all statuses equally.** The current logic skips creation for ANY overlapping opportunity (draft, pending, accepted, etc.). But drafts should be recreatable per chat session; only statuses above draft (pending, viewed, accepted, rejected) should block creation.

**Evidence (from server logs):**
```
[DB:findOverlappingOpportunities] query {
  sortedActorUserIds: ["b2cbf483-...(Elena)", "qVJpwNVU...(viewer)"],
  excludeStatuses: [],
}
[DB:findOverlappingOpportunities] result { count: 0, rows: [] }
```
DB has opportunity `c9506115` with status `accepted` and actors `[Elena, Alex, You]` — 3 actors, so exact match fails.

---

## Task 1: Change dedup query from exact match to containment

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts` — `OpportunityDatabaseAdapter.findOverlappingOpportunities` (~line 2694)
- Test: `protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`

### Step 1: Write the failing test

Add a test to the existing `Persist node: dedup via findOverlappingOpportunities` describe block in the spec file. This test verifies that when an existing opportunity has 3 actors (viewer + candidate + third-party), dedup still detects it.

```typescript
test('when existing opportunity has 3+ actors including viewer and candidate, still detects overlap', async () => {
  const threeActorOpportunity = {
    id: 'opp-three-actors' as Id<'opportunities'>,
    status: 'accepted' as const,
    actors: [
      { userId: SOURCE_USER, role: 'patient' as const, indexId: TEST_INDEX },
      { userId: CANDIDATE_USER, role: 'agent' as const, indexId: TEST_INDEX },
      { userId: 'third-party-user' as Id<'users'>, role: 'agent' as const, indexId: TEST_INDEX },
    ],
    context: { indexId: TEST_INDEX },
    interpretation: { reasoning: 'test', confidence: 0.8, signals: [], category: 'collaboration' as const },
    detection: { source: 'opportunity_graph', createdBy: 'test', timestamp: new Date().toISOString() },
    confidence: '0.8',
  } as unknown as Opportunity;

  const mockDb = createMockDatabase({
    findOverlappingOpportunities: async () => [threeActorOpportunity],
  });
  // ... invoke graph, assert existingBetweenActors includes candidate
});
```

### Step 2: Run the test — expect FAIL

```bash
cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
```

### Step 3: Implement the fix

In `protocol/src/adapters/database.adapter.ts`, replace the `overlapCondition` in `findOverlappingOpportunities`:

**Current (exact match):**
```typescript
const overlapCondition = sql`(
  SELECT array_agg(uid ORDER BY uid)
  FROM (
    SELECT elem->>'userId' AS uid
    FROM jsonb_array_elements(${opportunities.actors}) AS elem
    WHERE elem->>'role' IS DISTINCT FROM 'introducer' AND elem->>'userId' IS NOT NULL AND elem->>'userId' != ''
  ) sub
) = ARRAY[${sql.join(sortedActorUserIds.map((uid) => sql`${uid}`), sql`, `)}]::text[]`;
```

**New (containment — every input userId must appear as a non-introducer actor):**
```typescript
const containmentConditions = sortedActorUserIds.map(
  (uid) => sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) elem
    WHERE elem->>'userId' = ${uid}
      AND elem->>'role' IS DISTINCT FROM 'introducer'
  )`
);
const overlapCondition = and(...containmentConditions);
```

This matches any opportunity where ALL the given userIds appear as non-introducer actors, regardless of how many additional actors exist.

### Step 4: Run test — expect PASS

```bash
cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
```

### Step 5: Commit

```bash
git add protocol/src/adapters/database.adapter.ts protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
git commit -m "fix(opportunity): use containment matching in findOverlappingOpportunities

Exact set matching failed when existing opportunity had 3+ actors.
Switch to per-userId EXISTS subqueries so [You, Elena] is found even
when the stored opportunity has [You, Elena, Alex]."
```

---

## Task 2: Enforce 2-actor constraint for discovery-mode opportunities

The entity-bundle evaluator can return opportunities with 3+ actors (e.g. `[Elena, Alex, You]`). For discovery-mode (not introduction), each persisted opportunity must have exactly 2 actors: the viewer (discoverer) and one candidate. This prevents ghost actors like Alex Chen from leaking in.

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts` — `evaluationNode` (~line 645)
- Test: `protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`

### Step 1: Write the failing test

Add a test that verifies multi-actor evaluator results are split into pairwise opportunities (viewer + each non-viewer actor).

```typescript
test('evaluationNode splits 3-actor evaluator result into pairwise opportunities', async () => {
  const threeActorResult = [{
    reasoning: 'All three should collaborate',
    score: 85,
    actors: [
      { userId: SOURCE_USER, role: 'patient' as const, intentId: null },
      { userId: CANDIDATE_USER, role: 'agent' as const, intentId: null },
      { userId: 'third-user' as Id<'users'>, role: 'agent' as const, intentId: null },
    ],
  }];
  // Mock evaluator to return 3-actor result
  // Invoke graph
  // Assert evaluatedOpportunities has 2 entries, each with exactly 2 actors
  // Entry 1: [SOURCE_USER, CANDIDATE_USER]
  // Entry 2: [SOURCE_USER, 'third-user']
});
```

### Step 2: Run test — expect FAIL

```bash
cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
```

### Step 3: Implement the fix

In `opportunity.graph.ts`, after line 643 (where `opportunitiesWithActors` is set), add a post-evaluator normalization step before mapping to `evaluatedOpportunities`:

```typescript
// Normalize: split multi-actor opportunities into pairwise (viewer + candidate).
// The evaluator may propose 3+ actor groups; for discovery we persist one
// opportunity per viewer-candidate pair to keep dedup and lifecycle simple.
const pairwiseOpportunities: typeof opportunitiesWithActors = [];
for (const op of opportunitiesWithActors) {
  const nonViewerActors = op.actors.filter(a => a.userId !== state.userId);
  if (nonViewerActors.length <= 1) {
    // Already pairwise or single-actor (edge case) — keep as-is
    pairwiseOpportunities.push(op);
  } else {
    // Split into one opportunity per non-viewer actor
    const viewerActor = op.actors.find(a => a.userId === state.userId);
    for (const candidate of nonViewerActors) {
      pairwiseOpportunities.push({
        reasoning: op.reasoning,
        score: op.score,
        actors: [
          viewerActor ?? { userId: state.userId, role: 'patient' as const, intentId: null },
          candidate,
        ],
      });
    }
  }
}
```

Then use `pairwiseOpportunities` instead of `opportunitiesWithActors` in the mapping on line 645.

### Step 4: Run test — expect PASS

```bash
cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
```

### Step 5: Commit

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
git commit -m "fix(opportunity): enforce pairwise actors in discovery evaluation

Entity-bundle evaluator may return 3+ actor groups. Split them into
viewer-candidate pairs so each persisted opportunity has exactly 2
actors, preventing ghost actors and ensuring dedup works correctly."
```

---

## Task 3: Status-aware dedup policy

Currently the dedup skips creation for ALL existing statuses (including draft). Per user specification:
- `draft` / `latent`: allow recreation (enricher handles per-session dedup)
- `pending` / `viewed` / `accepted` / `rejected`: block creation, add to `existingBetweenActors`
- `expired`: reactivate as draft (already implemented)

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts` — `persistNode` dedup block (~line 1006)
- Modify: `protocol/src/adapters/database.adapter.ts` — `findOverlappingOpportunities` (add `excludeStatuses` default)
- Test: `protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`

### Step 1: Write the failing test

```typescript
test('when existing draft opportunity exists between actors, allows creation (does not dedup)', async () => {
  const draftOpportunity = {
    id: 'opp-draft' as Id<'opportunities'>,
    status: 'draft' as const,
    actors: [
      { userId: SOURCE_USER, role: 'patient' as const, indexId: TEST_INDEX },
      { userId: CANDIDATE_USER, role: 'agent' as const, indexId: TEST_INDEX },
    ],
    // ...
  } as unknown as Opportunity;
  const mockDb = createMockDatabase({
    findOverlappingOpportunities: async () => [draftOpportunity],
  });
  // Invoke graph
  // Assert: opportunity IS created (not skipped), existingBetweenActors is empty
});
```

### Step 2: Run test — expect FAIL

```bash
cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
```

### Step 3: Implement the fix

In `opportunity.graph.ts`, modify the dedup block in `persistNode` (~line 1006). Add status filtering: pass `excludeStatuses: ['draft', 'latent']` to `findOverlappingOpportunities` so drafts are ignored by the query.

```typescript
const DEDUP_SKIP_STATUSES: Array<'draft' | 'latent'> = ['draft', 'latent'];

const overlapping = candidateUserId
  ? await this.database.findOverlappingOpportunities(
      [state.userId as Id<'users'>, candidateUserId as Id<'users'>],
      { excludeStatuses: DEDUP_SKIP_STATUSES },
    )
  : [];
```

This way:
- Draft/latent opportunities are excluded from the overlap query entirely
- Pending/viewed/accepted/rejected opportunities ARE found → skip creation
- Expired opportunities ARE found → reactivate as draft

### Step 4: Run tests — expect PASS

```bash
cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
```

### Step 5: Commit

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
git commit -m "fix(opportunity): status-aware dedup policy for draft recreation

Skip draft/latent in dedup query so each chat session can recreate
drafts. Only pending/viewed/accepted/rejected block creation.
Expired opportunities are still reactivated as draft."
```

---

## Task 4: Clean up diagnostic logs

Remove the `console.log` statements added during debugging in `database.adapter.ts` (the `[DB:findOverlappingOpportunities]` logs). Keep the `logger.info` statements in the graph as they provide useful operational visibility.

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts` — remove `console.log` calls in `findOverlappingOpportunities`

### Step 1: Remove the two console.log blocks

Remove the `console.log('[DB:findOverlappingOpportunities] query', ...)` and `console.log('[DB:findOverlappingOpportunities] result', ...)` calls.

### Step 2: Run tests to verify no breakage

```bash
cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
```

### Step 3: Commit

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "chore: remove diagnostic console.log from findOverlappingOpportunities"
```

---

## Summary

| Task | What | Why |
|------|------|-----|
| 1 | Containment query | Dedup finds existing opportunities with 3+ actors |
| 2 | Pairwise actor enforcement | Prevents ghost actors (Alex Chen) in discovery opportunities |
| 3 | Status-aware dedup | Drafts recreatable; only non-drafts block creation |
| 4 | Log cleanup | Remove debug instrumentation |

After all tasks, verify with the same smoke test: accept an opportunity with Elena, then ask "Any python developers?" again. The accepted opportunity should be detected and Elena mentioned in text, not shown as a new draft card.
