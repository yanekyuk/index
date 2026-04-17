# Plan B — Orchestrator Flow Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the chat orchestrator (a2h) into the unified `OpportunityGraph` as a first-class trigger. Chat queries run HyDE → dedup → persist (`negotiating`) → per-candidate negotiation fan-out → streaming per-draft events → finalize to `draft`. Users press "Start Chat" on `pending` (ambient) or `draft` (orchestrator) rows and an h2h conversation spins up atomically.

**Architecture:** Add a `trigger: 'ambient' | 'orchestrator'` parameter to `OpportunityGraphState`. The persist and negotiate nodes branch on `trigger`; other nodes are unchanged. Orchestrator's negotiate node runs unbounded `Promise.allSettled` fan-out, honors `AbortSignal`, and emits `opportunity_draft_ready` events via the existing `traceEmitter → writer` chain. The `create_opportunities` tool returns a structured result (`newDrafts` / `existingDrafts` / `alreadyAccepted`) that the LLM narrates around.

**Tech Stack:** Bun, LangGraph, Drizzle ORM, PostgreSQL, BullMQ, React, React Router v7, TypeScript.

**Design spec:** [2026-04-17-ambient-orchestrator-negotiation-flow-design.md](../specs/2026-04-17-ambient-orchestrator-negotiation-flow-design.md) (sections "Unified `OpportunityGraph`", "Streaming: domain events", "Dedup + enrichment", "`create_opportunities` tool output", "Start Chat flow").

**Prerequisite:** Plan A ([2026-04-17-plan-a-heartbeat-aware-dispatch.md](./2026-04-17-plan-a-heartbeat-aware-dispatch.md)) must be merged. Plan B depends on the dispatcher's new `timeoutMs`-as-park-window semantics.

**Worktree:** Create a new worktree branched off a commit that includes Plan A: `git worktree add .worktrees/feat-orchestrator-flow dev` (after Plan A is on `dev`). Run `bun run worktree:setup feat-orchestrator-flow`.

---

## File Structure

**State & graph:**
- `packages/protocol/src/opportunity/opportunity.state.ts` — add `trigger` field to state and `OpportunityGraphInvokeOptions`.
- `packages/protocol/src/opportunity/opportunity.graph.ts` — branch in `persist` (initial status) and `negotiate` (fan-out + streaming + abort).
- `packages/protocol/src/opportunity/opportunity.persist.ts` — respect initial status from trigger.

**Enricher:**
- `packages/protocol/src/opportunity/opportunity.enricher.ts` — extend default `excludeStatuses` to cover `accepted` and `negotiating`.

**Dedup accepted-pair lookup (orchestrator only):**
- `packages/protocol/src/shared/interfaces/database.interface.ts` — add method to interface.
- `packages/protocol/src/opportunity/opportunity.graph.ts` — dedup node calls it when `trigger === 'orchestrator'`.
- `backend/src/adapters/database.adapter.ts` — implement `getAcceptedOpportunitiesBetweenActors` for protocol scope (verify if it already exists — an earlier grep found `getAcceptedOpportunitiesBetweenActors`, likely sufficient already).

**Streaming:**
- `packages/protocol/src/chat/chat.agent.ts` — extend `AgentStreamEvent` union with `opportunity_draft_ready`.
- `packages/protocol/src/chat/chat-streaming.types.ts` — update shared type if events list is mirrored.

**Tool output:**
- `packages/protocol/src/opportunity/opportunity.tools.ts` — `create_opportunities` tool: detect orchestrator invocation, thread `AbortSignal`, return structured result.

**Start Chat endpoint:**
- `backend/src/controllers/opportunity.controller.ts` — add `POST /opportunities/:id/start-chat` or reuse `PATCH /opportunities/:id/status` with strict transition rules.
- `backend/src/services/opportunity.service.ts` — `startChat(opportunityId, userId)` method performing the atomic transaction.
- `backend/src/adapters/database.adapter.ts` — helper to find-or-create conversation by dmPair.

**Frontend:**
- `frontend/src/services/chat.service.ts` (or equivalent SSE client) — handle new `opportunity_draft_ready` event type.
- `frontend/src/components/chat/ChatMessageList.tsx` (or equivalent) — render incoming draft cards inline.
- `frontend/src/components/opportunity/OpportunityCard.tsx` — "Start Chat" button calls new endpoint and navigates to the returned `conversationId`.

**Tests:**
- `packages/protocol/src/opportunity/tests/opportunity.graph.trigger.spec.ts` (new) — trigger branching.
- `packages/protocol/src/opportunity/tests/opportunity.enricher.spec.ts` — extend for new excludeStatuses default.
- `backend/src/services/tests/opportunity.service.startChat.spec.ts` (new).
- `frontend/src/components/tests/...` as appropriate.

---

