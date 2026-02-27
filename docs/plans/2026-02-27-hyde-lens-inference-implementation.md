# HyDE Lens Inference Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the six hardcoded HyDE strategies with a role-agnostic lens inference system — the LLM infers search perspectives dynamically from intent text and user context.

**Architecture:** New `LensInferrer` agent infers N lenses (label + corpus). `HydeGenerator` takes free-text lens + corpus instead of enum strategy. Graph adds `infer_lenses` node. Embedder/opportunity graph consume lens arrays instead of strategy maps. Schema migrates `strategy` → `lens`.

**Tech Stack:** LangChain/LangGraph, Zod, Drizzle ORM, pgvector, BullMQ, Bun test

**Design doc:** `docs/plans/2026-02-27-hyde-lens-inference-design.md`

---

## Task 1: Create LensInferrer Agent

**Files:**
- Create: `protocol/src/lib/protocol/agents/lens.inferrer.ts`
- Reference: `protocol/src/lib/protocol/agents/hyde.generator.ts` (agent pattern)
- Reference: `protocol/src/lib/protocol/agents/agent.template.md` (conventions)

**Step 1: Create the agent file**

```typescript
// protocol/src/lib/protocol/agents/lens.inferrer.ts

/**
 * Lens Inferrer Agent: analyzes source text (intent or query) with optional
 * profile context and infers 1-N search lenses, each tagged with a target corpus.
 * Replaces the hardcoded HydeStrategy enum and regex-based selectStrategiesFromQuery.
 */

import { BaseLangChainAgent } from '../../langchain/langchain';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { Timed } from '../../performance';

export type HydeTargetCorpus = 'profiles' | 'intents';

/** A single inferred lens — a search perspective the LLM decided is relevant. */
export interface Lens {
  /** Free-text description (e.g. "crypto infrastructure VC"). */
  label: string;
  /** Which vector index to search: user profiles or user intents. */
  corpus: HydeTargetCorpus;
  /** Why this perspective is relevant (for logging/trace). */
  reasoning: string;
}

export interface LensInferenceInput {
  /** Intent payload or search query. */
  sourceText: string;
  /** User's profile summary for domain context (optional). */
  profileContext?: string;
  /** Maximum number of lenses to infer (default 3). */
  maxLenses?: number;
}

export interface LensInferenceOutput {
  lenses: Lens[];
}

const SYSTEM_PROMPT = `You analyze goals and search queries to identify the most relevant perspectives for finding matching people in a professional network.

For each perspective you identify, specify:
1. A clear, specific description of who or what to search for
2. Whether to search "profiles" (user bios, expertise, backgrounds) or "intents" (stated goals, needs, aspirations)
3. A brief reason why this perspective is relevant

Guidelines:
- Be specific and domain-aware. "early-stage crypto infrastructure investor" is better than "investor".
- Consider both sides: who can help the person AND whose goals complement theirs.
- When user context is provided, tailor perspectives to their domain (e.g. a DePIN founder searching for "investors" needs crypto-native infra investors specifically).
- Generate only perspectives that add distinct search value — don't repeat similar angles.
- Use "profiles" when looking for a type of person (expert, advisor, leader). Use "intents" when looking for a complementary goal or need (someone raising, someone hiring, someone seeking collaboration).`;

const responseFormat = z.object({
  lenses: z.array(z.object({
    label: z.string().describe('Specific description of the search perspective'),
    corpus: z.enum(['profiles', 'intents']).describe('Search user profiles or user intents'),
    reasoning: z.string().describe('Why this perspective is relevant'),
  })).min(1).max(5).describe('Inferred search lenses'),
});

export class LensInferrer extends BaseLangChainAgent {
  constructor(options?: { preset?: string; temperature?: number }) {
    super({
      preset: options?.preset ?? 'lens-inferrer',
      responseFormat,
      temperature: options?.temperature ?? 0.3,
    });
  }

  /**
   * Infer search lenses from source text and optional profile context.
   *
   * @param input - Source text, optional profile context, optional max lenses
   * @returns Array of inferred lenses with corpus tags
   */
  @Timed()
  async infer(input: LensInferenceInput): Promise<LensInferenceOutput> {
    const { sourceText, profileContext, maxLenses = 3 } = input;

    let humanPrompt = `Identify up to ${maxLenses} search perspectives for finding relevant matches.\n\nSource: "${sourceText}"`;

    if (profileContext) {
      humanPrompt += `\n\nUser context: ${profileContext}`;
    }

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(humanPrompt),
    ];

    const result = await this.model.invoke({ messages }) as {
      structuredResponse?: { lenses: Lens[] };
    };

    const lenses = result?.structuredResponse?.lenses ?? [];

    return { lenses: lenses.slice(0, maxLenses) };
  }
}
```

**Step 2: Commit**

```bash
git add protocol/src/lib/protocol/agents/lens.inferrer.ts
git commit -m "feat: add LensInferrer agent for dynamic HyDE perspective inference"
```

---

## Task 2: Write LensInferrer Tests

