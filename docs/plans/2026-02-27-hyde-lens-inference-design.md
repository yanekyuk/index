# Role-Agnostic HyDE with Lens Inference

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hardcoded six-strategy HyDE system (`mirror`, `reciprocal`, `mentor`, `investor`, `collaborator`, `hiree`) with a role-agnostic architecture where the LLM infers search perspectives ("lenses") dynamically from the intent text and user profile context.

**Motivation:** The current `HydeStrategy` type conflates two unrelated concepts: search geometry (which corpus to search) and role persona (what kind of person to imagine). `mirror` and `investor` are not peers — `investor` is a specialization of `mirror` with a role prior. The protocol should be agnostic to roles like "investor" while still being able to discover investors through semantic inference.

**Architecture:** Two-step pipeline. A Lens Inferrer agent analyzes the source text (intent or query) with optional profile context and outputs 1–N free-text lenses, each tagged with a target corpus (`profiles` or `intents`). The HyDE Generator then produces one hypothetical document per lens using generic corpus-specific prompt templates. The protocol never contains role vocabulary — the LLM invents appropriate perspectives per-intent.

---

## Core Concepts

### Corpus (structural)

`'profiles' | 'intents'` — which vector index to search. This is the only enum in the system. Determined by the Lens Inferrer per-lens.

### Lens (semantic)

A free-text perspective inferred by the LLM. Examples: `"crypto infrastructure VC"`, `"DePIN ecosystem builder seeking partnerships"`, `"distributed systems advisor"`. Each lens is tagged with a corpus. No predefined vocabulary — the LLM decides what perspectives are relevant for the given source text.

### Lens Inference

An LLM call that takes source text + optional profile context and outputs 1–N lenses. Replaces both the hardcoded `HYDE_STRATEGIES` map and the regex-based `selectStrategiesFromQuery()` function.

---

## What Changes

### Removed

- `HydeStrategy` type union (`'mirror' | 'reciprocal' | 'mentor' | 'investor' | 'collaborator' | 'hiree'`)
- `HYDE_STRATEGIES` hardcoded config map with per-strategy prompts
- `HYDE_STRATEGY_TARGET_CORPUS` derived map
- `selectStrategiesFromQuery()` regex-based strategy selector
- Per-strategy persist/cache split

### Added

- `LensInferrer` agent — takes source text + optional profile context, outputs lenses with corpus tags
- Generic corpus-specific prompt templates in `HydeGenerator` (2 templates replacing 6)
- `infer_lenses` node in the HyDE graph

### Preserved

- Two-tier persistence: intent-triggered docs → DB (permanent), query-triggered docs → Redis (1hr TTL)
- Cache-aware pipeline (check cache → generate only missing)
- Profile embedding as parallel search signal alongside HyDE
- Merge + deduplicate candidate logic in the embedder

---

## Lens Inferrer Agent

New agent: `LensInferrer` extending `BaseLangChainAgent`.

### Input

```typescript
interface LensInferenceInput {
  sourceText: string;         // Intent payload or search query
  profileContext?: string;    // User's profile summary for domain context
  maxLenses?: number;         // Cap (default 3)
}
```

### Output (Zod schema)

```typescript
z.object({
  lenses: z.array(z.object({
    label: z.string(),                          // Free-text: "crypto infra VC"
    corpus: z.enum(['profiles', 'intents']),     // Which index to search
    reasoning: z.string(),                       // Why this lens is relevant
  })).min(1).max(5),
})
```

### System Prompt (simplified)

> Analyze the given goal or search query and identify the most relevant perspectives for finding matching people. For each perspective, determine whether to search user profiles (bios, expertise) or user goals (stated needs, aspirations). When user context is provided, use it to make perspectives domain-specific.

### Model Choice

- **Chat path (latency-sensitive):** Fast model for the inference call
- **Background path (intent creation):** Full model for higher-quality lens selection

### Inference Examples

**"find me investors" + profile: "Building DePIN infrastructure"**
```json
{
  "lenses": [
    { "label": "crypto infrastructure VC", "corpus": "profiles", "reasoning": "User is building DePIN, needs crypto-native infrastructure investors" },
    { "label": "hardware network founder seeking co-investors", "corpus": "intents", "reasoning": "Other founders raising for similar infra may want to co-invest or share deal flow" }
  ]
}
```

