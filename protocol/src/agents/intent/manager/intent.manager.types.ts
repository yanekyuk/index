export interface UserMemoryProfile {
  userId: string;
  identity: {
    name: string;
    bio: string;
    location: string;
  };
  narrative?: {
    context: string;
  };
  attributes: {
    interests: string[];
    skills: string[];
    goals: string[];
  };
}

export interface ActiveIntent {
  id: string;
  description: string;
  status: 'active' | 'completed' | 'expired';
  created_at: number;
}

export interface CreateIntentAction {
  type: 'create';
  payload: string;
  score?: number | null;
  reasoning?: string | null;
}

export interface UpdateIntentAction {
  type: 'update';
  id: string;
  payload: string;
  score?: number | null;
  reasoning?: string | null;
}

export interface ExpireIntentAction {
  type: 'expire';
  id: string;
  reason: string;
}

export type IntentAction = CreateIntentAction | UpdateIntentAction | ExpireIntentAction;

export interface IntentManagerResponse {
  actions: IntentAction[];
}
