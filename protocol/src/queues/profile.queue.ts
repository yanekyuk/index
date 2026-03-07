import { Job } from 'bullmq';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { ProfileDatabaseAdapter, ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { ProfileGraphFactory } from '../lib/protocol/graphs/profile.graph';
import { searchUser } from '../lib/parallel/parallel';

/** BullMQ queue name for profile HyDE (ensure profile + HyDE) jobs. */
export const QUEUE_NAME = 'profile-hyde-queue';

/** Payload for ensure_profile_hyde job. */
export interface EnsureProfileHydeData {
  userId: string;
}

/** Payload for ghost.enrich jobs. */
export interface EnrichGhostData {
  userId: string;
}

/** Union of all job payloads accepted by the profile queue. */
export type ProfileJobPayload = EnsureProfileHydeData | EnrichGhostData;

/**
 * Optional dependencies for testing.
 */
export interface ProfileQueueDeps {
  invokeProfileWrite?: (userId: string) => Promise<void>;
  invokeEnrichGhost?: (userId: string) => Promise<void>;
}

/**
 * Profile HyDE queue: BullMQ queue plus worker and job handlers.
 *
 * Handles `ensure_profile_hyde`: invokes the profile graph in write mode so the user has
 * a profile and HyDE documents for discovery (index members can be found).
 *
 * Handles `ghost.enrich`: enriches ghost users with public data from Parallels API,
 * then runs the profile graph to generate profile + HyDE documents.
 *
 * @remarks
 * Workers are started only by the protocol server via {@link ProfileQueue.startWorker}.
 */
export class ProfileQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<ProfileJobPayload>(QUEUE_NAME);

  private readonly logger = log.job.from('ProfileHydeJob');
  private readonly queueLogger = log.queue.from('ProfileQueue');
  private readonly deps: ProfileQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<ProfileJobPayload>> | null = null;

  constructor(deps?: ProfileQueueDeps) {
    this.deps = deps;
  }

  /**
   * Enqueue a job to ensure profile and HyDE for a user (profile graph write mode).
   * @param data - userId
   * @returns The BullMQ job
   */
  addEnsureProfileHydeJob(data: { userId: string }): Promise<Job<ProfileJobPayload>> {
    return this.addJob('ensure_profile_hyde', data);
  }

  /**
   * Enqueue a job to enrich a ghost user with public data and generate their profile.
   * @param data - userId of the ghost user
   * @returns The BullMQ job
   */
  addEnrichGhostJob(data: { userId: string }): Promise<Job<ProfileJobPayload>> {
    return this.addJob('ghost.enrich', data, {
      jobId: `ghost.enrich.${data.userId}.${Date.now()}`,
    });
  }

  /**
   * Add a job to the profile HyDE queue.
   * @param name - Job type: `ensure_profile_hyde`
   * @param data - Payload for the job
   * @param options - Optional jobId and priority
   * @returns The BullMQ job
   */
  async addJob(
    name: 'ensure_profile_hyde' | 'ghost.enrich',
    data: ProfileJobPayload,
    options?: { jobId?: string; priority?: number }
  ): Promise<Job<ProfileJobPayload>> {
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
   * Run the job handler for a given job name and payload. Used by the worker and by tests with injected deps.
   * @param name - Job name (`ensure_profile_hyde`)
   * @param data - Job payload
   */
  async processJob(name: string, data: ProfileJobPayload): Promise<void> {
    switch (name) {
      case 'ensure_profile_hyde':
        await this.handleEnsureProfileHyde(data);
        break;
      case 'ghost.enrich':
        await this.handleEnrichGhost(data);
        break;
      default:
        this.queueLogger.warn(`[ProfileProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Start the BullMQ worker for this queue. Idempotent; call from the protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<ProfileJobPayload>) => {
      this.queueLogger.info(`[ProfileProcessor] Processing job ${job.id} (${job.name})`, {
        userId: (job.data as EnsureProfileHydeData).userId,
      });
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<ProfileJobPayload>(QUEUE_NAME, processor, { concurrency: 10 });
  }

  /**
   * Gracefully close the worker and queue connections.
   * Called during server shutdown to prevent stale workers.
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private async handleEnsureProfileHyde(data: EnsureProfileHydeData): Promise<void> {
    const { userId } = data;
    if (this.deps?.invokeProfileWrite) {
      await this.deps.invokeProfileWrite(userId);
      return;
    }
    try {
      await this.invokeProfileGraph(userId);
      this.logger.verbose('[ProfileHyde] Ensured profile HyDE for user', { userId });
    } catch (err) {
      this.logger.error('[ProfileHyde] Failed to ensure profile HyDE', { userId, error: err });
      throw err;
    }
  }

  private async handleEnrichGhost(data: EnrichGhostData): Promise<void> {
    const { userId } = data;
    if (this.deps?.invokeEnrichGhost) {
      await this.deps.invokeEnrichGhost(userId);
      return;
    }
    try {
      const chatDb = new ChatDatabaseAdapter();
      const user = await chatDb.getUser(userId);
      if (!user) {
        this.queueLogger.warn('[EnrichGhost] User not found, skipping', { userId });
        return;
      }

      this.queueLogger.info('[EnrichGhost] Starting enrichment', {
        userId,
        name: user.name,
        email: user.email,
        hasSocials: !!(user.socials && Object.keys(user.socials).length > 0),
      });

      // Search for public data via Parallels API and pass results to profile graph
      let enrichmentInput: string | undefined;
      try {
        const searchResult = await searchUser({ name: user.name, email: user.email });
        this.queueLogger.info('[EnrichGhost] Parallels search completed', {
          userId,
          resultCount: searchResult?.results?.length ?? 0,
        });

        if (searchResult?.results?.length) {
          const socials: Record<string, string | string[]> = {};
          const websites: string[] = [];
          const inputParts: string[] = [];

          for (const result of searchResult.results) {
            const url = result.url;
            if (url.includes('linkedin.com')) socials.linkedin = url;
            else if (url.includes('twitter.com') || url.includes('x.com')) socials.x = url;
            else if (url.includes('github.com')) socials.github = url;
            else websites.push(url);

            // Collect excerpts for profile generation input
            if (result.excerpts && result.excerpts.length > 0) {
              inputParts.push(`Source: ${result.title || result.url}\n${result.excerpts.join('\n')}`);
            }
          }
          if (websites.length > 0) socials.websites = websites;
          if (Object.keys(socials).length > 0) {
            await chatDb.updateUser(userId, {
              socials: socials as { x?: string; linkedin?: string; github?: string; websites?: string[] },
            });
          }

          if (inputParts.length > 0) {
            enrichmentInput = inputParts.join('\n\n');
          }
        }
      } catch (err) {
        this.queueLogger.warn('[EnrichGhost] Parallels search failed, running profile graph without enrichment', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Generate profile + HyDE — pass pre-fetched search results so graph skips redundant search
      this.queueLogger.info('[EnrichGhost] Invoking profile graph', { userId, hasEnrichmentInput: !!enrichmentInput });
      const result = await this.invokeProfileGraph(userId, enrichmentInput);
      this.queueLogger.info('[EnrichGhost] Profile graph completed', {
        userId,
        hasProfile: !!result.profile,
        hasError: !!result.error,
        error: result.error,
        needsUserInfo: result.needsUserInfo,
      });
    } catch (err) {
      this.queueLogger.error('[EnrichGhost] Failed to enrich ghost user', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private async invokeProfileGraph(userId: string, enrichmentInput?: string) {
    const database = new ProfileDatabaseAdapter();
    const embedder = new EmbedderAdapter();
    const scraper = new ScraperAdapter();
    const factory = new ProfileGraphFactory(database, embedder, scraper);
    const graph = factory.createGraph();
    return graph.invoke({ userId, operationMode: 'generate', enrichmentInput });
  }
}

/** Singleton profile HyDE queue instance. Use for adding jobs and starting the worker. */
export const profileQueue = new ProfileQueue();
