'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Channel, MessageResponse, LocalMessage } from 'stream-chat';
import { useStreamChat } from '@/contexts/StreamChatContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { Clock, Check, SkipForward, Loader2, ArrowUp, X, MoreHorizontal, Trash2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { getAvatarUrl } from '@/lib/file-utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { ContentContainer } from '@/components/layout';
import { SystemMessageCard, type SystemMessagePresentation } from './SystemMessageCard';

interface ChatMessage {
  id: string;
  text?: string;
  user?: { id: string; name?: string } | null;
  created_at?: Date | string;
  status?: string;
  type?: string;
  introType?: string;
  opportunityId?: string;
  presentation?: SystemMessagePresentation;
  /** Backend custom marker; takes precedence over top-level introType when present. */
  custom?: { introType?: string };
}

function extractStringField(raw: Record<string, unknown>, key: string): string | undefined {
  const val = raw[key];
  return typeof val === 'string' ? val : undefined;
}

function extractPresentation(raw: Record<string, unknown>): SystemMessagePresentation | undefined {
  const p = raw.presentation;
  if (p && typeof p === 'object' && 'headline' in p && 'personalizedSummary' in p && 'suggestedAction' in p) {
    return p as SystemMessagePresentation;
  }
  return undefined;
}

function extractCustomIntroType(raw: Record<string, unknown>): { introType?: string } | undefined {
  const c = raw.custom;
  if (c && typeof c === 'object' && 'introType' in c) {
    const introType = extractStringField(c as Record<string, unknown>, 'introType');
    return introType !== undefined ? { introType } : undefined;
  }
  return undefined;
}

const transformMessage = (msg: MessageResponse | LocalMessage): ChatMessage => {
  const raw = msg as Record<string, unknown>;
  const custom = extractCustomIntroType(raw);
  return {
    id: msg.id,
    text: msg.text,
    user: msg.user ? { id: msg.user.id, name: msg.user.name } : null,
    created_at: msg.created_at,
    status: msg.status,
    type: msg.type,
    introType: extractStringField(raw, 'introType'),
    opportunityId: extractStringField(raw, 'opportunityId'),
    presentation: extractPresentation(raw),
    custom,
  };
};

interface ChannelEvent {
  channel?: { id: string };
}

interface ChatViewProps {
  userId: string;
  userName: string;
  userAvatar?: string;
  userTitle?: string;
  /** When set (e.g. from accept response), open this exact channel so it matches the backend. */
  initialChannelId?: string;
  onClose: () => void;
  onBack?: () => void;
}

interface ChannelPendingState {
  isPending: boolean;
  isRequester: boolean;
}

interface AcceptedOpportunityMeta {
  opportunityId: string;
  acceptedAt: string;
}

