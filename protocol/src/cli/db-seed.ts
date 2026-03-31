#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
import { eq, sql } from 'drizzle-orm';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import db, { closeDb } from '../lib/drizzle/drizzle';
import { indexMembers, indexes, userProfiles, users } from '../schemas/database.schema';
import { setLevel } from '../lib/log';
import { intentService } from '../services/intent.service';
import { profileService } from '../services/profile.service';
import { profileQueue } from '../queues/profile.queue';
import type { Id } from '../types/common.types';

import { toKebabKey } from '../lib/keys';
import { TESTER_PERSONAS, TESTER_PERSONAS_MAX } from './test-data';
import type { SeedProfile } from './test-data';

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
  key: string;
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
    key: 'commons',
    prompt: null,
    joinPolicy: 'anyone',
  },
  {
    id: '99999999-d64e-4ef9-8bcf-6c89815f771c',
    title: 'Vault',
    key: 'vault',
    prompt: null,
    joinPolicy: 'invite_only',
  },

  // Categorical indexes (prompts trigger LLM evaluation for intent filtering)
  {
    id: 'aaaaaaaa-0001-4000-8000-000000000001',
    title: 'Stack',
    key: 'stack',
    prompt: 'Software engineering, programming, coding projects, developer tools, and technical implementation',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0002-4000-8000-000000000002',
    title: 'Latent',
    key: 'latent',
    prompt: 'Artificial intelligence, machine learning, deep learning, LLMs, neural networks, and data science',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0003-4000-8000-000000000003',
    title: 'Pixel',
    key: 'pixel',
    prompt: 'UI/UX design, graphic design, creative projects, branding, and visual communication',
    joinPolicy: 'invite_only',
  },
  {
    id: 'aaaaaaaa-0004-4000-8000-000000000004',
    title: 'Launch',
    key: 'launch',
    prompt: 'Startups, entrepreneurship, business strategy, fundraising, and go-to-market',
    joinPolicy: 'anyone',
  },

  // Non-business / lifestyle indexes
  {
    id: 'aaaaaaaa-0005-4000-8000-000000000005',
    title: 'Atelier',
    key: 'atelier',
    prompt: 'Visual art, illustration, music, writing, performance art, crafts, and creative projects',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0006-4000-8000-000000000006',
    title: 'Arena',
    key: 'arena',
    prompt: 'Video games, tabletop RPGs, streaming, esports, game development, and gaming community',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0007-4000-8000-000000000007',
    title: 'Syllabus',
    key: 'syllabus',
    prompt: 'Teaching, tutoring, education, learning, academic research, and knowledge sharing',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0008-4000-8000-000000000008',
    title: 'Reps',
    key: 'reps',
    prompt: 'Sports, fitness, running, cycling, climbing, swimming, coaching, and athletic activities',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0009-4000-8000-000000000009',
    title: 'Tribe',
    key: 'tribe',
    prompt: 'Community organizing, volunteering, mutual aid, local initiatives, and civic engagement',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-000a-4000-8000-00000000000a',
    title: 'Bench',
    key: 'bench',
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

async function createUser(account: SeedAccount): Promise<{ id: string }> {
  const socials = {
    linkedin: account.linkedin ?? undefined,
    github: account.github ?? undefined,
    x: account.x ?? undefined,
    websites: account.website ? [account.website] : [],
  };

  const normalizedEmail = account.email.toLowerCase().trim();
  try {
    const [user] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        name: account.name,
        intro: `Test account for ${account.name}`,
        socials,
        onboarding: {},
      })
      .returning({ id: users.id });
    return user!;
  } catch {
    const [byEmail] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${normalizedEmail}`).limit(1);
    if (byEmail) return byEmail;
    throw new Error(`createUser failed for ${normalizedEmail}: insert failed and no existing user found by email`);
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
    if (!silent) console.log('Creating indexes...');

    // Create all indexes
    let _indexesCreated = 0;
    let _indexesExisted = 0;
    for (let i = 0; i < SEED_INDEXES.length; i++) {
      const idx = SEED_INDEXES[i];
      try {
        await db.insert(indexes).values({
          id: idx.id,
          title: idx.title,
          key: idx.key,
          prompt: idx.prompt,
          permissions: {
            joinPolicy: idx.joinPolicy,
            invitationLink: null,
            allowGuestVibeCheck: false,
          },
        });
        _indexesCreated++;
        if (!silent) console.log(`  Index ${i + 1}/${SEED_INDEXES.length}: ${idx.title} — created`);
      } catch (err) {
        _indexesExisted++;
        if (!silent) console.log(`  Index ${i + 1}/${SEED_INDEXES.length}: ${idx.title} — already exists`);
      }
    }

    if (!silent) console.log(`  ${SEED_INDEXES.length} indexes ready`);

    if (!silent) console.log(`Creating synthetic persona users (1..${personasToSeed.length})...`);
    // Synthetic tester personas (first is owner of all indexes); count controlled by --personas
    const personaAccounts: SeedAccount[] = personasToSeed.map((p) => ({
      email: p.email,
      name: p.name,
      linkedin: p.linkedin ?? null,
      github: p.github ?? null,
      x: p.x ?? null,
      website: p.website ?? null,
    }));
    const personaUsers = await ensureUsersAndMemberships(personaAccounts, { ownerIndex: 0 });
    if (!silent) console.log(`  Persona users: ${personaUsers.length} ready`);

    if (!silent) console.log('Upserting tester profiles...');
    // Upsert profiles for synthetic testers (required for intent graph write mode)
    let profilesUpserted = 0;
    for (let i = 0; i < personaUsers.length && i < personasToSeed.length; i++) {
      await upsertUserProfile(personaUsers[i].id, personasToSeed[i].profile);
      profilesUpserted++;
      if (!silent) console.log(`  Profile ${i + 1}/${personaUsers.length}: ${personasToSeed[i].name}`);
    }
    if (!silent) console.log(`  Profiles upserted: ${profilesUpserted}`);

    if (!silent) console.log('Enqueueing profile HyDE jobs for index members...');
    let successfulEnqueues = 0;
    for (const user of personaUsers) {
      try {
        await profileQueue.addEnsureProfileHydeJob({ userId: user.id });
        successfulEnqueues++;
      } catch (err) {
        if (!silent) console.warn(`  Failed to enqueue ensure_profile_hyde for ${user.id}:`, err);
      }
    }
    if (!silent) console.log(`  Enqueued ${successfulEnqueues} profile HyDE job(s). Run workers (e.g. bun run dev) to process them.`);

    if (!silent) console.log('Embedding profiles (and generating HyDE)...');
    for (let i = 0; i < personaUsers.length && i < personasToSeed.length; i++) {
      if (!silent) console.log(`  Embedding ${i + 1}/${personaUsers.length}: ${personasToSeed[i].name}`);
    }
    const { embedded, embedFailures } = await profileService.embedTesterProfiles(personaUsers, personasToSeed);
    if (!silent) console.log(`  Profiles embedded: ${embedded}${embedFailures > 0 ? ` (${embedFailures} failed)` : ''}`);

    // Create intents with embedding + HyDE inline (no intent graph, no opportunity discovery)
    if (!silent) console.log('Creating intents (embed + HyDE, no opportunity matching)...');
    let intentsProcessed = 0;
    let intentFailures = 0;
    for (let i = 0; i < personaUsers.length && i < personasToSeed.length; i++) {
      const userId = personaUsers[i].id;
      const persona = personasToSeed[i];
      if (!silent) console.log(`  Persona ${i + 1}/${personaUsers.length}: ${persona.name} — intents 1..${persona.intents.length}`);
      for (const intentText of persona.intents) {
        try {
          await intentService.createIntentForSeed(userId, intentText);
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
      console.log(`  ${personaUsers.length} synthetic tester users ready`);
      console.log(`  ${profilesUpserted} tester profiles upserted`);
      console.log(`  ${embedded} profiles embedded (profile + HyDE)${embedFailures > 0 ? ` (${embedFailures} failed)` : ''}`);
      console.log(`  ${intentsProcessed} intents created (embed + HyDE, no opportunities)${intentFailures > 0 ? ` (${intentFailures} failed)` : ''}`);
      console.log('\nIndexes:');
      for (const idx of SEED_INDEXES) {
        const label = idx.prompt ? `prompt: "${idx.prompt}"` : 'no prompt (auto-assign)';
        console.log(`  ${idx.title} [${idx.joinPolicy}] -- ${label}`);
      }
      console.log('\nNote: Seed does not run opportunity discovery (no matching between test users).');
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
