import { emailQueue, EmailJob } from './email.queue';
import { executeSendEmail } from '../transport.helper';

export class EmailQueueProcessor {
    private isRunning = false;
    private processingPromise: Promise<void> | null = null;
    private readonly RATE_LIMIT_MS = 500; // 2 requests per second
    private inFlight = 0;

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.processingPromise = this.processLoop();
        console.log('📧 Email queue processor started');
    }

    stop() {
        this.isRunning = false;
    }

    private async processLoop() {
        while (this.isRunning) {
            try {
                const job = await emailQueue.getNextJob();
                if (job) {
                    await this.processJob(job);
                    // Rate limiting: wait before processing next job
                    await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_MS));
                } else {
                    // Queue empty, wait a bit before checking again
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error) {
                console.error('Error in email processor loop:', error);
                // Wait a bit on error to avoid tight loop
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    private async processJob(job: EmailJob) {
        this.inFlight++;
        try {
            console.log(`Processing email job ${job.id} for ${job.data.to}`);
            await executeSendEmail(job.data);
        } catch (error) {
            console.error(`Failed to process email job ${job.id}:`, error);
            // Ideally we would have retry logic here, but for now we just log
        } finally {
            this.inFlight--;
        }
    }

    // Helper for testing to wait until queue is empty
    async waitForAll() {
        let size = await emailQueue.getQueueSize();
        while (size > 0 || this.inFlight > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
            size = await emailQueue.getQueueSize();
        }
    }
}

export const emailQueueProcessor = new EmailQueueProcessor();
