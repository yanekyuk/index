# Intent Graph

The Intent graph extracts intents from raw content, verifies them with a semantic verifier, reconciles against existing intents (create/update/expire), and executes actions in the database. It supports **create**, **update**, and **delete** operation modes with conditional routing.

## Overview

**Flow (conditional):**

- **create**: prep → inference → verification → reconciler → executor → END
- **update**: prep → inference → (verification if new intents) → reconciler → executor → END
- **delete**: prep → reconciler → executor → END (no inference or verification)

**Nodes:**

1. **prep**: Load active intents for the user (for reconciler context). When `indexId` is set, loads intents in that index via `getIntentsInIndexForMember`; otherwise uses `getActiveIntents` (global scope).
2. **inference**: `ExplicitIntentInferrer` extracts intents from `inputContent` (and optional conversation context).
3. **verification**: `SemanticVerifier` checks each intent (felicity conditions); invalid types are dropped.
4. **reconciler**: `IntentReconciler` decides actions: create, update, expire.
5. **executor**: Runs actions against the DB (createIntent, updateIntent, archiveIntent).

## When to use

- **Chat tools**: When the user says “create an intent …” or “update/delete that intent,” the chat graph calls this graph via intent tools.
- **Batch pipelines**: When processing uploaded content or integrations that produce user content.

## Dependencies

- **database**: `IntentGraphDatabase` with:
  - `getActiveIntents(userId)` — global active intents (used when no index scope)
  - `getIntentsInIndexForMember(userId, indexNameOrId)` — index-scoped active intents
  - `createIntent(...)`
  - `updateIntent(intentId, data)`
  - `archiveIntent(intentId)`

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | Owner of the intents |
| `userProfile` | string | Yes | Profile context for inference/verification |
| `inputContent` | string | No | Raw text to extract intents from (e.g. user message) |
| `operationMode` | `'create' \| 'update' \| 'delete'` | No | Default `'create'` |
| `targetIntentIds` | string[] | No | For update/delete: intent IDs to update or expire |
| `indexId` | string | No | When set, prep loads active intents in that index (reconciliation is index-scoped); when absent, global scope |
| `conversationContext` | `BaseMessage[]` | No | Recent messages for anaphoric resolution |

## Output

State after `invoke`:

| Field | Type | Description |
|-------|------|-------------|
| `actions` | Reconciler action[] | create / update / expire actions produced by reconciler |
| `executionResults` | `ExecutionResult[]` | Per-action result: actionType, success, intentId, payload?, error? |
| `inferredIntents` | `InferredIntent[]` | Raw intents from inference (create/update) |
| `verifiedIntents` | `VerifiedIntent[]` | Intents that passed verification |
| `activeIntents` | string | Formatted active intents string used by reconciler |

## Code samples

### Create intents from user message

```typescript
import { IntentGraphFactory } from './intent.graph';

const factory = new IntentGraphFactory(database);
const graph = factory.createGraph();

const result = await graph.invoke({
  userId: 'user-123',
  userProfile: 'User is a Senior Developer named Alice. She likes generic coding.',
  inputContent: 'I want to build a new React app for my portfolio.',
  operationMode: 'create',
});

// result.actions → [{ type: 'create', payload: '...', score: ... }]
// result.executionResults → [{ actionType: 'create', success: true, intentId: '...' }]
```

### Delete (expire) intents

```typescript
const result = await graph.invoke({
  userId: 'user-123',
  userProfile: '...',
  inputContent: undefined,
  operationMode: 'delete',
  targetIntentIds: ['intent-id-1', 'intent-id-2'],
});
// Inference and verification are skipped; result.actions are expire actions.
```

### Example input (create)

```typescript
{
  userId: 'test-user-1',
  userProfile: 'User is a Senior Developer named Alice. She likes generic coding.',
  inputContent: 'I want to build a new React app for my portfolio.',
}
```

### Example output (create, success)

```json
{
  "inferredIntents": [
    {
      "type": "directive",
      "description": "Build a new React app for portfolio",
      "confidence": 0.9,
      "reasoning": "..."
    }
  ],
  "verifiedIntents": [...],
  "actions": [
    { "type": "create", "payload": "Build a new React app for portfolio", "score": 85 }
  ],
  "executionResults": [
    { "actionType": "create", "success": true, "intentId": "intent-uuid", "payload": "Build a new React app for portfolio" }
  ]
}
```

### Example output (vague input → no actions)

```json
{
  "inferredIntents": [],
  "verifiedIntents": [],
  "actions": [],
  "executionResults": []
}
```

## File structure

```
graphs/intent/
├── intent.graph.ts       # IntentGraphFactory, nodes, conditional edges
├── intent.graph.state.ts # IntentGraphState, VerifiedIntent, ExecutionResult
├── intent.graph.spec.ts  # Tests
├── PHASE4-README.md      # Phase 4 conditional flow notes
└── README.md             # This file
```

## Related

- **Chat tools**: `graphs/chat/chat.tools.ts` — create_intent, update_intent, delete_intent call this graph.
- **ExplicitIntentInferrer**: `agents/intent/inferrer/explicit.inferrer.ts`
- **SemanticVerifier**: `agents/intent/verifier/semantic.verifier.ts`
- **IntentReconciler**: `agents/intent/reconciler/intent.reconciler.ts`
