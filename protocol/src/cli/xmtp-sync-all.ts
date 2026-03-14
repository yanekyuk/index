#!/usr/bin/env node
/**
 * CLI: Sync XMTP history for all users with an XMTP inbox.
 *
 * Usage: bun run maintenance:xmtp-sync-all [--limit=N] [--wait=S]
 *
 * Options:
 *   --limit=N  Process only N users (default: all)
 *   --wait=S   Wait S seconds for history sync from other devices (default: 0)
 *
 * If --wait is provided, the CLI will:
 *   1. Send sync requests to other online devices
 *   2. Wait for the specified time
 *   3. Sync conversations and messages
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { isNotNull } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { users } from '../schemas/database.schema';
import { MessagingAdapter, type MessagingAdapterConfig } from '../adapters/messaging.adapter';
import { MessagingDatabaseAdapter } from '../adapters/database.adapter';
import type { XmtpEnv } from '../lib/xmtp';

function parseLimit(): number | null {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  if (limitArg) {
    const val = parseInt(limitArg.split('=')[1], 10);
    if (!Number.isNaN(val) && val > 0) return val;
  }
  return null;
}

function parseWait(): number {
  const args = process.argv.slice(2);
  const waitArg = args.find((a) => a.startsWith('--wait='));
  if (waitArg) {
    const val = parseInt(waitArg.split('=')[1], 10);
    if (!Number.isNaN(val) && val > 0) return val;
  }
  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getUsersWithXmtp(limit: number | null): Promise<{ id: string; name: string }[]> {
  let query = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(isNotNull(users.xmtpInboxId))
    .$dynamic();

  if (limit) {
    query = query.limit(limit);
  }

  return query;
}

async function main(): Promise<void> {
  const limit = parseLimit();
  const waitSeconds = parseWait();

  const walletMasterKey = process.env.WALLET_ENCRYPTION_KEY;
  if (!walletMasterKey) {
    console.error('WALLET_ENCRYPTION_KEY is required');
    process.exit(1);
  }

  const xmtpEnv = (process.env.XMTP_ENV as XmtpEnv) || 'dev';
  const xmtpDbDir = process.env.XMTP_DB_DIR || path.join(process.cwd(), '.xmtp');

  const masterKey = Buffer.from(walletMasterKey, 'hex');

  const config: MessagingAdapterConfig = {
    xmtpEnv,
    xmtpDbDir,
    walletMasterKey: masterKey,
  };

  const store = new MessagingDatabaseAdapter(masterKey);
  const adapter = new MessagingAdapter(store, config);

  const userList = await getUsersWithXmtp(limit);

  if (userList.length === 0) {
    console.log('No users with XMTP inbox found.');
    return;
  }

  console.log(`Syncing XMTP history for ${userList.length} users...`);
  if (waitSeconds > 0) {
    console.log(`Will wait ${waitSeconds}s for history sync from other devices.\n`);
    console.log('Make sure other devices (e.g. xmtp.chat) are open and logged in!\n');
  }

  let synced = 0;
  let failed = 0;

  for (const user of userList) {
    try {
      const client = await adapter.getUserClient(user.id);
      if (!client) {
        console.log(`  [SKIP] ${user.name} (${user.id}) - no client`);
        continue;
      }

      // Initial sync to get current state
      await client.conversations.syncAll();

      if (waitSeconds > 0) {
        // Request history from other online devices
        console.log(`  [REQUESTING] ${user.name} - sending sync request...`);
        try {
          await client.sendSyncRequest();
        } catch {
          // Ignore - may not have other devices
        }

        // Wait for history to arrive
        console.log(`  [WAITING] ${user.name} - waiting ${waitSeconds}s for history...`);
        await sleep(waitSeconds * 1000);

        // Sync again to pull in any history that arrived
        await client.conversations.syncAll();
        
        // Also sync each conversation's messages
        const convos = await client.conversations.list();
        for (const convo of convos) {
          await convo.sync();
        }
      }

      synced++;
      console.log(`  [OK] ${user.name} (${user.id})`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [FAIL] ${user.name} (${user.id}) - ${msg}`);
    }
  }

  console.log(`\nDone. Synced: ${synced}, Failed: ${failed}`);
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('xmtp-sync-all error:', msg);
    await closeDb().catch(() => {});
    process.exit(1);
  });
