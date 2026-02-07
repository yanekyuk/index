// Utility functions for file URL generation

/**
 * Generate URL for avatar files
 * Returns relative URLs for Next.js Image optimization
 * @param params - Object containing avatar and id/name properties
 * @returns URL to the avatar file
 */
export const getAvatarUrl = (params: { avatar?: string | null; id?: string; name?: string } | null): string => {
  
  if (!params) return 'https://api.dicebear.com/9.x/shapes/png?seed=default';
  const { avatar } = params;

  if (!avatar) {
    const seed = params.id || params.name || 'default';
    return `https://api.dicebear.com/9.x/shapes/png?seed=${seed}`;
  }
  
  // Full external URLs (dicebear, slack, etc.) - return as is
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) {
    return avatar;
  }
  
  // Storage URLs - return as is
  if (avatar.startsWith('/storage/')) {
    return avatar;
  }
  
  // Relative path (e.g., "avatars/userId/file.jpg") - prepend /storage/
  const cleanPath = avatar.startsWith('/') ? avatar.slice(1) : avatar;
  return `/storage/${cleanPath}`;
}; 