'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Loader2, Pencil, Paperclip, X, Globe, Zap, Type, ChevronDown, Lock, ChevronLeft, Bot, Hourglass, Telescope, Route } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MentionsTextInput } from '@/components/MentionsInput';
import { useAIChat } from '@/contexts/AIChatContext';
import { useUploadServiceV2 } from '@/services/v2/upload.service';
import { useNotifications } from '@/contexts/NotificationContext';
import { useConnections, useSynthesis, useOpportunities } from '@/contexts/APIContext';
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
import Image from 'next/image';
import { getAvatarUrl } from '@/lib/file-utils';
import { mentionsToMarkdownLinks } from '@/lib/mentions';
import type { HomeViewSection, HomeViewCardItem } from '@/services/opportunities';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';

/**
 * When true, use GET /opportunities/home for dynamic sections; when false, use static/mock data.
 */
const USE_HOME_API = true;
/**
 * Static home discovery data (no remote calls). Used when USE_HOME_API is false.
 */
const USE_STATIC_HOME_DISCOVERY = true;

const STATIC_AVATARS = {
  p1: 'https://i.pravatar.cc/150?img=32',
  p2: 'https://i.pravatar.cc/150?img=33',
  p3: 'https://i.pravatar.cc/150?img=47',
  p4: 'https://i.pravatar.cc/150?img=52',
} as const;

const STATIC_OPPORTUNITIES: MockOpportunity[] = [
  {
    id: 'static-1',
    user: { id: 'au', name: 'Sofia Chen', avatar: STATIC_AVATARS.p1 },
    mutualIntents: 1,
    backingAgents: 1,
    synthesis: 'You are [exploring privacy](https://index.network/intents/65c37d58-a75d-4bf1-b746-f2a050f48eba) within agent-native protocols, which aligns perfectly with Sofia\'s work building privacy standards for the open metaverse. It\'s a rare find to meet someone else who thinks decentralized ID is the real solution to our data crisis, so you two should definitely compare notes.',
    friendNote: { name: 'Index', text: 'Good fit based on mutual intent.' },
    expired: false,
  },
  {
    id: 'static-2',
    user: { id: 'ms', name: 'James Okonkwo', avatar: STATIC_AVATARS.p2 },
    mutualIntents: 1,
    backingAgents: 1,
    synthesis: 'You are [experimenting with coordination](https://index.network/intents/cd9c9a91-f56c-40ed-b48a-073aa8706a9e) for multi-agent systems, which aligns perfectly with James Okonkwo\'s deep expertise in behavioral economics and incentive design. It is a rare chance to bridge your technical models with his experience in building trust-based game theory—basically, the ultimate brain trust for your agents.',
    expired: false,
  },
  {
    id: 'static-3',
    user: { id: 'at', name: 'Maya Patel', avatar: STATIC_AVATARS.p3 },
    mutualIntents: 1,
    backingAgents: 1,
    synthesis: 'You are looking to [partner with ecosystems](https://index.network/intents/14378471-d361-455b-a25f-967351404369) to seed high-intent users, which aligns perfectly with Maya Patel\'s expertise in driving Web3 growth through data-driven community strategies. It seems like a great time to brainstorm how her background in decentralized outreach can help you accelerate those network effects—plus, two heads are always better than one when navigating the crypto wild west.',
    expired: false,
  },
];

const STATIC_PERSPECTIVES: MockOpportunity[] = [
  {
    id: 'static-p1',
    user: { id: 'au', name: 'Sofia Chen', avatar: STATIC_AVATARS.p1 },
    mutualIntents: 1,
    backingAgents: 1,
    synthesis: 'You are [exploring privacy](https://index.network/intents/65c37d58-a75d-4bf1-b746-f2a050f48eba) within agent-native protocols, which aligns perfectly with Sofia\'s work building privacy standards for the open metaverse. It\'s a rare find to meet someone else who thinks decentralized ID is the real solution to our data crisis, so you two should definitely compare notes.',
    friendNote: { name: 'Alex', text: 'Would intro again—rare alignment.' },
    expired: false,
  },
  {
    id: 'static-p2',
    user: { id: 'ms', name: 'James Okonkwo', avatar: STATIC_AVATARS.p2 },
    mutualIntents: 1,
    backingAgents: 1,
    synthesis: 'You are [experimenting with coordination](https://index.network/intents/cd9c9a91-f56c-40ed-b48a-073aa8706a9e) for multi-agent systems, which aligns perfectly with James Okonkwo\'s deep expertise in behavioral economics and incentive design. It is a rare chance to bridge your technical models with his experience in building trust-based game theory—basically, the ultimate brain trust for your agents.',
    friendNote: { name: 'Sam', text: 'Seen their work. Worth your time.' },
    expired: false,
  },
];

