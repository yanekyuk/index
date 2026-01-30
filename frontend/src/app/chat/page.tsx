'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Send, Loader2, Trash2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthContext } from '@/contexts/AuthContext';
import { useAIChat } from '@/contexts/AIChatContext';
import ClientLayout from '@/components/ClientLayout';
import ThinkingDropdown from '@/components/chat/ThinkingDropdown';
import { cn } from '@/lib/utils';

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdFromUrl = searchParams?.get('sessionId') ?? null;
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const { messages, isLoading, sendMessage, clearChat, loadSession } = useAIChat();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

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

  const handleNewChat = () => {
    clearChat();
    router.push('/chat');
  };

  if (authLoading || !sessionLoaded) {
    return (
      <ClientLayout>
        <div className="bg-white border border-gray-800 rounded-sm p-8 min-h-[400px] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[400px] bg-white border border-gray-800 rounded-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#006D4B]" />
            <span className="font-semibold font-ibm-plex-mono">AI Assistant</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNewChat}
            title="New chat"
            className="h-8 w-8 font-ibm-plex-mono"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Messages - center area */}
        <div className="flex-1 p-4 overflow-y-auto min-h-0">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-ibm-plex-mono text-sm">
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
                          : 'bg-gray-100 text-gray-800'
                      )}
                    >
                      <p className="whitespace-pre-wrap text-sm font-ibm-plex-mono">
                        {msg.content}
                      </p>
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

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="p-4 border-t border-gray-200 flex-shrink-0"
        >
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              disabled={isLoading}
              className="flex-1 font-ibm-plex-mono"
            />
            <Button
              type="submit"
              size="icon"
              disabled={isLoading || !input.trim()}
              className="font-ibm-plex-mono"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </form>
      </div>
    </ClientLayout>
  );
}
