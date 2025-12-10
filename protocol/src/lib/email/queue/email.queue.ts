import { Queue, Job } from 'bullmq';
import { getRedisClient } from '../../redis';

export const EMAIL_QUEUE_NAME = 'email-processing-queue';

export interface EmailJobData {
    to: string | string[];
    subject: string;
    html: string;
    text: string;
}

export type EmailJob = Job<EmailJobData>;

const redisClient = getRedisClient();

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
    connection: {
        ...redisClient.options,
        maxRetriesPerRequest: null,
    },
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

export async function addEmailJob(data: EmailJobData, priority: number = 1): Promise<void> {
    await emailQueue.add('send_email', data, {
        priority: priority > 0 ? priority : undefined,
    });
}
