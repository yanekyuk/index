# Negotiation Debug Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface orchestrator-inline negotiations in `/debug/chat/:id` JSON and in the live TRACE panel; persist previously-ephemeral chat trace events (`iteration_start`, `llm_start/end`, `response_reset`, `hallucination_detected`) into `debugMeta`.

**Architecture:** Negotiations stay in `tasks` + `messages` + `opportunities`; the chat message's `debugMeta` records only a small `orchestratorNegotiations.opportunityIds` pointer, and `/debug/chat/:id` hydrates through that pointer. Protocol emits four new typed stream events (`negotiation_session_start/end`, `negotiation_turn`, `negotiation_outcome`) so the live TRACE panel can render per-candidate negotiation nodes. Legacy messages without pointers fall through a bounded time-window query.

**Tech Stack:** TypeScript, Bun, Drizzle ORM (Postgres), LangGraph, React 19, Vite, Tailwind. Tests via `bun:test` in the protocol and backend workspaces; Vitest/RTL-compatible runners in frontend.

**Spec:** `docs/superpowers/specs/2026-04-17-negotiation-debug-visibility-design.md`

---

## File structure

Files created or modified, grouped by responsibility:

**Protocol — stream event contract + emission (`packages/protocol/src/`):**
- `chat/chat-streaming.types.ts` — extend `ChatStreamEventType`, add four new event interfaces, append to `ChatStreamEvent` union, add creator helpers.
- `chat/chat.agent.ts` — extend inline `AgentStreamEvent` union (lines 59–73) with the four new types; extend `streamRun` return type + `debugMeta` shape; accumulate `llm` counters and `orchestratorNegotiations.opportunityIds`.
- `chat/chat.state.ts` — update the LangGraph `debugMeta` Annotation to match new shape.
- `chat/chat.streamer.ts` — update pass-through of `debugMeta` to include new fields.
- `negotiation/negotiation.graph.ts` — emit `negotiation_turn` in `turnNode`; emit `negotiation_outcome` from `finalizeNode` on every terminal path; emit `negotiation_session_start/end` in `negotiateCandidates` (replaces nothing — coexists with the existing `agent_start/end` for backward compat).
- `opportunity/opportunity.graph.ts` — pass `trigger` (`'orchestrator' | 'ambient'`) through to `negotiateCandidates` via its `opts`.

**Protocol — tests:**
- `negotiation/tests/negotiation.graph.spec.ts` — new spec file or extend existing negotiation test: assert turn/outcome events emitted on each terminal path.
- `chat/tests/chat.agent.spec.ts` — extend: assert `debugMeta.llm.*` populated from a scripted iteration.

**Backend — accumulator + debug endpoint (`backend/src/`):**
- `controllers/chat.controller.ts` — the stream-consumer loop (lines 252–356) persists the expanded debugMeta unchanged (pass-through). Minor: extend type annotation on the local `debugMeta` binding.
- `controllers/debug.controller.ts#getChatDebug` (lines 519–691) — for each turn, read `orchestratorNegotiations.opportunityIds`; pointer-path or fallback-path join; embed `turn.negotiations[]`.

**Backend — tests:**
- `backend/tests/debug.chat.negotiations.spec.ts` (new) — integration: seed an orchestrator session with accepted + rejected candidates; assert `/debug/chat/:id` returns populated `turn.negotiations`.
- `backend/tests/debug.chat.legacy.spec.ts` (new) — integration: seed a session without pointer; assert fallback path still returns negotiations.

**Frontend — types + parser + render (`frontend/src/`):**
- `contexts/AIChatContext.tsx` — extend `TraceEventType` and `TraceEvent`; extend SSE handler to map new events; extend `mergeDebugMetaIntoTraceEvents` stub (no-op — debug meta for negotiations lives at `/debug/chat/:id`, not on the message).
- `components/chat/ToolCallsDisplay.tsx` — extend `ToolNode` with `negotiations: NegotiationNode[]`; add parser branches; new `NegotiationTree` subcomponent.
- `components/chat/tests/ToolCallsDisplay.test.tsx` (new if no tests dir) — snapshot test of negotiation rendering.

**Docs:**
- `docs/design/protocol-deep-dive.md` — update Trace Event Instrumentation with the four new event types and emission contract.
- `CLAUDE.md` — append one paragraph under Trace Event Instrumentation pointing to negotiation events.

---

## Task 0: Setup — create worktree

**Files:**
- Create: `.worktrees/feat-negotiation-debug-visibility/` (worktree root)

- [ ] **Step 1: Create worktree from dev and symlink envs**

```bash
cd /home/yanek/Projects/index
git worktree add .worktrees/feat-negotiation-debug-visibility -b feat/negotiation-debug-visibility dev
bun run worktree:setup feat-negotiation-debug-visibility
```

Expected: worktree created, `.env` symlinks in `backend/` and `frontend/` under the worktree, node_modules installed.

- [ ] **Step 2: Verify worktree is clean**

```bash
cd .worktrees/feat-negotiation-debug-visibility && git status
```

Expected: `On branch feat/negotiation-debug-visibility. nothing to commit, working tree clean`.

All subsequent tasks run from this worktree path.

---

## Task 1: Add new stream event types to protocol

**Files:**
- Modify: `packages/protocol/src/chat/chat-streaming.types.ts`
- Modify: `packages/protocol/src/chat/chat.agent.ts:59-73`

- [ ] **Step 1: Extend `ChatStreamEventType` union**

In `packages/protocol/src/chat/chat-streaming.types.ts` lines 9–37, append the four new discriminators to the `ChatStreamEventType` union:

```ts
export type ChatStreamEventType =
  | "status"
  | "routing"
  | "thinking"
  | "subgraph_start"
  | "subgraph_result"
  | "token"
  | "done"
  | "error"
  | "tool_start"
  | "tool_end"
  | "agent_thinking"
  | "tool_activity"
  | "iteration_start"
  | "llm_start"
  | "llm_end"
  | "response_complete"
  | "response_reset"
  | "debug_meta"
  | "graph_start"
  | "graph_end"
  | "agent_start"
  | "agent_end"
  | "hallucination_detected"
  // Orchestrator-inline negotiation trace events
  | "negotiation_session_start"
  | "negotiation_session_end"
  | "negotiation_turn"
  | "negotiation_outcome";
```

- [ ] **Step 2: Add the four new event interfaces**

After `AgentEndEvent` (line 403), before the `ChatStreamEvent` union declaration, append:

```ts
/** Orchestrator per-candidate negotiation wrapper — emitted from `negotiateCandidates`. */
export interface NegotiationSessionStartEvent extends ChatStreamEventBase {
  type: "negotiation_session_start";
  opportunityId: string;
  negotiationConversationId: string;
  sourceUserId: string;
  candidateUserId: string;
  candidateName?: string;
  trigger: "orchestrator" | "ambient";
  startedAt: number;
}

export interface NegotiationSessionEndEvent extends ChatStreamEventBase {
  type: "negotiation_session_end";
  opportunityId: string;
  negotiationConversationId: string;
  durationMs: number;
}

/** One turn inside a bilateral negotiation. Emitted by the negotiation graph's turn node. */
export interface NegotiationTurnEvent extends ChatStreamEventBase {
  type: "negotiation_turn";
  opportunityId: string;
  negotiationConversationId: string;
  turnIndex: number;
  actor: "source" | "candidate";
  action: "propose" | "accept" | "reject" | "counter" | "question";
  reasoning?: string;
  message?: string;
  suggestedRoles?: { ownUser?: string; otherUser?: string };
  durationMs: number;
}

export interface NegotiationOutcomeEvent extends ChatStreamEventBase {
  type: "negotiation_outcome";
  opportunityId: string;
  outcome:
    | "accepted"
    | "rejected_stalled"
    | "waiting_for_agent"
    | "timed_out"
    | "turn_cap";
  turnCount: number;
  reasoning?: string;
  agreedRoles?: { ownUser?: string; otherUser?: string };
}
```

- [ ] **Step 3: Append the interfaces to the `ChatStreamEvent` union**

In the union declaration (lines 408–437), append:

```ts
  | NegotiationSessionStartEvent
  | NegotiationSessionEndEvent
  | NegotiationTurnEvent
  | NegotiationOutcomeEvent;
```

- [ ] **Step 4: Add creator helpers**

After the last creator helper in the file (`createAgentEndEvent`, line 815), append:

