
import { VectorStore, VectorSearchResult, VectorStoreOption } from '../embedder.types';

export class StatelessVectorStore implements VectorStore {
  async search<T>(
    queryVector: number[],
    collection: string,
    options?: VectorStoreOption<T>
  ): Promise<VectorSearchResult<T>[]> {
    if (!options?.candidates) {
      throw new Error('StatelessVectorStore requires candidates to be provided in options');
    }

    const { candidates, limit = 10, minScore = 0.0 } = options;

    const results = candidates.map(item => {
      if (!item.embedding || item.embedding.length === 0) {
        return { item, score: -1 };
      }
      const score = this.cosineSimilarity(queryVector, item.embedding);
      return { item, score };
    });

    // Filter by minScore and Sort by score descending
    return results
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      // In a real generic lib we might throw, but here just return -1 for safety
      return -1;
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      magnitudeA += vecA[i] * vecA[i];
      magnitudeB += vecB[i] * vecB[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }
}
