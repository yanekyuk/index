import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import type { HydeGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde.generator';
import { log } from '../lib/log';
import { addOpportunityDiscoveryJob } from '../queues/opportunity-discovery.queue';

const logger = log.job.from('intent-hyde');

const database = new ChatDatabaseAdapter();
const graphDb = database as unknown as HydeGraphDatabase;

export interface IntentHydeJobData {
  intentId: string;
  userId: string;
}

/**
 * Generate HyDE documents for an intent (mirror + reciprocal) and persist to hyde_documents.
 */
export async function handleGenerateHyde(data: IntentHydeJobData): Promise<void> {
  const { intentId, userId } = data;
  const intent = await database.getIntentForIndexing(intentId);
  if (!intent) {
    logger.warn('[IntentHyde] Intent not found, skipping', { intentId });
    return;
  }
  // Assign intent to user's indexes so discovery can find it (searchIntentsForHyde joins intents ↔ intent_indexes).
  try {
    const userIndexIds = await database.getUserIndexIds(userId);
    for (const indexId of userIndexIds) {
      try {
        await database.assignIntentToIndex(intentId, indexId);
      } catch (assignErr) {
        // Ignore duplicate or constraint errors so one failure doesn't break the job
        logger.debug('[IntentHyde] Assign intent to index skipped', { intentId, indexId, error: assignErr });
      }
    }
  } catch (err) {
    logger.warn('[IntentHyde] Failed to assign intent to user indexes', { intentId, userId, error: err });
  }
  const embedder = new EmbedderAdapter();
  const cache = new RedisCacheAdapter();
  const generator = new HydeGenerator();
  const hydeGraph = new HydeGraphFactory(graphDb, embedder, cache, generator).createGraph();
  await hydeGraph.invoke({
    sourceText: intent.payload,
    sourceType: 'intent',
    sourceId: intentId,
    strategies: ['mirror', 'reciprocal'],
    forceRegenerate: true,
  });
  logger.info('[IntentHyde] Generated HyDE for intent', { intentId, userId });
  await addOpportunityDiscoveryJob({ intentId, userId }).catch((err) =>
    logger.error('[IntentHyde] Failed to enqueue opportunity discovery', { intentId, error: err })
  );
}

/**
 * Delete all HyDE documents for an intent (on archive).
 */
export async function handleDeleteHyde(data: { intentId: string }): Promise<void> {
  const { intentId } = data;
  await database.deleteHydeDocumentsForSource('intent', intentId);
  logger.info('[IntentHyde] Deleted HyDE documents for intent', { intentId });
}
