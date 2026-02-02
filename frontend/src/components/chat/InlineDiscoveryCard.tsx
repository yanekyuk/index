'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { MessageCircle, User } from 'lucide-react';
import { getAvatarUrl } from '@/lib/file-utils';
import type { DiscoveryOpportunity } from '@/contexts/AIChatContext';

interface InlineDiscoveryCardProps {
  discovery: DiscoveryOpportunity;
}

export default function InlineDiscoveryCard({ discovery }: InlineDiscoveryCardProps) {
  const router = useRouter();
  const avatarUrl = getAvatarUrl({
    id: discovery.candidateId,
    avatar: discovery.candidateAvatar || null,
    name: discovery.candidateName || 'User',
  });

  const handleViewProfile = () => {
    router.push(`/u/${discovery.candidateId}`);
  };

  const handleStartChat = () => {
    router.push(`/u/${discovery.candidateId}/chat`);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 my-2">
      <div className="flex items-start gap-3">
        <button onClick={handleViewProfile} className="flex-shrink-0">
          <Image
            src={avatarUrl}
            alt={discovery.candidateName || 'User'}
            width={40}
            height={40}
            className="rounded-full"
          />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <button
              onClick={handleViewProfile}
              className="font-bold text-sm text-gray-900 font-ibm-plex-mono hover:text-gray-700 truncate"
            >
              {discovery.candidateName || 'Potential Connection'}
            </button>
            <span className="text-xs text-gray-500 font-ibm-plex-mono flex-shrink-0">
              {Math.round(discovery.score)}% match
            </span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            {discovery.sourceDescription}
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleViewProfile}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition-colors font-ibm-plex-mono"
            >
              <User className="w-3.5 h-3.5" />
              View Profile
            </button>
            <button
              onClick={handleStartChat}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-black hover:bg-gray-800 rounded transition-colors font-ibm-plex-mono"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Start Conversation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
