# Bilateral Agent Negotiation Design

## Overview

Bilateral agent-to-agent negotiation that determines whether discovered candidates should become opportunities. Each user's agent advocates autonomously on their behalf, negotiating in structured turns using A2A conversation primitives. Replaces unilateral evaluation as the final opportunity gate.

## Context

The current opportunity pipeline discovers candidates via semantic search (HyDE) and scores them with a unilateral evaluator. This works but has a fundamental limitation: a single scoring function decides mutual fit from one perspective. Bilateral negotiation introduces adversarial evaluation — one agent argues for the match, the other evaluates against its user's interests — producing higher-quality consensus decisions.

## Design Interview Summary

| # | Question | Options | Answer |
|---|----------|---------|--------|
| 1 | **Who are the two sides? What do agents represent?** | (a) User's intents/interests autonomously, (b) The user themselves with input, (c) Mix — autonomous up to threshold then escalate | **(a)** Fully autonomous, advocating based on intents |
| 2 | **What is the negotiation deciding?** | (a) Mutual fit only (yes/no gate), (b) Fit + terms/framing, (c) Fit + visibility tier | **(a)** Mutual fit consensus |
| 3 | **How many turns?** | (a) Fixed 2-turn, (b) Fixed 3-turn, (c) Variable with cap | **(c)** Variable with cap |
| 4 | **What happens when agents can't agree within the cap?** | (a) Default reject, (b) Fall back to unilateral evaluator, (c) Surface as low-confidence | **(a)** Default reject — no consensus means not strong enough |
| 5 | **How does this map to A2A?** | Proposed conversation-per-negotiation mapping | Redirected to read the actual A2A spec (`a2a-llms-full.txt`) |
| 6 | **How much do agents reveal to each other?** | (a) Full transparency, (b) Opaque signals, (c) HyDE-mediated | **(a)** Full transparency — privacy is at human level, not agent level |
| 7 | **Where in the pipeline does negotiation sit?** | (a) Replaces evaluation, (b) After evaluation as second stage, (c) Parallel to evaluation | **(b)** After evaluation — two-stage funnel |
| 8 | **Sync or async execution?** | (a) Fully synchronous, (b) Async via queue | **Both** — design the interface as async A2A (b), execute synchronously for now (a). Federation-ready shape, pragmatic runtime. |
| 9 | **contextId or conversationId?** | New A2A `contextId` concept vs existing `conversationId` | **conversationId** — it's already the `contextId` equivalent in the existing schema |
| 10 | **What's the turn cap?** | (a) 4 turns, (b) 6 turns, (c) Configurable per index | **(b)** 6 turns (3 per agent) |
| 11 | **Which architecture approach?** | (1) New node in opportunity graph, (2) Separate negotiation graph, (3) Queue job | **(2)** Separate negotiation graph |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent autonomy | Fully autonomous (no human in loop) | Agents represent intents/interests, humans see outcomes only |
| Negotiation purpose | Mutual fit consensus (yes/no gate) | Keeps scope focused; presentation is separate |
| Turn structure | Variable with 6-turn cap | Enough for propose/counter/counter/final per side |
| Timeout behavior | Default reject | No consensus = not a strong enough match |
| Information sharing | Full transparency between agents | Privacy boundary is at human level, not agent level |
| Pipeline position | After evaluation (two-stage funnel) | Evaluator is cheap pre-filter; negotiation handles nuanced cases |
| Execution model | Async A2A interface, synchronous execution | Data model is federation-ready; runtime is local LLM calls for now |
| Architecture | Separate negotiation graph | Clean separation, independently testable, maps to future federated execution |

## A2A Primitive Mapping

The negotiation maps directly onto existing A2A conversation primitives:

| Concept | A2A Primitive | Implementation |
|---------|--------------|----------------|
| Negotiation session | `contextId` | `conversationId` (existing conversations table) |
| Negotiation lifecycle | Task | One task per negotiation attempt |
| Agent's turn | Message | `DataPart` with structured `NegotiationTurn` payload |
| "Your turn" signal | `INPUT_REQUIRED` state | Task status transition on counter |
| Consensus reached | `COMPLETED` state | Task terminal + Artifact with outcome |
| No consensus | `COMPLETED` state | Task terminal + Artifact with `consensus: false` |
| Turn cap exceeded | `COMPLETED` state | Task terminal + Artifact with `consensus: false`, `reason: 'turn_cap'` |

**Note on `REJECTED` task state**: The A2A `rejected` state means the agent refused to accept the task (e.g., user has opted out of discovery). It is not used for negotiation outcomes where agents ran but disagreed — that is a `completed` task with `consensus: false`.

## Negotiation Graph

### Graph: `negotiation.graph.ts`

A standalone LangGraph state machine: **init → turn → evaluate → (turn | finalize)**

#### Nodes

**`initNode`**
- Creates an A2A conversation with two participants (participantType: `'agent'`, participantId: `agent:{userId-A}` / `agent:{userId-B}`)
- These negotiation conversations are **internal-only** — they must be excluded from user-facing conversation listings (filter by participantType or a metadata flag)
- Loads both users' relevant intents, profiles, and HyDE documents
- Creates a task in `SUBMITTED` state
- Sets `currentSpeaker: 'source'`, `turnCount: 0`

