import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { log } from '../lib/log';
import { opportunityService } from '../services/opportunity.service';

export const QUEUE_NAME = 'opportunity-processing-queue';

/**
 * Job payload for the Opportunity Queue.
 */
export interface OpportunityJobData {
  timestamp: number;
  force: boolean;
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
 * Routes jobs to the appropriate handler in OpportunityService.
 */
async function opportunityProcessor(job: Job) {
  if (job.name === 'process_opportunities') {
    await opportunityService.runOpportunityFinderCycle();
  } else {
    log.warn(`[OpportunityProcessor] Unknown job name: ${job.name}`);
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
