import { Job } from 'bullmq';
import { EmailJobData } from './email.queue';
import { executeSendEmail } from '../transport.helper';
import { log } from '../../log';

/**
 * Sandboxed processor for Email Queue
 */
export default async function processor(job: Job<EmailJobData>) {
    log.debug(`[EmailProcessor] Processing job ${job.id}`, {
        to: job.data.to,
        subject: job.data.subject,
    });
    try {
        const result = await executeSendEmail(job.data);
        return result; // Return result so it's available via waitUntilFinished
    } catch (error) {
        log.error(`[EmailProcessor] Failed to process job ${job.id}`, {
            error: error instanceof Error ? error.message : String(error),
        });
        throw error; // Re-throw to trigger BullMQ retry
    }
}
