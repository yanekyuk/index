import { Job } from 'bullmq';
import { EmailJobData } from './email.queue';
import { executeSendEmail } from '../transport.helper';

/**
 * Sandboxed processor for Email Queue
 */
export default async function processor(job: Job<EmailJobData>) {
    console.log(`[EmailWorker] Processing email job ${job.id} for ${job.data.to}`);
    try {
        await executeSendEmail(job.data);
    } catch (error) {
        console.error(`[EmailWorker] Failed to process job ${job.id}:`, error);
        throw error; // Re-throw to trigger BullMQ retry
    }
}
