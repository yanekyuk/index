import { Job } from 'bullmq';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { ProfileDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { ProfileGraphFactory } from '../lib/protocol/graphs/profile.graph';

/** BullMQ queue name for profile HyDE (ensure profile + HyDE) jobs. */
export const QUEUE_NAME = 'profile-hyde-queue';

/** Payload for ensure_profile_hyde job. */
export interface EnsureProfileHydeData {
  userId: string;
}

/** Union of all job payloads accepted by the profile queue. */
export type ProfileJobPayload = EnsureProfileHydeData;

/**
 * Optional dependencies for testing. Use invokeProfileWrite to stub the profile-write handler.
 */
export interface ProfileQueueDeps {
  invokeProfileWrite?: (userId: string) => Promise<void>;
}

/**
 * Profile HyDE queue: BullMQ queue plus worker and job handlers.
 *
 * Handles `ensure_profile_hyde`: invokes the profile graph in write mode so the user has
 * a profile and HyDE documents for discovery (index members can be found).
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
   * Add a job to the profile HyDE queue.
   * @param name - Job type: `ensure_profile_hyde`
   * @param data - Payload for the job
   * @param options - Optional jobId and priority
   * @returns The BullMQ job
   */
  async addJob(
    name: 'ensure_profile_hyde',
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
      this.queueLogger.info(`[ProfileProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<ProfileJobPayload>(QUEUE_NAME, processor);
  }

  private async handleEnsureProfileHyde(data: EnsureProfileHydeData): Promise<void> {
    const { userId } = data;
    if (this.deps?.invokeProfileWrite) {
      await this.deps.invokeProfileWrite(userId);
      return;
    }
    try {
      const database = new ProfileDatabaseAdapter();
      const embedder = new EmbedderAdapter();
      const scraper = new ScraperAdapter();
      const factory = new ProfileGraphFactory(database, embedder, scraper);
      const graph = factory.createGraph();
      await graph.invoke({ userId, operationMode: 'write' });
      this.logger.info('[ProfileHyde] Ensured profile HyDE for user', { userId });
    } catch (err) {
      this.logger.error('[ProfileHyde] Failed to ensure profile HyDE', { userId, error: err });
      throw err;
    }
  }
}

/** Singleton profile HyDE queue instance. Use for adding jobs and starting the worker. */
export const profileQueue = new ProfileQueue();
