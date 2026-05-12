# `discover_opportunities` MCP — Timeout with Deferred Surfacing

**Date:** 2026-05-12
**Linear:** [IND-286](https://linear.app/indexnetwork/issue/IND-286)
**Status:** Approved for implementation; lands **after** [IND-287](https://linear.app/indexnetwork/issue/IND-287).
**Scope:** Temporary fix. Cleanly removable when [IND-274](https://linear.app/indexnetwork/issue/IND-274) (negotiation conversation continuation) ships.

## Problem

The `discover_opportunities` MCP tool's end-to-end request runs ~79s, dominated by ~51s in the negotiate phase (3 candidates × 6 turns × `gemini-2.5-flash` calls, parallel per-candidate). Railway's edge proxy 502s the client at ~57s. The client never sees the persisted opportunities, even though the backend completes successfully a few seconds after the timeout.

Independently, `state.opportunities` is captured at persist time and never refreshed by the negotiate node, so the response carries stale persist-time status snapshots instead of the post-negotiate statuses the DB holds. This fix refreshes from DB before responding — natural side-improvement, not the primary goal.

The status-flow correctness (MCP-as-orchestrator wiring, `actedAt` per-actor tracking, self-accept guard) is in IND-287, which must land first. After IND-287, accepted MCP candidates produce `draft` — that's what this fix's response filter looks for.

## Goal

Cap the negotiate phase at 20 seconds. Return whichever candidates the agents finished negotiating within that window as `draft` cards. Surface the remainder as a count, with an instruction to ask `list_opportunities` later.

## Non-goals

- **First-time pair latency.** Continuation (IND-274) is the durable fix.
- **Resume of in-flight negotiations after process death.** Accepted as a bounded loss; covered by IND-279's orphan heal.
- **Behavior changes for chat, ambient queue jobs, or any non-MCP caller of `runDiscoverFromQuery`.** This fix is MCP-only.
- **Status-flow correctness.** Owned by IND-287.

## Design

### 1. Negotiate-phase timer

Add `negotiateTimeoutMs?: number` to `OpportunityGraphOptions`. The MCP tool sets it to `20_000`; chat, ambient queue, and all other callers omit it (existing behavior).

In `opportunity.graph.ts:negotiateNode`, when `state.options.negotiateTimeoutMs` is set:

```ts
const negotiationWork = negotiateCandidates(/* unchanged */);
const timerWork = new Promise<typeof TIMER_SENTINEL>(resolve =>
  setTimeout(() => resolve(TIMER_SENTINEL), state.options.negotiateTimeoutMs!)
);

const racedResult = await Promise.race([negotiationWork, timerWork]);
const timedOut = racedResult === TIMER_SENTINEL;

if (timedOut) {
  // Do NOT await the unresolved promise. Do NOT cancel via abort.
  // The promise continues in the Bun event loop; each candidate's chain
  // eventually reaches finalize and updates its opp's DB status.
  // Floating-promise lint exemption documented inline.
  void negotiationWork;
  return { trace: [{ node: 'negotiate', detail: 'timed_out', data: { negotiateTimeoutMs: state.options.negotiateTimeoutMs } }] };
}

// Normal path: continue with existing post-negotiate logic from racedResult.
```

This race is the only behavioral change in the graph. `negotiateCandidates` itself is untouched.

### 2. Status refresh before response

In the MCP `discover_opportunities` tool handler (`opportunity.tools.ts`), after `runDiscoverFromQuery` returns:

1. Collect opp IDs from `result.opportunities`.
2. Single batched query: `database.getOpportunitiesByIds(ids)`. Add this method if missing (`WHERE id = ANY($1)`).
3. Partition the **newly-created opportunities from this run** by current status:
   - `draft` → render as cards (the actionable, post-negotiation result; produced by the orchestrator wiring landed in IND-287).
   - `negotiating` → count only.
   - `rejected`, `stalled` → drop entirely.
   - `pending`, `latent` → not expected under IND-287's wiring. If observed, log a warning and treat as `negotiating` (count only).

   The existing-connections path (`existingConnectionsForCards`, `opportunity.discover.ts:719`) is untouched. Re-surfaced opps from prior runs continue to be cards per `EXISTING_CONNECTION_CARD_STATUSES`.

4. Build the response message:

   - `draftCount > 0`, `negotiatingCount = 0` → existing "Found N potential connections" lead-in + cards.
   - `draftCount > 0`, `negotiatingCount > 0` → lead-in + cards + trailing: "N more opportunities are still being evaluated — check back via `list_opportunities` shortly."
   - `draftCount = 0`, `negotiatingCount > 0` → no cards. "Found candidates, but they're still being evaluated. Try `list_opportunities` in a minute — N pending."
   - Both zero → existing "No matches found" path (unchanged).

The "existing connections", "already accepted", and `createIntentSuggested` branches in `runDiscoverFromQuery` run before negotiate and are unaffected.

### 3. Background safety — accepted loss

When the process dies mid-negotiation (Railway redeploy, SIGTERM, container restart), the unresolved `negotiateCandidates` promises vanish. Opportunities left in `negotiating` are orphaned until manual cleanup or IND-279 ships.

- **Bounded blast radius:** at most 20s of in-flight work risked per MCP request.
- **No new code to mitigate:** a retry/resume worker would re-introduce most of IND-274's complexity.
- **Manual recovery available:** existing `maintenance:reset-brokers` or a one-line SQL update.

The implementation logs a single `logger.warn` each time the timer fires, with user ID, opp count, and negotiating-count, so volume is observable.

### 4. Testing

- **Unit test** (in `packages/protocol/src/opportunity/tests/`): with `negotiateTimeoutMs` set and `negotiateCandidates` mocked to hang, `negotiateNode` returns within the budget and emits the `timed_out` trace.
- **Integration test** (in `backend/tests/`): MCP-shaped `discover_opportunities` call with a deterministic mocked negotiator where some candidates finalize fast and some hang; assert the response contains `draft` cards for the fast ones, the count message reflects the hanging count, and no other statuses appear as cards.
- **No new test** for the post-timer background-completion path; covered indirectly by the unit-level race + DB-driven status refresh.

## Files touched

| File | Change |
|---|---|
| `packages/protocol/src/opportunity/opportunity.tools.ts` | Set `negotiateTimeoutMs: 20_000` when MCP calls `runDiscoverFromQuery`. Status refresh + response partitioning. |
| `packages/protocol/src/opportunity/opportunity.state.ts` | Add `negotiateTimeoutMs?: number` to `OpportunityGraphOptions`. |
| `packages/protocol/src/opportunity/opportunity.graph.ts` | Race in `negotiateNode` when `negotiateTimeoutMs` is set. |
| `packages/protocol/src/opportunity/opportunity.discover.ts` | Propagate `negotiateTimeoutMs` through `OpportunityGraphOptions`. |
| `backend/src/adapters/database.adapter.ts` | Add `getOpportunitiesByIds` if missing. |
| `packages/protocol/src/opportunity/tests/` | Unit test for the race. |
| `backend/tests/` | Integration test for the end-to-end shape. |

## Rollback

To disable the race, omit `negotiateTimeoutMs` from the MCP tool's call to `runDiscoverFromQuery`. (Setting it to `0` would fire the timer instantly — not a clean revert. Omit the option entirely.) No schema changes; no migration to undo.

## Forward compatibility with IND-274

When continuation lands:

- The 20s budget can be lowered or removed entirely (per-call cap shrinks because conversations resume from prior turns).
- The "fire-and-forget background" pattern naturally subsumes into IND-274's per-pair lock + heal-on-stale-lock (IND-277, IND-279), which eliminate the orphan-`negotiating` risk.

This spec's deltas are deliberately small and localized so removal is a single revert plus a status-refresh-stays edit.
