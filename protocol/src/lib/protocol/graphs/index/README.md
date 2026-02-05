# Index Graph

The Index graph evaluates whether an intent belongs in a given index (community) and performs assign or unassign. It uses the **IntentIndexer** agent when index/member prompts exist; otherwise it auto-assigns.

## Overview

**Flow:** `prep` → `evaluate` → `execute` → END.

1. **prep**: Load intent and index/member context from DB; set `skipEvaluation` when there are no prompts.
2. **evaluate**: Call IntentIndexer (or set `shouldAssign: true` when `skipEvaluation`).
3. **execute**: Assign or unassign the intent to the index according to `shouldAssign` and current assignment.

## When to use

- **Intent queue**: After an intent is **created**, the intent event queues this graph for each eligible index (user is member with autoAssign). After an intent is **updated**, the event only queues this graph for indexes the intent is already in (re-evaluation only; no new index assignments on update).
- **Chat tools**: When the chat agent assigns an intent to an index via tools, it invokes this graph for that (intentId, indexId) pair.

## Dependencies

- **database**: `IndexGraphDatabase` with:
  - `getIntentForIndexing(intentId)`
  - `getIndexMemberContext(indexId, userId)`
  - `isIntentAssignedToIndex(intentId, indexId)`
  - `assignIntentToIndex(intentId, indexId)`
  - `unassignIntentFromIndex(intentId, indexId)`

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `intentId` | string | Yes | Intent to evaluate |
| `indexId` | string | Yes | Index (community) to evaluate against |

## Output

State returned after `invoke` includes:

| Field | Type | Description |
|-------|------|-------------|
| `assignmentResult` | `AssignmentResult \| null` | Result of the assign/unassign step |
| `assignmentResult.indexId` | string | Same as input indexId |
| `assignmentResult.assigned` | boolean | Whether intent is assigned after this run |
| `assignmentResult.success` | boolean | Whether the DB operation succeeded |
| `assignmentResult.error` | string? | Error message if success is false |
| `error` | string \| null | Graph-level error (e.g. intent not found) |
| `finalScore` | number | Score used for decision (0–1) |
| `shouldAssign` | boolean | Decision: true = assign, false = unassign |

## Code samples

### From intent queue (single intent × index)

```typescript
import { IndexGraphFactory } from './index.graph';
import { IndexGraphDatabaseAdapter } from '../../../../adapters/database.adapter';

const adapter = new IndexGraphDatabaseAdapter();
const graph = new IndexGraphFactory(adapter).createGraph();

await graph.invoke({ intentId: 'intent-uuid', indexId: 'index-uuid' });
```

### From chat tools (after creating/updating an intent)

```typescript
const indexGraph = new IndexGraphFactory(database).createGraph();
for (const indexId of userIndexIds) {
  const indexResult = await indexGraph.invoke({ intentId: intent.id, indexId });
  // indexResult.assignmentResult.success, .assigned, .error
}
```

### Example input

```typescript
{ intentId: '550e8400-e29b-41d4-a716-446655440000', indexId: '660e8400-e29b-41d4-a716-446655440001' }
```

### Example output (relevant fields)

```json
{
  "assignmentResult": {
    "indexId": "660e8400-e29b-41d4-a716-446655440001",
    "assigned": true,
    "success": true
  },
  "finalScore": 0.85,
  "shouldAssign": true,
  "error": null
}
```

If the intent is not found or index context is missing:

```json
{
  "assignmentResult": {
    "indexId": "660e8400-e29b-41d4-a716-446655440001",
    "assigned": false,
    "success": false,
    "error": "Intent not found"
  },
  "error": "Intent not found"
}
```

## File structure

```
graphs/index/
├── index.graph.ts       # IndexGraphFactory, prep/evaluate/execute nodes
├── index.graph.state.ts # IndexGraphState, IntentForIndexing, AssignmentResult
├── INDEX-MANAGEMENT-AGENTIC-ARCHITECTURE.md
└── README.md            # This file
```

## Related

- **Intent queue**: `src/queues/intent.queue.ts` — calls this graph for each (intentId, indexId).
- **Chat tools**: `graphs/chat/chat.tools.ts` — calls this graph when assigning intents to indexes.
- **IntentIndexer**: `agents/index/intent.indexer.ts`
