import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { log } from '../lib/log';
import { handleGenerateHyde, handleDeleteHyde } from '../jobs/intent-hyde.job';
import type { IntentHydeJobData } from '../jobs/intent-hyde.job';

export const QUEUE_NAME = 'intent-hyde-queue';

const logger = log.queue.from('IntentHydeQueue');

/** Payload for delete_hyde (intentId only). */
export interface IntentHydeDeleteData {
  intentId: string;
}

export type IntentHydeJobPayload = IntentHydeJobData | IntentHydeDeleteData;

/**
 * Intent HyDE Queue.
 *
 * RESPONSIBILITIES:
 * 1. generate_hyde: On intent create/update, generate HyDE documents (mirror + reciprocal) and persist to hyde_documents.
 * 2. delete_hyde: On intent archive, delete HyDE documents for that intent.
 */
export const intentHydeQueue = QueueFactory.createQueue<IntentHydeJobPayload>(QUEUE_NAME);

async function intentHydeProcessor(job: Job<IntentHydeJobPayload>) {
  logger.info(`Processing job ${job.id} (${job.name})`);
  switch (job.name) {
    case 'generate_hyde':
      await handleGenerateHyde(job.data as IntentHydeJobData);
      break;
    case 'delete_hyde':
      await handleDeleteHyde(job.data as IntentHydeDeleteData);
      break;
    default:
      logger.warn(`Unknown job name: ${job.name}`);
  }
}

export const intentHydeWorker = QueueFactory.createWorker<IntentHydeJobPayload>(
  QUEUE_NAME,
  intentHydeProcessor
);
export const intentHydeQueueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);

/**
 * Add a job to the Intent HyDE queue.
 *
 * @param name - 'generate_hyde' | 'delete_hyde'
 * @param data - Payload (intentId, userId for generate; intentId for delete)
 * @param options - Optional jobId for idempotency (e.g. intent-hyde:${intentId}:${updatedAt})
 */
export async function addIntentHydeJob(
  name: 'generate_hyde' | 'delete_hyde',
  data: IntentHydeJobData | IntentHydeDeleteData,
  options?: { jobId?: string }
): Promise<Job<IntentHydeJobPayload>> {
  return intentHydeQueue.add(name, data as IntentHydeJobPayload, {
    jobId: options?.jobId,
  });
}
