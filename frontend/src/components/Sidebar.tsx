'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Compass, MessageCircle } from 'lucide-react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useStreamChat } from '@/contexts/StreamChatContext';
import { useAIChatSessions } from '@/contexts/AIChatSessionsContext';
import { useAIChat } from '@/contexts/AIChatContext';
import { usePrivy } from '@privy-io/react-auth';
import { getAvatarUrl } from '@/lib/file-utils';
import { Channel } from 'stream-chat';

interface ChatSession {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RecentChat {
  id: string;
  recipientId: string;
  name: string;
  avatar: string | null;
  lastMessage: string;
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuthContext();
  const { client, isReady } = useStreamChat();
  const { sessionsVersion } = useAIChatSessions();
  const { clearChat } = useAIChat();
  const { getAccessToken } = usePrivy();
  
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [navigatingToChat, setNavigatingToChat] = useState(false);

  const isHomeView = pathname === '/' || pathname?.startsWith('/i/');
  const isMessagesView = pathname === '/conversations' || pathname?.startsWith('/u/');

  const handleDiscoverClick = () => {
    clearChat();
    router.push('/');
  };

  const handleChatClick = async () => {
    if (!isReady || !client) {
      router.push('/conversations');
      return;
    }

    setNavigatingToChat(true);
    try {
      const filter = {
        type: 'messaging',
        members: { $in: [client.userID || ''] },
      };
      const sort = [{ last_message_at: -1 as const }];
      const channels = await client.queryChannels(filter, sort, {
        limit: 1,
        watch: false,
        state: true,
      });

      if (channels.length > 0) {
        const channel = channels[0];
        const members = Object.values(channel.state.members || {});
        const otherMember = members.find(m => m.user_id !== client.userID);
        const recipientId = otherMember?.user?.id;
        
        if (recipientId) {
          router.push(`/u/${recipientId}/chat`);
          return;
        }
      }
      router.push('/conversations');
    } catch (error) {
      console.error('Failed to fetch most recent chat:', error);
      router.push('/conversations');
    } finally {
      setNavigatingToChat(false);
    }
  };

  // Fetch AI chat sessions
  useEffect(() => {
    if (!isHomeView) return;
    
    const fetchSessions = async () => {
      try {
        setLoadingSessions(true);
        const token = await getAccessToken();
        if (!token) return;
        
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL_V2}/v2/chat/sessions`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to fetch sessions');
        const data = await res.json() as { sessions: ChatSession[] };
        setChatSessions(data.sessions.slice(0, 5));
      } catch (error) {
        console.error('Failed to fetch chat sessions:', error);
      } finally {
        setLoadingSessions(false);
      }
    };

    fetchSessions();
  }, [isHomeView, sessionsVersion, getAccessToken]);

  // Fetch user-to-user chats when on messages view
  useEffect(() => {
    if (!isMessagesView || !isReady || !client) return;
    
    const fetchChats = async () => {
      try {
        setLoadingChats(true);
        const filter = {
          type: 'messaging',
          members: { $in: [client.userID || ''] },
        };
        const sort = [{ last_message_at: -1 as const }];
        const channels = await client.queryChannels(filter, sort, {
          limit: 5,
          watch: false,
          state: true,
        });

        const chats: RecentChat[] = channels.map((channel: Channel) => {
          const members = Object.values(channel.state.members || {});
          const otherMember = members.find(m => m.user_id !== client.userID);
          const otherUser = otherMember?.user;
          return {
            id: channel.id || '',
            recipientId: otherUser?.id || '',
            name: otherUser?.name || 'Unknown',
            avatar: otherUser?.image || null,
            lastMessage: channel.state.messages?.[channel.state.messages.length - 1]?.text || '',
          };
        }).filter((chat: RecentChat) => chat.recipientId);

        setRecentChats(chats);
      } catch (error) {
        console.error('Failed to fetch chats:', error);
      } finally {
        setLoadingChats(false);
      }
    };

    fetchChats();
  }, [isMessagesView, isReady, client]);

  return (
    <div className="flex flex-col h-full font-ibm-plex-mono overflow-hidden">
      {/* Logo */}
      <div className="flex-shrink-0 px-4 py-6">
        <Link href="/">
          <Image
            src="/logos/logo-black-full.svg"
            alt="Index Network"
            width={160}
            height={28}
            className="object-contain"
          />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-shrink-0 px-2 space-y-1">
        <button
          onClick={handleDiscoverClick}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
            isHomeView
              ? 'bg-gray-100 text-black font-medium'
              : 'text-gray-600 hover:bg-gray-50 hover:text-black'
          }`}
        >
          <Compass className="w-5 h-5" />
          Discover
        </button>

        <button
          onClick={handleChatClick}
          disabled={navigatingToChat}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
            isMessagesView
              ? 'bg-gray-100 text-black font-medium'
              : 'text-gray-600 hover:bg-gray-50 hover:text-black'
          } ${navigatingToChat ? 'opacity-50 cursor-wait' : ''}`}
        >
          <MessageCircle className="w-5 h-5" />
          Chat
        </button>
      </nav>

      {/* Recent Section - fixed height, no scroll */}
      <div className="flex-shrink-0 mt-8 px-4">
        {isHomeView && (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Recent
              </h3>
            </div>
            {loadingSessions ? (
              <div className="text-sm text-gray-400">Loading...</div>
            ) : chatSessions.length === 0 ? (
              <div className="text-sm text-gray-400">No conversations yet</div>
            ) : (
              <div className="space-y-1">
                {chatSessions.slice(0, 4).map((session) => (
                  <button
                    key={session.id}
                    onClick={() => router.push(`/?sessionId=${session.id}`)}
                    className="w-full text-left py-2 text-sm text-gray-700 hover:text-black transition-colors truncate"
                  >
                    {session.title || 'Untitled conversation'}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {isMessagesView && (
          <>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Recent
            </h3>
            {loadingChats ? (
              <div className="text-sm text-gray-400">Loading...</div>
            ) : recentChats.length === 0 ? (
              <div className="text-sm text-gray-400">No messages yet</div>
            ) : (
              <div className="space-y-1">
                {recentChats.slice(0, 4).map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => router.push(`/u/${chat.recipientId}/chat`)}
                    className="w-full flex items-center gap-3 py-2 text-sm text-gray-700 hover:text-black transition-colors"
                  >
                    <Image
                      src={getAvatarUrl({ avatar: chat.avatar, id: chat.recipientId, name: chat.name })}
                      alt={chat.name}
                      width={28}
                      height={28}
                      className="rounded-full flex-shrink-0"
                    />
                    <span className="truncate">{chat.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User Profile - always at bottom */}
      {user && (
        <div className="flex-shrink-0 px-4 py-4 border-t border-gray-200">
          <div className="flex items-center gap-3">
            <Image
              src={getAvatarUrl(user)}
              alt={user.name || 'User'}
              width={40}
              height={40}
              className="rounded-full flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-black truncate">
                {user.name}
              </div>
              <div className="text-xs text-gray-500">
                Member
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