const STATIC_PERSPECTIVES2: MockOpportunity[] = [
  {
    id: 'static-p2-1',
    user: { id: 'at', name: 'Maya Patel', avatar: STATIC_AVATARS.p3 },
    mutualIntents: 1,
    backingAgents: 1,
    synthesis: 'You are looking to [partner with ecosystems](https://index.network/intents/14378471-d361-455b-a25f-967351404369) to seed high-intent users, which aligns perfectly with Maya Patel\'s expertise in driving Web3 growth through data-driven community strategies. It seems like a great time to brainstorm how her background in decentralized outreach can help you accelerate those network effects—plus, two heads are always better than one when navigating the crypto wild west.',
    friendNote: { name: 'Jordan', text: 'One of the sharpest in the space.' },
    expired: false,
  },
  {
    id: 'static-p2-2',
    user: { id: 'mr', name: 'Lucas Berg', avatar: STATIC_AVATARS.p4 },
    mutualIntents: 2,
    backingAgents: 2,
    synthesis: 'You are looking to [connect with innovators](https://index.network/intents/d034b346-7c04-4d9e-9321-9a98ae307098) to discuss retail media, while Lucas Berg brings a unique blend of clinical expertise and deep crypto experience dating back to 2016. His background in full-stack development and blockchain offers a fresh technical perspective for your [potential integrations](https://index.network/intents/d034b346-7c04-4d9e-9321-9a98ae307098), proving that even orthodontists can be tech pioneers.',
    friendNote: { name: 'Riley', text: 'Known them for years. Strong vouch.' },
    expired: false,
  },
];

const STATIC_BRIDGE: MockBridgeMatch[] = [
  {
    id: 'static-b1',
    userA: { id: 'au', name: 'Sofia Chen', role: 'Member', avatar: STATIC_AVATARS.p1 },
    userB: { id: 'ms', name: 'James Okonkwo', role: 'Member', avatar: STATIC_AVATARS.p2 },
    reason: 'You are [exploring privacy](https://index.network/intents/65c37d58-a75d-4bf1-b746-f2a050f48eba) within agent-native protocols, which aligns perfectly with Sofia\'s work building privacy standards for the open metaverse. It\'s a rare find to meet someone else who thinks decentralized ID is the real solution to our data crisis, so you two should definitely compare notes.',
    expired: false,
  },
  {
    id: 'static-b2',
    userA: { id: 'at', name: 'Maya Patel', role: 'Member', avatar: STATIC_AVATARS.p3 },
    userB: { id: 'mr', name: 'Lucas Berg', role: 'Member', avatar: STATIC_AVATARS.p4 },
    reason: 'You are looking to [partner with ecosystems](https://index.network/intents/14378471-d361-455b-a25f-967351404369) to seed high-intent users. Maya and Lucas both bring Web3 growth and technical depth—a good intro could unlock collaboration.',
    expired: false,
  },
];

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
  mutualIntents: number;
  backingAgents: number;
  synthesis: string;
  friendNote?: { name: string; text: string };
  expired: boolean;
  expiredAt?: string; // ISO date, for ordering when expired
}

interface MockBridgeMatch {
  id: string;
  userA: { id: string; name: string; role: string; avatar: string | null };
  userB: { id: string; name: string; role: string; avatar: string | null };
  reason: string;
  expired: boolean;
  expiredAt?: string;
}

interface MockQuestionMatch {
  id: string;
  question: string;
  user: { id: string; name: string; avatar: string | null };
  mutualIntents: number;
  backingAgents: number;
  synthesis: string;
  expired: boolean;
  expiredAt?: string;
}

type ExpiredItem =
  | { type: 'opportunity'; expiredAt: string; data: MockOpportunity }
  | { type: 'perspective'; expiredAt: string; data: MockOpportunity }
  | { type: 'question'; expiredAt: string; data: MockQuestionMatch }
  | { type: 'bridge'; expiredAt: string; data: MockBridgeMatch };

// Mock data for home sections
const mockOpportunities: MockOpportunity[] = [
  {
    id: '1',
    user: { id: 'u1', name: 'Mary', avatar: null },
    mutualIntents: 3,
    backingAgents: 3,
    synthesis: "You're stuck on how to frame privacy guarantees for your inference layer. Mary just shipped a TEE-based approach last month and is now questioning whether the tradeoffs were right. Her uncertainty is fresh, and you have the use case that would stress-test her assumptions before she commits further.",
    friendNote: { name: 'Vivek', text: 'Mary would be a good person to talk to about agents' },
    expired: false
  },
  {
    id: '2',
    user: { id: 'u2', name: 'James', avatar: null },
    mutualIntents: 2,
    backingAgents: 2,
    synthesis: "You need distribution for your dev tool but have no GTM motion. James is three weeks from launching a developer community and hasn't locked in the tooling partners yet. If you wait, he'll commit to alternatives and the window closes.",
    expired: false
  },
  {
    id: '3',
    user: { id: 'u3', name: 'Elena', avatar: null },
    mutualIntents: 1,
    backingAgents: 1,
    synthesis: 'No clear opportunity at this time.',
    expired: true,
    expiredAt: '2026-01-28T10:00:00Z'
  }
];

const mockPerspectives: MockOpportunity[] = [
  {
    id: '1',
    user: { id: 'u4', name: 'David', avatar: null },
    mutualIntents: 3,
    backingAgents: 3,
    synthesis: "David is trying to decide whether to build or buy auth infrastructure before his Series A closes next month. You've been through this exact decision twice—once wrong, once right. He doesn't have time to learn from his own mistakes here.",
    friendNote: { name: 'Vivek', text: 'David is genuinely uncertain and would value an outside perspective' },
    expired: false
  },
  {
    id: '2',
    user: { id: 'u5', name: 'Priya', avatar: null },
    mutualIntents: 2,
    backingAgents: 1,
    synthesis: 'No clear opportunity at this time.',
    expired: true,
    expiredAt: '2026-01-30T14:00:00Z'
  }
];

