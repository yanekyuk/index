import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { log } from '../lib/log';
import type { NotificationJobData, NotificationPriority } from './notification.types';

import { processOpportunityNotification } from '../jobs/notification.job';

export const QUEUE_NAME = 'notification-queue';

export type { NotificationJobData, NotificationPriority } from './notification.types';

/**
 * Notification Queue.
*
* RESPONSIBILITIES:
* 1. `process_opportunity_notification`: Send alert for a new opportunity to a recipient.
*/
export const notificationQueue = QueueFactory.createQueue<NotificationJobData>(QUEUE_NAME);

const logger = log.queue.from("NotificationQueue");
/**
 * Processor function. Routes to notification job handler.
 */
async function notificationProcessor(job: Job<NotificationJobData>) {
  if (job.name === 'process_opportunity_notification') {
    await processOpportunityNotification(job.data);
  } else {
    logger.warn(`[NotificationProcessor] Unknown job name: ${job.name}`);
  }
}

export const notificationWorker = QueueFactory.createWorker<NotificationJobData>(
  QUEUE_NAME,
  notificationProcessor
);
export const notificationQueueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);

/**
 * Queue an opportunity notification for a recipient.
 *
 * @param opportunityId - Opportunity ID
 * @param recipientId - User ID to notify
 * @param priority - immediate (WebSocket), high (email), low (digest)
 * @returns The created Job instance
 */
export async function queueOpportunityNotification(
  opportunityId: string,
  recipientId: string,
  priority: NotificationPriority
): Promise<Job<NotificationJobData>> {
  // BullMQ: lower number = higher priority
  const priorityNum = priority === 'immediate' ? 0 : priority === 'high' ? 5 : 10;
  return notificationQueue.add(
    'process_opportunity_notification',
    { opportunityId, recipientId, priority },
    { priority: priorityNum }
  );
}
