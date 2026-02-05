# Opportunity Graph

The Opportunity graph finds and persists **opportunities** (matches between a source user and candidates) using HyDE-based search and an LLM evaluator. It can run from an intent (intent payload + index scope) or from an ad-hoc query.

**API note:** This graph uses the `OpportunityGraph` class with `compile()` (not a factory with `createGraph()`). You instantiate `OpportunityGraph` with dependencies, then call `compile()` to get the runnable graph.

## Overview

**Flow:** `resolve_source_profile` → (conditional) `invoke_hyde` → `search_candidates` → `deduplicate` → `evaluate_candidates` → `persist_opportunities` → END.

- **resolve_source_profile**: If `sourceProfileContext` is missing and `sourceUserId` is set, load profile from DB and build context string.
- **invoke_hyde**: When `sourceText` and `indexScope` are set and candidates are not provided, invoke the compiled HyDE graph to get embeddings.
- **search_candidates**: Search profiles/intents with HyDE embeddings, scoped to `indexScope`, excluding `sourceUserId`.
- **deduplicate**: Remove candidates that already have an opportunity with the source.
- **evaluate_candidates**: Run `OpportunityEvaluator` to score and summarize matches (minScore from options).
- **persist_opportunities**: Create opportunity records in the DB (detection, actors, interpretation, context).

If **candidates** are provided in the initial state, the graph skips HyDE and search and goes straight to evaluate → persist.

## When to use

- **Discovery API**: POST `/opportunities/discover` with a query and optional limit (uses sourceUserId, indexScope from user memberships).
- **Intent-triggered**: When a user has an intent and you want to find matching people (sourceText = intent payload, intentId set).
- **Pre-filled candidates**: When you already have a list of candidate profiles to evaluate (e.g. from another pipeline).

## Dependencies

- **database**: `OpportunityGraphDatabase` (getProfile, createOpportunity, opportunityExistsBetweenActors, etc.)
- **embedder**: `Embedder` with `searchWithHydeEmbeddings(map, options)`
- **cache**: `HydeCache` (passed in; HyDE graph uses it)
- **compiledHydeGraph**: Compiled graph from `HydeGraphFactory.createGraph()`

## Input

Initial state passed to `invoke` (see `OpportunityGraphState` and `createInitialState()`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sourceUserId` | string | Yes | User to find opportunities for |
| `sourceProfileContext` | string | No | Pre-built profile text; if empty and sourceUserId set, graph resolves it |
| `sourceText` | string | No | Intent payload or ad-hoc query for HyDE (used when candidates not provided) |
| `intentId` | string | No | Intent ID when run from intent (for detection.triggeredBy and context) |
| `indexScope` | string[] | Yes* | Index IDs to restrict search (*can be empty; then no HyDE/search) |
| `options` | object | No | `limit`, `minScore`, `hydeDescription`, etc. |
| `candidates` | `HydeCandidate[]` or `CandidateProfile[]` | No | If provided, skip HyDE and search and go to evaluate |

## Output

State after `invoke` (same shape with channels updated):

| Field | Type | Description |
|-------|------|-------------|
| `opportunities` | `Opportunity[]` | Persisted opportunities (detection, actors, interpretation, context) |
| `candidates` | array | Candidates after dedupe (HyDE search results or input candidates) |
| `sourceProfileContext` | string | Resolved profile context when it was missing |

Each **Opportunity** includes `actors` (source + candidate with roles), `interpretation` (summary, confidence, signals), `context` (indexId, triggeringIntentId), `detection` (source, triggeredBy, timestamp).

## Code samples

### Discover from ad-hoc query (API style)

```typescript
import { OpportunityGraph } from './opportunity.graph';
import { HydeGraphFactory } from '../hyde/hyde.graph';

const compiledHydeGraph = new HydeGraphFactory(hydeDb, embedder, cache, generator).createGraph();
const opportunityGraph = new OpportunityGraph(database, embedder, cache, compiledHydeGraph);
const graph = opportunityGraph.compile();

const indexScope = await database.getIndexMemberships(userId).then(ms => ms.map(m => m.indexId));

const result = await graph.invoke({
  sourceUserId: userId,
  sourceText: 'Looking for AI/ML engineers',
  indexScope,
  options: { limit: 5, hydeDescription: 'Looking for AI/ML engineers' },
});

// result.opportunities → Opportunity[]
// result.candidates → HydeCandidate[] from search
```

### From intent (intent-triggered)

```typescript
const result = await graph.invoke({
  sourceUserId: user.id,
  sourceText: intent.payload,
  intentId: intent.id,
  indexScope: [indexId],
  options: { limit: 10 },
});
```

### Pre-filled candidates (skip HyDE and search)

```typescript
const result = await graph.invoke({
  sourceUserId: 'user-source',
  sourceProfileContext: 'Seeking mentor.',
  indexScope: ['idx-1'],
  candidates: [
    { userId: 'user-bob', identity: {...}, attributes: {...}, narrative: {...}, score: 0.9 }
  ],
  options: { minScore: 70 },
});
```

### Example input (discover)

```typescript
{
  sourceUserId: 'user-abc',
  sourceText: 'Looking for a React developer for a seed-stage startup.',
  indexScope: ['index-1', 'index-2'],
  options: { limit: 5 },
}
```

### Example output (relevant fields)

```json
{
  "opportunities": [
    {
      "id": "...",
      "actors": [
        { "role": "agent", "identityId": "user-abc", "intents": ["intent-123"], "profile": true },
        { "role": "patient", "identityId": "user-xyz", "intents": [], "profile": true }
      ],
      "interpretation": {
        "category": "collaboration",
        "summary": "React developer match for seed-stage.",
        "confidence": 0.85,
        "signals": [{ "type": "intent_match", "weight": 0.85, "detail": "..." }]
      },
      "context": { "indexId": "index-1", "triggeringIntentId": "intent-123" },
      "detection": { "source": "opportunity_graph", "triggeredBy": "intent-123", "timestamp": "..." }
    }
  ],
  "candidates": [...],
  "sourceProfileContext": "Name: ...\nBio: ...\n..."
}
```

## File structure

```
graphs/opportunity/
├── opportunity.graph.ts   # OpportunityGraph class, compile(), node implementations
├── opportunity.state.ts   # OpportunityGraphState, createInitialState()
├── opportunity.utils.ts   # selectStrategies, deriveRolesFromStrategy
├── opportunity.utils.spec.ts
├── opportunity.graph.spec.ts
├── OPPORTUNITY-GRAPH-LLM-AGENTS.md
└── README.md              # This file
```

## Related

- **HyDE graph**: Used to produce embeddings from `sourceText`; see [hyde/README.md](./hyde/README.md).
- **OpportunityEvaluator**: `agents/opportunity/opportunity.evaluator.ts`
- **Opportunity controller**: `src/controllers/opportunity.controller.ts` — POST `/opportunities/discover`
