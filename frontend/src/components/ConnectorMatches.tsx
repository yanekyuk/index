'use client';

import Image from 'next/image';
import { ArrowLeftRight, Route } from 'lucide-react';
import { getAvatarUrl } from '@/lib/file-utils';

interface MatchPerson {
  id: string;
  name: string;
  avatar: string | null;
  title?: string;
  company?: string;
}

interface ConnectorMatch {
  id: string;
  person1: MatchPerson;
  person2: MatchPerson;
  description: string;
}

interface ConnectorMatchesProps {
  matches: ConnectorMatch[];
  onMatch: (matchId: string) => void;
  onPass: (matchId: string) => void;
}

export default function ConnectorMatches({ matches, onMatch, onPass }: ConnectorMatchesProps) {
  if (matches.length === 0) {
    return null;
  }

  return (
    <div className="mt-6">
      <h2 className="font-ibm-plex-mono text-black text-lg font-bold mb-4 text-center flex items-center justify-center gap-2">
        <Route className="w-5 h-5 shrink-0" aria-hidden />
        You're the connector they need
      </h2>
      
      <div className="space-y-6">
        {matches.map((match) => (
          <div key={match.id} className="bg-white border border-gray-300 rounded-sm p-4">
            {/* Match Card */}
            <div className="flex items-center justify-between mb-4">
              {/* Person 1 */}
              <div className="flex flex-col items-center flex-1">
                <Image
                  src={getAvatarUrl(match.person1)}
                  alt={match.person1.name}
                  width={64}
                  height={64}
                  className="rounded-full mb-2"
                />
                <h3 className="font-bold text-gray-900 font-ibm-plex-mono text-sm mb-1">
                  {match.person1.name}
                </h3>
                {(match.person1.title || match.person1.company) && (
                  <p className="text-xs text-gray-500 font-ibm-plex-mono text-center">
                    {match.person1.title}
                    {match.person1.title && match.person1.company && ' at '}
                    {match.person1.company}
                  </p>
                )}
              </div>

              {/* Double Arrow */}
              <div className="mx-4 flex-shrink-0">
                <ArrowLeftRight className="w-6 h-6 text-gray-400" />
              </div>

              {/* Person 2 */}
              <div className="flex flex-col items-center flex-1">
                <Image
                  src={getAvatarUrl(match.person2)}
                  alt={match.person2.name}
                  width={64}
                  height={64}
                  className="rounded-full mb-2"
                />
                <h3 className="font-bold text-gray-900 font-ibm-plex-mono text-sm mb-1">
                  {match.person2.name}
                </h3>
                {(match.person2.title || match.person2.company) && (
                  <p className="text-xs text-gray-500 font-ibm-plex-mono text-center">
                    {match.person2.title}
                    {match.person2.title && match.person2.company && ' at '}
                    {match.person2.company}
                  </p>
                )}
              </div>
            </div>

            {/* Description */}
            <div className="bg-gray-100 rounded-sm p-3 mb-4">
              <p className="text-sm text-gray-700 font-ibm-plex-mono leading-relaxed">
                {match.description}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => onMatch(match.id)}
                className="flex-1 bg-black text-white px-4 py-2 font-ibm-plex-mono text-sm hover:bg-gray-800 transition-colors"
              >
                This is a good match
              </button>
              <button
                onClick={() => onPass(match.id)}
                className="flex-1 bg-white border border-gray-300 text-gray-900 px-4 py-2 font-ibm-plex-mono text-sm hover:bg-gray-50 transition-colors"
              >
                Pass
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

