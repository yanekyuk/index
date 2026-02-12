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
import { TESTABLE_TEST_ACCOUNTS } from './test-data';
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

const DB_SEED_TESTER_PERSONAS: TesterPersona[] = [
  {
    name: 'Alex Chen',
    email: 'seed-tester-1@index-network.test',
    linkedin: 'https://linkedin.com/in/alexchen-dev',
    github: 'https://github.com/alexchen',
    x: null,
    website: null,
    profile: {
      identity: {
        name: 'Alex Chen',
        bio: 'Full-stack engineer focused on React and Node. Building developer tools.',
        location: 'San Francisco, CA',
      },
      narrative: { context: 'Previously at a YC startup. Exploring a B2B workflow automation product.' },
      attributes: {
        interests: ['startups', 'developer tools', 'open source'],
        skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
      },
    },
    intents: [
      'Looking for a technical co-founder with strong backend and product sense for a workflow automation startup.',
      'I want to meet engineers who enjoy building open-source tooling for developers.',
    ],
  },
  {
    name: 'Jordan Lee',
    email: 'seed-tester-2@index-network.test',
    linkedin: 'https://linkedin.com/in/jordanlee-design',
    github: null,
    x: 'https://x.com/jordanleedesign',
    website: null,
    profile: {
      identity: {
        name: 'Jordan Lee',
        bio: 'Product designer with 8 years in fintech and health tech.',
        location: 'New York, NY',
      },
      narrative: { context: 'Design lead trying to launch a consumer finance app with stronger UX and trust.' },
      attributes: {
        interests: ['fintech', 'health tech', 'design systems'],
        skills: ['Figma', 'UX research', 'prototyping', 'design systems'],
      },
    },
    intents: [
      'Seeking a technical co-founder to launch a fintech product where I lead product and design.',
      'Looking for a frontend engineer passionate about accessibility in health-related apps.',
    ],
  },
  {
    name: 'Sam Rivera',
    email: 'seed-tester-3@index-network.test',
    linkedin: 'https://linkedin.com/in/samrivera-ml',
    github: 'https://github.com/samrivera',
    x: null,
    website: null,
    profile: {
      identity: {
        name: 'Sam Rivera',
        bio: 'ML engineer focused on NLP and recommendation systems.',
        location: 'Austin, TX',
      },
      narrative: { context: 'Exploring AI startup ideas in vertical SaaS and searching for domain experts.' },
      attributes: {
        interests: ['machine learning', 'LLMs', 'recommendation systems'],
        skills: ['Python', 'PyTorch', 'vector search', 'LangChain'],
      },
    },
    intents: [
      'Looking for a co-founder with data engineering experience to build an AI analytics product.',
      'I want to collaborate with a product founder on an LLM-based workflow assistant.',
    ],
  },
  {
    name: 'Morgan Taylor',
    email: 'seed-tester-4@index-network.test',
    linkedin: null,
    github: 'https://github.com/morgantaylor',
    x: 'https://x.com/morgantaylor',
    website: 'https://morgantaylor.dev',
    profile: {
      identity: {
        name: 'Morgan Taylor',
        bio: 'Indie hacker and solo founder shipping small SaaS products.',
        location: 'Remote',
      },
      narrative: { context: 'Growing a profitable side project and considering a strategic partner.' },
      attributes: {
        interests: ['indie hacking', 'SaaS', 'content creation'],
        skills: ['Next.js', 'Stripe', 'SEO', 'writing'],
      },
    },
    intents: [
      'Seeking a growth-focused collaborator for an existing self-serve SaaS product.',
      'Open to conversations with founders interested in acquiring or partnering on my app.',
    ],
  },
  {
    name: 'Riley Kim',
    email: 'seed-tester-5@index-network.test',
    linkedin: 'https://linkedin.com/in/rileykim',
    github: null,
    x: null,
    website: null,
    profile: {
      identity: {
        name: 'Riley Kim',
        bio: 'Product manager with background in edtech and marketplaces.',
        location: 'Seattle, WA',
      },
      narrative: { context: 'Validating an education marketplace and assembling an early founding team.' },
      attributes: {
        interests: ['edtech', 'marketplaces', 'community'],
        skills: ['product strategy', 'roadmapping', 'user research', 'SQL'],
      },
    },
    intents: [
      'Looking for a technical co-founder for an adult learning marketplace startup.',
      'I want to meet a designer and engineer who can co-build an education platform MVP.',
    ],
  },
  {
    name: 'Priya Nair',
    email: 'seed-tester-6@index-network.test',
    linkedin: 'https://linkedin.com/in/priyanair-data',
    github: 'https://github.com/priyanair',
    x: null,
    website: null,
    profile: {
      identity: {
        name: 'Priya Nair',
        bio: 'Data engineer building reliable analytics pipelines for growth teams.',
        location: 'Chicago, IL',
      },
      narrative: { context: 'Leaving consulting to join a mission-driven startup as first data hire.' },
      attributes: {
        interests: ['analytics engineering', 'product metrics', 'experimentation'],
        skills: ['SQL', 'dbt', 'Airflow', 'BigQuery'],
      },
    },
    intents: [
      'Seeking an early-stage startup that needs a first data engineer to build analytics foundations.',
      'Looking for founders tackling product-led growth who want help with experimentation and metrics.',
    ],
  },
  {
    name: 'Noah Williams',
    email: 'seed-tester-7@index-network.test',
    linkedin: 'https://linkedin.com/in/noahw-frontend',
    github: 'https://github.com/noahwilliams',
    x: 'https://x.com/noahcodes',
    website: 'https://noahw.dev',
    profile: {
      identity: {
        name: 'Noah Williams',
        bio: 'Frontend engineer specializing in complex interfaces and performance.',
        location: 'Denver, CO',
      },
      narrative: { context: 'Interested in design-heavy products where frontend quality is a differentiator.' },
      attributes: {
        interests: ['frontend architecture', 'design systems', 'web performance'],
        skills: ['React', 'TypeScript', 'Next.js', 'Storybook'],
      },
    },
    intents: [
      'Looking for a startup team building a polished B2B dashboard product that needs a senior frontend engineer.',
      'I want to collaborate with a product designer to craft a reusable design system for a new SaaS.',
    ],
  },
  {
    name: 'Elena Petrova',
    email: 'seed-tester-8@index-network.test',
    linkedin: 'https://linkedin.com/in/elenapetrova-ai',
    github: 'https://github.com/elenapetrova',
    x: null,
    website: null,
    profile: {
      identity: {
        name: 'Elena Petrova',
        bio: 'Applied AI researcher turning language models into production workflows.',
        location: 'Boston, MA',
      },
      narrative: { context: 'Building an AI operations toolkit and looking for technical collaborators.' },
      attributes: {
        interests: ['applied AI', 'agent workflows', 'evaluation tooling'],
        skills: ['Python', 'evaluation design', 'RAG', 'MLOps'],
      },
    },
    intents: [
      'Seeking an engineer experienced with distributed systems to co-build an AI operations platform.',
      'Looking for design partners who want to pilot LLM evaluation workflows in real teams.',
    ],
  },
  {
    name: 'Diego Alvarez',
    email: 'seed-tester-9@index-network.test',
    linkedin: 'https://linkedin.com/in/diegoalvarez-growth',
    github: null,
    x: 'https://x.com/diegoongrowth',
    website: null,
    profile: {
      identity: {
        name: 'Diego Alvarez',
        bio: 'Growth marketer with SaaS and marketplace launch experience.',
        location: 'Miami, FL',
      },
      narrative: { context: 'Joining technical founders as first GTM hire and building repeatable demand generation.' },
      attributes: {
        interests: ['growth loops', 'PLG', 'content distribution'],
        skills: ['positioning', 'paid acquisition', 'lifecycle marketing', 'analytics'],
      },
    },
    intents: [
      'Looking for technical founders with a launched product who need a growth partner for early traction.',
      'Open to collaborating with B2B SaaS teams on positioning and go-to-market experiments.',
    ],
  },
  {
    name: 'Hannah Brooks',
    email: 'seed-tester-10@index-network.test',
    linkedin: 'https://linkedin.com/in/hannahbrooks-devrel',
    github: 'https://github.com/hbrooks',
    x: 'https://x.com/hannahdevrel',
    website: null,
    profile: {
      identity: {
        name: 'Hannah Brooks',
        bio: 'Developer relations lead connecting engineers with useful tools.',
        location: 'Portland, OR',
      },
      narrative: { context: 'Exploring startup opportunities where community-led growth is core to the strategy.' },
      attributes: {
        interests: ['developer community', 'education', 'content'],
        skills: ['technical writing', 'public speaking', 'community strategy', 'APIs'],
      },
    },
    intents: [
      'Seeking a developer tools startup that needs early DevRel leadership and community building.',
      'I want to partner with engineering founders who care about docs, education, and developer experience.',
    ],
  },
  {
    name: 'Marcus Johnson',
    email: 'seed-tester-11@index-network.test',
    linkedin: 'https://linkedin.com/in/marcusjohnson-security',
    github: 'https://github.com/marcusj',
    x: null,
    website: null,
    profile: {
      identity: {
        name: 'Marcus Johnson',
        bio: 'Security engineer focused on cloud security and compliance automation.',
        location: 'Atlanta, GA',
      },
      narrative: { context: 'Helping early startups become enterprise-ready without slowing product velocity.' },
      attributes: {
        interests: ['security automation', 'compliance', 'cloud infrastructure'],
        skills: ['AWS', 'threat modeling', 'SOC2', 'policy as code'],
      },
    },
    intents: [
      'Looking for B2B SaaS founders preparing for enterprise sales who need security guidance.',
      'Seeking collaborators building tools that automate security and compliance workflows.',
    ],
  },
  {
    name: 'Mei Lin',
    email: 'seed-tester-12@index-network.test',
    linkedin: 'https://linkedin.com/in/meilin-mobile',
    github: 'https://github.com/meilin',
    x: null,
    website: 'https://meilin.app',
    profile: {
      identity: {
        name: 'Mei Lin',
        bio: 'Mobile engineer building high-quality iOS and Android experiences.',
        location: 'Los Angeles, CA',
      },
      narrative: { context: 'Exploring consumer health and habit products with strong retention loops.' },
      attributes: {
        interests: ['consumer mobile', 'health tech', 'behavior design'],
        skills: ['Swift', 'Kotlin', 'React Native', 'mobile analytics'],
      },
    },
    intents: [
      'Seeking a product founder to build a habit-forming mobile health app with measurable outcomes.',
      'Looking for designers experienced in consumer onboarding and retention for a mobile product.',
    ],
  },
  {
    name: 'Arjun Patel',
    email: 'seed-tester-13@index-network.test',
    linkedin: 'https://linkedin.com/in/arjunpatel-finance',
    github: null,
    x: null,
    website: null,
    profile: {
      identity: {
        name: 'Arjun Patel',
        bio: 'Finance operator supporting startup fundraising and planning.',
        location: 'New York, NY',
      },
      narrative: { context: 'Partnering with technical teams that need help with pricing, forecasts, and fundraising prep.' },
      attributes: {
        interests: ['fundraising', 'business models', 'unit economics'],
        skills: ['financial modeling', 'pricing strategy', 'investor relations', 'FP&A'],
      },
    },
    intents: [
      'Looking for startup founders who need a finance partner to prepare for seed fundraising.',
      'Open to advising teams on pricing and unit economics for B2B SaaS launches.',
    ],
  },
  {
    name: 'Sofia Martinez',
    email: 'seed-tester-14@index-network.test',
    linkedin: 'https://linkedin.com/in/sofiamartinez-product',
    github: null,
    x: 'https://x.com/sofiaproduct',
    website: null,
    profile: {
      identity: {
        name: 'Sofia Martinez',
        bio: 'Product leader with marketplace and trust-and-safety experience.',
        location: 'Mexico City, MX',
      },
      narrative: { context: 'Designing a creator marketplace and searching for technical co-founders.' },
      attributes: {
        interests: ['creator economy', 'marketplaces', 'trust and safety'],
        skills: ['product discovery', 'roadmapping', 'experimentation', 'operations'],
      },
    },
    intents: [
      'Seeking a backend engineer to co-found a creator marketplace with built-in trust and safety.',
      'Looking for growth-minded operators interested in two-sided marketplace dynamics.',
    ],
  },
  {
    name: 'Liam O\'Connor',
    email: 'seed-tester-15@index-network.test',
    linkedin: 'https://linkedin.com/in/liamoconnor-ops',
    github: 'https://github.com/liamops',
    x: null,
    website: null,
    profile: {
      identity: {
        name: 'Liam O\'Connor',
        bio: 'Platform engineer who scales infrastructure for high-growth products.',
        location: 'Dublin, IE',
      },
      narrative: { context: 'Interested in joining infrastructure-heavy startups as an early engineering leader.' },
      attributes: {
        interests: ['platform engineering', 'observability', 'reliability'],
        skills: ['Kubernetes', 'Terraform', 'Go', 'SRE'],
      },
    },
    intents: [
      'Looking for teams building developer or infrastructure products that need an early platform engineer.',
      'Open to partnering with founders on reliability architecture before scale bottlenecks appear.',
    ],
  },
  {
    name: 'Chloe Bennett',
    email: 'seed-tester-16@index-network.test',
    linkedin: 'https://linkedin.com/in/chloebennett-ux',
    github: null,
    x: null,
    website: 'https://chloebennett.design',
    profile: {
      identity: {
        name: 'Chloe Bennett',
        bio: 'UX researcher and service designer for public-sector digital products.',
        location: 'London, UK',
      },
      narrative: { context: 'Working on civic tech ideas that improve access to local services.' },
      attributes: {
        interests: ['civic tech', 'user research', 'accessibility'],
        skills: ['qualitative research', 'journey mapping', 'prototyping', 'service design'],
      },
    },
    intents: [
      'Seeking a technical collaborator to build civic tech tools for local government services.',
      'Looking for teams who prioritize inclusive UX and accessibility from day one.',
    ],
  },
  {
    name: 'Omar Haddad',
    email: 'seed-tester-17@index-network.test',
    linkedin: 'https://linkedin.com/in/omarhaddad-mlops',
    github: 'https://github.com/omarhaddad',
    x: 'https://x.com/omarmlops',
    website: null,
    profile: {
      identity: {
        name: 'Omar Haddad',
        bio: 'MLOps engineer productionizing model training and inference systems.',
        location: 'Berlin, DE',
      },
      narrative: { context: 'Seeking high-velocity AI teams that need reliable deployment and monitoring pipelines.' },
      attributes: {
        interests: ['MLOps', 'model serving', 'observability'],
        skills: ['Docker', 'Kubernetes', 'PyTorch', 'CI/CD'],
      },
    },
    intents: [
      'Looking for AI startups that need a founding MLOps engineer to ship models safely to production.',
      'Open to collaborating with ML researchers who want robust evaluation and deployment infrastructure.',
    ],
  },
  {
    name: 'Amina Yusuf',
    email: 'seed-tester-18@index-network.test',
    linkedin: 'https://linkedin.com/in/aminayusuf-community',
    github: null,
    x: 'https://x.com/aminacommunity',
    website: null,
    profile: {
      identity: {
        name: 'Amina Yusuf',
        bio: 'Community strategist helping mission-driven products build engaged user bases.',
        location: 'Lagos, NG',
      },
      narrative: { context: 'Building a network-focused startup and seeking technical and product collaborators.' },
      attributes: {
        interests: ['community growth', 'creator tools', 'social products'],
        skills: ['community operations', 'event design', 'content strategy', 'partnerships'],
      },
    },
    intents: [
      'Seeking a technical co-founder for a community platform focused on creator collaboration.',
      'Looking for product builders who understand network effects and social product design.',
    ],
  },
  {
    name: 'Ethan Park',
    email: 'seed-tester-19@index-network.test',
    linkedin: 'https://linkedin.com/in/ethanpark-bio',
    github: 'https://github.com/ethanparkbio',
    x: null,
    website: null,
    profile: {
      identity: {
        name: 'Ethan Park',
        bio: 'Bioinformatics engineer turning clinical data into decision support tools.',
        location: 'San Diego, CA',
      },
      narrative: { context: 'Exploring healthcare data products and looking for regulatory-aware co-founders.' },
      attributes: {
        interests: ['digital health', 'clinical data', 'AI in healthcare'],
        skills: ['Python', 'biostatistics', 'ETL', 'healthcare data standards'],
      },
    },
    intents: [
      'Looking for a clinician-founder interested in building practical decision-support software.',
      'Seeking engineers and operators experienced with healthcare compliance and privacy constraints.',
    ],
  },
  {
    name: 'Grace Howard',
    email: 'seed-tester-20@index-network.test',
    linkedin: 'https://linkedin.com/in/gracehoward-enterprise',
    github: null,
    x: null,
    website: null,
    profile: {
      identity: {
        name: 'Grace Howard',
        bio: 'Enterprise sales lead scaling B2B SaaS from first deal to repeatable pipeline.',
        location: 'Toronto, CA',
      },
      narrative: { context: 'Partnering with technical founders who need customer discovery and enterprise GTM support.' },
      attributes: {
        interests: ['enterprise SaaS', 'sales enablement', 'customer discovery'],
        skills: ['B2B sales', 'pipeline building', 'buyer research', 'GTM strategy'],
      },
    },
    intents: [
      'Seeking early-stage SaaS founders who want a partner for enterprise customer discovery and pilot deals.',
      'Open to joining a startup where sales strategy and founder-led GTM are top priorities.',
    ],
  },
];

const TESTER_PERSONAS_MAX = DB_SEED_TESTER_PERSONAS.length;

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
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, account.email)).limit(1);
    return existing!;
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
