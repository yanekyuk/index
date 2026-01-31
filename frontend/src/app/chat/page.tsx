'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Send, Loader2, Sparkles, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthContext } from '@/contexts/AuthContext';
import { useAIChat } from '@/contexts/AIChatContext';
import ClientLayout from '@/components/ClientLayout';
import ThinkingDropdown from '@/components/chat/ThinkingDropdown';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdFromUrl = searchParams?.get('sessionId') ?? null;
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const { messages, isLoading, sendMessage, clearChat, loadSession, sessionId, sessionTitle, updateSessionTitle } = useAIChat();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    if (sessionIdFromUrl) {
      loadSession(sessionIdFromUrl).finally(() => setSessionLoaded(true));
    } else {
      clearChat();
      setSessionLoaded(true);
    }
  }, [sessionIdFromUrl, isAuthenticated, authLoading, loadSession, clearChat]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const message = input;
    setInput('');
    await sendMessage(message);
  };

  const displayTitle =
    sessionTitle ||
    (messages[0]?.role === 'user' ? (messages[0].content.slice(0, 50).trim() + (messages[0].content.length > 50 ? '…' : '')) : null) ||
    'New chat';

  const startEditingTitle = () => {
    if (!sessionId) return;
    setEditTitleValue(displayTitle);
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const saveTitle = async () => {
    setIsEditingTitle(false);
    const trimmed = editTitleValue.trim();
    if (!sessionId || !trimmed || trimmed === displayTitle) return;
    await updateSessionTitle(sessionId, trimmed);
  };

  if (authLoading || !sessionLoaded) {
    return (
      <ClientLayout>
        <div className="pb-0 flex flex-col flex-1 min-h-0">
          <div className="space-y-4 rounded-lg mb-4 flex flex-col flex-1 min-h-0">
            <div className="w-full bg-white p-8 min-h-[400px] flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          </div>
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <div className="pb-0 flex flex-col flex-1 min-h-0">
        <div className="space-y-4 rounded-lg mb-4 flex flex-col flex-1 min-h-0">
          {/* Title bar card - AI mode: warm accent (task-oriented) */}
          <div className="w-full bg-white border border-gray-800 border-l-4 border-l-[#006D4B] rounded-sm shadow-lg flex flex-col flex-shrink-0">
            <div className="relative flex items-center gap-3 px-3 py-2 min-h-[54px]">
              <Sparkles className="h-5 w-5 shrink-0 text-[#006D4B]" aria-hidden />
              {isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                    if (e.key === 'Escape') {
                      setEditTitleValue(displayTitle);
                      setIsEditingTitle(false);
                    }
                  }}
                  className="flex-1 min-w-0 font-semibold font-ibm-plex-mono text-gray-900 bg-transparent border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#006D4B]/30 focus:border-[#006D4B]"
                  placeholder="Conversation title"
                />
              ) : (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={startEditingTitle}
                    disabled={!sessionId}
                    className="text-left font-semibold font-ibm-plex-mono text-gray-900 truncate hover:text-gray-700 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-[#006D4B]/30 rounded"
                  >
                    {displayTitle}
                  </button>
                  <button
                    type="button"
                    onClick={startEditingTitle}
                    title="Rename conversation"
                    disabled={!sessionId}
                    className="shrink-0 p-1 rounded text-gray-500 hover:text-[#006D4B] hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#006D4B]/30 disabled:opacity-50 disabled:pointer-events-none"
                    aria-label="Rename conversation"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Messages area - no card, floats like main view content */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 p-4 overflow-y-auto min-h-0 flex flex-col">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 pb-8 flex-1">
                  <Image
                    className="h-auto"
                    src="/generic.png"
                    alt=""
                    width={300}
                    height={200}
                    style={{ imageRendering: 'auto' }}
                  />
                  <button
                    type="button"
                    onClick={() => inputRef.current?.focus()}
                    className="border border-gray-300 py-2 mb-2 text-gray-900 font-semibold font-ibm-plex-mono text-lg px-8 mt-4 hover:text-black transition-colors"
                  >
                    Ask me anything
                  </button>
                  <p className="text-gray-900 font-500 font-ibm-plex-mono text-sm px-8 mt-2 text-center">
                    Ask me about opportunities, your profile, or anything else!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg) => (
                    <div key={msg.id}>
                      {msg.role === 'assistant' && msg.thinking && (
                        <div className="flex justify-start mb-2">
                          <div className="max-w-[80%]">
                            <ThinkingDropdown
                              thinking={msg.thinking}
                              isStreaming={msg.isStreaming}
                            />
                          </div>
                        </div>
                      )}
                      <div
                        className={cn(
                          'flex',
                          msg.role === 'user' ? 'justify-end' : 'justify-start'
                        )}
                      >
                        <div
                          className={cn(
                            'max-w-[80%] rounded-sm px-3 py-2',
                            msg.role === 'user'
                              ? 'bg-black text-white'
                              : 'bg-gray-100 text-gray-900'
                          )}
                        >
                          {msg.role === 'assistant' && (
                            <span className="text-[10px] uppercase tracking-wider text-[#006D4B]/70 font-ibm-plex-mono mb-1 block">
                              AI Assistant
                            </span>
                          )}
                          <article className={cn(
                            "chat-markdown max-w-none",
                            msg.role === 'user' && 'chat-markdown-invert'
                          )}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          </article>
                          {msg.isStreaming && (
                            <span className="inline-block w-2 h-4 bg-current animate-pulse ml-1" />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={scrollRef} />
                </div>
              )}
            </div>
          </div>

          {/* Input form card - same depth as DiscoveryForm */}
          <div className="w-full bg-white border border-gray-800 rounded-sm shadow-lg flex flex-col flex-shrink-0">
            <form onSubmit={handleSubmit} className="relative flex items-center px-3 py-2 min-h-[54px]">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask AI or find opportunities..."
                disabled={isLoading}
                className="flex-1 font-ibm-plex-mono border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <Button
                type="submit"
                size="icon"
                disabled={isLoading || !input.trim()}
                className="ml-2 shrink-0 font-ibm-plex-mono h-9 w-9 rounded-full bg-black text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </ClientLayout>
  );
}
