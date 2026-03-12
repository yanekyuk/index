# Opportunity Index Attribution Design

## Goal

Fix incorrect index attribution on opportunity actors by replacing the arbitrary `targetIndexes[0]` assignment with a relevancy-scored selection, and persist intent-to-index relevancy scores for future use.

## Architecture

The source actor's indexId in opportunity discovery is currently set to whichever index happens to be first in the `getIndexMemberships` query result — effectively random. This causes all opportunities to appear under a single arbitrary index (e.g., "Bench") regardless of where the match actually occurred.

The fix introduces a `relevancyScore` on intent-index assignments, computed by the existing IntentIndexer agent. The opportunity graph uses these scores to select the most appropriate shared index when candidates span multiple indexes.

## Constraints

- An opportunity between two users can only occur if they share the same index.
- Intents involved in the match must be assigned to that shared index.
- The source actor's indexId is always the candidate's indexId — they share the match context.
- When the same candidate appears across multiple shared indexes, `relevancyScore` breaks the tie.
- The opportunity enricher pipeline may add additional index-intent signals to an existing opportunity over time. When an opportunity is enriched with a new index, the home page must surface that opportunity under the new index as well.
- Legacy rows without scores should continue to work (null scores treated as equal).

## Schema Change

Add a nullable `relevancyScore` column to `intent_indexes`:

```sql
ALTER TABLE intent_indexes ADD COLUMN relevancy_score NUMERIC;
```

```typescript
export const intentIndexes = pgTable('intent_indexes', {
  intentId: text('intent_id').notNull().references(() => intents.id),
  indexId: text('index_id').notNull().references(() => indexes.id),
  relevancyScore: numeric('relevancy_score'),  // 0.0–1.0, nullable for legacy rows
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.intentId, t.indexId] }),
}));
```

Nullable so existing rows don't need backfilling. All new assignments populate it.

## Scoring at Assignment Time

### Evaluated path (IntentIndexGraph)

Already runs IntentIndexer and computes a `finalScore`. Persist it as `relevancyScore` when calling `assignIntentToIndex`. No new LLM calls — the score exists today but is discarded.

Note: `intent_index.graph.ts` has multiple assignment paths — direct assignment (line 74, `skipEvaluation=true`), no-context (line 90), no-prompts (line 99), and fully evaluated (line 155). The non-evaluated paths should pass `relevancyScore = 1.0` (no basis to score). The evaluated path passes the computed `finalScore`.

### Auto-assign path (IntentQueue.handleGenerateHyde)

Currently does direct inserts without evaluation. This path operates on the user's `autoAssign=true` indexes only (scoped by `getUserIndexIds`). Changes to:

1. Fetch index prompt and member prompt for each of the user's auto-assign indexes via `getIndexMemberContext`.
2. Indexes where both prompts are null get assigned directly with `relevancyScore = 1.0` (no basis to score against).
3. Run IntentIndexer in parallel for remaining indexes.
4. Persist all assignments with `relevancyScore`.
5. Assignment is unconditional (auto-assign means the user opted in) — the score is informational, not a gate.

## Source Actor IndexId in Opportunity Graph

### Background path (has `triggerIntentId`)

1. In the prep or scope node, look up the trigger intent's `intent_indexes` rows with their `relevancyScore`.
2. When deduplicating candidates across indexes (same userId found in multiple shared indexes), prefer the index where the trigger intent has the highest `relevancyScore`.
3. The source actor's indexId = the winning candidate's indexId (shared context).
4. Fallback: if no scored rows exist (legacy data), current behavior (first index) is preserved.

### Chat path (has `searchQuery`, no intent record)

1. In the scope node, after determining `targetIndexes`, run IntentIndexer on the search query against each target index (parallel, skip no-prompt indexes).
2. No-prompt indexes get a default score of 1.0.
3. When deduplicating candidates, prefer the index with the highest on-the-fly query score.
4. The source actor's indexId = the winning candidate's indexId.
5. These scores are transient — not persisted since there's no intent record to attach them to.

## Component Changes

### Database schema (`database.schema.ts`)
- Add `relevancyScore: numeric('relevancy_score')` to `intentIndexes` table.

### Database adapter (`database.adapter.ts`)
- `assignIntentToIndex(intentId, indexId, relevancyScore?)`: Add optional score parameter. Use `onConflictDoUpdate` to update score on re-assignment. Note: this method exists in multiple adapter classes within the file (lines 512, 1441, 3454, wrapper at 4341) — all implementations must be updated consistently.
- Add `getIntentIndexScores(intentId): Promise<Array<{ indexId: string; relevancyScore: number | null }>>`: Used by opportunity graph to look up scores for trigger intent.

