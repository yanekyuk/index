#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { eq } from 'drizzle-orm';
import db, { closeDb } from '../lib/drizzle/drizzle';
import { indexMembers, indexes, userProfiles, users } from '../schemas/database.schema';
import { privyClient } from '../lib/privy';
import { setLevel } from '../lib/log';
import { intentService } from '../services/intent.service';
import { TESTABLE_TEST_ACCOUNTS, TESTER_PERSONAS, TESTER_PERSONAS_MAX } from './test-data';
import type { SeedProfile, TesterPersona } from './test-data';
import type { Id } from '../types/common.types';

/** Minimal account shape for user creation (real or synthetic). */
interface SeedAccount {
  email: string;
  name: string;
  linkedin?: string | null;
  github?: string | null;
  x?: string | null;
  website?: string | null;
}

// ── Index definitions ───────────────────────────────────────────────────────

interface IndexDef {
  id: Id<'indexes'>;
  title: string;
  prompt: string | null;
  joinPolicy: 'anyone' | 'invite_only';
}

/** Use full persona list from test-data (up to TESTER_PERSONAS_MAX). */
const DB_SEED_TESTER_PERSONAS = TESTER_PERSONAS;

const SEED_INDEXES: IndexDef[] = [
  // General-purpose indexes (null prompts = auto-assign, no LLM evaluation)
  {
    id: '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c',
    title: 'Commons',
    prompt: null,
    joinPolicy: 'anyone',
  },
  {
    id: '99999999-d64e-4ef9-8bcf-6c89815f771c',
    title: 'Vault',
    prompt: null,
    joinPolicy: 'invite_only',
  },

  // Categorical indexes (prompts trigger LLM evaluation for intent filtering)
  {
    id: 'aaaaaaaa-0001-4000-8000-000000000001',
    title: 'Stack',
    prompt: 'Software engineering, programming, coding projects, developer tools, and technical implementation',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0002-4000-8000-000000000002',
    title: 'Latent',
    prompt: 'Artificial intelligence, machine learning, deep learning, LLMs, neural networks, and data science',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0003-4000-8000-000000000003',
    title: 'Pixel',
    prompt: 'UI/UX design, graphic design, creative projects, branding, and visual communication',
    joinPolicy: 'invite_only',
  },
  {
    id: 'aaaaaaaa-0004-4000-8000-000000000004',
    title: 'Launch',
    prompt: 'Startups, entrepreneurship, business strategy, fundraising, and go-to-market',
    joinPolicy: 'anyone',
  },

  // Non-business / lifestyle indexes
  {
    id: 'aaaaaaaa-0005-4000-8000-000000000005',
    title: 'Atelier',
    prompt: 'Visual art, illustration, music, writing, performance art, crafts, and creative projects',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0006-4000-8000-000000000006',
    title: 'Arena',
    prompt: 'Video games, tabletop RPGs, streaming, esports, game development, and gaming community',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0007-4000-8000-000000000007',
    title: 'Syllabus',
    prompt: 'Teaching, tutoring, education, learning, academic research, and knowledge sharing',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0008-4000-8000-000000000008',
    title: 'Reps',
    prompt: 'Sports, fitness, running, cycling, climbing, swimming, coaching, and athletic activities',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0009-4000-8000-000000000009',
    title: 'Tribe',
    prompt: 'Community organizing, volunteering, mutual aid, local initiatives, and civic engagement',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-000a-4000-8000-00000000000a',
    title: 'Bench',
    prompt: 'Hobbies, makers, DIY, ceramics, cooking, photography, and hands-on projects',
    joinPolicy: 'anyone',
  },
];

// ── CLI flags ───────────────────────────────────────────────────────────────

const PERSONAS_DEFAULT = 10;

type GlobalOpts = {
  silent?: boolean;
  confirm?: boolean;
  /** Number of tester personas to seed (0–TESTER_PERSONAS_MAX). Default PERSONAS_DEFAULT. */
  personas: number;
};

function parseArgs(): GlobalOpts {
  const args = process.argv.slice(2);
  let personas = PERSONAS_DEFAULT;
  const personasArg = args.find((a) => a.startsWith('--personas='));
  if (personasArg) {
    const value = parseInt(personasArg.split('=')[1], 10);
    if (!Number.isNaN(value)) {
      personas = Math.max(0, Math.min(TESTER_PERSONAS_MAX, value));
    }
  }
  return {
    silent: args.includes('--silent'),
    confirm: args.includes('--confirm'),
    personas,
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

async function createUser(account: SeedAccount): Promise<{ id: string }> {
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
    const [byEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, account.email)).limit(1);
    if (byEmail) return byEmail;
    const [byPrivyId] = await db.select({ id: users.id }).from(users).where(eq(users.privyId, privyId)).limit(1);
    if (byPrivyId) return byPrivyId;
    throw new Error(`createUser failed for ${account.email}: insert failed and no existing user found by email or privyId`);
  }
}

