import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { intentQueue } from './intent.queue';
import { newsletterQueue } from './newsletter.queue';
import { opportunityQueue } from './opportunity.queue';
import { emailQueue } from '../lib/email/queue/email.queue';

export const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/');

/**
 * BullMQ Dashboard Configuration.
 * 
 * Sets up the Bull Board UI to monitor all active queues in the system.
 * 
 * QUEUES MONITORED:
 * - Intent Queue: Intent processing and generation.
 * - Newsletter Queue: Weekly digest emails.
 * - Opportunity Queue: Background matching cycles.
 * - Email Queue: Transactional emails.
 * 
 * ACCESS:
 * Mounted at `/admin/queues` (protected by Basic Auth in `server.ts`).
 */
createBullBoard({
  queues: [
    new BullMQAdapter(intentQueue),
    new BullMQAdapter(newsletterQueue),
    new BullMQAdapter(opportunityQueue),
    new BullMQAdapter(emailQueue),
  ],
  serverAdapter: serverAdapter,
});

export const router = serverAdapter.getRouter();