```ts
export function createNegotiationSessionStartEvent(
  sessionId: string,
  payload: Omit<NegotiationSessionStartEvent, "type" | "sessionId" | "timestamp">,
): NegotiationSessionStartEvent {
  return createStreamEvent<NegotiationSessionStartEvent>(
    "negotiation_session_start",
    sessionId,
    payload,
  );
}

export function createNegotiationSessionEndEvent(
  sessionId: string,
  payload: Omit<NegotiationSessionEndEvent, "type" | "sessionId" | "timestamp">,
): NegotiationSessionEndEvent {
  return createStreamEvent<NegotiationSessionEndEvent>(
    "negotiation_session_end",
    sessionId,
    payload,
  );
}

export function createNegotiationTurnEvent(
  sessionId: string,
  payload: Omit<NegotiationTurnEvent, "type" | "sessionId" | "timestamp">,
): NegotiationTurnEvent {
  return createStreamEvent<NegotiationTurnEvent>("negotiation_turn", sessionId, payload);
}

export function createNegotiationOutcomeEvent(
  sessionId: string,
  payload: Omit<NegotiationOutcomeEvent, "type" | "sessionId" | "timestamp">,
): NegotiationOutcomeEvent {
  return createStreamEvent<NegotiationOutcomeEvent>(
    "negotiation_outcome",
    sessionId,
    payload,
  );
}
```

- [ ] **Step 5: Extend the inline `AgentStreamEvent` union in `chat.agent.ts`**

In `packages/protocol/src/chat/chat.agent.ts` lines 54–75, the inline discriminated union `AgentStreamEvent` does NOT carry `sessionId`/`timestamp` (those are added by the streamer). Append:

```ts
  | {
      type: "negotiation_session_start";
      opportunityId: string;
      negotiationConversationId: string;
      sourceUserId: string;
      candidateUserId: string;
      candidateName?: string;
      trigger: "orchestrator" | "ambient";
      startedAt: number;
    }
  | {
      type: "negotiation_session_end";
      opportunityId: string;
      negotiationConversationId: string;
      durationMs: number;
    }
  | {
      type: "negotiation_turn";
      opportunityId: string;
      negotiationConversationId: string;
      turnIndex: number;
      actor: "source" | "candidate";
      action: "propose" | "accept" | "reject" | "counter" | "question";
      reasoning?: string;
      message?: string;
      suggestedRoles?: { ownUser?: string; otherUser?: string };
      durationMs: number;
    }
  | {
      type: "negotiation_outcome";
      opportunityId: string;
      outcome:
        | "accepted"
        | "rejected_stalled"
        | "waiting_for_agent"
        | "timed_out"
        | "turn_cap";
      turnCount: number;
      reasoning?: string;
      agreedRoles?: { ownUser?: string; otherUser?: string };
    };
```

- [ ] **Step 6: Typecheck**

```bash
cd backend && bun run lint 2>&1 | head -40
cd ../packages/protocol && npx tsc --noEmit 2>&1 | head -40
```

Expected: no new errors about the added types; existing code untouched.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/chat/chat-streaming.types.ts packages/protocol/src/chat/chat.agent.ts
git -c commit.gpgsign=false commit -m "feat(chat-stream): add negotiation session/turn/outcome event types"
```

---

## Task 2: Emit `negotiation_turn` from `turnNode`

**Files:**
- Modify: `packages/protocol/src/negotiation/negotiation.graph.ts` (turnNode, lines 80–199)
- Test: `packages/protocol/src/negotiation/tests/negotiation.graph.spec.ts` (may already exist; extend it)

- [ ] **Step 1: Write the failing test**

Create or extend `packages/protocol/src/negotiation/tests/negotiation.graph.spec.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import type { NegotiationGraphState } from "../negotiation.state.js";

