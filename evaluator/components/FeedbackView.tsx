"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  MessageSquare,
  RefreshCw,
  X,
  RotateCcw,
} from "lucide-react";
import { ConversationView } from "./ConversationView";
import { apiFetch } from "@/lib/api";

interface FeedbackEntry {
  id: string;
  userId: string;
  feedback: string;
  sessionId: string | null;
  conversation: Array<{ role: string; content: string }> | null;
  retryConversation: Array<{ role: string; content: string }> | null;
  retryStatus: string | null;
  archived: boolean;
  createdAt: string;
  aiExplanation: string | null;
  issueLabels: string[] | null;
}

export function FeedbackView({ selectedId }: { selectedId?: string }) {
  const router = useRouter();
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/eval/feedback");
      if (res.ok) {
        const data = await res.json();
        setEntries(data.feedback || []);
      }
    } catch (e) {
      console.error("Failed to fetch feedback", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  const retryFeedback = async (id: string) => {
    setRetrying(id);
    setEntries((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, retryConversation: [], retryStatus: "running" } : e
      )
    );

    try {
      const res = await apiFetch(`/api/eval/feedback/${id}/retry`, {
        method: "POST",
        json: { apiUrl },
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "user" || event.type === "assistant") {
              const msg = { role: event.type, content: event.content };
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === id
                    ? { ...e, retryConversation: [...(e.retryConversation ?? []), msg] }
                    : e
                )
              );
            } else if (event.type === "done") {
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === id ? { ...e, retryStatus: "completed" } : e
                )
              );
            } else if (event.type === "error") {
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === id ? { ...e, retryStatus: "error" } : e
                )
              );
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (e) {
      console.error("Retry failed", e);
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, retryStatus: "error" } : e))
      );
    } finally {
      setRetrying(null);
    }
  };

  const archiveFeedback = async (id: string) => {
    try {
      const res = await apiFetch(`/api/eval/feedback/${id}`, {
        method: "PATCH",
        json: { archived: true },
      });
      if (res.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        if (selectedId === id) router.push("/feedback");
      }
    } catch (e) {
      console.error("Archive failed", e);
    }
  };

  const selected = entries.find((e) => e.id === selectedId);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left panel: feedback list */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase">
              Feedback ({entries.length})
            </span>
            <button
              onClick={fetchFeedback}
              disabled={loading}
              className="p-1 text-gray-400 hover:text-gray-600 rounded"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {loading && entries.length === 0 ? (
          <div className="p-8 text-center text-gray-400 flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-gray-400 flex-1 flex items-center justify-center">
            <div>
              <MessageSquare className="w-10 h-10 mx-auto mb-2 text-gray-200" />
              <p className="text-sm">No feedback yet</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 overflow-y-auto flex-1">
            {entries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => router.push(`/feedback/${entry.id}`)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                  selectedId === entry.id
                    ? "bg-blue-50 border-l-4 border-l-blue-600"
                    : ""
                }`}
              >
                <p className="text-sm text-gray-800 line-clamp-2 mb-1">
                  {entry.feedback}
                </p>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                  {entry.conversation && (
                    <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                      {entry.conversation.length} msgs
                    </span>
                  )}
                  {entry.retryStatus === "completed" && (
                    <span className="px-1.5 py-0.5 bg-green-50 text-green-600 rounded">
                      retried
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right panel: detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-200" />
              <p>Select a feedback entry to view details</p>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Feedback text */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">Feedback</h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">
                    {new Date(selected.createdAt).toLocaleString()}
                  </span>
                  <button
                    onClick={() => archiveFeedback(selected.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Archive
                  </button>
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg text-sm">
                {selected.feedback}
              </div>
              {selected.sessionId && (
                <p className="mt-2 text-xs text-gray-400">
                  Session: {selected.sessionId}
                </p>
              )}
            </div>

            {/* AI Analysis */}
            {(selected.aiExplanation || (selected.issueLabels && selected.issueLabels.length > 0)) && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-base font-semibold mb-4">AI Analysis</h3>
                
                {selected.issueLabels && selected.issueLabels.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {selected.issueLabels.map((label, i) => (
                      <span 
                        key={i}
                        className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-medium"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}

                {selected.aiExplanation && (
                  <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {selected.aiExplanation}
                  </div>
                )}
              </div>
            )}

            {/* Original conversation */}
            {selected.conversation && selected.conversation.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold">
                    Original Conversation ({selected.conversation.length} messages)
                  </h3>
                  <button
                    onClick={() => retryFeedback(selected.id)}
                    disabled={retrying === selected.id}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
                  >
                    {retrying === selected.id ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Retrying...
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-3.5 h-3.5" /> Retry
                      </>
                    )}
                  </button>
                </div>
                <ConversationView messages={selected.conversation} />
              </div>
            )}

            {/* Retry conversation */}
            {selected.retryConversation &&
              selected.retryConversation.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h3 className="text-base font-semibold mb-4">
                    Retry Conversation ({selected.retryConversation.length}{" "}
                    messages)
                  </h3>
                  <ConversationView messages={selected.retryConversation} />
                </div>
              )}

            {/* No conversation */}
            {!selected.conversation && (
              <div className="bg-white rounded-lg shadow-sm p-6 text-center text-gray-400">
                <p className="text-sm">
                  No conversation was captured with this feedback
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
