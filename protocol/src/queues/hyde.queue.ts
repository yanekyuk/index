import cron from 'node-cron';
import { log } from '../lib/log';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import type { HydeGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde.generator';

/** Age in ms after which HyDE documents are considered stale (30 days). Used for weekly refresh. */
const STALE_HYDE_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Minimal database interface for HyDE maintenance (used when deps provided in tests). */
export type HydeQueueDatabase = Pick<
  ChatDatabaseAdapter,
  | 'deleteExpiredHydeDocuments'
  | 'getStaleHydeDocuments'
  | 'getIntentForIndexing'
  | 'deleteHydeDocumentsForSource'
>;

/**
 * Optional dependencies for testing. Use abstractions (`Pick<Adapter, ...>` or protocol interfaces)
 * to stub the database.
 */
export interface HydeQueueDeps {
  database?: HydeQueueDatabase;
}

/**
 * HyDE maintenance: cron-scheduled cleanup and refresh (no BullMQ queue).
 *
 * Provides expired-document cleanup and stale-document refresh. Call {@link HydeQueue.startCrons}
 * from the protocol server to schedule daily cleanup (03:00) and weekly refresh (Sunday 04:00).
 *
 * @remarks
 * Handlers orchestrate by calling adapters and the HyDE graph—no business logic here.
 */
export class HydeQueue {
  private readonly logger = log.job.from('HydeJob');
  private readonly database: HydeQueueDatabase | ChatDatabaseAdapter;
  private readonly deps: HydeQueueDeps | undefined;

  /**
   * @param deps - Optional overrides for database (for tests).
   */
  constructor(deps?: HydeQueueDeps) {
    this.deps = deps;
    this.database = deps?.database ?? new ChatDatabaseAdapter();
    // When deps is omitted, default adapter implements the same interface.
  }

  /**
   * Delete all expired HyDE documents from the database.
   * @returns Number of documents deleted
   */
  async cleanupExpiredHyde(): Promise<number> {
    const db = this.deps?.database ?? this.database;
    this.logger.info('[HydeJob:Cleanup] Starting expired HyDE cleanup');
    const deletedCount = await db.deleteExpiredHydeDocuments();
    this.logger.info(`[HydeJob:Cleanup] Deleted ${deletedCount} expired HyDE documents`);
    return deletedCount;
  }

  /**
   * Refresh HyDE documents older than the stale threshold (30 days). Re-invokes the HyDE graph per document.
   * @returns Number of documents refreshed
   */
  async refreshStaleHyde(): Promise<number> {
    const db = this.deps?.database ?? this.database;
    this.logger.info('[HydeJob:Refresh] Starting stale HyDE refresh');
    const staleThreshold = new Date(Date.now() - STALE_HYDE_DAYS_MS);
    const staleDocuments = await db.getStaleHydeDocuments(staleThreshold);
    this.logger.info(`[HydeJob:Refresh] Found ${staleDocuments.length} stale HyDE documents`);

    const embedder = new EmbedderAdapter();
    const cache = new RedisCacheAdapter();
    const generator = new HydeGenerator();
    const graphDb = (this.deps?.database ?? this.database) as unknown as HydeGraphDatabase;
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
        this.logger.error('[HydeJob:Refresh] Failed to refresh HyDE', {
          sourceId: doc.sourceId,
          strategy: doc.strategy,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info(`[HydeJob:Refresh] Refreshed ${refreshedCount} HyDE documents`);
    return refreshedCount;
  }

  /**
   * Schedule daily cleanup (03:00) and weekly refresh (Sunday 04:00). Call from protocol server only.
   */
  startCrons(): void {
    cron.schedule('0 3 * * *', () => {
      this.cleanupExpiredHyde().catch((err) =>
        this.logger.error('[HydeJob:Cleanup] Cron failed', { error: err })
      );
    });
    this.logger.info('📅 [HydeJob] Cleanup scheduled (daily at 03:00)');

    cron.schedule('0 4 * * 0', () => {
      this.refreshStaleHyde().catch((err) =>
        this.logger.error('[HydeJob:Refresh] Cron failed', { error: err })
      );
    });
    this.logger.info('📅 [HydeJob] Refresh scheduled (weekly Sunday at 04:00)');
  }
}

/** Singleton HyDE maintenance instance. Use for cleanup/refresh and starting crons. */
export const hydeQueue = new HydeQueue();
