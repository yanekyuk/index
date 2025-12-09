import { PriorityQueue, QueueJob } from '../../queue';

export interface EmailJobData {
    to: string | string[];
    subject: string;
    html: string;
    text: string;
}

export type EmailJob = QueueJob<EmailJobData>;

export const emailQueue = new PriorityQueue<EmailJobData>('email_queue');

export async function addEmailJob(data: EmailJobData, priority: number = 1): Promise<void> {
    await emailQueue.addJob({
        action: 'send_email',
        priority,
        data
    });
}
