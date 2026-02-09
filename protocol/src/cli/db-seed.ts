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
import type { Id } from '../types/common.types';

// ── Index definitions ───────────────────────────────────────────────────────

interface IndexDef {
  id: Id<'indexes'>;
  title: string;
  prompt: string | null;
  joinPolicy: 'anyone' | 'invite_only';
}

const SEED_INDEXES: IndexDef[] = [
  // General-purpose indexes (null prompts = auto-assign, no LLM evaluation)
  {
    id: '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c',
    title: 'Open Mock Network',
    prompt: null,
    joinPolicy: 'anyone',
  },
  {
    id: '99999999-d64e-4ef9-8bcf-6c89815f771c',
    title: 'Private Mock Network',
    prompt: null,
    joinPolicy: 'invite_only',
  },

  // Categorical indexes (prompts trigger LLM evaluation for intent filtering)
  {
    id: 'aaaaaaaa-0001-4000-8000-000000000001',
    title: 'Coding & Development',
    prompt: 'Software engineering, programming, coding projects, developer tools, and technical implementation',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0002-4000-8000-000000000002',
    title: 'AI & Machine Learning',
    prompt: 'Artificial intelligence, machine learning, deep learning, LLMs, neural networks, and data science',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0003-4000-8000-000000000003',
    title: 'Design & Creative',
    prompt: 'UI/UX design, graphic design, creative projects, branding, and visual communication',
    joinPolicy: 'invite_only',
  },
  {
    id: 'aaaaaaaa-0004-4000-8000-000000000004',
    title: 'Startup & Business',
    prompt: 'Startups, entrepreneurship, business strategy, fundraising, and go-to-market',
    joinPolicy: 'anyone',
  },
];

// ── CLI flags ───────────────────────────────────────────────────────────────

type GlobalOpts = {
  silent?: boolean;
  confirm?: boolean;
};

function parseArgs(): GlobalOpts {
  const args = process.argv.slice(2);
  return {
    silent: args.includes('--silent'),
    confirm: args.includes('--confirm'),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Seed logic ──────────────────────────────────────────────────────────────

async function seedDatabase(): Promise<{ ok: boolean; error?: string }> {
  const silent = parseArgs().silent;

  try {
    if (!silent) console.log('Seeding indexes and users...');

    // Create all indexes
    for (const idx of SEED_INDEXES) {
      try {
        await db.insert(indexes).values({
          id: idx.id,
          title: idx.title,
          prompt: idx.prompt,
          isPersonal: false,
          permissions: {
            joinPolicy: idx.joinPolicy,
            invitationLink: null,
            allowGuestVibeCheck: false,
          },
        });
      } catch {
        /* already exists */
      }
    }

    if (!silent) console.log(`  ${SEED_INDEXES.length} indexes ready`);

    // Create users and add them to every index
    const createdUsers: { id: string }[] = [];

    for (const [i, account] of TESTABLE_TEST_ACCOUNTS.entries()) {
      const user = await createUser(account);
      createdUsers.push(user);

      for (const idx of SEED_INDEXES) {
        try {
          await db.insert(indexMembers).values({
            indexId: idx.id,
            userId: user.id,
            permissions: i === 0 ? ['owner'] : ['member'],
            prompt: null,       // rely on index-level prompt only
            autoAssign: true,
          });
        } catch {
          /* already exists */
        }
      }
    }

    if (!silent) {
      console.log(`  ${createdUsers.length} users ready`);
      console.log('\nLogin credentials:');
      TESTABLE_TEST_ACCOUNTS.forEach(
        (acc) => console.log(`  ${acc.name}: ${acc.email} | ${acc.phoneNumber} | OTP: ${acc.otpCode}`)
      );
      console.log('\nIndexes:');
      for (const idx of SEED_INDEXES) {
        const label = idx.prompt ? `prompt: "${idx.prompt}"` : 'no prompt (auto-assign)';
        console.log(`  ${idx.title} [${idx.joinPolicy}] -- ${label}`);
      }
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  if (opts.silent) setLevel('error');

  if (process.env.NODE_ENV === 'production') {
    console.error('db:seed cannot be run in production environment');
    await closeDb();
    process.exit(1);
  }

  if (!opts.confirm) {
    console.log('This will add mock data to the database.');
    console.log('Use --confirm to skip this warning.');
    await closeDb();
    process.exit(1);
  }

  const result = await seedDatabase();

  if (!result.ok) {
    console.error('Seed failed:', result.error);
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
