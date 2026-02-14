import { Job } from 'bullmq';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import type { Id } from '../types/common.types';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import type { OpportunityGraphDatabase, HydeGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import type { HydeCache } from '../lib/protocol/interfaces/cache.interface';
import { OpportunityGraphFactory } from '../lib/protocol/graphs/opportunity.graph';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde.generator';

/** BullMQ queue name for opportunity discovery jobs. */
export const QUEUE_NAME = 'opportunity-discovery-queue';

/** Payload for a single opportunity discovery job (runs the opportunity graph for one intent). */
export interface OpportunityJobData {
  intentId: string;
  userId: string;
  indexIds?: string[];
}

/** Minimal database interface for opportunity queue (used when deps provided in tests). */
export type OpportunityQueueDatabase = Pick<ChatDatabaseAdapter, 'getIntentForIndexing'>;

/** Options passed to the opportunity graph when processing a discovery job. */
export interface OpportunityGraphInvokeOptions {
  userId: string;
  searchQuery: string;
  operationMode: 'create';
  indexId?: string;
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
    this.queueLogger.info(`[OpportunityProcessor] Processing job (${name})`);
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

  private async handleDiscoverOpportunities(data: OpportunityJobData): Promise<void> {
    const { intentId, userId, indexIds } = data;
    const db = this.deps?.database ?? this.database;
    const intent = await db.getIntentForIndexing(intentId);
    if (!intent) {
      this.logger.warn('[OpportunityDiscovery] Intent not found, skipping', { intentId });
      return;
    }
    const invokeOpts: OpportunityGraphInvokeOptions = {
      userId: userId as Id<'users'>,
      searchQuery: intent.payload,
      operationMode: 'create',
      indexId: indexIds?.[0] as Id<'indexes'> | undefined,
      options: { initialStatus: 'latent' },
    };
    if (this.deps?.invokeOpportunityGraph) {
      await this.deps.invokeOpportunityGraph(invokeOpts);
    } else {
      const embedder: Embedder = new EmbedderAdapter();
      const cache: HydeCache = new RedisCacheAdapter();
      const generator = new HydeGenerator();
      const hydeGraph = new HydeGraphFactory(
        this.graphDb as HydeGraphDatabase,
        embedder,
        cache,
        generator
      ).createGraph();
      const opportunityGraph = new OpportunityGraphFactory(
        this.graphDb as OpportunityGraphDatabase,
        embedder,
        hydeGraph
      ).createGraph();
      await opportunityGraph.invoke(invokeOpts);
    }
    this.logger.info('[OpportunityDiscovery] Discovery complete for intent', { intentId, userId });
  }
}

/** Singleton opportunity discovery queue instance. Use for adding jobs and starting the worker. */
export const opportunityQueue = new OpportunityQueue();
