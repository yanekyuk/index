'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Compass, MessageCircle, History } from 'lucide-react';
import { useIntents } from '@/contexts/APIContext';

const navItems = [
  { id: 'discover', label: 'Discover', icon: Compass, href: '/' },
  { id: 'chat', label: 'Chat', icon: MessageCircle, href: '/chat' },
];

interface LatestIntent {
  id: string;
  payload: string;
  summary?: string | null;
}

export default function LeftNav() {
  const pathname = usePathname();
  const router = useRouter();
  const intentsService = useIntents();
  const [latestIntents, setLatestIntents] = useState<LatestIntent[]>([]);
  const [loadingIntents, setLoadingIntents] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname?.startsWith(href);
  };

  // Fetch latest intents
  useEffect(() => {
    const fetchLatestIntents = async () => {
      try {
        setLoadingIntents(true);
        const response = await intentsService.getIntents(1, 10, false);
        setLatestIntents((response as { intents?: LatestIntent[] }).intents?.slice(0, 10) || []);
      } catch (error) {
        console.error('Failed to fetch latest intents:', error);
      } finally {
        setLoadingIntents(false);
      }
    };
    fetchLatestIntents();
  }, [intentsService]);

  return (
    <nav className="flex flex-col h-full">
      {/* Main navigation */}
      <div className="flex flex-col py-4 px-2 gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <button
              key={item.id}
              onClick={() => router.push(item.href)}
              className={`flex items-center gap-3 px-3 py-3 rounded-full transition-colors text-left ${
                active
                  ? 'font-bold text-black'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Icon className={`w-6 h-6 ${active ? 'stroke-[2.5]' : ''}`} />
              <span className="text-lg font-ibm-plex-mono hidden xl:block">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* History/Latest section */}
      <div className="flex-1 overflow-hidden flex flex-col mt-4 border-t border-gray-200 pt-4 px-2">
        <div className="flex items-center gap-2 px-3 mb-3">
          <History className="w-5 h-5 text-gray-500" />
          <span className="text-sm font-semibold text-gray-900 font-ibm-plex-mono hidden xl:block">History</span>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {loadingIntents ? (
            <div className="text-gray-400 text-xs px-3 hidden xl:block">Loading...</div>
          ) : latestIntents.length === 0 ? (
            <div className="text-gray-400 text-xs px-3 hidden xl:block">No history yet</div>
          ) : (
            <div className="space-y-0.5">
              {latestIntents.map((intent) => (
                <button
                  key={intent.id}
                  onClick={() => router.push(`/i/${intent.id}`)}
                  className="w-full text-left py-2 px-3 rounded-lg hover:bg-gray-100 transition-colors group"
                >
                  <div className="text-sm text-gray-600 font-ibm-plex-mono line-clamp-1 group-hover:text-black hidden xl:block">
                    {intent.summary || intent.payload}
                  </div>
                  {/* Show dot indicator on collapsed view */}
                  <div className="w-2 h-2 bg-gray-300 rounded-full xl:hidden mx-auto" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
