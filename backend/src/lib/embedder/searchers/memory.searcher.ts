import { VectorSearchResult, VectorStoreOption } from '../embedder.types';

/**
 * Calculates Cosine Similarity between two vectors.
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * In-Memory Search Strategy.
 * Useful for testing or playground environments where no DB is present.
 * 
 * REQUIRES `options.candidates` to be populated with objects containing `embedding: number[]`.
 */
export async function memorySearcher<T>(
  queryVector: number[],
  collection: string,
  options?: VectorStoreOption<T>
): Promise<VectorSearchResult<T>[]> {
  const candidates = options?.candidates;
  const minScore = options?.minScore || 0;
  const limit = options?.limit || 10;

  if (!candidates || candidates.length === 0) {
    return [];
  }

  const results: VectorSearchResult<T>[] = [];

  for (const item of candidates) {
    if (!item.embedding) continue;

    // Apply Filter (Simple 'ne' support for userId)
    const anyItem = item as any;

    if (options?.filter && anyItem.userId) {
      const f = options.filter as any;
      if (f.userId && f.userId.ne) {
        if (anyItem.userId === f.userId.ne) continue;
      }
    }

    const score = cosineSimilarity(queryVector, item.embedding);

    if (score >= minScore) {
      results.push({ item, score });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}
