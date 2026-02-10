import { User, APIResponse } from '../lib/types';

export const createUsersService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Get user profile by ID
  getUserProfile: async (userId: string): Promise<User> => {
    const response = await api.get<APIResponse<User>>(`/users/${userId}`);
    if (!response.user) {
      throw new Error('Failed to fetch user profile');
    }
    return response.user;
  },
});