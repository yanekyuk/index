# Negotiation Debug Visibility

**Date:** 2026-04-17
**Status:** Approved for planning
**Scope:** Surface orchestrator-inline negotiations in both the persistent debug meta (`/debug/chat/:id` JSON export) and the live TRACE panel. Bundle previously-ephemeral chat trace events into persisted debug meta.

## Problem

Recent PRs introduced an orchestrator-inline negotiation flow: when a user clicks Start Chat on an opportunity, the orchestrator runs a short-window negotiation directly (no personal-agent park) and streams drafts back. The flow works, but its diagnostic surfaces are blind:

- `/debug/chat/:id` returns per-turn `debugMeta` (tools, graphs, agents) but nothing about the negotiations that ran. Negotiation conversations live in separate `tasks` + `messages` rows joined by `opportunityId`, and the debug endpoint never joins to them.
- The live TRACE panel (`ToolCallsDisplay.tsx`) renders `graph_start/end` and nested `agent_start/end`, but negotiation turns emitted by `negotiation.graph.ts` appear orphaned — its turn-level `agent_*` events are not graph-wrapped at the orchestrator layer, and the parser has no first-class rendering for negotiation turns or outcomes.
- Pre-existing gap bundled into this spec: `iteration_start`, `llm_start/end`, `response_reset`, and `hallucination_detected` events stream live but are never persisted into `debugMeta`, so they vanish on reload.

## Non-goals

- Persisting the live TRACE panel across reload (separate, tracked gap — same class as the streamingDrafts persistence gap).
- Instrumentation of subsystems that do not currently emit trace events during an orchestrator chat turn: `contact/`, `integration/`, `agent/`, `maintenance/`, `mcp/`. These do not run on a chat turn or do not have hooks; they are out of scope.
- Opportunity evaluator per-candidate scoring promotion (predates this regression — tracked separately).
- A dedicated `/debug/opportunities/:id` endpoint.

## Approach

**Hydrate at read time, capture minimal pointers at write time.**

- Negotiations are first-class persistent entities (`tasks` + `messages` + `opportunities`). Do not duplicate them into `debugMeta`.
- The chat message's `debugMeta` records only the `opportunityIds` negotiated during that turn as a pointer.
- `/debug/chat/:id` joins those pointers → negotiation conversation rows → turn messages + task state + opportunity outcome, and embeds the result per turn.
- For older messages lacking pointers, a bounded time-window fallback query keeps the endpoint retroactively useful.
- Live TRACE consumes new typed stream events (`negotiation_session_start/end`, `negotiation_turn`, `negotiation_outcome`) emitted by the negotiation graph and wrapped by `opportunity.graph.ts#negotiateNode`.

Alternatives considered:

- *Capture at emit time into debugMeta* — duplicates data already modeled in tables, ships nothing retroactive, couples chat metadata shape to negotiation shape.
- *Trace-stream-as-truth (persist the raw event log)* — full fidelity but large refactor of the existing rolled-up `debugMeta` shape and the UI parser; not justified by the recent regression.

## Design

### Protocol: new stream events

Added to the `AgentStreamEvent` discriminated union in `packages/protocol/src/chat/chat-streaming.types.ts`:

```ts
type NegotiationSessionEvent = {
  type: 'negotiation_session_start' | 'negotiation_session_end';
  opportunityId: string;
  negotiationConversationId: string;
  sourceUserId: string;
  candidateUserId: string;
  candidateName?: string;
  trigger: 'orchestrator' | 'ambient';
  startedAt: number;    // only on _start
  durationMs?: number;  // only on _end
};

type NegotiationTurnEvent = {
  type: 'negotiation_turn';
  opportunityId: string;
  negotiationConversationId: string;
  turnIndex: number;
  actor: 'source' | 'candidate';
  action: 'propose' | 'accept' | 'reject' | 'counter' | 'question';
  reasoning?: string;
  message?: string;
  suggestedRoles?: { ownUser?: string; otherUser?: string };
  durationMs: number;
};

type NegotiationOutcomeEvent = {
  type: 'negotiation_outcome';
  opportunityId: string;
  outcome: 'accepted' | 'rejected_stalled' | 'waiting_for_agent' | 'timed_out' | 'turn_cap';
  turnCount: number;
  reasoning?: string;
  agreedRoles?: { ownUser?: string; otherUser?: string };
};
```

**Emission sites:**

