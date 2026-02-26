# Observability Changes

Full agent trace pipeline and debug UI for chat interactions.

## Overview

Replace legacy metadata streamer with unified trace events. Stream granular agent loop state to frontend for real-time observability.

## Backend Changes

### 1. Trace Event Types

**File:** `protocol/src/types/chat-streaming.types.ts`

New event types:
- `iteration_start` — Agent loop iteration begins
- `llm_start` — LLM generation starts
- `llm_end` — LLM generation ends (includes `hasToolCalls`, `toolNames`)
- `tool_activity` — Now has `phase: "start" | "end"` and `steps: DebugMetaStep[]`

`DebugMetaStep` extended with `data?: Record<string, unknown>` for structured fields (Felicity scores, classification, entropy).

### 2. Agent Loop Emissions

**File:** `protocol/src/lib/protocol/agents/chat.agent.ts`

Emit trace events at:
- Start of each iteration
- Before LLM streaming
- After LLM output (with tool-call metadata)
- Tool execution start (before running tool)
- Tool execution end (with debug steps)

### 3. Stream Forwarding

**File:** `protocol/src/lib/protocol/streamers/chat.streamer.ts`

Map agent events to stream events:
- `iteration_start` → `createIterationStartEvent`
- `llm_start` → `createLlmStartEvent`
- `llm_end` → `createLlmEndEvent`
- `tool_activity` → Forward both start/end phases with steps

### 4. Graph Trace Annotations

**Files:**
- `protocol/src/lib/protocol/states/intent.state.ts`
- `protocol/src/lib/protocol/states/opportunity.state.ts`

Add `trace` annotation with reducer that accumulates entries across nodes.

### 5. Intent Graph Traces

**File:** `protocol/src/lib/protocol/graphs/intent.graph.ts`

Trace entries per node:
- **prep** — Index count, user profile status
- **inference** — Inferred intents count
- **verification** — Felicity scores (clarity, authority, sincerity, entropy), classification, pass/fail
- **reconciler** — Actions taken (create/update/archive)

### 6. Opportunity Graph Traces

**File:** `protocol/src/lib/protocol/graphs/opportunity.graph.ts`

Trace entries per node:
- **prep** — Index/intent counts, profile loaded
- **scope** — Target indexes with member counts
- **discovery** — Candidate count, by-strategy breakdown, search query
- **evaluation** — Input/output counts, minScore
- **candidate** — Per-candidate: name, score, pass/fail, bio, reasoning, matchedVia, ragScore
- **persist** — Created/reactivated/skipped counts

### 7. Tool Debug Steps

**Files:**
- `protocol/src/lib/protocol/tools/intent.tools.ts` — Map graph trace to `debugSteps`
- `protocol/src/lib/protocol/tools/tool.helpers.ts` — Add `debugSteps` param to `error()`

### 8. Deleted Files

- `protocol/src/lib/protocol/streamers/metadata.streamer.ts` — Replaced by trace pipeline
- `protocol/src/lib/protocol/streamers/index.ts` — Remove metadata.streamer export

## Frontend Changes

### 1. Trace Event Model

**File:** `frontend/src/contexts/AIChatContext.tsx`

- Replace `ThinkingStep` with `TraceEvent`
- `ChatMessage.thinking` → `ChatMessage.traceEvents`
- Handle: `iteration_start`, `llm_start`, `llm_end`, `tool_activity`
- `ToolCallStep` includes `data` for Felicity scores, classification

### 2. Trace UI Component

**File:** `frontend/src/components/chat/ToolCallsDisplay.tsx` (new)

- Replace `ThinkingDropdown` with `ToolCallsDisplay`
- Show iterations, LLM start/end, tool start/end
- Display tool names, status (running/success/error), summary
- Expand/collapse, durations, timestamps

### 3. Deleted Files

- `frontend/src/components/chat/ThinkingDropdown.tsx` — Replaced by ToolCallsDisplay
- `frontend/src/hooks/useTypewriter.ts` — Removed typewriter animation

## Data Flow

