'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Avatar from 'boring-avatars';

interface IndexAvatarProps {
  id?: string;
  title?: string;
  imageUrl?: string | null;
  size: number;
  className?: string;
  rounded?: 'full' | 'sm';
}

function BoringFallback({ id, title, size, rounded, className }: { id?: string; title?: string; size: number; rounded: 'full' | 'sm'; className?: string }) {
  const seed = id || title || 'default';
  const roundedClass = rounded === 'full' ? 'rounded-full' : 'rounded-sm';
  return (
    <div
      className={`overflow-hidden shrink-0 ${roundedClass} ${className || ''}`}
      style={{ width: size, height: size }}
    >
      <Avatar size={size} name={seed} variant="bauhaus" />
    </div>
  );
}

export default function IndexAvatar({ id, title, imageUrl, size, className = '', rounded = 'full' }: IndexAvatarProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [imageUrl]);

  if (!imageUrl || imgError) {
    return <BoringFallback id={id} title={title} size={size} rounded={rounded} className={className} />;
  }

  const roundedClass = rounded === 'full' ? 'rounded-full' : 'rounded-sm';
  return (
    <Image
      src={imageUrl}
      alt={title || 'Network'}
      width={size}
      height={size}
      className={`object-cover ${roundedClass} ${className}`}
      unoptimized
      onError={() => setImgError(true)}
    />
  );
}
