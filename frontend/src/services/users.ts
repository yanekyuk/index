import { User, APIResponse } from '../lib/types';

/** Response shape for GET /users/batch */
interface BatchUsersResponse {
  users: User[];
}

export const createUsersService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Get user profile by ID
  getUserProfile: async (userId: string): Promise<User> => {
    const response = await api.get<APIResponse<User>>(`/users/${userId}`);
    if (!response.user) {
      throw new Error('Failed to fetch user profile');
    }
    return response.user;
  },

  /**
   * Get multiple user profiles by ID. Prefers batch endpoint; falls back to parallel single fetches.
   * Returns a Map of id -> User (or null for missing/failed). Only fetches the provided ids (caller should dedupe/cap).
   */
  getUserProfiles: async (ids: string[]): Promise<Map<string, User | null>> => {
    const profileMap = new Map<string, User | null>();
    if (ids.length === 0) return profileMap;

    try {
      const response = await api.get<BatchUsersResponse>(`/users/batch?ids=${encodeURIComponent(ids.join(','))}`);
      const users = response?.users ?? [];
      for (const user of users) {
        profileMap.set(user.id, user);
      }
      for (const id of ids) {
        if (!profileMap.has(id)) {
          profileMap.set(id, null);
        }
      }
      return profileMap;
    } catch {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const profile = await api.get<APIResponse<User>>(`/users/${id}`);
            return [id, profile?.user ?? null] as const;
          } catch {
            return [id, null] as const;
          }
        })
      );
      results.forEach(([id, user]) => profileMap.set(id, user));
      return profileMap;
    }
  },
});