**`turnNode`**
- Reads `currentSpeaker` to select which agent runs (proposer or responder)
- Loads that user's data from state
- Calls the appropriate agent with the negotiation history
- Appends the resulting A2A message (with `DataPart`) to `messages[]`
- Persists message to DB
- Increments `turnCount`, flips `currentSpeaker`
- Updates task state to `WORKING` (first turn) or `INPUT_REQUIRED` (subsequent turns)

**`evaluateNode`** (conditional routing)
- Reads `lastTurn.action` and `turnCount`
- Routes:
  - `accept` → `finalizeNode`
  - `reject` → `finalizeNode`
  - `counter` + `turnCount < maxTurns` → `turnNode`
  - `counter` + `turnCount >= maxTurns` → `finalizeNode` (default reject)

**`finalizeNode`**
- Reads full `messages[]` history
- Synthesizes `NegotiationOutcome`
- Task state → `COMPLETED` in all cases (negotiation ran to completion)
- Creates artifact with outcome data (`consensus: true/false`)
- If turn cap exceeded: artifact includes `reason: 'turn_cap'`

### State Annotation

```typescript
// Uses Annotation.Root with explicit reducers (LangGraph convention)
const NegotiationState = Annotation.Root({
  // Input (set by opportunity graph caller)
  sourceUser: Annotation<UserNegotiationContext>,      // { id, intents[], profile, hydeDocuments[] }
  candidateUser: Annotation<UserNegotiationContext>,
  indexContext: Annotation<{ indexId: string; prompt: string }>,
  seedAssessment: Annotation<{                         // From evaluator pre-filter
    score: number;
    reasoning: string;
    valencyRole: string;                               // Matches evaluator's OpportunitySchema output
    actors?: { userId: string; role: string }[];       // From entity bundle evaluator, if available
  }>,

  // Conversation tracking
  conversationId: Annotation<string>,                  // A2A contextId
  taskId: Annotation<string>,                          // A2A task for this negotiation
  messages: Annotation<Message[], { reducer: (a, b) => [...a, ...b], default: () => [] }>,
  turnCount: Annotation<number, { default: () => 0 }>,
  maxTurns: Annotation<number, { default: () => 6 }>,

  // Current turn state
  currentSpeaker: Annotation<'source' | 'candidate', { default: () => 'source' as const }>,
  lastTurn: Annotation<NegotiationTurn | null, { default: () => null }>,

  // Output (set by finalizeNode)
  outcome: Annotation<NegotiationOutcome | null, { default: () => null }>,
});
```

## Message Schema

### NegotiationTurn (DataPart payload per message)

```typescript
NegotiationTurn {
  action: 'propose' | 'accept' | 'reject' | 'counter'
  assessment: {
    fitScore: number           // 0-100, this agent's view of the match
    reasoning: string          // Why this is/isn't a good match (includes objections naturally)
    suggestedRoles: {
      ownUser: 'agent' | 'patient' | 'peer'
      otherUser: 'agent' | 'patient' | 'peer'
    }
  }
}

// Agents receive full user context (intents, profile, HyDE docs) via graph state.
// No need to echo evidence back in messages — they argue from context they already hold.
// Reasoning naturally covers objections ("intent alignment is weak in X").

```

### NegotiationOutcome (Artifact payload on COMPLETED task)

```typescript
NegotiationOutcome {
  consensus: boolean
  finalScore: number           // Averaged/negotiated confidence
  agreedRoles: { userId, role }[]
  reasoning: string            // Merged reasoning from both sides
  turnCount: number
}
```

## Agents

### `negotiation.proposer.ts`

Argues for the match. System prompt instructs it to:
- Present its user's relevant intents and profile
- Argue why the match is valuable
- When countering, address the other agent's objections specifically
- Be honest about weak signals (no hallucinating fit)

### `negotiation.responder.ts`

Evaluates proposals against its own user's interests. System prompt instructs it to:
- Assess the proposal against its own user's intents and profile
- Accept if fit is genuine and mutually beneficial
- Reject with clear reasoning if no real value
- Counter with specific objections if partially convinced

Each agent has its own model config key — `createModel('negotiationProposer')` and `createModel('negotiationResponder')` — allowing independent tuning of model, temperature, and token limits per role. Both use structured output via `withStructuredOutput()` with the `NegotiationTurn` Zod schema.

## Integration with Opportunity Graph

The opportunity graph pipeline becomes:

```
Prep → Scope → Discovery → Evaluation → Negotiate → Ranking → Persist
```

### `negotiateNode` (new node in opportunity.graph.ts)

For each candidate that passed the evaluation threshold:

1. Invokes `negotiationGraph.invoke()` with source user data, candidate user data, and the evaluator's initial assessment as seed context
2. Collects `NegotiationOutcome`
3. If `consensus: true` → candidate survives with `finalScore` from negotiation
4. If `consensus: false` → candidate is dropped

