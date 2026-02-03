'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Compass, MessageCircle, Settings, Loader2, ChevronDown, User as UserIcon, LogIn, Library } from 'lucide-react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useStreamChat } from '@/contexts/StreamChatContext';
import { useAIChatSessions } from '@/contexts/AIChatSessionsContext';
import { useAIChat } from '@/contexts/AIChatContext';
import { usePrivy } from '@privy-io/react-auth';
import { getAvatarUrl } from '@/lib/file-utils';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useIndexes } from '@/contexts/APIContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { Index as IndexType } from '@/lib/types';
import ProfileSettingsModal from '@/components/modals/ProfileSettingsModal';
import PreferencesModal from '@/components/modals/PreferencesModal';
import CreateIndexModal from '@/components/modals/CreateIndexModal';
import MemberSettingsModal from '@/components/modals/MemberSettingsModal';
import IndexOwnerModal from '@/components/modals/IndexOwnerModal';

interface ChatSession {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, updateUser, refetchUser } = useAuthContext();
  const { client, isReady } = useStreamChat();
  const { sessionsVersion } = useAIChatSessions();
  const { clearChat } = useAIChat();
  const { getAccessToken, logout } = usePrivy();
  const indexesService = useIndexes();
  const { addIndex } = useIndexesState();
  const { success, error } = useNotifications();
  
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [navigatingToChat, setNavigatingToChat] = useState(false);
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [preferencesModalOpen, setPreferencesModalOpen] = useState(false);
  const [createIndexModalOpen, setCreateIndexModalOpen] = useState(false);
  const [memberSettingsIndex, setMemberSettingsIndex] = useState<IndexType | null>(null);
  const [ownerModalIndex, setOwnerModalIndex] = useState<IndexType | null>(null);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  const isMessagesView = pathname?.includes('/chat') && pathname?.startsWith('/u/');
  const isLibraryView = pathname?.startsWith('/library');
  const isNetworksView = pathname?.startsWith('/networks');
  const isHomeView = !isMessagesView && !isLibraryView && !isNetworksView;

  // Get current AI session ID from pathname (e.g., /d/abc123 -> abc123)
  const currentSessionId = pathname?.match(/^\/d\/([^/]+)/)?.[1] || null;

  const handleCreateIndex = useCallback(async (indexData: { name: string; prompt?: string; joinPolicy?: 'anyone' | 'invite_only' }) => {
    try {
      const createRequest = {
        title: indexData.name,
        prompt: indexData.prompt,
        joinPolicy: indexData.joinPolicy
      };
      const newIndex = await indexesService.createIndex(createRequest);
      addIndex(newIndex);
      setCreateIndexModalOpen(false);
      success('Index created successfully');
    } catch (err) {
      console.error('Error creating index:', err);
      error('Failed to create index');
    }
  }, [indexesService, addIndex, success, error]);

  const handleDiscoverClick = () => {
    clearChat();
    router.push('/');
  };

  const handleChatClick = async () => {
    if (!isReady || !client) {
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
        }
      }
    } catch (err) {
      console.error('Failed to fetch most recent chat:', err);
    } finally {
      setNavigatingToChat(false);
    }
  };

  // Fetch AI chat sessions
  useEffect(() => {
    const isInitialLoad = sessionsVersion === 0;
    const fetchSessions = async () => {
      try {
        // Only show loading on initial load, not on refetches
        if (isInitialLoad) setLoadingSessions(true);
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
        if (isInitialLoad) setLoadingSessions(false);
      }
    };

    fetchSessions();
  }, [sessionsVersion, getAccessToken]);

  // Track unread message count
  useEffect(() => {
    if (!isReady || !client) return;

    const fetchUnreadCount = async () => {
      try {
        const filter = {
          type: 'messaging',
          members: { $in: [client.userID || ''] },
        };
        const channels = await client.queryChannels(filter, {}, {
          watch: true,
          state: true,
        });
        
        const total = channels.reduce((sum, ch) => sum + (ch.state.unreadCount || 0), 0);
        setTotalUnreadCount(total);
      } catch (error) {
        console.error('Failed to fetch unread count:', error);
      }
    };

    fetchUnreadCount();

    // Listen for message events to update unread count
    const handleEvent = () => fetchUnreadCount();
    client.on('message.new', handleEvent);
    client.on('message.read', handleEvent);
    client.on('notification.mark_read', handleEvent);

    return () => {
      client.off('message.new', handleEvent);
      client.off('message.read', handleEvent);
      client.off('notification.mark_read', handleEvent);
    };
  }, [isReady, client]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setUserDropdownOpen(false);
      }
    };
    if (userDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userDropdownOpen]);

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
          <span className="flex-1 text-left">Chat</span>
          {totalUnreadCount > 0 && (
            <span className="bg-black text-white text-xs px-2 py-0.5 rounded-full min-w-[20px] text-center">
              {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
            </span>
          )}
        </button>
      </nav>

      {/* Recent Section - AI chat sessions */}
      <div className="flex-shrink-0 mt-8 px-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            History
          </h3>
        </div>
        {loadingSessions ? (
          <div className="text-sm text-gray-400">Loading...</div>
        ) : chatSessions.length === 0 ? (
          <div className="text-sm text-gray-400">No conversations yet</div>
        ) : (
          <div className="space-y-1">
            {chatSessions.slice(0, 4).map((session) => {
              const isSelected = currentSessionId === session.id;
              return (
                <button
                  key={session.id}
                  onClick={() => router.push(`/d/${session.id}`)}
                  className={`w-full text-left py-2 px-2 -mx-2 rounded-md text-sm transition-colors truncate ${
                    isSelected
                      ? 'bg-gray-50 text-black font-medium'
                      : 'text-gray-700 hover:text-black hover:bg-gray-50'
                  }`}
                >
                  {session.title || 'Untitled chat'}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User Profile with Dropdown - always at bottom */}
      {user && (
        <div className="flex-shrink-0 px-4 py-4 relative" ref={userDropdownRef}>
          <button
            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
            className="w-full flex items-center gap-3 hover:bg-gray-50 rounded-md p-2 -m-2 transition-colors"
          >
            <Image
              src={getAvatarUrl(user)}
              alt={user.name || 'User'}
              width={40}
              height={40}
              className="rounded-full flex-shrink-0"
            />
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-medium text-black truncate">
                {user.name}
              </div>
              <div className="text-xs text-gray-500">
                Member
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${userDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {userDropdownOpen && (
            <div className="absolute bottom-full left-4 right-4 mb-2 bg-white border border-black shadow-[0px_1px_0px_#000000] rounded-[2px] z-50">
              <div className="py-1">
                <button
                  className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center font-ibm-plex-mono text-sm"
                  onClick={() => {
                    setUserDropdownOpen(false);
                    router.push('/networks');
                  }}
                >
                  <Compass className="h-4 w-4 mr-2" />
                  Networks
                </button>
                <button
                  className={`w-full px-4 py-2 text-left flex items-center font-ibm-plex-mono text-sm ${
                    isLibraryView 
                      ? 'text-black bg-gray-100 font-medium' 
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  onClick={() => {
                    setUserDropdownOpen(false);
                    router.push('/library');
                  }}
                >
                  <Library className="h-4 w-4 mr-2" />
                  Library
                </button>
                <button
                  className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center font-ibm-plex-mono text-sm"
                  onClick={() => {
                    setUserDropdownOpen(false);
                    setIsProfileModalOpen(true);
                  }}
                >
                  <UserIcon className="h-4 w-4 mr-2" />
                  Profile
                </button>
                <button
                  className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center font-ibm-plex-mono text-sm"
                  onClick={() => {
                    setUserDropdownOpen(false);
                    setPreferencesModalOpen(true);
                  }}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Preferences
                </button>
                <div className="border-t border-gray-200 my-1" />
                <button
                  className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50 hover:text-red-700 flex items-center transition-colors font-ibm-plex-mono text-sm"
                  onClick={() => {
                    setUserDropdownOpen(false);
                    logout();
                  }}
                >
                  <LogIn className="h-4 w-4 mr-2" />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Profile Settings Modal */}
      <ProfileSettingsModal
        open={isProfileModalOpen}
        onOpenChange={setIsProfileModalOpen}
        user={user}
        onUserUpdate={async () => {
          await refetchUser();
        }}
      />

      {/* Preferences Modal */}
      <PreferencesModal
        open={preferencesModalOpen}
        onOpenChange={setPreferencesModalOpen}
        user={user}
        onUserUpdate={async () => {
          await refetchUser();
        }}
      />

      {/* Create Index Modal */}
      <CreateIndexModal
        open={createIndexModalOpen}
        onOpenChange={setCreateIndexModalOpen}
        onSubmit={handleCreateIndex}
      />

      {/* Member Settings Modal */}
      {memberSettingsIndex && (
        <MemberSettingsModal
          open={!!memberSettingsIndex}
          onOpenChange={(open) => !open && setMemberSettingsIndex(null)}
          index={memberSettingsIndex}
        />
      )}

      {/* Index Owner Modal */}
      {ownerModalIndex && (
        <IndexOwnerModal
          open={!!ownerModalIndex}
          onOpenChange={(open) => !open && setOwnerModalIndex(null)}
          index={ownerModalIndex}
        />
      )}
    </div>
  );
}
