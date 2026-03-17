# Trace Hierarchy: Real-time Graph/Agent Events Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Stream `graph_start`, `graph_end`, `agent_start`, `agent_end` SSE events from LangGraph nodes to the frontend so `ToolCallsDisplay` shows a live indented tool → graph → agent hierarchy with durations and structured summaries.

**Architecture:** Approach A — request-context emitter. Extend the existing `AsyncLocalStorage` request context to carry a `traceEmitter` callback. `chat.agent.ts` wraps each `tool.invoke()` in `requestContext.run()` with the emitter pointing at the SSE `emit` function. Tool files emit `graph_start`/`graph_end`; graph nodes emit `agent_start`/`agent_end`. `chat.streamer.ts` forwards all four as SSE. `AIChatContext` processes them into `TraceEvent[]`. `ToolCallsDisplay` renders them as indented rows under the enclosing tool.

**Tech Stack:** TypeScript, LangGraph, Bun, AsyncLocalStorage, React, Tailwind CSS

---

## Task 1: Extend types

**Files:**
- Modify: `protocol/src/lib/request-context.ts`
- Modify: `protocol/src/lib/protocol/agents/chat.agent.ts` (lines 45–62)
- Modify: `protocol/src/types/chat-streaming.types.ts`

### Step 1: Add `TraceEmitter` to request context

In `protocol/src/lib/request-context.ts`, replace the entire file with:

```typescript
import { AsyncLocalStorage } from "async_hooks";

/** Callback for streaming graph/agent trace events from deep inside graph nodes. */
export type TraceEmitter = (event: {
  type: "graph_start" | "graph_end" | "agent_start" | "agent_end";
  name: string;
  durationMs?: number;
  summary?: string;
}) => void;

interface RequestContext {
  originUrl?: string;
  traceEmitter?: TraceEmitter;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
```

### Step 2: Add `graph_start`, `graph_end`, `agent_start`, `agent_end` to `AgentStreamEvent`

In `protocol/src/lib/protocol/agents/chat.agent.ts`, extend the `AgentStreamEvent` union (after the existing `tool_activity` variants):

```typescript
export type AgentStreamEvent =
  | { type: "iteration_start"; iteration: number }
  | { type: "llm_start"; iteration: number }
  | { type: "text_chunk"; content: string }
  | { type: "llm_end"; iteration: number; hasToolCalls: boolean; toolNames?: string[] }
  | { type: "tool_activity"; phase: "start"; name: string }
  | {
      type: "tool_activity";
      phase: "end";
      name: string;
      success: boolean;
      summary?: string;
      steps?: Array<{ step: string; detail?: string; data?: Record<string, unknown> }>;
    }
  | { type: "graph_start"; name: string }
  | { type: "graph_end"; name: string; durationMs: number }
  | { type: "agent_start"; name: string }
  | { type: "agent_end"; name: string; durationMs: number; summary: string };
```

### Step 3: Add SSE event types and factory functions in `chat-streaming.types.ts`

**3a.** In `ChatStreamEventType` union (lines 9–31), add:
```typescript
  | "graph_start"
  | "graph_end"
  | "agent_start"
  | "agent_end"
```

**3b.** After `DebugMetaEvent` interface (after line 341), add four interfaces:

```typescript
/** Graph start event — emitted when a LangGraph sub-graph begins inside a tool. */
export interface GraphStartEvent extends ChatStreamEventBase {
  type: "graph_start";
  graphName: string;
}

/** Graph end event — emitted when a LangGraph sub-graph completes. */
export interface GraphEndEvent extends ChatStreamEventBase {
  type: "graph_end";
  graphName: string;
  durationMs: number;
}

/** Agent start event — emitted when an LLM agent begins inside a graph node. */
export interface AgentStartEvent extends ChatStreamEventBase {
  type: "agent_start";
  agentName: string;
}

/** Agent end event — emitted when an LLM agent completes. */
export interface AgentEndEvent extends ChatStreamEventBase {
  type: "agent_end";
  agentName: string;
  durationMs: number;
  /** Structured outcome summary, e.g. "5 of 12 passed" or "3 intents extracted". */
  summary: string;
}
```

**3c.** Add the four new types to the `ChatStreamEvent` union:

```typescript
export type ChatStreamEvent =
  | StatusEvent
  // ... existing entries ...
  | DebugMetaEvent
  | GraphStartEvent
  | GraphEndEvent
  | AgentStartEvent
  | AgentEndEvent;
```

**3d.** Add four factory functions at the end of the file:

