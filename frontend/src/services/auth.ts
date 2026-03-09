import { useAuthenticatedAPI } from '../lib/api';
import { useMemo } from 'react';
import { User, OnboardingState, AvatarUploadResponse, APIResponse, UpdateProfileRequest } from '../types';

export const createAuthService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Upload avatar
  uploadAvatar: async (file: File): Promise<string> => {
    const result = await api.uploadFile<AvatarUploadResponse>('/storage/avatars', file, undefined, 'avatar');
    return result.avatarUrl;
  },

  // Update user profile
  updateProfile: async (data: UpdateProfileRequest): Promise<User> => {
    const response = await api.patch<APIResponse<User>>('/auth/profile/update', data);
    if (!response.user) {
      throw new Error('Failed to update profile');
    }
    return response.user;
  },

  // Generate intro via profile sync
  generateIntro: async (): Promise<string | null> => {
    const result = await api.post<Record<string, unknown>>('/profiles/sync');
    const profile = result?.profile as { identity?: { bio?: string } } | undefined;
    return profile?.identity?.bio ?? null;
  },


});

export function useAuthService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createAuthService(api), [api]);
}

