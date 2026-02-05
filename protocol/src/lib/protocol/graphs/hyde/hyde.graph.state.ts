/**
 * HyDE Graph state: cache-aware hypothetical document generation.
 * Used by the HyDE graph for check_cache → generate_missing → embed → cache_results.
 */

import { Annotation } from '@langchain/langgraph';
import type { Id } from '../../../../types/common';
import type {
  HydeStrategy,
  HydeTargetCorpus,
  HydeContext,
} from '../../agents/hyde/hyde.strategies';

/** Single HyDE document (text + embedding) for one strategy. */
export interface HydeDocumentState {
  strategy: HydeStrategy;
  targetCorpus: HydeTargetCorpus;
  hydeText: string;
  hydeEmbedding: number[];
}

/** State for the HyDE generation graph (cache check → generate → embed → cache). */
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

  /** HyDE strategies to run (e.g. ['mirror', 'reciprocal']). */
  strategies: Annotation<HydeStrategy[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Optional context for strategy prompts (category, indexId, customPrompt). */
  context: Annotation<HydeContext | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** When true, skip cache/DB and regenerate all strategies. */
  forceRegenerate: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  // ─── Intermediate / output ─────────────────────────────────────────────

  /**
   * HyDE documents per strategy (from cache, DB, or newly generated).
   * Keyed by strategy name; values include hydeText and hydeEmbedding.
   */
  hydeDocuments: Annotation<Record<string, HydeDocumentState>>({
    reducer: (curr, next) => (next ? { ...curr, ...next } : curr),
    default: () => ({}),
  }),

  /**
   * Final embeddings per strategy (convenience output for search).
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
