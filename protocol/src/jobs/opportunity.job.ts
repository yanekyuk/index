import cron from 'node-cron';
import { addJob as addJobDefault } from '../queues/opportunity.queue';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import type { OpportunityGraphDatabase, HydeGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import type { HydeCache } from '../lib/protocol/interfaces/cache.interface';
import { OpportunityGraph } from '../lib/protocol/graphs/opportunity/opportunity.graph';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde/hyde.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde/hyde.generator';
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
 * Run the new OpportunityGraph for a single intent (HyDE + search + evaluate + persist to opportunities table).
 * Used by the process_intent_opportunities queue job.
 */
export async function runIntentOpportunityGraph(
  intentId: string,
  userId: string,
  deps?: { database?: ChatDatabaseAdapter }
): Promise<void> {
  const db = deps?.database ?? new ChatDatabaseAdapter();
  const embedder: Embedder = new EmbedderAdapter();
  const cache: HydeCache = new RedisCacheAdapter();
  const generator = new HydeGenerator();
  const hydeGraph = new HydeGraphFactory(
    db as unknown as HydeGraphDatabase,
    embedder,
    cache,
    generator
  ).createGraph();
  const opportunityGraph = new OpportunityGraph(
    db as unknown as OpportunityGraphDatabase,
    embedder,
    cache,
    hydeGraph
  );
  const compiled = opportunityGraph.compile();

  const indexScope = await db.getIndexMemberships(userId).then((m) => m.map((x) => x.indexId));
  if (indexScope.length === 0) {
    log.info('[OpportunityJob] runIntentOpportunityGraph: user has no index memberships, skipping', {
      intentId,
      userId,
    });
    return;
  }

  const intent = await db.getIntentForIndexing(intentId);
  const sourceText = intent?.payload ?? '';
  if (!sourceText) {
    log.warn('[OpportunityJob] runIntentOpportunityGraph: intent not found or empty payload', {
      intentId,
      userId,
    });
    return;
  }

  try {
    await compiled.invoke({
      sourceUserId: userId,
      intentId,
      sourceText,
      indexScope,
      options: {},
    });
    log.info('[OpportunityJob] runIntentOpportunityGraph completed', { intentId, userId });
  } catch (err) {
    log.error('[OpportunityJob] runIntentOpportunityGraph failed', { intentId, userId, error: err });
    throw err;
  }
}

/**
 * Called when an intent is created. Enqueues legacy cycle and intent-scoped opportunity graph.
 */
export async function onIntentCreated(
  intentId: string,
  deps?: OpportunityJobDeps & { userId?: string }
): Promise<void> {
  const enqueue = deps?.addJob ?? addJobDefault;
  const userId = deps?.userId;
  await enqueue('process_opportunities', { timestamp: Date.now(), force: false }, 5);
  if (userId) {
    await enqueue('process_intent_opportunities', { intentId, userId }, 6);
  }
}

/**
 * Called when an intent is updated. Enqueues opportunity re-evaluation.
 */
export async function onIntentUpdated(
  intentId: string,
  deps?: OpportunityJobDeps & { userId?: string }
): Promise<void> {
  const enqueue = deps?.addJob ?? addJobDefault;
  const userId = deps?.userId;
  await enqueue('process_opportunities', { timestamp: Date.now(), force: false }, 5);
  if (userId) {
    await enqueue('process_intent_opportunities', { intentId, userId }, 6);
  }
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
