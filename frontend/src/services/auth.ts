import { useAuthenticatedAPI } from '../lib/api';
import { useMemo } from 'react';
import { User, OnboardingState, AvatarUploadResponse, APIResponse, UpdateProfileRequest } from '../types';

export const createAuthService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Upload avatar
  uploadAvatar: async (file: File): Promise<string> => {
    const result = await api.uploadFile<AvatarUploadResponse>('/upload/avatar', file, undefined, 'avatar');
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


});

export function useAuthService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createAuthService(api), [api]);
}