```typescript
export function createGraphStartEvent(sessionId: string, graphName: string): GraphStartEvent {
  return createStreamEvent<GraphStartEvent>("graph_start", sessionId, { graphName });
}

export function createGraphEndEvent(sessionId: string, graphName: string, durationMs: number): GraphEndEvent {
  return createStreamEvent<GraphEndEvent>("graph_end", sessionId, { graphName, durationMs });
}

export function createAgentStartEvent(sessionId: string, agentName: string): AgentStartEvent {
  return createStreamEvent<AgentStartEvent>("agent_start", sessionId, { agentName });
}

export function createAgentEndEvent(
  sessionId: string,
  agentName: string,
  durationMs: number,
  summary: string,
): AgentEndEvent {
  return createStreamEvent<AgentEndEvent>("agent_end", sessionId, { agentName, durationMs, summary });
}
```

### Step 4: Run tsc

```bash
cd protocol && npx tsc --noEmit
```

Expected: zero errors.

### Step 5: Commit

```bash
git add protocol/src/lib/request-context.ts \
        protocol/src/lib/protocol/agents/chat.agent.ts \
        protocol/src/types/chat-streaming.types.ts
git commit -m "feat(trace): add graph/agent event types and TraceEmitter to request context"
```

---

## Task 2: Wire `traceEmitter` in `chat.agent.ts`

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.agent.ts`

### Step 1: Import `requestContext`

At the top of `chat.agent.ts`, add to the imports:

```typescript
import { requestContext } from '../../request-context';
```

### Step 2: Wrap `tool.invoke()` with `requestContext.run()`

Find the tool dispatch loop (currently around line 637–641):

```typescript
// BEFORE
const toolStart = Date.now();
try {
  logger.verbose("Streaming: executing tool", { name: tc.name });
  let result = await tool.invoke(tc.args);
  const toolDurationMs = Date.now() - toolStart;
```

Replace with:

```typescript
const toolStart = Date.now();
try {
  logger.verbose("Streaming: executing tool", { name: tc.name });
  const currentCtx = requestContext.getStore() ?? {};
  let result = await requestContext.run(
    { ...currentCtx, traceEmitter: (e) => emit({ type: e.type, name: e.name, durationMs: e.durationMs, summary: e.summary } as AgentStreamEvent) },
    () => tool.invoke(tc.args),
  );
  const toolDurationMs = Date.now() - toolStart;
```

> Note: `AgentStreamEvent` is imported from this file itself (it's defined and exported here).
> The `emit` function is the `StreamWriter` callback already in scope (passed as a parameter named `emit` or `writer` — use whichever name is used in the `streamRun` method signature).

### Step 3: Run tsc

```bash
cd protocol && npx tsc --noEmit
```

### Step 4: Commit

```bash
git add protocol/src/lib/protocol/agents/chat.agent.ts
git commit -m "feat(trace): wire traceEmitter into tool.invoke via requestContext"
```

---

## Task 3: Forward new events in `chat.streamer.ts`

**Files:**
- Modify: `protocol/src/lib/protocol/streamers/chat.streamer.ts`

### Step 1: Add new imports

At the top of `chat.streamer.ts`, add to the import from `chat-streaming.types`:

```typescript
import type {
  ChatStreamEvent,
  DebugMetaToolCall,
} from "../../../types/chat-streaming.types";
import {
  // ... existing imports ...
  createGraphStartEvent,
  createGraphEndEvent,
  createAgentStartEvent,
  createAgentEndEvent,
} from "../../../types/chat-streaming.types";
```

### Step 2: Handle the four new event types in the custom event handler

In `streamChatEvents`, inside the `if (mode === "custom")` block (after the existing `tool_activity` handler, around line 224):

```typescript
if (event.type === "graph_start") {
  yield createGraphStartEvent(sessionId, event.name);
}

if (event.type === "graph_end") {
  yield createGraphEndEvent(sessionId, event.name, event.durationMs);
}

if (event.type === "agent_start") {
  yield createAgentStartEvent(sessionId, event.name);
}

if (event.type === "agent_end") {
  yield createAgentEndEvent(sessionId, event.name, event.durationMs, event.summary);
}
```

### Step 3: Run tsc

```bash
cd protocol && npx tsc --noEmit
```

### Step 4: Commit

```bash
git add protocol/src/lib/protocol/streamers/chat.streamer.ts
git commit -m "feat(trace): forward graph/agent SSE events from streamer"
```

---

## Task 4: Instrument tool files with `graph_start` / `graph_end`

**Files:**
- Modify: `protocol/src/lib/protocol/tools/opportunity.tools.ts`
- Modify: `protocol/src/lib/protocol/tools/intent.tools.ts`
- Modify: `protocol/src/lib/protocol/tools/profile.tools.ts`
- Modify: `protocol/src/lib/protocol/tools/index.tools.ts`

### Pattern

For every `graphs.X.invoke(...)` call in each tool file, wrap with `traceEmitter` calls. The tool files already have `_graphStart` / `_graphMs` timing variables (added in the previous debug-meta feature). Reuse them:

```typescript
// At the top of the tool file (with other imports):
import { requestContext } from '../../request-context';

// BEFORE each graphs.X.invoke():
requestContext.getStore()?.traceEmitter?.({ type: 'graph_start', name: '<graph-name>' });

// AFTER (using existing _graphMs variable):
requestContext.getStore()?.traceEmitter?.({ type: 'graph_end', name: '<graph-name>', durationMs: _graphMs });
```

### Graph name strings (same as in debug-meta plan)

| Tool file | Graph call | `name` string |
|---|---|---|
| `opportunity.tools.ts` | `graphs.opportunity.invoke(...)` | `"opportunity"` |
| `intent.tools.ts` | `graphs.intent.invoke(...)` | `"intent"` |
| `intent.tools.ts` | `graphs.intentIndex.invoke(...)` | `"intent_index"` |
| `intent.tools.ts` | `graphs.profile.invoke(...)` | `"profile"` |
| `profile.tools.ts` | `graphs.profile.invoke(...)` | `"profile"` |
| `index.tools.ts` | `graphs.index.invoke(...)` | `"index"` |

> `index.tools.ts` and `index_membership` graphs have no LLM agents — emit graph_start/graph_end anyway (durationMs is still useful).

### Step 1: Apply the pattern to all 4 tool files

Check each `graphs.X.invoke()` call site. If the file already has `_graphStart = Date.now()` before the call and `_graphMs = Date.now() - _graphStart` after (from the debug-meta implementation), just add the two `requestContext.getStore()?.traceEmitter?.()` lines alongside them.

For call sites that don't yet have timing variables (e.g. `index.tools.ts` line 20, 275, 305, 353), add:

```typescript
const _graphStart = Date.now();
requestContext.getStore()?.traceEmitter?.({ type: 'graph_start', name: 'index' });
const result = await graphs.index.invoke({ ... });
const _graphMs = Date.now() - _graphStart;
requestContext.getStore()?.traceEmitter?.({ type: 'graph_end', name: 'index', durationMs: _graphMs });
```

### Step 2: Run tsc

```bash
cd protocol && npx tsc --noEmit
```

### Step 3: Commit

```bash
git add \
  protocol/src/lib/protocol/tools/opportunity.tools.ts \
  protocol/src/lib/protocol/tools/intent.tools.ts \
  protocol/src/lib/protocol/tools/profile.tools.ts \
  protocol/src/lib/protocol/tools/index.tools.ts
git commit -m "feat(trace): emit graph_start/graph_end from tool files via requestContext"
```

---

## Task 5: Instrument `opportunity.graph.ts` agent calls

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts`

### Step 1: Import `requestContext`

Add at the top of the file:
```typescript
import { requestContext } from '../../../lib/request-context';
```

### Step 2: Instrument `evaluationNode` (main evaluation)

The node already has `agentTimingsAccum`. Locate each `evaluator.invokeEntityBundle()` call and add emitter calls around them.

**For the parallel path** (inside the `Promise.all` `.map()` callback, around line 1158):

```typescript
// BEFORE
const _evalStart = Date.now();
return evaluator.invokeEntityBundle(input, { minScore, returnAll: true })
  .then((res) => {
    agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: Date.now() - _evalStart });
    return res;
  })
```

Replace with:

```typescript
requestContext.getStore()?.traceEmitter?.({ type: 'agent_start', name: 'opportunity.evaluator' });
const _evalStart = Date.now();
return evaluator.invokeEntityBundle(input, { minScore, returnAll: true })
  .then((res) => {
    const _evalMs = Date.now() - _evalStart;
    agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _evalMs });
    const passed = res.filter(o => o.score >= minScore).length;
    requestContext.getStore()?.traceEmitter?.({
      type: 'agent_end',
      name: 'opportunity.evaluator',
      durationMs: _evalMs,
      summary: `${passed} of 1 passed`,
    });
    return res;
  })
  .catch((err) => {
    const _evalMs = Date.now() - _evalStart;
    agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _evalMs });
    requestContext.getStore()?.traceEmitter?.({
      type: 'agent_end',
      name: 'opportunity.evaluator',
      durationMs: _evalMs,
      summary: 'failed',
    });
    // ... existing error handling
  });
```

**For the bundled path** (around line 1187):

```typescript
// Replace existing:
const _evalStart = Date.now();
const opportunitiesWithActors = await evaluator.invokeEntityBundle(input, { minScore, returnAll: true });
agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: Date.now() - _evalStart });

// With:
requestContext.getStore()?.traceEmitter?.({ type: 'agent_start', name: 'opportunity.evaluator' });
const _evalStart = Date.now();
const opportunitiesWithActors = await evaluator.invokeEntityBundle(input, { minScore, returnAll: true });
const _evalMs = Date.now() - _evalStart;
agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _evalMs });
const _passed = opportunitiesWithActors.filter(o => o.score >= minScore).length;
requestContext.getStore()?.traceEmitter?.({
  type: 'agent_end',
  name: 'opportunity.evaluator',
  durationMs: _evalMs,
  summary: `${_passed} of ${candidateEntities.length} passed`,
});
```

### Step 3: Instrument `introEvaluationNode` (around line 1539)

```typescript
// Replace:
const _evalStart = Date.now();
const evaluated = await (evaluatorAgent as OpportunityEvaluator).invokeEntityBundle(input, { minScore: 0 });
agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: Date.now() - _evalStart });

// With:
requestContext.getStore()?.traceEmitter?.({ type: 'agent_start', name: 'opportunity.evaluator' });
const _evalStart = Date.now();
const evaluated = await (evaluatorAgent as OpportunityEvaluator).invokeEntityBundle(input, { minScore: 0 });
const _evalMs = Date.now() - _evalStart;
agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: _evalMs });
requestContext.getStore()?.traceEmitter?.({
  type: 'agent_end',
  name: 'opportunity.evaluator',
  durationMs: _evalMs,
  summary: evaluated.length > 0 ? `score: ${evaluated[0].score}` : 'no result',
});
```

### Step 4: Instrument presenter calls

Search for `presenter.generateCardTexts(` in the file. Wrap each call:

```typescript
requestContext.getStore()?.traceEmitter?.({ type: 'agent_start', name: 'opportunity.presenter' });
const _presenterStart = Date.now();
const cardTexts = await presenter.generateCardTexts(...);
const _presenterMs = Date.now() - _presenterStart;
agentTimingsAccum.push({ name: 'opportunity.presenter', durationMs: _presenterMs });
requestContext.getStore()?.traceEmitter?.({
  type: 'agent_end',
  name: 'opportunity.presenter',
  durationMs: _presenterMs,
  summary: `${Array.isArray(cardTexts) ? cardTexts.length : 1} cards generated`,
});
```

> The existing `agentTimingsAccum.push({ name: 'opportunity.presenter', ... })` lines are already in the code from the debug-meta implementation — just add the two `traceEmitter` calls alongside them, and replace the `Date.now() - _presenterStart` with a captured variable like `_presenterMs`.

### Step 5: Run tsc

```bash
cd protocol && npx tsc --noEmit
```

### Step 6: Commit

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "feat(trace): emit agent_start/agent_end from opportunity graph nodes"
```

---

## Task 6: Instrument remaining 5 graph files

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/intent.graph.ts`
- Modify: `protocol/src/lib/protocol/graphs/intent_index.graph.ts`
- Modify: `protocol/src/lib/protocol/graphs/profile.graph.ts`
- Modify: `protocol/src/lib/protocol/graphs/hyde.graph.ts`
- Modify: `protocol/src/lib/protocol/graphs/home.graph.ts`

### Step 1: Add import to all 5 files

At the top of each file:
```typescript
import { requestContext } from '../../../lib/request-context';
```

### Step 2: Instrument `intent.graph.ts`

All three agent calls already have `agentTimingsAccum.push()`. Add `traceEmitter` calls around each:

**`inferrer.invoke()` (around line 200):**
```typescript
// Before:
requestContext.getStore()?.traceEmitter?.({ type: 'agent_start', name: 'intent.inferrer' });
const inferrerStart = Date.now();
const result = await inferrer.invoke(...);
// Replace push line with:
const _inferrerMs = Date.now() - inferrerStart;
agentTimingsAccum.push({ name: 'intent.inferrer', durationMs: _inferrerMs });
requestContext.getStore()?.traceEmitter?.({
  type: 'agent_end',
  name: 'intent.inferrer',
  durationMs: _inferrerMs,
  summary: `${result.intents.length} intents extracted`,
});
```

**`verifier.invoke()` (inside parallel `.map()`, around line 261):**
```typescript
requestContext.getStore()?.traceEmitter?.({ type: 'agent_start', name: 'intent.verifier' });
const verifierStart = Date.now();
let verdict = await verifier.invoke(description, state.userProfile);
// After push:
const _verifierMs = Date.now() - verifierStart;
agentTimingsAccum.push({ name: 'intent.verifier', durationMs: _verifierMs });
requestContext.getStore()?.traceEmitter?.({
  type: 'agent_end',
  name: 'intent.verifier',
  durationMs: _verifierMs,
  summary: verdict.decision === 'accept' ? 'verified' : 'rejected',
});
```

> If the existing code captures `verifierStart` differently, adapt accordingly.

**`reconciler.invoke()` (around line 437):**
```typescript
requestContext.getStore()?.traceEmitter?.({ type: 'agent_start', name: 'intent.reconciler' });
const reconcilerStart = Date.now();
const result = await reconciler.invoke(formattedCandidates, state.activeIntents);
const _reconcilerMs = Date.now() - reconcilerStart;
agentTimingsAccum.push({ name: 'intent.reconciler', durationMs: _reconcilerMs });
const changeCount = (result.toCreate?.length ?? 0) + (result.toUpdate?.length ?? 0) + (result.toDelete?.length ?? 0);
requestContext.getStore()?.traceEmitter?.({
  type: 'agent_end',
  name: 'intent.reconciler',
  durationMs: _reconcilerMs,
  summary: changeCount > 0 ? `${changeCount} changes` : 'no changes',
});
```

### Step 3: Instrument `intent_index.graph.ts`

The `assignNode` has one `indexer.evaluate()` call with `agentTimingsAccum.push()`. Add:

```typescript
requestContext.getStore()?.traceEmitter?.({ type: 'agent_start', name: 'intent.indexer' });
const _indexerStart = Date.now();
const result = await indexer.evaluate(...);
const _indexerMs = Date.now() - _indexerStart;
agentTimingsAccum.push({ name: 'intent.indexer', durationMs: _indexerMs });
requestContext.getStore()?.traceEmitter?.({
  type: 'agent_end',
  name: 'intent.indexer',
  durationMs: _indexerMs,
  summary: result.shouldAssign ? 'assigned' : 'skipped',
});
```

### Step 4: Instrument `profile.graph.ts`

**`profileGenerator.invoke()` (around line 550):**
```typescript
// The file already has:
const profileGeneratorStart = Date.now();
const result = await profileGenerator.invoke(inputWithContext);
agentTimingsAccum.push({ name: 'profile.generator', durationMs: Date.now() - profileGeneratorStart });

// Replace with:
requestContext.getStore()?.traceEmitter?.({ type: 'agent_start', name: 'profile.generator' });
const profileGeneratorStart = Date.now();
const result = await profileGenerator.invoke(inputWithContext);
const _profileMs = Date.now() - profileGeneratorStart;
agentTimingsAccum.push({ name: 'profile.generator', durationMs: _profileMs });
requestContext.getStore()?.traceEmitter?.({
  type: 'agent_end',
  name: 'profile.generator',
  durationMs: _profileMs,
  summary: 'profile generated',
});
```

**`hydeGenerator.invoke()` (around line 668):**
```typescript
// The file already has:
const hydeGeneratorStart = Date.now();
const result = await hydeGenerator.invoke(profileString);
agentTimingsAccum.push({ name: 'hyde.generator', durationMs: Date.now() - hydeGeneratorStart });

// Replace with:
requestContext.getStore()?.traceEmitter?.({ type: 'agent_start', name: 'hyde.generator' });
const hydeGeneratorStart = Date.now();
const result = await hydeGenerator.invoke(profileString);
const _hydeMs = Date.now() - hydeGeneratorStart;
agentTimingsAccum.push({ name: 'hyde.generator', durationMs: _hydeMs });
const _hydeDocCount = Array.isArray(result) ? result.length : (result?.documents?.length ?? 1);
requestContext.getStore()?.traceEmitter?.({
  type: 'agent_end',
  name: 'hyde.generator',
  durationMs: _hydeMs,
  summary: `${_hydeDocCount} documents`,
});
```

### Step 5: Instrument `hyde.graph.ts`

Search for `lensInferrer.infer(` and `hydeGenerator.run(` / `.invoke(` / `.generate(` calls. Wrap each with the same pattern:

- `lens.inferrer` agent: summary = `"${result.lenses?.length ?? 0} lenses"`
- `hyde.generator` agent: summary = `"${count} documents"`

### Step 6: Instrument `home.graph.ts`

Search for `presenter.generateCardTexts(` and `categorizer.run(` calls. Wrap each:

- `opportunity.presenter` agent: summary = `"${cardTexts.length} cards"`
- `home.categorizer` agent: summary = `"${result.categories?.length ?? 0} categories"`

### Step 7: Run tsc

```bash
cd protocol && npx tsc --noEmit
```

### Step 8: Commit

```bash
git add \
  protocol/src/lib/protocol/graphs/intent.graph.ts \
  protocol/src/lib/protocol/graphs/intent_index.graph.ts \
  protocol/src/lib/protocol/graphs/profile.graph.ts \
  protocol/src/lib/protocol/graphs/hyde.graph.ts \
  protocol/src/lib/protocol/graphs/home.graph.ts
git commit -m "feat(trace): emit agent_start/agent_end from intent, profile, hyde, home graph nodes"
```

---

## Task 7: Frontend — `TraceEvent` types + `AIChatContext` SSE handling

**Files:**
- Modify: `frontend/src/contexts/AIChatContext.tsx`

### Step 1: Extend `TraceEventType`

```typescript
export type TraceEventType =
  | "iteration_start"
  | "llm_start"
  | "llm_end"
  | "tool_start"
  | "tool_end"
  | "graph_start"
  | "graph_end"
  | "agent_start"
  | "agent_end";
```

### Step 2: Add `durationMs` field to `TraceEvent`

```typescript
export interface TraceEvent {
  type: TraceEventType;
  timestamp: number;
  iteration?: number;
  name?: string;
  status?: "running" | "success" | "error";
  summary?: string;
  steps?: ToolCallStep[];
  hasToolCalls?: boolean;
  toolNames?: string[];
  /** Wall-clock duration in milliseconds (set on *_end events). */
  durationMs?: number;
}
```

### Step 3: Handle new SSE cases in `sendMessage`

Inside the `switch (event.type)` block (after the existing `tool_activity` case, around line 334):

```typescript
case "graph_start": {
  const e: TraceEvent = {
    type: "graph_start",
    timestamp: Date.now(),
    name: event.graphName,
    status: "running",
  };
  streamTraceEvents.push(e);
  setMessages((prev) =>
    prev.map((msg) => {
      if (msg.id !== assistantMessageId) return msg;
      return { ...msg, traceEvents: [...(msg.traceEvents || []), e] };
    }),
  );
  break;
}
case "graph_end": {
  const e: TraceEvent = {
    type: "graph_end",
    timestamp: Date.now(),
    name: event.graphName,
    durationMs: event.durationMs,
    status: "success",
  };
  streamTraceEvents.push(e);
  setMessages((prev) =>
    prev.map((msg) => {
      if (msg.id !== assistantMessageId) return msg;
      return { ...msg, traceEvents: [...(msg.traceEvents || []), e] };
    }),
  );
  break;
}
case "agent_start": {
  const e: TraceEvent = {
    type: "agent_start",
    timestamp: Date.now(),
    name: event.agentName,
    status: "running",
  };
  streamTraceEvents.push(e);
  setMessages((prev) =>
    prev.map((msg) => {
      if (msg.id !== assistantMessageId) return msg;
      return { ...msg, traceEvents: [...(msg.traceEvents || []), e] };
    }),
  );
  break;
}
case "agent_end": {
  const e: TraceEvent = {
    type: "agent_end",
    timestamp: Date.now(),
    name: event.agentName,
    durationMs: event.durationMs,
    summary: event.summary,
    status: "success",
  };
  streamTraceEvents.push(e);
  setMessages((prev) =>
    prev.map((msg) => {
      if (msg.id !== assistantMessageId) return msg;
      return { ...msg, traceEvents: [...(msg.traceEvents || []), e] };
    }),
  );
  break;
}
```

### Step 4: Update `mergeDebugMetaIntoTraceEvents` to handle graph/agent data on reload

The function currently only merges `steps` into `tool_end` events. Extend it to also inject `graph_start`/`graph_end`/`agent_start`/`agent_end` events derived from `debugMeta.tools[].graphs[].agents[]` when no live trace events of those types exist:

```typescript
function mergeDebugMetaIntoTraceEvents(
  traceEvents: TraceEvent[] | undefined,
  debugMeta: {
    tools?: Array<{
      name: string;
      durationMs?: number;
      steps?: ToolCallStep[];
      graphs?: Array<{
        name: string;
        durationMs: number;
        agents: Array<{ name: string; durationMs: number; summary?: string }>;
      }>;
    }>;
  } | undefined | null,
): TraceEvent[] | undefined {
  if (!traceEvents || !debugMeta?.tools?.length) return traceEvents;

  const hasGraphEvents = traceEvents.some((e) => e.type === "graph_start" || e.type === "graph_end");
  const merged = [...traceEvents];

  for (const toolDebug of debugMeta.tools) {
    // Merge steps (existing behaviour)
    if (toolDebug.steps?.length) {
      const toolEndIdx = merged.findIndex(
        (e) => e.type === "tool_end" && e.name === toolDebug.name && !e.steps?.length,
      );
      if (toolEndIdx !== -1) {
        merged[toolEndIdx] = { ...merged[toolEndIdx], steps: toolDebug.steps };
      }
    }

    // If no live graph events exist (old session), inject synthetic events from debugMeta
    if (!hasGraphEvents && toolDebug.graphs?.length) {
      const toolEndIdx = merged.findIndex(
        (e) => e.type === "tool_end" && e.name === toolDebug.name,
      );
      if (toolEndIdx !== -1) {
        const synthetic: TraceEvent[] = [];
        for (const g of toolDebug.graphs) {
          synthetic.push({ type: "graph_start", timestamp: 0, name: g.name, status: "success" });
          for (const a of g.agents) {
            synthetic.push({ type: "agent_start", timestamp: 0, name: a.name, status: "success" });
            synthetic.push({
              type: "agent_end",
              timestamp: 0,
              name: a.name,
              durationMs: a.durationMs,
              summary: (a as { summary?: string }).summary ?? "",
              status: "success",
            });
          }
          synthetic.push({ type: "graph_end", timestamp: 0, name: g.name, durationMs: g.durationMs, status: "success" });
        }
        // Insert synthetic events just before the tool_end
        merged.splice(toolEndIdx, 0, ...synthetic);
      }
    }
  }
  return merged;
}
```

### Step 5: Run tsc check (frontend)

```bash
cd frontend && npx tsc --noEmit
```

### Step 6: Commit

```bash
git add frontend/src/contexts/AIChatContext.tsx
git commit -m "feat(trace): handle graph/agent SSE events in AIChatContext"
```

---

## Task 8: Frontend — `ToolCallsDisplay` hierarchical rendering

**Files:**
- Modify: `frontend/src/components/chat/ToolCallsDisplay.tsx`

### Step 1: Add `GRAPH_NAMES` and `AGENT_NAMES` dictionaries

After the existing `TOOL_DESCRIPTIONS` dictionary, add:

```typescript
const GRAPH_NAMES: Record<string, string> = {
  opportunity: "Discovery",
  intent: "Intent",
  intent_index: "Index assignment",
  profile: "Profile",
  hyde: "Search docs",
  home: "Home feed",
  index: "Index",
  index_membership: "Membership",
};

const AGENT_NAMES: Record<string, string> = {
  "opportunity.evaluator": "Evaluating candidates",
  "opportunity.presenter": "Generating cards",
  "intent.inferrer": "Inferring intents",
  "intent.verifier": "Verifying quality",
  "intent.reconciler": "Reconciling",
  "intent.indexer": "Indexing intent",
  "profile.generator": "Building profile",
  "hyde.generator": "Generating search docs",
  "lens.inferrer": "Inferring lenses",
  "home.categorizer": "Categorizing",
};

function getGraphName(name: string): string {
  return GRAPH_NAMES[name] ?? name.replace(/_/g, " ");
}

function getAgentName(name: string): string {
  return AGENT_NAMES[name] ?? name.replace(/\./g, " › ");
}
```

### Step 2: Handle `graph_start`, `graph_end`, `agent_start`, `agent_end` in the render loop

In `ToolCallsDisplay`, the existing `traceEvents.map((event, idx) => { ... })` loop returns `null` for unknown types. Add handlers for the four new types.

**`graph_start`** — indented row with running indicator (spinner if no `graph_end` follows yet):

```tsx
if (event.type === "graph_start") {
  // Determine if graph has ended (find matching graph_end by name after this index)
  const graphEnd = traceEvents.slice(idx + 1).find(
    (e) => e.type === "graph_end" && e.name === event.name
  );
  const graphIsRunning = !graphEnd && !wasStoppedByUser;

  return (
    <div key={idx} className="flex items-center gap-2 pl-6 pr-3 py-1 bg-gray-900">
      <div className="w-px h-3 bg-gray-700 flex-shrink-0 -ml-3 mr-1" />
      {graphIsRunning ? (
        <Loader2 className="w-2.5 h-2.5 text-teal-400 animate-spin flex-shrink-0" />
      ) : (
        <Circle className="w-2 h-2 text-teal-600 fill-teal-600 flex-shrink-0" />
      )}
      <span className="text-teal-300 text-[10px]">
        {getGraphName(event.name ?? "")} graph
      </span>
      <span className="tabular-nums text-gray-600 text-[10px] ml-auto">
        {graphIsRunning ? (
          <RunningTimer startedAt={event.timestamp} />
        ) : graphEnd?.durationMs != null ? (
          formatDuration(graphEnd.durationMs)
        ) : null}
      </span>
    </div>
  );
}
```

**`graph_end`** — render nothing (timing is shown on graph_start row); skip rendering:

```tsx
if (event.type === "graph_end") {
  return null;
}
```

**`agent_start`** — double-indented row with spinner if no matching `agent_end`:

```tsx
if (event.type === "agent_start") {
  // Find matching agent_end (same name, after this idx)
  const occurrence = traceEvents.slice(0, idx).filter(
    (e) => e.type === "agent_start" && e.name === event.name
  ).length;
  let seen = 0;
  const agentEnd = traceEvents.slice(idx + 1).find(
    (e) => e.type === "agent_end" && e.name === event.name && seen++ === occurrence
  );
  const agentIsRunning = !agentEnd && !wasStoppedByUser;

  return (
    <div key={idx} className="flex items-center gap-2 pl-10 pr-3 py-0.5 bg-gray-900">
      <div className="w-px h-3 bg-gray-700 flex-shrink-0 -ml-3 mr-1" />
      {agentIsRunning ? (
        <Loader2 className="w-2 h-2 text-violet-400 animate-spin flex-shrink-0" />
      ) : (
        <Circle className="w-1.5 h-1.5 text-violet-600 fill-violet-600 flex-shrink-0" />
      )}
      <span className="text-violet-300 text-[10px]">
        {getAgentName(event.name ?? "")}
      </span>
      {agentEnd?.summary && (
        <span className="text-gray-500 text-[10px]">— {agentEnd.summary}</span>
      )}
      <span className="tabular-nums text-gray-600 text-[10px] ml-auto">
        {agentIsRunning ? (
          <RunningTimer startedAt={event.timestamp} />
        ) : agentEnd?.durationMs != null ? (
          formatDuration(agentEnd.durationMs)
        ) : null}
      </span>
    </div>
  );
}
```

**`agent_end`** — render nothing (info shown on agent_start row):

```tsx
if (event.type === "agent_end") {
  return null;
}
```

### Step 3: Update the header event count to exclude `graph_end` and `agent_end`

The header shows `{traceEvents.length} events`. Since `graph_end` and `agent_end` are now invisible rows, the count would be inflated. Count only visible events:

```typescript
const visibleEventCount = traceEvents.filter(
  (e) => e.type !== "graph_end" && e.type !== "agent_end"
).length;
```

Replace `{traceEvents.length} events` with `{visibleEventCount} events` in the header.

### Step 4: Add `Circle` to lucide imports

Verify `Circle` is already imported (it is, at line 10). No change needed.

### Step 5: Check frontend tsc

```bash
cd frontend && npx tsc --noEmit
```

### Step 6: Commit

```bash
git add frontend/src/components/chat/ToolCallsDisplay.tsx
git commit -m "feat(trace): render live graph/agent hierarchy in ToolCallsDisplay"
```

---

## Smoke test (after all tasks)

Start the server and send a message that triggers opportunity discovery:

```bash
cd protocol && bun run dev
```

Open chat, send: "Find people I should connect with."

Expected trace:
```
⚡ Starting iteration 0
⊙ Analyzing your request...         2.3s
■ Decided to find opportunities
▶ Find opportunities                 running...
  └─ Discovery graph                 running...
     · Evaluating candidates         890ms  — 3 of 8 passed
     · Generating cards              311ms  — 3 cards generated
  └─ Discovery graph                 1.7s
✓ Find opportunities — Found 3 match(es)   9.1s
```