**Files:**
- Create: `protocol/src/lib/protocol/agents/tests/lens.inferrer.spec.ts`
- Reference: `protocol/src/lib/protocol/agents/tests/hyde.generator.spec.ts` (test pattern)

**Step 1: Write the test file**

```typescript
// protocol/src/lib/protocol/agents/tests/lens.inferrer.spec.ts

/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it, beforeAll } from 'bun:test';
import { LensInferrer, type Lens } from '../lens.inferrer';

describe('LensInferrer', () => {
  let inferrer: LensInferrer;

  beforeAll(() => {
    inferrer = new LensInferrer();
  });

  describe('output schema', () => {
    it('returns lenses with label, corpus, and reasoning', async () => {
      const result = await inferrer.infer({
        sourceText: 'I am raising a seed round for my DePIN project',
      });

      expect(result.lenses.length).toBeGreaterThanOrEqual(1);
      expect(result.lenses.length).toBeLessThanOrEqual(5);

      for (const lens of result.lenses) {
        expect(typeof lens.label).toBe('string');
        expect(lens.label.length).toBeGreaterThan(0);
        expect(['profiles', 'intents']).toContain(lens.corpus);
        expect(typeof lens.reasoning).toBe('string');
        expect(lens.reasoning.length).toBeGreaterThan(0);
      }
    }, 30_000);

    it('respects maxLenses cap', async () => {
      const result = await inferrer.infer({
        sourceText: 'I need help with everything: investors, mentors, collaborators, hires, designers',
        maxLenses: 2,
      });

      expect(result.lenses.length).toBeLessThanOrEqual(2);
    }, 30_000);
  });

  describe('corpus assignment', () => {
    it('assigns profiles corpus for person-seeking queries', async () => {
      const result = await inferrer.infer({
        sourceText: 'Looking for an experienced machine learning engineer',
      });

      const profileLenses = result.lenses.filter(l => l.corpus === 'profiles');
      expect(profileLenses.length).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it('assigns intents corpus for goal-complementing queries', async () => {
      const result = await inferrer.infer({
        sourceText: 'I am building a marketplace and looking for early users',
      });

      const intentLenses = result.lenses.filter(l => l.corpus === 'intents');
      expect(intentLenses.length).toBeGreaterThanOrEqual(1);
    }, 30_000);
  });

  describe('profile context', () => {
    it('contextualizes lenses with profile information', async () => {
      const withContext = await inferrer.infer({
        sourceText: 'find me investors',
        profileContext: 'Building decentralized physical infrastructure for IoT sensor networks',
      });

      const withoutContext = await inferrer.infer({
        sourceText: 'find me investors',
      });

      // Both should return valid lenses
      expect(withContext.lenses.length).toBeGreaterThanOrEqual(1);
      expect(withoutContext.lenses.length).toBeGreaterThanOrEqual(1);

      // Context should produce more specific labels (check via length as proxy)
      const contextLabels = withContext.lenses.map(l => l.label).join(' ');
      // Should reference domain-specific terms when context provided
      const hasDomainTerms = /depin|iot|sensor|infrastructure|hardware|crypto|decentralized/i.test(contextLabels);
      expect(hasDomainTerms).toBe(true);
    }, 60_000);
  });
});
```

**Step 2: Ask the user to run**

Run: `cd .worktrees/refactor-hyde-lens-inference/protocol && bun test src/lib/protocol/agents/tests/lens.inferrer.spec.ts`

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/agents/tests/lens.inferrer.spec.ts
git commit -m "test: add LensInferrer agent tests"
```

---

## Task 3: Update HyDE Types — Replace Strategy With Lens

**Files:**
- Modify: `protocol/src/lib/protocol/agents/hyde.strategies.ts` (keep file, gut contents)
- Modify: `protocol/src/lib/protocol/interfaces/embedder.interface.ts:1-106`
- Modify: `protocol/src/lib/protocol/states/hyde.state.ts:1-82`

This task replaces the type system. The old `HydeStrategy` enum and `HYDE_STRATEGIES` config map are removed. New types center on `Lens` from the inferrer.

**Step 1: Rewrite `hyde.strategies.ts`**

This file becomes a thin re-export of lens types plus the `HydeTargetCorpus` type, and a backward-compat `HYDE_DEFAULT_CACHE_TTL` constant. The old `HYDE_STRATEGIES` map, `HydeStrategy` union, and `HydeStrategyConfig` are removed.

```typescript
// protocol/src/lib/protocol/agents/hyde.strategies.ts

/**
 * HyDE (Hypothetical Document Embeddings) type definitions.
 *
 * The system is now role-agnostic: instead of hardcoded strategy names
 * (mirror, reciprocal, mentor, investor, collaborator, hiree), an LLM
 * infers free-text "lenses" dynamically. This file re-exports the lens
 * types and provides constants for the HyDE pipeline.
 */

export type { Lens, HydeTargetCorpus, LensInferenceInput, LensInferenceOutput } from './lens.inferrer';

/** Default cache TTL for ephemeral HyDE documents (1 hour). */
export const HYDE_DEFAULT_CACHE_TTL = 3600;