**"I want to learn about ZK proofs" (no profile context)**
```json
{
  "lenses": [
    { "label": "ZK researcher who teaches or mentors", "corpus": "profiles", "reasoning": "User wants to learn — find experts who teach" },
    { "label": "ZK application builder looking for collaborators", "corpus": "intents", "reasoning": "Builders in ZK space often welcome learning collaborators" }
  ]
}
```

**"I'm raising a seed round for my DePIN project" (intent creation, background)**
```json
{
  "lenses": [
    { "label": "early-stage investor in decentralized infrastructure", "corpus": "profiles", "reasoning": "Direct match: fundraising intent needs investors" },
    { "label": "DePIN ecosystem builder seeking integration partners", "corpus": "intents", "reasoning": "Partnership opportunities within the DePIN ecosystem" },
    { "label": "distributed systems technical advisor", "corpus": "profiles", "reasoning": "DePIN projects benefit from infrastructure expertise" }
  ]
}
```

**"Looking for visual artists for our NFT collection"**
```json
{
  "lenses": [
    { "label": "digital artist specializing in generative or NFT art", "corpus": "profiles", "reasoning": "Direct need: find artists with relevant portfolio" },
    { "label": "artist seeking NFT project collaborations", "corpus": "intents", "reasoning": "Artists actively looking for NFT projects to join" }
  ]
}
```

---

## HyDE Generator Changes

### Current Behavior

The generator looks up a per-strategy prompt from `HYDE_STRATEGIES` (6 different prompts, each baking in a role persona).

### New Behavior

The generator receives the lens label and corpus directly. Two generic prompt templates replace six:

**For `profiles` corpus:**
> Write a professional biography for someone who is: `{lens}`. This person would be a relevant match for: `{sourceText}`. Write in first person as if they are describing themselves. Include their expertise, experience, and current focus.

**For `intents` corpus:**
> Write a goal or aspiration statement for someone who is: `{lens}`. This person's needs would complement: `{sourceText}`. Write in first person as if stating their own goal.

The lens label carries the semantic specificity that the old per-strategy prompts had to hardcode. `"early-stage investor in decentralized infrastructure"` as a lens produces the same quality hypothetical document as the old `investor` strategy prompt — but without the protocol knowing "investor" as a concept.

### Interface

```typescript
interface HydeGenerateInput {
  sourceText: string;              // Original intent/query
  lens: string;                    // Free-text lens from inference
  corpus: 'profiles' | 'intents'; // Target corpus voice
}
```

---

## HyDE Graph Changes

### Current Graph

```
START → check_cache → (all cached?)
  → yes → END
  → no → generate_missing → embed → cache_results → END
```

### New Graph

```
START → infer_lenses → check_cache → (all cached?)
  → yes → END
  → no → generate_missing → embed → cache_results → END
```

One new node (`infer_lenses`) at the front. The rest of the pipeline operates on dynamic lens labels instead of static strategy names.

### Cache Key Format

- Old: `hyde:{sourceType}:{sourceId}:{strategy}` (e.g., `hyde:intent:uuid:mirror`)
- New: `hyde:{sourceType}:{sourceHash}:{lensHash}` (hash-based since lens labels are free-text)

For persisted docs (DB), a **delete-and-recreate** strategy replaces the old upsert-by-strategy pattern. When an intent is created or updated:

1. Delete existing HyDE docs for this source
2. Run lens inference on the intent text
3. Generate + embed + persist new docs

This avoids fragile deduplication on free-text lens labels.

### Graph State Changes

The HyDE graph state annotation adds:

```typescript
// New field
lenses: Annotation<Array<{ label: string; corpus: HydeTargetCorpus; reasoning: string }>>,

// Replaces
// strategies: Annotation<HydeStrategy[]>,
```

---

## Embedder & Search Changes

### Current Interface

```typescript
searchWithHydeEmbeddings(
  hydeEmbeddings: Map<HydeStrategy, number[]>,
  options: HydeSearchOptions
): Promise<HydeCandidate[]>
```