- `packages/protocol/src/negotiation/negotiation.graph.ts` turn node — emit `negotiation_turn` after each assessment+action resolves.
- `packages/protocol/src/negotiation/negotiation.graph.ts` terminal nodes — emit `negotiation_outcome` on every exit (accept, reject, turn cap, waiting_for_agent, timeout).
- `packages/protocol/src/opportunity/opportunity.graph.ts#negotiateNode` — wrap each per-candidate run with `negotiation_session_start` / `negotiation_session_end`, carrying trigger + user identities so the UI has a stable candidate-level grouping independent of graph topology.

Existing `agent_start/end` emissions in `negotiation.graph.ts` remain untouched for backward compatibility with the legacy `debugMeta.tools[].graphs[].agents[]` render path.

### Backend: `debugMeta` accumulator extension

Location: wherever the chat stream consumer builds per-turn `debugMeta` today (`backend/src/controllers/chat.controller.ts` or `backend/src/services/chat.service.ts` — identify precisely in plan phase).

The rolled-up shape is preserved. Add two fields:

```ts
debugMeta: {
  graph, iterations, tools,                  // existing
  llm: {                                      // NEW
    calls: number;
    totalDurationMs: number;
    resets: Array<{ reason: string; at: number }>;
    hallucinations: Array<{ claim: string; correction?: string; at: number }>;
  };
  orchestratorNegotiations?: {                // NEW
    opportunityIds: string[];
  };
};
```

Accumulation lives in the same loop as the existing `tools[]` builder. Mapping:

- `iteration_start` → count iterations (already tracked; formalize).
- `llm_start` / `llm_end` → increment `llm.calls`, accumulate `llm.totalDurationMs`.
- `response_reset` → append to `llm.resets`.
- `hallucination_detected` → append to `llm.hallucinations`.
- `negotiation_session_start` → push `opportunityId` into `orchestratorNegotiations.opportunityIds` (dedup).

### Backend: `/debug/chat/:id` hydration

Extend `getChatDebug` in `backend/src/controllers/debug.controller.ts`. After the existing per-turn build, for each turn:

1. Read `turn.debugMeta.orchestratorNegotiations?.opportunityIds`. If non-empty, use the **pointer path**; otherwise use the **fallback path**.
2. **Pointer path:** query `tasks` where `metadata->>opportunityId` ∈ those ids and `metadata->>type = 'negotiation'`.
3. **Fallback path (legacy messages):** query `opportunities` authored by the session user with `trigger='orchestrator'` created within a bounded window relative to the turn's `createdAt` (window size decided in plan phase; candidate: message timestamp ± 10 min). Then follow into `tasks` the same way.
4. For each matched task: fetch its `conversationId`, load `messages` ordered by `createdAt` with role='agent' and `parts` filtered to NegotiationTurn data parts.
5. Fetch the linked `opportunities` row for final `status`, `agreedRoles`, source/candidate user ids and names.
6. Embed as:

```ts
turn.negotiations: Array<{
  opportunityId: string;
  negotiationConversationId: string;
  taskState: 'working' | 'waiting_for_agent' | 'completed' | 'failed' | 'cancelled';
  sourceUserId: string;
  candidateUserId: string;
  candidateName: string;
  turns: Array<{
    turnIndex: number;
    actor: 'source' | 'candidate';
    action: 'propose' | 'accept' | 'reject' | 'counter' | 'question';
    reasoning?: string;
    message?: string;
    suggestedRoles?: { ownUser?: string; otherUser?: string };
    createdAt: string;
  }>;
  outcome: {
    status: string;
    turnCount: number;
    agreedRoles?: { ownUser?: string; otherUser?: string };
    reasoning?: string;
  } | null;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
}>;
```

Guards: keep the existing `DebugGuard + AuthGuard`. Cap negotiation turns loaded per opportunity at 20 to bound response size. If the cap is hit, include `{ turnsTruncated: true }` on the negotiation.

### Frontend: TRACE panel

Changes to `frontend/src/components/chat/ToolCallsDisplay.tsx` and the stream-event types file (which mirrors the protocol union).

**Parser updates (`parseTraceEvents`):** walk the stream, maintain a `negotiationsByOpportunityId` map scoped to the current tool call, and dispatch:

- `negotiation_session_start` → create node, attach to current tool call's `negotiations[]`.
- `negotiation_turn` → append to matching node's `turns[]`.
- `negotiation_outcome` → set matching node's `outcome`.
- `negotiation_session_end` → close node, record `durationMs`.

