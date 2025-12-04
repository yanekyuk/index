#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { Command } from 'commander';
import { log, setLevel } from '../lib/log';
import { syncAllTwitterUsers, syncAllSocialMedia } from '../lib/integrations/social-sync';
import { syncTwitterUser } from '../lib/integrations/providers/twitter';

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type Opts = {
  type?: string;
  silent?: boolean;
  userId?: string;
  runAll?: boolean;
};

let isShuttingDown = false;

const TWITTER_SYNC_DELAY_MS = parseInt(process.env.TWITTER_SYNC_DELAY_MS || '3600000'); // 1 hour default

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('social-worker')
    .description('Run social media sync worker for Twitter')
    .option('--type <type>', 'Sync type: twitter or all (default: all)')
    .option('--userId <userId>', 'Sync specific user ID (if provided, runs once and exits)')
    .option('--run-all', 'Run sync for all users once and exit (instead of continuous worker)')
    .option('--silent', 'Suppress non-error output')
    .action(async (opts: Opts) => {
      const syncType = opts.type || 'all';

      if (opts.silent) setLevel('error');

      log.info('Starting social worker', { syncType, userId: opts.userId, runAll: opts.runAll });

      // Handle graceful shutdown
      const shutdown = () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        log.info('Received shutdown signal, waiting for current syncs to complete...');
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);

      // If userId is provided, sync once and exit
      if (opts.userId) {
        await syncSingleTwitterUser(opts.userId);
        log.info('Single user sync complete');
        process.exit(0);
        return;
      }

      // If --run-all is provided, run once for all users and exit
      if (opts.runAll) {
        await syncAllTwitterUsersOnce();
        log.info('All users sync complete');
        process.exit(0);
        return;
      }

      // Otherwise, run continuous workers
      await runTwitterWorker();

      log.info('Social worker shutting down gracefully');
      process.exit(0);
    });

  program.addHelpText(
    'after',
    '\nExamples:\n' +
    '  # Continuous workers (every 1 hour for Twitter):\n' +
    '  yarn social-worker --type twitter\n' +
    '  yarn social-worker --type all --silent\n' +
    '\n' +
    '  # Run once for all users:\n' +
    '  yarn social-worker --type twitter --run-all\n' +
    '\n' +
    '  # Sync single user:\n' +
    '  yarn social-worker --type twitter --userId abc123\n'
  );

  try {
    await program.parseAsync(process.argv);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('Error:', msg);
    process.exit(1);
  }
}

async function syncSingleTwitterUser(userId: string): Promise<void> {
  try {
    log.info('Syncing single Twitter user', { userId });
    // Pass undefined to use integration's lastSyncAt (worker mode behavior)
    const result = await syncTwitterUser(userId, undefined);
    if (result.success) {
      log.info('Twitter sync successful', { userId, intentsGenerated: result.intentsGenerated, locationUpdated: result.locationUpdated });
    } else {
      log.error('Twitter sync failed', { userId, error: result.error });
      process.exit(1);
    }
  } catch (error) {
    log.error('Twitter sync error', { userId, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

async function runTwitterWorker(): Promise<void> {
  while (!isShuttingDown) {
    try {
      log.info('Starting Twitter sync cycle');
      await syncAllTwitterUsers();
      
      if (!isShuttingDown) {
        const minutes = Math.floor(TWITTER_SYNC_DELAY_MS / 1000 / 60);
        log.info(`Twitter cycle complete, next sync in ${minutes} minute${minutes !== 1 ? 's' : ''}`);
        await sleep(TWITTER_SYNC_DELAY_MS);
      }
    } catch (error) {
      log.error('Twitter worker error', {
        error: error instanceof Error ? error.message : String(error)
      });
      await sleep(TWITTER_SYNC_DELAY_MS);
    }
  }
}

async function syncAllTwitterUsersOnce(): Promise<void> {
  try {
    log.info('Running Twitter sync for all users (once)');
    const result = await syncAllTwitterUsers();
    log.info('Twitter sync for all users complete', {
      usersProcessed: result.usersProcessed,
      intentsGenerated: result.intentsGenerated,
      locationUpdated: result.locationUpdated,
      errors: result.errors
    });
  } catch (error) {
    log.error('Twitter sync for all users error', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
}

main();
