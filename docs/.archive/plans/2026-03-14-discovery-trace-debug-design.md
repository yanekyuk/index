# Discovery Pipeline Trace & Debug Visibility

**Issue**: IND-165
**Date**: 2026-03-14
**Status**: Design approved

## Problem

The chat trace panel shows "Find opportunities" as a black box — 53 seconds with no visibility into sub-steps. Debug data exists in the pipeline but doesn't reach the UI. Trace events are lost on page reload. The bug icon debug copy lacks rich pipeline data.

## Principles

- **Working data vs. debug data**: `tool_activity` SSE events and `chat_messages` are working data. Trace sub-steps, candidate scores, model identifiers are debug data stored in separate metadata tables.
- **Store everything, render selectively**: Metadata tables hold the full debug record. The trace UI renders a visual subset. The bug icon dumps everything for LLM analysis.
- **Two consumers**: Trace UI (developers watching the chat) and bug icon copy (structured dump for LLM feedback).

## Database Schema

### `chat_message_metadata`

| Column | Type | Description |
|--------|------|-------------|
| `id` | text, PK | Snowflake ID |
| `messageId` | text, FK → chat_messages, unique | One row per assistant message |
| `traceEvents` | jsonb | Full `TraceEvent[]` for that turn |
| `debugMeta` | jsonb | `debug_meta` payload (graph, iterations, tools with steps) |
| `createdAt` | timestamp | |

### `chat_session_metadata`

| Column | Type | Description |
|--------|------|-------------|
| `id` | text, PK | Snowflake ID |
| `sessionId` | text, FK → chat_sessions, unique | One row per session |
| `metadata` | jsonb | Aggregated session-level debug info, updated per turn |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

## Data Flow

### Writing metadata (after stream completes)

1. Protocol already saves assistant message via `ChatSessionService.addMessage()`
2. At the same point, persist `chat_message_metadata` with `traceEvents` and `debugMeta` from that turn
3. Upsert `chat_session_metadata` — append turn's debug summary to session aggregate

### Reading metadata

- **Trace UI on reload**: Fetch `chat_message_metadata` per assistant message, reconstruct `traceEvents`, attach to loaded `ChatMessage` objects
- **Bug icon**: `/debug/chat/{sessionId}` reads from metadata tables instead of parsing `subgraphResults.debugMeta`

### Merging debug_meta into trace events (frontend)

- On `debug_meta` SSE arrival: match each `tools[]` entry to its `tool_end` trace event by name/occurrence, inject `steps[]`
- Same merge runs when loading persisted metadata on page reload
- `ToolCallsDisplay` already renders steps — expandable sub-rows work with no component changes

## Completion Summary

- `chat.streamer.ts` passes tool's actual result summary (e.g., "Found 3 matches") in `tool_activity` end event instead of hardcoded "Done"
- Frontend already reads `event.summary` — starts receiving meaningful text

## Additional Trace Data

Three additions to opportunity graph `trace[]` entries:

1. **LensInferrer inputs**: Trace entry `"lens_input"` with discoverer's `profileContext`
2. **Evaluator entity bundles**: Extend `"candidate"` trace entry `data` to include full `intents[]` and `profile` sent to evaluator
3. **Model identifiers**: Add `model` field to relevant trace steps from `model.config.ts`

All flow through existing pipeline: graph trace → debugSteps → debug_meta → SSE + metadata tables.

## Frontend Changes

### Trace UI

- `AIChatContext.tsx`: On `debug_meta` event, merge `steps[]` into matched `tool_end` trace events
- Page reload: fetch `chat_message_metadata`, reconstruct trace events on loaded messages
- New sub-step renderers in `ToolCallsDisplay.tsx`: lens input display, model identifier badge

### Bug icon

- Update `/debug/chat/{sessionId}` to read from metadata tables
- Returns comprehensive JSON: full trace events, sub-steps, candidate scores, model identifiers, entity bundles
