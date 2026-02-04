import cron from 'node-cron';
import { addJob as addJobDefault } from '../queues/opportunity.queue';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { log } from '../lib/log';

const database = new ChatDatabaseAdapter();

export type OpportunityJobDeps = {
  database?: Pick<ChatDatabaseAdapter, 'expireStaleOpportunities'>;
  addJob?: typeof addJobDefault;
};

export async function runOpportunityFinderCycle(deps?: OpportunityJobDeps): Promise<void> {
  const enqueue = deps?.addJob ?? addJobDefault;
  log.info('🔄 [OpportunityJob] Triggering Opportunity Finder Queue...');
  await enqueue('process_opportunities', {
    timestamp: Date.now(),
    force: false,
  });
  log.info('✅ [OpportunityJob] Job enqueued.');
}

/**
 * Cron: Set status to expired for opportunities with expires_at <= now.
 */
export async function expireStaleOpportunities(deps?: OpportunityJobDeps): Promise<number> {
  const db = deps?.database ?? database;
  log.info('[OpportunityJob:Expire] Running expire-stale-opportunities');
  const count = await db.expireStaleOpportunities();
  log.info(`[OpportunityJob:Expire] Expired ${count} opportunities`);
  return count;
}

/**
 * Called when an intent is created. Enqueues opportunity finder cycle.
 */
export async function onIntentCreated(_intentId: string, deps?: OpportunityJobDeps): Promise<void> {
  const enqueue = deps?.addJob ?? addJobDefault;
  await enqueue('process_opportunities', { timestamp: Date.now(), force: false }, 5);
}

/**
 * Called when an intent is updated. Enqueues opportunity re-evaluation.
 */
export async function onIntentUpdated(_intentId: string, deps?: OpportunityJobDeps): Promise<void> {
  const enqueue = deps?.addJob ?? addJobDefault;
  await enqueue('process_opportunities', { timestamp: Date.now(), force: false }, 5);
}

export function initOpportunityFinderJob(): void {
  cron.schedule('58 14 * * *', () => {
    runOpportunityFinderCycle();
  });
  log.info('📅 [OpportunityJob] Opportunity Finder job scheduled (Daily at 14:58)');

  cron.schedule('0 2 * * *', () => {
    expireStaleOpportunities().catch((err) =>
      log.error('[OpportunityJob:Expire] Cron failed', { error: err })
    );
  });
  log.info('📅 [OpportunityJob] Expire-stale-opportunities scheduled (Daily at 02:00)');
}
