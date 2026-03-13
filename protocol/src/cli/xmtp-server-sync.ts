#!/usr/bin/env node
/**
 * CLI: Server-to-server XMTP sync.
 *
 * This enables syncing XMTP history between server installations (e.g., Railway and Local).
 * Unlike sendSyncRequest() which requires the source to be actively listening,
 * this uses sendSyncArchive() to push archives that can be pulled later.
 *
 * Usage:
 *   bun run maintenance:xmtp-server-sync push [--user=ID] [--pin=NAME]
 *   bun run maintenance:xmtp-server-sync pull [--user=ID] [--pin=NAME]
 *   bun run maintenance:xmtp-server-sync list [--user=ID]
 *
 * Commands:
 *   push    Create and upload an archive for other installations to pull
 *   pull    Download and process the latest archive (or specific pin)
 *   list    List available archives
 *
 * Options:
 *   --user=ID    Target specific user by ID
 *   --pin=NAME   Archive pin/identifier (default: "server-sync")
 *   --limit=N    Process only N users (default: all)
 *   --days=N     List archives from last N days (default: 30)
 *
 * Workflow:
 *   1. On Railway (source):     bun run maintenance:xmtp-server-sync push
 *   2. On Local (destination):  bun run maintenance:xmtp-server-sync pull
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
  if (!cmd || cmd.startsWith('--')) return 'list';
  return cmd;
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

async function pushArchive(
  adapter: MessagingAdapter,
  userList: UserRow[],
  pin: string,
): Promise<void> {
  console.log('\n=== XMTP Server Sync: PUSH ===\n');
  console.log(`Creating archives with pin: "${pin}"\n`);

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

      // Sync local state first
      console.log('  Syncing local state...');
      await client.conversations.syncAll();

      // Get message count before
      const convos = await client.conversations.list();
      let msgCount = 0;
      for (const c of convos) {
        msgCount += (await c.messages()).length;
      }

      console.log(`  Local state: ${convos.length} conversations, ${msgCount} messages`);

      // Create and upload archive
      console.log(`  Creating archive with pin "${pin}"...`);
      
      // sendSyncArchive pushes an archive to the sync group
      // Other installations can then pull it using processSyncArchive
      await client.sendSyncArchive(pin);

      console.log('  [OK] Archive uploaded');
      success++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [ERROR] ${msg}`);
    }
  }

  console.log(`\n=== Push Complete ===`);
  console.log(`Success: ${success}, Failed: ${failed}`);
  console.log(`\nOther installations can now pull with: bun run maintenance:xmtp-server-sync pull --pin=${pin}`);
}

async function pullArchive(
  adapter: MessagingAdapter,
  userList: UserRow[],
  pin: string | null,
): Promise<void> {
  console.log('\n=== XMTP Server Sync: PULL ===\n');
  console.log(`Pulling archive${pin ? ` with pin: "${pin}"` : ' (latest)'}\n`);

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
      await client.conversations.syncAll();
      const beforeConvos = await client.conversations.list();
      let beforeMsgs = 0;
      for (const c of beforeConvos) {
        beforeMsgs += (await c.messages()).length;
      }
      console.log(`  Before: ${beforeConvos.length} conversations, ${beforeMsgs} messages`);

      // Sync device sync groups to get latest archive info
      console.log('  Syncing device sync groups...');
      try {
        await client.syncAllDeviceSyncGroups();
      } catch {
        // May not be available
      }

      // List available archives
      console.log('  Checking available archives...');
      const archives = await client.listAvailableArchives(BigInt(30));
      
      if (!archives || archives.length === 0) {
        console.log('  [INFO] No archives available. Run "push" on source server first.');
        continue;
      }

      console.log(`  Found ${archives.length} archive(s)`);

      // Process the archive
      console.log(`  Processing archive${pin ? ` "${pin}"` : ' (latest)'}...`);
      
      if (pin) {
        await client.processSyncArchive(pin);
      } else {
        // Process latest archive
        await client.processSyncArchive();
      }

      // Sync all after processing
      await client.conversations.syncAll();
      
      // Sync each conversation
      const afterConvos = await client.conversations.list();
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

      success++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [ERROR] ${msg}`);
    }
  }

  console.log(`\n=== Pull Complete ===`);
  console.log(`Success: ${success}, Failed: ${failed}`);
}

async function listArchives(
  adapter: MessagingAdapter,
  userList: UserRow[],
  days: number,
): Promise<void> {
  console.log('\n=== XMTP Server Sync: LIST ===\n');
  console.log(`Listing archives from last ${days} days\n`);

  for (const user of userList) {
    console.log(`\n--- ${user.name} (${user.id}) ---`);

    try {
      const client = await adapter.getUserClient(user.id);
      if (!client) {
        console.log('  [SKIP] No client');
        continue;
      }

      // Sync device sync groups first
      console.log('  Syncing device sync groups...');
      try {
        await client.syncAllDeviceSyncGroups();
      } catch {
        // May not be available
      }

      // List archives
      const archives = await client.listAvailableArchives(BigInt(days));

      if (!archives || archives.length === 0) {
        console.log('  No archives available');
        continue;
      }

      console.log(`  Available archives: ${archives.length}`);
      
      // Try to display archive info
      for (let i = 0; i < archives.length; i++) {
        const archive = archives[i];
        // Archive structure may vary - display what we can
        if (typeof archive === 'object' && archive !== null) {
          console.log(`    ${i + 1}. ${JSON.stringify(archive)}`);
        } else {
          console.log(`    ${i + 1}. ${archive}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [ERROR] ${msg}`);
    }
  }
}

async function main(): Promise<void> {
  const command = parseCommand();
  const userId = parseArg('user');
  const pin = parseArg('pin') || 'server-sync';
  const limitStr = parseArg('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : null;
  const daysStr = parseArg('days');
  const days = daysStr ? parseInt(daysStr, 10) : 30;

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
    case 'push':
      await pushArchive(adapter, userList, pin);
      break;
    case 'pull':
      await pullArchive(adapter, userList, parseArg('pin'));
      break;
    case 'list':
      await listArchives(adapter, userList, days);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log('\nUsage:');
      console.log('  bun run maintenance:xmtp-server-sync push [--user=ID] [--pin=NAME]');
      console.log('  bun run maintenance:xmtp-server-sync pull [--user=ID] [--pin=NAME]');
      console.log('  bun run maintenance:xmtp-server-sync list [--user=ID]');
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
