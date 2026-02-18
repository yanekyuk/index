"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Loader2,
  Pencil,
  Paperclip,
  X,
  Globe,
  ChevronDown,
  Lock,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MentionsTextInput } from "@/components/MentionsInput";
import { useAIChat } from "@/contexts/AIChatContext";
import { useUploadServiceV2 } from "@/services/v2/upload.service";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOpportunities } from "@/contexts/APIContext";
import { validateFiles } from "@/lib/file-validation";
import InlineDiscoveryCard from "@/components/chat/InlineDiscoveryCard";
import OpportunityCard, {
  type OpportunityCardData,
  OpportunitySkeleton,
} from "@/components/chat/OpportunityCardInChat";
import { SuggestionChips } from "@/components/chat/SuggestionChips";
import ThinkingDropdown from "@/components/chat/ThinkingDropdown";
import { ContentContainer } from "@/components/layout";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useIndexFilter } from "@/contexts/IndexFilterContext";
import { useIndexesState } from "@/contexts/IndexesContext";
import { useSuggestions } from "@/hooks/useSuggestions";
import Image from "next/image";
import { mentionsToMarkdownLinks } from "@/lib/mentions";
import type { HomeViewSection } from "@/services/opportunities";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { useTypewriter } from "@/hooks/useTypewriter";

/**
 * When true, use GET /opportunities/home for dynamic sections; when false, use static/mock data.
 */
const USE_HOME_API = true;

const CHAT_INPUT_PLACEHOLDER = "What's on your mind?";

interface PendingFile {
  id: string;
  file: File;
}

interface ChatContentProps {
  sessionIdParam?: string | null;
}

/**
 * Sub-component for assistant message content so React hooks (useTypewriter)
 * can be called per-message inside the .map() loop.
 */
/**
 * Ensure blockquote lines are always followed by a blank line so that
 * subsequent non-blockquote text isn't absorbed via markdown "lazy continuation".
 * e.g. "> Retrieving…\nHere is…" → "> Retrieving…\n\nHere is…"
 */
function normalizeBlockquotes(text: string): string {
  return text.replace(/^(>.*)\n(?!>|\n)/gm, "$1\n\n");
}

/**
 * Parse message content to extract ```opportunity code blocks.
 * Returns an array of segments: either text or opportunity card data.
 */
type MessageSegment =
  | { type: "text"; content: string }
  | { type: "opportunity"; data: OpportunityCardData }
  | { type: "opportunity_loading" };

function parseOpportunityBlocks(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  // Match ```opportunity followed by JSON and closing ```
  const regex = /```opportunity\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        segments.push({ type: "text", content: textBefore });
      }
    }

    // Try to parse the opportunity JSON
    try {
      const jsonStr = match[1].trim();
      const data = JSON.parse(jsonStr) as OpportunityCardData;
      // Ensure required fields exist
      if (data.opportunityId && data.userId) {
        segments.push({ type: "opportunity", data });
      } else {
        // Invalid opportunity data, treat as text
        segments.push({ type: "text", content: match[0] });
      }
    } catch {
      // Invalid JSON, treat as regular code block
      segments.push({ type: "text", content: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Check for partial block at the end (start of block found but no closing triple backticks)
  const remainingContent = content.slice(lastIndex);
  const partialStartMatch = remainingContent.match(/```opportunity/);

  if (partialStartMatch) {
    const partialIndex = partialStartMatch.index!;
    const textBefore = remainingContent.slice(0, partialIndex);
    if (textBefore.trim()) {
      segments.push({ type: "text", content: textBefore });
    }
    segments.push({ type: "opportunity_loading" });
  } else if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    if (remaining.trim()) {
      segments.push({ type: "text", content: remaining });
    }
  }

  // If no segments found, return the whole content as text
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "text", content });
  }

  return segments;
}

