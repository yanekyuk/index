# Chat Debug Meta Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-turn debug meta (graph, tool calls with sanitized inputs/outputs) to the LLM chat stream, and a "Copy debug" button that copies full session + meta to the clipboard as JSON.

**Architecture:** Protocol: sanitizer utility; agent builds debug payload per turn and returns it from `streamRun`; streamer yields a `debug_meta` event from the updates chunk; controller forwards it. Frontend: store per-turn meta in state, add debug button that builds JSON and copies to clipboard.

**Tech Stack:** TypeScript (protocol + frontend), existing chat stream events (`protocol/src/types/chat-streaming.types.ts`), React state, Clipboard API.

---

## Task 1: Sanitizer utility

**Files:**
- Create: `protocol/src/lib/protocol/support/debug-meta.sanitizer.ts`
- Test: `protocol/src/lib/protocol/support/tests/debug-meta.sanitizer.spec.ts`

**Step 1: Write the failing test**

Create the test file with cases: (1) object with `embedding` array → key replaced with placeholder; (2) string over 2048 chars → truncated with `[truncated, N chars]`; (3) nested object with mixed safe and large values → only large/blocklisted replaced; (4) circular reference or non-serializable → catch and return placeholder for that subtree.

Example shape:

```typescript
// debug-meta.sanitizer.spec.ts
import { describe, it, expect } from "bun:test";
import { sanitizeForDebugMeta } from "../debug-meta.sanitizer";

describe("sanitizeForDebugMeta", () => {
  it("replaces embedding array with placeholder", () => {
    const out = sanitizeForDebugMeta({ embedding: [0.1, 0.2, ... new Array(100).fill(0)] });
    expect(out).toHaveProperty("embedding");
    expect(String((out as any).embedding)).toMatch(/\[embedding.*length \d+\]/);
  });

  it("truncates string over max length", () => {
    const long = "x".repeat(3000);
    const out = sanitizeForDebugMeta({ text: long }, 2048);
    expect((out as any).text).toMatch(/\[truncated, \d+ chars\]/);
  });

  it("keeps normal args and short strings", () => {
    const out = sanitizeForDebugMeta({ name: "read_intents", limit: 10 });
    expect(out).toEqual({ name: "read_intents", limit: 10 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/lib/protocol/support/tests/debug-meta.sanitizer.spec.ts`  
Expected: FAIL (module or function not found).

**Step 3: Implement sanitizer**

Create `debug-meta.sanitizer.ts`:
- `sanitizeForDebugMeta(obj: unknown, maxStringLength = 2048): unknown`
- Blocklist keys: `embedding`, `embeddingVector`, `vector`, and any key that ends with `Embedding` or `Vector`. Replace array of numbers (length > 100) with `"[embedding, length N]"` or similar.
- Recursively process plain objects and arrays; truncate strings over `maxStringLength` to `"[truncated, N chars]"`.
- Wrap in try/catch; on error (e.g. circular) return a single placeholder string.

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/lib/protocol/support/tests/debug-meta.sanitizer.spec.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/support/debug-meta.sanitizer.ts protocol/src/lib/protocol/support/tests/debug-meta.sanitizer.spec.ts
git commit -m "feat(protocol): add sanitizer for chat debug meta"
```

---

## Task 2: Debug meta types and event

**Files:**
- Modify: `protocol/src/types/chat-streaming.types.ts`

**Step 1: Add types and event creator**

- Add to `ChatStreamEventType`: `"debug_meta"`.
- Add interface `DebugMetaToolCall { name: string; args: Record<string, unknown>; resultSummary: string; success: boolean }`.
- Add interface `DebugMetaEvent extends ChatStreamEventBase { type: "debug_meta"; graph: string; iterations: number; tools: DebugMetaToolCall[] }`.
- Add `DebugMetaEvent` to the `ChatStreamEvent` union.
- Add `createDebugMetaEvent(sessionId: string, graph: string, iterations: number, tools: DebugMetaToolCall[]): DebugMetaEvent`.

**Step 2: Export and verify**

Ensure `formatSSEEvent` and any event-type guards can handle `debug_meta` (union already includes it). Run: `cd protocol && bun run lint`  
Expected: no errors.

**Step 3: Commit**

```bash
git add protocol/src/types/chat-streaming.types.ts
git commit -m "feat(protocol): add debug_meta stream event type"
```

---

## Task 3: Agent builds and returns debug meta

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.agent.ts`

