'use client';

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAIChatSessions } from '@/contexts/AIChatSessionsContext';

interface ThinkingStep {
  content: string;
  step?: string;
  timestamp: Date;
}

export interface DiscoveryOpportunity {
  candidateId: string;
  candidateName?: string;
  candidateAvatar?: string;
  score: number;
  sourceDescription: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  thinking?: ThinkingStep[];
  attachmentNames?: string[];
  discoveries?: DiscoveryOpportunity[];
}

interface AIChatContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  messages: ChatMessage[];
  sessionId: string | null;
  sessionTitle: string | null;
  setSessionId: (id: string | null) => void;
  isLoading: boolean;
  sendMessage: (message: string, fileIds?: string[], attachmentNames?: string[]) => Promise<void>;
  clearChat: () => void;
  loadSession: (sessionId: string) => Promise<void>;
  updateSessionTitle: (sessionId: string, title: string) => Promise<boolean>;
}

const AIChatContext = createContext<AIChatContextType | null>(null);

export function AIChatProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { getAccessToken } = usePrivy();
  const { refetchSessions } = useAIChatSessions();
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (message: string, fileIds?: string[], attachmentNames?: string[]) => {
    const token = await getAccessToken();
    if (!token) return;

    const displayContent = message.trim() || (fileIds?.length ? 'Attached file(s).' : '');
    if (!displayContent) return;

    // Add user message (include attachment names for display)
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: displayContent,
      timestamp: new Date(),
      ...(attachmentNames?.length ? { attachmentNames } : {}),
    };
    setMessages(prev => [...prev, userMessage]);

    // Add placeholder for assistant response
    const assistantMessageId = crypto.randomUUID();
    setMessages(prev => [...prev, {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    }]);

    setIsLoading(true);
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL_V2}/v2/chat/stream`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message.trim() || (fileIds?.length ? 'Attached file(s).' : ''),
          sessionId,
          ...(fileIds?.length ? { fileIds } : {}),
        }),
        signal: abortControllerRef.current.signal,
      });

      // Get session ID from header (new session created)
      const newSessionId = response.headers.get('X-Session-Id');
      if (newSessionId && !sessionId) {
        setSessionId(newSessionId);
        // Show new session in sidebar immediately (will display as "Untitled chat")
        refetchSessions();
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              
              switch (event.type) {
                case 'thinking':
                  setMessages(prev => prev.map(msg => {
                    if (msg.id === assistantMessageId) {
                      const newThinkingStep: ThinkingStep = {
                        content: event.content,
                        step: event.step,
                        timestamp: new Date(event.timestamp),
                      };
                      return {
                        ...msg,
                        thinking: [...(msg.thinking || []), newThinkingStep],
                      };
                    }
                    return msg;
                  }));
                  break;
                case 'token':
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: msg.content + event.content }
                      : msg
                  ));
                  break;
                case 'done':
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: event.response || msg.content, isStreaming: false }
                      : msg
                  ));
                  // Update session title if provided by backend
                  if (event.title) {
                    setSessionTitle(event.title);
                  }
                  // Refetch sessions after streaming completes (title is generated on backend)
                  refetchSessions();
                  break;
                case 'error':
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: `Error: ${event.message}`, isStreaming: false }
                      : msg
                  ));
                  break;
              }
            } catch (e) {
              console.error('Failed to parse SSE event:', e);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Chat stream aborted');
      } else {
        console.error('Chat error:', error);
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMessageId
            ? { ...msg, content: 'Failed to get response. Please try again.', isStreaming: false }
            : msg
        ));
      }
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, sessionId, refetchSessions]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setSessionTitle(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const token = await getAccessToken();
    if (!token) return;

    try {
      const base = process.env.NEXT_PUBLIC_API_URL_V2 || '';
      const res = await fetch(`${base}/v2/chat/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId: id }),
      });
      if (!res.ok) throw new Error('Failed to load session');
      const data = (await res.json()) as {
        session: { id: string; title?: string | null };
        messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
      };
      setSessionId(data.session.id);
      setSessionTitle(data.session.title?.trim() ?? null);
      setMessages(
        data.messages.map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: new Date(m.createdAt),
          isStreaming: false,
        }))
      );
    } catch (err) {
      console.error('Load session error:', err);
    }
  }, [getAccessToken]);

  const updateSessionTitle = useCallback(async (id: string, title: string) => {
    const token = await getAccessToken();
    if (!token) return false;
    const trimmed = title.trim();
    if (!trimmed) return false;

    try {
      const base = process.env.NEXT_PUBLIC_API_URL_V2 || '';
      const res = await fetch(`${base}/v2/chat/session/title`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId: id, title: trimmed }),
      });
      if (!res.ok) return false;
      if (sessionId === id) {
        setSessionTitle(trimmed);
      }
      refetchSessions();
      return true;
    } catch (err) {
      console.error('Update session title error:', err);
      return false;
    }
  }, [getAccessToken, sessionId, refetchSessions]);

  return (
    <AIChatContext.Provider value={{
      isOpen,
      setIsOpen,
      messages,
      sessionId,
      sessionTitle,
      setSessionId,
      isLoading,
      sendMessage,
      clearChat,
      loadSession,
      updateSessionTitle,
    }}>
      {children}
    </AIChatContext.Provider>
  );
}

export function useAIChat() {
  const context = useContext(AIChatContext);
  if (!context) {
    throw new Error('useAIChat must be used within AIChatProvider');
  }
  return context;
}
