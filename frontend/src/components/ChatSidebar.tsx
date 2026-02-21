'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { MoreHorizontal, Trash2, Loader2 } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import { useStreamChat } from '@/contexts/StreamChatContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useOpportunities, useUsers } from '@/contexts/APIContext';
import { Channel, type Event as StreamEvent } from 'stream-chat';

interface RecentChat {
  id: string;
  recipientId: string;
  name: string;
  avatar: string | null;
  lastMessage: string;
  sortTimestamp: number;
  unreadCount: number;
}

const formatConversationTime = (timestamp: number) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isSameDay) {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const sortChats = (a: RecentChat, b: RecentChat) => {
  const aUnread = a.unreadCount > 0 ? 1 : 0;
  const bUnread = b.unreadCount > 0 ? 1 : 0;
  if (aUnread !== bUnread) return bUnread - aUnread;
  return b.sortTimestamp - a.sortTimestamp;
};

export default function ChatSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuthContext();
  const opportunitiesService = useOpportunities();
  const usersService = useUsers();
  const { client, isReady } = useStreamChat();
  
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState<string | null>(null);
  const [deletingChat, setDeletingChat] = useState<string | null>(null);
  const chatMenuRef = useRef<HTMLDivElement>(null);
  const chatsRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getOpportunitiesRef = useRef(opportunitiesService.getOpportunities);
  const getUserProfilesRef = useRef(usersService.getUserProfiles);
  const optimisticUnreadRef = useRef<Map<string, number>>(new Map());
  const hasLoadedChatsRef = useRef(false);

  const currentChatUserId = pathname?.match(/^\/u\/([^/]+)\/chat/)?.[1] || null;

  useEffect(() => {
    getOpportunitiesRef.current = opportunitiesService.getOpportunities;
    getUserProfilesRef.current = usersService.getUserProfiles;
  }, [opportunitiesService, usersService]);

  // Fetch user-to-user chats
  useEffect(() => {
    if (!isReady || !client || !user?.id) return;

    let acceptedByRecipientSnapshot = new Map<string, number>();

    const fetchAcceptedRecipients = async () => {
      try {
        const acceptedOpportunities = await getOpportunitiesRef.current({ status: 'accepted', limit: 300 });
        const acceptedByRecipient = new Map<string, number>();
        for (const opportunity of acceptedOpportunities) {
          const counterpart = opportunity.actors.find(
            (actor) => actor.userId !== user.id && actor.role !== 'introducer'
          ) ?? opportunity.actors.find((actor) => actor.userId !== user.id);

          if (!counterpart?.userId) continue;
          const ts = new Date(opportunity.updatedAt).getTime();
          const existing = acceptedByRecipient.get(counterpart.userId) ?? 0;
          if (ts > existing) acceptedByRecipient.set(counterpart.userId, ts);
        }
        acceptedByRecipientSnapshot = acceptedByRecipient;
      } catch (error) {
        console.error('Failed to fetch accepted opportunities for chats:', error);
      }
    };

    const fetchChats = async () => {
      try {
        if (!hasLoadedChatsRef.current) {
          setLoadingChats(true);
        }
        const streamFilter = {
          type: 'messaging',
          members: { $in: [client.userID || ''] },
        };
        const streamSort = [{ last_message_at: -1 as const }];
        const channels = await client.queryChannels(streamFilter, streamSort, {
          limit: 50,
          watch: false,
          state: true,
        });

        const streamByRecipient = new Map<string, {
          id: string;
          name: string;
          avatar: string | null;
          lastMessage: string;
          sortTimestamp: number;
          unreadCount: number;
        }>();

        channels.forEach((channel: Channel) => {
          const members = Object.values(channel.state.members || {});
          const otherMember = members.find(m => m.user_id !== client.userID);
          const otherUser = otherMember?.user;
          if (!otherUser?.id) return;
          streamByRecipient.set(otherUser.id, {
            id: channel.id || '',
            name: otherUser?.name || 'Unknown',
            avatar: otherUser?.image || null,
            lastMessage: channel.state.messages?.[channel.state.messages.length - 1]?.text || '',
            sortTimestamp: new Date(
              channel.state.last_message_at ||
              channel.state.messages?.[channel.state.messages.length - 1]?.created_at ||
              0
            ).getTime(),
            unreadCount: channel.countUnread(),
          });
        });

        // Only show recipients where the user is still a channel member.
        // Accepted-opportunity counterparts without a Stream channel are excluded.
        const allRecipientIds = Array.from(streamByRecipient.keys());
        const profilesCap = 50;
        const idsToFetch = allRecipientIds.slice(0, profilesCap);
        const profileMap = await getUserProfilesRef.current(idsToFetch);

        const chats: RecentChat[] = allRecipientIds.map((recipientId) => {
          const stream = streamByRecipient.get(recipientId);
          const profile = profileMap.get(recipientId);
          const acceptedTs = acceptedByRecipientSnapshot.get(recipientId) ?? 0;
          const serverUnread = stream?.unreadCount || 0;
          const optimisticUnread = optimisticUnreadRef.current.get(recipientId) || 0;
          return {
            id: stream?.id || `accepted-${recipientId}`,
            recipientId,
            name: profile?.name || stream?.name || 'Unknown',
            avatar: profile?.avatar || stream?.avatar || null,
            lastMessage: stream?.lastMessage || 'Connected via accepted opportunities',
            sortTimestamp: Math.max(stream?.sortTimestamp ?? 0, acceptedTs),
            unreadCount: Math.max(serverUnread, optimisticUnread),
          };
        }).sort(sortChats);

        setRecentChats(chats.slice(0, 10));
      } catch (error) {
        console.error('Failed to fetch chats:', error);
      } finally {
        if (!hasLoadedChatsRef.current) {
          hasLoadedChatsRef.current = true;
          setLoadingChats(false);
        }
      }
    };

    const initialize = async () => {
      await fetchAcceptedRecipients();
      await fetchChats();
    };
    void initialize();

    const scheduleChatsRefresh = () => {
      if (chatsRefreshTimerRef.current) return;
      chatsRefreshTimerRef.current = setTimeout(() => {
        chatsRefreshTimerRef.current = null;
        void fetchChats();
      }, 1200);
    };
    const handleSync = (event?: StreamEvent) => {
      if (!event) {
        scheduleChatsRefresh();
        return;
      }

      if (event.type === 'message.new' || event.type === 'notification.message_new') {
        const senderId = event.user?.id ?? event.message?.user?.id;
        const messageText = event.message?.text?.trim();
        const channelId =
          event.channel_id ??
          (typeof event.cid === 'string' && event.cid.includes(':') ? event.cid.split(':')[1] : undefined);

        if (senderId && senderId !== user.id) {
          setRecentChats((prev) => {
            const next = [...prev];
            const idx = next.findIndex((chat) => chat.recipientId === senderId || (channelId ? chat.id === channelId : false));
            if (idx >= 0) {
              const current = next[idx];
              const unreadIncrement = currentChatUserId === senderId ? 0 : 1;
              const nextUnread = current.unreadCount + unreadIncrement;
              if (unreadIncrement > 0) {
                optimisticUnreadRef.current.set(senderId, nextUnread);
              }
              next[idx] = {
                ...current,
                lastMessage: messageText || current.lastMessage,
                sortTimestamp: Date.now(),
                unreadCount: nextUnread,
              };
              return next.sort(sortChats);
            }
            return prev;
          });
        }
        scheduleChatsRefresh();
        return;
      }

      if (event.type === 'message.read' || event.type === 'notification.mark_read') {
        const channelId =
          event.channel_id ??
          (typeof event.cid === 'string' && event.cid.includes(':') ? event.cid.split(':')[1] : undefined);
        if (channelId) {
          setRecentChats((prev) =>
            prev.map((chat) => {
              if (chat.id !== channelId) return chat;
              optimisticUnreadRef.current.set(chat.recipientId, 0);
              return { ...chat, unreadCount: 0 };
            })
          );
        }
        scheduleChatsRefresh();
        return;
      }

      scheduleChatsRefresh();
    };

    client.on('message.new', handleSync);
    client.on('notification.message_new', handleSync);
    client.on('message.read', handleSync);
    client.on('notification.mark_read', handleSync);
    client.on('notification.mark_unread', handleSync);
    client.on('channel.updated', handleSync);

    return () => {
      if (chatsRefreshTimerRef.current) {
        clearTimeout(chatsRefreshTimerRef.current);
        chatsRefreshTimerRef.current = null;
      }
      client.off('message.new', handleSync);
      client.off('notification.message_new', handleSync);
      client.off('message.read', handleSync);
      client.off('notification.mark_read', handleSync);
      client.off('notification.mark_unread', handleSync);
      client.off('channel.updated', handleSync);
    };
  }, [isReady, client, user?.id, currentChatUserId]);

  useEffect(() => {
    if (!currentChatUserId) return;
    optimisticUnreadRef.current.set(currentChatUserId, 0);
    setRecentChats((prev) =>
      prev.map((chat) =>
        chat.recipientId === currentChatUserId ? { ...chat, unreadCount: 0 } : chat
      )
    );
  }, [currentChatUserId]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(event.target as Node)) {
        setChatMenuOpen(null);
      }
    };
    if (chatMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [chatMenuOpen]);

  const handleDeleteChat = async (channelId: string) => {
    if (!client?.userID || deletingChat) return;
    setDeletingChat(channelId);
    try {
      const channel = client.channel('messaging', channelId);
      await channel.removeMembers([client.userID]);
      setRecentChats(prev => prev.filter(c => c.id !== channelId));
      setChatMenuOpen(null);
    } catch (error) {
      console.error('Failed to delete chat:', error);
    } finally {
      setDeletingChat(null);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="lg:hidden px-4 py-3 min-h-[68px] flex items-center gap-3">
        <button onClick={() => router.push('/')} className="text-[#3D3D3D] hover:text-black transition-colors text-xl mr-2">←</button>
        <h2 className="text-lg font-bold text-black font-ibm-plex-mono">Conversations</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-4 lg:pt-4">
        <h3 className="hidden lg:block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 font-ibm-plex-mono">
          Conversations
        </h3>
        {loadingChats ? (
          <div className="text-sm text-gray-400">Loading...</div>
        ) : recentChats.length === 0 ? (
          <div className="text-sm text-gray-400">No messages yet</div>
        ) : (
          <div className="space-y-1">
            {recentChats.map((chat) => {
              const isSelected = currentChatUserId === chat.recipientId;
              const isUnread = chat.unreadCount > 0;
              return (
                <div 
                  key={chat.id} 
                  className={`relative group flex items-center py-2 px-2 -mx-2 rounded-md transition-colors ${
                    isSelected
                      ? 'bg-gray-100'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <button
                    onClick={() => router.push(`/u/${chat.recipientId}/chat`)}
                    className={`flex-1 flex items-center gap-3 text-sm text-left pr-10 min-w-0 ${
                      isSelected
                        ? 'text-black font-semibold'
                        : isUnread
                          ? 'text-black font-bold'
                          : 'text-gray-700 hover:text-black'
                    }`}
                  >
                    <UserAvatar
                      id={chat.recipientId}
                      name={chat.name}
                      avatar={chat.avatar}
                      size={28}
                      className="flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <p className={`truncate ${isUnread ? 'text-sm font-bold text-black' : 'text-sm font-medium text-black'}`}>
                        {chat.name}
                      </p>
                      <p className={`truncate ${isUnread ? 'text-sm font-semibold text-gray-900' : 'text-sm font-normal text-gray-500'}`}>
                        {(chat.lastMessage || 'No messages yet').replace(/[*_~`#>]/g, '')}
                      </p>
                    </div>
                  </button>
                  <span
                    className={`absolute right-8 top-2 text-[11px] leading-none ${
                      isUnread ? 'font-semibold text-gray-700' : 'font-normal text-gray-400'
                    }`}
                  >
                    {formatConversationTime(chat.sortTimestamp)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setChatMenuOpen(chatMenuOpen === chat.id ? null : chat.id);
                    }}
                    className="p-1 opacity-0 group-hover:opacity-100 hover:bg-gray-100 rounded transition-all flex-shrink-0"
                  >
                    <MoreHorizontal className="w-4 h-4 text-gray-400" />
                  </button>
                  {chatMenuOpen === chat.id && (
                    <div 
                      ref={chatMenuRef}
                      className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px] z-30"
                    >
                      <button
                        onClick={() => handleDeleteChat(chat.id)}
                        disabled={deletingChat === chat.id}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {deletingChat === chat.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
