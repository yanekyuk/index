export const TESTABLE_TEST_ACCOUNTS = [
  {
    name: 'Seren Sandikci',
    email: 'test-1761@privy.io',
    phoneNumber: '+1 555 555 5724',
    otpCode: '888893',
    linkedin: 'https://www.linkedin.com/in/serensandikci',
    github: null as string | null,
    x: 'https://x.com/serensandikci',
    website: null as string | null,
  },
  {
    name: 'Seref Yarar',
    email: 'test-9716@privy.io',
    phoneNumber: '+1 555 555 2920',
    otpCode: '670543',
    linkedin: 'https://www.linkedin.com/in/serefyarar',
    github: 'https://github.com/serefyarar',
    x: 'https://x.com/hyperseref',
    website: null as string | null,
  },
  {
    name: 'Yanki Ekin Yüksel',
    email: 'test-6285@privy.io',
    phoneNumber: '+1 555 555 1625',
    otpCode: '607027',
    linkedin: 'https://linkedin.com/in/yanekyuk',
    github: 'https://github.com/yanekyuk',
    x: null as string | null,
    website: null as string | null,
  },
];

/** Profile payload for seed user_profiles (identity, narrative, attributes). */
export interface SeedProfile {
  identity: { name: string; bio: string; location: string };
  narrative: { context: string };
  attributes: { interests: string[]; skills: string[] };
}

/** Synthetic tester persona: account identity + profile + intents for db seed. */
export interface TesterPersona {
  name: string;
  email: string;
  linkedin?: string | null;
  github?: string | null;
  x?: string | null;
  website?: string | null;
  profile: SeedProfile;
  intents: string[];
}

/** Maximum number of tester personas that can be seeded in one run (0–100). */
export const TESTER_PERSONAS_MAX = 100;

/** First 5 hand-crafted personas; remaining 95 are generated below. */
const TESTER_PERSONAS_CORE: TesterPersona[] = [
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
      narrative: { context: 'Previously at a YC startup. Now exploring co-founder opportunities.' },
      attributes: {
        interests: ['startups', 'developer tools', 'open source'],
        skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
      },
    },
    intents: [
      'Looking for a technical co-founder with React and backend experience for a B2B SaaS.',
      'I want to find someone to build an open-source developer tool with.',
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
      narrative: { context: 'Design lead looking for a technical co-founder to ship a new product.' },
      attributes: {
        interests: ['fintech', 'health tech', 'design systems'],
        skills: ['Figma', 'UX research', 'prototyping', 'design systems'],
      },
    },
    intents: [
      'Seeking a technical co-founder to build a fintech app; I handle product and design.',
      'Looking for a developer interested in health tech and accessibility.',
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
        bio: 'ML engineer. Previously worked on recommendation systems and NLP.',
        location: 'Austin, TX',
      },
      narrative: { context: 'Exploring AI/ML startup ideas and looking for co-founders or early team.' },
      attributes: {
        interests: ['machine learning', 'LLMs', 'recommendation systems'],
        skills: ['Python', 'PyTorch', 'vector search', 'LangChain'],
      },
    },
    intents: [
      'Looking for a co-founder with ML or data engineering background for an AI product.',
      'I want to find a product-minded founder to pair with on an LLM-based B2B tool.',
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
        bio: 'Indie hacker and solo founder. Shipping small SaaS and writing about it.',
        location: 'Remote',
      },
      narrative: { context: 'Bootstrapping a second product. Open to partnerships or acquirer conversations.' },
      attributes: {
        interests: ['indie hacking', 'SaaS', 'content creation'],
        skills: ['Next.js', 'Stripe', 'SEO', 'writing'],
      },
    },
    intents: [
      'Seeking a marketing or growth co-founder for my existing SaaS.',
      'Open to talking with potential acquirers or strategic partners for my product.',
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
      narrative: { context: 'Exploring a new edtech idea and need technical and design partners.' },
      attributes: {
        interests: ['edtech', 'marketplaces', 'community'],
        skills: ['product strategy', 'roadmapping', 'user research', 'SQL'],
      },
    },
    intents: [
      'Looking for a technical co-founder for an edtech startup focused on adult learning.',
      'I want to find a designer and a developer to form a founding team for a marketplace idea.',
    ],
  },
];

