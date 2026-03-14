#!/usr/bin/env node
/**
 * CLI: Server-to-server XMTP sync.
 *
 * IMPORTANT: The Node SDK only has sendSyncRequest(), not sendSyncArchive/processSyncArchive.
 * For sync to work, BOTH servers must be running simultaneously:
 * 1. Start "listen" on the SOURCE server (creates client and waits)
 * 2. Run "request" on the DESTINATION server (sends sync request)
 * 3. The SOURCE receives the request and creates/uploads archive
 * 4. The DESTINATION pulls the archive
 *
 * Usage:
 *   bun run maintenance:xmtp-server-sync listen [--user=ID] [--timeout=S]
 *   bun run maintenance:xmtp-server-sync request [--user=ID] [--wait=S]
 *   bun run maintenance:xmtp-server-sync status [--user=ID]
 *
 * Commands:
 *   listen   Keep client alive to respond to sync requests (run on SOURCE)
 *   request  Send sync request and wait for archive (run on DESTINATION)
 *   status   Show current sync state
 *
 * Options:
 *   --user=ID     Target specific user by ID
 *   --timeout=S   How long to listen for sync requests (default: 300s = 5min)
 *   --wait=S      How long to wait for sync response (default: 60s)
 *   --limit=N     Process only N users (default: all)
 *
 * Workflow:
 *   Terminal 1 (Railway):  bun run maintenance:xmtp-server-sync listen --timeout=120
 *   Terminal 2 (Local):    bun run maintenance:xmtp-server-sync request --wait=30
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

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

async function getMessageCounts(
  adapter: MessagingAdapter,
  userId: string,
): Promise<{ convos: number; msgs: number }> {
  const client = await adapter.getUserClient(userId);
  if (!client) return { convos: 0, msgs: 0 };

  await client.conversations.syncAll();
  const convos = await client.conversations.list();
  let msgs = 0;
  for (const c of convos) {
    msgs += (await c.messages()).length;
  }
  return { convos: convos.length, msgs };
}

/**
 * Listen mode: Keep clients alive so they can respond to sync requests.
 * The XMTP SDK's sync worker runs in the background when a client is active.
 */
async function listenForSync(
  adapter: MessagingAdapter,
  userList: UserRow[],
  timeoutSeconds: number,
): Promise<void> {
  console.log('\n=== XMTP Server Sync: LISTEN ===\n');
  console.log(`Keeping clients alive for ${timeoutSeconds}s to respond to sync requests.`);
  console.log('Run "request" on the other server while this is running.\n');

  // Create all clients upfront
  for (const user of userList) {
    console.log(`--- ${user.name} (${user.id}) ---`);
    try {
      const client = await adapter.getUserClient(user.id);
      if (!client) {
        console.log('  [SKIP] No client');
        continue;
      }

      // Sync local state
      await client.conversations.syncAll();
      const counts = await getMessageCounts(adapter, user.id);
      console.log(`  Installation: ${client.installationId.slice(0, 16)}...`);
      console.log(`  State: ${counts.convos} conversations, ${counts.msgs} messages`);
      console.log('  [LISTENING] Ready to respond to sync requests');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [ERROR] ${msg}`);
    }
  }

  console.log(`\nListening for ${timeoutSeconds} seconds...`);
  console.log('Press Ctrl+C to stop early.\n');

  // Keep process alive
  const startTime = Date.now();
  const checkInterval = 10000; // 10 seconds

  while (Date.now() - startTime < timeoutSeconds * 1000) {
    const remaining = Math.ceil((timeoutSeconds * 1000 - (Date.now() - startTime)) / 1000);
    process.stdout.write(`\r  Remaining: ${remaining}s    `);
    await sleep(checkInterval);
  }

  console.log('\n\nTimeout reached. Stopping listen mode.');
}

/**
 * Request mode: Send sync requests and wait for archives to arrive.
 */
async function requestSync(
  adapter: MessagingAdapter,
  userList: UserRow[],
  waitSeconds: number,
): Promise<void> {
  console.log('\n=== XMTP Server Sync: REQUEST ===\n');
  console.log(`Will send sync requests and wait ${waitSeconds}s for responses.`);
  console.log('Make sure "listen" is running on the source server!\n');

  let success = 0;
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
      const before = await getMessageCounts(adapter, user.id);
      console.log(`  Before: ${before.convos} conversations, ${before.msgs} messages`);
      console.log(`  Installation: ${client.installationId.slice(0, 16)}...`);

      // Send sync request
      console.log('  Sending sync request...');
      await client.sendSyncRequest();

      // Wait for response
      console.log(`  Waiting ${waitSeconds}s for sync response...`);

      // Poll periodically to check for new data
      const pollInterval = 5000; // 5 seconds
      const maxPolls = Math.ceil((waitSeconds * 1000) / pollInterval);

      for (let i = 0; i < maxPolls; i++) {
        await sleep(pollInterval);

        // Sync to pull any new data
        await client.conversations.syncAll();

        const current = await getMessageCounts(adapter, user.id);
        if (current.convos > before.convos || current.msgs > before.msgs) {
          console.log(`  [PROGRESS] Now: ${current.convos} convos, ${current.msgs} msgs`);
        }
      }

      // Final sync and count
      await client.conversations.syncAll();
      const convos = await client.conversations.list();
      for (const convo of convos) {
        await convo.sync();
      }

      const after = await getMessageCounts(adapter, user.id);
      console.log(`  After: ${after.convos} conversations, ${after.msgs} messages`);
      console.log(
        `  Delta: +${after.convos - before.convos} convos, +${after.msgs - before.msgs} msgs`,
      );

      if (after.convos > before.convos || after.msgs > before.msgs) {
        console.log('  [OK] Sync received data');
        success++;
      } else {
        console.log('  [INFO] No new data (source may be offline or already synced)');
        success++;
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [ERROR] ${msg}`);
    }
  }

  console.log(`\n=== Request Complete ===`);
  console.log(`Success: ${success}, Failed: ${failed}`);
}

