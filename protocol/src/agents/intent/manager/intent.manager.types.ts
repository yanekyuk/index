export interface UserMemoryProfile {
  userId: string;
  identity: {
    name: string;
    bio: string;
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
