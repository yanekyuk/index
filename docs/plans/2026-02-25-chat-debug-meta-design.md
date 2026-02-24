# Chat Debug Meta Design

**Status:** Implemented (see `2026-02-25-chat-debug-meta-implementation.md`).

## Goal

Enable debugging of the LLM chat by (1) tracking graph, tool, and agent usage with inputs and outputs per assistant turn, (2) returning this as meta to the frontend (not logs), and (3) adding a debug button that copies the full chat plus all per-turn meta to the clipboard. Large data (e.g. embeddings) is excluded from meta.

## Scope

- **Per-turn meta:** Each assistant reply has an associated debug payload (graph step, iterations, tool calls with sanitized args and result).
- **Full-session copy:** The debug button copies the entire conversation and all turn metas in one blob to the clipboard (no file export).
- **Stream-only (v1):** Meta is delivered in the stream and kept in frontend state; no persistence of debug meta in the database for now.

## Architecture

### Data flow

1. **Protocol:** During `ChatAgent.streamRun()`, collect for the current turn: graph node name (`agent_loop`), iteration count, and for each tool call: name, sanitized args, sanitized result (or summary), success. Emit this as a **debug_meta** payload in the stream (e.g. in or alongside the existing `done`/response_complete flow).
2. **Streamer:** When building the final event for a completed turn, include the debug meta (or forward a dedicated event). No new stream mode; use the same custom/updates stream and add a new event type or extend the event that signals “response complete.”
3. **Frontend:** Consume the debug meta from the stream and store it in state keyed by turn (e.g. array of per-turn meta aligned with assistant messages). The debug button serializes messages + this array to JSON and copies to clipboard.

### Sanitization (blocklist + size caps)

- **Drop or replace:** Keys such as `embedding`, `embeddingVector`, `vector`, or any value that is a large array of numbers (e.g. length > 100) → replace with a placeholder like `"[embedding, length N]"`. Strings or stringified JSON longer than a cap (e.g. 2KB) → `"[truncated, N chars]"`. Do not include raw base64 or binary.
- **Keep:** Tool name, (sanitized) args, (sanitized) result summary or truncated result, success, iteration count, graph step.

### Copy format

Single format for “Copy debug”: **JSON** (pretty-printed), e.g.:

```json
{
  "sessionId": "...",
  "exportedAt": "2026-02-25T...",
  "messages": [ { "role": "user" | "assistant", "content": "..." }, ... ],
  "turns": [
    {
      "messageIndex": 1,
      "graph": "agent_loop",
      "iterations": 1,
      "tools": [
        { "name": "read_intents", "args": { ... }, "resultSummary": "...", "success": true }
      ]
    }
  ]
}
```

- `messageIndex` is the index of the assistant message this turn corresponds to (0-based in `messages`).
- `turns` is in the same order as assistant messages; only assistant turns have an entry.

## Components

### Protocol

- **Chat agent (`chat.agent.ts`):** While executing a turn, build a debug payload (graph: `agent_loop`, iterations, tools array with name, sanitized args, sanitized result/summary, success). Expose it to the stream (e.g. via the existing writer or a return shape that the streamer can read). Sanitization runs before adding to the payload (shared sanitizer for args and result).
- **Sanitizer:** New small utility (e.g. in `protocol/src/lib/protocol/support/` or `protocol/src/types/`): `sanitizeForDebugMeta(obj, maxStringLength?)` → deep clone with embeddings/large arrays replaced and long strings truncated.
- **Stream events (`chat-streaming.types.ts`):** Add a `debug_meta` event type (or extend the event that carries the final response) with payload: `{ graph, iterations, tools: [{ name, args, resultSummary, success }] }`. Streamer yields this when the agent loop completes a turn.
- **Chat streamer (`chat.streamer.ts`):** When receiving the updates chunk (or the final custom event) that indicates the turn is done, attach the debug meta for that turn and yield a `debug_meta` event (or include it in the existing response_complete/done flow so the frontend can associate it with the last assistant message).

### Frontend

- **Chat state:** Keep an array of per-turn debug meta (e.g. `debugMetaByTurn: Array<DebugTurnMeta | null>`), same length as the number of assistant messages (or keyed by message id/index). When a new streamed response completes, append that turn’s meta.
- **Copy debug button:** Next to the share button in the chat header. On click: build the export object `{ sessionId, exportedAt, messages, turns }` from current messages + `debugMetaByTurn`, then `JSON.stringify(exportObject, null, 2)` and `navigator.clipboard.writeText(...)`. Show brief “Copied” feedback (e.g. toast or button label).
- **API:** No new endpoint for v1; meta comes only from the stream. If we add persistence later, we could add e.g. `GET /chat/session/:id/debug` or include meta in an existing session/messages response.

## Error handling

- If sanitization throws (e.g. circular reference), catch and put a placeholder for that tool’s args/result (e.g. `"[sanitization error]"`) so the rest of the meta is still emitted.
- If the frontend has no meta for a turn (e.g. old message before this feature), the export can still include that message with `turns[i]` missing or null for that index so the JSON structure stays consistent.

## Testing

- **Protocol:** Unit test the sanitizer (embedding stripped, long string truncated, normal args/result kept). Integration or stream test: run a short chat turn with one tool call and assert the stream includes a debug_meta event with expected shape and sanitized content.
- **Frontend:** Unit test the export builder (messages + turns → JSON shape). Manual: run a chat with tool use, click “Copy debug,” paste and assert structure and that embeddings/large data are not present.

## Out of scope (v1)

- Persisting debug meta to the database.
- “Copy as plain text” or file export.
- Debug meta for sessions loaded from history (only the current session’s streamed turns have meta).
