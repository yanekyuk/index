'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useXMTP } from '@/contexts/XMTPContext';
import { Loader2, ArrowUp, MoreHorizontal, Trash2 } from 'lucide-react';
import Link from 'next/link';
import UserAvatar from '@/components/UserAvatar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { ContentContainer } from '@/components/layout';
import { useAuthContext } from '@/contexts/AuthContext';
import type { XmtpChatContext } from '@/services/xmtp';

interface ChatViewProps {
  userId: string;
  userName: string;
  userAvatar?: string;
  userTitle?: string;
  initialGroupId?: string;
  onClose: () => void;
  onBack?: () => void;
}

export default function ChatView({ userId, userName, userAvatar, initialGroupId, onClose, onBack }: ChatViewProps) {
  const { user } = useAuthContext();
  const { isConnected, myInboxId, sendMessage: xmtpSend, loadMessages, messages: allMessages, getChatContext, deleteConversation } = useXMTP();
  const [groupId, setGroupId] = useState<string | null>(initialGroupId ?? null);
  const [chatContext, setChatContext] = useState<XmtpChatContext | null>(null);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const messages = groupId ? (allMessages.get(groupId) || []) : [];

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Init: fetch chat context (read-only, no group creation)
  useEffect(() => {
    if (!isConnected) return;

    let mounted = true;
    const init = async () => {
      try {
        const ctx = await getChatContext(userId);
        if (!mounted) return;
        setChatContext(ctx);
        const gid = initialGroupId ?? ctx?.groupId ?? null;
        setGroupId(gid);
        if (gid) {
          await loadMessages(gid, 50);
        }
      } catch (err) {
        console.error('[ChatView] Init error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();
    return () => { mounted = false; };
  }, [isConnected, userId, initialGroupId, getChatContext, loadMessages]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || sending) return;
    const text = messageText.trim();
    setMessageText('');
    setSending(true);
    try {
      const newGroupId = await xmtpSend(
        groupId
          ? { groupId, text }
          : { peerUserId: userId, text },
      );
      if (!groupId && newGroupId) {
        setGroupId(newGroupId);
        loadMessages(newGroupId, 50);
      }
      inputRef.current?.focus();
    } catch (err) {
      console.error('[ChatView] Send error:', err);
      setMessageText(text);
    } finally {
      setSending(false);
    }
  }, [groupId, userId, messageText, sending, xmtpSend]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 || e.key === 'Backspace') inputRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setShowMenu(false);
    };
    if (showMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  const handleBack = () => { if (onBack) onBack(); else onClose(); };

  const formatTime = (sentAt: string | undefined) => {
    if (!sentAt) return '';
    const ms = Number(sentAt) / 1_000_000;
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const opportunityCards = chatContext?.opportunities ?? [];

  return (
    <>
      {/* Header */}
      <div className="sticky top-0 bg-white z-10 px-4 py-3 flex items-center justify-between min-h-[68px]">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="text-[#3D3D3D] hover:text-black transition-colors text-xl mr-2">&larr;</button>
          <Link href={`/u/${userId}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <UserAvatar avatar={userAvatar} id={userId} name={userName} size={44} />
            <h2 className="font-ibm-plex-mono font-bold text-lg text-black">{userName}</h2>
          </Link>
        </div>
        <div className="relative" ref={menuRef}>
          <button onClick={() => setShowMenu(!showMenu)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <MoreHorizontal className="w-5 h-5 text-[#3D3D3D]" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px] z-20">
              <button
                onClick={async () => {
                  setShowMenu(false);
                  if (groupId) await deleteConversation(groupId);
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="px-6 lg:px-8 pb-32 flex-1">
        <ContentContainer>
          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : (
            <div className="space-y-4">
              {/* Opportunity cards from DB */}
              {opportunityCards.length > 0 && (
                <div className="space-y-3 mb-6">
                  {opportunityCards.map((opp) => (
                    <div key={opp.opportunityId} className="bg-[#F8F8F8] rounded-lg p-4">
                      <p className="text-sm font-semibold text-gray-900 mb-1">{opp.headline}</p>
                      <p className="text-sm text-gray-600 leading-relaxed">{opp.summary}</p>
                    </div>
                  ))}
                </div>
              )}

              {messages.length === 0 && opportunityCards.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-[#3D3D3D]">
                  <p className="text-sm">Start a conversation with {userName}</p>
                </div>
              )}

              {messages.map((message, index) => {
                const isOwn = message.senderInboxId === 'self' || (myInboxId != null && message.senderInboxId === myInboxId);
                const content = typeof message.content === 'string' ? message.content : String(message.content ?? '');
                if (!content.trim()) return null;
                const showTimestamp = index === 0 || (messages[index - 1] && Number(message.sentAt) - Number(messages[index - 1].sentAt) > 300_000_000_000);

                return (
                  <div key={message.id}>
                    {showTimestamp && message.sentAt && (
                      <div className="text-center text-xs text-gray-400 uppercase tracking-wider my-4">Today, {formatTime(message.sentAt)}</div>
                    )}
                    <div className={cn('flex items-end gap-2', isOwn ? 'justify-end' : 'justify-start')}>
                      {!isOwn && <UserAvatar avatar={userAvatar} id={userId} name={userName} size={32} className="flex-shrink-0" />}
                      <div className={cn('max-w-[70%] rounded-2xl px-4 py-2', isOwn ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900')}>
                        <article className={cn('text-sm', isOwn && 'text-white')}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                        </article>
                      </div>
                      {isOwn && (
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 text-xs font-bold text-[#3D3D3D]">
                          {user?.name?.charAt(0) || 'U'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ContentContainer>
      </div>

      {/* Input */}
      <div className="sticky bottom-0 z-20">
        <div className="px-6 lg:px-8">
          <ContentContainer>
            <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
              <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-3 bg-[#F8F8F8] border border-[#E9E9E9] rounded-[32px] px-4 py-3">
                <input
                  ref={inputRef}
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={`Type a message to ${userName}...`}
                  disabled={sending}
                  autoFocus
                  className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 h-6"
                />
                <button
                  type="submit"
                  disabled={!messageText.trim() || sending}
                  className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white flex items-center justify-center hover:bg-[#0a2d4a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </form>
            </div>
            <div className="bg-white py-2"></div>
          </ContentContainer>
        </div>
      </div>
    </>
  );
}
