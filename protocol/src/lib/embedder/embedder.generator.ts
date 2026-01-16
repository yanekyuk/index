
import OpenAI from 'openai';
import { EmbeddingGenerator } from './embedder.types';

export class OpenRouterGenerator implements EmbeddingGenerator {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://index.network',
        'X-Title': 'Index Network',
      },
    });
  }

  async generate(text: string | string[], dimensions: number = 2000): Promise<number[] | number[][]> {
    const texts = Array.isArray(text) ? text : [text];

    // Clean texts
    const cleanTexts = texts.map(t => t.replace(/\n/g, ' ').trim()).filter(Boolean);

    if (cleanTexts.length === 0) {
      throw new Error('Text cannot be empty');
    }

    try {
      // Note: This implements the single vector return signature from original lib/embeddings.ts
      // If we want batch support we might need to update the interface or this logic.
      // For now, staying compatible with current usage which seems to be single-string primarily.
      // The interface I defined in types.ts allows returning number[][] but the original code returned number[].
      // For safety, I'll stick to single string logic first or handle array correctly.

      const response = await this.openai.embeddings.create({
        model: 'openai/text-embedding-3-large',
        input: cleanTexts,
        dimensions,
        encoding_format: 'float',
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('No embedding data returned from OpenAI');
      }

      // If input was a single string, return single array. 
      // If input was array, return the first one (following original logic) OR we should support batch.
      // The original `generateEmbedding` took `text: string`, so it returned `number[]`.
      // My new interface defines `generate(text: string | string[]): Promise<number[] | number[][]>`.

      if (Array.isArray(text)) {
        return response.data.map(d => d.embedding);
      } else {
        return response.data[0].embedding;
      }
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