/**
 * Prompt templates for HyDE document generation.
 * Keyed by target corpus — the lens label provides the semantic specificity.
 */
export const HYDE_CORPUS_PROMPTS: Record<'profiles' | 'intents', (sourceText: string, lens: string) => string> = {
  profiles: (sourceText, lens) => `
    Write a professional biography for someone who is: ${lens}.
    This person would be a relevant match for: "${sourceText}".

    Write in first person as if they are describing themselves.
    Include their expertise, experience, and current focus.
  `,
  intents: (sourceText, lens) => `
    Write a goal or aspiration statement for someone who is: ${lens}.
    This person's needs would complement: "${sourceText}".

    Write in first person as if stating their own goal.
  `,
};
```

**Step 2: Update `embedder.interface.ts`**

Replace `HydeStrategy` references with lens-based types:

```typescript
// protocol/src/lib/protocol/interfaces/embedder.interface.ts

// ═══════════════════════════════════════════════════════════════════════════════
// HyDE (Hypothetical Document Embeddings) search types
// ═══════════════════════════════════════════════════════════════════════════════

export type { Lens, HydeTargetCorpus } from '../agents/lens.inferrer';

/** A single lens embedding ready for search. */
export interface LensEmbedding {
  /** Free-text lens label (e.g. "crypto infrastructure VC"). */
  lens: string;
  /** Which corpus to search. */
  corpus: 'profiles' | 'intents';
  /** 2000-dim embedding vector. */
  embedding: number[];
}

/** Options for searchWithHydeEmbeddings (index scope, limits, min score). */
export interface HydeSearchOptions {
  /** Index IDs to scope the search (members / assigned intents only). */
  indexScope: string[];
  /** Exclude this user ID from results (e.g. source intent owner). */
  excludeUserId?: string;
  /** Max results per lens before merge (default 10). */
  limitPerStrategy?: number;
  /** Max results after merge/rank (default 20). */
  limit?: number;
  /** Minimum cosine similarity (0–1) to include (default 0.5). */
  minScore?: number;
}

/** Options for searchWithProfileEmbedding (no lenses; direct profile similarity). */
export type ProfileEmbeddingSearchOptions = HydeSearchOptions;

/** A single candidate from HyDE search (profile or intent), with score and which lens matched. */
export interface HydeCandidate {
  type: 'profile' | 'intent';
  id: string;
  userId: string;
  score: number;
  /** Free-text lens label that produced this match. */
  matchedVia: string;
  indexId: string;
  /** Set after merge when user matched via multiple lenses. */
  matchedLenses?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Embedding and vector store
// ═══════════════════════════════════════════════════════════════════════════════

export interface EmbeddingGenerator {
  generate(text: string | string[], dimensions?: number): Promise<number[] | number[][]>;
}

export interface VectorSearchResult<T> {
  item: T;
  score: number;
}

export type VectorStoreOption<T> = {
  limit?: number;
  filter?: Record<string, any>;
  candidates?: (T & { embedding?: number[] | null })[];
  minScore?: number;
};

export interface VectorStore {
  search<T>(
    queryVector: number[],
    collection: string,
    options?: VectorStoreOption<T>
  ): Promise<VectorSearchResult<T>[]>;
}

/**
 * Embedder: generate embeddings and run vector / HyDE search.
 * Implementations: OpenAI/OpenRouter for generate, pgvector for search.
 */
export interface Embedder extends EmbeddingGenerator, VectorStore {
  /**
   * Multi-lens HyDE search: run one vector search per lens embedding,
   * then merge, deduplicate by userId, and rank (boost for multiple lens matches).
   */
  searchWithHydeEmbeddings(
    lensEmbeddings: LensEmbedding[],
    options: HydeSearchOptions
  ): Promise<HydeCandidate[]>;

  /**
   * Profile-as-source search: run vector search with the asker's profile embedding.
   */
  searchWithProfileEmbedding(
    profileEmbedding: number[],
    options: ProfileEmbeddingSearchOptions
  ): Promise<HydeCandidate[]>;
}
```

**Step 3: Update `hyde.state.ts`**

Replace strategy references with lens-based state:

```typescript
// protocol/src/lib/protocol/states/hyde.state.ts

/**
 * HyDE Graph state: cache-aware hypothetical document generation.
 * Used by the HyDE graph for infer_lenses → check_cache → generate_missing → embed → cache_results.
 */

import { Annotation } from '@langchain/langgraph';
import type { Id } from '../../../types/common.types';
import type { Lens, HydeTargetCorpus } from '../agents/lens.inferrer';

/** Single HyDE document (text + embedding) for one lens. */
export interface HydeDocumentState {
  lens: string;
  targetCorpus: HydeTargetCorpus;
  hydeText: string;
  hydeEmbedding: number[];
}

/** State for the HyDE generation graph. */
export const HydeGraphState = Annotation.Root({
  // ─── Inputs ─────────────────────────────────────────────────────────────

  /** Source type: intent, profile, or ad-hoc query. */
  sourceType: Annotation<'intent' | 'profile' | 'query'>,

  /** Source entity ID (e.g. intent ID, user ID). Omitted for ad-hoc query. */
  sourceId: Annotation<Id<'intents'> | Id<'users'> | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Source text to generate HyDE from (intent payload, profile summary, or query). */
  sourceText: Annotation<string>,

  /** Optional profile context for lens inference (user's profile summary). */
  profileContext: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Maximum number of lenses to infer (default 3). */
  maxLenses: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 3,
  }),