**Rendering (`NegotiationTree` subcomponent):** sibling to the existing graphs/agents tree inside an expanded tool block.

```
▾ create_opportunities (1.2s)
  ▸ Graphs
  ▾ Negotiations (3)
    ▾ 🟢 Alice Chen — accepted (4 turns, 820ms)
      1. [source] propose — "Overlap on pgvector tuning"
      2. [candidate] question — "Scope of the consulting engagement?"
      3. [source] counter — "Scoped to migration only"
      4. [candidate] accept — roles: agent/patient
    ▾ 🔴 Bob Lee — rejected_stalled (2 turns)
    ▾ ⏳ Carol Park — waiting_for_agent (1 turn, parked)
```

Icons: 🟢 accepted, 🔴 rejected_stalled / timed_out / turn_cap, ⏳ waiting_for_agent. Each turn row is compact with click-to-expand for full `reasoning` + `message`. Outcome summary on hover exposes `reasoning` tooltip.

**Persistent view:** the TRACE panel is live-only today. On reload, nothing renders. Out of scope for this spec; the persistent artifact is the `/debug/chat/:id` JSON export (which now includes `turn.negotiations` end-to-end).

## Testing

- `packages/protocol/src/negotiation/tests/negotiation.graph.spec.ts` — assert `negotiation_turn` emitted per turn with correct payload; `negotiation_outcome` emitted on every terminal path (accept, reject_stalled, turn_cap, waiting_for_agent, timed_out).
- `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts` — assert `negotiation_session_start/end` wrap each per-candidate run; `trigger` and ids propagate.
- `backend/tests/debug.chat.spec.ts` (new) — integration: orchestrator session with 2 candidates (1 accepted, 1 rejected). Call `/debug/chat/:id`. Assert `turns[i].negotiations` includes both with correct `taskState`, turn history, and outcome. Assert `llm.calls` and `iterations` are populated.
- `backend/tests/debug.chat.legacy.spec.ts` — legacy message (no `orchestratorNegotiations` pointer): fallback time-window hydration finds the same negotiations.
- `frontend` — snapshot test of `ToolCallsDisplay` rendering for a mixed trace stream with negotiation events across multiple candidates and outcomes.

## Files touched

Protocol:

- `packages/protocol/src/chat/chat-streaming.types.ts` — new event types added to the union.
- `packages/protocol/src/negotiation/negotiation.graph.ts` — emit turn + outcome.
- `packages/protocol/src/opportunity/opportunity.graph.ts` — emit session start/end around each per-candidate negotiation.

Backend:

- `backend/src/controllers/chat.controller.ts` (or `backend/src/services/chat.service.ts`) — `llm` accumulator + `orchestratorNegotiations.opportunityIds`.
- `backend/src/controllers/debug.controller.ts` — negotiation hydration in `getChatDebug`.

Frontend:

- `frontend/src/components/chat/ToolCallsDisplay.tsx` — parser branches + `NegotiationTree` subcomponent.
- frontend stream-event types file mirroring the protocol union.

Docs:

- `docs/design/protocol-deep-dive.md` — update Trace Event Instrumentation section with the four new event types and their emission contract.
- `CLAUDE.md` — brief note under Trace Event Instrumentation referencing negotiation events.

## Open items for plan phase

- Exact turn-index and `actor` semantics: confirm whether the `source` is always `turnIndex=0` in `negotiation.graph.ts` or whether the seed assessment occupies that slot.
- Retroactive fallback time window: propose ±10 min around the turn `createdAt`; validate against representative sessions before committing.
- Per-session payload cap: N candidates included in debug response (propose 25; surface `negotiationsTruncated: true` if exceeded).
- Precise location of the chat stream consumer that builds `debugMeta` today (`chat.controller.ts` vs `chat.service.ts`) — confirm during plan phase, do not guess.

## Acceptance

- `/debug/chat/:id` returns `turn.negotiations` populated end-to-end for a fresh orchestrator-triggered session with at least one accepted and one rejected candidate.
- `/debug/chat/:id` retroactively returns `turn.negotiations` (via fallback path) for an orchestrator session that predates the pointer write.
- `debugMeta.llm.{calls,totalDurationMs,resets,hallucinations}` populated on turns where those events fired.
- Live TRACE panel renders per-candidate negotiation nodes with turn children and outcome indicators during an active orchestrator run.
- All new tests pass; no regression in existing trace/graph/agent rendering.
