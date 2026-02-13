'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import { MoreHorizontal, Trash2, Loader2 } from 'lucide-react';
import { useStreamChat } from '@/contexts/StreamChatContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useOpportunities, useUsers } from '@/contexts/APIContext';
import { getAvatarUrl } from '@/lib/file-utils';
import { Channel } from 'stream-chat';

interface RecentChat {
  id: string;
  recipientId: string;
  name: string;
  avatar: string | null;
  lastMessage: string;
  sortTimestamp: number;
}

export default function ChatSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuthContext();
  const opportunitiesService = useOpportunities();
  const usersService = useUsers();
  const { client, isReady, messageRequests, messageRequestsLoading } = useStreamChat();
  
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState<string | null>(null);
  const [deletingChat, setDeletingChat] = useState<string | null>(null);
  const chatMenuRef = useRef<HTMLDivElement>(null);

  const currentChatUserId = pathname?.match(/^\/u\/([^/]+)\/chat/)?.[1] || null;

  // Fetch user-to-user chats
  useEffect(() => {
    if (!isReady || !client || !user?.id) return;
    
    const fetchChats = async () => {
      try {
        setLoadingChats(true);
        const streamFilter = {
          type: 'messaging',
          members: { $in: [client.userID || ''] },
        };
        const streamSort = [{ last_message_at: -1 as const }];
        const [channels, acceptedOpportunities] = await Promise.all([
          client.queryChannels(streamFilter, streamSort, {
            limit: 50,
            watch: false,
            state: true,
          }),
          opportunitiesService.getOpportunities({ status: 'accepted', limit: 300 }),
        ]);

        const streamByRecipient = new Map<string, {
          id: string;
          name: string;
          avatar: string | null;
          lastMessage: string;
          sortTimestamp: number;
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
          });
        });

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

        const acceptedRecipientIds = Array.from(acceptedByRecipient.keys());
        const profilesCap = 50;
        const idsToFetch = acceptedRecipientIds.slice(0, profilesCap);
        const profileMap = await usersService.getUserProfiles(idsToFetch);

        const chats: RecentChat[] = acceptedRecipientIds.map((recipientId) => {
          const stream = streamByRecipient.get(recipientId);
          const profile = profileMap.get(recipientId);
          const acceptedTs = acceptedByRecipient.get(recipientId) ?? 0;
          return {
            id: stream?.id || `accepted-${recipientId}`,
            recipientId,
            name: profile?.name || stream?.name || 'Unknown',
            avatar: profile?.avatar || stream?.avatar || null,
            lastMessage: stream?.lastMessage || 'Connected via accepted opportunities',
            sortTimestamp: Math.max(stream?.sortTimestamp ?? 0, acceptedTs),
          };
        }).sort((a, b) => b.sortTimestamp - a.sortTimestamp);

        setRecentChats(chats.slice(0, 10));
      } catch (error) {
        console.error('Failed to fetch chats:', error);
      } finally {
        setLoadingChats(false);
      }
    };

    fetchChats();
  }, [isReady, client, opportunitiesService, usersService, user?.id]);

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
    if (!client || deletingChat) return;
    setDeletingChat(channelId);
    try {
      const channel = client.channel('messaging', channelId);
      await channel.delete();
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
      {/* Message Requests Section */}
      {messageRequests.length > 0 && (
        <div className="flex-shrink-0 px-4 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider font-ibm-plex-mono">
              Requests
            </h3>
            <span className="text-xs px-1.5 py-0.5 rounded bg-[#041729] text-white">
              {messageRequests.length}
            </span>
          </div>
          {messageRequestsLoading ? (
            <div className="text-sm text-gray-400">Loading...</div>
          ) : (
            <div className="space-y-1">
              {messageRequests.map((request) => (
                <div 
                  key={request.channelId} 
                  className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-gray-50 transition-colors"
                >
                  <Image
                    src={getAvatarUrl({ 
                      avatar: request.requester?.avatar || null, 
                      id: request.requester?.id || '', 
                      name: request.requester?.name || 'User' 
                    })}
                    alt={request.requester?.name || 'User'}
                    width={28}
                    height={28}
                    className="rounded-full flex-shrink-0"
                  />
                  <span className="text-sm text-gray-700 truncate">
                    {request.requester?.name || 'User'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent Chats Section */}
      <div className="flex-1 overflow-y-auto px-4 pt-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 font-ibm-plex-mono">
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
              return (
                <div 
                  key={chat.id} 
                  className={`relative group flex items-center py-2 px-2 -mx-2 rounded-md transition-colors ${
                    isSelected 
                      ? 'bg-gray-50' 
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <button
                    onClick={() => router.push(`/u/${chat.recipientId}/chat`)}
                    className={`flex-1 flex items-center gap-3 text-sm text-left ${
                      isSelected 
                        ? 'text-black font-medium' 
                        : 'text-gray-700 hover:text-black'
                    }`}
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
