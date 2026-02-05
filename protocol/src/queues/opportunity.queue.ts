import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { createOpportunityQueueAdapter } from '../adapters/queue.adapter';
import { log } from '../lib/log';
import { opportunityService } from '../services/opportunity.service';
import { runIntentOpportunityGraph } from '../jobs/opportunity.job';

const logger = log.queue.from("OpportunityQueue");

export const QUEUE_NAME = 'opportunity-processing-queue';

/**
 * Job payload for the Opportunity Queue.
 * - process_opportunities: timestamp, force (legacy full cycle).
 * - process_intent_opportunities: intentId, userId (new graph per intent).
*/
export interface OpportunityJobData extends Record<string, unknown> {
  timestamp?: number;
  force?: boolean;
  intentId?: string;
  userId?: string;
}

/**
 * Opportunity Finder Queue.
 * 
 * RESPONSIBILITIES:
 * 1. `process_opportunities`: Runs the "Super Connector" cycle.
 * 
 * PERIODICITY:
 * - Runs every hour (or manually triggered).
 * - Delegates to OpportunityService for the full matchmaking logic.
 */
export const opportunityQueue = QueueFactory.createQueue<OpportunityJobData>(QUEUE_NAME);

/**
 * Processor Function
 * Routes jobs to the appropriate handler.
 */
async function opportunityProcessor(job: Job<OpportunityJobData>) {
  if (job.name === 'process_opportunities') {
    await opportunityService.runOpportunityFinderCycle();
  } else if (job.name === 'process_intent_opportunities') {
    const { intentId, userId } = job.data ?? {};
    if (intentId && userId) {
      await runIntentOpportunityGraph(intentId, userId);
    } else {
      logger.warn('[OpportunityProcessor] process_intent_opportunities missing intentId or userId', job.data);
    }
  } else {
    logger.warn(`[OpportunityProcessor] Unknown job name: ${job.name}`);
  }
}

export const opportunityWorker = QueueFactory.createWorker<OpportunityJobData>(QUEUE_NAME, opportunityProcessor);
export const queueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);

/**
 * Add a job to the Opportunity Queue.
 *
 * @param name - The name of the job ('process_opportunities').
 * @param data - The payload for the job.
 * @param priority - Optional priority level (higher number = higher priority).
 * @returns The created Job instance.
 */
export async function addJob(
  name: string,
  data: OpportunityJobData,
  priority: number = 0
): Promise<Job<OpportunityJobData>> {
  return opportunityQueue.add(name, data, {
    priority: priority > 0 ? priority : undefined,
  });
}

/** Adapter implementing OpportunityQueue; use for DI or when depending on the adapter contract. */
export const opportunityQueueAdapter = createOpportunityQueueAdapter(opportunityQueue);
