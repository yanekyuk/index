import { Worker } from 'bullmq';
import { EMAIL_QUEUE_NAME } from './email.queue';
import { getRedisClient } from '../../redis';
import processor from './email.processor';

export class EmailWorker {
    private worker: Worker;
    private redis = getRedisClient();

    constructor() {
        console.log('[EmailWorker] Initializing worker for queue:', EMAIL_QUEUE_NAME);
        // Use in-process worker to avoid TypeScript execution issues in child process
        this.worker = new Worker(EMAIL_QUEUE_NAME, processor, {
            connection: {
                ...this.redis.options,
                maxRetriesPerRequest: null,
            },
            concurrency: 1,
            limiter: {
                max: 2,
                duration: 1000
            }
        });

        this.worker.on('failed', (job, err) => {
            console.error(`[EmailWorker] Email job ${job?.id} failed:`, err);
        });

        this.worker.on('active', (job) => {
            console.log(`[EmailWorker] Job ${job.id} is now ACTIVE`);
        });

        this.worker.on('completed', (job) => {
            if (job) {
                console.log(`[EmailWorker] Email job ${job.id} sent to ${job.data.to}`);
            }
        });

        this.worker.on('stalled', (jobId) => {
            console.warn(`[EmailWorker] Job ${jobId} has STALLED`);
        });

        this.worker.on('drained', () => {
            console.log('[EmailWorker] Queue is DRAINED');
        });

        this.worker.on('error', (err) => {
            console.error(`[EmailWorker] Worker error:`, err);
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
}

export const emailWorker = new EmailWorker();
