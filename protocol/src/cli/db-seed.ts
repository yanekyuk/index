#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { eq } from 'drizzle-orm';
import db, { closeDb } from '../lib/drizzle/drizzle';
import { indexMembers, indexes, users } from '../schemas/database.schema';
import { privyClient } from '../lib/privy';
import { setLevel } from '../lib/log';
import { TESTABLE_TEST_ACCOUNTS } from './test-data';

type SeedType = 'open' | 'restricted' | 'both';

const OPEN_INDEX_ID = '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c';
const RESTRICTED_INDEX_ID = '99999999-d64e-4ef9-8bcf-6c89815f771c';

type GlobalOpts = {
  silent?: boolean;
  confirm?: boolean;
  type?: SeedType;
};

function parseArgs(): GlobalOpts {
  const args = process.argv.slice(2);
  const typeIdx = args.indexOf('--type');
  const typeArg = typeIdx >= 0 ? args[typeIdx + 1] : undefined;
  const type = typeArg && ['open', 'restricted', 'both'].includes(typeArg) ? (typeArg as SeedType) : 'both';
  return {
    silent: args.includes('--silent'),
    confirm: args.includes('--confirm'),
    type,
  };
}

async function ensurePrivyIdentity(email: string): Promise<string> {
  let privyUser = await privyClient.getUserByEmail(email);
  if (!privyUser) {
    privyUser = await privyClient.importUser({
      linkedAccounts: [{ type: 'email', address: email }],
    });
  }
  return privyUser.id;
}

type TestAccount = (typeof TESTABLE_TEST_ACCOUNTS)[number];

async function createUser(account: TestAccount): Promise<{ id: string }> {
  const privyId = await ensurePrivyIdentity(account.email);

  const socials = {
    linkedin: account.linkedin ?? undefined,
    github: account.github ?? undefined,
    x: account.x ?? undefined,
    websites: account.website ? [account.website] : [],
  };

  try {
    const [user] = await db
      .insert(users)
      .values({
        privyId,
        email: account.email,
        name: account.name,
        intro: `Test account for ${account.name}`,
        socials,
        onboarding: {},
      })
      .returning({ id: users.id });
    return user!;
  } catch {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, account.email)).limit(1);
    return existing!;
  }
}

async function seedDatabase(type: SeedType): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!parseArgs().silent) {
      console.log(`Generating minimal mock data (type: ${type})...`);
    }

    if (type === 'open' || type === 'both') {
      try {
        await db.insert(indexes).values({
          id: OPEN_INDEX_ID,
          title: 'Open Mock Network',
          prompt: 'Share collaboration opportunities',
          isPersonal: false,
          permissions: {
            joinPolicy: 'anyone',
            invitationLink: null,
            allowGuestVibeCheck: false,
          },
        });
      } catch {
        /* already exists */
      }
    }

    if (type === 'restricted' || type === 'both') {
      try {
        await db.insert(indexes).values({
          id: RESTRICTED_INDEX_ID,
          title: 'Private Mock Network',
          prompt: 'Exclusive members only',
          isPersonal: false,
          permissions: {
            joinPolicy: 'invite_only',
            invitationLink: null,
            allowGuestVibeCheck: false,
          },
        });
      } catch {
        /* already exists */
      }
    }

    const createdUsers: { id: string }[] = [];

    for (const [i, account] of TESTABLE_TEST_ACCOUNTS.entries()) {
      const user = await createUser(account);
      createdUsers.push(user);

      if (type === 'open' || type === 'both') {
        try {
          await db.insert(indexMembers).values({
            indexId: OPEN_INDEX_ID,
            userId: user.id,
            permissions: i === 0 ? ['owner'] : ['member'],
            prompt: 'everything',
            autoAssign: true,
          });
        } catch {
          /* already exists */
        }
      }

      if (type === 'restricted' || type === 'both') {
        try {
          await db.insert(indexMembers).values({
            indexId: RESTRICTED_INDEX_ID,
            userId: user.id,
            permissions: i === 0 ? ['owner'] : ['member'],
            prompt: 'exclusive stuff',
            autoAssign: true,
          });
        } catch {
          /* already exists */
        }
      }
    }

    if (!parseArgs().silent) {
      console.log(`✅ Created ${createdUsers.length} users with profiles`);
      console.log('\nLogin credentials:');
      TESTABLE_TEST_ACCOUNTS.forEach(
        (acc) => console.log(`${acc.name}: ${acc.email} | ${acc.phoneNumber} | OTP: ${acc.otpCode}`)
      );
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const opts = parseArgs();

  if (opts.silent) setLevel('error');

  if (process.env.NODE_ENV === 'production') {
    console.error('❌ db:seed cannot be run in production environment');
    await closeDb();
    process.exit(1);
  }

  if (!opts.confirm) {
    console.log('⚠️  This will add mock data to the database.');
    console.log('Use --confirm to skip this warning.');
    await closeDb();
    process.exit(1);
  }

  const result = await seedDatabase(opts.type ?? 'both');

  if (!result.ok) {
    console.error('❌ Seed failed:', result.error);
    await closeDb();
    process.exit(1);
  }
}

main()
  .then(() => closeDb())
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('db-seed error:', msg);
    await closeDb();
    process.exit(1);
  });
