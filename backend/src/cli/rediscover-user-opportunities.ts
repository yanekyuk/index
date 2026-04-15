#!/usr/bin/env node
/**
 * Rediscover opportunities for a specific user.
 *
 * Hard-deletes existing opportunities involving the user (the persist-node dedup
 * only skips status='draft', so any other existing opportunity blocks rediscovery)
 * then enqueues a fresh discovery job per active intent with a unique jobId
 * to bypass the 6h queue-level dedupe key.
 *
 * Usage:
 *   bun src/cli/rediscover-user-opportunities.ts <userId>
 *   bun run maintenance:rediscover-opportunities -- <userId>
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { and, eq, isNull, sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { intents, opportunities, users } from '../schemas/database.schema';
import { opportunityQueue } from '../queues/opportunity.queue';

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Usage: bun src/cli/rediscover-user-opportunities.ts <userId>');
    process.exit(1);
  }

  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (userRows.length === 0) {
    console.error(`[rediscover] User ${userId} not found (or soft-deleted).`);
    process.exit(1);
  }

  const deleted = await db
    .delete(opportunities)
    .where(sql`${opportunities.actors} @> ${JSON.stringify([{ userId }])}::jsonb`)
    .returning({ id: opportunities.id });
  console.log(`[rediscover] Deleted ${deleted.length} opportunity row(s) involving user ${userId}.`);

  const activeIntents = await db
    .select({ id: intents.id })
    .from(intents)
    .where(and(eq(intents.userId, userId), isNull(intents.archivedAt)));
  console.log(`[rediscover] Found ${activeIntents.length} active intent(s) for user ${userId}.`);

  const stamp = Date.now();
  let enqueued = 0;
  for (const { id: intentId } of activeIntents) {
    await opportunityQueue.addJob(
      { intentId, userId },
      { priority: 10, jobId: `manual-rediscovery-${userId}-${intentId}-${stamp}` },
    );
    enqueued++;
  }
  console.log(`[rediscover] Enqueued ${enqueued} discovery job(s).`);

  await opportunityQueue.queue.close();
  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error('[rediscover] Fatal error:', err);
  process.exit(1);
});