## Task 1 — Add `trigger` to opportunity state

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.state.ts`
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts` (call sites reading state.trigger)
- Test: `packages/protocol/src/opportunity/tests/opportunity.state.spec.ts` (new or extend)

- [ ] **Step 1: Extend state annotation**

In [packages/protocol/src/opportunity/opportunity.state.ts](packages/protocol/src/opportunity/opportunity.state.ts), find the `OpportunityGraphState` Annotation definition and add a `trigger` field. Default to `'ambient'` to preserve existing queue-driven behavior:

```ts
import { Annotation } from '@langchain/langgraph';

export type OpportunityTrigger = 'ambient' | 'orchestrator';

// ...existing annotations...

/**
 * Which flow triggered this graph invocation. Determines initial persist status,
 * park-window timeout, streaming behavior, and whether AbortSignal is honored.
 *
 * - 'ambient' (default): queue-driven, persists at `latent`, 5-min park window,
 *   no streaming, ignores abort.
 * - 'orchestrator': chat-driven, persists at `negotiating`, 60s park window,
 *   streams `opportunity_draft_ready` events, honors abort.
 */
trigger: Annotation<OpportunityTrigger>({
  reducer: (curr, next) => next ?? curr,
  default: () => 'ambient',
}),
```

- [ ] **Step 2: Expose `trigger` in `OpportunityGraphInvokeOptions`**

Same file. Find the `OpportunityGraphInvokeOptions` type and add:

```ts
  trigger?: OpportunityTrigger;
```

- [ ] **Step 3: Thread `trigger` into the graph's invoke call**

Find where `OpportunityGraphInvokeOptions` is unpacked into initial state (likely an `invoke` wrapper or caller-facing `run` method). Ensure `trigger` flows from options into initial state, defaulting to `'ambient'` if unspecified.

- [ ] **Step 4: Write failing unit test**

Test the state behaviorally by compiling the graph and inspecting the initial state after invocation, rather than introspecting Annotation internals (which change across LangGraph versions). In `packages/protocol/src/opportunity/tests/opportunity.state.spec.ts` (or extend an existing graph test):

```ts
import { describe, it, expect } from 'bun:test';
// Import your graph factory / helpers — follow the pattern used in
// opportunity.graph.spec.ts for constructing a minimal compiled graph.

describe('OpportunityGraphState.trigger', () => {
  it('defaults to ambient when the caller omits trigger', async () => {
    const { compiledGraph } = createMinimalGraph();
    const result = await compiledGraph.invoke({ /* required inputs */ });
    expect(result.trigger).toBe('ambient');
  });

  it('accepts orchestrator when passed in options', async () => {
    const { compiledGraph } = createMinimalGraph();
    const result = await compiledGraph.invoke({ /* required inputs */, trigger: 'orchestrator' });
    expect(result.trigger).toBe('orchestrator');
  });
});
```

The point is: the state carries a `trigger` value with a sensible default, and callers can override it via options.

- [ ] **Step 5: Run test to verify it passes after implementation**

Run: `cd packages/protocol && bun test src/opportunity/tests/opportunity.state.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd packages/protocol
git add src/opportunity/opportunity.state.ts src/opportunity/tests/opportunity.state.spec.ts
git commit -m "feat(opportunity): add trigger parameter to graph state"
```

---

## Task 2 — Persist node writes different initial status per trigger

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts` (persist node, around the branch that writes status for new candidates)
- Modify: `packages/protocol/src/opportunity/opportunity.persist.ts` — if persist logic lives here separately

- [ ] **Step 1: Locate the persist node's status assignment**

Run: `cd packages/protocol && grep -n "status: 'latent'\|status: 'pending'\|initialStatus\|status:.*latent\|status:.*pending" src/opportunity/opportunity.graph.ts src/opportunity/opportunity.persist.ts`
Expected: identifies the lines where new opp rows get their status set during persist.

- [ ] **Step 2: Branch on trigger**

At each identified site, replace the hardcoded status with a trigger-derived value:

```ts
const initialStatus: OpportunityStatus = state.trigger === 'orchestrator' ? 'negotiating' : 'latent';
```

Use `initialStatus` in the insert payload.

- [ ] **Step 3: Write failing test**

Create or extend `packages/protocol/src/opportunity/tests/opportunity.persist.spec.ts`:

```ts
describe('persist node writes initial status per trigger', () => {
  it('writes latent for ambient trigger', async () => {
    // build graph with mock db; invoke persist node with trigger='ambient'
    // assert: db.createOpportunity called with { status: 'latent' }
  });

  it('writes negotiating for orchestrator trigger', async () => {
    // ... trigger='orchestrator'
    // assert: db.createOpportunity called with { status: 'negotiating' }
  });
});
```

- [ ] **Step 4: Run test to verify passes after branch change**

Run: `cd packages/protocol && bun test src/opportunity/tests/opportunity.persist.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/opportunity/
git commit -m "feat(opportunity): persist node writes trigger-specific initial status"
```

---

## Task 3 — Exclude `accepted` and `negotiating` from enricher merge candidates

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.enricher.ts` — default `excludeStatuses` extended.
- Test: `packages/protocol/src/opportunity/tests/opportunity.enricher.spec.ts`

