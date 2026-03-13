#!/usr/bin/env node
/**
 * CLI: Diagnose XMTP installation states and sync issues.
 *
 * Usage: bun run cli/xmtp-diagnose.ts [command] [options]
 *
 * Commands:
 *   status [--user=ID]     Show installation status for all users (or specific user)
 *   sync [--user=ID]       Sync history from other installations
 *   revoke [--user=ID]     Revoke all installations except current (use with caution)
 *
 * Options:
 *   --user=ID    Target specific user by ID
 *   --limit=N    Process only N users (default: all)
 *   --wait=S     Wait S seconds for history sync (default: 10)
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { Client } from '@xmtp/node-sdk';
import { isNotNull, eq } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { users } from '../schemas/database.schema';
import { MessagingAdapter, type MessagingAdapterConfig } from '../adapters/messaging.adapter';
import { MessagingDatabaseAdapter } from '../adapters/database.adapter';
import type { XmtpEnv } from '../lib/xmtp';

interface UserRow {
  id: string;
  name: string;
  xmtpInboxId: string | null;
}

function parseArg(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
}

function parseCommand(): string {
  const cmd = process.argv[2];
  if (!cmd || cmd.startsWith('--')) return 'status';
  return cmd;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getUsers(userId: string | null, limit: number | null): Promise<UserRow[]> {
  if (userId) {
    return db
      .select({ id: users.id, name: users.name, xmtpInboxId: users.xmtpInboxId })
      .from(users)
      .where(eq(users.id, userId));
  }

  let query = db
    .select({ id: users.id, name: users.name, xmtpInboxId: users.xmtpInboxId })
    .from(users)
    .where(isNotNull(users.xmtpInboxId))
    .$dynamic();

  if (limit) {
    query = query.limit(limit);
  }

  return query;
}

function formatBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex').slice(0, 16) + '...';
}

async function showStatus(
  adapter: MessagingAdapter,
  xmtpEnv: XmtpEnv,
  userList: UserRow[],
): Promise<void> {
  console.log('\n=== XMTP Installation Status ===\n');
  console.log(`Environment: ${xmtpEnv}`);
  console.log(`Installation ID: ${process.env.XMTP_INSTALLATION_ID || '(not set)'}`);
  console.log(`DB Directory: ${process.env.XMTP_DB_DIR || '.xmtp'}\n`);

  for (const user of userList) {
    console.log(`\n--- ${user.name} (${user.id}) ---`);

    if (!user.xmtpInboxId) {
      console.log('  No XMTP inbox ID stored');
      continue;
    }

    console.log(`  Inbox ID: ${user.xmtpInboxId}`);

    try {
      const states = await Client.fetchInboxStates([user.xmtpInboxId], xmtpEnv);
      const state = states[0];

      if (!state) {
        console.log('  [WARNING] Could not fetch inbox state from network');
        continue;
      }

      console.log(`  Recovery Identifier: ${state.recoveryIdentifier.identifier}`);
      console.log(`  Identifiers: ${state.identifiers?.length ?? 0}`);
      state.identifiers?.forEach((id, i) => {
        console.log(`    ${i + 1}. ${id.identifierKind}: ${id.identifier}`);
      });

      console.log(`  Installations: ${state.installations?.length ?? 0} / 10`);
      state.installations?.forEach((inst, i) => {
        console.log(`    ${i + 1}. ${formatBytes(inst.bytes)}`);
      });

      // Try to get local client and show its installation
      const client = await adapter.getUserClient(user.id);
      if (client) {
        console.log(`  Local Installation: ${client.installationId}`);

        const convos = await client.conversations.list();
        console.log(`  Local Conversations: ${convos.length}`);

        let totalMessages = 0;
        for (const convo of convos.slice(0, 10)) {
          const msgs = await convo.messages();
          totalMessages += msgs.length;
        }
        console.log(`  Local Messages (sample): ${totalMessages}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [ERROR] ${msg}`);
    }
  }
}

async function syncHistory(
  adapter: MessagingAdapter,
  userList: UserRow[],
  waitSeconds: number,
): Promise<void> {
  console.log('\n=== XMTP History Sync ===\n');
  console.log(`Will wait ${waitSeconds}s for history from other installations.\n`);

  let synced = 0;
  let failed = 0;

  for (const user of userList) {
    console.log(`\n--- ${user.name} (${user.id}) ---`);

    try {
      const client = await adapter.getUserClient(user.id);
      if (!client) {
        console.log('  [SKIP] No client');
        continue;
      }

      // Get before counts
      await client.conversations.syncAll();
      const beforeConvos = await client.conversations.list();
      let beforeMsgs = 0;
      for (const c of beforeConvos) {
        beforeMsgs += (await c.messages()).length;
      }

      console.log(`  Before: ${beforeConvos.length} conversations, ${beforeMsgs} messages`);

      // Send sync request
      console.log('  Sending sync request...');
      try {
        await client.sendSyncRequest();
      } catch {
        console.log('  [INFO] No other installations responded (may be offline)');
      }

      // Wait for history
      console.log(`  Waiting ${waitSeconds}s...`);
      await sleep(waitSeconds * 1000);


      // Sync all conversations
      await client.conversations.syncAll();
      const afterConvos = await client.conversations.list();

      // Sync each conversation's messages
      for (const convo of afterConvos) {
        await convo.sync();
      }

      let afterMsgs = 0;
      for (const c of afterConvos) {
        afterMsgs += (await c.messages()).length;
      }

      console.log(`  After: ${afterConvos.length} conversations, ${afterMsgs} messages`);
      console.log(
        `  Delta: +${afterConvos.length - beforeConvos.length} convos, +${afterMsgs - beforeMsgs} msgs`,
      );

      synced++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [ERROR] ${msg}`);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Synced: ${synced}, Failed: ${failed}`);
}

async function revokeOthers(
  adapter: MessagingAdapter,
  userList: UserRow[],
): Promise<void> {
  console.log('\n=== XMTP Revoke Other Installations ===\n');
  console.log('WARNING: This will revoke all installations except the current one.');
  console.log('Other devices/servers will need to re-register.\n');

  for (const user of userList) {
    console.log(`\n--- ${user.name} (${user.id}) ---`);

    try {
      const client = await adapter.getUserClient(user.id);
      if (!client) {
        console.log('  [SKIP] No client');
        continue;
      }

      console.log(`  Current installation: ${client.installationId}`);
      console.log('  Revoking all other installations...');

      await client.revokeAllOtherInstallations();

      console.log('  [OK] Revoked');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [ERROR] ${msg}`);
    }
  }
}

async function main(): Promise<void> {
  const command = parseCommand();
  const userId = parseArg('user');
  const limitStr = parseArg('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : null;
  const waitStr = parseArg('wait');
  const waitSeconds = waitStr ? parseInt(waitStr, 10) : 10;

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

  const userList = await getUsers(userId, limit);

  if (userList.length === 0) {
    console.log('No users found.');
    return;
  }

  switch (command) {
    case 'status':
      await showStatus(adapter, xmtpEnv, userList);
      break;
    case 'sync':
      await syncHistory(adapter, userList, waitSeconds);
      break;
    case 'revoke':
      await revokeOthers(adapter, userList);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log('Usage: bun run cli/xmtp-diagnose.ts [status|sync|revoke] [options]');
      process.exit(1);
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('xmtp-diagnose error:', msg);
    await closeDb().catch(() => {});
    process.exit(1);
  });
