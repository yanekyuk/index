'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { StreamChat, Channel, type Event as StreamEvent } from 'stream-chat';
import { useAuthContext } from './AuthContext';
import { getAvatarUrl } from '@/lib/file-utils';
import { useAuthenticatedAPI } from '@/lib/api';
import { getDirectChannelId } from '@/lib/chat-channel';
import { useNotifications } from './NotificationContext';
import { usePathname, useRouter } from 'next/navigation';

interface MessageRequest {
  channelId: string;
  requester: {
    id: string;
    name: string;
    avatar?: string;
  } | null;
  firstMessage: string | null;
  createdAt: string;
}

interface SendMessageRequestResponse {
  channelId: string;
  pending: boolean;
  alreadyConnected?: boolean;
}

interface StreamChatContextType {
  client: StreamChat | null;
  isReady: boolean;
  messageRequests: MessageRequest[];
  messageRequestsLoading: boolean;
  requestBrowserNotifications: () => Promise<NotificationPermission | 'unsupported'>;
  openChat: (userId: string, userName: string, userAvatar?: string, initialMessage?: string) => void;
  closeChat: (userId: string) => void;
  clearActiveChat: () => void;
  getOrCreateChannel: (userId: string, userName: string, userAvatar?: string) => Promise<Channel | null>;
  sendMessageRequest: (targetUserId: string, message: string, targetUserName: string, targetUserAvatar?: string) => Promise<SendMessageRequestResponse>;
  respondToMessageRequest: (channelId: string, action: 'ACCEPT' | 'DECLINE' | 'SKIP') => Promise<void>;
  refreshMessageRequests: () => Promise<void>;
}

const StreamChatContext = createContext<StreamChatContextType | undefined>(undefined);

const STREAM_API_KEY = process.env.NEXT_PUBLIC_STREAM_API_KEY || '';

// Simulated message requests for development/testing
const SIMULATED_MESSAGE_REQUESTS: MessageRequest[] = [
  {
    channelId: 'sim_channel_1',
    requester: {
      id: 'sim_user_1',
      name: 'Alex Chen',
      avatar: undefined,
    },
    firstMessage: 'Hey! I saw your work on the AI project and would love to connect.',
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 mins ago
  },
  {
    channelId: 'sim_channel_2',
    requester: {
      id: 'sim_user_2',
      name: 'Jordan Smith',
      avatar: undefined,
    },
    firstMessage: 'Hi there! I noticed we have mutual connections. Would be great to chat about potential collaboration.',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
  },
  {
    channelId: 'sim_channel_3',
    requester: {
      id: 'sim_user_3',
      name: 'Sam Wilson',
      avatar: undefined,
    },
    firstMessage: 'Interested in discussing your recent post about distributed systems.',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
  },
];

