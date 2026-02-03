'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Loader2, Sparkles, Pencil, Paperclip, X, Globe, Zap, Type, ChevronDown, Lock, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAIChat } from '@/contexts/AIChatContext';
import { useUploadServiceV2 } from '@/services/v2/upload.service';
import { useNotifications } from '@/contexts/NotificationContext';
import { useConnections, useSynthesis, useDiscover } from '@/contexts/APIContext';
import { validateFiles } from '@/lib/file-validation';
import ThinkingDropdown from '@/components/chat/ThinkingDropdown';
import InlineDiscoveryCard from '@/components/chat/InlineDiscoveryCard';
import DiscoveryCard from '@/components/DiscoveryCard';
import { ConnectionAction } from '@/components/ConnectionActions';
import { ContentContainer } from '@/components/layout';
import { StakesByUserResponse } from '@/lib/types';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useIndexFilter } from '@/contexts/IndexFilterContext';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useSuggestions } from '@/hooks/useSuggestions';

interface PendingFile {
  id: string;
  file: File;
}

interface ChatContentProps {
  sessionIdParam?: string | null;
}

// Mock data types
interface MockOpportunity {
  id: string;
  user: { id: string; name: string; avatar: string | null };
  sharedIntents: number;
  backingAgents: number;
  synthesis: string;
  friendNote?: { name: string; text: string };
  expired: boolean;
}

interface MockBridgeMatch {
  id: string;
  userA: { id: string; name: string; role: string; avatar: string | null };
  userB: { id: string; name: string; role: string; avatar: string | null };
  reason: string;
  expired: boolean;
}

interface MockQuestionMatch {
  id: string;
  question: string;
  user: { id: string; name: string; avatar: string | null };
  sharedIntents: number;
  backingAgents: number;
  synthesis: string;
  expired: boolean;
}

// Mock data for home sections
const mockOpportunities: MockOpportunity[] = [
  {
    id: '1',
    user: { id: 'u1', name: 'Mary', avatar: null },
    sharedIntents: 3,
    backingAgents: 3,
    synthesis: "You're stuck on how to frame privacy guarantees for your inference layer. Mary just shipped a TEE-based approach last month and is now questioning whether the tradeoffs were right. Her uncertainty is fresh, and you have the use case that would stress-test her assumptions before she commits further.",
    friendNote: { name: 'Vivek', text: 'Mary would be a good person to talk to about agents' },
    expired: false
  },
  {
    id: '2',
    user: { id: 'u2', name: 'James', avatar: null },
    sharedIntents: 2,
    backingAgents: 2,
    synthesis: "You need distribution for your dev tool but have no GTM motion. James is three weeks from launching a developer community and hasn't locked in the tooling partners yet. If you wait, he'll commit to alternatives and the window closes.",
    expired: false
  },
  {
    id: '3',
    user: { id: 'u3', name: 'Elena', avatar: null },
    sharedIntents: 1,
    backingAgents: 1,
    synthesis: 'No clear opportunity at this time.',
    expired: true
  }
];

const mockPerspectives: MockOpportunity[] = [
  {
    id: '1',
    user: { id: 'u4', name: 'David', avatar: null },
    sharedIntents: 3,
    backingAgents: 3,
    synthesis: "David is trying to decide whether to build or buy auth infrastructure before his Series A closes next month. You've been through this exact decision twice—once wrong, once right. He doesn't have time to learn from his own mistakes here.",
    friendNote: { name: 'Vivek', text: 'David is genuinely uncertain and would value an outside perspective' },
    expired: false
  },
  {
    id: '2',
    user: { id: 'u5', name: 'Priya', avatar: null },
    sharedIntents: 2,
    backingAgents: 1,
    synthesis: 'No clear opportunity at this time.',
    expired: true
  }
];

const mockQuestionMatches: MockQuestionMatch[] = [
  {
    id: '1',
    question: 'Who might be a good early hire or advisor for my startup?',
    user: { id: 'u6', name: 'Rachel', avatar: null },
    sharedIntents: 3,
    backingAgents: 3,
    synthesis: "You're looking for someone who's scaled ops from seed to Series B. Rachel just left that exact role after a difficult exit and is actively figuring out what's next. She has capacity now that she won't have in six weeks.",
    expired: false
  }
];

