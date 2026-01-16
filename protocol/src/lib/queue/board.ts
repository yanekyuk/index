import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { queue } from './llm-queue';
import { newsletterQueue } from '../../queues/newsletter.queue';
import { emailQueue } from '../email/queue/email.queue';

export const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/');

createBullBoard({
    queues: [
        new BullMQAdapter(queue),
        new BullMQAdapter(emailQueue),
        new BullMQAdapter(newsletterQueue),
    ],
    serverAdapter: serverAdapter,
});

export const router = serverAdapter.getRouter();