**Step 1: Build debug payload during streamRun**

- Import `sanitizeForDebugMeta` from the new sanitizer.
- In `streamRun`, declare an array `toolsDebug: Array<{ name: string; args: Record<string, unknown>; resultSummary: string; success: boolean }>`.
- For each tool call (both success and failure path): after you have `tc.name`, `tc.args`, and the result string, push `{ name: tc.name, args: sanitizeForDebugMeta(tc.args), resultSummary: summary or truncated result, success }` (sanitize result for resultSummary if needed, e.g. first 500 chars or parsed `.summary`).
- When returning from `streamRun` (both normal return and hard-limit return), add `debugMeta: { graph: "agent_loop", iterations: iterationCount, tools: toolsDebug }` to the return object.

**Step 2: Update return type**

- Extend the return type of `streamRun` to include `debugMeta?: { graph: string; iterations: number; tools: DebugMetaToolCall[] }` (use the type from chat-streaming.types or a local interface that matches).

**Step 3: Run existing tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/ src/lib/protocol/agents/`  
Expected: existing tests still pass (they may not assert on debugMeta).

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.agent.ts
git commit -m "feat(protocol): agent returns debug meta per turn"
```

---

## Task 4: Chat state and graph node pass-through

**Files:**
- Modify: `protocol/src/lib/protocol/states/chat.state.ts` (optional: add optional `debugMeta` to state if we want it in state; otherwise the node return is enough)
- Modify: `protocol/src/lib/protocol/graphs/chat.graph.ts`

**Step 1: Return debugMeta from agent_loop node**

In `chat.graph.ts`, in `agentLoopNode`, the `runLoop()` result now includes `debugMeta`. When you `return { messages, responseText, iterationCount, shouldContinue }`, add `debugMeta: result.debugMeta` so the compiled graph’s state update (or the streamer’s view of the update) includes it. Check LangGraph state: if the state schema doesn’t have `debugMeta`, the return from the node may still be in the `updates` chunk under `agent_loop`; verify that the streamer receives `updates.agent_loop.debugMeta`.

**Step 2: Verify streamer receives it**

