/**
 * HyDE Graph: cache-aware hypothetical document generation.
 *
 * Flow: check_cache → (generate_missing if needed) → embed → cache_results.
 * Constructor injects Database, Embedder, Cache, HydeGenerator.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { createHash } from 'crypto';
import { HydeGraphState, type HydeDocumentState } from './hyde.graph.state';
import type { HydeStrategy } from '../../agents/hyde/hyde.strategies';
import { HydeGenerator } from '../../agents/hyde/hyde.generator';
import type { HydeGraphDatabase } from '../../interfaces/database.interface';
import type { EmbeddingGenerator } from '../../interfaces/embedder.interface';
import type { HydeCache } from '../../interfaces/cache.interface';
import { log } from '../../../log';

const logger = log.protocol.from("HyDEGraphFactory");

/** Build cache key: hyde:sourceType:sourceKey:strategy. For query, sourceKey is hash of sourceText. */
function cacheKey(
  sourceType: string,
  sourceId: string | undefined,
  sourceText: string,
  strategy: string
): string {
  const key =
    sourceId ??
    `q:${createHash('sha256').update(sourceText).digest('hex').slice(0, 16)}`;
  return `hyde:${sourceType}:${key}:${strategy}`;
}

/**
 * Factory for the HyDE generation graph.
 * Injects Database, Embedder, Cache, and HydeGenerator.
 */
export class HydeGraphFactory {
  constructor(
    private database: HydeGraphDatabase,
    private embedder: EmbeddingGenerator,
    private cache: HydeCache,
    private generator: HydeGenerator
  ) {}

  createGraph() {
    const self = this;

    const checkCacheNode = async (state: typeof HydeGraphState.State) => {
      const { sourceType, sourceId, sourceText, strategies, forceRegenerate } =
        state;

      if (forceRegenerate) {
        logger.info('Force regenerate - skipping cache');
        return { hydeDocuments: {} };
      }

      const cached: Record<string, HydeDocumentState> = {};

      for (const strategy of strategies) {
        const key = cacheKey(
          sourceType,
          sourceId ?? undefined,
          sourceText,
          strategy
        );

        const fromCache = await self.cache.get<HydeDocumentState>(key);
        if (fromCache?.hydeText && fromCache.hydeEmbedding?.length) {
          logger.info('Cache hit', { strategy });
          cached[strategy] = fromCache;
          continue;
        }

        if (sourceId && HydeGenerator.shouldPersist(strategy)) {
          const fromDb = await self.database.getHydeDocument(
            sourceType,
            sourceId,
            strategy
          );
          if (fromDb) {
            logger.info('DB hit', { strategy });
            cached[strategy] = {
              strategy: strategy as HydeStrategy,
              targetCorpus: fromDb.targetCorpus as 'profiles' | 'intents',
              hydeText: fromDb.hydeText,
              hydeEmbedding: fromDb.hydeEmbedding,
            };
          }
        }
      }

      logger.info('Check cache done', {
        found: Object.keys(cached).length,
        requested: strategies.length,
      });
      return { hydeDocuments: cached };
    };

    const shouldGenerate = (state: typeof HydeGraphState.State): string => {
      const { strategies, hydeDocuments } = state;
      const missing = strategies.filter((s) => !hydeDocuments[s]);
      if (missing.length > 0) {
        logger.info('Need to generate', { missing });
        return 'generate';
      }
      logger.info('All strategies cached, skipping generation');
      return 'skip';
    };

    const generateMissingNode = async (
      state: typeof HydeGraphState.State
    ) => {
      const { sourceText, strategies, hydeDocuments, context } = state;
      const missing = strategies.filter((s) => !hydeDocuments[s]);

      logger.info('Generating HyDE documents', {
        count: missing.length,
        strategies: missing,
      });

      const generated: Record<string, HydeDocumentState> = {};

      await Promise.all(
        missing.map(async (strategy) => {
          const out = await self.generator.generate(
            sourceText,
            strategy as HydeStrategy,
            context
          );
          const targetCorpus = HydeGenerator.getTargetCorpus(
            strategy as HydeStrategy
          );
          generated[strategy] = {
            strategy: strategy as HydeStrategy,
            targetCorpus,
            hydeText: out.text,
            hydeEmbedding: [],
          };
        })
      );

      return { hydeDocuments: { ...state.hydeDocuments, ...generated } };
    };

    const embedNode = async (state: typeof HydeGraphState.State) => {
      const { hydeDocuments } = state;
      const strategies = Object.keys(hydeDocuments);
      const toEmbed: { strategy: string; doc: HydeDocumentState }[] = [];
      const updated: Record<string, HydeDocumentState> = {};
      const hydeEmbeddings: Record<string, number[]> = {};

      for (const strategy of strategies) {
        const doc = hydeDocuments[strategy];
        if (!doc) continue;
        if (doc.hydeEmbedding?.length) {
          updated[strategy] = doc;
          hydeEmbeddings[strategy] = doc.hydeEmbedding;
        } else {
          toEmbed.push({ strategy, doc });
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
          const { strategy, doc } = toEmbed[i];
          const embedding = embeddingArray[i] ?? [];
          updated[strategy] = { ...doc, hydeEmbedding: embedding };
          hydeEmbeddings[strategy] = embedding;
        }
      }

      return { hydeDocuments: updated, hydeEmbeddings };
    };

    const cacheResultsNode = async (state: typeof HydeGraphState.State) => {
      const { sourceType, sourceId, sourceText, hydeDocuments } = state;

      for (const strategy of Object.keys(hydeDocuments)) {
        const doc = hydeDocuments[strategy];
        if (!doc) continue;

        const key = cacheKey(
          sourceType,
          sourceId ?? undefined,
          sourceText,
          strategy
        );
        const ttl = HydeGenerator.getCacheTTL(strategy as HydeStrategy);

        await self.cache.set(key, doc, ttl ? { ttl } : undefined);

        if (
          sourceId &&
          HydeGenerator.shouldPersist(strategy as HydeStrategy)
        ) {
          await self.database.saveHydeDocument({
            sourceType,
            sourceId,
            strategy,
            targetCorpus: doc.targetCorpus,
            hydeText: doc.hydeText,
            hydeEmbedding: doc.hydeEmbedding,
          });
        }
      }

      logger.info('Cached results', {
        count: Object.keys(hydeDocuments).length,
      });
      return {};
    };

    const workflow = new StateGraph(HydeGraphState)
      .addNode('check_cache', checkCacheNode)
      .addNode('generate_missing', generateMissingNode)
      .addNode('embed', embedNode)
      .addNode('cache_results', cacheResultsNode)
      .addEdge(START, 'check_cache')
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