export function StreamChatProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuthContext();
  const api = useAuthenticatedAPI();
  const { addNotification } = useNotifications();
  const pathname = usePathname();
  const router = useRouter();
  const [client, setClient] = useState<StreamChat | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [messageRequests, setMessageRequests] = useState<MessageRequest[]>([]);
  const [messageRequestsLoading, setMessageRequestsLoading] = useState(false);
  const connectPromiseRef = useRef<Promise<void> | null>(null);
  const connectedUserIdRef = useRef<string | null>(null);
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());

  // Generate token via backend API
  const generateToken = useCallback(async (userId: string): Promise<string> => {
    const response = await api.post<{ token: string }>('/chat/token', { userId });
    return response.token;
  }, [api]);

  // Initialize Stream Chat client when user is authenticated
  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      if (client) {
        client.disconnectUser();
        setClient(null);
      }
      connectedUserIdRef.current = null;
      connectPromiseRef.current = null;
      setIsReady(false);
      return;
    }

    let mounted = true;
    const userId = user.id;
    const userName = user.name;

    const initStreamChat = async () => {
      try {
        // Create Stream Chat client
        const streamClient = StreamChat.getInstance(STREAM_API_KEY);

        // Reuse existing active connection for the same user.
        if (streamClient.userID === userId) {
          connectedUserIdRef.current = userId;
          if (mounted) {
            setClient(streamClient);
            setIsReady(true);
          }
          return;
        }

        if (connectPromiseRef.current) {
          await connectPromiseRef.current;
          if (mounted && streamClient.userID === userId) {
            setClient(streamClient);
            setIsReady(true);
            return;
          }
          // Awaited connection was for a different user; fall through to create connection for current user.
        }

        const connectPromise = (async () => {
          if (streamClient.userID && streamClient.userID !== userId) {
            await streamClient.disconnectUser();
          }

          // Generate token via backend API
          const token = await generateToken(userId);

          // Connect user
          await streamClient.connectUser(
            {
              id: userId,
              name: userName || 'Anonymous',
              image: getAvatarUrl(user),
            },
            token
          );
          connectedUserIdRef.current = userId;
        })();

        connectPromiseRef.current = connectPromise;
        try {
          await connectPromise;
        } finally {
          if (connectPromiseRef.current === connectPromise) {
            connectPromiseRef.current = null;
          }
        }

        if (mounted) {
          setClient(streamClient);
          setIsReady(true);
        }
      } catch (error) {
        console.error('Failed to initialize Stream Chat:', error);
      }
    };

    initStreamChat();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id, user?.name, generateToken]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (client) {
        client.disconnectUser();
      }
    };
  }, [client]);

  const getOrCreateChannel = useCallback(
    async (otherUserId: string, otherUserName: string, otherUserAvatar?: string): Promise<Channel | null> => {
      if (!client || !user?.id) return null;

      // Ensure the other user exists in Stream Chat before creating the channel
      try {
        const usersResponse = await client.queryUsers({ id: { $eq: otherUserId } });
        if (usersResponse.users.length === 0) {
          await api.post('/chat/user', {
            userId: otherUserId,
            userName: otherUserName,
            userAvatar: otherUserAvatar,
          });
        }
      } catch (error) {
        console.error('Failed to check/upsert user in Stream Chat:', error);
        return null;
      }

      // Create a unique channel ID based on both user IDs (sorted for consistency)
      const channelId = await getDirectChannelId(user.id, otherUserId);

      // Get or create channel
      const channel = client.channel('messaging', channelId, {
        members: [user.id, otherUserId],
      });

      return channel;
    },
    [client, user?.id, api]
  );

  // No-op stubs for compatibility with callers that invoke before router.push
  const openChat = useCallback((_userId: string, _userName: string, _userAvatar?: string, _initialMessage?: string) => {
    // Previously managed openChats for floating windows; now full-page only
  }, []);

  const closeChat = useCallback((_userId: string) => {
    // Previously removed from openChats; now a no-op
  }, []);

  const clearActiveChat = useCallback(() => {
    // Previously cleared activeChatId; now a no-op
  }, []);

  // Send a message request (Instagram-style)
  const sendMessageRequest = useCallback(async (
    targetUserId: string, 
    message: string, 
    targetUserName: string, 
    targetUserAvatar?: string
  ): Promise<SendMessageRequestResponse> => {
    const response = await api.post<SendMessageRequestResponse>('/chat/request', {
      targetUserId,
      message,
      targetUserName,
      targetUserAvatar
    });
    return response;
  }, [api]);

  // Use simulated message requests (endpoint not yet implemented)
  const refreshMessageRequests = useCallback(async (): Promise<void> => {
    if (!isReady) return;
    setMessageRequestsLoading(true);
    setMessageRequests(SIMULATED_MESSAGE_REQUESTS);
    setMessageRequestsLoading(false);
  }, [isReady]);

  const requestBrowserNotifications = useCallback(async (): Promise<NotificationPermission | 'unsupported'> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      return Notification.permission;
    }
    return Notification.requestPermission();
  }, []);

  // Prompt notifications once per user after first interaction.
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'default') return;

    const storageKey = `notification-permission-prompted:${user.id}`;
    if (window.localStorage.getItem(storageKey) === 'true') return;

    const promptOnce = async () => {
      const permission = await requestBrowserNotifications();
      // Persist only after the browser has actually resolved permission.
      if (permission === 'granted' || permission === 'denied') {
        window.localStorage.setItem(storageKey, 'true');
      }
    };

    // Use direct click + keydown as strongest user gestures for permission prompts.
    window.addEventListener('click', promptOnce, { once: true, capture: true });
    window.addEventListener('keydown', promptOnce, { once: true, capture: true });

    return () => {
      window.removeEventListener('click', promptOnce, true);
      window.removeEventListener('keydown', promptOnce, true);
    };
  }, [isAuthenticated, user?.id, requestBrowserNotifications]);

  // Respond to a message request
  const respondToMessageRequest = useCallback(async (
    channelId: string, 
    action: 'ACCEPT' | 'DECLINE' | 'SKIP'
  ): Promise<void> => {
    // Check if this is a simulated request
    const isSimulated = channelId.startsWith('sim_channel_');
    
    if (isSimulated) {
      // Handle simulated requests locally
      setMessageRequests(prev => prev.filter(r => r.channelId !== channelId));
      return;
    }
    
    // Handle real requests via API
    await api.post('/chat/request/respond', { channelId, action });
    // Refresh message requests after responding
    await refreshMessageRequests();
  }, [api, refreshMessageRequests]);

  // Fetch message requests when ready
  useEffect(() => {
    if (isReady) {
      refreshMessageRequests();
    }
  }, [isReady, refreshMessageRequests]);

  // Global incoming DM notifications so users see alerts outside the active chat thread.
  useEffect(() => {
    if (!isReady || !client || !user?.id) return;

    const handleIncomingMessage = async (event: StreamEvent) => {
      const messageId = event.message?.id;
      if (!messageId) return;

      if (notifiedMessageIdsRef.current.has(messageId)) {
        return;
      }
      notifiedMessageIdsRef.current.add(messageId);
      if (notifiedMessageIdsRef.current.size > 500) {
        const iter = notifiedMessageIdsRef.current.values().next();
        if (!iter.done && iter.value) {
          notifiedMessageIdsRef.current.delete(iter.value);
        }
      }

      const senderId = event.message?.user?.id ?? event.user?.id;
      if (!senderId || senderId === user.id) return;

      const currentThreadUserId = pathname?.match(/^\/u\/([^/]+)\/chat/)?.[1];
      const sameThreadVisible =
        currentThreadUserId === senderId &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        document.hasFocus();
      if (sameThreadVisible) return;

      const senderName = event.message?.user?.name?.trim() || event.user?.name?.trim() || 'New message';
      const preview = event.message?.text?.trim() || 'Sent you a message';
      const senderAvatar =
        event.message?.user?.image ||
        event.user?.image ||
        undefined;
      addNotification({
        type: 'info',
        title: senderName,
        message: preview,
        avatarUrl: senderAvatar,
        duration: 5000,
      });

      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const notification = new Notification(senderName, { body: preview });
          notification.onclick = async () => {
            window.focus();
            try {
              const channelId =
                event.channel_id ??
                (await getDirectChannelId(user.id, senderId));
              router.push(`/u/${senderId}/chat?channelId=${encodeURIComponent(channelId)}`);
            } catch {
              router.push(`/u/${senderId}/chat`);
            }
          };
        } catch {
          // Browser notification errors should not block in-app notifications.
        }
      }
    };

    client.on('message.new', handleIncomingMessage);
    client.on('notification.message_new', handleIncomingMessage);
    return () => {
      client.off('message.new', handleIncomingMessage);
      client.off('notification.message_new', handleIncomingMessage);
    };
  }, [isReady, client, user?.id, addNotification, pathname, router]);

  return (
    <StreamChatContext.Provider
      value={{
        client,
        isReady,
        messageRequests,
        messageRequestsLoading,
        requestBrowserNotifications,
        openChat,
        closeChat,
        clearActiveChat,
        getOrCreateChannel,
        sendMessageRequest,
        respondToMessageRequest,
        refreshMessageRequests,
      }}
    >
      {children}
    </StreamChatContext.Provider>
  );
}

export function useStreamChat() {
  const context = useContext(StreamChatContext);
  if (context === undefined) {
    throw new Error('useStreamChat must be used within a StreamChatProvider');
  }
  return context;
}
