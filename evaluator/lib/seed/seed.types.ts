// ═══════════════════════════════════════════════════════════════════════════════
// Seed requirement — what data a scenario needs in the protocol DB
// ═══════════════════════════════════════════════════════════════════════════════

export interface SeedRequirement {
  user: {
    hasProfile: boolean;
    intentCount: number;
    indexMemberships: number;
  };
  network: {
    otherUsers: number;
    withIntents: boolean;
    withEmbeddings: boolean;
  };
  indexes: {
    count: number;
    withMembers: boolean;
  };
  opportunities?: {
    count: number;
    statuses: string[];
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Seed profile — mirrors protocol user_profiles shape
// ═══════════════════════════════════════════════════════════════════════════════

export interface SeedProfile {
  identity: { name: string; bio: string; location: string };
  narrative: { context: string };
  attributes: { interests: string[]; skills: string[] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Generated seed data — output of LLM seed generator
// ═══════════════════════════════════════════════════════════════════════════════

export interface GeneratedSeedData {
  seedTag: string;
  testUser: {
    name: string;
    email: string;
    password: string;
    profile: SeedProfile;
  };
  intents: string[];
  indexes: Array<{ title: string; prompt: string | null }>;
  otherUsers?: Array<{
    name: string;
    email: string;
    password: string;
    profile: SeedProfile;
    intents: string[];
  }>;
  opportunities?: Array<{
    category: string;
    reasoning: string;
    confidence: number;
    status: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Default seed requirements per category
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULT_SEED_REQUIREMENTS: Record<string, SeedRequirement> = {
  profile_create: {
    user: { hasProfile: false, intentCount: 0, indexMemberships: 0 },
    network: { otherUsers: 0, withIntents: false, withEmbeddings: false },
    indexes: { count: 0, withMembers: false },
  },
  profile_view: {
    user: { hasProfile: true, intentCount: 0, indexMemberships: 0 },
    network: { otherUsers: 0, withIntents: false, withEmbeddings: false },
    indexes: { count: 0, withMembers: false },
  },
  profile_update: {
    user: { hasProfile: true, intentCount: 0, indexMemberships: 0 },
    network: { otherUsers: 0, withIntents: false, withEmbeddings: false },
    indexes: { count: 0, withMembers: false },
  },
  intent_create: {
    user: { hasProfile: true, intentCount: 0, indexMemberships: 1 },
    network: { otherUsers: 0, withIntents: false, withEmbeddings: false },
    indexes: { count: 1, withMembers: false },
  },
  intent_view: {
    user: { hasProfile: true, intentCount: 3, indexMemberships: 1 },
    network: { otherUsers: 0, withIntents: false, withEmbeddings: false },
    indexes: { count: 1, withMembers: false },
  },
  intent_update: {
    user: { hasProfile: true, intentCount: 2, indexMemberships: 1 },
    network: { otherUsers: 0, withIntents: false, withEmbeddings: false },
    indexes: { count: 1, withMembers: false },
  },
  intent_delete: {
    user: { hasProfile: true, intentCount: 2, indexMemberships: 1 },
    network: { otherUsers: 0, withIntents: false, withEmbeddings: false },
    indexes: { count: 1, withMembers: false },
  },
  index: {
    user: { hasProfile: true, intentCount: 1, indexMemberships: 2 },
    network: { otherUsers: 3, withIntents: true, withEmbeddings: false },
    indexes: { count: 2, withMembers: true },
  },
  intent_index: {
    user: { hasProfile: true, intentCount: 2, indexMemberships: 1 },
    network: { otherUsers: 0, withIntents: false, withEmbeddings: false },
    indexes: { count: 1, withMembers: false },
  },
  discovery: {
    user: { hasProfile: true, intentCount: 2, indexMemberships: 2 },
    network: { otherUsers: 5, withIntents: true, withEmbeddings: true },
    indexes: { count: 2, withMembers: true },
    opportunities: { count: 2, statuses: ["pending", "viewed"] },
  },
  url: {
    user: { hasProfile: true, intentCount: 0, indexMemberships: 0 },
    network: { otherUsers: 0, withIntents: false, withEmbeddings: false },
    indexes: { count: 0, withMembers: false },
  },
  edge_case: {
    user: { hasProfile: true, intentCount: 1, indexMemberships: 1 },
    network: { otherUsers: 0, withIntents: false, withEmbeddings: false },
    indexes: { count: 1, withMembers: false },
  },
  meta: {
    user: { hasProfile: false, intentCount: 0, indexMemberships: 0 },
    network: { otherUsers: 0, withIntents: false, withEmbeddings: false },
    indexes: { count: 0, withMembers: false },
  },
};

/**
 * Resolve seed requirements for a given category and optional needId.
 * Specific needId overrides take priority over category defaults.
 */
export function resolveSeedRequirements(
  category: string,
  needId?: string | null,
  override?: SeedRequirement | null
): SeedRequirement {
  if (override) return override;

  const needKey = needId?.toLowerCase();
  if (needKey && DEFAULT_SEED_REQUIREMENTS[needKey]) {
    return DEFAULT_SEED_REQUIREMENTS[needKey];
  }

  return (
    DEFAULT_SEED_REQUIREMENTS[category] ??
    DEFAULT_SEED_REQUIREMENTS["meta"]
  );
}
