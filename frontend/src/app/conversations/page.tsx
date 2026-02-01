'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Loader2 } from 'lucide-react';
import { Channel } from 'stream-chat';
import { useAuthContext } from '@/contexts/AuthContext';
import { useStreamChat } from '@/contexts/StreamChatContext';
import { getAvatarUrl } from '@/lib/file-utils';
import { ContentContainer } from '@/components/layout';

interface ChatItem {
  channelId: string;
  recipientId: string;
  recipientName: string;
  recipientAvatar: string | null;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}

export default function ConversationsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const { client, isReady } = useStreamChat();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [authLoading, isAuthenticated, router]);

  // Fetch conversations
  useEffect(() => {
    if (!isReady || !client) {
      setLoading(false);
      return;
    }

    const fetchConversations = async () => {
      try {
        setLoading(true);
        const filter = {
          type: 'messaging',
          members: { $in: [client.userID || ''] },
        };
        const sort = [{ last_message_at: -1 as const }];
        const channels = await client.queryChannels(filter, sort, {
          watch: true,
          state: true,
          message_limit: 1,
        });

        const chatItems: ChatItem[] = channels.map((channel: Channel) => {
          const members = Object.values(channel.state.members || {});
          const otherMember = members.find(m => m.user_id !== client.userID);
          const otherUser = otherMember?.user;
          const lastMessage = channel.state.messages?.[channel.state.messages.length - 1];
          
          return {
            channelId: channel.id || '',
            recipientId: otherUser?.id || '',
            recipientName: otherUser?.name || 'Unknown',
            recipientAvatar: otherUser?.image || null,
            lastMessage: lastMessage?.text || '',
            lastMessageTime: lastMessage?.created_at?.toString() || '',
            unreadCount: channel.state.unreadCount || 0,
          };
        }).filter((chat: ChatItem) => chat.recipientId);

        setChats(chatItems);
      } catch (error) {
        console.error('Failed to fetch conversations:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchConversations();

    // Listen for updates
    const handleEvent = () => fetchConversations();
    client.on('message.new', handleEvent);
    client.on('channel.updated', handleEvent);

    return () => {
      client.off('message.new', handleEvent);
      client.off('channel.updated', handleEvent);
    };
  }, [isReady, client]);

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  if (authLoading || !isAuthenticated) {
    return null;
  }

  return (
    <>
      {/* Sticky header - full width */}
      <div className="sticky top-0 bg-white border-b border-gray-200 z-10 px-4 py-3">
        <h1 className="font-ibm-plex-mono text-sm font-bold text-black">• Messages</h1>
      </div>

      {/* Scrollable content - centered */}
      <div className="px-6 lg:px-8 py-6">
        <ContentContainer>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : chats.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 font-ibm-plex-mono text-sm">
                No conversations yet
              </p>
              <p className="text-gray-400 font-ibm-plex-mono text-xs mt-2">
                Start a conversation from a discovery match
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {chats.map((chat) => (
                <button
                  key={chat.channelId}
                  onClick={() => router.push(`/u/${chat.recipientId}/chat`)}
                  className={`w-full flex items-center gap-4 p-4 rounded-lg hover:bg-gray-50 transition-colors text-left ${
                    chat.unreadCount > 0 ? 'bg-gray-50' : ''
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <Image
                      src={getAvatarUrl({ avatar: chat.recipientAvatar, id: chat.recipientId, name: chat.recipientName })}
                      alt={chat.recipientName}
                      width={48}
                      height={48}
                      className="rounded-full"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`font-ibm-plex-mono text-sm truncate ${
                        chat.unreadCount > 0 ? 'font-bold text-black' : 'font-medium text-gray-900'
                      }`}>
                        {chat.recipientName}
                      </span>
                      <span className="text-xs text-gray-500 font-ibm-plex-mono flex-shrink-0 ml-2">
                        {formatTime(chat.lastMessageTime)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className={`text-sm font-ibm-plex-mono truncate ${
                        chat.unreadCount > 0 ? 'text-gray-800' : 'text-gray-500'
                      }`}>
                        {chat.lastMessage || 'No messages yet'}
                      </p>
                      {chat.unreadCount > 0 && (
                        <span className="ml-2 flex-shrink-0 w-5 h-5 bg-black text-white text-xs rounded-full flex items-center justify-center font-ibm-plex-mono">
                          {chat.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ContentContainer>
      </div>
    </>
  );
}
