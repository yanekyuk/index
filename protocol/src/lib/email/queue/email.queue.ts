import { Queue, Job, QueueEvents } from 'bullmq';
import { getBullMQConnection } from '../../redis';
import { log } from '../../log';

export const EMAIL_QUEUE_NAME = 'email-processing-queue';

export interface EmailJobData {
    to: string | string[];
    subject: string;
    html: string;
    text: string;
}

export type EmailJob = Job<EmailJobData>;

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

export async function addEmailJob(data: EmailJobData, priority: number = 1): Promise<Job<EmailJobData>> {
    const job = await emailQueue.add('send_email', data, {
        priority: priority > 0 ? priority : undefined,
    });
    log.debug(`[EmailQueue] Job added with ID: ${job.id}`, { priority });
    return job;
}
