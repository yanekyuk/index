# HyDE Graph

The HyDE (Hypothetical Document Embeddings) graph generates hypothetical documents from source text (intent, profile, or ad-hoc query) and produces embeddings for semantic search. It is cache-aware: it checks cache/DB before generating, then embeds and caches results.

## Overview

**Flow:** `check_cache` → (optional) `generate_missing` → `embed` → `cache_results` → END.

- **check_cache**: For each requested strategy, look up cache and DB. If found, skip generation.
- **generate_missing**: For strategies with no cached document, call `HydeGenerator` to produce hypothetical text.
- **embed**: Generate embeddings for any HyDE documents that don’t have one yet.
- **cache_results**: Write results to cache (and DB when strategy is persisted).

## When to use

- **Intent-triggered**: When running opportunity discovery from an intent (sourceType `intent`, sourceId = intent ID).
- **Profile-triggered**: When generating HyDE for a user profile (sourceType `profile`, sourceId = user ID).
- **Ad-hoc query**: When searching with a free-text query (sourceType `query`, no sourceId; sourceText is the query).

## Dependencies

The graph is built by `HydeGraphFactory`, which requires:

- **database**: `HydeGraphDatabase` (getHydeDocument, saveHydeDocument)
- **embedder**: `EmbeddingGenerator` (generate)
- **cache**: `HydeCache` (get, set)
- **generator**: `HydeGenerator` (generate, getTargetCorpus, getCacheTTL, shouldPersist)

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sourceType` | `'intent' \| 'profile' \| 'query'` | Yes | Corpus type of the source |
| `sourceId` | string | No | Entity ID (intent ID or user ID). Omit for ad-hoc query |
| `sourceText` | string | Yes | Text to generate HyDE from (intent payload, profile summary, or query) |
| `strategies` | `HydeStrategy[]` | Yes | Strategies to run (e.g. `['mirror', 'reciprocal']`) |
| `context` | `HydeContext` | No | Optional indexId, category, customPrompt |
| `forceRegenerate` | boolean | No | If true, skip cache/DB and regenerate (default: false) |

**HyDE strategies** (from `hyde.strategies`): `mirror`, `reciprocal`, `mentor`, `investor`, `collaborator`, `hiree`.

## Output

State returned from the graph (e.g. last node’s state or full state after `invoke`):

| Field | Type | Description |
|-------|------|-------------|
| `hydeDocuments` | `Record<string, HydeDocumentState>` | Per-strategy documents: `strategy`, `targetCorpus`, `hydeText`, `hydeEmbedding` |
| `hydeEmbeddings` | `Record<string, number[]>` | Final embeddings per strategy (used by opportunity graph) |
| `error` | string \| undefined | Non-fatal error message |

## Code samples

### Create and invoke (intent-based)

```typescript
import { HydeGraphFactory } from './hyde.graph';
import type { HydeGraphDatabase } from '../../interfaces/database.interface';
import type { EmbeddingGenerator } from '../../interfaces/embedder.interface';
import type { HydeCache } from '../../interfaces/cache.interface';
import { HydeGenerator } from '../../agents/hyde/hyde.generator';

const factory = new HydeGraphFactory(database, embedder, cache, new HydeGenerator());
const graph = factory.createGraph();

const result = await graph.invoke({
  sourceType: 'intent',
  sourceId: 'intent-uuid-123',
  sourceText: 'Looking for a React developer for a seed-stage startup.',
  strategies: ['mirror', 'reciprocal'],
  forceRegenerate: false,
});

// result.hydeEmbeddings['mirror']  → number[] (profile-space embedding)
// result.hydeEmbeddings['reciprocal'] → number[] (intent-space embedding)
// result.hydeDocuments['mirror'].hydeText → string (hypothetical profile text)
```

### Ad-hoc query (no sourceId)

```typescript
const result = await graph.invoke({
  sourceType: 'query',
  sourceId: undefined,
  sourceText: 'Looking for AI/ML engineers in San Francisco',
  strategies: ['mirror', 'reciprocal'],
});
```

### Example output (shape)

```json
{
  "hydeDocuments": {
    "mirror": {
      "strategy": "mirror",
      "targetCorpus": "profiles",
      "hydeText": "I am an experienced React developer looking for early-stage opportunities...",
      "hydeEmbedding": [0.02, -0.01, ...]
    },
    "reciprocal": {
      "strategy": "reciprocal",
      "targetCorpus": "intents",
      "hydeText": "I am looking for a seed-stage startup that needs a React developer...",
      "hydeEmbedding": [0.01, 0.03, ...]
    }
  },
  "hydeEmbeddings": {
    "mirror": [0.02, -0.01, ...],
    "reciprocal": [0.01, 0.03, ...]
  }
}
```

## File structure

```
graphs/hyde/
├── hyde.graph.ts        # HydeGraphFactory, node definitions
├── hyde.graph.state.ts  # HydeGraphState annotation
├── hyde.graph.spec.ts   # Tests
├── index.ts             # Barrel export
└── README.md            # This file
```

## Related

- **Opportunity graph**: Uses this graph’s `invoke` to get `hydeEmbeddings`, then runs search and evaluation.
- **HyDE strategies**: `src/lib/protocol/agents/hyde/hyde.strategies.ts`
