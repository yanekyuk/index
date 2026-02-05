import { Queue, Worker, QueueEvents, Job, Processor, WorkerOptions, QueueOptions, JobsOptions } from 'bullmq';
import { getRedisClient } from '../redis';
import { log } from '../log';

const logger = log.lib.from("bullmq");
const redisClient = getRedisClient();

const SHARED_REDIS_OPTS = {
  ...redisClient.options,
  maxRetriesPerRequest: null,
};

const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: {
    age: 24 * 3600, // 1 day
    count: 1000,
  },
  removeOnFail: {
    age: 7 * 24 * 3600, // 7 days
    count: 1000,
  },
};

/**
 * QueueFactory
 * 
 * Central factory for creating standardized BullMQ components (Queues, Workers, Events).
 * 
 * PURPOSE:
 * - Enforces consistent Redis connection configuration (reusing the same connection settings).
 * - Applies standard default job options (retries, backoff, cleanup).
 * - Centralizes logging for queue initialization.
 * 
 * STANDARD DEFAULTS:
 * - Retries: 3 attempts with exponential backoff (1s delay).
 * - Cleanup: Removes completed jobs after 24h, failed after 7d.
 * - Concurrency: Default worker concurrency is 1 (sequential).
 */
export class QueueFactory {
  /**
   * Create a new Queue with standard configuration.
   * 
   * A "Queue" is the Producer side: used to add jobs.
   * 
   * @template T - The type of data payload for jobs in this queue.
   * @param name - Unique name of the queue (namespace).
   * @param options - Queue settings (overrides defaults).
   * @returns Configured BullMQ Queue instance.
   */
  static createQueue<T = any>(name: string, options?: Omit<QueueOptions, 'connection'>): Queue<T> {
    logger.info(`[QueueFactory] Initializing Queue: ${name}`);
    return new Queue<T>(name, {
      connection: SHARED_REDIS_OPTS,
      defaultJobOptions: DEFAULT_JOB_OPTS,
      ...options,
    });
  }

  /**
   * Create a new Worker for processing jobs.
   * 
   * A "Worker" is the Consumer side: defines the process function.
   * 
   * @template T - The type of data payload for jobs in this queue.
   * @param name - Must match the Queue name.
   * @param processor - The async function that handles the job.
   * @param options - Worker settings (concurrency, etc).
   * @returns Configured BullMQ Worker instance.
   */
  static createWorker<T = any>(name: string, processor: Processor<T>, options?: Omit<WorkerOptions, 'connection'>): Worker<T> {
    logger.info(`[QueueFactory] Initializing Worker: ${name}`);
    return new Worker<T>(name, processor, {
      connection: SHARED_REDIS_OPTS,
      concurrency: 1, // Default to sequential processing
      ...options,
    });
  }

  /**
   * Create QueueEvents listener.
   * 
   * Used for listening to global queue events (completed, failed, etc.) irrespective of the worker.
   * Useful for websockets or monitoring dashboards.
   * 
   * @param name - Must match the Queue name.
   * @returns QueueEvents instance.
   */
  static createQueueEvents(name: string): QueueEvents {
    return new QueueEvents(name, {
      connection: SHARED_REDIS_OPTS,
    });
  }
}
