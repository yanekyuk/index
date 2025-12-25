
import { Embedder, EmbeddingGenerator, VectorStore, VectorSearchResult, VectorStoreOption } from './embedder.types';
import { OpenRouterGenerator } from './embedder.generator';
import { PostgresVectorStore, DrizzleDB } from './stores/postgres.store';
import { StatelessVectorStore } from './stores/stateless.store';


export class IndexEmbedder implements Embedder {
  private generator: EmbeddingGenerator;
  private pgStore?: VectorStore;
  private statelessStore: VectorStore;

  constructor(db?: DrizzleDB) {
    this.generator = new OpenRouterGenerator();
    if (db) {
      this.pgStore = new PostgresVectorStore(db);
    }
    this.statelessStore = new StatelessVectorStore();
  }

  async generate(text: string | string[], dimensions: number = 2000): Promise<number[] | number[][]> {
    return this.generator.generate(text, dimensions);
  }

  async search<T>(
    queryVector: number[],
    collection: string,
    options?: VectorStoreOption<T>
  ): Promise<VectorSearchResult<T>[]> {
    // Strategy Selection Logic:
    // If candidates are provided, we MUST use Stateless store (searching against provided list).
    // If no candidates, we assume we are searching the persistent database -> Postgres.

    // User Update: If DB doesn't exist, use stateless store (which likely relies on candidates or returns empty/error if none)

    if ((options && options.candidates && options.candidates.length > 0) || !this.pgStore) {
      return this.statelessStore.search(queryVector, collection, options);
    }

    return this.pgStore.search(queryVector, collection, options);
  }

}


// Export types for consumption
export * from './embedder.types';