const mockBridgeMatches: MockBridgeMatch[] = [
  {
    id: '1',
    userA: { id: 'a1', name: 'Alice', role: 'Co-founder at Comp', avatar: null },
    userB: { id: 'b1', name: 'Sarah', role: 'Co-founder at Dolares', avatar: null },
    reason: "Alice is two weeks from demo day with no lead investor committed. Sarah has dry powder allocated for exactly this stage and sector, but her fund's deployment deadline is end of quarter. Neither knows the other exists.",
    expired: false
  },
  {
    id: '2',
    userA: { id: 'a2', name: 'Marcus', role: 'CTO at TechFlow', avatar: null },
    userB: { id: 'b2', name: 'Nina', role: 'Head of Eng at ScaleUp', avatar: null },
    reason: 'No clear opportunity at this time.',
    expired: true
  }
];

export default function ChatContent({ sessionIdParam }: ChatContentProps) {
  const router = useRouter();
  const sessionIdFromUrl = sessionIdParam ?? null;
  const { messages, isLoading, sendMessage, clearChat, loadSession, sessionId, sessionTitle, updateSessionTitle } = useAIChat();
  const uploadServiceV2 = useUploadServiceV2();
  const { error: showError } = useNotifications();
  const [input, setInput] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<PendingFile[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [showExpired, setShowExpired] = useState(false);

  // Discovery state
  const [discoverStakes, setDiscoverStakes] = useState<StakesByUserResponse[]>([]);
  const [syntheses, setSyntheses] = useState<Record<string, string>>({});
  const [synthesisLoading, setSynthesisLoading] = useState<Record<string, boolean>>({});
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const fetchedSynthesesRef = useRef<Set<string>>(new Set());
  const [isIndexDropdownOpen, setIsIndexDropdownOpen] = useState(false);

  const connectionsService = useConnections();
  const synthesisService = useSynthesis();
  const discoverService = useDiscover();
  
  // Index filter
  const { selectedIndexIds, setSelectedIndexIds } = useIndexFilter();
  const { indexes } = useIndexesState();
  const selectedIndexId = selectedIndexIds.length === 1 ? selectedIndexIds[0] : null;
  
  // Suggestions (for conversation mode)
  const { suggestions } = useSuggestions({
    indexId: selectedIndexId,
    enabled: messages.length > 0,
  });
  
  const handleIndexSelect = useCallback((indexId: string | null) => {
    if (indexId === null) {
      setSelectedIndexIds([]);
    } else {
      setSelectedIndexIds([indexId]);
    }
  }, [setSelectedIndexIds]);
  
  const handleSuggestionClick = useCallback((suggestion: { label: string; type: string; followupText?: string; prefill?: string }) => {
    if (suggestion.type === 'prompt' && suggestion.prefill) {
      setInput(suggestion.prefill);
      inputRef.current?.focus();
    } else if (suggestion.type === 'direct' && suggestion.followupText) {
      setInput(suggestion.followupText);
      // Auto-submit after a brief delay
      setTimeout(() => {
        inputRef.current?.form?.requestSubmit();
      }, 50);
    }
  }, []);

  useEffect(() => {
    if (sessionIdFromUrl) {
      loadSession(sessionIdFromUrl).finally(() => setSessionLoaded(true));
    } else {
      clearChat();
      setSessionLoaded(true);
    }
  }, [sessionIdFromUrl, loadSession, clearChat]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Update URL when session changes: push so back from /d/id returns to /
  useEffect(() => {
    if (sessionId && !sessionIdFromUrl) {
      router.push(`/d/${sessionId}`);
    }
  }, [sessionId, sessionIdFromUrl, router]);

  // Fetch discoveries for home state
  const fetchSynthesis = useCallback(async (targetUserId: string) => {
    if (fetchedSynthesesRef.current.has(targetUserId)) return;
    fetchedSynthesesRef.current.add(targetUserId);
    setSynthesisLoading(prev => ({ ...prev, [targetUserId]: true }));

    try {
      const response = await synthesisService.generateVibeCheck({ targetUserId });
      setSyntheses(prev => ({ ...prev, [targetUserId]: response.synthesis }));
    } catch (error) {
      console.error('Error fetching synthesis:', error);
      setSyntheses(prev => ({ ...prev, [targetUserId]: "" }));
    } finally {
      setSynthesisLoading(prev => ({ ...prev, [targetUserId]: false }));
    }
  }, [synthesisService]);

  const fetchDiscovery = useCallback(async () => {
    try {
      const discoverData = await discoverService.discoverUsers({
        excludeDiscovered: true,
        limit: 3
      });

      const transformedStakesData: StakesByUserResponse[] = (discoverData?.results || []).map(result => ({
        user: { id: result.user.id, name: result.user.name, avatar: result.user.avatar || '' },
        intents: (result.intents || []).map(stake => ({
          intent: { id: stake.intent.id, summary: stake.intent.summary, payload: stake.intent.payload, updatedAt: stake.intent.createdAt },
          totalStake: String(stake.totalStake),
          agents: []
        }))
      }));

      setDiscoverStakes(transformedStakesData);
      transformedStakesData.forEach(stake => fetchSynthesis(stake.user.id));
    } catch (error) {
      console.error('Error fetching discovery:', error);
    } finally {
      setDiscoveryLoading(false);
    }
  }, [discoverService, fetchSynthesis]);

  useEffect(() => {
    if (sessionLoaded && messages.length === 0 && !sessionIdFromUrl) {
      fetchDiscovery();
    }
  }, [sessionLoaded, messages.length, sessionIdFromUrl, fetchDiscovery]);

  const handleConnectionAction = useCallback(async (action: ConnectionAction, userId: string) => {
    try {
      switch (action) {
        case 'REQUEST': await connectionsService.requestConnection(userId); break;
        case 'SKIP': await connectionsService.skipConnection(userId); break;
        case 'ACCEPT': await connectionsService.acceptConnection(userId); break;
        case 'DECLINE': await connectionsService.declineConnection(userId); break;
        case 'CANCEL': await connectionsService.cancelConnection(userId); break;
      }
      setDiscoverStakes(prev => prev.filter(s => s.user.id !== userId));
    } catch (error) {
      console.error('Error handling connection action:', error);
      throw error;
    }
  }, [connectionsService]);

  const handleUserClick = useCallback((userId: string) => router.push(`/u/${userId}`), [router]);

  const canSend = input.trim() || selectedFiles.length > 0;
  const isBusy = isLoading || isUploadingFiles;

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const list = Array.from(files);
    const validation = validateFiles(list, 'general');
    if (!validation.isValid) {
      showError(validation.message ?? 'Invalid file(s)');
      e.target.value = '';
      return;
    }
    setSelectedFiles((prev) => [
      ...prev,
      ...list.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
    e.target.value = '';
  }, [showError]);

  const removeFile = useCallback((id: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || isBusy) return;

    const message = input.trim();
    setInput('');

    let fileIds: string[] = [];
    const attachmentNames: string[] = [];
    if (selectedFiles.length > 0) {
      setIsUploadingFiles(true);
      try {
        const uploaded = await Promise.all(
          selectedFiles.map(({ file }) => uploadServiceV2.uploadFile(file))
        );
        fileIds = uploaded.map((f) => f.id);
        attachmentNames.push(...selectedFiles.map(({ file }) => file.name));
        setSelectedFiles([]);
      } catch (err) {
        console.error('[AI Chat] Upload failed:', err);
        showError(err instanceof Error ? err.message : 'Failed to upload file(s)');
        setIsUploadingFiles(false);
        inputRef.current?.focus();
        return;
      }
      setIsUploadingFiles(false);
    }

    await sendMessage(
      message || 'Attached file(s).',
      fileIds.length ? fileIds : undefined,
      attachmentNames.length ? attachmentNames : undefined
    );
    inputRef.current?.focus();
  };

  // Auto-focus input on keydown/paste anywhere
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

  if (!sessionLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Shared input form JSX
  const renderInputForm = () => (
    <>
      {selectedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedFiles.map(({ id, file }) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-gray-100 text-gray-800 text-sm font-ibm-plex-mono max-w-[200px]"
            >
              <span className="truncate" title={file.name}>
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => removeFile(id)}
                className="shrink-0 p-0.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 focus:outline-none"
                aria-label={`Remove ${file.name}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex items-center gap-3 bg-gray-100 rounded-full px-4 py-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.doc,.docx,.epub,.html,.json,.md,.pdf,.ppt,.pptx,.rtf,.tsv,.txt,.xls,.xlsx,.xml"
          onChange={handleFileSelect}
          className="sr-only"
          aria-label="Attach files"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={isBusy}
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 h-8 w-8 rounded-full text-gray-500 hover:text-[#006D4B] hover:bg-gray-200 p-0"
          title="Attach files"
          aria-label="Attach files"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What are you looking for?"
          disabled={isBusy}
          autoFocus
          className="flex-1 font-ibm-plex-mono border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-gray-700"
        />
        <Button
          type="submit"
          size="icon"
          disabled={isBusy || !canSend}
          className="shrink-0 h-8 w-8 rounded-full bg-black text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed p-0"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </>
  );

  // HOME STATE - No messages yet
  if (messages.length === 0) {
    const selectedIndex = indexes.find(i => selectedIndexIds.includes(i.id));
    
    return (
      <div className="px-6 lg:px-8 py-6">
        <ContentContainer>
          <div className="my-6" />
          
          {/* Input with index dropdown */}
          <form onSubmit={handleSubmit} className="flex items-center gap-3 bg-gray-100 rounded-full px-4 py-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".csv,.doc,.docx,.epub,.html,.json,.md,.pdf,.ppt,.pptx,.rtf,.tsv,.txt,.xls,.xlsx,.xml"
              onChange={handleFileSelect}
              className="sr-only"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={isBusy}
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 h-8 w-8 rounded-full text-gray-500 hover:text-[#006D4B] hover:bg-gray-200 p-0"
              title="Attach files"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="What are you looking for?"
              disabled={isBusy}
              autoFocus
              className="flex-1 font-ibm-plex-mono border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-gray-500"
            />
            
            {/* Index dropdown - left of submit */}
            {indexes.length > 0 && (
              <div className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setIsIndexDropdownOpen(!isIndexDropdownOpen)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded-full text-sm font-ibm-plex-mono text-gray-700 transition-colors"
                >
                  {selectedIndex ? <Lock className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                  <span className="max-w-[100px] truncate">{selectedIndex?.title || 'Everywhere'}</span>
                  <ChevronDown className={cn("w-4 h-4 transition-transform", isIndexDropdownOpen && "rotate-180")} />
                </button>
                
                {isIndexDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsIndexDropdownOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                      <button
                        type="button"
                        onClick={() => { handleIndexSelect(null); setIsIndexDropdownOpen(false); }}
                        className={cn(
                          "w-full px-3 py-2 text-left text-sm font-ibm-plex-mono text-gray-700 hover:bg-gray-50 flex items-center gap-2",
                          selectedIndexIds.length === 0 && "text-gray-900 font-medium"
                        )}
                      >
                        <Globe className="w-4 h-4" />
                        Everywhere
                      </button>
                      {indexes.map((index) => (
                        <button
                          key={index.id}
                          type="button"
                          onClick={() => { handleIndexSelect(index.id); setIsIndexDropdownOpen(false); }}
                          className={cn(
                            "w-full px-3 py-2 text-left text-sm font-ibm-plex-mono text-gray-700 hover:bg-gray-50 flex items-center gap-2",
                            selectedIndexIds.includes(index.id) && "text-gray-900 font-medium"
                          )}
                        >
                          <Lock className="w-4 h-4 flex-shrink-0" />
                          <span className="truncate">{index.title}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            
            <Button
              type="submit"
              size="icon"
              disabled={isBusy || !canSend}
              className="shrink-0 h-8 w-8 rounded-full bg-black text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed p-0"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
          
          {/* Selected files */}
          {selectedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {selectedFiles.map(({ id, file }) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-gray-100 text-gray-800 text-sm font-ibm-plex-mono max-w-[200px]"
                >
                  <span className="truncate" title={file.name}>{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(id)}
                    className="shrink-0 p-0.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Show expired toggle */}
          <div className="mt-8 flex justify-end">
            <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer font-ibm-plex-mono">
              <input
                type="checkbox"
                checked={showExpired}
                onChange={(e) => setShowExpired(e.target.checked)}
                className="rounded border-gray-300 text-black focus:ring-black"
              />
              Show expired
            </label>
          </div>

          {/* Section 1: Opportunities waiting for action */}
          <div className="mt-8">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 font-ibm-plex-mono">
              Opportunities waiting for action
            </h3>
            <div className="space-y-4">
              {mockOpportunities
                .filter(item => showExpired || !item.expired)
                .map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "bg-white border border-gray-200 rounded-lg p-4",
                      item.expired && "opacity-50"
                    )}
                  >
                    <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold">
                          {item.user.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-900 font-ibm-plex-mono">{item.user.name}</h4>
                          <p className="text-xs text-gray-500 font-ibm-plex-mono">
                            {item.sharedIntents} shared intent · {item.backingAgents} backing agents
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-2 sm:mt-0">
                        <button className="bg-black text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-800 transition-colors font-ibm-plex-mono">
                          Start Chat
                        </button>
                        <button className="bg-gray-100 border border-gray-200 text-gray-700 px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors font-ibm-plex-mono">
                          Skip
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed mb-3">
                      {item.synthesis}
                    </p>
                    {item.friendNote && (
                      <blockquote className="border-l-2 border-gray-300 pl-3 text-sm text-gray-600 italic">
                        <span className="font-semibold not-italic">{item.friendNote.name} thinks:</span> {item.friendNote.text}
                      </blockquote>
                    )}
                  </div>
                ))}
            </div>
          </div>

          {/* Section 2: Your perspective is crucial */}
          <div className="mt-10">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 font-ibm-plex-mono">
              Your perspective is crucial:
            </h3>
            <div className="space-y-4">
              {mockPerspectives
                .filter(item => showExpired || !item.expired)
                .map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "bg-white border border-gray-200 rounded-lg p-4",
                      item.expired && "opacity-50"
                    )}
                  >
                    <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold">
                          {item.user.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-900 font-ibm-plex-mono">{item.user.name}</h4>
                          <p className="text-xs text-gray-500 font-ibm-plex-mono">
                            {item.sharedIntents} shared intent · {item.backingAgents} backing agents
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-2 sm:mt-0">
                        <button className="bg-black text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-800 transition-colors font-ibm-plex-mono">
                          Start Chat
                        </button>
                        <button className="bg-gray-100 border border-gray-200 text-gray-700 px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors font-ibm-plex-mono">
                          Skip
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed mb-3">
                      {item.synthesis}
                    </p>
                    {item.friendNote && (
                      <blockquote className="border-l-2 border-gray-300 pl-3 text-sm text-gray-600 italic">
                        <span className="font-semibold not-italic">{item.friendNote.name} thinks:</span> {item.friendNote.text}
                      </blockquote>
                    )}
                  </div>
                ))}
            </div>
          </div>

          {/* Section 3: Question-driven matches */}
          {mockQuestionMatches.filter(item => showExpired || !item.expired).length > 0 && (
            <div className="mt-10">
              <h3 className="text-sm font-medium text-gray-900 mb-4 font-ibm-plex-mono">
                {mockQuestionMatches[0].question}
              </h3>
              <div className="space-y-4">
                {mockQuestionMatches
                  .filter(item => showExpired || !item.expired)
                  .map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "bg-white border border-gray-200 rounded-lg p-4",
                        item.expired && "opacity-50"
                      )}
                    >
                      <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold">
                            {item.user.name.charAt(0)}
                          </div>
                          <div>
                            <h4 className="font-bold text-gray-900 font-ibm-plex-mono">{item.user.name}</h4>
                            <p className="text-xs text-gray-500 font-ibm-plex-mono">
                              {item.sharedIntents} shared intent · {item.backingAgents} backing agents
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2 sm:mt-0">
                          <button className="bg-black text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-800 transition-colors font-ibm-plex-mono">
                            Start Chat
                          </button>
                          <button className="bg-gray-100 border border-gray-200 text-gray-700 px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors font-ibm-plex-mono">
                            Skip
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {item.synthesis}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Section 4: You should act as a bridge */}
          <div className="mt-10">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 font-ibm-plex-mono">
              You should act as a bridge
            </h3>
            <div className="space-y-4">
              {mockBridgeMatches
                .filter(item => showExpired || !item.expired)
                .map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "bg-white border border-gray-200 rounded-lg p-4",
                      item.expired && "opacity-50"
                    )}
                  >
                    <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold">
                            {item.userA.name.charAt(0)}
                          </div>
                          <div className="text-left">
                            <h4 className="font-bold text-gray-900 font-ibm-plex-mono text-sm">{item.userA.name}</h4>
                            <p className="text-xs text-gray-500">{item.userA.role}</p>
                          </div>
                        </div>
                        <span className="text-gray-400 mx-2">↔</span>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold">
                            {item.userB.name.charAt(0)}
                          </div>
                          <div className="text-left">
                            <h4 className="font-bold text-gray-900 font-ibm-plex-mono text-sm">{item.userB.name}</h4>
                            <p className="text-xs text-gray-500">{item.userB.role}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3 sm:mt-0">
                        <button className="bg-black text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-800 transition-colors font-ibm-plex-mono">
                          This is a good match
                        </button>
                        <button className="bg-gray-100 border border-gray-200 text-gray-700 px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors font-ibm-plex-mono">
                          Skip
                        </button>
                      </div>
                    </div>
                    <blockquote className="border-l-2 border-gray-300 pl-3 text-sm text-gray-600 italic">
                      {item.reason}
                    </blockquote>
                  </div>
                ))}
            </div>
          </div>
        </ContentContainer>
      </div>
    );
  }

  // CONVERSATION MODE - Has messages
  return (
    <>
      {/* Sticky header - full width, min-h-[68px] matches ChatView header height */}
      <div className="sticky top-0 bg-white z-10 px-4 py-3 flex items-center gap-3 min-h-[68px]">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="p-1 -ml-1 rounded-md hover:bg-gray-100 text-gray-600 hover:text-black transition-colors shrink-0"
          aria-label="Back to home"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
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
              className="text-left font-bold font-ibm-plex-mono text-lg text-black truncate hover:text-gray-700 disabled:pointer-events-none focus:outline-none rounded"
            >
              {displayTitle}
            </button>
            {sessionId && (
              <button
                type="button"
                onClick={startEditingTitle}
                title="Rename conversation"
                className="shrink-0 p-1 rounded text-gray-500 hover:text-[#006D4B] hover:bg-gray-100 focus:outline-none"
                aria-label="Rename conversation"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="px-6 lg:px-8 py-6 pb-32 flex-1">
        <ContentContainer>
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
                      {msg.role === 'user' && msg.attachmentNames && msg.attachmentNames.length > 0 && (
                        <p className="text-xs opacity-90 mt-1.5 font-ibm-plex-mono">
                          Attached: {msg.attachmentNames.join(', ')}
                        </p>
                      )}
                      {msg.isStreaming && (
                        <span className="inline-block w-2 h-4 bg-current animate-pulse ml-1" />
                      )}
                    </div>
                  </div>
                  {/* Inline discovery cards */}
                  {msg.role === 'assistant' && msg.discoveries && msg.discoveries.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.discoveries.map((discovery, idx) => (
                        <InlineDiscoveryCard key={`${discovery.candidateId}-${idx}`} discovery={discovery} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
        </ContentContainer>
      </div>

      {/* Fixed input at bottom */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-64 z-20 bg-white">
        <div className="px-6 lg:px-8 py-4">
          <ContentContainer>
            {/* Suggestion chips - always visible in conversation */}
            {suggestions.length > 0 && (
              <div className="mb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => handleSuggestionClick(suggestion)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-ibm-plex-mono text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                  >
                    {suggestion.type === 'direct' ? (
                      <Zap className="w-3 h-3 text-gray-400" />
                    ) : (
                      <Type className="w-3 h-3 text-gray-400" />
                    )}
                    {suggestion.label}
                  </button>
                ))}
              </div>
            )}
            {renderInputForm()}
          </ContentContainer>
        </div>
      </div>
    </>
  );
}
