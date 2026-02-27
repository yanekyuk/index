# Discovery Tuning Rethink

**Date**: 2026-02-27
**Branch**: `feat/observability-and-discovery-optimizations`
**Status**: Approved — pending implementation

## Context

The `feat/observability-and-discovery-optimizations` branch delivers two features: a trace event pipeline for agent observability, and discovery parameter expansion to address observed missed connections. Code review and brainstorming identified that the discovery tuning needs refinement before merge — specifically around threshold selection, evaluation capping strategy, and instrumentation.

### Problem

Users were missing relevant connections with the original parameters (`limitPerStrategy=10`, `perIndexLimit=20`, `minScore=0.50`). The branch expanded these aggressively (`40`, `80`, `0.30`) but introduced a hard evaluation cap of 50 candidates, creating a tension: wider net gets narrowed before the LLM evaluates. Additionally, it's unclear whether the misses were caused by the similarity threshold or pool size limits, and there's no instrumentation to isolate which change helps.

### Decision

Use **Instrumented Expansion** — moderate threshold, batched user-driven evaluation pagination, full funnel metrics with per-strategy scores and timing.

## Design

### Discovery Parameters

| Parameter | Pre-branch | Current branch | Final |
|-----------|-----------|----------------|-------|
| `limitPerStrategy` | 10 | 40 | **40** |
| `perIndexLimit` | 20 | 80 | **80** |
| `minScore` (all paths) | 0.50 | 0.30 (profile/query), 0.20 (intent — bug) | **0.40** (unified) |
| Eval cap | none | 50 (hard) | **25/batch, user-driven** |
| Output limit | 5 | 20 | **20** |
| Overfetch multiplier | N/A | 10x (500 rows) | **SQL DISTINCT ON** |

### User-Driven Evaluation Pagination

Instead of evaluating all candidates automatically, evaluate the first batch and let the user decide whether to see more.

**Flow**:

1. Discovery fetches candidates (40/strategy, 80/index aggregate).
2. Threshold filter removes candidates below 0.40 similarity.
3. Sort remaining by descending similarity.
4. Evaluate **first 25** via LLM evaluator.
5. Return passes as opportunity cards + metadata:
   ```json
   {
     "opportunities": [...],
     "meta": { "evaluated": 25, "remaining": 55, "discoveryId": "abc123" }
   }
   ```
6. Chat agent tells user: "I found N matches. There are M more candidates — want me to look deeper?"
7. If user asks for more → agent calls `create_opportunities` with `continueFrom: "abc123"`.
8. Graph skips discovery, loads remaining candidates from cache, evaluates next 25.
9. Repeat until user stops or candidates exhausted.

### Candidate Cache (Redis)

- **Key**: `discovery:{userId}:{sessionId}:{discoveryId}`
- **Value**: Serialized array of unevaluated candidates (userId, similarity, strategy, indexId)
- **TTL**: 30 minutes
- **Cleanup**: Expires naturally; no manual cleanup needed

### Tool Interface Changes

The `create_opportunities` tool gains an optional `continueFrom` parameter:

```typescript
// First call — runs full discovery pipeline
create_opportunities({ query: "find me React developers", limit: 20 })

// Continuation — evaluates next batch from cache
create_opportunities({ continueFrom: "abc123", limit: 20 })
```

When `continueFrom` is set, the opportunity graph:
- Skips discovery and threshold stages
- Loads candidates from Redis cache
- Evaluates next 25
- Updates cache (remove evaluated, decrement remaining)
- Returns results with updated meta

### Funnel Trace Instrumentation

Each discovery stage logs a trace entry with data fields and `durationMs`:

| Stage | Step Name | Data Fields |
|-------|-----------|-------------|
| Discovery | `discovery` | `candidateCount`, `byStrategy: { [name]: { count, avgSimilarity } }`, `searchQuery?`, `durationMs` |
| Threshold | `threshold_filter` | `aboveThreshold`, `belowThreshold`, `minScore`, `durationMs` |
| Eval Batch | `eval_batch` | `batchNumber`, `evaluated`, `passed`, `failed`, `remaining`, `durationMs` |
| Persist | `persist` | `created`, `reactivated`, `skipped`, `durationMs` |

Per-strategy breakdown shows which HyDE strategies produce higher-quality matches. Timing shows where latency concentrates.

### Overfetch Optimization

Replace the `OVERFETCH_MULTIPLIER` approach with SQL-level deduplication:

**Current** (embedder.adapter.ts):
```typescript
const OVERFETCH_MULTIPLIER = 10;
const fetchLimit = Math.min(limit * OVERFETCH_MULTIPLIER, 500);
// Fetch 500 rows, dedupe in JS
```

**Proposed**:
```sql
SELECT DISTINCT ON (user_id) *
FROM user_profiles
ORDER BY user_id, embedding <=> $1
LIMIT 80;
```

This eliminates the 500-row cosine computation and deduplicates at the DB level.

### Code Review Fixes (bundled)

These orthogonal fixes ship alongside the discovery rethink:

1. **Unify `minScore`** — Fix intent-path hardcoded `0.20` to `0.40`
2. **Widen `DebugMetaStep.data`** — Change from narrow felicity fields to `Record<string, unknown>` in both `chat-streaming.types.ts` and frontend `AIChatContext.tsx`
3. **Delete `useTypewriter.ts`** — Orphaned after ThinkingDropdown removal
4. **Add `data` to `AgentStreamEvent`** — Tool activity type missing `data` field
5. **Restore `job.id` in queue logging** — Template change accidentally dropped job ID
6. **SQL DISTINCT ON** — Replace overfetch multiplier (see above)

## What Stays Unchanged

- Pool sizes (40/80) — grounded in observed misses
- Output limit (20)
- Discovery-first routing in chat prompt
- Existing connection merging (pending + draft + latent)
- HyDE investor strategy improvement
- Full trace pipeline architecture (events, streamer, ToolCallsDisplay)
- All observability commit work (trace events, frontend timeline UI)

## Alternatives Considered

1. **Two-Tier Evaluation** — High-confidence band (>0.40) fully evaluated + random sample from marginal band (0.30-0.40). Rejected: non-deterministic results from sampling.
2. **Conservative + A/B Logging** — 0.45 threshold with shadow logging of old vs new results. Rejected: slowest path to improvement, adds overhead.
3. **Automatic batched evaluation with early-stop** — Evaluate all candidates in 25-batch groups, stop on 0-pass batch. Rejected in favor of user-driven pagination for better UX control.
