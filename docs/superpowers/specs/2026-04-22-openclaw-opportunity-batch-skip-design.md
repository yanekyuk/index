# Design: Skip Opportunity Batch LLM When Set Is Unchanged

**Date:** 2026-04-22
**Scope:** `packages/openclaw-plugin/src/index.ts`

## Problem

The `handleOpportunityBatch` handler fires every 5 minutes and unconditionally spawns an LLM subagent to evaluate pending opportunities — even when the opportunity set is identical to the previous poll. This wastes LLM calls when nothing has changed.

## Solution

Track the last-seen opportunity batch hash in memory. Skip the LLM subagent call when the hash matches the previous run.

## Design

### State

Add a module-level variable alongside the existing `inflight` set:

```ts
let lastOpportunityBatchHash: string | null = null;
```

### Logic in `handleOpportunityBatch`

After fetching opportunities and computing `hashOpportunityBatch(ids)`:

1. If `hash === lastOpportunityBatchHash` → log skip, return early (no subagent spawned)
2. Otherwise → set `lastOpportunityBatchHash = hash`, proceed with subagent call as today

The empty-list case (`ids = []`) produces a stable hash, so repeated empty polls also skip after the first.

### Test Reset

`_resetForTesting()` resets `lastOpportunityBatchHash = null` alongside existing state resets.

## Trade-offs

- **Restart behavior:** `lastOpportunityBatchHash` initializes to `null` on process start, so the first poll after a restart always runs the LLM — one extra call per restart, acceptable.
- **No persistent storage needed:** Backend maintains opportunity state; the plugin only needs to deduplicate within a session.
- **Hash stability:** `hashOpportunityBatch` sorts IDs before hashing, so LLM-determined ordering from the API does not affect change detection.

## Files Changed

- `packages/openclaw-plugin/src/index.ts` — add `lastOpportunityBatchHash` variable, early-return guard in `handleOpportunityBatch`, reset in `_resetForTesting`