  /** When true, skip cache/DB and regenerate all lenses. */
  forceRegenerate: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  // ─── Intermediate / output ─────────────────────────────────────────────

  /** Inferred lenses from the LensInferrer agent. */
  lenses: Annotation<Lens[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /**
   * HyDE documents per lens (from cache, DB, or newly generated).
   * Keyed by lens label; values include hydeText and hydeEmbedding.
   */
  hydeDocuments: Annotation<Record<string, HydeDocumentState>>({
    reducer: (curr, next) => (next ? { ...curr, ...next } : curr),
    default: () => ({}),
  }),

  /**
   * Final embeddings per lens (convenience output for search).
   * Populated by embed node; used by opportunity graph.
   */
  hydeEmbeddings: Annotation<Record<string, number[]>>({
    reducer: (curr, next) => (next ? { ...curr, ...next } : curr),
    default: () => ({}),
  }),

  /** Non-fatal error message. */
  error: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
});
```

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/agents/hyde.strategies.ts \
      protocol/src/lib/protocol/interfaces/embedder.interface.ts \
      protocol/src/lib/protocol/states/hyde.state.ts
git commit -m "refactor: replace HydeStrategy enum with lens-based types"
```

---

## Task 4: Update HydeGenerator To Accept Lens

**Files:**
- Modify: `protocol/src/lib/protocol/agents/hyde.generator.ts:1-84`

**Step 1: Rewrite the generator**

The generator no longer looks up `HYDE_STRATEGIES[strategy]`. Instead it receives a free-text lens label and corpus, then uses corpus-specific prompt templates.

```typescript
// protocol/src/lib/protocol/agents/hyde.generator.ts

/**
 * HyDE Generator Agent: pure LLM agent for generating hypothetical documents
 * in the target corpus voice. Uses free-text lens labels instead of enum strategies.
 */

import { BaseLangChainAgent } from '../../langchain/langchain';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { HYDE_CORPUS_PROMPTS } from './hyde.strategies';
import type { HydeTargetCorpus } from './lens.inferrer';
import { Timed } from "../../performance";

const SYSTEM_PROMPT = `You are a Hypothetical Document Generator for semantic search.

Your task: Given a source statement (e.g. an intent or goal), write a short hypothetical document in the voice of the TARGET side—the kind of person or statement that would be an ideal match for that source.

Rules:
- Write in first person as the target.
- Be concrete and specific so the text is good for vector similarity search.
- Output only the hypothetical document text, no meta-commentary.
- Keep length to a few sentences or one short paragraph.`;

const responseFormat = z.object({
  hypotheticalDocument: z
    .string()
    .describe('The hypothetical document text in the target voice, suitable for embedding and retrieval'),
});

export interface HydeGeneratorOutput {
  text: string;
}

export interface HydeGenerateInput {
  /** Original intent or query text. */
  sourceText: string;
  /** Free-text lens label from LensInferrer (e.g. "crypto infra VC"). */
  lens: string;
  /** Which corpus voice to generate in. */
  corpus: HydeTargetCorpus;
}

export class HydeGenerator extends BaseLangChainAgent {
  constructor(options?: { preset?: string; temperature?: number }) {
    super({
      preset: options?.preset ?? 'hyde-generator',
      responseFormat,
      temperature: options?.temperature ?? 0.4,
    });
  }

  /**
   * Generate a hypothetical document for the given source text and lens.
   */
  @Timed()
  async generate(input: HydeGenerateInput): Promise<HydeGeneratorOutput> {
    const promptText = HYDE_CORPUS_PROMPTS[input.corpus](input.sourceText, input.lens);

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(promptText),
    ];

    const result = await this.model.invoke({ messages }) as { structuredResponse?: { hypotheticalDocument: string } };
    const parsed = result?.structuredResponse;
    const text = parsed?.hypotheticalDocument ?? '';

    return { text };
  }
}
```

**Step 2: Commit**

```bash
git add protocol/src/lib/protocol/agents/hyde.generator.ts
git commit -m "refactor: HydeGenerator accepts lens+corpus instead of strategy enum"
```

---

## Task 5: Rewrite HyDE Graph With Lens Inference Node

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/hyde.graph.ts:1-246`

**Step 1: Rewrite the graph**

Key changes:
- New `infer_lenses` node at START
- Cache key uses lens label hash instead of strategy name
- `generate_missing` calls generator with lens+corpus
- `cache_results` uses delete-and-recreate for persisted docs (no unique constraint on free-text lens)
- Constructor now accepts `LensInferrer` alongside `HydeGenerator`

```typescript
// protocol/src/lib/protocol/graphs/hyde.graph.ts

