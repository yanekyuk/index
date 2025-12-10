import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { queue } from './llm-queue';
import { emailQueue } from '../email/queue/email.queue';

export const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
    queues: [
        new BullMQAdapter(queue),
        new BullMQAdapter(emailQueue),
    ],
    serverAdapter: serverAdapter,
});

export const router = serverAdapter.getRouter();