/**
 * Status mode: Show current sync state for each user.
 */
async function showStatus(
  adapter: MessagingAdapter,
  userList: UserRow[],
): Promise<void> {
  console.log('\n=== XMTP Server Sync: STATUS ===\n');

  for (const user of userList) {
    console.log(`--- ${user.name} (${user.id}) ---`);

    try {
      const client = await adapter.getUserClient(user.id);
      if (!client) {
        console.log('  [SKIP] No client');
        continue;
      }

      await client.conversations.syncAll();

      const counts = await getMessageCounts(adapter, user.id);
      console.log(`  Inbox ID: ${client.inboxId}`);
      console.log(`  Installation: ${client.installationId}`);
      console.log(`  Conversations: ${counts.convos}`);
      console.log(`  Messages: ${counts.msgs}`);
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
  const timeoutStr = parseArg('timeout');
  const timeoutSeconds = timeoutStr ? parseInt(timeoutStr, 10) : 300;
  const waitStr = parseArg('wait');
  const waitSeconds = waitStr ? parseInt(waitStr, 10) : 60;

  const walletMasterKey = process.env.WALLET_ENCRYPTION_KEY;
  if (!walletMasterKey) {
    console.error('WALLET_ENCRYPTION_KEY is required');
    process.exit(1);
  }

  const xmtpEnv = (process.env.XMTP_ENV as XmtpEnv) || 'dev';
  const xmtpDbDir = process.env.XMTP_DB_DIR || path.join(process.cwd(), '.xmtp');
  const masterKey = Buffer.from(walletMasterKey, 'hex');

  console.log(`XMTP Environment: ${xmtpEnv}`);
  console.log(`Installation ID: ${process.env.XMTP_INSTALLATION_ID || '(not set)'}`);
  console.log(`DB Directory: ${xmtpDbDir}`);

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
    case 'listen':
      await listenForSync(adapter, userList, timeoutSeconds);
      break;
    case 'request':
      await requestSync(adapter, userList, waitSeconds);
      break;
    case 'status':
      await showStatus(adapter, userList);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log('\nUsage:');
      console.log('  bun run maintenance:xmtp-server-sync listen [--user=ID] [--timeout=S]');
      console.log('  bun run maintenance:xmtp-server-sync request [--user=ID] [--wait=S]');
      console.log('  bun run maintenance:xmtp-server-sync status [--user=ID]');
      console.log('\nWorkflow:');
      console.log('  1. On Railway (source):     bun run maintenance:xmtp-server-sync listen');
      console.log('  2. On Local (destination):  bun run maintenance:xmtp-server-sync request');
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
    console.error('xmtp-server-sync error:', msg);
    await closeDb().catch(() => {});
    process.exit(1);
  });
