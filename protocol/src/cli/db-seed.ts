#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

console.log(process.env.DATABASE_URL);

import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import db, { closeDb } from '../lib/db';
import { intents, intentIndexes, intentStakes, intentStakeItems, indexMembers, indexes, users } from '../lib/schema';
import { privyClient } from '../lib/privy';
import { setLevel } from '../lib/log';
import { generateEmbedding } from '../lib/embeddings';

type GlobalOpts = {
  silent?: boolean;
  confirm?: boolean;
};

const INDEX_ID = '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c';
const SEMANTIC_RELEVANCY_AGENT_ID = '028ef80e-9b1c-434b-9296-bb6130509482';

import { PRIVY_TEST_ACCOUNTS, INTENTS } from './test-data';

async function ensurePrivyIdentity(email: string): Promise<string> {
  let privyUser = await privyClient.getUserByEmail(email);
  if (!privyUser) {
    privyUser = await privyClient.importUser({
      linkedAccounts: [{ type: 'email', address: email }],
    });
  }
  return privyUser.id;
}

async function createUser(account: typeof PRIVY_TEST_ACCOUNTS[0]): Promise<any> {
  const privyId = await ensurePrivyIdentity(account.email);

  try {
    const [user] = await db.insert(users).values({
      privyId,
      email: account.email,
      name: account.name,
      intro: `Test account for ${account.name}`,
      onboarding: {}
    }).returning();
    return user;
  } catch {
    const [existing] = await db.select().from(users).where(eq(users.email, account.email)).limit(1);
    return existing;
  }
}

async function createIntent(user: any, payload: string): Promise<string> {
  // Generate embedding for the intent
  let embedding: number[] | undefined;
  try {
    embedding = await generateEmbedding(payload);
    console.log(`Generated embedding for intent: "${payload.slice(0, 50)}..."`);
  } catch (error) {
    console.error(`Failed to generate embedding for intent:`, error);
  }

  const [intent] = await db.insert(intents).values({
    payload,
    summary: payload.slice(0, 100),
    userId: user.id,
    embedding,
  }).returning();

  await db.insert(intentIndexes).values({
    intentId: intent.id,
    indexId: INDEX_ID,
  });

  return intent.id;
}

async function seedDatabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    console.log('Generating minimal mock data...');

    // Create index
    try {
      await db.insert(indexes).values({
        id: INDEX_ID,
        title: 'Mock Demo Network',
        prompt: 'Share collaboration opportunities',
        permissions: {
          joinPolicy: 'anyone',
          invitationLink: null,
          allowGuestVibeCheck: false,
          requireApproval: false
        },
      });
    } catch { }

    // Create users and intents
    const createdUsers = [];
    const intentIds = [];

    for (const [i, account] of PRIVY_TEST_ACCOUNTS.entries()) {
      const user = await createUser(account);
      createdUsers.push(user);

      // Add to index
      try {
        await db.insert(indexMembers).values({
          indexId: INDEX_ID,
          userId: user.id,
          permissions: i === 0 ? ['owner'] : ['member'],
          prompt: 'everything',
          autoAssign: true,
        });
      } catch { }

      // Create intent
      const payload = INTENTS[i % INTENTS.length];
      const intentId = await createIntent(user, payload);
      intentIds.push(intentId);
    }

    // Connect all users to everyone (create stakes between all pairs of intents)
    for (let i = 0; i < createdUsers.length; i++) {
      for (let j = i + 1; j < createdUsers.length; j++) {
        const intentPair = [intentIds[i], intentIds[j]].sort();

        try {
          // Create stake
          const [newStake] = await db.insert(intentStakes).values({
            intents: intentPair,
            stake: BigInt(100),
            reasoning: `${createdUsers[i].name} and ${createdUsers[j].name} should connect`,
            agentId: SEMANTIC_RELEVANCY_AGENT_ID,
          }).returning({ id: intentStakes.id });

          // Insert into join table with denormalized user_id
          await db.insert(intentStakeItems).values([
            { stakeId: newStake.id, intentId: intentIds[i], userId: createdUsers[i].id },
            { stakeId: newStake.id, intentId: intentIds[j], userId: createdUsers[j].id }
          ]);
        } catch { }
      }
    }

    console.log(`✅ Created ${createdUsers.length} users with connected intents`);
    console.log('\nLogin credentials:');
    PRIVY_TEST_ACCOUNTS.forEach(acc =>
      console.log(`${acc.name}: ${acc.email} | ${acc.phoneNumber} | OTP: ${acc.otpCode}`)
    );

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('db-seed')
    .description('Seed database with mock data')
    .option('--silent', 'Suppress non-error output')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (opts: GlobalOpts) => {
      if (opts.silent) setLevel('error');

      // Prevent seeding in production
      if (process.env.NODE_ENV === 'production') {
        console.error('❌ db:seed cannot be run in production environment');
        process.exit(1);
      }

      if (!opts.confirm) {
        console.log('⚠️  This will add mock data to the database.');
        console.log('Use --confirm to skip this warning.');
        process.exit(1);
      }

      const result = await seedDatabase();

      if (!result.ok) {
        console.error('❌ Seed failed:', result.error);
        process.exit(1);
      }
    });

  program.addHelpText(
    'after',
    '\nExamples:\n  yarn db:seed --confirm\n  yarn db:seed --silent --confirm\n'
  );

  try {
    await program.parseAsync(process.argv);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('db-seed error:', msg);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
