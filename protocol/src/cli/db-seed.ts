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
import { indexMembers, indexes, users, userProfiles } from '../lib/schema';
import { privyClient } from '../lib/privy';
import { setLevel } from '../lib/log';
import { ProfileGenerator } from '../agents/profile/profile.generator';
import { searchUser } from '../lib/parallel/parallel';
import { json2md } from '../lib/json2md/json2md';

type GlobalOpts = {
  silent?: boolean;
  confirm?: boolean;
  type?: 'open' | 'restricted' | 'both';
};

const OPEN_INDEX_ID = '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c';
const RESTRICTED_INDEX_ID = '99999999-d64e-4ef9-8bcf-6c89815f771c'; // New mocked ID

import { PRIVY_TEST_ACCOUNTS } from './test-data';

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

async function seedDatabase(type: 'open' | 'restricted' | 'both'): Promise<{ ok: boolean; error?: string }> {
  try {
    console.log(`Generating minimal mock data (type: ${type})...`);

    // Create indexes
    try {
      // 1. Open Index (No Approval)
      if (type === 'open' || type === 'both') {
        await db.insert(indexes).values({
          id: OPEN_INDEX_ID,
          title: 'Open Mock Network',
          prompt: 'Share collaboration opportunities',
          permissions: {
            joinPolicy: 'anyone',
            invitationLink: null,
            allowGuestVibeCheck: false,
            requireApproval: false // Open
          },
        });
      }

      // 2. Restricted Index (Requires Approval)
      if (type === 'restricted' || type === 'both') {
        await db.insert(indexes).values({
          id: RESTRICTED_INDEX_ID,
          title: 'Restricted Mock Network',
          prompt: 'Exclusive members only',
          permissions: {
            joinPolicy: 'invite_only',
            invitationLink: null,
            allowGuestVibeCheck: false,
            requireApproval: true // Restricted
          },
        });
      }
    } catch { }

    // Create users
    const createdUsers = [];

    for (const [i, account] of PRIVY_TEST_ACCOUNTS.entries()) {
      const user = await createUser(account);
      createdUsers.push(user);

      // Add to Open Index
      if (type === 'open' || type === 'both') {
        try {
          await db.insert(indexMembers).values({
            indexId: OPEN_INDEX_ID,
            userId: user.id,
            permissions: i === 0 ? ['owner'] : ['member'],
            prompt: 'everything',
            autoAssign: true,
          });
        } catch { }
      }

      // Add to Restricted Index
      if (type === 'restricted' || type === 'both') {
        try {
          await db.insert(indexMembers).values({
            indexId: RESTRICTED_INDEX_ID,
            userId: user.id,
            permissions: i === 0 ? ['owner'] : ['member'],
            prompt: 'exclusive stuff',
            autoAssign: true,
          });
        } catch { }
      }

      // Generate Profile
      try {
        console.log(`Generating profile for ${account.name}...`);

        // Use mock data if available, otherwise search
        console.log(`> Searching for ${account.name}...`);
        const query = `Find information about ${account.name}`;
        const searchResult = await searchUser(query);
        const markdownData = json2md.fromObject(
          searchResult.results.map((r: any) => ({
            title: r.title,
            content: r.excerpts.join('\n')
          })) as any
        );

        const profileGen = new ProfileGenerator();
        const { profile } = await profileGen.run(markdownData);

        // Save profile to user
        await db.insert(userProfiles).values({
          userId: user.id,
          identity: {
            name: account.name,
            bio: profile.identity.bio,
            location: profile.identity.location || 'Remote',
          },
          narrative: profile.narrative,
          attributes: profile.attributes,
        }).onConflictDoUpdate({
          target: userProfiles.userId,
          set: {
            identity: {
              name: account.name,
              bio: profile.identity.bio,
              location: profile.identity.location || 'Remote',
            },
            narrative: profile.narrative,
            attributes: profile.attributes,
          }
        });

        console.log(`> Created profile for ${account.name}`);
        console.log(`  Bio: ${profile.identity.bio.slice(0, 50)}...`);
        console.log(`  Location: ${profile.identity.location}`);

      } catch (err) {
        console.error(`Failed to generate profile for ${account.name}:`, err);
      }
    }

    console.log(`✅ Created ${createdUsers.length} users with profiles`);


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
    .option('-t, --type <type>', 'Type of index to seed: open, restricted, or both', 'both')
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

      // Validate type
      if (opts.type && !['open', 'restricted', 'both'].includes(opts.type)) {
        console.error('❌ Invalid type. Must be one of: open, restricted, both');
        process.exit(1);
      }

      const seedType = opts.type || 'both';
      const result = await seedDatabase(seedType);

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
