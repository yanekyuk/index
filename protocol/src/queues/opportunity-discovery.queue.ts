import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { log } from '../lib/log';
import { handleDiscoverOpportunities } from '../jobs/opportunity-discovery.job';
import type { OpportunityDiscoveryJobData } from '../jobs/opportunity-discovery.job';

export const QUEUE_NAME = 'opportunity-discovery-queue';

const logger = log.queue.from('OpportunityDiscoveryQueue');

/**
 * Opportunity Discovery Queue.
 *
 * RESPONSIBILITIES:
 * 1. discover_opportunities: After intent HyDE is generated, run opportunity discovery and persist latent opportunities.
 */
export const opportunityDiscoveryQueue = QueueFactory.createQueue<OpportunityDiscoveryJobData>(QUEUE_NAME);

async function opportunityDiscoveryProcessor(job: Job<OpportunityDiscoveryJobData>) {
  logger.info(`Processing job ${job.id} (${job.name})`);
  if (job.name === 'discover_opportunities') {
    await handleDiscoverOpportunities(job.data);
  } else {
    logger.warn(`Unknown job name: ${job.name}`);
  }
}

export const opportunityDiscoveryWorker = QueueFactory.createWorker<OpportunityDiscoveryJobData>(
  QUEUE_NAME,
  opportunityDiscoveryProcessor
);
export const opportunityDiscoveryQueueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);

/**
 * Add a discovery job (e.g. after HyDE generation for an intent).
 *
 * @param data - intentId, userId, optional indexIds
 * @param options - optional jobId for idempotency (e.g. opp-discovery:${intentId}:${updatedAt})
 */
export async function addOpportunityDiscoveryJob(
  data: OpportunityDiscoveryJobData,
  options?: { jobId?: string }
): Promise<Job<OpportunityDiscoveryJobData>> {
  const initialDelayMs = 1000;

  return opportunityDiscoveryQueue.add('discover_opportunities', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: initialDelayMs },
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: { age: 24 * 60 * 60 },
    ...options,
    jobId: options?.jobId,
  });
}