```
Agent Loop
    │
    ├─► emit(iteration_start)
    ├─► emit(llm_start)
    ├─► stream tokens...
    ├─► emit(llm_end, {hasToolCalls, toolNames})
    │
    └─► for each tool:
            emit(tool_activity, phase: "start")
            execute tool → returns debugSteps
            emit(tool_activity, phase: "end", steps)
    │
    └─► (next iteration or end)

Graph Nodes
    │
    └─► return { ..., trace: [{node, detail, data}] }
            │
            └─► Accumulated in state.trace via reducer
                    │
                    └─► Mapped to debugSteps in tool response
```

## UI Styling

### ToolCallsDisplay Component

**Layout:** Collapsible panel above assistant message, expands to show trace timeline.

**Visual elements:**
- Header: "TRACE" label with event count and total duration
- Timeline: Vertical line connecting events
- Event rows: Icon + label + duration badge

**Color scheme (Tailwind classes):**
- Container: `bg-zinc-900/50 border border-zinc-800 rounded-lg`
- Header: `text-zinc-400 text-xs font-mono`
- Event labels: `text-zinc-300 text-sm`
- Duration badges: `text-zinc-500 text-xs`
- Success icon: `text-green-500`
- Running spinner: `text-blue-400 animate-spin`
- Error icon: `text-red-500`

**Expand/collapse:**
- Collapsed: Show summary line "8 events • 47.76s"
- Expanded: Show full timeline with nested tool steps

### Example Output

**Collapsed view:**
```
┌─────────────────────────────────────────┐
│ TRACE │ 8 events • 47.76s           [▼] │
└─────────────────────────────────────────┘
```

**Expanded view:**
```
┌─────────────────────────────────────────────────────────┐
│ TRACE │ 8 events • 47.76s                           [▲] │
├─────────────────────────────────────────────────────────┤
│ ○ Starting iteration 0                      21:58:13.939│
│ │                                                       │
│ ├─● Analyzed your request                        4.61s  │
│ │                                                       │
│ ├─● Decided to find opportunities                       │
│ │                                                       │
│ ├─● Searching for relevant connections...       31.28s  │
│ │   ├─ resolve_index_scope: 4 index(es)                 │
│ │   ├─ select_strategies: mirror, reciprocal, investor  │
│ │   ├─ prep: 4 index(es), 7 intent(s), profile loaded   │
│ │   ├─ scope: Searching 4 index(es): Kernel (2876)...   │
│ │   ├─ discovery: HyDE search → 99 candidate(s)         │
│ │   ├─ evaluation: 50 candidate(s) → 41 passed          │
│ │   │   ├─ Vincent Weisser: ✓ 85/100                    │
│ │   │   ├─ Xavier Meegan: ✓ 85/100                      │
│ │   │   └─ ... 39 more                                  │
│ │   └─ persist: Created 5, reactivated 0                │
│ │                                                       │
│ ○ Starting iteration 1                      21:58:49.838│
│ │                                                       │
│ └─● Preparing response                          11.87s  │
└─────────────────────────────────────────────────────────┘
```

### Tool Descriptions Map

Human-readable labels for tool names:

| Tool Name | Display Label |
|-----------|---------------|
| `create_opportunities` | Searching for relevant connections... |
| `create_intent` | Creating intent from your input... |
| `list_opportunities` | Loading your opportunities... |
| `get_profile` | Fetching profile... |
| `search_indexes` | Searching indexes... |

### Status Indicators

| Status | Icon | Color |
|--------|------|-------|
| Running | Spinner | `text-blue-400` |
| Success | Checkmark | `text-green-500` |
| Error | X | `text-red-500` |

### Debug Step Formatting

Felicity verification display:
```
verification: ✓ passed
├─ clarity: 0.85
├─ authority: 0.72
├─ sincerity: 0.91
├─ entropy: 0.23
└─ classification: directive
```

Candidate evaluation display:
```
candidate: Vincent Weisser
├─ score: 85/100 ✓ passed
├─ matchedVia: investor
├─ ragScore: 0.42
└─ reasoning: "Vincent is CEO of Prime Intellect..."
```
