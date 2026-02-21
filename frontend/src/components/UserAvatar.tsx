'use client';

import Image from 'next/image';
import Avatar from 'boring-avatars';

interface UserAvatarProps {
  id?: string;
  name?: string;
  avatar?: string | null;
  size: number;
  className?: string;
}

function resolveAvatarSrc(avatar: string): string {
  if (avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('/storage/')) {
    return avatar;
  }
  const cleanPath = avatar.startsWith('/') ? avatar.slice(1) : avatar;
  return `/storage/${cleanPath}`;
}

export default function UserAvatar({ id, name, avatar, size, className }: UserAvatarProps) {
  if (avatar) {
    return (
      <Image
        src={resolveAvatarSrc(avatar)}
        alt={name || 'User'}
        width={size}
        height={size}
        className={`rounded-full${className ? ` ${className}` : ''}`}
      />
    );
  }

  return (
    <div
      className={`rounded-full overflow-hidden flex-shrink-0${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
    >
      <Avatar
        size={size}
        name={id || name || 'default'}
        variant="bauhaus"
      />
    </div>
  );
}