/**
 * HyDE Graph: cache-aware hypothetical document generation with lens inference.
 *
 * Flow: infer_lenses → check_cache → (generate_missing if needed) → embed → cache_results.
 * Constructor injects Database, Embedder, Cache, LensInferrer, HydeGenerator.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { createHash } from 'crypto';
import { HydeGraphState, type HydeDocumentState } from '../states/hyde.state';
import type { Lens } from '../agents/lens.inferrer';
import { LensInferrer } from '../agents/lens.inferrer';
import { HydeGenerator } from '../agents/hyde.generator';
import type { HydeGraphDatabase } from '../interfaces/database.interface';
import type { EmbeddingGenerator } from '../interfaces/embedder.interface';
import type { HydeCache } from '../interfaces/cache.interface';
import { HYDE_DEFAULT_CACHE_TTL } from '../agents/hyde.strategies';
import { protocolLogger } from '../support/protocol.logger';
import { timed } from '../../performance';

const logger = protocolLogger("HyDEGraphFactory");

/** Hash a lens label to a short key for cache/DB indexing. */
function lensHash(label: string): string {
  return createHash('sha256').update(label.toLowerCase().trim()).digest('hex').slice(0, 16);
}

/** Build cache key for a specific lens. */
function cacheKey(
  sourceType: string,
  sourceId: string | undefined,
  sourceText: string,
  lens: string,
): string {
  const entityKey =
    sourceId ?? `q:${createHash('sha256').update(sourceText).digest('hex').slice(0, 16)}`;
  return `hyde:${sourceType}:${entityKey}:${lensHash(lens)}`;
}

/**
 * Factory for the HyDE generation graph.
 * Injects Database, Embedder, Cache, LensInferrer, and HydeGenerator.
 */
export class HydeGraphFactory {
  constructor(
    private database: HydeGraphDatabase,
    private embedder: EmbeddingGenerator,
    private cache: HydeCache,
    private inferrer: LensInferrer,
    private generator: HydeGenerator,
  ) {}

