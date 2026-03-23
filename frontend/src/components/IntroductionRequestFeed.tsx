import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Bot, Check, ChevronDown, Users } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import { useAIChat } from '@/contexts/AIChatContext';
import { cn } from '@/lib/utils';

interface IntroRequest {
  id: string;
  seeker: {
    id: string;
    name: string;
    avatar: string | null;
    headline: string;
  };
  intent: string;
  relevanceHook: string;
  postedAgo: string;
}

const MOCK_INTRO_REQUESTS: IntroRequest[] = [
  {
    id: '1',
    seeker: { id: 'user-seref', name: 'Seref Erkovan', avatar: null, headline: 'Founder @ EcoSpark' },
    intent: 'Looking for consumer AI investors who have invested in B2C SaaS companies and understand the nuances of AI-first product development.',
    relevanceHook: 'Your network includes several AI-focused investors and you share 2 networks with Seref',
    postedAgo: '2h ago',
  },
  {
    id: '2',
    seeker: { id: 'user-maria', name: 'Maria Chen', avatar: null, headline: 'CTO @ Luminary Labs' },
    intent: 'Seeking senior ML engineers with experience in real-time recommendation systems at scale — ideally 5+ years and open to a principal role.',
    relevanceHook: "You've worked with ML engineers in previous roles and are a member of the ML Builders network",
    postedAgo: '5h ago',
  },
  {
    id: '3',
    seeker: { id: 'user-kwame', name: 'Kwame Asante', avatar: null, headline: 'Partner @ Nexus Ventures' },
    intent: 'Looking to connect with founders working on climate tech and sustainable infrastructure — pre-seed to Series A stage.',
    relevanceHook: 'You have intents around sustainability and share the Climate Founders network with Kwame',
    postedAgo: '1d ago',
  },
  {
    id: '4',
    seeker: { id: 'user-yuki', name: 'Yuki Tanaka', avatar: null, headline: 'Head of Growth @ Archetype' },
    intent: 'Need introductions to growth-stage B2B SaaS founders who have navigated the 1M → 10M ARR transition, specifically in the HR tech space.',
    relevanceHook: 'Your profile signals SaaS growth experience and you know several operators in this space',
    postedAgo: '2d ago',
  },
  {
    id: '5',
    seeker: { id: 'user-priya', name: 'Priya Nair', avatar: null, headline: 'Research Lead @ Anthropic' },
    intent: 'Seeking product designers who have shipped AI-native products and care deeply about human-AI interaction patterns.',
    relevanceHook: 'You follow AI design closely and your network overlaps with the AI Product community',
    postedAgo: '3d ago',
  },
];

const INITIAL_VISIBLE = 3;

function buildQuery(request: IntroRequest): string {
  return `${request.seeker.name} is ${request.seeker.headline} and is looking for someone who fits this: "${request.intent}" — do you know anyone in my network I could introduce to them?`;
}

/**
 * Discovery feed showing what other users in your network are looking for,
 * and asking if you'd like to suggest an introduction via a chat query.
 *
 * @remarks Uses mock data — no backend required. Replace MOCK_INTRO_REQUESTS
 * with a real API call when the backend is ready.
 */
export default function IntroductionRequestFeed({
  initialVisible = INITIAL_VISIBLE,
}: {
  initialVisible?: number;
}) {
  const navigate = useNavigate();
  const { clearChat, sendMessage } = useAIChat();
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const handleSearchNetwork = (request: IntroRequest) => {
    clearChat({ abortStream: false });
    navigate('/');
    sendMessage(buildQuery(request));
    setSentIds((prev) => new Set([...prev, request.id]));
  };

  const activeRequests = MOCK_INTRO_REQUESTS.filter((r) => !dismissedIds.has(r.id));
  const visibleRequests = showAll ? activeRequests : activeRequests.slice(0, initialVisible);
  const hiddenCount = activeRequests.length - visibleRequests.length;

  return (
    <div>
      <h3 className="text-xs font-semibold text-[#3D3D3D] uppercase tracking-wider mb-3 font-ibm-plex-mono flex items-center gap-2">
        <span className="w-3.5 h-3.5 shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
          <Users />
        </span>
        Help someone in your network
      </h3>

      {activeRequests.length === 0 && (
        <p className="text-xs text-gray-400 py-4">All caught up — check back later.</p>
      )}

      <div className="space-y-3">
        {visibleRequests.map((request) => {
          const isSent = sentIds.has(request.id);

          return (
            <div
              key={request.id}
              className={cn(
                'rounded-lg border',
                isSent ? 'bg-green-50/60 border-green-200' : 'bg-white border-gray-200'
              )}
            >
              <div className="p-4">
                {/* Post body with inline avatar */}
                <div className="flex items-start gap-2 mb-3">
                  <UserAvatar
                    id={request.seeker.id}
                    name={request.seeker.name}
                    avatar={request.seeker.avatar}
                    size={20}
                    className="shrink-0 mt-0.5"
                  />
                  <p className="text-[14px] text-[#3D3D3D] leading-relaxed">
                    <span className="font-semibold text-gray-900">{request.seeker.name}</span>
                    {' '}is looking for {request.intent.charAt(0).toLowerCase() + request.intent.slice(1)}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between gap-2">
                  <div />{/* spacer */}
                  {isSent ? (
                    <div className="flex items-center gap-1.5 shrink-0 text-sm text-gray-500">
                      <Check className="w-4 h-4 text-green-600 shrink-0" />
                      <span>On it</span>
                    </div>
                  ) : (
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSearchNetwork(request)}
                        className="px-3 py-1.5 bg-[#041729] text-white text-xs font-medium rounded-sm hover:bg-[#0a2d4a] transition-colors"
                      >
                        Check my network
                      </button>
                      <button
                        type="button"
                        onClick={() => setDismissedIds((prev) => new Set([...prev, request.id]))}
                        className="px-3 py-1.5 text-xs border border-gray-400 text-[#3D3D3D] rounded-sm hover:bg-gray-200 transition-colors"
                      >
                        Skip
                      </button>
                    </div>
                  )}
                </div>

                {/* Narrator chip */}
                {!isSent && (
                  <div className="mt-3">
                    <div className="inline-flex items-center gap-2.5 px-3 py-1 rounded-md bg-[#F0F0F0] border border-gray-200">
                      <div className="relative shrink-0">
                        <Bot className="w-7 h-7 text-[#3D3D3D]" />
                      </div>
                      <span className="text-[13px] text-[#3D3D3D]">
                        <span className="font-semibold">Index:</span>{' '}
                        {request.relevanceHook}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!showAll && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          {hiddenCount} more
        </button>
      )}
    </div>
  );
}
