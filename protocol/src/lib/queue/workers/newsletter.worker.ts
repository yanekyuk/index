import { Worker } from 'bullmq';
import { NEWSLETTER_QUEUE_NAME } from '../newsletter.queue';
import { getRedisClient } from '../../redis';
import processor from '../newsletter.processor';

export class NewsletterWorker {
    private worker: Worker;
    private redis = getRedisClient();

    constructor() {
        // Use in-process worker to avoid TypeScript execution issues in child process
        this.worker = new Worker(NEWSLETTER_QUEUE_NAME, processor, {
            connection: {
                ...this.redis.options,
                maxRetriesPerRequest: null,
            },
            concurrency: 5, // Process 5 users concurrently (LLM calls are async)
            limiter: {
                max: 10,
                duration: 1000
            },
            lockDuration: 60000, // Increase lock duration for long LLM tasks (60s)
        });

        this.worker.on('failed', (job, err) => {
            console.error(`[NewsletterWorker] Job ${job?.id} failed:`, err);
        });

        this.worker.on('completed', (job) => {
            console.log(`[NewsletterWorker] Job ${job.id} completed`);
        });

        this.worker.on('error', (err) => {
            console.error(`[NewsletterWorker] Worker error:`, err);
        });
    }

    start() {
        if (this.worker.isPaused()) {
            this.worker.resume();
        }
        console.log('📰 Newsletter worker started');
    }

    async stop() {
        await this.worker.close();
        console.log('📰 Newsletter worker stopped');
    }
}

export const newsletterWorker = new NewsletterWorker();