- [ ] **Step 1: Read current exclusion default**

Run: `cd packages/protocol && grep -n "excludeStatuses" src/opportunity/opportunity.enricher.ts`
Expected: shows the default set. Currently likely `['expired']` or similar.

- [ ] **Step 2: Extend default**

In [packages/protocol/src/opportunity/opportunity.enricher.ts](packages/protocol/src/opportunity/opportunity.enricher.ts), change the default to exclude `'accepted'` and `'negotiating'`:

```ts
const DEFAULT_EXCLUDE_STATUSES: OpportunityStatus[] = ['accepted', 'negotiating', 'expired'];
```

(Adjust name to match whatever the current default is.) Callers that want to pass their own `excludeStatuses` still can — this only changes the default used when none is passed.

- [ ] **Step 3: Write failing test**

Add to `opportunity.enricher.spec.ts`:

```ts
it('excludes accepted opportunities from merge candidates by default', async () => {
  // db has: 1 accepted opp (between actors), 1 pending opp (between actors)
  // call enricher with default options
  // assert: findOverlappingOpportunities called with excludeStatuses including 'accepted'
  // assert: only the pending opp is considered for merge
});

it('excludes negotiating opportunities from merge candidates by default', async () => {
  // similar, with 1 negotiating opp
});
```

- [ ] **Step 4: Run test to verify passes**

Run: `cd packages/protocol && bun test src/opportunity/tests/opportunity.enricher.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.enricher.ts packages/protocol/src/opportunity/tests/opportunity.enricher.spec.ts
git commit -m "feat(enricher): exclude accepted and negotiating from merge candidate pool"
```

---

## Task 4 — Add `opportunity_draft_ready` to `AgentStreamEvent`

**Files:**
- Modify: `packages/protocol/src/chat/chat.agent.ts:55-74`
- Modify: `packages/protocol/src/chat/chat-streaming.types.ts` (if event types are re-exported here — verify with grep)
- Test: no explicit unit test; type-check is sufficient.

- [ ] **Step 1: Extend the union**

In [packages/protocol/src/chat/chat.agent.ts:55-74](packages/protocol/src/chat/chat.agent.ts:55), add a new member to the `AgentStreamEvent` discriminated union. Just before the closing `;` of the union definition:

```ts
  | {
      type: "opportunity_draft_ready";
      opportunityId: string;
      rendered: RenderedOpportunityCard;
    };
```

- [ ] **Step 2: Import `RenderedOpportunityCard`**

Ensure `RenderedOpportunityCard` is imported at the top of the file. Grep for its existing export:

Run: `grep -rn "RenderedOpportunityCard\|export.*rendered" packages/protocol/src/opportunity/`
Expected: finds the existing type (probably in `opportunity.presenter.ts` or a types file). Import it into `chat.agent.ts`:

```ts
import type { RenderedOpportunityCard } from '../opportunity/opportunity.presenter';
```

- [ ] **Step 3: Check for shared types file**

Run: `grep -n "AgentStreamEvent" packages/protocol/src/chat/chat-streaming.types.ts`
Expected: if this file also defines or re-exports the event union, update it to match.

- [ ] **Step 4: Type-check**

Run: `cd packages/protocol && bun run build`
Expected: no new type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/chat/
git commit -m "feat(chat-stream): add opportunity_draft_ready event type"
```

---

## Task 5 — Negotiate node: orchestrator fan-out with streaming and abort

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts` (around `negotiateNode`, line 1638 in current code)
- Test: `packages/protocol/src/opportunity/tests/opportunity.graph.trigger.spec.ts` (new)

- [ ] **Step 1: Read the existing `negotiateNode`**