  createGraph() {
    const self = this;

    /** Node 1: Infer lenses from source text + optional profile context. */
    const inferLensesNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.inferLenses", async () => {
        const { sourceText, profileContext, maxLenses } = state;

        logger.info('Inferring lenses', { sourceTextLength: sourceText.length, hasProfileContext: !!profileContext });

        const result = await self.inferrer.infer({
          sourceText,
          profileContext,
          maxLenses,
        });

        logger.info('Lenses inferred', {
          count: result.lenses.length,
          lenses: result.lenses.map(l => ({ label: l.label, corpus: l.corpus })),
        });

        return { lenses: result.lenses };
      });
    };

    /** Node 2: Check cache/DB for existing HyDE docs matching inferred lenses. */
    const checkCacheNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.checkCache", async () => {
        const { sourceType, sourceId, sourceText, lenses, forceRegenerate } = state;

        if (forceRegenerate) {
          logger.info('Force regenerate - skipping cache');
          return { hydeDocuments: {} };
        }

        const cached: Record<string, HydeDocumentState> = {};

        for (const lens of lenses) {
          const key = cacheKey(sourceType, sourceId ?? undefined, sourceText, lens.label);

          const fromCache = await self.cache.get<HydeDocumentState>(key);
          if (fromCache?.hydeText && fromCache.hydeEmbedding?.length) {
            logger.info('Cache hit', { lens: lens.label });
            cached[lens.label] = fromCache;
            continue;
          }

          // For entity sources, check DB for persisted docs
          if (sourceId) {
            const fromDb = await self.database.getHydeDocument(
              sourceType,
              sourceId,
              lensHash(lens.label),
            );
            if (fromDb) {
              logger.info('DB hit', { lens: lens.label });
              cached[lens.label] = {
                lens: lens.label,
                targetCorpus: fromDb.targetCorpus as 'profiles' | 'intents',
                hydeText: fromDb.hydeText,
                hydeEmbedding: fromDb.hydeEmbedding,
              };
            }
          }
        }

        logger.info('Check cache done', {
          found: Object.keys(cached).length,
          requested: lenses.length,
        });
        return { hydeDocuments: cached };
      });
    };

    /** Conditional: decide whether to generate or skip to embed. */
    const shouldGenerate = (state: typeof HydeGraphState.State): string => {
      const { lenses, hydeDocuments } = state;
      const missing = lenses.filter((l) => !hydeDocuments[l.label]);
      if (missing.length > 0) {
        logger.info('Need to generate', { missing: missing.map(l => l.label) });
        return 'generate';
      }
      logger.info('All lenses cached, skipping generation');
      return 'skip';
    };

    /** Node 3: Generate HyDE documents for lenses not in cache. */
    const generateMissingNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.generateMissing", async () => {
        const { sourceText, lenses, hydeDocuments } = state;
        const missing = lenses.filter((l) => !hydeDocuments[l.label]);

        logger.info('Generating HyDE documents', {
          count: missing.length,
          lenses: missing.map(l => l.label),
        });

        const generated: Record<string, HydeDocumentState> = {};

        await Promise.all(
          missing.map(async (lens) => {
            const out = await self.generator.generate({
              sourceText,
              lens: lens.label,
              corpus: lens.corpus,
            });
            generated[lens.label] = {
              lens: lens.label,
              targetCorpus: lens.corpus,
              hydeText: out.text,
              hydeEmbedding: [],
            };
          })
        );

        return { hydeDocuments: { ...state.hydeDocuments, ...generated } };
      });
    };

    /** Node 4: Embed all HyDE documents that don't have embeddings yet. */
    const embedNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.embed", async () => {
        const { hydeDocuments } = state;
        const lensLabels = Object.keys(hydeDocuments);
        const toEmbed: { label: string; doc: HydeDocumentState }[] = [];
        const updated: Record<string, HydeDocumentState> = {};
        const hydeEmbeddings: Record<string, number[]> = {};

        for (const label of lensLabels) {
          const doc = hydeDocuments[label];
          if (!doc) continue;
          if (doc.hydeEmbedding?.length) {
            updated[label] = doc;
            hydeEmbeddings[label] = doc.hydeEmbedding;
          } else {
            toEmbed.push({ label, doc });
          }
        }

        if (toEmbed.length > 0) {
          logger.info('Embedding documents', { count: toEmbed.length });
          const texts = toEmbed.map((t) => t.doc.hydeText);
          const embeddings = await self.embedder.generate(texts);
          const embeddingArray = Array.isArray(embeddings[0])
            ? (embeddings as number[][])
            : [embeddings as number[]];

          for (let i = 0; i < toEmbed.length; i++) {
            const { label, doc } = toEmbed[i];
            const embedding = embeddingArray[i] ?? [];
            updated[label] = { ...doc, hydeEmbedding: embedding };
            hydeEmbeddings[label] = embedding;
          }
        }

        return { hydeDocuments: updated, hydeEmbeddings };
      });
    };

    /** Node 5: Cache results in Redis; persist to DB for entity sources. */
    const cacheResultsNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.cacheResults", async () => {
        const { sourceType, sourceId, sourceText, hydeDocuments, lenses } = state;

        // Build a lookup for lens corpus from inferred lenses
        const lensCorpusMap = new Map(lenses.map(l => [l.label, l.corpus]));

        for (const label of Object.keys(hydeDocuments)) {
          const doc = hydeDocuments[label];
          if (!doc) continue;

          const key = cacheKey(sourceType, sourceId ?? undefined, sourceText, label);
          await self.cache.set(key, doc, { ttl: HYDE_DEFAULT_CACHE_TTL });

          // Persist to DB for entity sources (intent/profile)
          if (sourceId) {
            await self.database.saveHydeDocument({
              sourceType,
              sourceId,
              strategy: lensHash(label),
              targetCorpus: doc.targetCorpus,
              hydeText: doc.hydeText,
              hydeEmbedding: doc.hydeEmbedding,
              sourceText: label, // Store the lens label in sourceText for debugging
            });
          }
        }

        logger.info('Cached results', {
          count: Object.keys(hydeDocuments).length,
        });
        return {};
      });
    };

    const workflow = new StateGraph(HydeGraphState)
      .addNode('infer_lenses', inferLensesNode)
      .addNode('check_cache', checkCacheNode)
      .addNode('generate_missing', generateMissingNode)
      .addNode('embed', embedNode)
      .addNode('cache_results', cacheResultsNode)
      .addEdge(START, 'infer_lenses')
      .addEdge('infer_lenses', 'check_cache')
      .addConditionalEdges('check_cache', shouldGenerate, {
        generate: 'generate_missing',
        skip: 'embed',
      })
      .addEdge('generate_missing', 'embed')
      .addEdge('embed', 'cache_results')
      .addEdge('cache_results', END);

    return workflow.compile();
  }
}
```

**Step 2: Commit**

```bash
git add protocol/src/lib/protocol/graphs/hyde.graph.ts
git commit -m "refactor: add infer_lenses node to HyDE graph, lens-based cache/generation"
```

---

## Task 6: Update Embedder Adapter — Lens-Based Search

**Files:**
- Modify: `protocol/src/adapters/embedder.adapter.ts` (searchWithHydeEmbeddings and related methods)

**Step 1: Update the search method signatures and implementation**

The `searchWithHydeEmbeddings` method changes from `Map<HydeStrategy, number[]>` to `LensEmbedding[]`. The internal `searchProfilesForHyde` and `searchIntentsForHyde` helpers stay mostly the same — they already take raw embedding vectors. The main change is the outer loop and the merge logic.

Changes needed:
- `searchWithHydeEmbeddings` signature: `Map<HydeStrategy, number[]>` → `LensEmbedding[]`
- Loop iterates over `LensEmbedding[]` instead of Map entries
- Uses `lens.corpus` to decide profiles vs intents search (instead of `HYDE_STRATEGY_TARGET_CORPUS`)
- `mergeAndRankCandidates` works with string lens labels instead of `HydeStrategy`
- Remove import of `HydeStrategy`, `HYDE_STRATEGY_TARGET_CORPUS`

The `searchWithProfileEmbedding` method stays unchanged (it doesn't use strategies).

**Step 2: Commit**

```bash
git add protocol/src/adapters/embedder.adapter.ts
git commit -m "refactor: embedder searchWithHydeEmbeddings accepts LensEmbedding array"
```

---

## Task 7: Update Opportunity Graph — Consume Lenses

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts` (HyDE invocation and discovery node)
- Modify: `protocol/src/lib/protocol/states/opportunity.state.ts` (CandidateMatch.strategy → lens)
- Modify: `protocol/src/lib/protocol/support/opportunity.discover.ts` (remove selectStrategiesFromQuery)