export default function ChatView({ userId, userName, userAvatar, userTitle, initialChannelId, onClose, onBack }: ChatViewProps) {
  const { client, isReady, getOrCreateChannel, clearActiveChat, respondToMessageRequest, refreshMessageRequests } = useStreamChat();
  const { success, error: showError } = useNotifications();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingState, setPendingState] = useState<ChannelPendingState>({ isPending: false, isRequester: false });
  const [respondingAction, setRespondingAction] = useState<string | null>(null);
  const [isNewConversation, setIsNewConversation] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sendingMessageId, setSendingMessageId] = useState<string | null>(null);
  const [channelRefreshKey, setChannelRefreshKey] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [acceptedOpportunities, setAcceptedOpportunities] = useState<AcceptedOpportunityMeta[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, []);

  useEffect(() => {
    if (!isReady || !client) { setChannel(null); setMessages([]); setLoading(false); return; }

    let mounted = true;
    let currentChannel: Channel | null = null;
    let handleMessage: ((event: ChannelEvent) => void) | null = null;
    let handleMessageUpdated: ((event: ChannelEvent) => void) | null = null;
    let syncMessagesHandler: (() => void) | null = null;

    const initChannel = async () => {
      try {
        const expectedChannelId = initialChannelId ?? (() => {
          const sortedIds = [client.userID, userId].sort().join('_');
          return sortedIds.length > 64
            ? (() => { let hash = 0; for (let i = 0; i < sortedIds.length; i++) { const char = sortedIds.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash = hash & hash; } return Math.abs(hash).toString(36).slice(0, 63); })()
            : sortedIds;
        })();

        let existingChannels = await client.queryChannels({ type: 'messaging', id: expectedChannelId }, {}, { limit: 1, watch: true, state: true });

        const shouldRetry = existingChannels.length === 0 && mounted && (channelRefreshKey > 0 || initialChannelId != null);
        if (shouldRetry) {
          await new Promise((r) => setTimeout(r, 500));
          if (!mounted) return;
          existingChannels = await client.queryChannels({ type: 'messaging', id: expectedChannelId }, {}, { limit: 1, watch: true, state: true });
        }

        if (existingChannels.length > 0) {
          const ch = existingChannels[0];
          currentChannel = ch;
          if (!mounted) return;
          await ch.watch();
          setChannel(ch);

          const channelData = ch.data as {
            pending?: boolean;
            requestedBy?: string;
            acceptedOpportunities?: AcceptedOpportunityMeta[];
          };
          if (channelData?.pending) {
            setPendingState({ isPending: true, isRequester: channelData.requestedBy === client?.userID });
          } else {
            setPendingState({ isPending: false, isRequester: false });
          }
          setAcceptedOpportunities(Array.isArray(channelData?.acceptedOpportunities) ? channelData.acceptedOpportunities : []);
          
          setMessages(ch.state.messages.map(transformMessage));
          setLoading(false);

          syncMessagesHandler = () => {
            if (mounted && ch.state.messages) {
              setMessages(ch.state.messages.map(transformMessage));
              const latestChannelData = ch.data as { acceptedOpportunities?: AcceptedOpportunityMeta[] } | undefined;
              setAcceptedOpportunities(Array.isArray(latestChannelData?.acceptedOpportunities) ? latestChannelData.acceptedOpportunities : []);
              scrollToBottom();
            }
          };
          handleMessage = (event: ChannelEvent) => { if (mounted && event.channel?.id === ch.id) syncMessagesHandler?.(); };
          handleMessageUpdated = (event: ChannelEvent) => { if (mounted && event.channel?.id === ch.id) syncMessagesHandler?.(); };

          ch.on('message.new', handleMessage);
          ch.on('message.updated', handleMessageUpdated);
          ch.on('channel.updated', syncMessagesHandler);
        } else {
          if (initialChannelId != null) {
            console.warn(
              '[ChatView] Channel not found after retries for initialChannelId:',
              initialChannelId,
              '— falling back to getOrCreateChannel'
            );
          }
          const newCh = await getOrCreateChannel(userId, userName, userAvatar);
          if (!newCh) { setLoading(false); return; }
          currentChannel = newCh;
          setIsNewConversation(true);
          setChannel(newCh);
          setMessages([]);
          setLoading(false);
          return;
        }
      } catch (error) { console.error('Error initializing channel:', error); if (mounted) setLoading(false); }
    };

    initChannel();

    return () => {
      mounted = false;
      if (currentChannel) {
        if (handleMessage) currentChannel.off('message.new', handleMessage);
        if (handleMessageUpdated) currentChannel.off('message.updated', handleMessageUpdated);
        if (syncMessagesHandler) currentChannel.off('channel.updated', syncMessagesHandler);
      }
    };
  }, [isReady, client, userId, userName, userAvatar, initialChannelId, getOrCreateChannel, scrollToBottom, channelRefreshKey]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || sendingMessageId) return;
    const text = messageText.trim();
    setMessageText('');
    
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: ChatMessage = { id: tempId, text, user: client?.userID ? { id: client.userID, name: client?.user?.name } : null, created_at: new Date(), status: 'sending' };
    
    setSendingMessageId(tempId);
    setMessages((prev) => [...prev, optimisticMessage]);
    scrollToBottom();

    try {
      let activeChannel = channel;

      if (isNewConversation && activeChannel) {
        await activeChannel.watch();
        setIsNewConversation(false);
      }

      if (!activeChannel) {
        inputRef.current?.focus();
        return;
      }
      const response = await activeChannel.sendMessage({ text });
      setMessages((prev) => { const filtered = prev.filter((m) => m.id !== tempId); return [...filtered, transformMessage(response.message)]; });
      setSendingMessageId(null);
      scrollToBottom();
      inputRef.current?.focus();
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setSendingMessageId(null);
      setMessageText(text);
      showError('Failed to send', error instanceof Error ? error.message : 'Please try again.');
      inputRef.current?.focus();
    }
  }, [channel, messageText, client, sendingMessageId, scrollToBottom, isNewConversation, showError]);

  // Auto-focus input on keydown anywhere
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 || e.key === 'Backspace') {
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }, [handleSend]);

  const avatarUrl = getAvatarUrl({ avatar: userAvatar || null, id: userId, name: userName });

  const handleBack = () => { if (onBack) onBack(); else clearActiveChat(); };

  const handleRespondToRequest = async (action: 'ACCEPT' | 'DECLINE' | 'SKIP') => {
    if (!channel?.id || respondingAction) return;
    setRespondingAction(action);
    try {
      await respondToMessageRequest(channel.id, action);
      if (action === 'ACCEPT') { setPendingState({ isPending: false, isRequester: false }); success('Request accepted', `You can now chat with ${userName}`); }
      else { success(action === 'DECLINE' ? 'Request declined' : 'Request skipped', action === 'DECLINE' ? 'The message request has been declined.' : 'You can revisit this later.'); onClose(); }
      await refreshMessageRequests();
    } catch (err) { console.error('Failed to respond to request:', err); showError('Failed', err instanceof Error ? err.message : 'Please try again later.'); }
    finally { setRespondingAction(null); }
  };

  const formatTime = (date: Date | string | undefined) => {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const handleDeleteChat = async () => {
    if (!channel || isDeleting) return;
    setIsDeleting(true);
    try {
      await channel.delete();
      success('Chat deleted', `Conversation with ${userName} has been deleted.`);
      onClose();
    } catch (err) {
      console.error('Failed to delete chat:', err);
      showError('Failed to delete', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setIsDeleting(false);
      setShowMenu(false);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  return (
    <>
      {/* Sticky header - full width */}
      <div className="sticky top-0 bg-white z-10 px-4 py-3 flex items-center justify-between min-h-[68px]">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="text-[#3D3D3D] hover:text-black transition-colors text-xl mr-2">←</button>
          <Link href={`/u/${userId}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="relative">
              <Image src={avatarUrl} alt={userName} width={44} height={44} className="rounded-full" />
            </div>
            <h2 className="font-ibm-plex-mono font-bold text-lg text-black">{userName}</h2>
          </Link>
        </div>
        <div className="relative" ref={menuRef}>
          <button 
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <MoreHorizontal className="w-5 h-5 text-[#3D3D3D]" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px] z-20">
              <button
                onClick={handleDeleteChat}
                disabled={isDeleting || !channel}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable content - centered */}
      <div className="px-6 lg:px-8 py-6 pb-32">
        <ContentContainer>
          {/* Pending state banners */}
          {acceptedOpportunities.length > 0 && (
            <div className="px-4 py-3 rounded-lg mb-4 bg-gray-50 border border-gray-200">
              <div className="text-xs text-gray-600">
                This conversation is linked to {acceptedOpportunities.length} accepted opportunit{acceptedOpportunities.length === 1 ? 'y' : 'ies'}.
              </div>
            </div>
          )}
          {pendingState.isPending && (
            <div className={`px-4 py-3 rounded-lg mb-4 ${pendingState.isRequester ? 'bg-blue-50 border border-blue-200' : 'bg-green-50 border border-green-200'}`}>
              {pendingState.isRequester ? (
                <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-blue-600" /><span className="text-sm text-blue-800 ">Message request pending. {userName} hasn't responded yet.</span></div>
              ) : (
                <div className="space-y-2">
                  <span className="text-sm text-green-800 ">{userName} wants to connect with you</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleRespondToRequest('ACCEPT')} disabled={!!respondingAction} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors disabled:opacity-50">
                      {respondingAction === 'ACCEPT' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Accept
                    </button>
                    <button onClick={() => handleRespondToRequest('SKIP')} disabled={!!respondingAction} className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-[#3D3D3D] text-sm rounded transition-colors disabled:opacity-50">
                      {respondingAction === 'SKIP' ? <Loader2 className="w-4 h-4 animate-spin" /> : <SkipForward className="w-4 h-4" />} Skip
                    </button>
                    <button onClick={() => handleRespondToRequest('DECLINE')} disabled={!!respondingAction} className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:bg-red-50 text-sm rounded transition-colors disabled:opacity-50">
                      {respondingAction === 'DECLINE' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} Decline
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-[#3D3D3D]"><p className=" text-sm">Start a conversation with {userName}</p></div>
          ) : (
            <div className="space-y-4">
              {messages.map((message, index) => {
                const isOwn = message.user?.id === client?.userID;
                const isIndexIntro =
                  message.custom?.introType === 'opportunity_intro' ||
                  message.introType === 'opportunity_intro' ||
                  (message.type === 'system' && message.user?.id === 'index_bot');
                const showTimestamp = index === 0 || (messages[index - 1] && new Date(message.created_at || '').getTime() - new Date(messages[index - 1].created_at || '').getTime() > 300000);

                return (
                  <div key={message.id}>
                    {showTimestamp && message.created_at && (
                      <div className="text-center text-xs text-gray-400  uppercase tracking-wider my-4">Today, {formatTime(message.created_at)}</div>
                    )}
                    {isIndexIntro ? (
                      <SystemMessageCard
                        text={message.text}
                        introType={message.custom?.introType ?? message.introType}
                        presentation={message.presentation}
                      />
                    ) : (
                      <div className={cn('flex items-end gap-2', isOwn ? 'justify-end' : 'justify-start')}>
                        {!isOwn && <Image src={avatarUrl} alt={userName} width={32} height={32} className="rounded-full flex-shrink-0" />}
                        <div className={cn('max-w-[70%] rounded-2xl px-4 py-2', isOwn ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900')}>
                          <article className={cn(' text-sm', isOwn && 'text-white')}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text || ''}</ReactMarkdown>
                          </article>
                        </div>
                        {isOwn && <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 text-xs  font-bold text-[#3D3D3D]">{client?.user?.name?.charAt(0) || 'U'}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ContentContainer>
      </div>

      {/* Fixed input at bottom - left offset accounts for both sidebars (256px + 256px) */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-[32rem] z-20">
        <div className="px-6 lg:px-8 py-4">
          <ContentContainer>
            {pendingState.isPending && pendingState.isRequester ? (
              <div className="text-center text-[#3D3D3D]  text-sm">Waiting for {userName} to accept your message request</div>
            ) : pendingState.isPending && !pendingState.isRequester ? (
              <div className="text-center text-[#3D3D3D]  text-sm">Accept the request to continue the conversation</div>
            ) : (
              <>
                <div className="flex items-center gap-3 bg-gray-100 rounded-full px-4 py-3">
                  <input
                    ref={inputRef}
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder={`Type a message to ${userName}...`}
                    disabled={sendingMessageId !== null}
                    autoFocus
                    className="flex-1 bg-transparent border-none outline-none  text-gray-900 placeholder-gray-500 h-6"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!messageText.trim() || sendingMessageId !== null}
                    className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white flex items-center justify-center hover:bg-[#0a2d4a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </ContentContainer>
        </div>
      </div>
    </>
  );
}
