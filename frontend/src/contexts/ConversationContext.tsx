import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { apiClient } from '@/lib/api';
import { getJwtToken } from '@/lib/auth-client';
import { useAuthContext } from '@/contexts/AuthContext';
import type { ConversationSummary, ConversationMessage } from '@/services/conversation';

const PROTOCOL_BASE = import.meta.env.VITE_PROTOCOL_URL || '';
const SSE_URL = `${PROTOCOL_BASE}/api/conversations/stream`;

interface ConversationContextType {
  conversations: ConversationSummary[];
  messages: Map<string, ConversationMessage[]>;
  isConnected: boolean;
  loadMessages: (conversationId: string, opts?: { limit?: number; before?: string }) => Promise<void>;
  sendMessage: (conversationId: string, parts: unknown[]) => Promise<ConversationMessage | null>;
  refreshConversations: () => Promise<void>;
  hideConversation: (conversationId: string) => Promise<void>;
  getOrCreateDM: (peerUserId: string) => Promise<ConversationSummary>;
}

const ConversationContext = createContext<ConversationContextType | null>(null);

/**
 * Provides real-time conversation state via SSE and REST API calls.
 */
export function ConversationProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthContext();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Map<string, ConversationMessage[]>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- REST helpers (use apiClient directly, same pattern as AIChatContext) ---

  const refreshConversations = useCallback(async () => {
    try {
      const data = await apiClient.get<{ conversations: ConversationSummary[] }>('/conversations');
      setConversations(data.conversations);
    } catch (err) {
      console.error('[ConversationContext] Failed to fetch conversations:', err);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, opts?: { limit?: number; before?: string }) => {
    try {
      const params = new URLSearchParams();
      if (opts?.limit) params.set('limit', String(opts.limit));
      if (opts?.before) params.set('before', opts.before);
      const qs = params.toString();
      const data = await apiClient.get<{ messages: ConversationMessage[] }>(
        `/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`
      );
      setMessages((prev) => {
        const next = new Map(prev);
        next.set(conversationId, data.messages);
        return next;
      });
    } catch (err) {
      console.error('[ConversationContext] Failed to load messages:', err);
    }
  }, []);

  const sendMessage = useCallback(async (conversationId: string, parts: unknown[]): Promise<ConversationMessage | null> => {
    // Optimistic update
    const optimisticId = crypto.randomUUID();
    const optimistic: ConversationMessage = {
      id: optimisticId,
      conversationId,
      senderId: user?.id ?? '',
      role: 'user',
      parts,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => {
      const next = new Map(prev);
      const existing = next.get(conversationId) || [];
      next.set(conversationId, [...existing, optimistic]);
      return next;
    });

    try {
      const data = await apiClient.post<{ message: ConversationMessage }>(
        `/conversations/${conversationId}/messages`,
        { parts }
      );
      // Replace optimistic message with real one
      setMessages((prev) => {
        const next = new Map(prev);
        const existing = next.get(conversationId) || [];
        next.set(
          conversationId,
          existing.map((m) => (m.id === optimisticId ? data.message : m))
        );
        return next;
      });
      return data.message;
    } catch (err) {
      console.error('[ConversationContext] Failed to send message:', err);
      // Roll back optimistic update
      setMessages((prev) => {
        const next = new Map(prev);
        const existing = next.get(conversationId) || [];
        next.set(
          conversationId,
          existing.filter((m) => m.id !== optimisticId)
        );
        return next;
      });
      return null;
    }
  }, []);

  const hideConversation = useCallback(async (conversationId: string) => {
    try {
      await apiClient.delete(`/conversations/${conversationId}`);
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      setMessages((prev) => {
        const next = new Map(prev);
        next.delete(conversationId);
        return next;
      });
    } catch (err) {
      console.error('[ConversationContext] Failed to hide conversation:', err);
    }
  }, []);

  const getOrCreateDM = useCallback(async (peerUserId: string): Promise<ConversationSummary> => {
    const data = await apiClient.post<{ conversation: ConversationSummary }>(
      '/conversations/dm',
      { peerUserId }
    );
    // Add to list if not already present
    setConversations((prev) => {
      if (prev.some((c) => c.id === data.conversation.id)) return prev;
      return [data.conversation, ...prev];
    });
    return data.conversation;
  }, []);

  // --- SSE connection ---

  const connectSSE = useCallback(async () => {
    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      const token = await getJwtToken();
      const url = `${SSE_URL}?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          switch (data.type) {
            case 'connected':
              setIsConnected(true);
              break;
            case 'message': {
              const msg = data.message as ConversationMessage;
              const convId = data.conversationId as string;
              // Append message to the conversation's message list
              setMessages((prev) => {
                const next = new Map(prev);
                const existing = next.get(convId) || [];
                // Deduplicate by id (in case we already have it from optimistic update)
                if (existing.some((m) => m.id === msg.id)) return prev;
                next.set(convId, [...existing, msg]);
                return next;
              });
              // Update conversation summary
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === convId
                    ? {
                        ...c,
                        lastMessage: { parts: msg.parts, senderId: msg.senderId, createdAt: msg.createdAt },
                        lastMessageAt: msg.createdAt,
                      }
                    : c
                )
              );
              break;
            }
          }
        } catch {
          // Ignore parse errors (e.g. keepalive comments)
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        es.close();
        eventSourceRef.current = null;
        // Retry after 5 seconds
        retryTimeoutRef.current = setTimeout(() => {
          connectSSE();
        }, 5000);
      };
    } catch (err) {
      console.error('[ConversationContext] SSE connection failed:', err);
      // Retry after 5 seconds
      retryTimeoutRef.current = setTimeout(() => {
        connectSSE();
      }, 5000);
    }
  }, []);

  // Connect SSE and load conversations when authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      // Clean up on logout
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      setIsConnected(false);
      setConversations([]);
      setMessages(new Map());
      return;
    }

    refreshConversations();
    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [isAuthenticated, refreshConversations, connectSSE]);

  return (
    <ConversationContext.Provider
      value={{
        conversations,
        messages,
        isConnected,
        loadMessages,
        sendMessage,
        refreshConversations,
        hideConversation,
        getOrCreateDM,
      }}
    >
      {children}
    </ConversationContext.Provider>
  );
}

export function useConversation() {
  const context = useContext(ConversationContext);
  if (!context) {
    throw new Error('useConversation must be used within ConversationProvider');
  }
  return context;
}
