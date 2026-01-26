'use client';

import Image from 'next/image';
import { ArrowRight, Send, X } from 'lucide-react';
import { DiscoveredOpportunity } from '@/services/admin';
import { getAvatarUrl } from '@/lib/file-utils';

interface OpportunityCardProps {
  opportunity: DiscoveredOpportunity;
  onSendToSource?: () => void;
  onSendToBoth?: () => void;
  onDismiss?: () => void;
  isProcessing?: boolean;
}

export default function OpportunityCard({
  opportunity,
  onSendToSource,
  onSendToBoth,
  onDismiss,
  isProcessing = false
}: OpportunityCardProps) {
  const { sourceUser, targetUser, opportunity: opp } = opportunity;

  // Score color based on value
  const getScoreColor = (score: number) => {
    if (score >= 90) return 'bg-green-100 text-green-800 border-green-300';
    if (score >= 80) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-gray-100 text-gray-800 border-gray-300';
  };

  // Type badge color
  const getTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      collaboration: 'bg-blue-100 text-blue-700',
      mentorship: 'bg-purple-100 text-purple-700',
      networking: 'bg-orange-100 text-orange-700',
      other: 'bg-gray-100 text-gray-700'
    };
    return colors[type] || colors.other;
  };

  return (
    <div className="bg-white border border-b-2 border-gray-800 p-4">
      {/* Header: Source -> Target with Score */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {/* Source User */}
          <div className="flex items-center gap-2">
            <Image
              src={getAvatarUrl(sourceUser)}
              alt={sourceUser.name}
              width={32}
              height={32}
              className="rounded-full"
            />
            <span className="font-ibm-plex-mono text-sm font-medium text-gray-900">
              {sourceUser.name}
            </span>
          </div>

          {/* Arrow */}
          <ArrowRight className="w-4 h-4 text-gray-400" />

          {/* Target User */}
          <div className="flex items-center gap-2">
            <Image
              src={getAvatarUrl(targetUser)}
              alt={targetUser.name}
              width={32}
              height={32}
              className="rounded-full"
            />
            <span className="font-ibm-plex-mono text-sm font-medium text-gray-900">
              {targetUser.name}
            </span>
          </div>
        </div>

        {/* Score Badge */}
        <div className={`px-2 py-1 rounded border font-ibm-plex-mono text-xs font-bold ${getScoreColor(opp.score)}`}>
          {opp.score}
        </div>
      </div>

      {/* Type Badge */}
      <div className="mb-2">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${getTypeBadge(opp.type)}`}>
          {opp.type}
        </span>
      </div>

      {/* Title */}
      <h3 className="font-ibm-plex-mono text-sm font-bold text-gray-900 mb-1">
        {opp.title}
      </h3>

      {/* Description */}
      <p className="font-ibm-plex-mono text-xs text-gray-600 mb-4 line-clamp-2">
        {opp.description}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {onSendToSource && (
          <button
            onClick={onSendToSource}
            disabled={isProcessing}
            className="flex items-center gap-1 px-3 py-1.5 bg-black text-white text-xs font-ibm-plex-mono rounded hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-3 h-3" />
            Send to {sourceUser.name.split(' ')[0]}
          </button>
        )}
        {onSendToBoth && (
          <button
            onClick={onSendToBoth}
            disabled={isProcessing}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-ibm-plex-mono rounded hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-3 h-3" />
            Send to both
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            disabled={isProcessing}
            className="flex items-center gap-1 px-3 py-1.5 text-gray-500 text-xs font-ibm-plex-mono hover:text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-3 h-3" />
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
