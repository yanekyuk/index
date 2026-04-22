# Opportunity Time-Based Dedup

## Problem

The persist-time dedup in `opportunity.graph.ts` blocks ALL new opportunities between already-connected user pairs, even when the new discovery context is semantically different.

**Root cause:** IND-166 fix added pair-existence dedup to prevent duplicate opportunities from parallel background jobs. The fix was correct for that scenario but too aggressive — it now blocks legitimate new discoveries for long-connected pairs.

**Example:** User asks "Connect me to Seren to discuss AI infrastructure." Seren is already connected (accepted 3 months ago). The system finds a 95-score match but skips creation because an opportunity already exists.

## Solution

Replace pair-existence dedup with time-based dedup. The original IND-166 problem was about parallel jobs creating duplicates within seconds — a 10-minute window catches those while allowing legitimate new discoveries for long-connected pairs.

## Design

### Persist-time dedup logic

In `opportunity.graph.ts` persist node (~lines 2477-2516), change from status-based skip to time-gated skip:

```typescript
const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

if (overlapping.length > 0) {
  const existing = overlapping[0];
  const isRecent = new Date(existing.createdAt).getTime() > Date.now() - DEDUP_WINDOW_MS;

  switch (existing.status) {
    case 'expired':
    case 'stalled':
      // Reactivate to new status
      await this.database.updateOpportunityStatus(existing.id, initialStatus);
      reactivatedOpportunities.push(...);
      continue;
      
    case 'latent':
      // Upgrade if new status is higher priority
      if (initialStatus !== 'latent') {
        await this.database.updateOpportunityStatus(existing.id, initialStatus);
        reactivatedOpportunities.push(...);
      }
      continue;
      
    case 'accepted':
    case 'rejected':
    case 'pending':
    case 'negotiating':
      if (isRecent) {
        // Skip — likely parallel job duplicate
        existingBetweenActors.push(...);
        continue;
      }
      // Else: allow new opportunity to be created (fall through)
      break;
  }
}
```

### Behavior by status

| Status | Behavior |
|--------|----------|
| `expired` | Reactivate to new status |
| `latent` | Upgrade if new status is higher priority |
| `stalled` | Reactivate to new status |
| `accepted` | Skip only if created within 10 min, else allow new |
| `rejected` | Skip only if created within 10 min, else allow new |
| `pending` | Skip only if created within 10 min, else allow new |
| `negotiating` | Skip only if created within 10 min, else allow new |

### Enricher (no change)

The enricher already excludes `accepted` and `negotiating` from its merge pool. This remains correct:
- New opportunity for already-connected pair is NOT merged into old accepted opp
- Each opportunity stays distinct
- IND-237 will surface them chronologically in h2h chat

### Side effects

**Fixes stuck `negotiating` bug:** If an opportunity is stuck in `negotiating` for >10 min, a new opportunity can surface, unsticking the pair.

## Files to change

| File | Change |
|------|--------|
| `packages/protocol/src/opportunity/opportunity.graph.ts` | Refactor persist-time dedup logic |
| `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts` | Add tests for new behavior |

## Test cases

1. **Parallel background jobs (IND-166 regression)** — Two jobs for same pair within seconds → only one opportunity created
2. **Long-connected pair, new discovery** — Connected 3 months ago, new intent triggers discovery → new opportunity created
3. **Stuck negotiating** — Opportunity in `negotiating` for >10 min → new opportunity surfaces
4. **Reactivation of stalled** — Stalled opportunity reactivated, not skipped

## Related

- IND-166: Original fix that introduced persist-time dedup
- IND-237: Show accepted opportunities inline in h2h chat (surfaces multiple accepted opps per pair)
