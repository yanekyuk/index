import { Worker, Job } from 'bullmq';
import { EMAIL_QUEUE_NAME, EmailJobData } from './email.queue';
import { executeSendEmail } from '../transport.helper';
import { getRedisClient } from '../../redis';

export class EmailQueueProcessor {
    private worker: Worker;
    private redis = getRedisClient();

    constructor() {
        this.worker = new Worker(EMAIL_QUEUE_NAME, this.processJob.bind(this), {
            connection: {
                ...this.redis.options,
                maxRetriesPerRequest: null,
            },
            concurrency: 1, // Process emails one by one or small concurrency to respect rate limits
            limiter: {
                max: 2,       // 2 emails
                duration: 1000 // per second (matching previous 500ms rate limit)
            }
        });

        this.worker.on('failed', (job, err) => {
            console.error(`[EmailWorker] Email job ${job?.id} failed:`, err);
        });

        this.worker.on('completed', (job) => {
            console.log(`[EmailWorker] Email job ${job.id} sent to ${job.data.to}`);
        });
    }

    start() {
        if (this.worker.isPaused()) {
            this.worker.resume();
        }
        console.log('📧 Email worker started');
    }

    async stop() {
        await this.worker.close();
        console.log('📧 Email worker stopped');
    }

    private async processJob(job: Job<EmailJobData>) {
        // console.log(`Processing email job ${job.id} for ${job.data.to}`);
        try {
            await executeSendEmail(job.data);
        } catch (error) {
            console.error(`[EmailWorker] Failed to process job ${job.id}:`, error);
            throw error; // Re-throw to trigger BullMQ retry
        }
    }

    // Helper for testing - deprecated/noop for BullMQ in this simple adapter
    // We rely on BullMQ to drain.
    async waitForAll() {
        // No-op or implement checkEmpty if critical for tests
    }
}

export const emailQueueProcessor = new EmailQueueProcessor();
