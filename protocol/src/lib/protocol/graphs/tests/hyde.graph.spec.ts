/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { z } from 'zod';
import { runScenario, defineScenario, expectSmartest } from '../../../smartest';
import { HydeGraphFactory } from '../hyde.graph';
import type { HydeGraphDatabase } from '../../interfaces/database.interface';
import type { EmbeddingGenerator } from '../../interfaces/embedder.interface';
import type { HydeCache } from '../../interfaces/cache.interface';
import { HydeGenerator } from '../../agents/hyde.generator';
import { EmbedderAdapter } from '../../../../adapters/embedder.adapter';

describe('HydeGraph', () => {
  let mockDatabase: HydeGraphDatabase;
  let mockEmbedder: EmbeddingGenerator;
  let mockCache: HydeCache;
  let generator: HydeGenerator;

  const intentText = 'Looking for a React developer for a seed-stage startup.';
  const strategies = ['mirror', 'reciprocal'] as const;
  const dummyEmbedding = [0.1, 0.2];

  beforeEach(() => {
    mockDatabase = {
      getHydeDocument: mock(async () => null),
      getHydeDocumentsForSource: mock(async () => []),
      saveHydeDocument: mock(async (data) => ({
        id: 'hyde-1',
        sourceType: data.sourceType,
        sourceId: data.sourceId ?? null,
        sourceText: data.sourceText ?? null,
        strategy: data.strategy,
        targetCorpus: data.targetCorpus,
        hydeText: data.hydeText,
        hydeEmbedding: data.hydeEmbedding,
        context: data.context ?? null,
        createdAt: new Date(),
        expiresAt: null,
      })),
      getIntent: mock(async () => null),
    } as unknown as HydeGraphDatabase;

    mockEmbedder = {
      generate: mock(async (text: string | string[]) => {
        const arr = Array.isArray(text) ? text : [text];
        return arr.length === 1 ? dummyEmbedding : arr.map(() => [...dummyEmbedding]);
      }),
    } as unknown as EmbeddingGenerator;

    const cacheStore: Record<string, unknown> = {};
    mockCache = {
      get: mock(async (key: string) => cacheStore[key] ?? null),
      set: mock(async (key: string, value: unknown) => {
        cacheStore[key] = value;
      }),
      delete: mock(async () => true),
      exists: mock(async (key: string) => key in cacheStore),
    } as unknown as HydeCache;

    generator = new HydeGenerator();
    spyOn(generator, 'generate').mockResolvedValue({
      text: 'I am an experienced React developer looking for early-stage opportunities.',
    });
  });

  describe('E2E: Invoke with intent text returns embeddings', () => {
    it('invoke with sourceText and strategies returns hydeEmbeddings', async () => {
      const factory = new HydeGraphFactory(
        mockDatabase,
        mockEmbedder,
        mockCache,
        generator
      );
      const graph = factory.createGraph();

      const result = await graph.invoke({
        sourceType: 'intent',
        sourceId: 'intent-123',
        sourceText: intentText,
        strategies: [...strategies],
      });

      expect(result.error).toBeUndefined();
      expect(result.hydeEmbeddings).toBeDefined();
      expect(Object.keys(result.hydeEmbeddings ?? {}).length).toBe(2);
      expect(result.hydeEmbeddings?.mirror).toEqual(dummyEmbedding);
      expect(result.hydeEmbeddings?.reciprocal).toEqual(dummyEmbedding);
      expect(mockEmbedder.generate).toHaveBeenCalled();
      expect(generator.generate).toHaveBeenCalledTimes(2);
    });
  });

  describe('E2E: Second invoke hits cache (no LLM call)', () => {
    it('second invoke with same input uses cache and does not call generator', async () => {
      const factory = new HydeGraphFactory(
        mockDatabase,
        mockEmbedder,
        mockCache,
        generator
      );
      const graph = factory.createGraph();

      const input = {
        sourceType: 'intent' as const,
        sourceId: 'intent-456',
        sourceText: intentText,
        strategies: ['mirror' as const],
      };

      await graph.invoke(input);
      expect(generator.generate).toHaveBeenCalledTimes(1);

      (generator.generate as ReturnType<typeof mock>).mockClear();

      const result2 = await graph.invoke(input);

      expect(result2.hydeEmbeddings?.mirror).toEqual(dummyEmbedding);
      expect(generator.generate).not.toHaveBeenCalled();
    });
  });

  describe('E2E: forceRegenerate bypasses cache', () => {
    it('forceRegenerate true skips cache and calls generator', async () => {
      const factory = new HydeGraphFactory(
        mockDatabase,
        mockEmbedder,
        mockCache,
        generator
      );
      const graph = factory.createGraph();

      const input = {
        sourceType: 'intent' as const,
        sourceId: 'intent-789',
        sourceText: intentText,
        strategies: ['mirror' as const],
        forceRegenerate: true,
      };

      const result = await graph.invoke(input);

      expect(result.hydeEmbeddings?.mirror).toEqual(dummyEmbedding);
      expect(generator.generate).toHaveBeenCalled();
      expect(mockCache.get).not.toHaveBeenCalled();
      expect(mockDatabase.getHydeDocument).not.toHaveBeenCalled();
    });
  });

  describe('Smartest: graph with real LLM and embedder', () => {
    const hydeGraphOutputSchema = z.object({
      hydeEmbeddings: z.record(z.string(), z.array(z.number())),
      error: z.string().optional(),
    });

    it('invoke with intent text returns embeddings (Smartest: real LLM + embedder, schema)', async () => {
      const cacheStore: Record<string, unknown> = {};
      const mockDb: HydeGraphDatabase = {
        getHydeDocument: async () => null,
        getHydeDocumentsForSource: async () => [],
        saveHydeDocument: async (data) => ({
          id: 'hyde-1',
          sourceType: data.sourceType,
          sourceId: data.sourceId ?? null,
          sourceText: data.sourceText ?? null,
          strategy: data.strategy,
          targetCorpus: data.targetCorpus,
          hydeText: data.hydeText,
          hydeEmbedding: data.hydeEmbedding,
          context: data.context ?? null,
          createdAt: new Date(),
          expiresAt: null,
        }),
        getIntent: async () => null,
      } as HydeGraphDatabase;
      const mockCache: HydeCache = {
        get: async <T>(key: string): Promise<T | null> => (cacheStore[key] ?? null) as T | null,
        set: async (key: string, value: unknown) => {
          cacheStore[key] = value;
        },
        delete: async () => true,
        exists: async (key: string) => key in cacheStore,
      };

      const result = await runScenario(
        defineScenario({
          name: 'hyde-graph-invoke',
          description:
            'HyDE graph with real LLM and embedder: given intent text, returns embeddings and HyDE documents that are first-person and match the intent.',
          fixtures: {
            sourceText:
              'Looking for a React developer for a seed-stage startup.',
          },
          sut: {
            type: 'graph',
            factory: () => {
              const generator = new HydeGenerator();
              const embedder = new EmbedderAdapter();
              const factory = new HydeGraphFactory(mockDb, embedder, mockCache, generator);
              return factory.createGraph();
            },
            invoke: async (instance, resolvedInput) => {
              const input = resolvedInput as { sourceText: string };
              return await (instance as ReturnType<HydeGraphFactory['createGraph']>).invoke({
                sourceType: 'intent',
                sourceId: 'intent-smartest',
                sourceText: input.sourceText,
                strategies: ['mirror'],
              });
            },
            input: { sourceText: '@fixtures.sourceText' },
          },
          verification: {
            schema: hydeGraphOutputSchema,
            criteria:
              'hydeEmbeddings must contain at least one strategy (e.g. mirror) with a non-empty array of numbers. ' +
              'HyDE document text should be in first person and describe an ideal match for the source intent.',
            llmVerify: false,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as { hydeEmbeddings?: Record<string, number[]> };
      expect(output?.hydeEmbeddings?.mirror).toBeDefined();
      expect(Array.isArray(output?.hydeEmbeddings?.mirror)).toBe(true);
      expect((output?.hydeEmbeddings?.mirror ?? []).length).toBeGreaterThan(0);
    }, 70000);
  });
});