The evaluator's score becomes a hint to the negotiation agents (visible as `seedAssessment`), but the negotiation outcome is authoritative.

**Parallelization**: Multiple candidate negotiations run concurrently (independent invocations). Same pattern as `RUN_OPPORTUNITY_EVAL_IN_PARALLEL`.

**Operation modes**: The opportunity graph supports multiple operation modes (standard discovery, continue_discovery, introduction mode). Negotiation applies to **standard discovery** and **queue-triggered discovery** only. `continue_discovery` (paginating cached candidates) and introduction mode (curator-driven) skip negotiation — these paths have different trust models.

**Chat path**: `runDiscoverFromQuery()` calls the opportunity graph which now includes negotiation inline. Higher latency, higher quality. To manage latency: chat path uses `maxTurns: 4` (reduced from default 6) and a **30-second wall-clock timeout** per negotiation. If the timeout fires, treat as no consensus.

**Queue path**: Background `discover_opportunities` job runs the full pipeline including negotiation with the full 6-turn budget. No change to the queue contract.

**Tool timeouts**: `opportunity.tools.ts` may need timeout increases to accommodate negotiation latency in the chat path. The tool's existing timeout should be reviewed during implementation.

## Trace Instrumentation

Follows existing trace event patterns for the chat UI TRACE panel:

```typescript
// In negotiateNode (opportunity graph) — wraps negotiation graph invocation
traceEmitter?.({ type: "graph_start", name: "negotiation" });
const result = await negotiationGraph.invoke(input, config);
traceEmitter?.({ type: "graph_end", name: "negotiation", durationMs });

// Inside negotiation graph turnNode — wraps each agent call
traceEmitter?.({ type: "agent_start", name: "negotiation-proposer" });
traceEmitter?.({ type: "agent_end", name: "negotiation-proposer",
  durationMs, summary: "Turn 2: countered, fitScore 74" });
```

Timing data is handled exclusively via `traceEmitter` events. The negotiation graph does not maintain its own `agentTimings` state accumulator — the opportunity graph's `negotiateNode` emits `graph_start`/`graph_end` which is sufficient for debug metadata.

## Error Handling

- **LLM timeout/failure in turnNode**: Treat as rejection — route to finalizeNode with `consensus: false`. Negotiation failure doesn't block the pipeline.
- **DB write failure** (conversation/message persistence): Log and continue. A2A data is a record, not a gate.
- **Invalid agent output** (Zod validation fails): Retry once. If still invalid, treat as rejection.

## File Organization

New files:
```
protocol/src/lib/protocol/
├── graphs/
│   └── negotiation.graph.ts        # LangGraph state machine
├── agents/
│   ├── negotiation.proposer.ts     # Argues for the match
│   └── negotiation.responder.ts    # Evaluates against its user's interests
├── states/
│   └── negotiation.state.ts        # State annotation & Zod schemas
```

Modified files:
- `protocol/src/lib/protocol/graphs/opportunity.graph.ts` — new `negotiateNode`, edge rewiring between evaluation and ranking
- `protocol/src/lib/protocol/agents/model.config.ts` — new `negotiationProposer` and `negotiationResponder` entries

Unchanged:
- `protocol/src/lib/protocol/support/opportunity.discover.ts` — calls opportunity graph (transparent)
- `protocol/src/queues/opportunity.queue.ts` — same job contract

## Schema Changes

No database schema changes required. The negotiation uses existing A2A tables (conversations, conversation_participants, messages, tasks, artifacts) with no new columns or tables. Negotiation-specific data lives in the `parts` (JSONB) and `metadata` (JSONB) fields of messages, tasks, and artifacts. No migration needed.

## Testing Strategy

**Unit tests** (`negotiation.graph.spec.ts`):
- Mock both agents (proposer/responder) to return deterministic `NegotiationTurn` payloads
- Test evaluate routing: accept → finalize, reject → finalize, counter under cap → turn, counter at cap → finalize
- Test state transitions: turnCount increments, currentSpeaker flips, messages accumulate
- Test error paths: LLM failure → consensus false, Zod validation failure → retry then reject

**Integration tests** (`negotiation.integration.spec.ts`):
- Real LLM calls with test user data (30s timeout per test)
- Verify A2A records created: conversation, participants, messages, task, artifact
- Verify negotiation outcome shape matches `NegotiationOutcome` schema

**Opportunity graph integration** (`opportunity.negotiation.spec.ts`):
- Mock negotiation graph to return consensus/no-consensus outcomes
- Verify candidates are filtered correctly based on negotiation results
- Verify operation mode routing: standard discovery invokes negotiation, continue_discovery skips it

## Future: Federation

The design is intentionally federation-ready:
- **Data model**: Real A2A primitives (conversations, tasks, messages, artifacts) with correct state transitions
- **Execution**: Currently a synchronous loop (both agents are local LLM calls), but the graph's invoke interface is the seam — replace it with HTTP `SendMessage` calls to remote agent servers
- **No migration needed**: The A2A data in the DB is already protocol-compliant; only the executor changes