**Step 1: Update opportunity state types**

In `opportunity.state.ts`, change `CandidateMatch.strategy: HydeStrategy` to `strategy: string` (free-text lens label). Remove the `HydeStrategy` import. Also update `hydeEmbeddings` type from `Record<HydeStrategy, number[]>` to `Record<string, number[]>`.

**Step 2: Update OpportunityGraphFactory constructor**

The `hydeGenerator` dependency changes its invoke signature. Instead of:
```typescript
invoke: (input: { strategies: HydeStrategy[]; ... }) => Promise<{ hydeEmbeddings: Record<string, number[]> }>
```
It becomes:
```typescript
invoke: (input: { sourceText: string; sourceType: string; profileContext?: string; maxLenses?: number; forceRegenerate?: boolean }) => Promise<{ hydeEmbeddings: Record<string, number[]>; lenses?: Lens[] }>
```

**Step 3: Update discoveryNode**

Remove `selectStrategiesFromQuery` calls. Instead, the opportunity graph passes `sourceText` + `profileContext` to the HyDE graph, which internally runs lens inference. The graph returns `hydeEmbeddings` keyed by lens label. The discovery node passes these to `searchWithHydeEmbeddings` as `LensEmbedding[]`.

Replace all occurrences of `strategy as HydeStrategy` with the lens label string. Replace `embeddingsMap.set(strategy as HydeStrategy, ...)` with building `LensEmbedding[]`.

**Step 4: Remove selectStrategiesFromQuery from opportunity.discover.ts**

Delete the function and its regex patterns. Update `runDiscoverFromQuery` to no longer call it — the HyDE graph handles lens selection internally via `LensInferrer`.

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts \
      protocol/src/lib/protocol/states/opportunity.state.ts \
      protocol/src/lib/protocol/support/opportunity.discover.ts
git commit -m "refactor: opportunity graph consumes lenses from HyDE graph, remove selectStrategiesFromQuery"
```

---

## Task 8: Update Database Layer — Strategy → Lens

**Files:**
- Modify: `protocol/src/schemas/database.schema.ts:181-199` (hydeDocuments table)
- Modify: `protocol/src/lib/protocol/interfaces/database.interface.ts:283-310, 900-965`
- Modify: `protocol/src/adapters/database.adapter.ts` (HydeDatabaseAdapter methods)

**Step 1: Update schema — rename `strategy` to `lens`**

In `database.schema.ts`, rename the column:
```typescript
lens: text('lens').notNull(), // was: strategy: text('strategy').notNull()
```
Update the index name from `strategyIdx` to `lensIdx`. Update the unique index: drop the old `sourceStrategyUnique` (free-text lenses make it fragile) or keep it if lens labels are stable hashes.

**Step 2: Generate and rename migration**

```bash
cd protocol && bun run db:generate
# Rename: mv drizzle/NNNN_random_name.sql drizzle/NNNN_rename_hyde_strategy_to_lens.sql
# Update drizzle/meta/_journal.json tag to match
```

**Step 3: Update database interface**

In `database.interface.ts`:
- `HydeDocument.strategy` → `HydeDocument.lens`
- `CreateHydeDocumentData.strategy` → `CreateHydeDocumentData.lens`
- `getHydeDocument(sourceType, sourceId, strategy)` → `getHydeDocument(sourceType, sourceId, lens)`
- Update JSDoc comments

**Step 4: Update database adapter**

In `database.adapter.ts`, update HydeDatabaseAdapter methods to use `lens` column instead of `strategy`.

**Step 5: Apply migration**

```bash
bun run db:migrate
bun run db:generate  # Should report "No schema changes"
```

**Step 6: Commit**

```bash
git add protocol/src/schemas/database.schema.ts \
      protocol/src/lib/protocol/interfaces/database.interface.ts \
      protocol/src/adapters/database.adapter.ts \
      protocol/drizzle/
