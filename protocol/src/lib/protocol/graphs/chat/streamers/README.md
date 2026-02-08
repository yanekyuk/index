# Chat Streamers

Server-Sent Events (SSE) streaming layer for the Chat Graph. Converts raw LangGraph execution events into structured, typed `ChatStreamEvent` objects that the frontend consumes in real time.

## Architecture

The streaming pipeline follows a **delegation pattern** — a single orchestrator (`ChatStreamer`) routes raw graph events to two specialized handlers:

```
LangGraph streamEvents()
        │
        ▼
  ┌─────────────┐
  │ ChatStreamer │  ← orchestrator
  └──────┬──────┘
         │
    ┌────┴─────┐
    ▼          ▼
Metadata   Response
Streamer   Streamer
```

Each handler is instantiated **per-stream** so it can safely hold mutable state (iteration counters, tool lists) without cross-request interference.

## Modules

### `ChatStreamer` — Orchestrator

Entry point for all chat streaming. Provides two generator methods:

| Method | Purpose |
|---|---|
| `streamChatEventsWithContext` | Loads conversation history from the session store, appends the new user message, then delegates to `streamChatEvents`. |
| `streamChatEvents` | Compiles the graph (with an optional checkpointer), iterates over `graph.streamEvents()`, and dispatches each event to the appropriate handler. |

**Dependencies** (injected via constructor):
- `loadSessionContext` — retrieves previous `BaseMessage[]` for a session
- `createStreamingGraph` — factory that returns a compiled LangGraph with an optional checkpointer

### `MetadataStreamer` — Tool & Iteration Tracking

Handles everything that happens *before* the final response:

| Graph Event | Handler | Emits |
|---|---|---|
| `on_tool_start` | `handleToolStart` | `tool_start` + `thinking` (user-friendly description) |
| `on_tool_end` | `handleToolEnd` | `tool_end` (with parsed success/summary) |
| `on_chat_model_end` | `handleChatModelEnd` | `agent_thinking` (if more tool calls follow) or `status` (if generating final response) |

Maintains per-stream state:
- `currentIteration` — how many think→act loops the agent has completed
- `toolsInCurrentIteration` — tool names invoked in the current loop

User-facing tool descriptions are mapped via `TOOL_DESCRIPTIONS`, translating internal tool names (e.g. `read_intents`) into friendly messages (e.g. *"Fetching intents..."*).

### `ResponseStreamer` — Final Response

Handles the `on_chain_end` event with `name === "agent_loop"`:

- Extracts `responseText` and optional `error` from the graph output
- Yields a `token` event with the full response text
- Yields an `error` event if the agent reported a failure

> **Why not `on_chat_model_stream`?**
> `streamEvents` yields tokens from *all* nested model invocations (intent inferrers, verifiers, indexers, etc.), not just the chat agent. Those produce structured JSON that must not reach the user. Since the chat agent uses `model.invoke()` rather than streaming, we capture the complete response from `on_chain_end` instead.

## Event Types

All events conform to `ChatStreamEvent` (defined in `types/chat-streaming.types.ts`). The streamers emit the following subset:

| Event | Source | Description |
|---|---|---|
| `status` | ChatStreamer / MetadataStreamer | Processing state changes |
| `thinking` | MetadataStreamer | User-friendly tool action description |
| `tool_start` | MetadataStreamer | Tool execution began (includes args) |
| `tool_end` | MetadataStreamer | Tool execution finished (includes result summary) |
| `agent_thinking` | MetadataStreamer | Agent completed an iteration (lists tools used) |
| `token` | ResponseStreamer | Final response text |
| `error` | ChatStreamer / ResponseStreamer | Error during streaming or agent execution |

## Data Flow Example

A typical multi-turn agent interaction produces events in this order:

```
status          → "Processing your message..."
tool_start      → read_intents
thinking        → "Fetching intents..."
tool_end        → read_intents (success, "3 intent(s) found")
agent_thinking  → iteration 1, tools: [read_intents]
tool_start      → create_intent
thinking        → "Creating new intent..."
tool_end        → create_intent (success, "Created successfully")
agent_thinking  → iteration 2, tools: [create_intent]
status          → "Generating response..."
token           → "I've created a new intent based on..."
```

## Adding a New Tool Description

When adding a new tool to the chat agent, add an entry to `TOOL_DESCRIPTIONS` in `metadata.streamer.ts` so the frontend displays a meaningful status message instead of the raw tool name:

```typescript
const TOOL_DESCRIPTIONS: Record<string, string> = {
  // ...existing entries
  my_new_tool: "Doing something useful...",
};
```
