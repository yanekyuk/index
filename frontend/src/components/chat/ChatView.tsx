'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Channel, MessageResponse, LocalMessage } from 'stream-chat';
import { useStreamChat } from '@/contexts/StreamChatContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useDiscover } from '@/contexts/APIContext';
import { X, ArrowLeft, Clock, Check, SkipForward, Loader2, ArrowUp } from 'lucide-react';
import Image from 'next/image';
import { getAvatarUrl } from '@/lib/file-utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

interface ChatMessage {
  id: string;
  text?: string;
  user?: { id: string; name?: string } | null;
  created_at?: Date | string;
  status?: string;
}

// Transform MessageResponse or LocalMessage to ChatMessage
const transformMessage = (msg: MessageResponse | LocalMessage): ChatMessage => ({
  id: msg.id,
  text: msg.text,
  user: msg.user ? { id: msg.user.id, name: msg.user.name } : null,
  created_at: msg.created_at instanceof Date ? msg.created_at : msg.created_at,
  status: msg.status,
});

interface ChannelEvent {
  channel?: { id: string };
}

interface ChatViewProps {
  userId: string;
  userName: string;
  userAvatar?: string;
  onClose: () => void;
  onBack?: () => void; // Optional back handler for page-based navigation
}

interface ChannelPendingState {
  isPending: boolean;
  isRequester: boolean;
  awaitingAdminApproval: boolean;
}

