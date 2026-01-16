import cron from 'node-cron';
import { addJob } from '../queues/opportunity.queue';
import { log } from '../lib/log';

export async function runOpportunityFinderCycle() {
  log.info('🔄 [OpportunityJob] Triggering Opportunity Finder Queue...');
  await addJob('process_opportunities', {
    timestamp: Date.now(),
    force: false // Default
  });
  log.info('✅ [OpportunityJob] Job enqueued.');
}

// Schedule Job
export const initOpportunityFinderJob = () => {
  // Run every day at 2:54 PM
  cron.schedule('58 14 * * *', () => {
    runOpportunityFinderCycle();
  });
  log.info('📅 [OpportunityJob] Opportunity Finder job scheduled (Daily at 6:00 AM)');
};
