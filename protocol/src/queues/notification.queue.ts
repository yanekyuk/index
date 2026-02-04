import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { log } from '../lib/log';

export const QUEUE_NAME = 'notification-queue';

/**
 * Priority for opportunity notifications.
 * - immediate: WebSocket broadcast (real-time)
 * - high: Email via Resend
 * - low: Aggregate for weekly digest (no immediate email)
 */
export type NotificationPriority = 'immediate' | 'high' | 'low';

/**
 * Job payload for opportunity notification.
 */
export interface NotificationJobData {
  opportunityId: string;
  recipientId: string;
  priority: NotificationPriority;
}

/**
 * Notification Queue.
 *
 * RESPONSIBILITIES:
 * 1. `process_opportunity_notification`: Send alert for a new opportunity to a recipient.
 */
export const notificationQueue = QueueFactory.createQueue<NotificationJobData>(QUEUE_NAME);

/**
 * Processor function. Routes to notification job handler.
 */
async function notificationProcessor(job: Job<NotificationJobData>) {
  if (job.name === 'process_opportunity_notification') {
    const { processOpportunityNotification } = await import('../jobs/notification.job');
    await processOpportunityNotification(job.data);
  } else {
    log.warn(`[NotificationProcessor] Unknown job name: ${job.name}`);
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
  const priorityNum = priority === 'immediate' ? 10 : priority === 'high' ? 5 : 1;
  return notificationQueue.add(
    'process_opportunity_notification',
    { opportunityId, recipientId, priority },
    { priority: priorityNum }
  );
}