git commit -m "refactor: rename hyde_documents.strategy to lens, update DB layer"
```

---

## Task 9: Update Remaining References

**Files:**
- Modify: `protocol/src/lib/protocol/tools/opportunity.tools.ts` (HydeStrategy refs in CandidateMatch)
- Modify: `protocol/src/lib/protocol/agents/opportunity.evaluator.ts` (if HydeStrategy referenced)
- Modify: `protocol/src/queues/intent.queue.ts` (HyDE generation job — remove strategies param)
- Modify: `protocol/src/lib/protocol/support/opportunity.utils.ts` (if HydeStrategy referenced)
- Modify: `protocol/src/lib/protocol/README.md` (update docs)

**Step 1: Fix compilation errors**

Run `npx tsc --noEmit` or check IDE errors across the worktree. Fix any remaining imports of `HydeStrategy` or references to the old `HYDE_STRATEGIES` map, `HYDE_STRATEGY_TARGET_CORPUS`, or `selectStrategiesFromQuery`.

Common fixes:
- `import type { HydeStrategy }` → remove or replace with `string` where lens label is used
- `strategy as HydeStrategy` → just use the string directly
- `selectStrategiesFromQuery(query)` → remove (no longer needed; HyDE graph does lens inference)
- `strategies: ['mirror', 'reciprocal']` → remove (HyDE graph infers lenses)

**Step 2: Update intent.queue.ts**

The intent queue's `generate_hyde` job no longer passes `strategies: ['mirror', 'reciprocal']` to the HyDE graph. Instead it passes `sourceText` and the graph infers lenses:

```typescript
// Before:
await hydeGraph.invoke({ sourceType: 'intent', sourceId: intentId, sourceText: intent.payload, strategies: ['mirror', 'reciprocal'], forceRegenerate: true });

// After:
await hydeGraph.invoke({ sourceType: 'intent', sourceId: intentId, sourceText: intent.payload, forceRegenerate: true });
```

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: fix remaining HydeStrategy references across codebase"
```

---

## Task 10: Rewrite Tests

**Files:**
- Modify: `protocol/src/lib/protocol/agents/tests/hyde.strategies.spec.ts` (rewrite for new types)
- Modify: `protocol/src/lib/protocol/agents/tests/hyde.generator.spec.ts` (lens-based generate)
- Modify: `protocol/src/lib/protocol/graphs/tests/hyde.graph.spec.ts` (lens inference in graph)
- Modify: `protocol/src/lib/protocol/support/tests/opportunity.discover.spec.ts` (remove selectStrategiesFromQuery tests)

**Step 1: Rewrite hyde.strategies.spec.ts**

The old tests validated six named strategies. New tests validate:
- `HYDE_CORPUS_PROMPTS` produces non-empty prompts for profiles and intents corpuses
- `HYDE_DEFAULT_CACHE_TTL` is 3600

**Step 2: Rewrite hyde.generator.spec.ts**

Update generation tests to use the new `generate({ sourceText, lens, corpus })` interface instead of `generate(sourceText, strategy, context)`.

**Step 3: Rewrite hyde.graph.spec.ts**

Update mock setup to include `LensInferrer` mock. Test the full flow: infer → cache check → generate → embed → cache. Verify that the graph returns lens-keyed `hydeEmbeddings`.

**Step 4: Update opportunity.discover.spec.ts**

Remove `selectStrategiesFromQuery` test block entirely. Keep `runDiscoverFromQuery` tests (they test the full discovery flow, not strategy selection).

**Step 5: Ask user to run all affected tests**

Run:
```bash
cd .worktrees/refactor-hyde-lens-inference/protocol
bun test src/lib/protocol/agents/tests/hyde.strategies.spec.ts
bun test src/lib/protocol/agents/tests/hyde.generator.spec.ts
bun test src/lib/protocol/agents/tests/lens.inferrer.spec.ts
bun test src/lib/protocol/graphs/tests/hyde.graph.spec.ts
bun test src/lib/protocol/support/tests/opportunity.discover.spec.ts
```

**Step 6: Commit**

```bash
git add protocol/src/lib/protocol/agents/tests/ \
      protocol/src/lib/protocol/graphs/tests/ \
      protocol/src/lib/protocol/support/tests/
git commit -m "test: rewrite HyDE tests for lens-based architecture"
```

---

## Task 11: Create OpenRouter Preset

**Manual step (not code):**

Create a `lens-inferrer` preset at https://openrouter.ai/settings/presets with:
- A fast, cheap model suitable for classification/analysis (e.g. Claude Haiku or GPT-4o-mini)
- Temperature: 0.3
- Max tokens: ~500 (lens inference output is small)

---

## Task 12: Final Cleanup and Verification

**Step 1: Verify no remaining references to old types**

```bash
cd .worktrees/refactor-hyde-lens-inference/protocol
grep -r "HydeStrategy" src/ --include="*.ts" | grep -v "node_modules" | grep -v ".spec.ts"
grep -r "HYDE_STRATEGIES" src/ --include="*.ts" | grep -v "node_modules"
grep -r "selectStrategiesFromQuery" src/ --include="*.ts" | grep -v "node_modules"
grep -r "HYDE_STRATEGY_TARGET_CORPUS" src/ --include="*.ts" | grep -v "node_modules"
```

All should return empty.

**Step 2: Type check**

```bash
npx tsc --noEmit
```

**Step 3: Ask user to run full test suite**

Run: `cd .worktrees/refactor-hyde-lens-inference/protocol && bun test`

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: final cleanup for lens inference refactor"
```