function AssistantMessageContent({
  content,
  isStreaming,
  onOpportunityPrimaryAction,
  onOpportunitySecondaryAction,
  opportunityLoadingMap,
  currentStatusMap,
}: {
  content: string;
  isStreaming: boolean;
  onOpportunityPrimaryAction?: (
    opportunityId: string,
    userId: string,
    viewerRole?: string,
    counterpartName?: string,
  ) => void;
  onOpportunitySecondaryAction?: (
    opportunityId: string,
    userId: string,
    viewerRole?: string,
    counterpartName?: string,
  ) => void;
  opportunityLoadingMap?: Record<string, boolean>;
  /** Map of opportunityId -> current status from server */
  currentStatusMap?: Record<string, string>;
}) {
  const { text: displayedContent, isAnimating } = useTypewriter(
    normalizeBlockquotes(mentionsToMarkdownLinks(content)),
    isStreaming,
    22, // ms per character during streaming
    8, // ms per character catch-up after stream ends
  );

  // Show cursor while streaming (even before first token) or during catch-up
  const showCursor = isStreaming || isAnimating;

  // No text yet — render a standalone blinking cursor
  if (!displayedContent && showCursor) {
    return <span className="inline-block w-2 h-4 bg-current animate-pulse" />;
  }

  // Parse opportunity blocks from the displayed content
  const segments = parseOpportunityBlocks(displayedContent);

  return (
    <div>
      {segments.map((segment, idx) => {
        if (segment.type === "text") {
          const isLast = idx === segments.length - 1;
          return (
            <div
              key={idx}
              className={cn(
                "chat-markdown max-w-none",
                isStreaming && "chat-markdown-streaming",
                showCursor && isLast && "chat-markdown-typing",
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {segment.content}
              </ReactMarkdown>
            </div>
          );
        } else if (segment.type === "opportunity") {
          return (
            <div key={idx} className="my-3">
              <OpportunityCard

                card={segment.data}
                onPrimaryAction={onOpportunityPrimaryAction}
                onSecondaryAction={onOpportunitySecondaryAction}
                isLoading={
                  opportunityLoadingMap?.[segment.data.opportunityId] ?? false
                }
                currentStatus={currentStatusMap?.[segment.data.opportunityId]}
              />
            </div>
          );
        } else {
          // opportunity_loading
          return (
            <div key={idx} className="my-3">
              <OpportunitySkeleton />
            </div>
          );
        }
      })}
    </div>
  );
}

export default function ChatContent({ sessionIdParam }: ChatContentProps) {
  const router = useRouter();
  const sessionIdFromUrl = sessionIdParam ?? null;
  const {
    messages,
    isLoading,
    sendMessage,
    clearChat,
    loadSession,
    sessionId,
    sessionTitle,
    suggestions: contextSuggestions,
    setScopeIndexId,
    sessionIndexId,
    updateSessionTitle,
  } = useAIChat();
  const uploadServiceV2 = useUploadServiceV2();
  const { error: showError, success: showSuccess } = useNotifications();
  const [input, setInput] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<PendingFile[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const navigatingToHomeRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  const [isIndexDropdownOpen, setIsIndexDropdownOpen] = useState(false);

  // Keep ref in sync with sessionId
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const opportunitiesService = useOpportunities();

  // Track current opportunity statuses (fetched from server to detect changes)
  const [opportunityStatusMap, setOpportunityStatusMap] = useState<
    Record<string, string>
  >({});

  // Stable list of opportunity IDs from assistant messages (avoids effect re-run on every streaming token)
  const opportunityIdsArray = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of messages) {
      if (msg.role === "assistant" && msg.content) {
        const segments = parseOpportunityBlocks(msg.content);
        for (const seg of segments) {
          if (seg.type === "opportunity" && seg.data.opportunityId) {
            ids.add(seg.data.opportunityId);
          }
        }
      }
    }
    return [...ids].sort();
  }, [messages]);

  // Stable key so effect runs only when the set of IDs changes, not on every message reference change
  const opportunityIdsKey = opportunityIdsArray.join(",");

  // Fetch current status for each opportunity (debounced, parallel)
  useEffect(() => {
    const ids = opportunityIdsKey ? opportunityIdsKey.split(",") : [];
    if (ids.length === 0) return;

    const newStatusMap: Record<string, string> = {};
    const fetchStatuses = async () => {
      const results = await Promise.allSettled(
        ids.map((id) => opportunitiesService.getOpportunity(id)),
      );
      results.forEach((result, i) => {
        const id = ids[i];
        if (result.status === "fulfilled" && result.value?.status) {
          newStatusMap[id] = result.value.status;
        }
      });
      setOpportunityStatusMap((prev) => ({ ...prev, ...newStatusMap }));
    };

    const timeoutId = setTimeout(fetchStatuses, 200);
    return () => clearTimeout(timeoutId);
  }, [opportunityIdsKey, opportunitiesService]);

  // Home view from API (when USE_HOME_API)
  const [homeViewData, setHomeViewData] = useState<{
    sections: HomeViewSection[];
    meta: { totalOpportunities: number; totalSections: number };
  } | null>(null);
  const [homeViewLoading, setHomeViewLoading] = useState(false);
  const [homeViewError, setHomeViewError] = useState<string | null>(null);
  const [opportunityActionLoading, setOpportunityActionLoading] =
    useState<Record<string, boolean>>({});

  // Index filter
  const { selectedIndexIds, setSelectedIndexIds } = useIndexFilter();
  const { indexes } = useIndexesState();
  const selectedIndexId =
    selectedIndexIds.length === 1 ? selectedIndexIds[0] : null;

  // Suggestions: from context (done event) when we have messages, else static starters
  const { suggestions } = useSuggestions({
    contextSuggestions: contextSuggestions ?? null,
    hasMessages: messages.length > 0,
    indexId: selectedIndexId,
    enabled: messages.length > 0,
  });

  const handleIndexSelect = useCallback(
    (indexId: string | null) => {
      if (indexId === null) {
        setSelectedIndexIds([]);
      } else {
        setSelectedIndexIds([indexId]);
      }
    },
    [setSelectedIndexIds],
  );

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
        setHomeViewError(err?.message ?? "Failed to load home view");
        setHomeViewData(null);
        setHomeViewLoading(false);
      });
  }, [USE_HOME_API, messages.length, selectedIndexId, opportunitiesService]);

  const handleSuggestionClick = useCallback(
    (suggestion: {
      label: string;
      type: string;
      followupText?: string;
      prefill?: string;
    }) => {
      if (suggestion.type === "prompt" && suggestion.prefill) {
        setInput(suggestion.prefill);
        inputRef.current?.focus();
      } else if (suggestion.type === "direct" && suggestion.followupText) {
        setInput(suggestion.followupText);
        // Auto-submit after a brief delay
        setTimeout(() => {
          inputRef.current?.form?.requestSubmit();
        }, 50);
      }
    },
    [],
  );

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
      // Don't abort in-flight stream so the new session can finish and appear in the sidebar
      clearChat({ abortStream: false });
      setSessionLoaded(true);
    }
  }, [sessionIdFromUrl, loadSession, clearChat]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
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

  const handleHomeOpportunityAction = useCallback(
    async (
      opportunityId: string,
      action: "accepted" | "rejected",
      fallbackUserId?: string,
      viewerRole?: string,
      counterpartName?: string,
    ) => {
      setOpportunityActionLoading((prev) => ({
        ...prev,
        [opportunityId]: true,
      }));
      try {
        // Introducers "send" the intro (latent → pending) instead of accepting
        const isIntroducer = viewerRole === "introducer";
        const effectiveStatus =
          isIntroducer && action === "accepted" ? "pending" : action;

        const result = await opportunitiesService.updateStatus(
          opportunityId,
          effectiveStatus,
        );

        // Update local status map so the card reflects the new status immediately
        setOpportunityStatusMap((prev) => ({
          ...prev,
          [opportunityId]: effectiveStatus,
        }));

        // Only redirect to chat for non-introducer accepts (introducers don't get a chat)
        const counterpartUserId =
          result.chat?.counterpartUserId ?? fallbackUserId;
        if (action === "accepted" && !isIntroducer && counterpartUserId) {
          const channelId = result.chat?.channelId;
          const query = channelId
            ? `?channelId=${encodeURIComponent(channelId)}`
            : "";
          router.push(`/u/${counterpartUserId}/chat${query}`);
        } else if (action === "accepted" && isIntroducer) {
          showSuccess(
            "Opportunity sent",
            `Sent to ${counterpartName || "them"}. They can accept to start the conversation.`,
          );
        }
        setHomeViewData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            sections: prev.sections
              .map((section) => ({
                ...section,
                items: section.items.filter(
                  (item) => item.opportunityId !== opportunityId,
                ),
              }))
              .filter((section) => section.items.length > 0),
          };
        });
      } catch (error) {
        showError(
          error instanceof Error
            ? error.message
            : "Failed to update opportunity",
        );
      } finally {
        setOpportunityActionLoading((prev) => ({
          ...prev,
          [opportunityId]: false,
        }));
      }
    },
    [opportunitiesService, router, showError, showSuccess],
  );

  const canSend = input.trim() || selectedFiles.length > 0;
  const isBusy = isLoading || isUploadingFiles;

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      const list = Array.from(files);
      const validation = validateFiles(list, "general");
      if (!validation.isValid) {
        showError(validation.message ?? "Invalid file(s)");
        e.target.value = "";
        return;
      }
      setSelectedFiles((prev) => [
        ...prev,
        ...list.map((file) => ({ id: crypto.randomUUID(), file })),
      ]);
      e.target.value = "";
    },
    [showError],
  );

  const removeFile = useCallback((id: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || isBusy) return;

    const message = input.trim();
    setInput("");

    let fileIds: string[] = [];
    const attachmentNames: string[] = [];
    if (selectedFiles.length > 0) {
      setIsUploadingFiles(true);
      try {
        const uploaded = await Promise.all(
          selectedFiles.map(({ file }) => uploadServiceV2.uploadFile(file)),
        );
        fileIds = uploaded.map((f) => f.id);
        attachmentNames.push(...selectedFiles.map(({ file }) => file.name));
        setSelectedFiles([]);
      } catch (err) {
        console.error("[AI Chat] Upload failed:", err);
        showError(
          err instanceof Error ? err.message : "Failed to upload file(s)",
        );
        setIsUploadingFiles(false);
        inputRef.current?.focus();
        return;
      }
      setIsUploadingFiles(false);
    }

    await sendMessage(
      message || "Attached file(s).",
      fileIds.length ? fileIds : undefined,
      attachmentNames.length ? attachmentNames : undefined,
    );
    inputRef.current?.focus();
  };

  // Auto-focus input on keydown/paste anywhere
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 || e.key === "Backspace") {
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const displayTitle = sessionTitle || "Untitled chat";

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
      <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
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
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-3 bg-[#F8F8F8] border border-[#E9E9E9] rounded-[32px] px-4 py-3"
        >
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
            placeholder={CHAT_INPUT_PLACEHOLDER}
            disabled={isBusy}
            autoFocus
            inputRef={inputRef}
            suggestionsAbove
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
      </div>
      <div className="pb-3 bg-white" />
    </>
  );

  // HOME STATE - No messages yet
  if (messages.length === 0) {
    const selectedIndex = indexes.find((i) => selectedIndexIds.includes(i.id));

    // API-driven home view (dynamic sections with Lucide icons)
    if (USE_HOME_API) {
      if (
        homeViewLoading ||
        (homeViewData && homeViewData.sections.length > 0)
      ) {
        return (
          <div className="px-6 lg:px-8 min-h-full">
            <ContentContainer className="text-left">
              <div className="mt-12 mb-6">
                <h1 className="text-[28px] font-bold text-black font-ibm-plex-mono text-center">
                  Find your others
                </h1>
              </div>
              <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
                <form
                  onSubmit={handleSubmit}
                  className="flex items-end gap-3 bg-[#F8F8F8] border border-[#E9E9E9] rounded-[32px] px-4 py-3 mb-6"
                >
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
                    placeholder={CHAT_INPUT_PLACEHOLDER}
                    disabled={isBusy}
                    autoFocus
                    inputRef={inputRef}
                  />
                  {indexes.length > 0 && (
                    <div className="relative flex-shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setIsIndexDropdownOpen(!isIndexDropdownOpen)
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-black transition-colors hover:bg-gray-100"
                      >
                        {selectedIndexIds.includes("my-network") ||
                        selectedIndex?.permissions?.joinPolicy ===
                          "invite_only" ? (
                          <Lock className="w-4 h-4" />
                        ) : selectedIndex ? (
                          <Globe className="w-4 h-4" />
                        ) : (
                          <Globe className="w-4 h-4" />
                        )}
                        <span>
                          {selectedIndexIds.includes("my-network")
                            ? "My network"
                            : selectedIndex?.title || "Everywhere"}
                        </span>
                        <ChevronDown
                          className={cn(
                            "w-4 h-4 transition-transform",
                            isIndexDropdownOpen && "rotate-180",
                          )}
                        />
                      </button>
                      {isIndexDropdownOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setIsIndexDropdownOpen(false)}
                          />
                          <div className="absolute right-0 top-full mt-2 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                            <button
                              type="button"
                              onClick={() => {
                                handleIndexSelect(null);
                                setIsIndexDropdownOpen(false);
                              }}
                              className={cn(
                                "w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2",
                                selectedIndexIds.length === 0 &&
                                  "text-gray-900 font-medium",
                              )}
                            >
                              <Globe className="w-4 h-4" /> Everywhere
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                handleIndexSelect("my-network");
                                setIsIndexDropdownOpen(false);
                              }}
                              className={cn(
                                "w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2",
                                selectedIndexIds.includes("my-network") &&
                                  "text-gray-900 font-medium",
                              )}
                            >
                              <Lock className="w-4 h-4" /> My network
                            </button>
                            <div className="my-1 border-t border-gray-200" />
                            {[...indexes]
                              .sort(
                                (a, b) =>
                                  (a.permissions?.joinPolicy === "invite_only"
                                    ? 1
                                    : 0) -
                                    (b.permissions?.joinPolicy === "invite_only"
                                      ? 1
                                      : 0) ||
                                  (a.title || "").localeCompare(b.title || ""),
                              )
                              .map((index) => (
                                <button
                                  key={index.id}
                                  type="button"
                                  onClick={() => {
                                    handleIndexSelect(index.id);
                                    setIsIndexDropdownOpen(false);
                                  }}
                                  className={cn(
                                    "w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2",
                                    selectedIndexIds.includes(index.id) &&
                                      "text-gray-900 font-medium",
                                  )}
                                >
                                  {index.permissions?.joinPolicy ===
                                  "invite_only" ? (
                                    <Lock className="w-4 h-4 flex-shrink-0" />
                                  ) : (
                                    <Globe className="w-4 h-4 flex-shrink-0" />
                                  )}
                                  <span className="truncate">
                                    {index.title}
                                  </span>
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
                    className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed p-0"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </Button>
                </form>
              </div>
              <div className="pb-3 bg-white" />
              {homeViewLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              ) : (
                homeViewData?.sections.map((section) => (
                  <div
                    key={section.id}
                    className={
                      section.id === homeViewData.sections[0]?.id
                        ? "mt-12"
                        : "mt-6"
                    }
                  >
                    <h3 className="text-xs font-semibold text-[#3D3D3D] uppercase tracking-wider mb-3 font-ibm-plex-mono text-left flex items-center gap-2">
                      <span className="w-3.5 h-3.5 shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                        <DynamicIcon name={section.iconName as IconName} />
                      </span>
                      {section.title}
                    </h3>
                    <div className="space-y-3">
                      {section.items.map((item) => (
                        <OpportunityCard
                          key={item.opportunityId}
                          card={item}
                          onPrimaryAction={(
                            oppId,
                            userId,
                            viewerRole,
                            counterpartName,
                          ) =>
                            handleHomeOpportunityAction(
                              oppId,
                              "accepted",
                              userId,
                              viewerRole,
                              counterpartName,
                            )
                          }
                          onSecondaryAction={(
                            oppId,
                            userId,
                            viewerRole,
                            counterpartName,
                          ) =>
                            handleHomeOpportunityAction(
                              oppId,
                              "rejected",
                              userId,
                              viewerRole,
                              counterpartName,
                            )
                          }
                          isLoading={
                            !!opportunityActionLoading[item.opportunityId]
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </ContentContainer>
          </div>
        );
      }
    }

    // Empty state — no opportunities to show
    return (
      <div className="px-6 lg:px-8 bg-[#FDFDFD] min-h-full">
        <ContentContainer className="text-left">
          <div className="mt-12 mb-6">
            <h1 className="text-[28px] font-bold text-black font-ibm-plex-mono text-center">
              Find your others
            </h1>
          </div>
          <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
            <form
              onSubmit={handleSubmit}
              className="flex items-end gap-3 bg-[#F8F8F8] border border-[#E9E9E9] rounded-[32px] px-4 py-3"
            >
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
                placeholder={CHAT_INPUT_PLACEHOLDER}
                disabled={isBusy}
                autoFocus
                inputRef={inputRef}
              />
              {indexes.length > 0 && (
                <div className="relative flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsIndexDropdownOpen(!isIndexDropdownOpen)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-black transition-colors hover:bg-gray-100"
                  >
                    {selectedIndexIds.includes("my-network") ||
                    selectedIndex?.permissions?.joinPolicy === "invite_only" ? (
                      <Lock className="w-4 h-4" />
                    ) : (
                      <Globe className="w-4 h-4" />
                    )}
                    <span>
                      {selectedIndexIds.includes("my-network")
                        ? "My network"
                        : selectedIndex?.title || "Everywhere"}
                    </span>
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 transition-transform",
                        isIndexDropdownOpen && "rotate-180",
                      )}
                    />
                  </button>
                  {isIndexDropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsIndexDropdownOpen(false)}
                      />
                      <div className="absolute right-0 top-full mt-2 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                        <button
                          type="button"
                          onClick={() => {
                            handleIndexSelect(null);
                            setIsIndexDropdownOpen(false);
                          }}
                          className={cn(
                            "w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2",
                            selectedIndexIds.length === 0 &&
                              "text-gray-900 font-medium",
                          )}
                        >
                          <Globe className="w-4 h-4" /> Everywhere
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleIndexSelect("my-network");
                            setIsIndexDropdownOpen(false);
                          }}
                          className={cn(
                            "w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2",
                            selectedIndexIds.includes("my-network") &&
                              "text-gray-900 font-medium",
                          )}
                        >
                          <Lock className="w-4 h-4" /> My network
                        </button>
                        <div className="my-1 border-t border-gray-200" />
                        {[...indexes]
                          .sort(
                            (a, b) =>
                              (a.permissions?.joinPolicy === "invite_only"
                                ? 1
                                : 0) -
                                (b.permissions?.joinPolicy === "invite_only"
                                  ? 1
                                  : 0) ||
                              (a.title || "").localeCompare(b.title || ""),
                          )
                          .map((index) => (
                            <button
                              key={index.id}
                              type="button"
                              onClick={() => {
                                handleIndexSelect(index.id);
                                setIsIndexDropdownOpen(false);
                              }}
                              className={cn(
                                "w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2",
                                selectedIndexIds.includes(index.id) &&
                                  "text-gray-900 font-medium",
                              )}
                            >
                              {index.permissions?.joinPolicy ===
                              "invite_only" ? (
                                <Lock className="w-4 h-4 flex-shrink-0" />
                              ) : (
                                <Globe className="w-4 h-4 flex-shrink-0" />
                              )}
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
                className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed p-0"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            </form>
          </div>
          <div className="pb-3 bg-white" />
          {selectedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
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
                    className="shrink-0 p-0.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="mt-20 flex flex-col items-center text-center pb-12">
            <Image
              src="/collab.png"
              alt="Connections illustration"
              width={280}
              height={245}
              className="mb-8 opacity-80"
            />
            <h2 className="text-lg font-semibold text-gray-900 font-ibm-plex-mono mb-3">
              No opportunities yet
            </h2>
            <p className="text-sm text-[#3D3D3D] max-w-sm leading-relaxed">
              Opportunities appear when your intents align with others in the
              network. Create intents that describe what you&apos;re looking
              for, and the system will surface meaningful connections when
              there&apos;s a match.
            </p>
          </div>
        </ContentContainer>
      </div>
    );
  }

  // CONVERSATION MODE - Has messages
  const boundIndexId = sessionIndexId ?? selectedIndexId;
  const boundIndex = indexes.find((i) => i.id === boundIndexId) ?? null;

  return (
    <>
      {/* Sticky header - full width, min-h-[68px] matches ChatView header height */}
      <div className="sticky top-0 bg-white z-10 px-4 py-3 flex items-center gap-3 min-h-[68px]">
        <button
          type="button"
          onClick={() => {
            clearChat({ abortStream: false });
            router.push("/");
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
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
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
            {boundIndex && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 ml-2">
                {boundIndex.permissions?.joinPolicy === "invite_only" ? (
                  <Lock className="w-3 h-3" />
                ) : (
                  <Globe className="w-3 h-3" />
                )}
                <span className="truncate max-w-[120px]">
                  {boundIndex.title}
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="px-6 lg:px-8 pb-32 flex-1">
        <ContentContainer>
          <div className="space-y-4">
            {messages.map((msg) => (
              <div key={msg.id}>
                <div
                  className={cn(
                    "flex",
                    msg.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      msg.role === "user" ? "max-w-[75%]" : "max-w-[90%]",
                      msg.role === "user"
                        ? "bg-[#FAFAFA] text-gray-900 border border-[#E8E8E8] rounded-[32px] px-4 py-1 text-sm leading-relaxed"
                        : "text-gray-900",
                    )}
                  >
                    {msg.role === "assistant" && (
                      <span className="text-[10px] uppercase tracking-wider text-black font-bold mb-1 block">
                        Index
                      </span>
                    )}
                    <article className="max-w-none">
                      {msg.role === "assistant" ? (
                        <>
                          {msg.thinking && msg.thinking.length > 0 && (
                            <ThinkingDropdown
                              thinking={msg.thinking}
                              isStreaming={msg.isStreaming}
                            />
                          )}
                          <AssistantMessageContent
                            content={msg.content}
                            isStreaming={msg.isStreaming ?? false}
                            onOpportunityPrimaryAction={(
                              oppId,
                              userId,
                              viewerRole,
                              counterpartName,
                            ) =>
                              handleHomeOpportunityAction(
                                oppId,
                                "accepted",
                                userId,
                                viewerRole,
                                counterpartName,
                              )
                            }
                            onOpportunitySecondaryAction={(
                              oppId,
                              userId,
                              viewerRole,
                              counterpartName,
                            ) =>
                              handleHomeOpportunityAction(
                                oppId,
                                "rejected",
                                userId,
                                viewerRole,
                                counterpartName,
                              )
                            }
                            opportunityLoadingMap={opportunityActionLoading}
                            currentStatusMap={opportunityStatusMap}
                          />
                        </>
                      ) : (
                        <div className="chat-markdown max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {mentionsToMarkdownLinks(msg.content)}
                          </ReactMarkdown>
                        </div>
                      )}
                    </article>
                    {msg.role === "user" &&
                      msg.attachmentNames &&
                      msg.attachmentNames.length > 0 && (
                        <p className="text-xs opacity-90 mt-1.5">
                          Attached: {msg.attachmentNames.join(", ")}
                        </p>
                      )}
                  </div>
                </div>
                {/* Inline discovery cards (legacy format) */}
                {msg.role === "assistant" &&
                  msg.discoveries &&
                  msg.discoveries.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.discoveries.map((discovery, idx) => (
                        <InlineDiscoveryCard
                          key={`${discovery.candidateId}-${idx}`}
                          discovery={discovery}
                        />
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
      <div className="sticky bottom-0 z-20">
        <div className="px-6 lg:px-8">
          <ContentContainer>
            <SuggestionChips
              suggestions={suggestions}
              disabled={isBusy}
              onSuggestionClick={handleSuggestionClick}
            />
            {renderInputForm()}
          </ContentContainer>
        </div>
      </div>
    </>
  );
}
