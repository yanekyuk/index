import { Queue, Job, QueueEvents } from 'bullmq';
import { getBullMQConnection } from '../../redis';
import { log } from '../../log';
const logger = log.lib.from("lib/email/queue/email.queue.ts");

export const EMAIL_QUEUE_NAME = 'email-processing-queue';

export interface EmailJobData {
    to: string | string[];
    subject: string;
    html: string;
    text: string;
    /** Optional Resend headers (e.g. List-Unsubscribe). */
    headers?: Record<string, string>;
}

export type EmailJob = Job<EmailJobData>;

export interface AddEmailJobOptions {
  priority?: number;
  /** When set, BullMQ uses this as job id (deduplicates pending jobs with same id). */
  jobId?: string;
}

// Use dedicated BullMQ connection options (no lazyConnect, maxRetriesPerRequest: null)
const bullmqConnection = getBullMQConnection();

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
    connection: bullmqConnection,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: {
            age: 24 * 3600,
            count: 1000,
        },
        removeOnFail: {
            age: 7 * 24 * 3600, // Keep failed emails longer
            count: 1000,
        },
    }
});

// QueueEvents instance for waiting on job completion
export const emailQueueEvents = new QueueEvents(EMAIL_QUEUE_NAME, {
    connection: bullmqConnection,
});

export async function addEmailJob(
    data: EmailJobData,
    optionsOrPriority?: number | AddEmailJobOptions
): Promise<Job<EmailJobData>> {
    const options: AddEmailJobOptions =
        optionsOrPriority === undefined
            ? {}
            : typeof optionsOrPriority === 'number'
              ? { priority: optionsOrPriority }
              : optionsOrPriority;
    const priority = options.priority ?? 1;
    const job = await emailQueue.add('send_email', data, {
        priority: priority > 0 ? priority : undefined,
        jobId: options.jobId,
    });
    logger.debug(`[EmailQueue] Job added with ID: ${job.id}`, { priority, jobId: options.jobId });
    return job;
}
