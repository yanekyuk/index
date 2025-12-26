import { Embedder, EmbeddingGenerator, VectorSearchResult, VectorStoreOption } from '../../agents/common/types';
import { OpenRouterGenerator } from './embedder.generator';

export interface IndexEmbedderOptions {
  // Generator Configuration
  generator?: {
    model?: string;
    dimensions?: number;
  };
  // Injected Search Strategy
  searcher?: (queryVector: number[], collection: string, options?: VectorStoreOption<any>) => Promise<VectorSearchResult<any>[]>;
}

export class IndexEmbedder implements Embedder {
  private generator: EmbeddingGenerator;
  private searcher?: (queryVector: number[], collection: string, options?: VectorStoreOption<any>) => Promise<VectorSearchResult<any>[]>;

  constructor(options?: IndexEmbedderOptions) {
    // Initialize Generator (defaults to OpenRouterGenerator)
    // NOTE: OpenRouterGenerator currently doesn't take constructor args for model, it hardcodes 'openai/text-embedding-3-large'.
    // If we want to support model selection, we should update OpenRouterGenerator or pass it here.
    // For now, initializing default.
    this.generator = new OpenRouterGenerator();

    // Initialize Searcher
    this.searcher = options?.searcher;
  }

  /**
   * Generates embeddings using the internal generator.
   */
  async generate(text: string | string[], dimensions: number = 2000): Promise<number[] | number[][]> {
    return this.generator.generate(text, dimensions);
  }

  /**
   * Searches using the injected searcher strategy.
   * Throws if no searcher is defined.
   */
  async search<T>(
    queryVector: number[],
    collection: string,
    options?: VectorStoreOption<T>
  ): Promise<VectorSearchResult<T>[]> {
    if (!this.searcher) {
      throw new Error('IndexEmbedder: No search strategy defined. Pass a `searcher` function in the constructor.');
    }
    return this.searcher(queryVector, collection, options);
  }
}

// Export shared types
export * from './embedder.types';
