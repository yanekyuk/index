import { log } from '../lib/log';
import type { Id } from '../types/common.types';
import type { OpportunityGraphDatabase, HydeGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import type { HydeCache } from '../lib/protocol/interfaces/cache.interface';
import { OpportunityGraphFactory } from '../lib/protocol/graphs/opportunity.graph';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde.generator';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';

const logger = log.job.from('opportunity-discovery');

const database = new ChatDatabaseAdapter();
const graphDb = database as unknown as OpportunityGraphDatabase & HydeGraphDatabase;

export interface OpportunityDiscoveryJobData {
  intentId: string;
  userId: string;
  indexIds?: string[];
}

/**
 * Run opportunity discovery for an intent: load intent, (optionally scope to indexIds), invoke opportunity graph with initialStatus latent.
 */
export async function handleDiscoverOpportunities(data: OpportunityDiscoveryJobData): Promise<void> {
  const { intentId, userId, indexIds } = data;
  const intent = await database.getIntentForIndexing(intentId);
  if (!intent) {
    logger.warn('[OpportunityDiscovery] Intent not found, skipping', { intentId });
    return;
  }
  const embedder: Embedder = new EmbedderAdapter();
  const cache: HydeCache = new RedisCacheAdapter();
  const generator = new HydeGenerator();
  const hydeGraph = new HydeGraphFactory(
    graphDb as HydeGraphDatabase,
    embedder,
    cache,
    generator
  ).createGraph();
  const opportunityGraph = new OpportunityGraphFactory(
    graphDb as OpportunityGraphDatabase,
    embedder,
    hydeGraph
  ).createGraph();

  await opportunityGraph.invoke({
    userId: userId as Id<'users'>,
    searchQuery: intent.payload,
    operationMode: 'create',
    indexId: indexIds?.[0] as Id<'indexes'> | undefined,
    options: { initialStatus: 'latent' },
  });
  logger.info('[OpportunityDiscovery] Discovery complete for intent', { intentId, userId });
}