No code change in streamer yet; ensure the node return shape includes `debugMeta`. Run a quick manual test or add a temporary log in the streamer to confirm `agentOutput.debugMeta` is present after a tool-using turn.

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/graphs/chat.graph.ts
git commit -m "feat(protocol): pass debug meta from agent loop node"
```

---

## Task 5: Streamer yields debug_meta event

**Files:**
- Modify: `protocol/src/lib/protocol/streamers/chat.streamer.ts`
- Modify: `protocol/src/types/chat-streaming.types.ts` (if createDebugMetaEvent needs sessionId + payload)

**Step 1: Yield debug_meta when updates contain debugMeta**

In `streamChatEvents`, in the `mode === "updates"` block, after handling `agentOutput.error` and `responseText`, check for `agentOutput.debugMeta`. If present, yield `createDebugMetaEvent(sessionId, agentOutput.debugMeta.graph, agentOutput.debugMeta.iterations, agentOutput.debugMeta.tools)` (adjust to match the creator signature). Ensure the event is yielded so the controller will forward it.

**Step 2: Run stream tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/chat.graph.streaming.spec.ts`  
Expected: PASS. If there is an existing test that consumes events, add an assertion that a run that completes with tools yields a `debug_meta` event (optional, only if easy).

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/streamers/chat.streamer.ts
git commit -m "feat(protocol): stream debug_meta event on turn complete"
```

---

## Task 6: Controller forwards debug_meta to client

**Files:**
- Modify: `protocol/src/controllers/chat.controller.ts`

**Step 1: Forward debug_meta events**

In the stream loop where you currently skip forwarding `response_complete`, add a condition: if `event.type === "debug_meta"`, do forward it (call `controller.enqueue(encoder.encode(formatSSEEvent(event)))`). All other event types already forwarded stay as-is.

**Step 2: Verify**

Run: `cd protocol && bun run lint`  
Expected: no errors.

**Step 3: Commit**

```bash
git add protocol/src/controllers/chat.controller.ts
git commit -m "feat(protocol): forward debug_meta event to SSE client"
```

---

## Task 7: Frontend types and consumption of debug_meta

**Files:**
- Create or modify: `frontend/src/types/chat.ts` (or wherever chat stream event types are mirrored)
- Modify: `frontend/src/components/ChatContent.tsx` (or the component that consumes the SSE stream)

**Step 1: Add DebugMeta type and handle event in stream consumer**

- Define a type for the debug meta payload (or import from a shared types package if one exists): `graph`, `iterations`, `tools: { name, args, resultSummary, success }[]`.
- In the code that processes incoming SSE events (e.g. `event.type === "token"` → append to content), add a branch for `event.type === "debug_meta"`: append this turn’s meta to a state array, e.g. `setDebugMetaByTurn(prev => [...prev, { graph: event.graph, iterations: event.iterations, tools: event.tools }])`. Ensure the index aligns with the current assistant message (e.g. append when the assistant message is finalized, so the new meta is the last element).

**Step 2: State shape**

- Add state: `debugMetaByTurn: Array<{ graph: string; iterations: number; tools: DebugMetaToolCall[] } | null>` (or equivalent). Initialize as `[]`. When a new assistant message is completed and a `debug_meta` event is received, push that payload. For messages loaded from history (no stream), push `null` so the array length matches the number of assistant messages.

**Step 3: Manual test**

Run frontend and protocol; send a message that triggers a tool; in DevTools or network tab, confirm the SSE stream includes a `debug_meta` event and the frontend state updates.

**Step 4: Commit**

```bash
git add frontend/src/...
git commit -m "feat(frontend): consume debug_meta and store per turn"
```

---

## Task 8: Copy debug button and export JSON

**Files:**
- Modify: `frontend/src/components/ChatContent.tsx`

**Step 1: Add debug button and handler**

- Add a "Copy debug" (or "Debug") button next to the share button in the chat header (same area as the Share button, e.g. same toolbar). Use an icon (e.g. Bug or Copy) and label or tooltip "Copy debug".
- Add state for copy feedback: `debugCopied` (boolean), set true on success, reset after 2s (same pattern as share).
- Handler `handleCopyDebug`: build `messages` from current chat messages (role + content only, or existing message shape). Build `turns` from `debugMetaByTurn`: for each assistant message index, use `debugMetaByTurn[i]` (or null). Export object: `{ sessionId, exportedAt: new Date().toISOString(), messages, turns }`. Then `navigator.clipboard.writeText(JSON.stringify(exportObject, null, 2))`, set `debugCopied` true, then `setTimeout(..., 2000)` to reset. On catch, show error toast.

**Step 2: Align turns with assistant messages**

- When building `turns`, the i-th entry should correspond to the i-th assistant message. So `turns.length` should equal the number of assistant messages; use `debugMetaByTurn[i] ?? null` for each index.

**Step 3: Manual test**

Click "Copy debug", paste in a text editor; verify JSON has `sessionId`, `exportedAt`, `messages`, `turns`, and that tool args/result do not contain large arrays or raw embeddings.

**Step 4: Commit**

```bash
git add frontend/src/components/ChatContent.tsx
git commit -m "feat(frontend): add Copy debug button and JSON export"
```

---

## Task 9: Integration check and docs

**Files:**
- Modify: `docs/plans/2026-02-25-chat-debug-meta-design.md` (optional: add "Implemented" note)
- Read: `protocol/src/lib/protocol/graphs/tests/chat.graph.streaming.spec.ts`

**Step 1: Run full protocol tests**

Run: `cd protocol && bun test` (or the subset that includes chat graph and streamer).  
Expected: all pass.

**Step 2: Smoke test**

Start protocol and frontend; open a chat; send a message that uses a tool; click Share (confirm still works); click Copy debug; paste and verify JSON structure and that embeddings are not present.

**Step 3: Commit**

```bash
git add docs/plans/2026-02-25-chat-debug-meta-design.md  # if updated
git commit -m "docs: mark chat debug meta design as implemented"
```

---

## Reference

- Design: `docs/plans/2026-02-25-chat-debug-meta-design.md`
- Stream types: `protocol/src/types/chat-streaming.types.ts`
- Agent streamRun: `protocol/src/lib/protocol/agents/chat.agent.ts` (returns responseText, messages, iterationCount; add debugMeta)
- Streamer: `protocol/src/lib/protocol/streamers/chat.streamer.ts` (yield createDebugMetaEvent when updates.agent_loop.debugMeta present)
- Controller: `protocol/src/controllers/chat.controller.ts` (forward event.type === "debug_meta")
- Share button location: `frontend/src/components/ChatContent.tsx` (handleShare, share button ~line 1366)