export default function ChatView({
  userId,
  userName,
  userAvatar,
  onClose,
  onBack,
}: ChatViewProps) {
  const { client, isReady, getOrCreateChannel, clearActiveChat, respondToMessageRequest, refreshMessageRequests, sendMessageRequest, checkCanMessage } = useStreamChat();
  const { success, error: showError } = useNotifications();
  const discoverService = useDiscover();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingState, setPendingState] = useState<ChannelPendingState>({ isPending: false, isRequester: false, awaitingAdminApproval: false });
  const [respondingAction, setRespondingAction] = useState<string | null>(null);
  const [isNewConversation, setIsNewConversation] = useState(false); // True when user needs to send a message request
  const [mutualIntentCount, setMutualIntentCount] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sendingMessageId, setSendingMessageId] = useState<string | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, []);

  // Initialize channel
  useEffect(() => {
    if (!isReady || !client) {
      setChannel(null);
      setMessages([]);
      setLoading(false);
      return;
    }

    let mounted = true;
    let currentChannel: Channel | null = null;
    let handleMessage: ((event: ChannelEvent) => void) | null = null;
    let handleMessageUpdated: ((event: ChannelEvent) => void) | null = null;
    let syncMessagesHandler: (() => void) | null = null;

    const initChannel = async () => {
      try {
        // First, check if users are connected
        let canMessageDirectly = false;
        try {
          const canMessageResponse = await checkCanMessage(userId);
          canMessageDirectly = canMessageResponse.canMessageDirectly;
          
          // If there's already a pending request, we'll load the channel
          if (canMessageResponse.connectionStatus === 'REQUEST' && canMessageResponse.isInitiator) {
            // User already sent a request, channel should exist
            canMessageDirectly = true; // Allow loading the channel
          }
        } catch (err) {
          console.error('Failed to check message permission:', err);
        }

        // First, check if channel exists using queryChannels (read-only, won't create)
        const sortedIds = [client.userID, userId].sort().join('_');
        const expectedChannelId = sortedIds.length > 64 
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

        const existingChannels = await client.queryChannels(
          { type: 'messaging', id: expectedChannelId },
          {},
          { limit: 1 }
        );

        if (existingChannels.length > 0) {
          // Channel exists - watch it and load messages
          const ch = existingChannels[0];
          currentChannel = ch;
          
          if (!mounted) return;
          
          await ch.watch();
          setChannel(ch);

          // Check pending state from channel data
          const channelData = ch.data as { pending?: boolean; requestedBy?: string; awaitingAdminApproval?: boolean };
          if (channelData?.pending) {
            setPendingState({
              isPending: true,
              isRequester: channelData.requestedBy === client?.userID,
              awaitingAdminApproval: channelData.awaitingAdminApproval || false
            });
          } else {
            setPendingState({ isPending: false, isRequester: false, awaitingAdminApproval: false });
          }
          
          // Check if this is a new conversation (no messages and not connected)
          if (!canMessageDirectly && ch.state.messages.length === 0 && !channelData?.pending) {
            setIsNewConversation(true);
          }
          
          setMessages(ch.state.messages.map(transformMessage));
          setLoading(false);

          // Sync messages from channel state
          syncMessagesHandler = () => {
            if (mounted && ch.state.messages) {
              setMessages(ch.state.messages.map(transformMessage));
              scrollToBottom();
            }
          };

          // Listen for new messages
          handleMessage = (event: ChannelEvent) => {
            if (mounted && event.channel?.id === ch.id) {
              syncMessagesHandler?.();
            }
          };

          // Listen for message updates (including sent messages)
          handleMessageUpdated = (event: ChannelEvent) => {
            if (mounted && event.channel?.id === ch.id) {
              syncMessagesHandler?.();
            }
          };

          ch.on('message.new', handleMessage);
          ch.on('message.updated', handleMessageUpdated);
          
          // Also listen to channel state changes
          ch.on('channel.updated', syncMessagesHandler);
        } else {
          // Channel doesn't exist - this is a new conversation
          // Create local channel object but DON'T call watch() or query()
          const newCh = await getOrCreateChannel(userId, userName, userAvatar);
          if (!newCh) {
            setLoading(false);
            return;
          }
          currentChannel = newCh;
          setIsNewConversation(true);
          setChannel(newCh);
          setMessages([]);
          setLoading(false);
          return;
        }
      } catch (error) {
        console.error('Error initializing channel:', error);
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initChannel();

    return () => {
      mounted = false;
      if (currentChannel) {
        if (handleMessage) {
          currentChannel.off('message.new', handleMessage);
        }
        if (handleMessageUpdated) {
          currentChannel.off('message.updated', handleMessageUpdated);
        }
        if (syncMessagesHandler) {
          currentChannel.off('channel.updated', syncMessagesHandler);
        }
      }
    };
  }, [isReady, client, userId, userName, userAvatar, getOrCreateChannel, scrollToBottom, checkCanMessage]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || sendingMessageId) return;

    const text = messageText.trim();
    setMessageText('');
    
    // Optimistic update - add message immediately
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: ChatMessage = {
      id: tempId,
      text,
      user: client?.userID ? { id: client.userID, name: client?.user?.name } : null,
      created_at: new Date(),
      status: 'sending',
    };
    
    setSendingMessageId(tempId);
    setMessages((prev) => [...prev, optimisticMessage]);
    scrollToBottom();

    try {
      // If this is a new conversation with non-connected user, use sendMessageRequest
      if (isNewConversation) {
        const response = await sendMessageRequest(userId, text, userName, userAvatar);
        
        // Update state after successful request
        setIsNewConversation(false);
        setPendingState({
          isPending: true,
          isRequester: true,
          awaitingAdminApproval: response.awaitingAdminApproval || false
        });
        
        // Keep the optimistic message but mark it as sent
        setMessages((prev) => 
          prev.map((m) => m.id === tempId ? { ...m, status: 'sent' } : m)
        );
        
        success('Message request sent', `${userName} will see this in their message requests.`);
        setSendingMessageId(null);
        scrollToBottom();
        inputRef.current?.focus();
        return;
      }

      // Regular message send for connected users
      if (!channel) return;
      
      const response = await channel.sendMessage({
        text,
      });
      
      // Replace optimistic message with real one
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== tempId);
        return [...filtered, transformMessage(response.message)];
      });
      setSendingMessageId(null);
      scrollToBottom();
      inputRef.current?.focus();
    } catch (error) {
      console.error('Error sending message:', error);
      // Remove failed optimistic message
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setSendingMessageId(null);
      setMessageText(text); // Restore message text
      showError('Failed to send', error instanceof Error ? error.message : 'Please try again.');
    }
  }, [channel, messageText, client, sendingMessageId, scrollToBottom, isNewConversation, sendMessageRequest, userId, userName, userAvatar, success, showError]);

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const avatarUrl = getAvatarUrl({ avatar: userAvatar || null, id: userId, name: userName });

  // Fetch mutual intent count
  useEffect(() => {
    const fetchMutualIntents = async () => {
      try {
        const result = await discoverService.discoverUsers({
          userIds: [userId],
          limit: 1
        });
        const userResult = result.results.find(r => r.user.id === userId);
        if (userResult) {
          setMutualIntentCount(userResult.intents.length);
        } else {
          setMutualIntentCount(0);
        }
      } catch (error) {
        console.error('Error fetching mutual intents:', error);
        setMutualIntentCount(null);
      }
    };
    
    if (isReady && userId) {
      fetchMutualIntents();
    }
  }, [isReady, userId, discoverService]);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      clearActiveChat();
    }
  };

  // Handle responding to message request from within chat view
  const handleRespondToRequest = async (action: 'ACCEPT' | 'DECLINE' | 'SKIP') => {
    if (!channel?.id || respondingAction) return;
    
    setRespondingAction(action);
    try {
      await respondToMessageRequest(channel.id, action);
      
      // Update local pending state
      if (action === 'ACCEPT') {
        setPendingState({ isPending: false, isRequester: false, awaitingAdminApproval: false });
        success('Request accepted', `You can now chat with ${userName}`);
      } else {
        // For decline/skip, close the chat
        success(action === 'DECLINE' ? 'Request declined' : 'Request skipped', 
          action === 'DECLINE' ? 'The message request has been declined.' : 'You can revisit this later.');
        onClose();
      }
      
      // Refresh the message requests list
      await refreshMessageRequests();
    } catch (err) {
      console.error('Failed to respond to request:', err);
      showError('Failed', err instanceof Error ? err.message : 'Please try again later.');
    } finally {
      setRespondingAction(null);
    }
  };

  return (
    <div className="pb-0 flex flex-col flex-1 min-h-0 w-full">
      <div className="space-y-4 rounded-lg mb-4 flex flex-col flex-1 min-h-0">
        {/* Header card - matches AI chat title bar styling */}
        <div className="w-full bg-white border border-gray-800 rounded-sm shadow-lg flex flex-col flex-shrink-0">
          <div className="relative flex items-center gap-3 px-3 py-2 min-h-[54px]">
            <button
              onClick={handleBack}
              className="p-1.5 hover:bg-gray-100 rounded transition-colors flex-shrink-0"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <Image
              src={avatarUrl}
              alt={userName}
              width={36}
              height={36}
              className="rounded-full flex-shrink-0"
            />
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-gray-900 font-ibm-plex-mono truncate">{userName}</h2>
              <div className="text-sm text-gray-500 font-ibm-plex-mono truncate">
                {mutualIntentCount !== null ? (
                  mutualIntentCount > 0 ? (
                    <span>{mutualIntentCount} mutual intent{mutualIntentCount !== 1 ? 's' : ''}</span>
                  ) : (
                    <span>Potential connection</span>
                  )
                ) : (
                  <span>Direct message</span>
                )}
              </div>
            </div>
          </div>
        </div>

      {/* Pending state banners */}
      {pendingState.isPending && (
        <div className={`px-4 py-3 border-b ${
          pendingState.awaitingAdminApproval 
            ? 'bg-amber-50 border-amber-200' 
            : pendingState.isRequester 
              ? 'bg-blue-50 border-blue-200'
              : 'bg-green-50 border-green-200'
        }`}>
          {pendingState.awaitingAdminApproval ? (
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              <span className="text-sm text-amber-800 font-ibm-plex-mono">
                Awaiting admin approval before {userName} can see your message
              </span>
            </div>
          ) : pendingState.isRequester ? (
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-blue-800 font-ibm-plex-mono">
                Message request pending. {userName} hasn't responded yet.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-green-800 font-ibm-plex-mono">
                  {userName} wants to connect with you
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleRespondToRequest('ACCEPT')}
                  disabled={!!respondingAction}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors disabled:opacity-50"
                >
                  {respondingAction === 'ACCEPT' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Accept
                </button>
                <button
                  onClick={() => handleRespondToRequest('SKIP')}
                  disabled={!!respondingAction}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm rounded transition-colors disabled:opacity-50"
                >
                  {respondingAction === 'SKIP' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <SkipForward className="w-4 h-4" />
                  )}
                  Skip
                </button>
                <button
                  onClick={() => handleRespondToRequest('DECLINE')}
                  disabled={!!respondingAction}
                  className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:bg-red-50 text-sm rounded transition-colors disabled:opacity-50"
                >
                  {respondingAction === 'DECLINE' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                  Decline
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Messages area - matches AI chat layout */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 p-4 overflow-y-auto min-h-0 flex flex-col">
          {loading ? (
            <div className="text-center text-gray-500 text-sm py-8">
              Loading...
            </div>
          ) : messages.length === 0 && isNewConversation ? (
            <div className="flex flex-col items-center justify-center px-6 pb-8 flex-1">
              <p className="text-gray-500 text-sm mb-4">Start a conversation with {userName}</p>
              <button
                type="button"
                onClick={() => inputRef.current?.focus()}
                className="border border-gray-300 py-2 mb-2 text-gray-900 font-semibold font-ibm-plex-mono text-lg px-8 mt-4 hover:border-black transition-colors"
              >
                Say hi
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 pb-8 flex-1">
              <p className="text-gray-500 text-sm mb-4">No messages yet. Start the conversation!</p>
              <button
                type="button"
                onClick={() => inputRef.current?.focus()}
                className="border border-gray-300 py-2 mb-2 text-gray-900 font-semibold font-ibm-plex-mono text-lg px-8 mt-4 hover:border-black transition-colors"
              >
                Type a message
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => {
                const isOwn = message.user?.id === client?.userID;
                const messageContent = message.text || '';
                return (
                  <div
                    key={message.id}
                    className={cn('flex', isOwn ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[80%] rounded-sm px-3 py-2',
                        isOwn ? 'bg-black text-white' : 'bg-gray-100 text-gray-900'
                      )}
                    >
                      <article
                        className={cn(
                          'chat-markdown max-w-none',
                          isOwn && 'chat-markdown-invert'
                        )}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {messageContent}
                        </ReactMarkdown>
                      </article>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Notice for new conversations */}
      {isNewConversation && (
        <div className="w-full bg-blue-50 border border-blue-200 rounded-sm px-4 py-3 flex-shrink-0">
          <p className="text-sm text-blue-800 font-ibm-plex-mono">
            Write your first message. {userName} will see this in their message requests and can choose to accept or decline.
          </p>
        </div>
      )}

      {/* Input form card - matches AI chat */}
      {pendingState.isPending && pendingState.isRequester ? (
        <div className="w-full bg-white border border-gray-800 rounded-sm shadow-lg flex flex-col flex-shrink-0">
          <div className="px-4 py-3 text-center text-gray-500 text-sm font-ibm-plex-mono">
            Waiting for {userName} to accept your message request
          </div>
        </div>
      ) : pendingState.isPending && !pendingState.isRequester ? (
        <div className="w-full bg-white border border-gray-800 rounded-sm shadow-lg flex flex-col flex-shrink-0">
          <div className="px-4 py-3 text-center text-gray-500 text-sm font-ibm-plex-mono">
            Accept the request to continue the conversation
          </div>
        </div>
      ) : (
        <div className="w-full bg-white border border-gray-800 rounded-sm shadow-lg flex flex-col flex-shrink-0">
          <div className="relative flex items-center px-3 py-2 min-h-[54px]">
            <Input
              ref={inputRef}
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={isNewConversation ? `Say hi to ${userName}...` : 'Type a message...'}
              disabled={sendingMessageId !== null}
              className="flex-1 font-ibm-plex-mono border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {sendingMessageId ? (
              <button
                type="button"
                onClick={() => setSendingMessageId(null)}
                className="ml-2 h-9 w-9 rounded-full bg-black text-white flex items-center justify-center hover:bg-gray-800 transition-colors cursor-pointer flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!messageText.trim()}
                className="ml-2 h-9 w-9 rounded-full bg-black text-white flex items-center justify-center hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