// Helpers: minimal stubs for database / dispatcher / timeoutQueue.
function mkStubs() {
  const messages: Array<{ id: string; senderId: string; parts: unknown[]; createdAt: Date }> = [];
  const database = {
    createConversation: async () => ({ id: "conv-1" }),
    createTask: async () => ({ id: "task-1" }),
    updateOpportunityStatus: async () => {},
    createMessage: async (p: { conversationId: string; senderId: string; parts: unknown[] }) => {
      const msg = { id: `msg-${messages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
      messages.push(msg);
      return msg;
    },
    updateTaskState: async () => {},
    createArtifact: async () => {},
    setTaskTurnContext: async () => {},
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasPersonalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no-agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  return { database, dispatcher, messages };
}

describe("negotiation graph — negotiation_turn emission", () => {
  it("emits negotiation_turn with correct payload after each turn", async () => {
    const { database, dispatcher } = mkStubs();
    const factory = new NegotiationGraphFactory(database, dispatcher);
    const graph = factory.createGraph();

    const events: Array<Record<string, unknown>> = [];
    const traceEmitter = (e: Record<string, unknown>) => events.push(e);

    const { requestContext } = await import("../../shared/observability/request-context.js");
    await requestContext.run({ traceEmitter }, async () => {
      await graph.invoke({
        sourceUser: { id: "u-src", name: "Alice" },
        candidateUser: { id: "u-cand", name: "Bob" },
        indexContext: { networkId: "net-1", prompt: "" },
        seedAssessment: { reasoning: "x", valencyRole: "peer" },
        opportunityId: "opp-1",
        maxTurns: 2,
      } as Partial<typeof NegotiationGraphState.State>);
    });

    const turnEvents = events.filter((e) => e.type === "negotiation_turn");
    expect(turnEvents.length).toBeGreaterThanOrEqual(1);
    const first = turnEvents[0];
    expect(first.opportunityId).toBe("opp-1");
    expect(first.negotiationConversationId).toBe("conv-1");
    expect(first.turnIndex).toBe(0);
    expect(first.actor).toBe("source");
    expect(typeof first.action).toBe("string");
    expect(typeof first.durationMs).toBe("number");
  }, 30000);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd packages/protocol && bun test src/negotiation/tests/negotiation.graph.spec.ts -t "negotiation_turn emission" 2>&1 | tail -30
```

Expected: test fails (`turnEvents.length` is 0 because we don't emit the event yet).

- [ ] **Step 3: Emit `negotiation_turn` after each successful turn**

In `negotiation.graph.ts` turnNode, after the message is persisted and task state is updated (currently line 172 `await database.updateTaskState(state.taskId, "working");`), and before the return block (line 174), insert:

```ts
        traceEmitter?.({
          type: "negotiation_turn",
          opportunityId: state.opportunityId ?? "",
          negotiationConversationId: state.conversationId,
          turnIndex: state.turnCount,
          actor: isSource ? "source" : "candidate",
          action: turn.action,
          ...(turn.assessment?.reasoning && { reasoning: turn.assessment.reasoning }),
          ...(turn.message && { message: turn.message }),
          ...(turn.assessment?.suggestedRoles && { suggestedRoles: turn.assessment.suggestedRoles }),
          durationMs: Date.now() - agentStart,
        });
```

Do not remove the existing `agent_end` emission on line 155 — it stays for backward-compat consumers of the rolled-up `debugMeta.tools[].graphs[].agents[]` path.

- [ ] **Step 4: Run and watch it pass**

```bash
cd packages/protocol && bun test src/negotiation/tests/negotiation.graph.spec.ts -t "negotiation_turn emission" 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/negotiation/negotiation.graph.ts packages/protocol/src/negotiation/tests/negotiation.graph.spec.ts
git -c commit.gpgsign=false commit -m "feat(negotiation): emit negotiation_turn per turn with action + reasoning"
```

---

## Task 3: Emit `negotiation_outcome` from every terminal path

**Files:**
- Modify: `packages/protocol/src/negotiation/negotiation.graph.ts` (finalizeNode lines 212–272; turnNode `waiting_for_agent` branch lines 121–140)
- Test: extend `packages/protocol/src/negotiation/tests/negotiation.graph.spec.ts`

- [ ] **Step 1: Write failing tests for accept / reject / turn_cap / waiting_for_agent**

Append to the same spec file:

```ts
describe("negotiation graph — negotiation_outcome emission", () => {
  it("emits negotiation_outcome with outcome='accepted' when finalize runs after an accept turn", async () => {
    // Scripted dispatcher: first turn 'propose', second turn 'accept'
    let call = 0;
    const scripted = [
      { action: "propose", assessment: { reasoning: "r1", suggestedRoles: { ownUser: "agent", otherUser: "patient" } } },
      { action: "accept",  assessment: { reasoning: "r2", suggestedRoles: { ownUser: "agent", otherUser: "patient" } } },
    ];
    const { database } = mkStubs();
    const dispatcher = {
      hasPersonalAgent: async () => false,
      dispatch: async () => {
        // Force the system-agent path to return our scripted turn
        return { handled: false, reason: "no-agent" } as const;
      },
    } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];
    // Swap the system agent via a partial spy on IndexNegotiator.invoke
    const { IndexNegotiator } = await import("../negotiation.agent.js");
    const origInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function () {
      return scripted[Math.min(call++, scripted.length - 1)] as never;
    };

    try {
      const factory = new NegotiationGraphFactory(database, dispatcher);
      const graph = factory.createGraph();
      const events: Array<Record<string, unknown>> = [];
      const { requestContext } = await import("../../shared/observability/request-context.js");
      await requestContext.run({ traceEmitter: (e) => events.push(e) }, async () => {
        await graph.invoke({
          sourceUser: { id: "u-src" },
          candidateUser: { id: "u-cand" },
          indexContext: { networkId: "net-1", prompt: "" },
          seedAssessment: { reasoning: "x", valencyRole: "peer" },
          opportunityId: "opp-2",
          maxTurns: 4,
        } as Partial<typeof NegotiationGraphState.State>);
      });

      const outcome = events.find((e) => e.type === "negotiation_outcome");
      expect(outcome).toBeTruthy();
      expect(outcome!.opportunityId).toBe("opp-2");
      expect(outcome!.outcome).toBe("accepted");
      expect(outcome!.turnCount).toBe(2);
    } finally {
      IndexNegotiator.prototype.invoke = origInvoke;
    }
  }, 30000);

  it("emits outcome='turn_cap' when maxTurns is reached without accept/reject", async () => {
    const { database } = mkStubs();
    const dispatcher = { hasPersonalAgent: async () => false, dispatch: async () => ({ handled: false, reason: "no-agent" }) } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];
    const { IndexNegotiator } = await import("../negotiation.agent.js");
    const orig = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async () => ({ action: "counter", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } as never);
    try {
      const graph = new NegotiationGraphFactory(database, dispatcher).createGraph();
      const events: Array<Record<string, unknown>> = [];
      const { requestContext } = await import("../../shared/observability/request-context.js");
      await requestContext.run({ traceEmitter: (e) => events.push(e) }, async () => {
        await graph.invoke({
          sourceUser: { id: "u-src" }, candidateUser: { id: "u-cand" },
          indexContext: { networkId: "net-1", prompt: "" },
          seedAssessment: { reasoning: "x", valencyRole: "peer" },
          opportunityId: "opp-3", maxTurns: 2,
        } as Partial<typeof NegotiationGraphState.State>);
      });
      const outcome = events.find((e) => e.type === "negotiation_outcome");
      expect(outcome?.outcome).toBe("turn_cap");
      expect(outcome?.turnCount).toBe(2);
    } finally {
      IndexNegotiator.prototype.invoke = orig;
    }
  }, 30000);

  it("emits outcome='waiting_for_agent' when dispatcher parks the turn", async () => {
    const { database } = mkStubs();
    const dispatcher = { hasPersonalAgent: async () => true, dispatch: async () => ({ handled: false, reason: "waiting" as const }) } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];
    const graph = new NegotiationGraphFactory(database, dispatcher).createGraph();
    const events: Array<Record<string, unknown>> = [];
    const { requestContext } = await import("../../shared/observability/request-context.js");
    await requestContext.run({ traceEmitter: (e) => events.push(e) }, async () => {
      await graph.invoke({
        sourceUser: { id: "u-src" }, candidateUser: { id: "u-cand" },
        indexContext: { networkId: "net-1", prompt: "" },
        seedAssessment: { reasoning: "x", valencyRole: "peer" },
        opportunityId: "opp-4", maxTurns: 4,
      } as Partial<typeof NegotiationGraphState.State>);
    });
    const outcome = events.find((e) => e.type === "negotiation_outcome");
    expect(outcome?.outcome).toBe("waiting_for_agent");
  }, 30000);
});
```

- [ ] **Step 2: Run and watch all three fail**

```bash
cd packages/protocol && bun test src/negotiation/tests/negotiation.graph.spec.ts -t "negotiation_outcome emission" 2>&1 | tail -40
```

Expected: all three new tests fail (no `negotiation_outcome` events emitted).

- [ ] **Step 3: Emit `negotiation_outcome` in `finalizeNode`**

In `negotiation.graph.ts` finalizeNode, modify the `status === 'waiting_for_agent'` early-return (line 212–215) to emit first:

```ts
    const finalizeNode = async (state: typeof NegotiationGraphState.State) => {
      const traceEmitter = requestContext.getStore()?.traceEmitter;

      if (state.status === 'waiting_for_agent') {
        traceEmitter?.({
          type: "negotiation_outcome",
          opportunityId: state.opportunityId ?? "",
          outcome: "waiting_for_agent",
          turnCount: state.turnCount,
        });
        return {};
      }
      // ... existing body unchanged until `return { outcome, status: 'completed' as const };`
```

Then, just before the final `return { outcome, status: 'completed' as const };` at line 271, insert:

```ts
      const emittedOutcome: "accepted" | "rejected_stalled" | "turn_cap" | "timed_out" =
        hasOpportunity
          ? "accepted"
          : atCap
          ? "turn_cap"
          : lastTurn?.action === "reject"
          ? "rejected_stalled"
          : state.error && /timeout/i.test(state.error)
          ? "timed_out"
          : "rejected_stalled";

      traceEmitter?.({
        type: "negotiation_outcome",
        opportunityId: state.opportunityId ?? "",
        outcome: emittedOutcome,
        turnCount: state.turnCount,
        ...(outcome.reasoning && { reasoning: outcome.reasoning }),
        ...(hasOpportunity && agreedRoles.length >= 2 && {
          agreedRoles: {
            ownUser: agreedRoles[0]?.role,
            otherUser: agreedRoles[1]?.role,
          },
        }),
      });
```

- [ ] **Step 4: Run and watch them pass**

```bash
cd packages/protocol && bun test src/negotiation/tests/negotiation.graph.spec.ts -t "negotiation_outcome emission" 2>&1 | tail -20
```

Expected: all three new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/negotiation/negotiation.graph.ts packages/protocol/src/negotiation/tests/negotiation.graph.spec.ts
git -c commit.gpgsign=false commit -m "feat(negotiation): emit negotiation_outcome on all terminal paths"
```

---

## Task 4: Emit `negotiation_session_start/end` in `negotiateCandidates` + thread `trigger`

**Files:**
- Modify: `packages/protocol/src/negotiation/negotiation.graph.ts` (`negotiateCandidates` signature + body, lines 331–428; `OnNegotiationResolved` may receive the conversation id — check it)
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts` (the call site inside `negotiateNode`)
- Test: extend `packages/protocol/src/negotiation/tests/negotiation.graph.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to the spec file:

```ts
describe("negotiateCandidates — session wrapper events", () => {
  it("emits negotiation_session_start and _end per candidate with trigger + ids", async () => {
    const { database, dispatcher } = mkStubs();
    // Pre-stamp graph invoke so we can assert order without going through full turn loop
    const fakeGraph = {
      invoke: async (input: { opportunityId?: string }) => ({
        conversationId: `conv-for-${input.opportunityId}`,
        messages: [],
        outcome: { hasOpportunity: false, agreedRoles: [], reasoning: "", turnCount: 0 },
      }),
    };
    const events: Array<Record<string, unknown>> = [];
    const { negotiateCandidates } = await import("../negotiation.graph.js");
    const { requestContext } = await import("../../shared/observability/request-context.js");
    await requestContext.run({ traceEmitter: (e) => events.push(e) }, async () => {
      await negotiateCandidates(
        fakeGraph as never,
        { id: "u-src", name: "Alice" } as never,
        [
          {
            userId: "u-1",
            reasoning: "r", valencyRole: "peer",
            candidateUser: { id: "u-1", name: "Bob" } as never,
            opportunityId: "opp-10",
          },
        ],
        { networkId: "net-1", prompt: "" },
        {
          traceEmitter: (e) => events.push(e),
          trigger: "orchestrator",
        },
      );
    });

    const starts = events.filter((e) => e.type === "negotiation_session_start");
    const ends = events.filter((e) => e.type === "negotiation_session_end");
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0].opportunityId).toBe("opp-10");
    expect(starts[0].trigger).toBe("orchestrator");
    expect(starts[0].sourceUserId).toBe("u-src");
    expect(starts[0].candidateUserId).toBe("u-1");
    expect(ends[0].opportunityId).toBe("opp-10");
    expect(typeof ends[0].durationMs).toBe("number");
  }, 30000);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd packages/protocol && bun test src/negotiation/tests/negotiation.graph.spec.ts -t "session wrapper events" 2>&1 | tail -20
```

Expected: FAIL (no session events emitted; also likely a type error on `trigger` opt — that's fine, implementation step adds it).

- [ ] **Step 3: Add `trigger` to the opts and emit session events**

In `negotiation.graph.ts`, extend the `opts` type on `negotiateCandidates` (around lines 336–342):

```ts
  opts?: {
    maxTurns?: number;
    traceEmitter?: TraceEmitter;
    indexContextOverrides?: Map<string, string>;
    timeoutMs?: number;
    onCandidateResolved?: OnNegotiationResolved;
    trigger?: "orchestrator" | "ambient";
  },
```

Destructure `trigger` at line 344:

```ts
  const { maxTurns, traceEmitter, indexContextOverrides, timeoutMs, onCandidateResolved, trigger } = opts ?? {};
```

Replace the per-candidate `agent_start`/`agent_end` emissions at lines 349 and 385/413 by *wrapping* them with session events (the existing `agent_start/end` stay). The updated block inside `candidates.map(async (candidate) => { ... })`:

```ts
      const start = Date.now();
      const startedAt = start;
      traceEmitter?.({ type: "agent_start", name: "Negotiating candidate" });

      // Session start — emitted before graph.invoke so the UI node is
      // created even if the graph throws. We don't know the negotiation
      // conversationId until the graph's init node runs; emit empty and
      // fill in via a late session_end if needed (or via graph init).
      traceEmitter?.({
        type: "negotiation_session_start",
        opportunityId: candidate.opportunityId ?? "",
        negotiationConversationId: "", // filled by session_end
        sourceUserId: sourceUser.id,
        candidateUserId: candidate.userId,
        ...(candidate.candidateUser?.name && { candidateName: candidate.candidateUser.name }),
        trigger: trigger ?? "ambient",
        startedAt,
      });

      try {
        // ... existing body unchanged ...

        const durationMs = Date.now() - start;
        // Existing:
        traceEmitter?.({ type: "agent_end", name: "Negotiating candidate", durationMs, summary: `${candidate.userId}: ${turnFlow} ${statusTag}` });

        // New: session end carries the conversation id now known from graph result.
        traceEmitter?.({
          type: "negotiation_session_end",
          opportunityId: candidate.opportunityId ?? "",
          negotiationConversationId: (result as { conversationId?: string }).conversationId ?? "",
          durationMs,
        });

        // ... rest unchanged (accepted, onCandidateResolved, return) ...
      } catch (err) {
        const durationMs = Date.now() - start;
        traceEmitter?.({ type: "agent_end", name: "Negotiating candidate", durationMs, summary: `${candidate.userId}: error` });
        traceEmitter?.({
          type: "negotiation_session_end",
          opportunityId: candidate.opportunityId ?? "",
          negotiationConversationId: "",
          durationMs,
        });
        // ... rest unchanged ...
      }
```

- [ ] **Step 4: Pass `trigger` from `opportunity.graph.ts`**

Open `packages/protocol/src/opportunity/opportunity.graph.ts`. Find the `negotiateCandidates(...)` call inside `negotiateNode`. It currently passes `{ maxTurns, traceEmitter, timeoutMs, onCandidateResolved }`. Add:

```ts
  trigger: state.trigger === "orchestrator" ? "orchestrator" : "ambient",
```

(The opportunity graph state already carries `trigger`; confirm the field name with a quick grep. If it is `state.trigger`, use it directly; if it is differently named, use the actual field.)

- [ ] **Step 5: Run and watch tests pass**

```bash
cd packages/protocol && bun test src/negotiation/tests/negotiation.graph.spec.ts 2>&1 | tail -30
```

Expected: all new tests PASS; existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/negotiation/negotiation.graph.ts packages/protocol/src/opportunity/opportunity.graph.ts packages/protocol/src/negotiation/tests/negotiation.graph.spec.ts
git -c commit.gpgsign=false commit -m "feat(negotiation): wrap per-candidate runs with session_start/end events"
```

---

## Task 5: Extend `debugMeta` shape with `llm` + `orchestratorNegotiations`

**Files:**
- Modify: `packages/protocol/src/chat/chat-streaming.types.ts` (`DebugMetaEvent` interface lines 370–375; introduce supporting types)
- Modify: `packages/protocol/src/chat/chat.agent.ts` (`streamRun` lines 707–1176)
- Modify: `packages/protocol/src/chat/chat.state.ts` (line 150 `debugMeta` Annotation)
- Modify: `packages/protocol/src/chat/chat.streamer.ts` (lines 282–294)
- Modify: `backend/src/controllers/chat.controller.ts` (lines 252–356 local `debugMeta` typing)
- Test: extend `packages/protocol/src/chat/tests/chat.agent.spec.ts`

- [ ] **Step 1: Extend the types**

In `chat-streaming.types.ts`, insert before `DebugMetaEvent` (around line 370):

```ts
export interface DebugMetaLlm {
  calls: number;
  totalDurationMs: number;
  resets: Array<{ reason: string; at: number }>;
  hallucinations: Array<{ blockType: string; tool: string; at: number }>;
}

export interface DebugMetaOrchestratorNegotiations {
  opportunityIds: string[];
}
```

Modify `DebugMetaEvent`:

```ts
export interface DebugMetaEvent extends ChatStreamEventBase {
  type: "debug_meta";
  graph: string;
  iterations: number;
  tools: DebugMetaToolCall[];
  llm: DebugMetaLlm;
  orchestratorNegotiations?: DebugMetaOrchestratorNegotiations;
}
```

Modify the `createDebugMetaEvent` helper (lines 774–785):

```ts
export function createDebugMetaEvent(
  sessionId: string,
  graph: string,
  iterations: number,
  tools: DebugMetaToolCall[],
  llm: DebugMetaLlm,
  orchestratorNegotiations?: DebugMetaOrchestratorNegotiations,
): DebugMetaEvent {
  return createStreamEvent<DebugMetaEvent>("debug_meta", sessionId, {
    graph,
    iterations,
    tools,
    llm,
    ...(orchestratorNegotiations && { orchestratorNegotiations }),
  });
}
```

- [ ] **Step 2: Update `chat.state.ts` Annotation**

In `packages/protocol/src/chat/chat.state.ts` line 150:

```ts
  debugMeta: Annotation<{
    graph: string;
    iterations: number;
    tools: DebugMetaToolCall[];
    llm: DebugMetaLlm;
    orchestratorNegotiations?: DebugMetaOrchestratorNegotiations;
  } | undefined>({
```

Add the imports at the top of that file if they are not already imported from `chat-streaming.types.ts`:

```ts
import type { DebugMetaToolCall, DebugMetaLlm, DebugMetaOrchestratorNegotiations } from "./chat-streaming.types.js";
```

- [ ] **Step 3: Write failing test for the accumulator**

In `packages/protocol/src/chat/tests/chat.agent.spec.ts`, add a new test (pattern matches existing specs in that file):

```ts
describe("ChatAgent streamRun — debugMeta accumulator", () => {
  it("populates debugMeta.llm.calls, totalDurationMs, resets, and hallucinations", async () => {
    // Arrange: a test ChatAgent whose model emits a response_reset (code-fence stripping)
    // and a hallucination_detected event. Reuse the existing test harness that scripts
    // an LLM response; add an `opportunity` code block to trigger hallucination_detected.
    const { agent, runWithAbort } = await buildHallucinatingAgent({
      responseText: "hello ```opportunity\n{}\n``` world",
    });
    const events: Array<Record<string, unknown>> = [];
    const result = await agent.streamRun([new HumanMessage("hi")], (e) => events.push(e));

    expect(result.debugMeta.llm.calls).toBeGreaterThanOrEqual(1);
    expect(result.debugMeta.llm.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.debugMeta.llm.hallucinations.length).toBeGreaterThanOrEqual(1);
    // hallucination also triggers a response_reset
    expect(result.debugMeta.llm.resets.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});
```

> **Note:** `buildHallucinatingAgent` is a helper that should match the existing test harness in `chat.agent.spec.ts`. Reuse the pattern from the existing tests at lines 150–400 of that spec file (`response_reset` assertions already use scripted model responses). If the helper does not exist, inline the model-stub setup from the first existing test in the file.

- [ ] **Step 4: Run and watch it fail**

```bash
cd packages/protocol && bun test src/chat/tests/chat.agent.spec.ts -t "debugMeta accumulator" 2>&1 | tail -30
```

Expected: FAIL (`result.debugMeta.llm` is `undefined`).

- [ ] **Step 5: Implement the accumulator**

In `chat.agent.ts`, modify `streamRun`:

At the top of the method (just after `const toolsDebug: DebugMetaToolCall[] = [];` at line 727), add:

```ts
    const llm: { calls: number; totalDurationMs: number; resets: Array<{ reason: string; at: number }>; hallucinations: Array<{ blockType: string; tool: string; at: number }> } = {
      calls: 0,
      totalDurationMs: 0,
      resets: [],
      hallucinations: [],
    };
    const orchestratorNegotiationIds = new Set<string>();
    let lastLlmStart = 0;
```

Replace the `emit` wrapper at line 717 so it also accumulates the observed events:

```ts
    const emit = (event: AgentStreamEvent) => {
      // Accumulate for persisted debugMeta
      if (event.type === "llm_start") {
        llm.calls += 1;
        lastLlmStart = Date.now();
      } else if (event.type === "llm_end") {
        llm.totalDurationMs += Date.now() - lastLlmStart;
      } else if (event.type === "response_reset") {
        llm.resets.push({ reason: event.reason, at: Date.now() });
      } else if (event.type === "hallucination_detected") {
        llm.hallucinations.push({ blockType: event.blockType, tool: event.tool, at: Date.now() });
      } else if (event.type === "negotiation_session_start") {
        if (event.opportunityId) orchestratorNegotiationIds.add(event.opportunityId);
      }
      try {
        writer?.(event);
      } catch {
        /* swallow if writer is gone */
      }
    };
```

Update the three `return { ... debugMeta: { graph, iterations, tools } }` sites (lines 1126, 1136, 1168) to include the new fields:

```ts
      return {
        responseText: sanitizedText,
        messages,
        iterationCount,
        debugMeta: {
          graph: "agent_loop",
          iterations: iterationCount,
          tools: toolsDebug,
          llm,
          ...(orchestratorNegotiationIds.size > 0 && {
            orchestratorNegotiations: { opportunityIds: [...orchestratorNegotiationIds] },
          }),
        },
      };
```

Do this in all three return blocks (normal, aborted, hard-limit forced).

Update the return type of `streamRun` at line 711:

```ts
  ): Promise<{
    responseText: string;
    messages: BaseMessage[];
    iterationCount: number;
    debugMeta: {
      graph: string;
      iterations: number;
      tools: DebugMetaToolCall[];
      llm: DebugMetaLlm;
      orchestratorNegotiations?: DebugMetaOrchestratorNegotiations;
    };
  }> {
```

Add imports at top of `chat.agent.ts`:

```ts
import type { DebugMetaLlm, DebugMetaOrchestratorNegotiations } from "./chat-streaming.types.js";
```

- [ ] **Step 6: Pass the new fields through `chat.streamer.ts`**

In `packages/protocol/src/chat/chat.streamer.ts`, find the debug_meta emit site (lines 282–294). Replace it:

```ts
          const debugMeta = agentOutput?.debugMeta as
            | { graph?: string; iterations?: number; tools?: DebugMetaToolCall[]; llm?: DebugMetaLlm; orchestratorNegotiations?: DebugMetaOrchestratorNegotiations }
            | undefined;
          if (
            debugMeta?.graph != null &&
            typeof debugMeta.iterations === "number"
          ) {
            const debugEvent = createDebugMetaEvent(
              sessionId,
              debugMeta.graph,
              debugMeta.iterations,
              Array.isArray(debugMeta.tools) ? debugMeta.tools : [],
              debugMeta.llm ?? { calls: 0, totalDurationMs: 0, resets: [], hallucinations: [] },
              debugMeta.orchestratorNegotiations,
            );
            write(formatSSEEvent(debugEvent));
          }
```

Import `DebugMetaLlm`, `DebugMetaOrchestratorNegotiations`, and `DebugMetaToolCall` at the top of the file if not already imported.

- [ ] **Step 7: Update `backend/src/controllers/chat.controller.ts` local type**

At line 252, extend the local `debugMeta` declaration:

```ts
          let debugMeta: {
            graph: string;
            iterations: number;
            tools: unknown[];
            llm?: unknown;
            orchestratorNegotiations?: unknown;
          } | undefined;
```

At line 291, update the assignment to capture the extra fields from the event:

```ts
                debugMeta = {
                  graph: event.graph,
                  iterations: event.iterations,
                  tools: event.tools,
                  ...(event.llm != null && { llm: event.llm }),
                  ...(event.orchestratorNegotiations != null && { orchestratorNegotiations: event.orchestratorNegotiations }),
                };
```

No changes are needed in `chat.service.ts` — `debugMeta` is stored as `unknown` in `upsertMessageMetadata`.

- [ ] **Step 8: Run and watch tests pass**

```bash
cd packages/protocol && bun test src/chat/tests/chat.agent.spec.ts -t "debugMeta accumulator" 2>&1 | tail -30
cd packages/protocol && bun test src/chat/tests/chat.agent.spec.ts 2>&1 | tail -10
cd ../../backend && bun run lint 2>&1 | tail -10
```

Expected: new test PASS; existing tests PASS; lint clean.

- [ ] **Step 9: Commit**

```bash
git add packages/protocol/src/chat/chat-streaming.types.ts \
        packages/protocol/src/chat/chat.agent.ts \
        packages/protocol/src/chat/chat.state.ts \
        packages/protocol/src/chat/chat.streamer.ts \
        packages/protocol/src/chat/tests/chat.agent.spec.ts \
        backend/src/controllers/chat.controller.ts
git -c commit.gpgsign=false commit -m "feat(chat): persist llm + orchestratorNegotiations fields in debugMeta"
```

---

## Task 6: `/debug/chat/:id` — pointer-path negotiation hydration

**Files:**
- Modify: `backend/src/controllers/debug.controller.ts` (`getChatDebug` lines 519–691)
- Test: `backend/tests/debug.chat.negotiations.spec.ts` (new)

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/debug.chat.negotiations.spec.ts`:

```ts
import "./setup.env";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../src/lib/drizzle/drizzle";
import { conversations, conversationParticipants, messages, tasks, opportunities, conversationMetadata } from "../src/schemas/database.schema";
import { buildTestApp, getRequest, createTestUser, cleanupTestUser } from "./helpers"; // adapt to local helpers

describe("/debug/chat/:id — orchestrator negotiations (pointer path)", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;
  let sessionId: string;
  let oppIdAccepted: string;
  let oppIdRejected: string;

  beforeAll(async () => {
    app = await buildTestApp();
    userId = await createTestUser();

    // ── seed chat session + assistant message with orchestratorNegotiations pointer ──
    const [conv] = await db.insert(conversations).values({ kind: "chat" }).returning();
    sessionId = conv.id;
    await db.insert(conversationParticipants).values({
      conversationId: sessionId, participantId: userId, participantType: "user",
    });
    await db.insert(conversationMetadata).values({
      conversationId: sessionId, metadata: { title: "test", networkId: null },
    });

    // ── seed two opportunities (one accepted, one rejected) ──
    [{ id: oppIdAccepted }] = await db.insert(opportunities).values({
      userId, status: "draft", trigger: "orchestrator", metadata: {},
    }).returning();
    [{ id: oppIdRejected }] = await db.insert(opportunities).values({
      userId, status: "rejected", trigger: "orchestrator", metadata: {},
    }).returning();

    // ── seed assistant message with pointer ──
    await db.insert(messages).values({
      conversationId: sessionId, role: "agent",
      parts: [{ type: "text", text: "ok" }],
      metadata: {
        debugMeta: {
          graph: "agent_loop",
          iterations: 1,
          tools: [],
          llm: { calls: 1, totalDurationMs: 10, resets: [], hallucinations: [] },
          orchestratorNegotiations: { opportunityIds: [oppIdAccepted, oppIdRejected] },
        },
      },
    });

    // ── seed 1 negotiation per opportunity (task + conversation + 2 turn messages) ──
    for (const [oppId, accept] of [[oppIdAccepted, true], [oppIdRejected, false]] as const) {
      const [negConv] = await db.insert(conversations).values({ kind: "negotiation" }).returning();
      const [task] = await db.insert(tasks).values({
        conversationId: negConv.id,
        state: "completed",
        metadata: { type: "negotiation", opportunityId: oppId, sourceUserId: userId, candidateUserId: "u-cand", maxTurns: 4 },
      }).returning();
      await db.insert(messages).values([
        {
          conversationId: negConv.id, role: "agent", taskId: task.id, senderId: `agent:${userId}`,
          parts: [{ kind: "data", data: { action: "propose", assessment: { reasoning: "r1", suggestedRoles: { ownUser: "agent", otherUser: "patient" } }, message: "hi" } }],
        },
        {
          conversationId: negConv.id, role: "agent", taskId: task.id, senderId: `agent:u-cand`,
          parts: [{ kind: "data", data: { action: accept ? "accept" : "reject", assessment: { reasoning: "r2", suggestedRoles: { ownUser: "patient", otherUser: "agent" } } } }],
        },
      ]);
    }
  });

  afterAll(async () => { await cleanupTestUser(userId); });

  it("returns populated turn.negotiations[] with both candidates", async () => {
    const res = await getRequest(app, `/debug/chat/${sessionId}`, userId);
    expect(res.status).toBe(200);
    const body = await res.json() as { turns: Array<{ negotiations?: unknown[] }> };
    const negotiations = body.turns.flatMap((t) => t.negotiations ?? []) as Array<{ opportunityId: string; turns: unknown[]; outcome: { status: string } | null }>;
    expect(negotiations).toHaveLength(2);
    const accepted = negotiations.find((n) => n.opportunityId === oppIdAccepted);
    const rejected = negotiations.find((n) => n.opportunityId === oppIdRejected);
    expect(accepted?.turns).toHaveLength(2);
    expect(accepted?.outcome?.status).toBe("draft");
    expect(rejected?.outcome?.status).toBe("rejected");
  });
});
```

> **Note:** The helper names `buildTestApp`, `getRequest`, `createTestUser`, `cleanupTestUser` should match what the existing backend tests use. If the conventions differ, open any file under `backend/tests/` and mirror its setup.

- [ ] **Step 2: Run and watch it fail**

```bash
cd backend && bun test tests/debug.chat.negotiations.spec.ts 2>&1 | tail -30
```

Expected: FAIL — `body.turns[i].negotiations` is undefined (the endpoint does not hydrate yet).

- [ ] **Step 3: Implement the hydration**

In `debug.controller.ts`, add imports at the top if not already present:

```ts
import { tasks, opportunities } from '../schemas/database.schema';
import { inArray, sql } from 'drizzle-orm';
```

Then modify `getChatDebug`. After the existing `turns.push({ messageIndex, graph, iterations, tools })` block (around line 678), but before `return Response.json({ ... })`, insert a post-processing loop:

```ts
    // ── 5. Hydrate negotiations for each turn that has orchestratorNegotiations pointers ──
    const turnNegotiations: Array<Array<{
      opportunityId: string;
      negotiationConversationId: string;
      taskState: string;
      sourceUserId: string;
      candidateUserId: string;
      candidateName: string;
      turns: Array<{
        turnIndex: number;
        actor: 'source' | 'candidate';
        action: string;
        reasoning?: string;
        message?: string;
        suggestedRoles?: { ownUser?: string; otherUser?: string };
        createdAt: Date;
      }>;
      outcome: { status: string; turnCount: number; agreedRoles?: unknown; reasoning?: string } | null;
      startedAt: Date | null;
      endedAt: Date | null;
      durationMs: number | null;
      turnsTruncated?: boolean;
    }>> = turns.map(() => []);

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const msgRow = messageRows[turn.messageIndex];
      if (!msgRow || msgRow.role !== 'assistant') continue;
      const pointerIds = (msgRow.debugMeta as { orchestratorNegotiations?: { opportunityIds?: string[] } } | null)?.orchestratorNegotiations?.opportunityIds;
      if (!pointerIds || pointerIds.length === 0) continue;

      // Fetch tasks whose metadata.opportunityId is in pointerIds.
      const taskRows = await db
        .select({
          id: tasks.id,
          conversationId: tasks.conversationId,
          state: tasks.state,
          metadata: tasks.metadata,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .where(and(
          sql`${tasks.metadata}->>'opportunityId' = ANY(${pointerIds})`,
          sql`${tasks.metadata}->>'type' = 'negotiation'`,
        ));

      for (const t of taskRows) {
        const tmeta = (t.metadata ?? {}) as { opportunityId?: string; sourceUserId?: string; candidateUserId?: string };
        const oppId = tmeta.opportunityId;
        if (!oppId) continue;

        // Load negotiation turn messages
        const turnMessages = await db
          .select({ parts: messages.parts, createdAt: messages.createdAt, senderId: messages.senderId })
          .from(messages)
          .where(eq(messages.conversationId, t.conversationId))
          .orderBy(asc(messages.createdAt))
          .limit(20);

        const MAX_TURNS = 20;
        const truncated = turnMessages.length >= MAX_TURNS;

        const [opp] = await db.select({ status: opportunities.status }).from(opportunities).where(eq(opportunities.id, oppId)).limit(1);

        const parsedTurns = turnMessages.map((m, idx) => {
          const dataPart = (m.parts as Array<{ kind?: string; data?: Record<string, unknown> }>)?.find((p) => p.kind === 'data');
          const d = (dataPart?.data ?? {}) as {
            action?: string;
            assessment?: { reasoning?: string; suggestedRoles?: { ownUser?: string; otherUser?: string } };
            message?: string;
          };
          const isSource = m.senderId === `agent:${tmeta.sourceUserId ?? ''}`;
          return {
            turnIndex: idx,
            actor: (isSource ? 'source' : 'candidate') as 'source' | 'candidate',
            action: d.action ?? 'unknown',
            reasoning: d.assessment?.reasoning,
            message: d.message,
            suggestedRoles: d.assessment?.suggestedRoles,
            createdAt: m.createdAt,
          };
        });

        turnNegotiations[i].push({
          opportunityId: oppId,
          negotiationConversationId: t.conversationId,
          taskState: t.state,
          sourceUserId: tmeta.sourceUserId ?? '',
          candidateUserId: tmeta.candidateUserId ?? '',
          candidateName: '',
          turns: parsedTurns,
          outcome: opp ? { status: opp.status, turnCount: parsedTurns.length } : null,
          startedAt: t.createdAt,
          endedAt: t.state === 'completed' ? t.updatedAt : null,
          durationMs: t.state === 'completed' && t.createdAt && t.updatedAt
            ? new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime()
            : null,
          ...(truncated && { turnsTruncated: true }),
        });
      }
    }

    // Attach to each turn before the response assembly.
    const turnsWithNegotiations = turns.map((t, i) => ({ ...t, negotiations: turnNegotiations[i] }));
```

Replace `turns` with `turnsWithNegotiations` in the final `Response.json(...)` payload at line 688.

- [ ] **Step 4: Run and watch it pass**

```bash
cd backend && bun test tests/debug.chat.negotiations.spec.ts 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/debug.controller.ts backend/tests/debug.chat.negotiations.spec.ts
git -c commit.gpgsign=false commit -m "feat(debug): hydrate orchestrator negotiations via pointer in /debug/chat"
```

---

## Task 7: `/debug/chat/:id` — fallback time-window hydration for legacy messages

**Files:**
- Modify: `backend/src/controllers/debug.controller.ts`
- Test: `backend/tests/debug.chat.legacy.spec.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/debug.chat.legacy.spec.ts`:

```ts
import "./setup.env";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../src/lib/drizzle/drizzle";
import { conversations, conversationParticipants, messages, tasks, opportunities, conversationMetadata } from "../src/schemas/database.schema";
import { buildTestApp, getRequest, createTestUser, cleanupTestUser } from "./helpers";

describe("/debug/chat/:id — fallback path for legacy messages", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;
  let sessionId: string;
  let oppId: string;
  const msgCreatedAt = new Date();

  beforeAll(async () => {
    app = await buildTestApp();
    userId = await createTestUser();

    const [conv] = await db.insert(conversations).values({ kind: "chat" }).returning();
    sessionId = conv.id;
    await db.insert(conversationParticipants).values({
      conversationId: sessionId, participantId: userId, participantType: "user",
    });
    await db.insert(conversationMetadata).values({
      conversationId: sessionId, metadata: {},
    });

    // Assistant message WITHOUT orchestratorNegotiations pointer (legacy).
    await db.insert(messages).values({
      conversationId: sessionId, role: "agent",
      parts: [{ type: "text", text: "ok" }],
      metadata: { debugMeta: { graph: "agent_loop", iterations: 1, tools: [] } },
      createdAt: msgCreatedAt,
    });

    // Opportunity authored by this user via orchestrator, inside the fallback window.
    [{ id: oppId }] = await db.insert(opportunities).values({
      userId, status: "draft", trigger: "orchestrator", metadata: {},
      createdAt: new Date(msgCreatedAt.getTime() + 2_000),
    }).returning();

    const [negConv] = await db.insert(conversations).values({ kind: "negotiation" }).returning();
    const [task] = await db.insert(tasks).values({
      conversationId: negConv.id, state: "completed",
      metadata: { type: "negotiation", opportunityId: oppId, sourceUserId: userId, candidateUserId: "u-cand" },
    }).returning();
    await db.insert(messages).values({
      conversationId: negConv.id, role: "agent", taskId: task.id, senderId: `agent:${userId}`,
      parts: [{ kind: "data", data: { action: "accept", assessment: { reasoning: "r" } } }],
    });
  });

  afterAll(async () => { await cleanupTestUser(userId); });

  it("hydrates negotiations via time-window join when no pointer present", async () => {
    const res = await getRequest(app, `/debug/chat/${sessionId}`, userId);
    expect(res.status).toBe(200);
    const body = await res.json() as { turns: Array<{ negotiations?: Array<{ opportunityId: string }> }> };
    const ids = body.turns.flatMap((t) => t.negotiations ?? []).map((n) => n.opportunityId);
    expect(ids).toContain(oppId);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd backend && bun test tests/debug.chat.legacy.spec.ts 2>&1 | tail -30
```

Expected: FAIL — no negotiations returned because no pointer and no fallback implemented.

- [ ] **Step 3: Add fallback branch**

In `debug.controller.ts`, inside the same hydration loop from Task 6, after the `if (!pointerIds || pointerIds.length === 0) continue;` line, replace it with a fallback branch:

```ts
      let effectivePointerIds = pointerIds ?? null;

      if (!effectivePointerIds) {
        const msgTs = new Date(msgRow.createdAt).getTime();
        const WINDOW_MS = 10 * 60 * 1000; // ±10 min
        const fromTs = new Date(msgTs - WINDOW_MS);
        const toTs = new Date(msgTs + WINDOW_MS);
        const oppsInWindow = await db
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(and(
            eq(opportunities.userId, user.id),
            eq(opportunities.trigger, 'orchestrator'),
            sql`${opportunities.createdAt} >= ${fromTs}`,
            sql`${opportunities.createdAt} <= ${toTs}`,
          ));
        if (oppsInWindow.length === 0) continue;
        effectivePointerIds = oppsInWindow.map((o) => o.id);
      }

      // … reuse `effectivePointerIds` below (rename `pointerIds` uses to `effectivePointerIds`).
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd backend && bun test tests/debug.chat.legacy.spec.ts 2>&1 | tail -20
cd backend && bun test tests/debug.chat.negotiations.spec.ts 2>&1 | tail -20
```

Expected: new legacy test PASS; prior Task 6 test still PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/debug.controller.ts backend/tests/debug.chat.legacy.spec.ts
git -c commit.gpgsign=false commit -m "feat(debug): fallback time-window hydration for legacy chat messages"
```

---

## Task 8: Frontend — extend `TraceEvent` type and SSE mapping

**Files:**
- Modify: `frontend/src/contexts/AIChatContext.tsx`

- [ ] **Step 1: Extend `TraceEventType` and `TraceEvent`**

In `AIChatContext.tsx` lines 59–82, append to `TraceEventType`:

```ts
export type TraceEventType =
  | "iteration_start"
  | "llm_start"
  | "llm_end"
  | "hallucination_detected"
  | "tool_start"
  | "tool_end"
  | "graph_start"
  | "graph_end"
  | "agent_start"
  | "agent_end"
  | "negotiation_session_start"
  | "negotiation_session_end"
  | "negotiation_turn"
  | "negotiation_outcome";
```

Extend `TraceEvent`:

```ts
export interface TraceEvent {
  type: TraceEventType;
  timestamp: number;
  iteration?: number;
  name?: string;
  status?: "running" | "success" | "error";
  summary?: string;
  durationMs?: number;
  steps?: ToolCallStep[];
  hasToolCalls?: boolean;
  toolNames?: string[];
  // Negotiation-event fields
  opportunityId?: string;
  negotiationConversationId?: string;
  sourceUserId?: string;
  candidateUserId?: string;
  candidateName?: string;
  trigger?: "orchestrator" | "ambient";
  startedAt?: number;
  turnIndex?: number;
  actor?: "source" | "candidate";
  action?: "propose" | "accept" | "reject" | "counter" | "question";
  reasoning?: string;
  message?: string;
  suggestedRoles?: { ownUser?: string; otherUser?: string };
  outcome?:
    | "accepted"
    | "rejected_stalled"
    | "waiting_for_agent"
    | "timed_out"
    | "turn_cap";
  turnCount?: number;
  agreedRoles?: { ownUser?: string; otherUser?: string };
}
```

- [ ] **Step 2: Map incoming SSE events to `TraceEvent` objects**

Find the SSE handler (the file already handles events like `graph_start` around line 455). Add matching cases for the four new types. Pattern:

```tsx
                case "negotiation_session_start": {
                  const te: TraceEvent = {
                    type: "negotiation_session_start",
                    timestamp: performance.now(),
                    opportunityId: event.opportunityId,
                    negotiationConversationId: event.negotiationConversationId,
                    sourceUserId: event.sourceUserId,
                    candidateUserId: event.candidateUserId,
                    candidateName: event.candidateName,
                    trigger: event.trigger,
                    startedAt: event.startedAt,
                  };
                  appendTraceEvent(te);
                  break;
                }
                case "negotiation_session_end": {
                  appendTraceEvent({
                    type: "negotiation_session_end",
                    timestamp: performance.now(),
                    opportunityId: event.opportunityId,
                    negotiationConversationId: event.negotiationConversationId,
                    durationMs: event.durationMs,
                  });
                  break;
                }
                case "negotiation_turn": {
                  appendTraceEvent({
                    type: "negotiation_turn",
                    timestamp: performance.now(),
                    opportunityId: event.opportunityId,
                    negotiationConversationId: event.negotiationConversationId,
                    turnIndex: event.turnIndex,
                    actor: event.actor,
                    action: event.action,
                    reasoning: event.reasoning,
                    message: event.message,
                    suggestedRoles: event.suggestedRoles,
                    durationMs: event.durationMs,
                  });
                  break;
                }
                case "negotiation_outcome": {
                  appendTraceEvent({
                    type: "negotiation_outcome",
                    timestamp: performance.now(),
                    opportunityId: event.opportunityId,
                    outcome: event.outcome,
                    turnCount: event.turnCount,
                    reasoning: event.reasoning,
                    agreedRoles: event.agreedRoles,
                  });
                  break;
                }
```

Use whatever `appendTraceEvent` / inline append the file already uses (match the existing `graph_start` case as a template).

- [ ] **Step 3: Typecheck**

```bash
cd frontend && bun run lint 2>&1 | tail -20
```

Expected: lint clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/contexts/AIChatContext.tsx
git -c commit.gpgsign=false commit -m "feat(frontend): map negotiation stream events to TraceEvent"
```

---

## Task 9: Frontend — parser branches in `ToolCallsDisplay`

**Files:**
- Modify: `frontend/src/components/chat/ToolCallsDisplay.tsx`

- [ ] **Step 1: Add negotiation types to the node model**

Near the other node types (around lines 385–410), add:

```ts
export interface NegotiationTurnRow {
  turnIndex: number;
  actor: "source" | "candidate";
  action: "propose" | "accept" | "reject" | "counter" | "question";
  reasoning?: string;
  message?: string;
  suggestedRoles?: { ownUser?: string; otherUser?: string };
  durationMs: number;
}

export interface NegotiationNode {
  opportunityId: string;
  negotiationConversationId: string;
  candidateUserId: string;
  candidateName?: string;
  trigger: "orchestrator" | "ambient";
  startTimestamp: number;
  durationMs?: number;
  turns: NegotiationTurnRow[];
  outcome?:
    | "accepted"
    | "rejected_stalled"
    | "waiting_for_agent"
    | "timed_out"
    | "turn_cap";
  turnCount?: number;
  outcomeReasoning?: string;
  isRunning: boolean;
}
```

Extend `ToolNode`:

```ts
interface ToolNode {
  name: string;
  startTimestamp: number;
  isRunning: boolean;
  activities: TraceEvent[];
  steps?: ToolCallStep[];
  summary?: string;
  durationMs?: number;
  status?: "success" | "error";
  graphs: GraphNode[];
  negotiations: NegotiationNode[]; // NEW
}
```

Ensure each `ToolNode` literal in the parser (there is one at line 452–459) initializes `negotiations: []`.

- [ ] **Step 2: Add parser branches**

Inside `parseTraceEvents` (line 418) switch, append cases after `agent_end` (line 557):

```ts
      case "negotiation_session_start": {
        const target = currentTool ?? (tools.length > 0 ? tools[tools.length - 1] : null);
        if (!target) break;
        const node: NegotiationNode = {
          opportunityId: event.opportunityId ?? "",
          negotiationConversationId: event.negotiationConversationId ?? "",
          candidateUserId: event.candidateUserId ?? "",
          candidateName: event.candidateName,
          trigger: event.trigger ?? "ambient",
          startTimestamp: event.timestamp,
          turns: [],
          isRunning: true,
        };
        target.negotiations.push(node);
        break;
      }

      case "negotiation_turn": {
        const all = tools.flatMap((t) => t.negotiations);
        const node = [...all].reverse().find(
          (n) => n.opportunityId === (event.opportunityId ?? "") && n.isRunning,
        );
        if (!node) break;
        node.turns.push({
          turnIndex: event.turnIndex ?? node.turns.length,
          actor: (event.actor ?? "source") as "source" | "candidate",
          action: (event.action ?? "propose") as NegotiationTurnRow["action"],
          reasoning: event.reasoning,
          message: event.message,
          suggestedRoles: event.suggestedRoles,
          durationMs: event.durationMs ?? 0,
        });
        break;
      }

      case "negotiation_outcome": {
        const all = tools.flatMap((t) => t.negotiations);
        const node = [...all].reverse().find(
          (n) => n.opportunityId === (event.opportunityId ?? "") && n.isRunning,
        );
        if (!node) break;
        node.outcome = event.outcome;
        node.turnCount = event.turnCount;
        node.outcomeReasoning = event.reasoning;
        break;
      }

      case "negotiation_session_end": {
        const all = tools.flatMap((t) => t.negotiations);
        const node = [...all].reverse().find(
          (n) => n.opportunityId === (event.opportunityId ?? "") && n.isRunning,
        );
        if (!node) break;
        node.isRunning = false;
        node.durationMs = event.durationMs;
        break;
      }
```

- [ ] **Step 3: Typecheck**

```bash
cd frontend && bun run lint 2>&1 | tail -20
```

Expected: lint clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/chat/ToolCallsDisplay.tsx
git -c commit.gpgsign=false commit -m "feat(frontend): parse negotiation events into NegotiationNode model"
```

---

## Task 10: Frontend — `NegotiationTree` subcomponent + rendering

**Files:**
- Modify: `frontend/src/components/chat/ToolCallsDisplay.tsx`

- [ ] **Step 1: Add the `NegotiationTree` subcomponent**

Near the other subcomponents (search for `function ToolCallsDisplay` in the file — the subcomponent goes just above it):

```tsx
function outcomeIcon(o: NegotiationNode["outcome"]): string {
  if (o === "accepted") return "🟢";
  if (o === "waiting_for_agent") return "⏳";
  return "🔴";
}

function NegotiationTree({ negotiations }: { negotiations: NegotiationNode[] }) {
  const [openIdxs, setOpenIdxs] = useState<Set<number>>(new Set());

  if (negotiations.length === 0) return null;

  return (
    <div className="mt-2 pl-3 border-l border-gray-200">
      <div className="text-xs text-gray-500 mb-1">Negotiations ({negotiations.length})</div>
      {negotiations.map((n, i) => {
        const isOpen = openIdxs.has(i);
        const toggle = () => {
          const next = new Set(openIdxs);
          if (isOpen) next.delete(i); else next.add(i);
          setOpenIdxs(next);
        };
        return (
          <div key={`${n.opportunityId}-${i}`} className="mb-1">
            <button
              type="button"
              onClick={toggle}
              className="flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900"
              title={n.outcomeReasoning ?? ""}
            >
              <span>{isOpen ? "▾" : "▸"}</span>
              <span>{outcomeIcon(n.outcome)}</span>
              <span className="font-medium">{n.candidateName ?? n.candidateUserId}</span>
              <span className="text-gray-500">
                — {n.outcome ?? (n.isRunning ? "running" : "unknown")} ({n.turns.length} turn{n.turns.length === 1 ? "" : "s"}{n.durationMs != null ? `, ${n.durationMs}ms` : ""})
              </span>
            </button>
            {isOpen && (
              <ol className="ml-5 mt-1 space-y-0.5 text-xs text-gray-700">
                {n.turns.map((t) => (
                  <li key={t.turnIndex}>
                    <span className="text-gray-500">{t.turnIndex + 1}.</span>{" "}
                    <span className="font-mono text-[10px] text-gray-500">[{t.actor}]</span>{" "}
                    <span className="font-medium">{t.action}</span>
                    {t.message && <span> — {t.message}</span>}
                    {t.reasoning && (
                      <div className="ml-5 text-gray-500">{t.reasoning}</div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Render `NegotiationTree` inside each tool card**

Find the section that renders `tool.graphs` inside an expanded tool block. Below the graphs render, insert:

```tsx
{tool.negotiations.length > 0 && <NegotiationTree negotiations={tool.negotiations} />}
```

- [ ] **Step 3: Manual verification**

Start both dev servers and trigger an orchestrator flow:

```bash
# terminal 1
cd /home/yanek/Projects/index/.worktrees/feat-negotiation-debug-visibility && bun run worktree:dev feat-negotiation-debug-visibility
```

Open the frontend, start a new chat in an index with at least two members, trigger an opportunity via an intent, click Start Chat. Confirm the TRACE panel now shows a "Negotiations (N)" section with a row per candidate, expandable to show turns. Note: report explicitly if manual verification could not be run (e.g. no seeded data).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/chat/ToolCallsDisplay.tsx
git -c commit.gpgsign=false commit -m "feat(frontend): render per-candidate negotiations in TRACE panel"
```

---

## Task 11: Docs

**Files:**
- Modify: `docs/design/protocol-deep-dive.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `docs/design/protocol-deep-dive.md`**

Find the Trace Event Instrumentation section. Append under the existing event list:

```markdown
**Negotiation events** (added 2026-04-17):

- `negotiation_session_start` / `negotiation_session_end` — emitted by `negotiateCandidates` in `negotiation.graph.ts`, wrapping each per-candidate run. Carries `opportunityId`, `negotiationConversationId`, source/candidate user ids, `trigger` (`'orchestrator' | 'ambient'`), `startedAt`, and `durationMs` (on end).
- `negotiation_turn` — emitted by the negotiation graph's `turnNode` after each successful turn. Carries `opportunityId`, `turnIndex`, `actor` (`'source' | 'candidate'`), `action` (`propose | accept | reject | counter | question`), `reasoning`, `message`, `suggestedRoles`, `durationMs`.
- `negotiation_outcome` — emitted from `finalizeNode` on every terminal path (`accepted`, `rejected_stalled`, `waiting_for_agent`, `timed_out`, `turn_cap`). Carries `opportunityId`, `outcome`, `turnCount`, `reasoning`, `agreedRoles`.

Consumers: the live TRACE panel uses these to render per-candidate negotiation nodes. `/debug/chat/:id` uses `debugMeta.orchestratorNegotiations.opportunityIds` (persisted from `negotiation_session_start` during the turn) to hydrate full negotiation history from `tasks` + `messages` + `opportunities`. Existing `agent_start/end` emissions in `negotiation.graph.ts` are retained for backward compatibility with the rolled-up `debugMeta.tools[].graphs[].agents[]` render path.
```

- [ ] **Step 2: Update `CLAUDE.md`**

Under the Trace Event Instrumentation subsection, append one paragraph:

```markdown
Negotiation-specific events (`negotiation_session_start/end`, `negotiation_turn`, `negotiation_outcome`) carry per-candidate turn and outcome data for orchestrator-inline negotiations. They are persisted into `debugMeta.orchestratorNegotiations.opportunityIds` for later hydration by the debug endpoint.
```

- [ ] **Step 3: Commit**

```bash
git add docs/design/protocol-deep-dive.md CLAUDE.md
git -c commit.gpgsign=false commit -m "docs: document negotiation trace events + debugMeta hydration"
```

---

## Task 12: Full regression + final verification

- [ ] **Step 1: Run affected test suites**

```bash
cd packages/protocol && bun test src/negotiation/tests src/chat/tests 2>&1 | tail -20
cd ../../backend && bun test tests/debug.chat.negotiations.spec.ts tests/debug.chat.legacy.spec.ts 2>&1 | tail -10
cd ../frontend && bun run lint 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 2: Smoke test `/debug/chat/:id` response shape**

Start backend:

```bash
cd backend && bun run dev
```

In another terminal, authenticate, seed an orchestrator session (or reuse an existing one), then:

```bash
curl -s -H "Cookie: <session cookie>" http://localhost:3001/debug/chat/<sessionId> | jq '.turns[] | .negotiations'
```

Expected: each turn has `negotiations` array; orchestrator-origin turns populated; non-orchestrator turns empty.

- [ ] **Step 3: Leave branch ready for review**

Do not merge or rebase. Surface: current branch state, any tests skipped, any manual verification that could not be run. Follow `feedback_finishing_branch.md` — do not auto-merge to dev.

---

## Open considerations during execution (not blockers)

- **Opportunity schema — `trigger` field:** The plan assumes `opportunities.trigger` and `state.trigger` exist with values `'orchestrator' | 'ambient'`. Confirm field names at Task 4 step 4 before committing; if the actual field name differs (e.g. `originTrigger`), update references accordingly.
- **`candidateName` source:** Task 6's hydration sets `candidateName: ''`. If readily available via an existing `userProfiles`/`contacts` join in the surrounding code, populate it; otherwise leave empty and track as a polish item.
- **Seed assessment in turn history:** Task 2's `turnIndex` uses `state.turnCount`; the seed assessment is not a persisted turn. Confirm this matches expectations when reviewing the first PR.
- **Payload cap per session:** The plan caps negotiation turn messages at 20 per opportunity (`turnsTruncated`). If real sessions regularly exceed this, raise the cap or add per-opportunity truncation to the final response shape in a follow-up.
