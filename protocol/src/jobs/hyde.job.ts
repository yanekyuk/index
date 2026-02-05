import cron from 'node-cron';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import type { HydeGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde/hyde.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde/hyde.generator';
import { log } from '../lib/log';

const logger = log.job.from("hyde");
const database = new ChatDatabaseAdapter();
const hydeDb = database as unknown as HydeGraphDatabase;

/** Staleness threshold for refresh: documents older than 30 days. */
const STALE_HYDE_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Optional deps for testing. */
export interface HydeJobDeps {
  database: Pick<
    ChatDatabaseAdapter,
    | 'deleteExpiredHydeDocuments'
    | 'getStaleHydeDocuments'
    | 'getIntentForIndexing'
    | 'deleteHydeDocumentsForSource'
  >;
}

/**
 * Daily job: Remove HyDE documents with expires_at <= now.
 * @param deps - Optional; if not provided, uses default ChatDatabaseAdapter.
 */
export async function cleanupExpiredHyde(deps?: HydeJobDeps): Promise<number> {
  const db = deps?.database ?? database;
  logger.info('[HydeJob:Cleanup] Starting expired HyDE cleanup');
  const deletedCount = await db.deleteExpiredHydeDocuments();
  logger.info(`[HydeJob:Cleanup] Deleted ${deletedCount} expired HyDE documents`);
  return deletedCount;
}

/**
 * Weekly job: Refresh stale persisted HyDE documents (by createdAt).
 * For each stale document with sourceType 'intent', re-run the HyDE graph; if the intent is gone, delete orphaned HyDE.
 * @param deps - Optional; if not provided, uses default ChatDatabaseAdapter and real embedder/cache/graph.
 */
export async function refreshStaleHyde(deps?: HydeJobDeps): Promise<number> {
  const db = deps?.database ?? database;
  logger.info('[HydeJob:Refresh] Starting stale HyDE refresh');
  const staleThreshold = new Date(Date.now() - STALE_HYDE_DAYS_MS);
  const staleDocuments = await db.getStaleHydeDocuments(staleThreshold);
  logger.info(`[HydeJob:Refresh] Found ${staleDocuments.length} stale HyDE documents`);

  const embedder = new EmbedderAdapter();
  const cache = new RedisCacheAdapter();
  const generator = new HydeGenerator();
  const graphDb = (deps?.database ?? database) as unknown as HydeGraphDatabase;
  const hydeGraph = new HydeGraphFactory(graphDb, embedder, cache, generator).createGraph();

  let refreshedCount = 0;
  for (const doc of staleDocuments) {
    if (!doc.sourceId) continue;
    if (doc.sourceType !== 'intent') continue;

    const intent = await db.getIntentForIndexing(doc.sourceId);
    if (!intent) {
      await db.deleteHydeDocumentsForSource(doc.sourceType, doc.sourceId);
      continue;
    }

    try {
      await hydeGraph.invoke({
        sourceText: intent.payload,
        sourceType: 'intent',
        sourceId: doc.sourceId,
        strategies: [doc.strategy as 'mirror' | 'reciprocal'],
        forceRegenerate: true,
      });
      refreshedCount++;
    } catch (error) {
      logger.error('[HydeJob:Refresh] Failed to refresh HyDE', {
        sourceId: doc.sourceId,
        strategy: doc.strategy,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info(`[HydeJob:Refresh] Refreshed ${refreshedCount} HyDE documents`);
  return refreshedCount;
}

/**
 * Schedule HyDE maintenance crons: daily cleanup, weekly refresh.
 */
export function initHydeJobs(): void {
  cron.schedule('0 3 * * *', () => {
    cleanupExpiredHyde().catch((err) =>
      logger.error('[HydeJob:Cleanup] Cron failed', { error: err })
    );
  });
  logger.info('📅 [HydeJob] Cleanup scheduled (daily at 03:00)');

  cron.schedule('0 4 * * 0', () => {
    refreshStaleHyde().catch((err) =>
      logger.error('[HydeJob:Refresh] Cron failed', { error: err })
    );
  });
  logger.info('📅 [HydeJob] Refresh scheduled (weekly Sunday at 04:00)');
}
