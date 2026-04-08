#!/usr/bin/env node
/**
 * Expire stale opportunities: transitions opportunities whose expiresAt <= now
 * from non-terminal statuses to 'expired' (skips accepted/rejected/expired).
 *
 * Usage: bun run maintenance:expire-opportunities
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import db, { closeDb } from '../lib/drizzle/drizzle';
import { opportunities } from '../schemas/database.schema';
import { and, isNotNull, lte, notInArray } from 'drizzle-orm';

async function expireStaleOpportunities(): Promise<number> {
  const now = new Date();
  const updated = await db
    .update(opportunities)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        isNotNull(opportunities.expiresAt),
        lte(opportunities.expiresAt, now),
        notInArray(opportunities.status, ['accepted', 'rejected', 'expired'])
      )
    )
    .returning({ id: opportunities.id });
  return updated.length;
}

async function main() {
  console.log('[expire-opportunities] Starting...');
  const count = await expireStaleOpportunities();
  console.log(`[expire-opportunities] Expired ${count} opportunit${count === 1 ? 'y' : 'ies'}.`);
  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error('[expire-opportunities] Fatal error:', err);
  process.exit(1);
});
