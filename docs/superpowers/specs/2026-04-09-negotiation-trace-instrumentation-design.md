# Negotiation Trace Instrumentation Design

**Date:** 2026-04-09
**Status:** Implemented

## Problem

The negotiation step in the opportunity discovery pipeline runs correctly (visible in the Chat Orchestrator UI), but is invisible in the structured debug export (Channel B). The session export JSON shows no `negotiate` step entries and no `negotiation` graph timing, making it appear as though negotiation never ran.

### Root Cause

There are two parallel trace channels:

- **Channel A (real-time SSE):** The negotiate node emits `graph_start`/`graph_end` via `traceEmitter` in `requestContext`. These events stream to the frontend TRACE panel via `ChatStreamer`. Negotiation IS visible here.
- **Channel B (structured JSON export):** The `_graphTimings` and `debugSteps` arrays are built manually in `opportunity.tools.ts`. Only scope graphs (`index`) and the top-level `opportunity` graph are explicitly added. The negotiate node did not contribute to `result.trace` or any state accumulator, so nothing appeared in the export.

### Key Files

| File | Role |
|------|------|
| `packages/protocol/src/opportunity/opportunity.graph.ts` | Negotiate node. Emits Channel A events; now also pushes to `trace` state (Channel B). |
| `packages/protocol/src/opportunity/opportunity.tools.ts` | Builds `_graphTimings` and `debugSteps` from graph result. Now extracts negotiation timing. |
| `packages/protocol/src/opportunity/opportunity.state.ts` | `OpportunityGraphState` definition. Existing `trace` field (append reducer) used -- no new fields needed. |
| `packages/protocol/src/chat/chat.agent.ts` | `normalizeToolResult()` extracts `_graphTimings`/`debugSteps` from tool JSON. Unchanged. |

## Decisions

- **Granularity:** Graph-level timing + summary steps (per-candidate outcomes). Not full turn-level detail.
- **Scope:** Channel B only (structured debug export). Channel A keeps existing `graph_start`/`graph_end` -- no `TraceEmitter` type extension.
- **Approach:** Uses existing `trace` append reducer in `OpportunityGraphState` -- no new state fields needed. The negotiate node pushes trace entries; the tools layer extracts negotiation timing from those entries for `_graphTimings`.

## Design

### 1. No State Schema Change Needed

The existing `trace` field in `OpportunityGraphState` (line 377 of `opportunity.state.ts`) uses an append reducer:
```typescript
trace: Annotation<Array<{ node: string; detail?: string; data?: Record<string, unknown> }>>({
    reducer: (curr, next) => [...curr, ...(next || [])],
    default: () => [],
}),
```

Returning `{ trace: [...entries] }` from any node appends those entries automatically. No new fields required.

### 2. Negotiate Node Changes (`opportunity.graph.ts`)

After `negotiateCandidates()` returns, the negotiate node:
1. Compares `acceptedResults` against `candidates` to identify rejected candidates
2. Builds trace entries with summary + per-candidate outcomes
3. Embeds `durationMs` in the summary entry's `data` for the tools layer to extract
4. Returns `{ evaluatedOpportunities, trace: negotiateTrace }`

On error, returns a single trace entry with `{ error: true }`.

When `this.negotiationGraph` is not set, early-returns `{}` (no trace = negotiation skipped).

### 3. Tools Layer Changes (`opportunity.tools.ts`)

After building `allDebugSteps`, the tools layer:
1. Searches for a `negotiate` step entry with `data.durationMs`
2. If found, builds `_allGraphTimings` by appending `{ name: 'negotiation', durationMs, agents: [] }` to `_discoverGraphTimings`
3. All return paths in the discovery section use `_allGraphTimings` instead of `_discoverGraphTimings`

### 4. Expected Output

The debug export for a `create_opportunities` tool call now includes:

```json
{
  "steps": [
    { "step": "resolve_index_scope", "detail": "12 index(es)" },
    { "step": "prep", "detail": "12 network(s), 8 intent(s), profile loaded" },
    { "step": "scope", "detail": "Searching 12 index(es): ..." },
    { "step": "discovery", "detail": "Profile-based search -> 300 candidate(s)" },
    { "step": "threshold_filter", "detail": "20 above 0.40, 5 below (batch of 25)" },
    { "step": "evaluation", "detail": "Evaluated 25 candidate(s) -> 17 passed (min score 50)" },
    { "step": "candidate", "detail": "Grace Howard: passed" },
    { "step": "negotiate", "detail": "5 candidate(s) -> 3 accepted, 2 rejected", "data": { "durationMs": 4500, "candidateCount": 5, "acceptedCount": 3, "rejectedCount": 2 } },
    { "step": "negotiate_candidate", "detail": "Grace Howard: accepted (95)", "data": { "userId": "...", "name": "Grace Howard", "outcome": "accepted", "score": 95, "turns": 2 } },
    { "step": "negotiate_candidate", "detail": "Yuki Tanaka: rejected", "data": { "userId": "...", "name": "Yuki Tanaka", "outcome": "rejected", "turns": 0 } },
    { "step": "persist", "detail": "Created 2, reactivated 1, 0 existing skipped" }
  ],
  "graphs": [
    { "name": "index", "durationMs": 1253, "agents": [] },
    { "name": "opportunity", "durationMs": 22507, "agents": [] },
    { "name": "negotiation", "durationMs": 4500, "agents": [] }
  ]
}
```

## Files Changed

| File | Change |
|------|--------|
| `packages/protocol/src/opportunity/opportunity.graph.ts` | Negotiate node builds and returns trace entries via existing `trace` state field |
| `packages/protocol/src/opportunity/opportunity.tools.ts` | Extracts negotiation timing from trace entries, appends to `_graphTimings` via `_allGraphTimings` |

## Files NOT Changed

- `packages/protocol/src/opportunity/opportunity.state.ts` (existing `trace` field suffices)
- `TraceEmitter` type (`request-context.ts`)
- `ChatStreamer` (`chat.streamer.ts`)
- `ChatAgent.normalizeToolResult()` (`chat.agent.ts`)
- `negotiateCandidates()` or `negotiation.graph.ts`
- Frontend