const mockQuestionMatches: MockQuestionMatch[] = [
  {
    id: '1',
    question: 'Who might be a good early hire or advisor for my startup?',
    user: { id: 'u6', name: 'Rachel', avatar: null },
    mutualIntents: 3,
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
    expired: true,
    expiredAt: '2026-01-29T09:00:00Z'
  }
];

export default function ChatContent({ sessionIdParam }: ChatContentProps) {
  const router = useRouter();
  const sessionIdFromUrl = sessionIdParam ?? null;
  const { messages, isLoading, sendMessage, clearChat, loadSession, sessionId, sessionTitle, updateSessionTitle, setScopeIndexId } = useAIChat();
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
  const navigatingToHomeRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  const [isIndexDropdownOpen, setIsIndexDropdownOpen] = useState(false);

  // Keep ref in sync with sessionId
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const connectionsService = useConnections();
  const synthesisService = useSynthesis();
  const opportunitiesService = useOpportunities();

  // Home view from API (when USE_HOME_API)
  const [homeViewData, setHomeViewData] = useState<{ sections: HomeViewSection[]; meta: { totalOpportunities: number; totalSections: number } } | null>(null);
  const [homeViewLoading, setHomeViewLoading] = useState(false);
  const [homeViewError, setHomeViewError] = useState<string | null>(null);
  const [homeActionLoadingByOpportunity, setHomeActionLoadingByOpportunity] = useState<Record<string, boolean>>({});

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

  // Sync index filter selection to chat scope so backend receives indexId when user has selected an index
  useEffect(() => {
    setScopeIndexId(selectedIndexId);
  }, [selectedIndexId, setScopeIndexId]);

  // Fetch home view when on home (no messages) and USE_HOME_API
  useEffect(() => {
    if (!USE_HOME_API || messages.length > 0) {
      setHomeViewData(null);
      return;
    }
    setHomeViewLoading(true);
    setHomeViewError(null);
    opportunitiesService
      .getHomeView({ indexId: selectedIndexId ?? undefined, limit: 50 })
      .then((res) => {
        setHomeViewData(res);
        setHomeViewLoading(false);
      })
      .catch((err) => {
        setHomeViewError(err?.message ?? 'Failed to load home view');
        setHomeViewData(null);
        setHomeViewLoading(false);
      });
  }, [USE_HOME_API, messages.length, selectedIndexId, opportunitiesService]);

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
      // Skip loading if we already have this session in memory (e.g., we just created it)
      if (sessionIdRef.current === sessionIdFromUrl) {
        setSessionLoaded(true);
        return;
      }
      loadSession(sessionIdFromUrl).finally(() => setSessionLoaded(true));
    } else {
      navigatingToHomeRef.current = true;
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
    if (navigatingToHomeRef.current) {
      navigatingToHomeRef.current = false;
      return;
    }
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

  const handleHomeOpportunityAction = useCallback(async (
    opportunityId: string,
    action: 'accepted' | 'rejected',
    fallbackUserId?: string
  ) => {
    setHomeActionLoadingByOpportunity((prev) => ({ ...prev, [opportunityId]: true }));
    try {
      const result = await opportunitiesService.updateStatus(opportunityId, action);
      const counterpartUserId = result.chat?.counterpartUserId ?? fallbackUserId;
      if (action === 'accepted' && counterpartUserId) {
        const channelId = result.chat?.channelId;
        const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
        router.push(`/u/${counterpartUserId}/chat${query}`);
      }
      setHomeViewData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections
            .map((section) => ({
              ...section,
              items: section.items.filter((item) => item.opportunityId !== opportunityId),
            }))
            .filter((section) => section.items.length > 0),
        };
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to update opportunity');
    } finally {
      setHomeActionLoadingByOpportunity((prev) => ({ ...prev, [opportunityId]: false }));
    }
  }, [opportunitiesService, router, showError]);

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

  const displayTitle = sessionTitle || 'Untitled chat';

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
      <form onSubmit={handleSubmit} className="flex items-center gap-3 bg-[#F8F8F8] border border-[#E9E9E9] rounded-full px-4 py-3">
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
          className="shrink-0 h-8 w-8 rounded-full text-gray-500 hover:text-[#4091BB] hover:bg-gray-200 p-0"
          title="Attach files"
          aria-label="Attach files"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <MentionsTextInput
          value={input}
          onChange={setInput}
          placeholder="What are you looking for?"
          disabled={isBusy}
          autoFocus
          inputRef={inputRef}
        />
        <Button
          type="submit"
          size="icon"
          disabled={isBusy || !canSend}
          className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed p-0"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </Button>
      </form>
    </>
  );

  // HOME STATE - No messages yet
  if (messages.length === 0) {
    const selectedIndex = indexes.find(i => selectedIndexIds.includes(i.id));

    // API-driven home view (dynamic sections with Lucide icons)
    if (USE_HOME_API) {
      if (homeViewLoading) {
        return (
          <div className="px-6 lg:px-8 py-4 bg-[#FDFDFD] min-h-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        );
      }
      if (homeViewData && homeViewData.sections.length > 0) {
        return (
          <div className="px-6 lg:px-8 py-4 bg-[#FDFDFD] min-h-full">
            <ContentContainer className="text-left">
              <div className="mt-12 mb-6">
                <h1 className="text-[28px] font-bold text-black font-ibm-plex-mono text-center">
                  Find your others
                </h1>
              </div>
              {/* Input + index dropdown: same as below, reuse later if needed */}
              <form onSubmit={handleSubmit} className="flex items-center gap-3 bg-[#F8F8F8] border border-[#E9E9E9] rounded-full px-4 py-3 mb-6">
                <input ref={fileInputRef} type="file" multiple accept=".csv,.doc,.docx,.epub,.html,.json,.md,.pdf,.ppt,.pptx,.rtf,.tsv,.txt,.xls,.xlsx,.xml" onChange={handleFileSelect} className="sr-only" />
                <Button type="button" variant="ghost" size="icon" disabled={isBusy} onClick={() => fileInputRef.current?.click()} className="shrink-0 h-8 w-8 rounded-full text-gray-500 hover:text-[#4091BB] hover:bg-gray-200 p-0" title="Attach files"><Paperclip className="h-4 w-4" /></Button>
                <MentionsTextInput value={input} onChange={setInput} placeholder="What are you looking for?" disabled={isBusy} autoFocus inputRef={inputRef} />
                {indexes.length > 0 && (
                  <div className="relative flex-shrink-0">
                    <button type="button" onClick={() => setIsIndexDropdownOpen(!isIndexDropdownOpen)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-black transition-colors hover:bg-gray-100">
                      {selectedIndexIds.includes('my-network') || selectedIndex?.permissions?.joinPolicy === 'invite_only' ? <Lock className="w-4 h-4" /> : selectedIndex ? <Globe className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                      <span>{selectedIndexIds.includes('my-network') ? 'My network' : selectedIndex?.title || 'Everywhere'}</span>
                      <ChevronDown className={cn('w-4 h-4 transition-transform', isIndexDropdownOpen && 'rotate-180')} />
                    </button>
                    {isIndexDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setIsIndexDropdownOpen(false)} />
                        <div className="absolute right-0 top-full mt-2 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                          <button type="button" onClick={() => { handleIndexSelect(null); setIsIndexDropdownOpen(false); }} className={cn('w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2', selectedIndexIds.length === 0 && 'text-gray-900 font-medium')}><Globe className="w-4 h-4" /> Everywhere</button>
                          <button type="button" onClick={() => { handleIndexSelect('my-network'); setIsIndexDropdownOpen(false); }} className={cn('w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2', selectedIndexIds.includes('my-network') && 'text-gray-900 font-medium')}><Lock className="w-4 h-4" /> My network</button>
                          <div className="my-1 border-t border-gray-200" />
                          {[...indexes].sort((a, b) => ((a.permissions?.joinPolicy === 'invite_only') ? 1 : 0) - ((b.permissions?.joinPolicy === 'invite_only') ? 1 : 0) || (a.title || '').localeCompare(b.title || '')).map((index) => (
                            <button key={index.id} type="button" onClick={() => { handleIndexSelect(index.id); setIsIndexDropdownOpen(false); }} className={cn('w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2', selectedIndexIds.includes(index.id) && 'text-gray-900 font-medium')}>
                              {index.permissions?.joinPolicy === 'invite_only' ? <Lock className="w-4 h-4 flex-shrink-0" /> : <Globe className="w-4 h-4 flex-shrink-0" />}
                              <span className="truncate">{index.title}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <Button type="submit" size="icon" disabled={isBusy || !canSend} className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed p-0">{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}</Button>
              </form>
              {homeViewData.sections.map((section) => (
                <div key={section.id} className={section.id === homeViewData.sections[0]?.id ? 'mt-12' : 'mt-6'}>
                  <h3 className="text-xs font-semibold text-[#3D3D3D] uppercase tracking-wider mb-3 font-ibm-plex-mono text-left flex items-center gap-2">
                    <span className="w-3.5 h-3.5 shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                      <DynamicIcon name={section.iconName as IconName} />
                    </span>
                    {section.title}
                  </h3>
                  <div className="space-y-3">
                    {section.items.map((item: HomeViewCardItem) => (
                      <div key={item.opportunityId} className="bg-[#F8F8F8] rounded-md p-4">
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-300/80 flex items-center justify-center shrink-0">
                              <Image src={getAvatarUrl({ id: item.userId, name: item.name, avatar: item.avatar })} alt="" width={32} height={32} className="w-full h-full object-cover" />
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-bold text-gray-900 text-sm">{item.name}</h4>
                              <p className="text-[11px] text-[#3D3D3D]">{item.mutualIntentsLabel ?? '1 mutual intent'}</p>
                            </div>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={!!homeActionLoadingByOpportunity[item.opportunityId]}
                              className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                              onClick={() => handleHomeOpportunityAction(item.opportunityId, 'accepted', item.userId)}
                            >
                              {homeActionLoadingByOpportunity[item.opportunityId] ? 'Working...' : (item.primaryActionLabel ?? 'Start Chat')}
                            </button>
                            <button
                              type="button"
                              disabled={!!homeActionLoadingByOpportunity[item.opportunityId]}
                              className="bg-transparent border border-gray-400 text-[#3D3D3D] px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                              onClick={() => handleHomeOpportunityAction(item.opportunityId, 'rejected', item.userId)}
                            >
                              {item.secondaryActionLabel ?? 'Skip'}
                            </button>
                          </div>
                        </div>
                        <div className="text-[14px] text-[#3D3D3D] leading-relaxed [&_a]:text-[#4091BB] [&_a]:underline [&_a]:underline-offset-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{item.mainText}</ReactMarkdown>
                        </div>
                        {item.narratorChip && (
                          <div className="mt-3">
                            <div className="inline-flex items-center gap-2.5 px-3 py-1 bg-[#F0F0F0] rounded-md">
                              <div className="relative shrink-0">
                                {item.narratorChip.name === 'Index' ? (
                                  <Bot className="w-7 h-7 text-[#3D3D3D]" />
                                ) : (
                                  <Image src={getAvatarUrl({ name: item.narratorChip.name, avatar: item.narratorChip.avatar ?? null })} alt="" width={28} height={28} className="w-7 h-7 rounded-full object-cover" />
                                )}
                              </div>
                              <span className="text-[13px] text-[#3D3D3D]"><span className="font-semibold">{item.narratorChip.name}:</span> {item.narratorChip.text}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </ContentContainer>
          </div>
        );
      }
    }

    // Static data when USE_STATIC_HOME_DISCOVERY; otherwise from discover API or mock fallback
    const opportunitiesDisplay = USE_STATIC_HOME_DISCOVERY
      ? STATIC_OPPORTUNITIES.slice(0, 2)
      : discoverStakes.length > 0
        ? discoverStakes.slice(0, 2).map((s, i) => ({
            id: s.user.id,
            user: { id: s.user.id, name: s.user.name, avatar: s.user.avatar },
            mutualIntents: s.intents?.length ?? 0,
            backingAgents: s.intents?.length ?? 0,
            synthesis: syntheses[s.user.id] ?? `Strong overlap with your intents. Worth a conversation.`,
            friendNote: i === 0 ? { name: 'Index', text: 'Good fit based on mutual intent.' } as const : undefined,
            expired: false
          }))
        : mockOpportunities.filter(o => !o.expired);

    const perspectivesDisplay = USE_STATIC_HOME_DISCOVERY
      ? STATIC_PERSPECTIVES
      : discoverStakes.length > 0
        ? discoverStakes.slice(0, 2).map((s, i) => ({
            id: `p-${s.user.id}`,
            user: { id: s.user.id, name: s.user.name, avatar: s.user.avatar },
            mutualIntents: s.intents?.length ?? 0,
            backingAgents: s.intents?.length ?? 0,
            synthesis: syntheses[s.user.id] ?? `Your experience could help. They're weighing a similar decision.`,
            friendNote: i === 0 ? { name: 'Index', text: 'Your perspective would add value here.' } as const : undefined,
            expired: false
          }))
        : mockPerspectives.filter(p => !p.expired);

    const bridgeDisplay = USE_STATIC_HOME_DISCOVERY
      ? STATIC_BRIDGE
      : discoverStakes.length >= 2
        ? [
            { id: `b-${discoverStakes[0].user.id}-${discoverStakes[1].user.id}`, userA: { id: discoverStakes[0].user.id, name: discoverStakes[0].user.name, role: 'Member', avatar: discoverStakes[0].user.avatar }, userB: { id: discoverStakes[1].user.id, name: discoverStakes[1].user.name, role: 'Member', avatar: discoverStakes[1].user.avatar }, reason: syntheses[discoverStakes[0].user.id] || syntheses[discoverStakes[1].user.id] || 'Their intents align; an intro could unlock value for both.', expired: false },
            ...(discoverStakes.length >= 4 ? [{ id: `b-${discoverStakes[2].user.id}-${discoverStakes[3].user.id}`, userA: { id: discoverStakes[2].user.id, name: discoverStakes[2].user.name, role: 'Member', avatar: discoverStakes[2].user.avatar }, userB: { id: discoverStakes[3].user.id, name: discoverStakes[3].user.name, role: 'Member', avatar: discoverStakes[3].user.avatar }, reason: syntheses[discoverStakes[2].user.id] || syntheses[discoverStakes[3].user.id] || 'Their intents align; an intro could unlock value for both.', expired: false }] : [])
          ]
        : mockBridgeMatches.filter(b => !b.expired);

    const expiredItems: ExpiredItem[] = [
      ...mockOpportunities.filter(o => o.expired && o.expiredAt).map(data => ({ type: 'opportunity' as const, expiredAt: data.expiredAt!, data })),
      ...mockPerspectives.filter(p => p.expired && p.expiredAt).map(data => ({ type: 'perspective' as const, expiredAt: data.expiredAt!, data })),
      ...mockQuestionMatches.filter(q => q.expired && q.expiredAt).map(data => ({ type: 'question' as const, expiredAt: data.expiredAt!, data })),
      ...mockBridgeMatches.filter(b => b.expired && b.expiredAt).map(data => ({ type: 'bridge' as const, expiredAt: data.expiredAt!, data })),
    ].sort((a, b) => b.expiredAt.localeCompare(a.expiredAt));

    return (
      <div className="px-6 lg:px-8 py-4 bg-[#FDFDFD] min-h-full">
        <ContentContainer className="text-left">
          <div className="mt-12 mb-6">
            <h1 className="text-[28px] font-bold text-black font-ibm-plex-mono text-center">
              Find your others
            </h1>
          </div>
          
          {/* Input with index dropdown */}
          <form onSubmit={handleSubmit} className="flex items-center gap-3 bg-[#F8F8F8] border border-[#E9E9E9] rounded-full px-4 py-3">
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
              className="shrink-0 h-8 w-8 rounded-full text-gray-500 hover:text-[#4091BB] hover:bg-gray-200 p-0"
              title="Attach files"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <MentionsTextInput
              value={input}
              onChange={setInput}
              placeholder="What are you looking for?"
              disabled={isBusy}
              autoFocus
              inputRef={inputRef}
            />
            
            {/* Index dropdown - left of submit */}
            {indexes.length > 0 && (
              <div className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setIsIndexDropdownOpen(!isIndexDropdownOpen)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-black transition-colors hover:bg-gray-100"
                >
                  {selectedIndexIds.includes('my-network') || selectedIndex?.permissions?.joinPolicy === 'invite_only' ? (
                    <Lock className="w-4 h-4" />
                  ) : selectedIndex ? (
                    <Globe className="w-4 h-4" />
                  ) : (
                    <Globe className="w-4 h-4" />
                  )}
                  <span>
                    {selectedIndexIds.includes('my-network')
                      ? 'My network'
                      : selectedIndex?.title || 'Everywhere'}
                  </span>
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
                          "w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2",
                          selectedIndexIds.length === 0 && "text-gray-900 font-medium"
                        )}
                      >
                        <Globe className="w-4 h-4" />
                        Everywhere
                      </button>
                      <button
                        type="button"
                        onClick={() => { handleIndexSelect('my-network'); setIsIndexDropdownOpen(false); }}
                        className={cn(
                          "w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2",
                          selectedIndexIds.includes('my-network') && "text-gray-900 font-medium"
                        )}
                      >
                        <Lock className="w-4 h-4" />
                        My network
                      </button>
                      {/* Separator */}
                      <div className="my-1 border-t border-gray-200" />
                      {[...indexes]
                        .sort((a, b) => {
                          const aPrivate = a.permissions?.joinPolicy === 'invite_only';
                          const bPrivate = b.permissions?.joinPolicy === 'invite_only';
                          // Public first, then alphabetical
                          if (aPrivate !== bPrivate) return aPrivate ? 1 : -1;
                          return (a.title || '').localeCompare(b.title || '');
                        })
                        .map((index) => {
                          const isPrivate = index.permissions?.joinPolicy === 'invite_only';
                          return (
                            <button
                              key={index.id}
                              type="button"
                              onClick={() => { handleIndexSelect(index.id); setIsIndexDropdownOpen(false); }}
                              className={cn(
                                "w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2",
                                selectedIndexIds.includes(index.id) && "text-gray-900 font-medium"
                              )}
                            >
                              {isPrivate ? <Lock className="w-4 h-4 flex-shrink-0" /> : <Globe className="w-4 h-4 flex-shrink-0" />}
                              <span className="truncate">{index.title}</span>
                            </button>
                          );
                        })}
                    </div>
                  </>
                )}
              </div>
            )}
            
            <Button
              type="submit"
              size="icon"
              disabled={isBusy || !canSend}
              className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed p-0"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
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

          {/* Section 1: Opportunities waiting for action */}
          <div className="mt-12">
            <h3 className="text-xs font-semibold text-[#3D3D3D] uppercase tracking-wider mb-3 font-ibm-plex-mono text-left flex items-center gap-2">
              <Hourglass className="w-3.5 h-3.5 shrink-0" />
              Opportunities waiting for action
            </h3>
            <div className="space-y-3">
              {opportunitiesDisplay.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "bg-[#F8F8F8] rounded-md p-4",
                      item.expired && "opacity-50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-300/80 flex items-center justify-center shrink-0">
                          <Image src={getAvatarUrl(item.user)} alt="" width={32} height={32} className="w-full h-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-gray-900 text-sm">{item.user.name}</h4>
                          <p className="text-[11px] text-[#3D3D3D]">
                            {item.mutualIntents} mutual intent
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors">
                          Start Chat
                        </button>
                        <button className="bg-transparent border border-gray-400 text-[#3D3D3D] px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors">
                          Skip
                        </button>
                      </div>
                    </div>
                    <div className="text-[14px] text-[#3D3D3D] leading-relaxed [&_a]:text-[#4091BB] [&_a]:underline [&_a]:underline-offset-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{item.synthesis}</ReactMarkdown>
                    </div>
                    {item.friendNote && (
                      <div className="mt-3">
                        <div className="inline-flex items-center gap-2.5 px-3 py-1 bg-[#F0F0F0] rounded-md">
                          <div className="relative shrink-0">
                            {item.friendNote.name === 'Index' && item.friendNote.text === 'Good fit based on mutual intent.' ? (
                              <Bot className="w-7 h-7 text-[#3D3D3D]" />
                            ) : (
                              <Image src="https://i.pravatar.cc/150?img=68" alt="" width={28} height={28} className="w-7 h-7 rounded-full object-cover" />
                            )}
                          </div>
                          <span className="text-[13px] text-[#3D3D3D]">
                            <span className="font-semibold">{item.friendNote.name}:</span> {item.friendNote.text}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
              ))}
            </div>
          </div>

          {/* Section 2: Your perspective is crucial */}
          <div className="mt-6">
            <h3 className="text-xs font-semibold text-[#3D3D3D] uppercase tracking-wider mb-3 font-ibm-plex-mono text-left flex items-center gap-2">
              <Telescope className="w-3.5 h-3.5 shrink-0" />
              Your perspective is crucial
            </h3>
            <div className="space-y-3">
              {perspectivesDisplay.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "bg-[#F8F8F8] rounded-md p-4",
                      item.expired && "opacity-50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-300/80 flex items-center justify-center shrink-0">
                          <Image src={getAvatarUrl(item.user)} alt="" width={32} height={32} className="w-full h-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-gray-900 text-sm">{item.user.name}</h4>
                          <p className="text-[11px] text-[#3D3D3D]">
                            {item.mutualIntents} mutual intent
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors">
                          Start Chat
                        </button>
                        <button className="bg-transparent border border-gray-400 text-[#3D3D3D] px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors">
                          Skip
                        </button>
                      </div>
                    </div>
                    <div className="text-[14px] text-[#3D3D3D] leading-relaxed [&_a]:text-[#4091BB] [&_a]:underline [&_a]:underline-offset-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{item.synthesis}</ReactMarkdown>
                    </div>
                    {item.friendNote && (
                      <div className="mt-3">
                        <div className="inline-flex items-center gap-2.5 px-3 py-1 bg-[#F0F0F0] rounded-md">
                          <div className="relative shrink-0">
                            <Image src="https://i.pravatar.cc/150?img=68" alt="" width={28} height={28} className="w-7 h-7 rounded-full object-cover" />
                          </div>
                          <span className="text-[13px] text-[#3D3D3D]">
                            <span className="font-semibold">{item.friendNote.name}:</span> {item.friendNote.text}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>

          {/* Section: You're the connector they need (bridge) */}
          <div className="mt-6">
            <h3 className="text-xs font-semibold text-[#3D3D3D] uppercase tracking-wider mb-3 font-ibm-plex-mono text-left flex items-center gap-2">
              <Route className="w-3.5 h-3.5 shrink-0" aria-hidden />
              You&apos;re the connector they need
            </h3>
            <div className="space-y-3">
              {bridgeDisplay.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "bg-[#F8F8F8] rounded-md p-4",
                      item.expired && "opacity-50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex flex-wrap items-center gap-2 sm:gap-4 min-w-0">
                        <div className="flex items-center gap-2 text-left min-w-0">
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-300/80 flex items-center justify-center shrink-0">
                            <Image src={getAvatarUrl(item.userA)} alt="" width={32} height={32} className="w-full h-full object-cover" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-gray-900 text-sm">{item.userA.name}</h4>
                            <p className="text-[11px] text-[#3D3D3D]">{item.userA.role}</p>
                          </div>
                        </div>
                        <span className="text-[#3D3D3D] shrink-0" aria-hidden>↔</span>
                        <div className="flex items-center gap-2 text-left min-w-0">
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-300/80 flex items-center justify-center shrink-0">
                            <Image src={getAvatarUrl(item.userB)} alt="" width={32} height={32} className="w-full h-full object-cover" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-gray-900 text-sm">{item.userB.name}</h4>
                            <p className="text-[11px] text-[#3D3D3D]">{item.userB.role}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors">
                          Good match
                        </button>
                        <button className="bg-transparent border border-gray-400 text-[#3D3D3D] px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors">
                          Pass
                        </button>
                      </div>
                    </div>
                    <div className="text-[14px] text-[#3D3D3D] leading-relaxed text-left [&_a]:text-[#4091BB] [&_a]:underline [&_a]:underline-offset-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{item.reason}</ReactMarkdown>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Section: Expired (after frictioned scroll) — all together, ordered by date */}
          <section className="mt-8 pt-6 border-t border-gray-200/80 pb-8 border-b-4 border-gray-200/80">
            <label className="flex items-center gap-2 text-xs text-[#3D3D3D] cursor-pointer mb-3 pb-4">
              <input
                type="checkbox"
                checked={showExpired}
                onChange={(e) => setShowExpired(e.target.checked)}
                className="rounded border-gray-300 text-black focus:ring-black"
              />
              Show expired
            </label>
            {showExpired && (
              <>
                <h3 className="text-xs font-semibold text-[#3D3D3D] uppercase tracking-wider mb-2 font-ibm-plex-mono text-left">
                  Expired
                </h3>
                <p className="text-sm text-[#3D3D3D] mb-4">
                  This no longer presents itself as possible. Timing does that.
                </p>
              </>
            )}
            {showExpired && expiredItems.length > 0 && (
              <div className="space-y-3">
                {expiredItems.map((entry) => {
                  const expiredCardClass = "bg-[#F8F8F8] rounded-md p-4 opacity-80";
                  const headerClass = "flex items-center gap-2 min-w-0 mb-2";
                  const avatarClass = "w-8 h-8 rounded-full bg-gray-300/80 flex items-center justify-center text-gray-600 text-sm font-semibold shrink-0";
                  const titleClass = "font-bold text-gray-900 text-sm";
                  const metaClass = "text-[11px] text-[#3D3D3D]";
                  const bodyClass = "text-[14px] text-[#3D3D3D] leading-snug mb-2";
                  const expiredMetaClass = "text-[11px] text-gray-400 mt-2";

                  if (entry.type === 'opportunity' || entry.type === 'perspective') {
                    const item = entry.data;
                    return (
                      <div key={`${entry.type}-${item.id}`} className={expiredCardClass}>
                        <div className={headerClass}>
                          <div className={avatarClass}>{item.user.name.charAt(0)}</div>
                          <div className="min-w-0">
                            <h4 className={titleClass}>{item.user.name}</h4>
                            <p className={metaClass}>
                              {item.mutualIntents} mutual intent
                            </p>
                          </div>
                        </div>
                        <p className={bodyClass}>{item.synthesis}</p>
                        {item.friendNote && (
                          <p className="text-[12px] text-[#3D3D3D] pl-2 border-l border-gray-300 mb-2">
                            <span className="font-semibold">{item.friendNote.name} thinks:</span> {item.friendNote.text}
                          </p>
                        )}
                        <p className={expiredMetaClass}>Expired {new Date(entry.expiredAt).toLocaleDateString()}</p>
                      </div>
                    );
                  }
                  if (entry.type === 'question') {
                    const item = entry.data;
                    return (
                      <div key={`question-${item.id}`} className={expiredCardClass}>
                        <div className={headerClass}>
                          <div className={avatarClass}>{item.user.name.charAt(0)}</div>
                          <div className="min-w-0">
                            <h4 className={titleClass}>{item.user.name}</h4>
                            <p className={metaClass}>
                              {item.mutualIntents} mutual intent
                            </p>
                          </div>
                        </div>
                        <p className={bodyClass}>{item.synthesis}</p>
                        <p className={expiredMetaClass}>Expired {new Date(entry.expiredAt).toLocaleDateString()}</p>
                      </div>
                    );
                  }
                  const item = entry.data;
                  return (
                    <div key={`bridge-${item.id}`} className={expiredCardClass}>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-2">
                        <div className="flex items-center gap-2 text-left min-w-0">
                          <div className={avatarClass}>{item.userA.name.charAt(0)}</div>
                          <div className="min-w-0">
                            <h4 className={titleClass}>{item.userA.name}</h4>
                            <p className={metaClass}>{item.userA.role}</p>
                          </div>
                        </div>
                        <span className="text-[#3D3D3D] shrink-0" aria-hidden>↔</span>
                        <div className="flex items-center gap-2 text-left min-w-0">
                          <div className={avatarClass}>{item.userB.name.charAt(0)}</div>
                          <div className="min-w-0">
                            <h4 className={titleClass}>{item.userB.name}</h4>
                            <p className={metaClass}>{item.userB.role}</p>
                          </div>
                        </div>
                      </div>
                      <p className={bodyClass}>{item.reason}</p>
                      <p className={expiredMetaClass}>Expired {new Date(entry.expiredAt).toLocaleDateString()}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
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
          onClick={() => {
            clearChat();
            router.push('/');
          }}
          className="p-1 -ml-1 rounded-md hover:bg-gray-100 text-gray-600 hover:text-black transition-colors shrink-0"
          aria-label="Back to home"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
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
            className="flex-1 min-w-0 font-semibold font-ibm-plex-mono text-gray-900 bg-transparent border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30 focus:border-[#4091BB]"
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
                className="shrink-0 p-1 rounded text-gray-500 hover:text-[#4091BB] hover:bg-gray-100 focus:outline-none"
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
                          ? 'bg-[#041729] text-white'
                          : 'bg-gray-100 text-gray-900'
                      )}
                    >
                      {msg.role === 'assistant' && (
                        <span className="text-[10px] uppercase tracking-wider text-[#4091BB]/70 mb-1 block">
                          Index
                        </span>
                      )}
                      <article className={cn(
                        "chat-markdown max-w-none",
                        msg.role === 'user' && 'chat-markdown-invert'
                      )}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {mentionsToMarkdownLinks(msg.content)}
                        </ReactMarkdown>
                      </article>
                      {msg.role === 'user' && msg.attachmentNames && msg.attachmentNames.length > 0 && (
                        <p className="text-xs opacity-90 mt-1.5">
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
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-[#3D3D3D] hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm disabled:opacity-50 whitespace-nowrap flex-shrink-0"
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
