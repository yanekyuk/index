import { Queue, Job } from 'bullmq';
import { getRedisClient } from '../redis';

export const NEWSLETTER_QUEUE_NAME = 'weekly-newsletter-queue';

export interface NewsletterCandidate {
    userId: string;
    userName: string; // Added for email template
    userRole?: string; // Added for email template
    stakeId: string;
    reasoning?: string;
}

export interface NewsletterJobData {
    recipientId: string;
    candidates: NewsletterCandidate[];
    force?: boolean; // To bypass time checks if needed within worker (though checks are mostly doing in dispatch)
}

export type NewsletterJob = Job<NewsletterJobData>;

export interface WeeklyCycleJobData {
    timestamp: number; // Date.now()
    force?: boolean;
    daysSince?: number;
}

const redisClient = getRedisClient();

export const newsletterQueue = new Queue<NewsletterJobData | WeeklyCycleJobData>(NEWSLETTER_QUEUE_NAME, {
    connection: {
        ...redisClient.options,
        maxRetriesPerRequest: null,
    },
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: {
            age: 24 * 3600,
            count: 1000,
        },
        removeOnFail: {
            age: 7 * 24 * 3600,
            count: 1000,
        },
    }
});

export async function addNewsletterJob(data: NewsletterJobData, priority: number = 1): Promise<void> {
    await newsletterQueue.add('process_newsletter', data, {
        priority: priority > 0 ? priority : undefined,
        jobId: `newsletter-${data.recipientId}-${Date.now()}` // Deduplication / Idempotency
    });
}


export async function addWeeklyCycleJob(data: WeeklyCycleJobData): Promise<void> {
    try {
        await newsletterQueue.add('start_weekly_cycle', data, {
            priority: 2, // Higher priority than individual emails so it generates work quickly
            removeOnComplete: true
        });
    } catch (e) {
        console.error('Failed to add weekly cycle job:', e);
    }
}
