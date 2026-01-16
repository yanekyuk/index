// --- Input Types ---

export type ParallelParams = {
  name?: string;
  email?: string;
  linkedin?: string;
  twitter?: string;
  website?: string;
  location?: string;
  company?: string;
  github?: string;
};

export interface Profile {
  identity: {
    name: string;
    bio?: string;
    location?: string;
    companies?: string[];
    [key: string]: any;
  };
  narrative?: {
    biography?: string;
    context?: string;
    goals?: string[];
  };
  attributes?: {
    skills?: string[];
    interests?: string[];
    values?: string[];
  };
  embedding?: number[];
  [key: string]: any;
}

export type ProfileData = Profile; // Alias for backward compat

export type IntentPair = {
  source: ProfileData;
  target: ProfileData;
  intents: string[];
};

export type RawText = string;

// Agent Definition
export type AgentInputType = 'profile' | 'raw_text' | 'parallel_params' | 'intent_pairs' | 'context' | 'any';

export type AgentFieldType = 'string' | 'number' | 'boolean' | 'profile' | 'profile_array' | 'string_array' | 'hyde' | 'json';

export interface AgentField {
  key: string;
  label: string;
  type: AgentFieldType;
  description?: string;
  defaultValue?: any;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  category: string;
  inputType: AgentInputType;
  defaultInput?: any;
  fields?: AgentField[];
  disabled?: boolean;
};

// User Context Definition
export interface UserContext {
  id: string; // Unique ID
  name: string; // Display Name

  // 1. Parallel Search Params
  parallelSearchParams?: {
    name?: string;
    email?: string;
    linkedin?: string;
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

  // 7. Opportunities
  opportunities?: any[];

  // Timestamp for sorting
  timestamp?: number;
}

export type ContextItem = UserContext; // Legacy alias if needed, but we should use UserContext

export async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/agents');
  return res.json() as Promise<Agent[]>;
}

export async function fetchContextData(): Promise<UserContext[]> {
  const res = await fetch('/api/data/users');
  return res.json() as Promise<UserContext[]>;
}

export interface RunAgentOptions {
  preProcessors?: {
    embed?: boolean;
    json2md?: boolean;
  };
}

export async function runAgent(agentId: string, input: any, options?: RunAgentOptions): Promise<any> {
  // Always wrap to match new backend logic
  const payload = {
    input,
    options
  };

  const res = await fetch(`/api/run/${agentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}