const FIRST_NAMES = [
  'Avery', 'Blake', 'Casey', 'Drew', 'Emery', 'Finley', 'Gray', 'Hayden', 'Jamie', 'Kendall',
  'Logan', 'Morgan', 'Quinn', 'Reese', 'Sage', 'Skyler', 'Taylor', 'Val', 'Robin', 'Cameron',
  'Dakota', 'Jordan', 'Parker', 'Riley', 'Sydney', 'Charlie', 'Frankie', 'Harper', 'River', 'Phoenix',
  'Arlo', 'Nico', 'Kai', 'Jax', 'Leo', 'Max', 'Sam', 'Alex', 'Chris', 'Pat',
  'Devon', 'Ellis', 'Marley', 'Remi', 'Rowan', 'Shiloh', 'Stevie', 'Tatum', 'Winter', 'Zion',
];
const LAST_NAMES = [
  'Adams', 'Brooks', 'Clark', 'Davis', 'Evans', 'Foster', 'Gray', 'Hill', 'James', 'King',
  'Lee', 'Moore', 'Nguyen', 'Patel', 'Roberts', 'Singh', 'Thompson', 'Wright', 'Young', 'Zhang',
  'Chen', 'Kim', 'Martinez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris',
  'Martin', 'Garcia', 'Robinson', 'Lewis', 'Walker', 'Hall', 'Allen', 'Baker', 'Green', 'Nelson',
];
const ROLES = [
  { title: 'Software engineer', domain: 'backend and APIs', skills: ['Go', 'Python', 'PostgreSQL'], interests: ['distributed systems', 'APIs'] },
  { title: 'Frontend developer', domain: 'React and design systems', skills: ['TypeScript', 'React', 'CSS'], interests: ['UI', 'accessibility'] },
  { title: 'Data engineer', domain: 'pipelines and analytics', skills: ['SQL', 'dbt', 'Airflow'], interests: ['data modeling', 'BI'] },
  { title: 'Product manager', domain: 'B2B SaaS', skills: ['roadmapping', 'user research'], interests: ['growth', 'metrics'] },
  { title: 'Designer', domain: 'UX and branding', skills: ['Figma', 'prototyping'], interests: ['design systems', 'research'] },
  { title: 'Founder', domain: 'early-stage startup', skills: ['strategy', 'hiring'], interests: ['fundraising', 'go-to-market'] },
];
const INTENT_TEMPLATES = [
  'Looking for a technical co-founder to build a {{domain}} product.',
  'I want to find a co-founder with experience in {{domain}}.',
  'Seeking a {{title}} interested in joining an early-stage startup.',
  'Open to talking with potential co-founders about a {{domain}} idea.',
];

function buildTesterPersonas(): TesterPersona[] {
  const out: TesterPersona[] = [...TESTER_PERSONAS_CORE];
  for (let i = 5; i < TESTER_PERSONAS_MAX; i++) {
    const fi = i % FIRST_NAMES.length;
    const li = Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length;
    const ri = i % ROLES.length;
    const first = FIRST_NAMES[fi];
    const last = LAST_NAMES[li];
    const role = ROLES[ri];
    const name = `${first} ${last}`;
    const slug = `${first.toLowerCase()}${last.toLowerCase()}-${i + 1}`;
    const persona: TesterPersona = {
      name,
      email: `seed-tester-${i + 1}@index-network.test`,
      linkedin: i % 3 !== 0 ? `https://linkedin.com/in/${slug}` : null,
      github: i % 4 !== 0 ? `https://github.com/${slug}` : null,
      x: i % 5 === 0 ? `https://x.com/${slug}` : null,
      website: null,
      profile: {
        identity: {
          name,
          bio: `${role.title} focused on ${role.domain}.`,
          location: ['San Francisco', 'New York', 'Austin', 'Seattle', 'Remote'][i % 5],
        },
        narrative: { context: `Exploring opportunities in ${role.domain}.` },
        attributes: {
          interests: role.interests,
          skills: role.skills,
        },
      },
      intents: INTENT_TEMPLATES.slice(0, 2).map((t) => t.replace(/\{\{domain\}\}/g, role.domain).replace(/\{\{title\}\}/g, role.title)),
    };
    out.push(persona);
  }
  return out;
}

/** Deterministic synthetic tester personas for seed (max 100). Intents are created via intent graph. */
export const TESTER_PERSONAS: TesterPersona[] = buildTesterPersonas();