/**
 * Create or get users for the given accounts and ensure they are members of all seed indexes.
 * @param accounts - List of accounts (real or synthetic).
 * @param options.ownerIndex - Index in this array that receives 'owner' on all indexes; others get 'member'. Omit for all 'member'.
 */
async function ensureUsersAndMemberships(
  accounts: SeedAccount[],
  options: { ownerIndex?: number } = {}
): Promise<{ id: string }[]> {
  const { ownerIndex } = options;
  const createdUsers: { id: string }[] = [];
  for (const [i, account] of accounts.entries()) {
    const user = await createUser(account);
    createdUsers.push(user);
    const role = ownerIndex !== undefined && i === ownerIndex ? 'owner' : 'member';
    for (const idx of SEED_INDEXES) {
      try {
        await db.insert(indexMembers).values({
          indexId: idx.id,
          userId: user.id,
          permissions: role === 'owner' ? ['owner'] : ['member'],
          prompt: null,
          autoAssign: true,
        });
      } catch {
        /* already exists */
      }
    }
  }
  return createdUsers;
}

/** Idempotent upsert of user_profiles by userId. Used for synthetic testers before intent graph. */
async function upsertUserProfile(userId: string, profile: SeedProfile): Promise<void> {
  const now = new Date();
  await db
    .insert(userProfiles)
    .values({
      userId,
      identity: profile.identity,
      narrative: profile.narrative,
      attributes: profile.attributes,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        identity: profile.identity,
        narrative: profile.narrative,
        attributes: profile.attributes,
        updatedAt: now,
      },
    });
}

// ── Seed logic ──────────────────────────────────────────────────────────────

async function seedDatabase(): Promise<{ ok: boolean; error?: string }> {
  const opts = parseArgs();
  const { silent, personas: personasLimit } = opts;
  const personasToSeed = personasLimit === 0 ? [] : DB_SEED_TESTER_PERSONAS.slice(0, personasLimit);

  try {
    if (!silent) console.log('Seeding indexes and users...');
    if (!silent && DB_SEED_TESTER_PERSONAS.length > 0) console.log(`  Personas to seed: ${personasToSeed.length} (--personas=${personasLimit}, max ${TESTER_PERSONAS_MAX})`);

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

    // Real test accounts (first is owner of all indexes)
    const realAccounts: SeedAccount[] = TESTABLE_TEST_ACCOUNTS.map((acc) => ({
      email: acc.email,
      name: acc.name,
      linkedin: acc.linkedin ?? null,
      github: acc.github ?? null,
      x: acc.x ?? null,
      website: acc.website ?? null,
    }));
    const realUsers = await ensureUsersAndMemberships(realAccounts, { ownerIndex: 0 });

    // Synthetic tester personas (all members); count controlled by --personas
    const personaAccounts: SeedAccount[] = personasToSeed.map((p) => ({
      email: p.email,
      name: p.name,
      linkedin: p.linkedin ?? null,
      github: p.github ?? null,
      x: p.x ?? null,
      website: p.website ?? null,
    }));
    const personaUsers = await ensureUsersAndMemberships(personaAccounts);

    // Upsert profiles for synthetic testers (required for intent graph write mode)
    let profilesUpserted = 0;
    for (let i = 0; i < personaUsers.length && i < personasToSeed.length; i++) {
      await upsertUserProfile(personaUsers[i].id, personasToSeed[i].profile);
      profilesUpserted++;
    }

    // Create intents for synthetic testers via intent graph (enqueues HyDE + opportunity discovery)
    let intentsProcessed = 0;
    let intentFailures = 0;
    for (let i = 0; i < personaUsers.length && i < personasToSeed.length; i++) {
      const userId = personaUsers[i].id;
      const persona = personasToSeed[i];
      const userProfileJson = JSON.stringify(persona.profile);
      for (const intentText of persona.intents) {
        try {
          await intentService.processIntent(userId, userProfileJson, intentText);
          intentsProcessed++;
        } catch (err) {
          intentFailures++;
          if (!silent) {
            console.warn(`  Intent failed for ${persona.name}: ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`);
          }
        }
      }
    }

    if (!silent) {
      console.log(`  ${realUsers.length} real users ready`);
      console.log(`  ${personaUsers.length} synthetic tester users ready`);
      console.log(`  ${profilesUpserted} tester profiles upserted`);
      console.log(`  ${intentsProcessed} intents processed via graph${intentFailures > 0 ? ` (${intentFailures} failed)` : ''}`);
      console.log('\nLogin credentials (real accounts):');
      TESTABLE_TEST_ACCOUNTS.forEach(
        (acc) => console.log(`  ${acc.name}: ${acc.email} | ${acc.phoneNumber} | OTP: ${acc.otpCode}`)
      );
      console.log('\nIndexes:');
      for (const idx of SEED_INDEXES) {
        const label = idx.prompt ? `prompt: "${idx.prompt}"` : 'no prompt (auto-assign)';
        console.log(`  ${idx.title} [${idx.joinPolicy}] -- ${label}`);
      }
      console.log('\nNote: Queue workers (e.g. via `bun run dev`) must be running for intent HyDE and opportunity-discovery jobs to run after seed.');
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
