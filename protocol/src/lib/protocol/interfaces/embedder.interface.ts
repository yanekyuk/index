// ═══════════════════════════════════════════════════════════════════════════════
// HyDE (Hypothetical Document Embeddings) search types
// ═══════════════════════════════════════════════════════════════════════════════

export type { HydeStrategy, HydeTargetCorpus } from '../agents/hyde.strategies';
export { HYDE_STRATEGY_TARGET_CORPUS } from '../agents/hyde.strategies';

import type { HydeStrategy } from '../agents/hyde.strategies';

/** Options for searchWithHydeEmbeddings (index scope, limits, min score). */
export interface HydeSearchOptions {
  /** Which strategies have embeddings in the map; only these are searched. */
  strategies: HydeStrategy[];
  /** Index IDs to scope the search (members / assigned intents only). */
  indexScope: string[];
  /** Exclude this user ID from results (e.g. source intent owner). */
  excludeUserId?: string;
  /** Max results per strategy before merge (default 10). */
  limitPerStrategy?: number;
  /** Max results after merge/rank (default 20). */
  limit?: number;
  /** Minimum cosine similarity (0–1) to include (default 0.5). */
  minScore?: number;
}

/** A single candidate from HyDE search (profile or intent), with score and which strategy matched. */
export interface HydeCandidate {
  type: 'profile' | 'intent';
  id: string;
  userId: string;
  score: number;
  matchedVia: HydeStrategy;
  indexId: string;
  /** Set after merge when user matched via multiple strategies. */
  matchedStrategies?: HydeStrategy[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Embedding and vector store
// ═══════════════════════════════════════════════════════════════════════════════

export interface EmbeddingGenerator {
  generate(text: string | string[], dimensions?: number): Promise<number[] | number[][]>;
}

export interface VectorSearchResult<T> {
  item: T;
  score: number; // similarity (0-1)
}

export type VectorStoreOption<T> = {
  limit?: number;
  // Generic filter object passed to the store implementation
  filter?: Record<string, any>;
  // For stateless store: explicitly provide the candidates to search against
  candidates?: (T & { embedding?: number[] | null })[];
  // Minimum similarity score to include in results
  minScore?: number;
};

export interface VectorStore {
  /**
   * Search for similar items in the vector store.
   * 
   * @param queryVector - The embedding vector to search for
   * @param collection - The logical name of the collection (e.g., 'profiles', 'intents')
   * @param options - generic options including limit, filter, and candidates
   */
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
   * Multi-strategy HyDE search: run one vector search per (strategy, embedding),
   * then merge, deduplicate by userId, and rank (boost for multiple strategy matches).
   *
   * @param hydeEmbeddings - Map of strategy -> query embedding for that strategy
   * @param options - strategies to use, indexScope, excludeUserId, limits, minScore
   * @returns Deduplicated, ranked candidates (profile or intent) with scores
   */
  searchWithHydeEmbeddings(
    hydeEmbeddings: Map<HydeStrategy, number[]>,
    options: HydeSearchOptions
  ): Promise<HydeCandidate[]>;
}
