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

export type ProfileData = {
  identity: {
    name: string;
    bio?: string;
    [key: string]: any;
  };
  attributes?: Record<string, any>;
  [key: string]: any;
};

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

// Context Types
export type ContextType = 'profile' | 'intent' | 'opportunity' | 'generated' | 'hyde' | 'json' | 'parallel-search-response' | 'ParallelSearchRequest' | 'intent_manager_response';

export type ContextItem = {
  id: string;
  type: ContextType;
  name: string;
  timestamp?: number;
  value?: any;
  data?: any;
};


export async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/agents');
  return res.json() as Promise<Agent[]>;
}

export async function fetchContextData(): Promise<ContextItem[]> {
  const res = await fetch('/api/data/users');
  return res.json() as Promise<ContextItem[]>;
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
