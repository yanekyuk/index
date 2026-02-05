import { Worker } from 'bullmq';
import { EMAIL_QUEUE_NAME } from './email.queue';
import { getBullMQConnection } from '../../redis';
import processor from './email.processor';
import { log } from '../../log';

const logger = log.lib.from('[DEPRECATED] email.worker');

export class EmailWorker {
    private worker: Worker;

    constructor() {
        logger.info('Initializing worker for queue', { queue: EMAIL_QUEUE_NAME });
        
        // Use dedicated BullMQ connection options (no lazyConnect, maxRetriesPerRequest: null)
        // This ensures the Worker connects immediately and can receive jobs
        const bullmqConnection = getBullMQConnection();
        
        this.worker = new Worker(EMAIL_QUEUE_NAME, processor, {
            connection: bullmqConnection,
            concurrency: 1,
            limiter: {
                max: 2,
                duration: 1000
            }
        });

        this.worker.on('failed', (job, err) => {
            logger.error('Email job failed', { jobId: job?.id, error: err });
        });

        this.worker.on('active', (job) => {
            logger.info('Job is now ACTIVE', { jobId: job.id });
        });

        this.worker.on('completed', (job) => {
            if (job) {
                logger.info('Email job sent', { jobId: job.id, to: job.data.to });
            }
        });

        this.worker.on('stalled', (jobId) => {
            logger.warn('Job has STALLED', { jobId });
        });

        this.worker.on('drained', () => {
            logger.info('Queue is DRAINED');
        });

        this.worker.on('error', (err) => {
            logger.error('Worker error', { error: err });
        });

        this.worker.on('ready', () => {
            logger.info('Worker is READY and connected to Redis');
        });
    }

    start() {
        if (this.worker.isPaused()) {
            this.worker.resume();
        }
        logger.info('Email worker started');
    }

    async stop() {
        await this.worker.close();
        logger.info('Email worker stopped');
    }
}

export const emailWorker = new EmailWorker()
