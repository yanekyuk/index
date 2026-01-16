// User Context Definition
export interface UserContext {
  id: string; // Unique ID
  name: string; // Display Name

  // 1. Parallel Search Params
  parallelSearchParams?: {
    name?: string;
    email?: string;
    linkedin?: string;
    twitter?: string;
    github?: string;
    website?: string;
  };

  // 1.5 Parallel Search Result (Output from Fetcher)
  parallelSearchResult?: any;

  // 2. User Profile (Structured Memory Profile)
  userProfile?: any;

  // 3. User Profile Embedding
  userProfileEmbedding?: number[];

  // 4. HyDE Description
  hydeDescription?: string;

  // 5. HyDE Description Embedding
  hydeDescriptionEmbedding?: number[];

  // 6. Active Intents
  activeIntents?: any[];
}

export const TEST_USERS: UserContext[] = [
  {
    id: 'user_1',
    name: 'Seren Sandikci',
    parallelSearchParams: {
      name: "Seren Sandikci",
      email: "seren@index.network",
      linkedin: "https://www.linkedin.com/in/serensandikci",
      twitter: "https://x.com/serensandikci",
    },
    // Initialize other fields as empty/undefined
    activeIntents: []
  },
  {
    id: 'user_2',
    name: 'Seref Yarar',
    parallelSearchParams: {
      name: "Seref Yarar",
      email: "seref@index.network",
      linkedin: "https://www.linkedin.com/in/serefyarar",
      twitter: "https://x.com/hyperseref",
      github: "https://github.com/serefyarar"
    },
    activeIntents: []
  },
  {
    id: 'user_3',
    name: 'Yanki Ekin Yuksel',
    parallelSearchParams: {
      name: "Yanki Ekin Yuksel",
      email: "yanek@index.network",
      linkedin: "https://www.linkedin.com/in/yanekyuk",
      github: "https://github.com/yanekyuk"
    },
    activeIntents: []
  }
];

// Legacy export if needed for temporary build safety, but ideally we remove it.
export const PARALLEL_INPUTS = [];