Run: `sed -n '1600,1820p' packages/protocol/src/opportunity/opportunity.graph.ts` (or use an editor). Understand:
- How it iterates over persisted opportunities today.
- Where it calls `NegotiationGraph`.
- What state fields are available (including how to read `trigger` and the graph's `traceEmitter` from `requestContext`).

- [ ] **Step 2: Write failing test fixture**

Create `packages/protocol/src/opportunity/tests/opportunity.graph.trigger.spec.ts`:

```ts
import { describe, it, expect, mock } from 'bun:test';
// ... import the graph factory, mock DB, mock NegotiationGraph

describe('negotiateNode: orchestrator trigger', () => {
  it('runs negotiations for all persisted candidates concurrently', async () => {
    // Fixture: 3 candidates, each NegotiationGraph mock resolves to 'accept'
    // Invoke graph with trigger='orchestrator'
    // Assert: all 3 NegotiationGraph.invoke calls started within a few ms of each other
    //         (i.e. Promise.allSettled, not sequential)
  });

  it('emits opportunity_draft_ready via traceEmitter for each accepted negotiation', async () => {
    // Fixture: 2 accept, 1 reject
    // Capture traceEmitter calls
    // Assert: exactly 2 events emitted, both type='opportunity_draft_ready', with the right opportunityIds
    // Assert: no event for the rejected opp
  });

  it('honors AbortSignal and stops emitting events after abort', async () => {
    // Fixture: 3 slow-resolving negotiations
    // Call abort midway
    // Assert: 0 or 1 events emitted depending on timing; no events after abort timestamp
  });

  it('ambient trigger continues to run sequentially and does not emit events', async () => {
    // Same fixture, trigger='ambient'
    // Assert: sequential invocation pattern preserved
    // Assert: no opportunity_draft_ready emitted
  });
});
```

(Fill in the mock scaffolding following the patterns in existing `opportunity.graph.spec.ts`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/protocol && bun test src/opportunity/tests/opportunity.graph.trigger.spec.ts`
Expected: FAIL — orchestrator branch doesn't exist yet.

- [ ] **Step 4: Implement the orchestrator branch in `negotiateNode`**

In [packages/protocol/src/opportunity/opportunity.graph.ts](packages/protocol/src/opportunity/opportunity.graph.ts) at `negotiateNode` (line ~1638), add a branch on `state.trigger`. Wrap the existing ambient logic in an `if (state.trigger !== 'orchestrator')` branch (preserving it verbatim) and add the orchestrator branch alongside:

```ts
const negotiateNode = async (state: typeof OpportunityGraphState.State) => {
  if (state.trigger === 'orchestrator') {
    const traceEmitter = requestContext.getStore()?.traceEmitter;
    const signal: AbortSignal | undefined = requestContext.getStore()?.abortSignal;
    const ORCHESTRATOR_PARK_WINDOW_MS = 60_000;

    const candidates = state.persistedOpportunities ?? [];
    if (candidates.length === 0) {
      return { orchestratorResults: { newDrafts: [], existingDrafts: [], alreadyAccepted: [] } };
    }

    const results = await Promise.allSettled(
      candidates.map(async (opp) => {
        if (signal?.aborted) {
          return { opportunityId: opp.id, outcome: 'aborted' as const };
        }
        const negotiation = await this.negotiationGraph.invoke(
          {
            opportunityId: opp.id,
            sourceUserId: opp.actors[0].userId,
            candidateUserId: opp.actors[1].userId,
            // ...other required negotiation inputs...
          },
          { timeoutMs: ORCHESTRATOR_PARK_WINDOW_MS, signal },
        );

        // Finalize opp status based on negotiation outcome.
        const finalStatus =
          negotiation.outcome?.action === 'accept' ? 'draft'
          : negotiation.outcome?.action === 'reject' ? 'rejected'
          : 'stalled';
        await this.database.updateOpportunityStatus(opp.id, finalStatus);

        if (finalStatus === 'draft' && !signal?.aborted) {
          const rendered = await this.opportunityPresenter.renderForChat(opp);
          traceEmitter?.({
            type: 'opportunity_draft_ready',
            opportunityId: opp.id,
            rendered,
          });
          return { opportunityId: opp.id, outcome: 'draft' as const, rendered };
        }
        return { opportunityId: opp.id, outcome: finalStatus };
      }),
    );

    // Collate into the structured result shape; silent for rejected/stalled/aborted.
    const newDrafts = results
      .flatMap((r) => (r.status === 'fulfilled' && r.value.outcome === 'draft' ? [r.value] : []))
      .map((v) => ({ opportunityId: v.opportunityId, rendered: v.rendered! }));

    return {
      orchestratorResults: {
        newDrafts,
        existingDrafts: state.dedupExistingDrafts ?? [],
        alreadyAccepted: state.dedupAlreadyAccepted ?? [],
      },
    };
  }

  // Existing ambient logic preserved below.
  // ... current negotiateNode body ...
};
```

Adjustments you will need while implementing:

- The exact shape of `state.persistedOpportunities`, `NegotiationGraph.invoke` inputs, and `opportunityPresenter.renderForChat` must match what exists in the current code. Inspect the ambient branch for the right field names and adapt.
- `requestContext.getStore()?.abortSignal` requires the context to carry an abort signal. This is established in Task 7 (tool layer threads it in).
- `orchestratorResults`, `dedupExistingDrafts`, `dedupAlreadyAccepted` are new state fields — add them to `opportunity.state.ts` alongside Task 1's `trigger` field. Use `{ default: () => ({}) }` or `[]` reducers as appropriate.

- [ ] **Step 5: Run the trigger test**

Run: `cd packages/protocol && bun test src/opportunity/tests/opportunity.graph.trigger.spec.ts`
Expected: PASS.

- [ ] **Step 6: Run the broader opportunity test suite**

Run: `cd packages/protocol && bun test src/opportunity/tests/`
Expected: all existing tests still pass. If the ambient-trigger test regresses, the branch guard (`state.trigger !== 'orchestrator'`) was not preserved correctly — fix.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/opportunity/
git commit -m "feat(opportunity): orchestrator negotiate branch with fan-out + streaming"
```

---

## Task 6 — Dedup node: separate accepted-pair lookup for orchestrator

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts` (dedup node)
- Use: existing `database.getAcceptedOpportunitiesBetweenActors` adapter method (verified present via grep in the spec file-list section)
- Test: extend `opportunity.graph.trigger.spec.ts`

- [ ] **Step 1: Locate the dedup node**

Grep for the dedup node in `opportunity.graph.ts`:

Run: `cd packages/protocol && grep -n "dedup\|enrichOrCreate\|findOverlapping" src/opportunity/opportunity.graph.ts | head -40`
Expected: the node that runs per-candidate overlap checks. Usually wraps `opportunity.enricher.enrichOrCreate` or similar.

- [ ] **Step 2: Add accepted-pair query for orchestrator**

In the dedup node, after running enrichment, if `state.trigger === 'orchestrator'`:

```ts
if (state.trigger === 'orchestrator') {
  // Separate read-only lookup for alreadyAccepted reporting.
  // Enricher already excludes 'accepted' from its merge pool.
  const actorUserIds = state.candidateActors.map((a) => a.userId);
  const acceptedOpps = await this.database.getAcceptedOpportunitiesBetweenActors(actorUserIds);
  const alreadyAccepted = await Promise.all(
    acceptedOpps.map(async (opp) => ({
      opportunityId: opp.id,
      conversationId: await this.database.getConversationIdForActorPair(actorUserIds),
      conversationUrl: `/chat/${conversationId}`, // absolute path is fine; frontend owns the base
      counterpartyName: await this.database.getCounterpartyName(actorUserIds, state.userId),
    })),
  );
  return { ...normalReturn, dedupAlreadyAccepted: alreadyAccepted };
}
```

Adapt names to match existing adapter methods. If `getConversationIdForActorPair` / `getCounterpartyName` don't exist, add them to the protocol interface and backend adapter in this task.

- [ ] **Step 3: Write test**

Extend `opportunity.graph.trigger.spec.ts`:

```ts
it('populates dedupAlreadyAccepted with existing h2h links when orchestrator finds accepted opps', async () => {
  // Fixture: 1 accepted opp between the same actors; conversations table has a matching dmPair row
  // Invoke graph with trigger='orchestrator'
  // Assert: state.dedupAlreadyAccepted includes the accepted opp with the right conversationUrl
});

it('dedupAlreadyAccepted is empty for ambient trigger', async () => {
  // Same fixture, trigger='ambient'
  // Assert: state.dedupAlreadyAccepted is empty or undefined
});
```

- [ ] **Step 4: Run test**

Run: `cd packages/protocol && bun test src/opportunity/tests/opportunity.graph.trigger.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/opportunity/
git commit -m "feat(opportunity): dedup node collects accepted-pair links for orchestrator"
```

---

## Task 7 — `create_opportunities` tool: orchestrator branch, structured output, abort threading

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.tools.ts`
- Test: `packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts`

- [ ] **Step 1: Locate and read the current tool**

Run: `cd packages/protocol && grep -n "create_opportunities\|createOpportunities\|buildCreateOpportunitiesTool" src/opportunity/opportunity.tools.ts | head`
Expected: identifies the tool-factory function.

- [ ] **Step 2: Pass `trigger: 'orchestrator'` and abort signal into the graph invocation**

In the tool's handler body, when invoking `OpportunityGraph`, add:

```ts
const abortSignal: AbortSignal | undefined = requestContext.getStore()?.abortSignal;

const result = await opportunityGraph.invoke(
  {
    // ...existing inputs...
    trigger: 'orchestrator',
  },
  {
    // existing invocation options,
    signal: abortSignal,
  },
);
```

(The tool is invoked from `ChatAgent.streamRun` which already threads `AbortSignal` through `requestContext.run` — see [chat.agent.ts:850-854](packages/protocol/src/chat/chat.agent.ts:850).) If the `requestContext` store doesn't currently carry `abortSignal`, extend its type and have `ChatAgent.streamRun` add it.

- [ ] **Step 3: Restructure the tool's return value**

Replace the current return shape with the structured result from the graph's state after invocation:

```ts
const orchestratorResults = result.orchestratorResults ?? { newDrafts: [], existingDrafts: [], alreadyAccepted: [] };

return {
  success: true,
  data: {
    newDrafts: orchestratorResults.newDrafts,
    existingDrafts: orchestratorResults.existingDrafts,
    alreadyAccepted: orchestratorResults.alreadyAccepted,
    summary: `${orchestratorResults.newDrafts.length} new drafts, ${orchestratorResults.existingDrafts.length} existing, ${orchestratorResults.alreadyAccepted.length} already connected`,
  },
};
```

- [ ] **Step 4: Write test**

In `opportunity.tools.spec.ts`:

```ts
describe('create_opportunities tool — orchestrator', () => {
  it('passes trigger=orchestrator to the graph', async () => {
    // mock graph; invoke tool; assert graph.invoke called with trigger='orchestrator'
  });

  it('threads AbortSignal from requestContext into graph invocation', async () => {
    // mock graph; set AbortController in requestContext; invoke tool
    // assert graph.invoke called with matching signal
  });

  it('returns structured output with newDrafts, existingDrafts, alreadyAccepted', async () => {
    // mock graph to return orchestratorResults; invoke tool
    // assert the output matches expected shape (not just a serialized card list)
  });
});
```

- [ ] **Step 5: Run test**

Run: `cd packages/protocol && bun test src/opportunity/tests/opportunity.tools.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/opportunity/
git commit -m "feat(tool): create_opportunities returns structured result with abort threading"
```

---

## Task 8 — Start Chat atomic endpoint

**Files:**
- Modify: `backend/src/services/opportunity.service.ts` — add `startChat(opportunityId, userId)` method
- Modify: `backend/src/adapters/database.adapter.ts` — helper `findOrCreateConversationByDmPair(userIds)` if not present
- Modify: `backend/src/controllers/opportunity.controller.ts` — add route
- Test: `backend/src/services/tests/opportunity.service.startChat.spec.ts` (new)

- [ ] **Step 1: Write failing test**

Create `backend/src/services/tests/opportunity.service.startChat.spec.ts`:

```ts
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { OpportunityService } from '../opportunity.service';

describe('OpportunityService.startChat', () => {
  // Scaffold with mocked adapter:
  //   - getOpportunity returns an opp with status='pending' or 'draft' and actors including userId
  //   - updateOpportunityStatus flips to 'accepted'
  //   - findOrCreateConversationByDmPair returns { conversationId, created: boolean }

  it('flips pending → accepted and returns existing conversationId when one exists', async () => {
    // fixture: existing conversation for the actor pair
    // call service.startChat(oppId, userId)
    // assert: updateOpportunityStatus('accepted') called
    // assert: no new conversation row inserted
    // assert: return.conversationId matches existing
  });

  it('flips draft → accepted and creates a new conversation when none exists', async () => {
    // fixture: no existing conversation
    // call service.startChat
    // assert: new conversation row inserted with correct dmPair
    // assert: conversationParticipants upserted for both actors
    // assert: return.conversationId is the new row's id
  });

  it('rejects if opp status is not pending or draft', async () => {
    // fixture: opp status='accepted'
    // expect service.startChat to throw BadRequestError or similar
  });

  it('rejects if user is not one of the actors', async () => {
    // fixture: opp actors do not include userId
    // expect service.startChat to throw ForbiddenError
  });

  it('does not insert a seed message', async () => {
    // fixture: new conversation created
    // call service.startChat
    // assert: messages table has NO new row for this conversation (IND-237 handles accepted opp display)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test src/services/tests/opportunity.service.startChat.spec.ts`
Expected: FAIL — method doesn't exist.

- [ ] **Step 3: Implement `startChat` in the service**

In `backend/src/services/opportunity.service.ts`, add:

```ts
  /**
   * Atomically transition an opp to `accepted` and surface the h2h conversation.
   *
   * Flow:
   * - assert opp is in pending or draft status and the user is one of the actors
   * - flip status to accepted
   * - lookup or create a conversation keyed on dmPair (the schema enforces 1-per-pair)
   * - upsert participants for both actors
   * - return the conversationId for navigation
   *
   * No seed message is inserted — the accepted opp itself is rendered inline in the
   * chat timeline (see IND-237). Inserting a system message would duplicate content.
   */
  async startChat(opportunityId: string, userId: string): Promise<{ conversationId: string }> {
    return db.transaction(async (tx) => {
      const opp = await this.adapter.getOpportunityWithTx(tx, opportunityId);
      if (!opp) throw new NotFoundError('opportunity not found');
      if (!['pending', 'draft'].includes(opp.status)) {
        throw new BadRequestError(`cannot start chat on opportunity in status '${opp.status}'`);
      }
      const actorUserIds = opp.actors.map((a) => a.userId);
      if (!actorUserIds.includes(userId)) {
        throw new ForbiddenError('user is not part of this opportunity');
      }

      await this.adapter.updateOpportunityStatusWithTx(tx, opportunityId, 'accepted');

      const { conversationId } = await this.adapter.findOrCreateConversationByDmPairWithTx(tx, actorUserIds);
      await this.adapter.upsertConversationParticipantsWithTx(
        tx,
        conversationId,
        actorUserIds.map((uid) => ({ participantId: uid, participantType: 'user' })),
      );

      return { conversationId };
    });
  }
```

(If the adapter uses a different transactional style, adapt to match existing patterns in the file.)

- [ ] **Step 4: Implement the adapter helper (if needed)**

In `backend/src/adapters/database.adapter.ts`, add `findOrCreateConversationByDmPair` that:
- Computes the deterministic dmPair string from sorted participantIds (match existing convention; grep for how `dmPair` is constructed elsewhere).
- Selects `conversations` by `dmPair`; returns `{ conversationId: existing.id, created: false }` if found.
- Otherwise inserts a new `conversations` row with the dmPair and returns `{ conversationId: new.id, created: true }`.

- [ ] **Step 5: Register the controller route**

In `backend/src/controllers/opportunity.controller.ts`, add:

```ts
  @Post('/:id/start-chat')
  @UseGuards(AuthGuard)
  async startChat(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const opportunityId = params?.id;
    if (!opportunityId) throw new BadRequestError('opportunity id required');
    const result = await this.opportunityService.startChat(opportunityId, user.id);
    return { success: true, data: result };
  }
```

Decide between `POST /opportunities/:id/start-chat` (cleaner, new route) vs overloading `PATCH /opportunities/:id/status` with transition rules. The former is recommended — easier to audit and less accidental cross-use.

- [ ] **Step 6: Run test**

Run: `cd backend && bun test src/services/tests/opportunity.service.startChat.spec.ts`
Expected: all five tests pass.

- [ ] **Step 7: Commit**

```bash
cd backend
git add src/services/opportunity.service.ts src/adapters/database.adapter.ts src/controllers/opportunity.controller.ts src/services/tests/opportunity.service.startChat.spec.ts
git commit -m "feat(opportunity): atomic Start Chat endpoint (flip to accepted + spin h2h)"
```

---

## Task 9 — Frontend: subscribe to `opportunity_draft_ready` and render cards

**Files:**
- Modify: `frontend/src/services/chat.service.ts` (or equivalent SSE/WebSocket client) — handle the new event type
- Modify: `frontend/src/components/chat/ChatMessageList.tsx` (or equivalent) — append cards as events arrive
- Test: `frontend/src/components/chat/tests/...` (extend or add)

- [ ] **Step 1: Locate the chat stream client**

Run: `grep -rn "graph_start\|tool_activity\|AgentStreamEvent" frontend/src/`
Expected: identifies the event-type consumer.

- [ ] **Step 2: Add `opportunity_draft_ready` case**

In the stream client's event switch/reducer, add a case that appends a draft card to the chat UI's state. Example:

```ts
case 'opportunity_draft_ready':
  setChatTimeline((t) => [...t, { type: 'opportunity_card', data: event }]);
  break;
```

- [ ] **Step 3: Render the card**

In the message-list component, ensure items of kind `opportunity_card` render via the existing `OpportunityCard` component (the same one used in the home feed). No new design — reuse.

- [ ] **Step 4: Verify via dev server**

Run: `bun run worktree:dev feat-orchestrator-flow`. In the browser, start a chat session as a user who has some opportunities, ask the orchestrator to find matches. Confirm:

- Cards appear progressively as each negotiation resolves (not all at once at the end).
- The LLM's narrated response arrives after the cards, summarizing counts.
- `rejected`/`stalled` negotiations do not produce cards.

Record observations in the PR description.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/
git commit -m "feat(chat): render opportunity_draft_ready events as inline draft cards"
```

---

## Task 10 — Frontend: wire "Start Chat" to the new endpoint

**Files:**
- Modify: `frontend/src/components/opportunity/OpportunityCard.tsx` (the card's CTA button)
- Modify: `frontend/src/services/opportunity.service.ts` (or wherever the opportunity API client lives)
- Test: component tests

- [ ] **Step 1: Add API call**

In the frontend's opportunity service client, add:

```ts
export async function startChat(opportunityId: string): Promise<{ conversationId: string }> {
  const res = await fetch(`/api/opportunities/${opportunityId}/start-chat`, { method: 'POST' });
  if (!res.ok) throw new Error('start chat failed');
  const body = await res.json();
  return body.data;
}
```

- [ ] **Step 2: Wire the button**

In `OpportunityCard.tsx`, change the Start Chat button's handler:

```tsx
const handleStartChat = async () => {
  const { conversationId } = await opportunityService.startChat(opportunity.id);
  navigate(`/chat/${conversationId}`);
};
```

Replace any prior status-patch call (likely `PATCH /opportunities/:id/status`).

- [ ] **Step 3: Verify**

In the browser, click Start Chat on both a `pending` (home) and `draft` (chat) opp. Confirm:

- The card transitions to accepted (or disappears from pending list).
- Navigation lands in the h2h chat thread.
- For a pair with an existing chat, clicking Start Chat on a new opp reuses the same conversation (no duplicate).

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/
git commit -m "feat(opportunity-card): wire Start Chat to atomic endpoint"
```

---

## Task 11 — Documentation

**Files:**
- Modify: `docs/design/architecture-overview.md` — note the unified flow
- Modify: `docs/design/protocol-deep-dive.md` — update the opportunity-graph section with `trigger` parameter, orchestrator branch
- Modify: `docs/specs/api-reference.md` — new `POST /opportunities/:id/start-chat` endpoint
- Modify: `CLAUDE.md` — only if structural patterns changed (new `trigger` concept in graph invocations may warrant a one-liner under "Important Patterns")

- [ ] **Step 1: Update protocol-deep-dive**

Describe the unified graph: single graph, `trigger: 'ambient' | 'orchestrator'` parameter, node-level branches in persist and negotiate, streaming events for orchestrator only. Mention the `opportunity_draft_ready` event.

- [ ] **Step 2: Update api-reference**

Document `POST /opportunities/:id/start-chat` — request shape, response shape, error cases.

- [ ] **Step 3: Update CLAUDE.md if needed**

Add a note under "Important Patterns" if you believe engineers need to learn the trigger pattern at onboarding time. Otherwise skip (CLAUDE.md should not bloat).

- [ ] **Step 4: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: unified opportunity flow with ambient/orchestrator triggers"
```

---

## Task 12 — Full validation

- [ ] **Step 1: Type-check and lint across workspaces**

```bash
cd packages/protocol && bun run build
cd ../../backend && bun run build && bun run lint
cd ../frontend && bun run lint
```

Expected: all clean.

- [ ] **Step 2: Run the targeted test suites**

```bash
cd packages/protocol && bun test src/opportunity/ src/chat/
cd ../../backend && bun test src/services/tests/opportunity.service.startChat.spec.ts src/services/tests/agent-dispatcher.spec.ts tests/e2e.test.ts
```

Expected: all pass.

- [ ] **Step 3: Manual end-to-end verification**

1. Start all dev servers.
2. As a user without a personal agent, run an orchestrator search for matches. Confirm drafts stream in and clicking one opens an h2h chat.
3. As a user with a fresh personal agent (plugin running), run the same search. Confirm negotiations are parked, the plugin picks them up, and drafts appear in chat within the 60s window.
4. As a user with a stale personal agent (plugin stopped > 90s ago), run the same search. Confirm negotiations run inline via system agent and drafts appear quickly.
5. Run a search that dedup-matches an existing accepted pair. Confirm the LLM narrates the existing chat link rather than creating a new opp.
6. Close the chat mid-search (depends on IND-236 for full correctness, but at minimum confirm no new drafts arrive after close).

- [ ] **Step 4: Open PR**

Push the worktree branch and open a PR to `dev`. Description includes: unified flow, streaming events, Start Chat endpoint, frontend updates. Reference the spec and Plan A. Link to IND-236 for abort semantics.

---

## Self-Review Checklist

- [ ] `trigger` field is threaded consistently through state, options, persist node, negotiate node, and tool layer.
- [ ] `ORCHESTRATOR_PARK_WINDOW_MS` (60s) in Task 5's orchestrator branch matches the dispatcher's expectation (timeoutMs passed becomes the park window — verified by Plan A).
- [ ] `AMBIENT_PARK_WINDOW_MS` from Plan A is reused where the ambient branch passes a park window (avoid redeclaring the constant; import it).
- [ ] `opportunity_draft_ready` event shape is consistent between emitter (Task 5), chat.agent union (Task 4), and frontend consumer (Task 9).
- [ ] `startChat` does not insert a seed system message (IND-237 reason).
- [ ] No placeholders — every TODO-shaped phrase in this plan has an actual code or command beside it.
- [ ] All new public methods have JSDoc per repo conventions.
- [ ] Order of tasks respects dependencies: state (Task 1) → persist (Task 2) and enricher (Task 3) → stream event type (Task 4) → negotiate node (Task 5) → dedup lookup (Task 6) → tool (Task 7) → backend Start Chat (Task 8) → frontend stream (Task 9) → frontend button (Task 10) → docs (Task 11) → validation (Task 12).
