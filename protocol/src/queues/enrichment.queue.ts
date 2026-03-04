import { Job } from 'bullmq';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { ProfileDatabaseAdapter, ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { ProfileGraphFactory } from '../lib/protocol/graphs/profile.graph';
import { searchUser } from '../lib/parallel/parallel';

/** BullMQ queue name for ghost user enrichment jobs. */
export const QUEUE_NAME = 'enrichment-queue';

/** Payload for ghost.enrich jobs. */
export interface EnrichGhostJobData {
  userId: string;
}

/** Union of all job payloads accepted by the enrichment queue. */
export type EnrichmentJobPayload = EnrichGhostJobData;

/**
 * Optional dependencies for testing.
 */
export interface EnrichmentQueueDeps {
  invokeEnrich?: (userId: string) => Promise<void>;
}

/**
 * Enrichment queue: enriches ghost users with public data from Parallels API
 * and generates profiles + HyDE documents for discovery.
 *
 * @remarks
 * Workers are started only by the protocol server via {@link EnrichmentQueue.startWorker}.
 */
export class EnrichmentQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<EnrichmentJobPayload>(QUEUE_NAME);

  private readonly logger = log.job.from('EnrichmentJob');
  private readonly queueLogger = log.queue.from('EnrichmentQueue');
  private readonly deps: EnrichmentQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<EnrichmentJobPayload>> | null = null;

  constructor(deps?: EnrichmentQueueDeps) {
    this.deps = deps;
  }

  /**
   * Enqueue a job to enrich a ghost user with public data.
   * @param data - userId of the ghost user
   * @returns The BullMQ job
   */
  addEnrichGhostJob(data: EnrichGhostJobData): Promise<Job<EnrichmentJobPayload>> {
    return this.addJob('ghost.enrich', data);
  }

  /**
   * Add a job to the enrichment queue.
   * @param name - Job type
   * @param data - Payload for the job
   * @param options - Optional jobId and priority
   * @returns The BullMQ job
   */
  async addJob(
    name: 'ghost.enrich',
    data: EnrichmentJobPayload,
    options?: { jobId?: string; priority?: number }
  ): Promise<Job<EnrichmentJobPayload>> {
    return this.queue.add(name, data, {
      jobId: options?.jobId,
      priority: options?.priority,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    });
  }

  /**
   * Run the job handler for a given job name and payload.
   * @param name - Job name
   * @param data - Job payload
   */
  async processJob(name: string, data: EnrichmentJobPayload): Promise<void> {
    switch (name) {
      case 'ghost.enrich':
        await this.handleEnrichGhost(data);
        break;
      default:
        this.queueLogger.warn(`[EnrichmentProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Start the BullMQ worker for this queue. Idempotent.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<EnrichmentJobPayload>) => {
      this.queueLogger.info(`[EnrichmentProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<EnrichmentJobPayload>(QUEUE_NAME, processor);
  }

  private async handleEnrichGhost(data: EnrichGhostJobData): Promise<void> {
    const { userId } = data;

    if (this.deps?.invokeEnrich) {
      await this.deps.invokeEnrich(userId);
      return;
    }

    try {
      // 1. Fetch ghost user details
      const chatDb = new ChatDatabaseAdapter();
      const user = await chatDb.getUser(userId);
      if (!user) {
        this.logger.warn('[EnrichGhost] User not found, skipping', { userId });
        return;
      }

      // 2. Search for public data via Parallels API
      let searchResult;
      try {
        searchResult = await searchUser({
          name: user.name,
          email: user.email,
        });
        this.logger.verbose('[EnrichGhost] Parallels search completed', {
          userId,
          resultCount: searchResult?.results?.length ?? 0,
        });
      } catch (err) {
        this.logger.warn('[EnrichGhost] Parallels search failed, running profile graph without enrichment', {
          userId,
          error: err,
        });
      }

      // 3. If we found data, update user socials with discovered links
      if (searchResult?.results?.length) {
        const socials: Record<string, string | string[]> = {};
        const websites: string[] = [];
        for (const result of searchResult.results) {
          const url = result.url;
          if (url.includes('linkedin.com')) socials.linkedin = url;
          else if (url.includes('twitter.com') || url.includes('x.com')) socials.x = url;
          else if (url.includes('github.com')) socials.github = url;
          else websites.push(url);
        }
        if (websites.length > 0) socials.websites = websites;
        if (Object.keys(socials).length > 0) {
          await chatDb.updateUser(userId, { socials: socials as { x?: string; linkedin?: string; github?: string; websites?: string[] } });
        }
      }

      // 4. Run profile graph to generate profile + HyDE from available data
      const database = new ProfileDatabaseAdapter();
      const embedder = new EmbedderAdapter();
      const scraper = new ScraperAdapter();
      const factory = new ProfileGraphFactory(database, embedder, scraper);
      const graph = factory.createGraph();
      await graph.invoke({ userId, operationMode: 'write' });

      this.logger.verbose('[EnrichGhost] Profile generated for ghost user', { userId });
    } catch (err) {
      this.logger.error('[EnrichGhost] Failed to enrich ghost user', { userId, error: err });
      throw err;
    }
  }
}

/** Singleton enrichment queue instance. */
export const enrichmentQueue = new EnrichmentQueue();