### New Interface

```typescript
searchWithHydeEmbeddings(
  lensEmbeddings: Array<{
    lens: string;
    corpus: 'profiles' | 'intents';
    embedding: number[];
  }>,
  options: HydeSearchOptions
): Promise<HydeCandidate[]>
```

For each entry, search the tagged corpus with the embedding. Merge, deduplicate by userId, boost score when multiple lenses match the same person.

The `matchedVia` field in `HydeCandidate` results becomes the free-text lens label instead of a strategy enum:

```typescript
interface HydeCandidate {
  type: 'profile' | 'intent';
  id: string;
  userId: string;
  score: number;
  matchedVia: string;  // Was HydeStrategy, now free-text lens label
  indexId: string;
}
```

---

## Opportunity Graph Discovery Node

### Current Logic (complex branching)

```
if discoverySource === 'profile':
  if searchQuery:
    selectStrategiesFromQuery(regex) → HyDE for selected strategies
    if also has profile vector: merge with profile similarity
  else:
    profile embedding similarity search
    if 0 results and searchQuery: fallback to query HyDE
```

### New Logic (simplified)

```
if searchQuery:
  lens inference (query + profile context)
  generate HyDE per lens → search
  if also has profile vector: merge with profile similarity
else if has profile vector:
  profile embedding similarity search (no HyDE)
else:
  no candidates
```

The branching simplifies because strategy selection is replaced by lens inference. The profile plays two roles:

1. **Semantic context** — feeds into lens inference to make lenses domain-specific
2. **Search vector** — direct profile similarity search merged alongside HyDE results

---

## Two Execution Paths

### Path 1: Background Job (Intent Creation)

```
Intent Created
  → Lens Inference (on intent text, optionally with profile context)
  → HyDE Generation per lens
  → Embed + Persist to DB
  → Used for ongoing background opportunity matching
```

Persistence: permanent (DB). Model: full quality. Latency: not critical.

### Path 2: In-Chat Query Search

```
User query + profile context
  → Lens Inference (profile-contextualized)
  → HyDE Generation per lens → Embed
  → Vector search per lens
  → Merge with profile embedding similarity search
  → Evaluate + rank
```

Persistence: ephemeral (Redis, 1hr TTL). Model: fast for inference step. Latency: critical.

---

## Database Migration

```sql
-- Step 1: Add lens column
ALTER TABLE hyde_documents ADD COLUMN lens TEXT;

-- Step 2: Backfill from strategy
UPDATE hyde_documents SET lens = strategy;
ALTER TABLE hyde_documents ALTER COLUMN lens SET NOT NULL;

-- Step 3: Update constraints
ALTER TABLE hyde_documents DROP CONSTRAINT hyde_source_strategy_unique;
-- No unique constraint on lens (delete-and-recreate pattern)

-- Step 4: Drop strategy column
ALTER TABLE hyde_documents DROP COLUMN strategy;
```

---

## Trace / Observability

Lens labels surface in the discovery trace:

```json
{
  "node": "discovery",
  "detail": "HyDE search -> 5 candidates from 3 lenses",
  "data": {
    "lenses": [
      { "label": "crypto infra VC", "corpus": "profiles", "candidates": 2 },
      { "label": "DePIN builder seeking partners", "corpus": "intents", "candidates": 2 },
      { "label": "distributed systems advisor", "corpus": "profiles", "candidates": 1 }
    ],
    "durationMs": 1234
  }
}
```

---

## Migration Strategy

1. Add `lens` column to `hyde_documents`, backfill from `strategy`
2. Create `LensInferrer` agent with Zod output schema
3. Update `HydeGenerator` to accept free-text lens + corpus
4. Add `infer_lenses` node to HyDE graph
5. Update `searchWithHydeEmbeddings` to accept dynamic lens entries
6. Simplify opportunity graph discovery node branching
7. Remove `selectStrategiesFromQuery`, `HYDE_STRATEGIES`, `HydeStrategy` type
8. Drop `strategy` column from `hyde_documents`
9. Update tests throughout
