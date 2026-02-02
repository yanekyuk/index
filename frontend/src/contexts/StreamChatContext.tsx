'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { StreamChat, Channel } from 'stream-chat';
import { useAuthContext } from './AuthContext';
import { getAvatarUrl } from '@/lib/file-utils';
import { useAuthenticatedAPI } from '@/lib/api';

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

interface CanMessageResponse {
  canMessageDirectly: boolean;
  connectionStatus: string | null;
  isInitiator: boolean;
  requiresRequest: boolean;
}

interface SendMessageRequestResponse {
  channelId: string;
  pending: boolean;
  awaitingAdminApproval?: boolean;
  alreadyConnected?: boolean;
}

interface StreamChatContextType {
  client: StreamChat | null;
  isReady: boolean;
  messageRequests: MessageRequest[];
  messageRequestsLoading: boolean;
  openChat: (userId: string, userName: string, userAvatar?: string, initialMessage?: string) => void;
  closeChat: (userId: string) => void;
  clearActiveChat: () => void;
  getOrCreateChannel: (userId: string, userName: string, userAvatar?: string) => Promise<Channel | null>;
  checkCanMessage: (targetUserId: string) => Promise<CanMessageResponse>;
  sendMessageRequest: (targetUserId: string, message: string, targetUserName: string, targetUserAvatar?: string) => Promise<SendMessageRequestResponse>;
  respondToMessageRequest: (channelId: string, action: 'ACCEPT' | 'DECLINE' | 'SKIP') => Promise<void>;
  refreshMessageRequests: () => Promise<void>;
}

const StreamChatContext = createContext<StreamChatContextType | undefined>(undefined);

const STREAM_API_KEY = process.env.NEXT_PUBLIC_STREAM_API_KEY || '';

export function StreamChatProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuthContext();
  const api = useAuthenticatedAPI();
  const [client, setClient] = useState<StreamChat | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [messageRequests, setMessageRequests] = useState<MessageRequest[]>([]);
  const [messageRequestsLoading, setMessageRequestsLoading] = useState(false);

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

      // Check if the other user exists in Stream Chat, upsert if not
      try {
        const usersResponse = await client.queryUsers({ id: { $eq: otherUserId } });
        if (usersResponse.users.length === 0) {
          // User doesn't exist, upsert them via backend API
          await api.post('/chat/user', {
            userId: otherUserId,
            userName: otherUserName,
            userAvatar: otherUserAvatar,
          });
        }
      } catch (error) {
        console.error('Failed to check/upsert user in Stream Chat:', error);
        // Continue anyway - channel creation might still work
      }

      // Create a unique channel ID based on both user IDs (sorted for consistency)
      const sortedIds = [user.id, otherUserId].sort().join('_');
      // Hash to ensure it's under 64 characters if needed
      const channelId = sortedIds.length > 64 
        ? (() => {
            let hash = 0;
            for (let i = 0; i < sortedIds.length; i++) {
              const char = sortedIds.charCodeAt(i);
              hash = ((hash << 5) - hash) + char;
              hash = hash & hash;
            }
            return Math.abs(hash).toString(36).slice(0, 63);
          })()
        : sortedIds;

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

  // Check if user can message another user directly
  const checkCanMessage = useCallback(async (targetUserId: string): Promise<CanMessageResponse> => {
    const response = await api.get<CanMessageResponse>(`/chat/can-message/${targetUserId}`);
    return response;
  }, [api]);

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

  // Fetch pending message requests
  const refreshMessageRequests = useCallback(async (): Promise<void> => {
    if (!isReady) return;
    
    setMessageRequestsLoading(true);
    try {
      const response = await api.get<{ requests: MessageRequest[] }>('/chat/requests');
      setMessageRequests(response.requests);
    } catch (error) {
      console.error('Failed to fetch message requests:', error);
    } finally {
      setMessageRequestsLoading(false);
    }
  }, [api, isReady]);

  // Respond to a message request
  const respondToMessageRequest = useCallback(async (
    channelId: string, 
    action: 'ACCEPT' | 'DECLINE' | 'SKIP'
  ): Promise<void> => {
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

  return (
    <StreamChatContext.Provider
      value={{
        client,
        isReady,
        messageRequests,
        messageRequestsLoading,
        openChat,
        closeChat,
        clearActiveChat,
        getOrCreateChannel,
        checkCanMessage,
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
