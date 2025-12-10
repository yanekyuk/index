import { Worker } from 'bullmq';
import { NEWSLETTER_QUEUE_NAME } from '../newsletter.queue';
import { getBullMQConnection } from '../../redis';
import processor from '../newsletter.processor';

export class NewsletterWorker {
    private worker: Worker;

    constructor() {
        console.log('[NewsletterWorker] Initializing worker for queue:', NEWSLETTER_QUEUE_NAME);
        
        // Use dedicated BullMQ connection options (no lazyConnect, maxRetriesPerRequest: null)
        // This ensures the Worker connects immediately and can receive jobs
        const bullmqConnection = getBullMQConnection();
        
        this.worker = new Worker(NEWSLETTER_QUEUE_NAME, processor, {
            connection: bullmqConnection,
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

        this.worker.on('ready', () => {
            console.log('[NewsletterWorker] Worker is READY and connected to Redis');
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

export const newsletterWorker = new NewsletterWorker()
