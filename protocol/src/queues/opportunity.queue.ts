import { Job } from 'bullmq';
import cron from 'node-cron';
import { and, isNotNull, lte, notInArray } from 'drizzle-orm';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import type { Id } from '../types/common.types';
import db from '../lib/drizzle/drizzle';
import { opportunities } from '../schemas/database.schema';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import type { OpportunityGraphDatabase, HydeGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import type { HydeCache } from '../lib/protocol/interfaces/cache.interface';
import { OpportunityGraphFactory } from '../lib/protocol/graphs/opportunity.graph';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde.generator';
import { LensInferrer } from '../lib/protocol/agents/lens.inferrer';

/** BullMQ queue name for opportunity discovery jobs. */
export const QUEUE_NAME = 'opportunity-discovery-queue';

/** Payload for a single opportunity discovery job (runs the opportunity graph for one intent). */
export interface OpportunityJobData {
  intentId: string;
  userId: string;
  indexIds?: string[];
  /** When set, run discovery on behalf of this contact user (introducer discovery). */
  contactUserId?: string;
}

/** Minimal database interface for opportunity queue (used when deps provided in tests). */
export type OpportunityQueueDatabase = Pick<ChatDatabaseAdapter, 'getIntentForIndexing' | 'getActiveIntents'>;

/** Options passed to the opportunity graph when processing a discovery job. */
export interface OpportunityGraphInvokeOptions {
  userId: string;
  searchQuery: string;
  operationMode: 'create';
  indexId?: string;
  /** Intent that triggered this job; used for search text and triggeredBy when in scope. */
  triggerIntentId?: string;
  /** Discover on behalf of this user (introducer flow). */
  onBehalfOfUserId?: string;
  options: { initialStatus: 'latent' };
}

/**
 * Optional dependencies for testing. Use abstractions (`Pick<Adapter, ...>` or protocol interfaces)
 * to stub database or opportunity graph invocation.
 */
export interface OpportunityQueueDeps {
  database?: OpportunityQueueDatabase;
  invokeOpportunityGraph?: (opts: OpportunityGraphInvokeOptions) => Promise<void>;
}

/**
 * Opportunity discovery queue: BullMQ queue plus worker and job handlers.
 *
 * Handles `discover_opportunities`: loads intent, invokes the opportunity graph to find/create
 * latent opportunities. Triggered after intent HyDE generation (see intent queue).
 *
 * @remarks
 * Workers are started only by the protocol server via {@link OpportunityQueue.startWorker}.
 * CLI scripts (e.g. db:seed) may add jobs without starting a worker.
 */
export class OpportunityQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<OpportunityJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('OpportunityJob');
  private readonly queueLogger = log.queue.from('OpportunityQueue');
  private readonly database: OpportunityQueueDatabase | ChatDatabaseAdapter;
  private readonly graphDb: OpportunityGraphDatabase & HydeGraphDatabase;
  private readonly deps: OpportunityQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<OpportunityJobData>> | null = null;

  /**
   * @param deps - Optional overrides for database and opportunity graph (for tests).
   */
  constructor(deps?: OpportunityQueueDeps) {
    this.deps = deps;
    this.database = deps?.database ?? new ChatDatabaseAdapter();
    this.graphDb = (this.database as ChatDatabaseAdapter) as unknown as OpportunityGraphDatabase & HydeGraphDatabase;
    // When deps is omitted, default adapter implements the same interface.
  }

  /**
   * Add a discover_opportunities job for an intent/user.
   * @param data - intentId, userId, optional indexIds
   * @param options - Optional jobId and priority
   * @returns The BullMQ job
   */
  async addJob(
    data: OpportunityJobData,
    options?: { jobId?: string; priority?: number }
  ): Promise<Job<OpportunityJobData>> {
    const initialDelayMs = 1000;
    return this.queue.add('discover_opportunities', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: initialDelayMs },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
      jobId: options?.jobId,
      priority: options?.priority,
    });
  }

  /**
   * Run the job handler for a given job name and payload. Used by the worker and by tests with injected deps.
   * @param name - Job name (`discover_opportunities`)
   * @param data - Job payload
   */
  async processJob(name: string, data: OpportunityJobData): Promise<void> {
    switch (name) {
      case 'discover_opportunities':
        await this.handleDiscoverOpportunities(data);
        break;
      default:
        this.queueLogger.warn(`[OpportunityProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Start the BullMQ worker for this queue. Idempotent; call from the protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<OpportunityJobData>) => {
      this.queueLogger.info(`[OpportunityProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<OpportunityJobData>(QUEUE_NAME, processor);
  }

  /**
   * Expire stale opportunities: transitions opportunities whose expiresAt <= now
   * from non-terminal statuses to 'expired'. Runs every 15 minutes.
   */
  private async expireStaleOpportunities(): Promise<number> {
    const now = new Date();
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          isNotNull(opportunities.expiresAt),
          lte(opportunities.expiresAt, now),
          notInArray(opportunities.status, ['accepted', 'rejected', 'expired'])
        )
      )
      .returning({ id: opportunities.id });
    return updated.length;
  }

  /**
   * Schedule opportunity expiration cron (every 15 minutes). Call from protocol server only.
   */
  startCrons(): void {
    cron.schedule('*/15 * * * *', () => {
      this.expireStaleOpportunities()
        .then((count) => {
          if (count > 0) {
            this.queueLogger.info(`[OpportunityExpiration] Expired ${count} opportunit${count === 1 ? 'y' : 'ies'}`);
          }
        })
        .catch((err) =>
          this.queueLogger.error('[OpportunityExpiration] Cron failed', { error: err })
        );
    });
    this.queueLogger.info('[OpportunityQueue] Expiration cron scheduled (every 15 minutes)');
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private async handleDiscoverOpportunities(data: OpportunityJobData): Promise<void> {
    const { intentId, userId, indexIds, contactUserId } = data;
    const db = this.deps?.database ?? this.database;

    let searchQuery: string;
    let triggerIntentId: string | undefined;
    let onBehalfOfUserId: string | undefined;

    if (contactUserId) {
      // Introducer discovery: look up the contact's active intents for search query
      const contactIntents = await db.getActiveIntents(contactUserId);
      if (contactIntents.length === 0) {
        this.logger.warn('[OpportunityDiscovery] Contact has no active intents, skipping', { contactUserId, userId });
        return;
      }
      searchQuery = contactIntents[0].payload;
      onBehalfOfUserId = contactUserId;
      this.logger.info('[OpportunityDiscovery] Starting introducer discovery', { userId, contactUserId, indexIds });
    } else {
      const intent = await db.getIntentForIndexing(intentId);
      if (!intent) {
        this.logger.warn('[OpportunityDiscovery] Intent not found, skipping', { intentId });
        return;
      }
      searchQuery = intent.payload;
      triggerIntentId = intentId;
      this.logger.info('[OpportunityDiscovery] Starting discovery', { intentId, userId, indexIds });
    }

    this.logger.debug('[OpportunityDiscovery] Search query preview', { intentId, searchQuery: searchQuery?.slice(0, 80) });
    const invokeOpts: OpportunityGraphInvokeOptions = {
      userId: userId as Id<'users'>,
      searchQuery,
      operationMode: 'create',
      indexId: indexIds?.[0] as Id<'indexes'> | undefined,
      triggerIntentId,
      onBehalfOfUserId,
      options: { initialStatus: 'latent' },
    };
    if (this.deps?.invokeOpportunityGraph) {
      await this.deps.invokeOpportunityGraph(invokeOpts);
    } else {
      const embedder: Embedder = new EmbedderAdapter();
      const cache: HydeCache = new RedisCacheAdapter();
      const inferrer = new LensInferrer();
      const generator = new HydeGenerator();
      const hydeGraph = new HydeGraphFactory(
        this.graphDb as HydeGraphDatabase,
        embedder,
        cache,
        inferrer,
        generator
      ).createGraph();
      const opportunityGraph = new OpportunityGraphFactory(
        this.graphDb as OpportunityGraphDatabase,
        embedder,
        hydeGraph
      ).createGraph();
      const result = await opportunityGraph.invoke(invokeOpts);

      // Log the graph trace for background job visibility
      const trace = Array.isArray(result.trace) ? result.trace : [];
      const candidates = Array.isArray(result.candidates) ? result.candidates : [];
      const opportunities = Array.isArray(result.opportunities) ? result.opportunities : [];
      // Throw on graph error so BullMQ retries the job
      if (result.error) {
        this.logger.error('[OpportunityDiscovery] Graph failed', { intentId, userId, error: result.error });
        throw new Error(typeof result.error === 'string' ? result.error : 'Opportunity discovery graph failed');
      }

      this.logger.info('[OpportunityDiscovery] Graph complete', {
        intentId,
        userId,
        candidatesFound: candidates.length,
        opportunitiesCreated: opportunities.length,
      });
      this.logger.verbose('[OpportunityDiscovery] Graph trace', {
        intentId,
        trace: trace.map((t: { node: string; detail?: string; data?: Record<string, unknown> }) => ({
          node: t.node,
          detail: t.detail,
          ...(t.data ? { data: t.data } : {}),
        })),
      });
    }
    this.logger.verbose('[OpportunityDiscovery] Discovery complete for intent', { intentId, userId });
  }
}

/** Singleton opportunity discovery queue instance. Use for adding jobs and starting the worker. */
export const opportunityQueue = new OpportunityQueue();
