'use client';

import { useState } from 'react';
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
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) {
    return avatar;
  }
  if (avatar.startsWith('/api/storage/')) {
    return avatar;
  }
  const cleanPath = avatar.startsWith('/') ? avatar.slice(1) : avatar;
  return `/api/storage/${cleanPath}`;
}

function BoringFallback({ id, name, size, className }: Omit<UserAvatarProps, 'avatar'>) {
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

export default function UserAvatar({ id, name, avatar, size, className }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  if (!avatar || imgError) {
    return <BoringFallback id={id} name={name} size={size} className={className} />;
  }

  return (
    <div
      className={`rounded-full overflow-hidden flex-shrink-0${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
    >
      <Image
        src={resolveAvatarSrc(avatar)}
        alt={name || 'User'}
        width={size}
        height={size}
        className="w-full h-full object-cover"
        onError={() => setImgError(true)}
      />
    </div>
  );
}
