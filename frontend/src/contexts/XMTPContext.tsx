'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { useAuthContext } from './AuthContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { getJwtToken } from '@/lib/auth-client';
import { createXmtpService, type XmtpConversation, type XmtpMessage, type XmtpChatContext } from '@/services/xmtp';

interface XMTPContextType {
  isConnected: boolean;
  myInboxId: string | null;
  conversations: XmtpConversation[];
  messages: Map<string, XmtpMessage[]>;
  totalUnreadCount: number;
  deletedConversationIds: Set<string>;
  sendMessage: (params: { groupId?: string; peerUserId?: string; text: string }) => Promise<string | null>;
  getChatContext: (peerUserId: string) => Promise<XmtpChatContext | null>;
  loadMessages: (groupId: string, limit?: number) => Promise<XmtpMessage[]>;
  refreshConversations: () => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
}

const XMTPContext = createContext<XMTPContextType | undefined>(undefined);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export function XMTPProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuthContext();
  const api = useAuthenticatedAPI();
  const [isConnected, setIsConnected] = useState(false);
  const [myInboxId, setMyInboxId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<XmtpConversation[]>([]);
  const [messages, setMessages] = useState<Map<string, XmtpMessage[]>>(new Map());
  const [totalUnreadCount] = useState(0);
  const [deletedConversationIds, setDeletedConversationIds] = useState<Set<string>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);
  const serviceRef = useRef(createXmtpService(api));

  useEffect(() => {
    serviceRef.current = createXmtpService(api);
  }, [api]);

  const refreshConversations = useCallback(async () => {
    try {
      const result = await serviceRef.current.getConversations();
      setConversations(result.conversations);
    } catch (err) {
      console.error('[XMTPContext] Failed to fetch conversations:', err);
    }
  }, []);

  const getChatContext = useCallback(async (peerUserId: string): Promise<XmtpChatContext | null> => {
    try {
      const [oppCtx, dmResult] = await Promise.all([
        serviceRef.current.getChatContext(peerUserId),
        serviceRef.current.findDm(peerUserId).catch(() => ({ groupId: null })),
      ]);
      return { ...oppCtx, groupId: dmResult.groupId };
    } catch (err) {
      console.error('[XMTPContext] Failed to get chat context:', err);
      return null;
    }
  }, []);

  const loadMessages = useCallback(async (groupId: string, limit?: number): Promise<XmtpMessage[]> => {
    try {
      const result = await serviceRef.current.getMessages(groupId, limit);
      setMessages(prev => {
        const next = new Map(prev);
        next.set(groupId, result.messages);
        return next;
      });
      return result.messages;
    } catch (err) {
      console.error('[XMTPContext] Failed to load messages:', err);
      return [];
    }
  }, []);

  const sendMessage = useCallback(async (params: { groupId?: string; peerUserId?: string; text: string }): Promise<string | null> => {
    const optimisticGroupId = params.groupId ?? `pending-${params.peerUserId}`;
    const optimistic: XmtpMessage = {
      id: `optimistic-${Date.now()}`,
      senderInboxId: 'self',
      content: params.text,
      sentAt: String(Date.now() * 1_000_000),
    };
    setMessages(prev => {
      const next = new Map(prev);
      const existing = next.get(optimisticGroupId) || [];
      next.set(optimisticGroupId, [...existing, optimistic]);
      return next;
    });

    const result = await serviceRef.current.sendMessage(params);

    // If a new group was created, move optimistic messages to the real groupId
    if (!params.groupId && result.groupId) {
      setMessages(prev => {
        const next = new Map(prev);
        const pending = next.get(optimisticGroupId) || [];
        next.delete(optimisticGroupId);
        next.set(result.groupId, pending);
        return next;
      });
    }

    return result.groupId;
  }, []);

  const deleteConversation = useCallback(async (conversationId: string) => {
    await serviceRef.current.deleteConversation(conversationId);
    setDeletedConversationIds(prev => new Set(prev).add(conversationId));
    setConversations(prev => prev.filter(c => c.groupId !== conversationId));
    setMessages(prev => {
      const next = new Map(prev);
      next.delete(conversationId);
      return next;
    });
  }, []);

  // SSE stream for real-time messages
  useEffect(() => {
    if (!isAuthenticated || !user) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    const connectSSE = async () => {
      let url = `${API_BASE}/xmtp/stream`;
      try {
        const token = await getJwtToken();
        url += `?token=${encodeURIComponent(token)}`;
      } catch {
        setTimeout(connectSSE, 5000);
        return;
      }
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => setIsConnected(true);

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.error) {
            console.error('[XMTPContext] Stream error:', data.error);
            return;
          }
          if (data.type === 'identity') {
            setMyInboxId(data.inboxId);
            return;
          }
          if (data.type !== 'message' || !data.groupId) return;
          if (deletedConversationIds.has(data.groupId)) return;

          const msg: XmtpMessage = {
            id: data.id ?? `sse-${Date.now()}`,
            senderInboxId: data.senderInboxId,
            content: data.content,
            sentAt: data.sentAt,
          };
          setMessages(prev => {
            const next = new Map(prev);
            const existing = next.get(data.groupId) || [];
            const seen = new Set<string>();
            seen.add(msg.id);
            const filtered = existing.filter(m => {
              if (m.id.startsWith('optimistic-')) return false;
              if (seen.has(m.id)) return false;
              seen.add(m.id);
              return true;
            });
            next.set(data.groupId, [...filtered, msg]);
            return next;
          });
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        setIsConnected(false);
        es.close();
        setTimeout(() => void connectSSE(), 5000);
      };
    };

    void connectSSE();
    void refreshConversations();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [isAuthenticated, user, refreshConversations]);

  return (
    <XMTPContext.Provider value={{
      isConnected,
      myInboxId,
      conversations,
      messages,
      totalUnreadCount,
      deletedConversationIds,
      sendMessage,
      getChatContext,
      loadMessages,
      refreshConversations,
      deleteConversation,
    }}>
      {children}
    </XMTPContext.Provider>
  );
}

export function useXMTP() {
  const context = useContext(XMTPContext);
  if (context === undefined) {
    throw new Error('useXMTP must be used within an XMTPProvider');
  }
  return context;
}