### Database interface (`database.interface.ts`)
- Add `getIntentIndexScores` to `OpportunityGraphDatabase`.
- Add `getIndexMemberContext` to `OpportunityGraphDatabase` (needed by chat path scope node to fetch index/member prompts for IntentIndexer scoring).

### Intent queue types (`intent.queue.ts`)
- `IntentQueueDatabase` is a `Pick<>` from the adapter — the `assignIntentToIndex` signature change propagates automatically. Mention here to avoid implementer confusion.

### Intent Index Graph (`intent_index.graph.ts`)
- Evaluated path (line 155): pass `finalScore` as `relevancyScore`.
- Non-evaluated paths (lines 74, 90, 99): pass `relevancyScore = 1.0`.

### Intent Queue (`intent.queue.ts` — `handleGenerateHyde`)
- Replace direct `assignIntentToIndex` loop with:
  1. Fetch prompts for user's auto-assign indexes via `getIndexMemberContext`.
  2. Filter out no-prompt indexes (assign with score 1.0).
  3. Run IntentIndexer in parallel for the rest.
  4. Assign all with `relevancyScore`.

### Opportunity Graph (`opportunity.graph.ts`)

**Evaluation node — dedup filter:**
- The existing dedup (lines 807-813) collapses candidates by `candidateUserId`, keeping highest similarity. The tie-breaking logic must be integrated *inside* this dedup filter — when two candidates have equal similarity but different indexIds, the filter keeps the one whose index has the highest `relevancyScore`.
- Remove `sourceIndexId = state.targetIndexes[0]?.indexId` (line 855).
- Source entity's indexId = candidate's indexId (already set per-candidate at line 902).

**Scope node:**
- Background path: look up trigger intent's `intent_indexes` rows with `relevancyScore` via `getIntentIndexScores`. Store on state for dedup tie-breaking.
- Chat path: run IntentIndexer on searchQuery vs each target index (parallel, skip no-prompt). Requires index/member prompts via `getIndexMemberContext`. Store transient scores on state for dedup tie-breaking.

**Read node (`readNode`):**
- Counterpart-actor fix stays as-is — still correct since the counterpart's indexId now reflects the highest-relevancy shared index.

### Migration
- New migration: `NNNN_add_intent_indexes_relevancy_score.sql`
- Single `ALTER TABLE` adding the nullable column.

## Data Flow

```
Intent Created
  → IntentQueue.handleGenerateHyde
    → For each user index:
      → No-prompt indexes: assign with relevancyScore = 1.0
      → Others: run IntentIndexer in parallel
      → assignIntentToIndex(intentId, indexId, relevancyScore)

Opportunity Discovery (background)
  → Prep: getIndexMemberships → userIndexes
  → Scope: determine targetIndexes
  → Discovery: candidates found per targetIndex, each carries indexId
  → Evaluation: dedup candidates by userId
    → Tie-break equal similarity using trigger intent's relevancyScore per index
    → Source entity indexId = candidate's indexId (shared context)
  → Persist: both actors carry the shared indexId

Opportunity Discovery (chat)
  → Same as above, except:
    → Scope node runs IntentIndexer on searchQuery vs targetIndexes (parallel, skip no-prompt)
    → Dedup tie-break uses transient scores instead of persisted ones
```

## Edge Cases

1. **Legacy data (no relevancyScore):** Null scores treated as equal, first-encountered index wins. No backfill needed.
2. **User in only one index:** No ambiguity — that index is used. Scoring still runs but result is trivially the only option.
3. **All indexes have no prompt:** All get default 1.0, same as today's arbitrary pick. Acceptable — no index purpose means no basis for preference.
4. **Trigger intent not in any target index:** Shouldn't happen (intents are assigned at creation), fallback to `targetIndexes[0]`.
5. **Opportunity enrichment across indexes:** When the enricher adds a new actor entry with a different indexId, the home page `getOpportunitiesForUser` query already filters by actor indexId via its `EXISTS (jsonb_array_elements(actors))` clause, so the opportunity surfaces under both indexes automatically.

## Testing

- Unit test: `intent_indexes` insert with `relevancyScore`, verify persistence and conflict update.
- Unit test: IntentIndexer scoring in auto-assign path (parallel execution, no-prompt filtering).
- Unit test: Opportunity graph dedup tie-breaking with `relevancyScore`.
- Unit test: Chat path transient scoring in scope node.
- Integration test: End-to-end — create intent, verify `relevancyScore` populated, trigger discovery, verify source actor has correct indexId.
