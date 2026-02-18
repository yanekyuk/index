"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  Play,
  Square,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Circle,
  Download,
  Minus,
  History,
  Plus,
  Trash2,
  Save,
  DatabaseZap,
  ChevronDown,
  ChevronRight,
  X,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import OpportunityCard, { parseOpportunityBlocks } from "@/components/OpportunityCard";
import type { Scenario } from "@/lib/scenarios";

// ─── Types ───────────────────────────────────────────────────────────────────

type ReviewFlag = "pass" | "fail" | "needs_review" | "skipped";
type Tab = "runs" | "cases" | "feedback";

interface ScenarioState extends Scenario {
  status: "pending" | "running" | "completed" | "error";
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  result?: {
    verdict: "success" | "partial" | "failure" | "blocked";
    fulfillmentScore: number;
    qualityScore: number;
    reasoning: string;
    successSignals?: string[];
    failureSignals?: string[];
    turns: number;
    duration: number;
  };
  reviewFlag?: ReviewFlag;
  reviewNote?: string;
}

interface NeedRecord {
  id: string;
  needId: string;
  category: string;
  question: string;
  expectation: string;
  messages: Record<string, string>;
  enabled: boolean;
}

const PERSONA_IDS = [
  "direct_requester",
  "exploratory_seeker",
  "technical_precise",
  "vague_requester",
] as const;

const PERSONA_LABELS: Record<string, string> = {
  direct_requester: "Direct Requester",
  exploratory_seeker: "Exploratory Seeker",
  technical_precise: "Technical Precise",
  vague_requester: "Vague Requester",
};

const CATEGORY_OPTIONS = [
  "profile",
  "intent",
  "index",
  "intent_index",
  "discovery",
  "url",
  "edge_case",
];

// ─── Test Cases Tab ──────────────────────────────────────────────────────────

function TestCasesTab({ getAccessToken }: { getAccessToken: () => Promise<string | null> }) {
  const [needs, setNeeds] = useState<NeedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<NeedRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<Omit<NeedRecord, "id"> | null>(null);
  const [filterCategory, setFilterCategory] = useState("all");
  const [seeding, setSeeding] = useState(false);
  const [saving, setSaving] = useState(false);

  const authHeaders = useCallback(async () => {
    const token = await getAccessToken();
    return token
      ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      : null;
  }, [getAccessToken]);

  const fetchNeeds = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/eval/needs", { headers });
      if (res.ok) {
        const data = await res.json();
        setNeeds(data.needs || []);
      }
    } catch (e) {
      console.error("Failed to fetch needs", e);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchNeeds();
  }, [fetchNeeds]);

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/eval/needs/seed", { method: "POST", headers });
      if (res.ok) {
        await fetchNeeds();
      } else {
        alert("Failed to seed");
      }
    } catch {
      alert("Failed to seed");
    } finally {
      setSeeding(false);
    }
  };

  const toggleEnabled = async (need: NeedRecord) => {
    const headers = await authHeaders();
    if (!headers) return;
    const newVal = !need.enabled;
    setNeeds((prev) => prev.map((n) => (n.id === need.id ? { ...n, enabled: newVal } : n)));
    await fetch(`/api/eval/needs/${need.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ enabled: newVal }),
    });
  };

  const saveEdit = async () => {
    if (!editDraft) return;
    setSaving(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(`/api/eval/needs/${editDraft.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          category: editDraft.category,
          question: editDraft.question,
          expectation: editDraft.expectation,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setNeeds((prev) => prev.map((n) => (n.id === data.need.id ? data.need : n)));
        setEditDraft(null);
        setExpandedId(null);
      } else {
        alert("Failed to save");
      }
    } catch {
      alert("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const createNeed = async () => {
    if (!newDraft) return;
    if (!newDraft.needId || !newDraft.category || !newDraft.question) {
      alert("Need ID, category, and question are required");
      return;
    }
    setSaving(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/eval/needs", {
        method: "POST",
        headers,
        body: JSON.stringify(newDraft),
      });
      if (res.ok) {
        await fetchNeeds();
        setNewDraft(null);
        setCreating(false);
      } else {
        const data = await res.json();
        alert(data.error || "Failed to create");
      }
    } catch {
      alert("Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const deleteNeed = async (id: string) => {
    if (!confirm("Delete this test case?")) return;
    const headers = await authHeaders();
    if (!headers) return;
    const res = await fetch(`/api/eval/needs/${id}`, { method: "DELETE", headers });
    if (res.ok) {
      setNeeds((prev) => prev.filter((n) => n.id !== id));
      if (expandedId === id) {
        setExpandedId(null);
        setEditDraft(null);
      }
    }
  };

  const filtered = filterCategory === "all" ? needs : needs.filter((n) => n.category === filterCategory);
  const grouped = filtered.reduce<Record<string, NeedRecord[]>>((acc, n) => {
    (acc[n.category] ??= []).push(n);
    return acc;
  }, {});

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-gray-900">Test Cases</h2>
            <span className="text-sm text-gray-500">
              {needs.length} needs / {needs.filter((n) => n.enabled).length} enabled
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
            >
              <option value="all">All categories</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <button
              onClick={seedDefaults}
              disabled={seeding}
              className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium disabled:opacity-50"
            >
              {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <DatabaseZap className="w-4 h-4" />}
              {needs.length === 0 ? "Seed defaults" : "Reset to defaults"}
            </button>
            <button
              onClick={() => {
                setCreating(true);
                setNewDraft({
                  needId: "",
                  category: "profile",
                  question: "",
                  expectation: "",
                  messages: {},
                  enabled: true,
                });
              }}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> Add Need
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && needs.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading test cases...
          </div>
        )}

        {/* Empty state */}
        {!loading && needs.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <DatabaseZap className="w-12 h-12 mx-auto mb-3 text-gray-200" />
            <p className="mb-4">No test cases yet</p>
            <button
              onClick={seedDefaults}
              disabled={seeding}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
            >
              Seed from defaults
            </button>
          </div>
        )}

        {/* Create form */}
        {creating && newDraft && (
          <div className="bg-white rounded-lg shadow-sm border border-blue-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">New Test Case</h3>
              <button
                onClick={() => { setCreating(false); setNewDraft(null); }}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <NeedForm
              draft={newDraft as Omit<NeedRecord, "id"> & { id?: string }}
              onChange={(d) => setNewDraft(d as Omit<NeedRecord, "id">)}
              needIdEditable
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setCreating(false); setNewDraft(null); }}
                className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={createNeed}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? "Generating messages..." : "Create"}
              </button>
            </div>
          </div>
        )}

        {/* Grouped needs list */}
        {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
          <div key={cat} className="mb-6">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2 px-1">
              {cat.replace(/_/g, " ")} ({items.length})
            </h3>
            <div className="space-y-1">
              {items.map((need) => {
                const isExpanded = expandedId === need.id;
                return (
                  <div
                    key={need.id}
                    className={`bg-white rounded-lg shadow-sm border ${isExpanded ? "border-blue-200" : "border-gray-100"}`}
                  >
                    {/* Row */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <button
                        onClick={() => {
                          if (isExpanded) {
                            setExpandedId(null);
                            setEditDraft(null);
                          } else {
                            setExpandedId(need.id);
                            setEditDraft({ ...need });
                          }
                        }}
                        className="p-0.5 text-gray-400 hover:text-gray-600"
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{need.needId}</span>
                          <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">
                            {need.category.replace(/_/g, " ")}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{need.question}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleEnabled(need)}
                          className={`text-xs px-2 py-1 rounded-full font-medium ${
                            need.enabled
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-400"
                          }`}
                        >
                          {need.enabled ? "Enabled" : "Disabled"}
                        </button>
                        <button
                          onClick={() => deleteNeed(need.id)}
                          className="p-1.5 text-gray-300 hover:text-red-500"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded edit form */}
                    {isExpanded && editDraft && editDraft.id === need.id && (
                      <div className="px-4 pb-4 border-t border-gray-100 pt-4">
            <NeedForm
              draft={editDraft as Omit<NeedRecord, "id"> & { id?: string }}
              onChange={(d) => setEditDraft(d as NeedRecord)}
              needIdEditable={false}
            />
                        <div className="flex justify-end gap-2 mt-4">
                          <button
                            onClick={() => { setExpandedId(null); setEditDraft(null); }}
                            className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={saveEdit}
                            disabled={saving}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
                          >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {saving ? "Regenerating messages..." : "Save"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Conversation View (matches frontend chat bubble style) ─────────────────

function ConversationView({
  messages,
}: {
  messages: Array<{ role: string; content: string }>;
}) {
  return (
    <div className="space-y-4">
      {messages.map((msg, idx) => (
        <div
          key={idx}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] rounded-sm px-3 py-2 ${
              msg.role === "user"
                ? "bg-[#041729] text-white"
                : "bg-gray-100 text-gray-900"
            }`}
          >
            {msg.role === "assistant" && (
              <span className="text-[10px] uppercase tracking-wider text-[#4091BB]/70 mb-1 block">
                Index
              </span>
            )}
            {msg.role === "assistant" ? (
              <AssistantContent content={msg.content} />
            ) : (
              <article className="chat-markdown max-w-none chat-markdown-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              </article>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function AssistantContent({ content }: { content: string }) {
  const segments = parseOpportunityBlocks(content);

  return (
    <article className="chat-markdown max-w-none">
      {segments.map((segment, idx) => {
        if (segment.type === "text") {
          return (
            <ReactMarkdown key={idx} remarkPlugins={[remarkGfm]}>
              {segment.content}
            </ReactMarkdown>
          );
        } else if (segment.type === "opportunity") {
          return (
            <div key={idx} className="my-3">
              <OpportunityCard card={segment.data} />
            </div>
          );
        }
        return null;
      })}
    </article>
  );
}

// ─── Feedback Tab ────────────────────────────────────────────────────────────

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
}

function FeedbackTab({ getAccessToken }: { getAccessToken: () => Promise<string | null> }) {
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

  const authHeaders = useCallback(async () => {
    const token = await getAccessToken();
    return token
      ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      : null;
  }, [getAccessToken]);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/eval/feedback", { headers });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.feedback || []);
      }
    } catch (e) {
      console.error("Failed to fetch feedback", e);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

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
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(`/api/eval/feedback/${id}/retry`, {
        method: "POST",
        headers,
        body: JSON.stringify({ apiUrl }),
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
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(`/api/eval/feedback/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ archived: true }),
      });
      if (res.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        if (selectedId === id) setSelectedId(null);
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
                onClick={() => setSelectedId(entry.id)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                  selectedId === entry.id ? "bg-blue-50 border-l-4 border-l-blue-600" : ""
                }`}
              >
                <p className="text-sm text-gray-800 line-clamp-2 mb-1">{entry.feedback}</p>
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
                    title="Archive this feedback"
                  >
                    <X className="w-3.5 h-3.5" /> Archive
                  </button>
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg text-sm">{selected.feedback}</div>
              {selected.sessionId && (
                <p className="mt-2 text-xs text-gray-400">
                  Session: {selected.sessionId}
                </p>
              )}
            </div>

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
            {selected.retryConversation && selected.retryConversation.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-base font-semibold mb-4">
                  Retry Conversation ({selected.retryConversation.length} messages)
                </h3>
                <ConversationView messages={selected.retryConversation} />
              </div>
            )}

            {/* No conversation */}
            {!selected.conversation && (
              <div className="bg-white rounded-lg shadow-sm p-6 text-center text-gray-400">
                <p className="text-sm">No conversation was captured with this feedback</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Reusable Need Form ──────────────────────────────────────────────────────

function NeedForm({
  draft,
  onChange,
  needIdEditable,
}: {
  draft: Omit<NeedRecord, "id"> & { id?: string };
  onChange: (d: Omit<NeedRecord, "id"> & { id?: string }) => void;
  needIdEditable: boolean;
}) {
  const hasMessages = Object.values(draft.messages).some((v) => v);

  return (
    <div className="space-y-4">
      {/* Need ID + Category */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Need ID</label>
          <input
            type="text"
            value={draft.needId ?? ""}
            onChange={(e) => onChange({ ...draft, needId: e.target.value.toUpperCase().replace(/\s+/g, "_") })}
            disabled={!needIdEditable}
            placeholder="e.g. PROFILE_CREATE"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
          <select
            value={draft.category}
            onChange={(e) => onChange({ ...draft, category: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Question */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Question</label>
        <textarea
          value={draft.question}
          onChange={(e) => onChange({ ...draft, question: e.target.value })}
          placeholder="The user question to test, e.g. 'User wants to create their profile'"
          rows={2}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white resize-none"
        />
      </div>

      {/* Expectation */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Expectation</label>
        <textarea
          value={draft.expectation}
          onChange={(e) => onChange({ ...draft, expectation: e.target.value })}
          placeholder="What the agent should do, e.g. 'Agent should invoke profile creation and confirm success'"
          rows={2}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white resize-none"
        />
      </div>

      {/* Auto-generated persona messages (read-only) */}
      {hasMessages && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">
            Generated Persona Messages
            <span className="ml-1 font-normal text-gray-400">(auto-generated on save)</span>
          </label>
          <div className="space-y-2">
            {PERSONA_IDS.map((pid) => (
              <div key={pid}>
                <label className="block text-xs text-gray-500 mb-0.5">
                  {PERSONA_LABELS[pid]}
                </label>
                <div className="text-sm text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                  {draft.messages[pid] || <span className="text-gray-300 italic">Not generated</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function EvaluatorPage() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const [activeTab, setActiveTab] = useState<Tab>("runs");
  const [scenarios, setScenarios] = useState<ScenarioState[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [globalStatus, setGlobalStatus] = useState<"idle" | "loading" | "running" | "completed">("idle");
  const [filterPersona, setFilterPersona] = useState<string>("DIRECT_REQUESTER");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterReview, setFilterReview] = useState<string>("all");
  const [runId, setRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<
    Array<{
      id: string;
      name?: string | null;
      status: string;
      createdAt: string;
      scenarioCount: number;
      completedCount: number;
    }>
  >([]);
  const cancelRef = useRef(false);
  const noteDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

  // ── Runs tab logic ──────────────────────────────────────────

  const saveReview = useCallback(
    async (id: string, payload: { reviewFlag?: ReviewFlag | null; reviewNote?: string | null }) => {
      if (!runId) return;
      const token = await getAccessToken();
      if (!token) return;
      await fetch(`/api/eval/runs/${runId}/scenarios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
    },
    [runId, getAccessToken]
  );

  const filterOptions = useMemo(() => {
    const personas = new Set<string>();
    const categories = new Set<string>();
    for (const s of scenarios) {
      if (s.personaId) personas.add(s.personaId);
      if (s.category) categories.add(s.category);
    }
    return {
      personas: [...personas].sort(),
      categories: [...categories].sort(),
    };
  }, [scenarios]);

  const filteredScenarios = useMemo(() => {
    return scenarios.filter((s) => {
      if (filterPersona !== "all" && s.personaId !== filterPersona) return false;
      if (filterCategory !== "all" && s.category !== filterCategory) return false;
      if (filterReview !== "all") {
        if (filterReview === "unreviewed") {
          if (s.reviewFlag) return false;
        } else if (s.reviewFlag !== filterReview) return false;
      }
      return true;
    });
  }, [scenarios, filterPersona, filterCategory, filterReview]);

  const hasActiveFilters =
    filterPersona !== "all" ||
    filterCategory !== "all" ||
    filterReview !== "all";

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId);

  const metrics = useMemo(() => {
    const set = filteredScenarios;
    const completed = set.filter((s) => s.status === "completed");
    const total = set.length;
    const completedCount = completed.length;
    const success = completed.filter((s) => s.result?.verdict === "success").length;
    const partial = completed.filter((s) => s.result?.verdict === "partial").length;
    const failure = completed.filter((s) => s.result?.verdict === "failure").length;
    const blocked = completed.filter((s) => s.result?.verdict === "blocked").length;
    const avgFulfillment =
      completedCount > 0
        ? completed.reduce((sum, s) => sum + (s.result?.fulfillmentScore || 0), 0) / completedCount
        : 0;
    const avgQuality =
      completedCount > 0
        ? completed.reduce((sum, s) => sum + (s.result?.qualityScore || 0), 0) / completedCount
        : 0;
    const reviewed = completed.filter((s) => s.reviewFlag).length;
    const reviewPass = completed.filter((s) => s.reviewFlag === "pass").length;
    const reviewFail = completed.filter((s) => s.reviewFlag === "fail").length;
    const reviewNeedsReview = completed.filter((s) => s.reviewFlag === "needs_review").length;
    return {
      total,
      completed: completedCount,
      success,
      partial,
      failure,
      blocked,
      avgFulfillment,
      avgQuality,
      reviewed,
      reviewPass,
      reviewFail,
      reviewNeedsReview,
    };
  }, [filteredScenarios]);

  const loadRuns = async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch("/api/eval/runs", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (e) {
      console.error("Failed to load runs", e);
    }
  };

  const loadRun = async (id: string) => {
    try {
      setGlobalStatus("loading");
      const token = await getAccessToken();
      if (!token) {
        alert("Please log in");
        setGlobalStatus("idle");
        return;
      }
      const res = await fetch(`/api/eval/runs/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load run");
      const data = await res.json();
      setRunId(data.run?.id || id);
      const list: ScenarioState[] = (data.scenarios || []).map((s: Record<string, unknown>) => ({
        id: String(s.id),
        needId: String(s.needId ?? s.need),
        personaId: String(s.personaId ?? s.persona),
        message: String(s.message ?? ""),
        category: String(s.category ?? ""),
        status: (s.status as ScenarioState["status"]) ?? "pending",
        conversation: s.conversation as ScenarioState["conversation"],
        result: s.result as ScenarioState["result"],
        reviewFlag: s.reviewFlag as ScenarioState["reviewFlag"],
        reviewNote: s.reviewNote as string | undefined,
      }));
      setScenarios(list);
      setGlobalStatus("idle");
    } catch (e) {
      console.error("Failed to load run", e);
      alert("Failed to load run");
      setGlobalStatus("idle");
    }
  };

  const loadScenarios = async () => {
    try {
      setGlobalStatus("loading");
      const token = await getAccessToken();
      if (!token) {
        alert("Please log in");
        setGlobalStatus("idle");
        return;
      }
      const res = await fetch("/api/eval/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create run");
      }
      const data = await res.json();
      setRunId(data.runId ?? null);
      const list: ScenarioState[] = (data.scenarios || []).map((s: ScenarioState) => ({
        ...s,
        status: "pending" as const,
      }));
      setScenarios(list);
      setGlobalStatus("idle");
    } catch (error) {
      console.error("Failed to load scenarios:", error);
      alert(error instanceof Error ? error.message : "Failed to load scenarios");
      setGlobalStatus("idle");
    }
  };

  const runScenario = async (scenarioId: string) => {
    if (!runId) {
      alert("No run loaded");
      return;
    }
    const token = await getAccessToken();
    if (!token) {
      alert("Please log in");
      return;
    }

    setScenarios((prev) =>
      prev.map((s) => (s.id === scenarioId ? { ...s, status: "running", conversation: [] } : s))
    );

    try {
      const res = await fetch("/api/eval/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ runId, scenarioId, apiUrl }),
      });
      const data = await res.json();
      const result = data.results?.[0];

      if (result?.error) {
        setScenarios((prev) =>
          prev.map((s) => (s.id === scenarioId ? { ...s, status: "error" } : s))
        );
        return;
      }

      setScenarios((prev) =>
        prev.map((s) =>
          s.id === scenarioId
            ? {
                ...s,
                status: "completed",
                conversation: result.conversation || [],
                result: {
                  verdict: result.verdict,
                  fulfillmentScore: result.fulfillmentScore ?? 0,
                  qualityScore: result.qualityScore ?? 0,
                  reasoning: result.reasoning ?? "",
                  successSignals: result.successSignals,
                  failureSignals: result.failureSignals,
                  turns: result.turns ?? 0,
                  duration: result.durationMs ?? 0,
                },
              }
            : s
        )
      );
    } catch {
      setScenarios((prev) =>
        prev.map((s) => (s.id === scenarioId ? { ...s, status: "error" } : s))
      );
    }
  };

  const runFiltered = async () => {
    const pending = filteredScenarios.filter((s) => s.status === "pending" || s.status === "error");
    if (pending.length === 0) return;

    cancelRef.current = false;
    setGlobalStatus("running");

    await Promise.all(pending.map((s) => runScenario(s.id)));

    setGlobalStatus("completed");
  };

  const stopAll = () => {
    cancelRef.current = true;
    setGlobalStatus("idle");
  };

  const restartAll = () => {
    cancelRef.current = true;
    setRunId(null);
    setScenarios([]);
    setRuns([]);
    setSelectedScenarioId(null);
    setFilterPersona("DIRECT_REQUESTER");
    setFilterCategory("all");
    setFilterReview("all");
    setGlobalStatus("idle");
  };

  const setReviewFlag = (scenarioId: string, flag: ReviewFlag) => {
    const sc = scenarios.find((s) => s.id === scenarioId);
    const newFlag = sc?.reviewFlag === flag ? undefined : flag;
    setScenarios((prev) =>
      prev.map((s) => (s.id === scenarioId ? { ...s, reviewFlag: newFlag } : s))
    );
    saveReview(scenarioId, { reviewFlag: newFlag ?? null, reviewNote: sc?.reviewNote ?? null });
  };

  const setReviewNote = (scenarioId: string, note: string) => {
    setScenarios((prev) =>
      prev.map((s) => (s.id === scenarioId ? { ...s, reviewNote: note } : s))
    );
    if (noteDebounceRef.current[scenarioId]) clearTimeout(noteDebounceRef.current[scenarioId]);
    noteDebounceRef.current[scenarioId] = setTimeout(() => {
      saveReview(scenarioId, { reviewNote: note });
      delete noteDebounceRef.current[scenarioId];
    }, 500);
  };

  const exportFiltered = () => {
    const completed = filteredScenarios.filter((s) => s.status === "completed");
    if (completed.length === 0) {
      alert("No completed scenarios to export");
      return;
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      filters: { persona: filterPersona, category: filterCategory },
      summary: {
        total: metrics.total,
        completed: metrics.completed,
        success: metrics.success,
        partial: metrics.partial,
        failure: metrics.failure,
        blocked: metrics.blocked,
        avgFulfillment: metrics.avgFulfillment,
        avgQuality: metrics.avgQuality,
        successRate:
          metrics.completed > 0 ? (metrics.success / metrics.completed) * 100 : 0,
        reviewed: metrics.reviewed,
        reviewPass: metrics.reviewPass,
        reviewFail: metrics.reviewFail,
        reviewNeedsReview: metrics.reviewNeedsReview,
      },
      scenarios: completed.map((s) => ({
        id: s.id,
        need: s.needId,
        persona: s.personaId,
        category: s.category,
        initialMessage: s.message,
        conversation: s.conversation,
        result: s.result,
        reviewFlag: s.reviewFlag,
        reviewNote: s.reviewNote,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `eval-results-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return <Circle className="w-3 h-3 text-gray-400" />;
      case "running":
        return <Loader2 className="w-3 h-3 text-blue-600 animate-spin" />;
      case "completed":
        return <CheckCircle2 className="w-3 h-3 text-green-600" />;
      case "error":
        return <XCircle className="w-3 h-3 text-red-600" />;
      default:
        return <Circle className="w-3 h-3 text-gray-400" />;
    }
  };

  const verdictStyles: Record<string, { bg: string; text: string; Icon: typeof CheckCircle2 }> = {
    success: { bg: "bg-green-100", text: "text-green-800", Icon: CheckCircle2 },
    partial: { bg: "bg-yellow-100", text: "text-yellow-800", Icon: AlertCircle },
    failure: { bg: "bg-red-100", text: "text-red-800", Icon: XCircle },
    blocked: { bg: "bg-gray-100", text: "text-gray-800", Icon: Square },
  };

  const reviewFlagStyles: Record<
    ReviewFlag,
    { bg: string; text: string; border: string; Icon: typeof CheckCircle2; label: string }
  > = {
    pass: { bg: "bg-green-100", text: "text-green-700", border: "border-green-300", Icon: CheckCircle2, label: "Pass" },
    fail: { bg: "bg-red-100", text: "text-red-700", border: "border-red-300", Icon: XCircle, label: "Fail" },
    needs_review: { bg: "bg-yellow-100", text: "text-yellow-700", border: "border-yellow-300", Icon: AlertCircle, label: "Needs Review" },
    skipped: { bg: "bg-gray-100", text: "text-gray-500", border: "border-gray-300", Icon: Minus, label: "Skipped" },
  };

  const pendingInView = filteredScenarios.filter(
    (s) => s.status === "pending" || s.status === "error"
  ).length;

  // ── Render ──────────────────────────────────────────────────────────────

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-4">
        <h1 className="text-2xl font-semibold">Chat Evaluator</h1>
        <p className="text-gray-600">Sign in to run evaluations against the protocol API</p>
        <button
          onClick={login}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Log in
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold text-gray-900">Agent Evaluation</h1>
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setActiveTab("runs")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "runs"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Runs
            </button>
            <button
              onClick={() => setActiveTab("cases")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "cases"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Test Cases
            </button>
            <button
              onClick={() => setActiveTab("feedback")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "feedback"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Feedback
            </button>
          </div>
          {activeTab === "runs" && (
            <span className="text-sm text-gray-500">
              {process.env.NEXT_PUBLIC_API_URL || "API URL not set"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "runs" && (
            <>
              {scenarios.length === 0 ? (
                <>
                  <button
                    onClick={loadScenarios}
                    disabled={globalStatus === "loading"}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {globalStatus === "loading" ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" /> Start with session
                      </>
                    )}
                  </button>
                  <button
                    onClick={loadRuns}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
                  >
                    <History className="w-4 h-4" />
                    Load past run
                  </button>
                  {runs.length > 0 && (
                    <select
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) loadRun(v);
                        e.target.value = "";
                      }}
                      className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
                    >
                      <option value="">Select run...</option>
                      {runs.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name || new Date(r.createdAt).toLocaleString()} ({r.completedCount}/
                          {r.scenarioCount})
                        </option>
                      ))}
                    </select>
                  )}
                </>
              ) : (
                <button
                  onClick={restartAll}
                  className="flex items-center gap-2 px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
              )}
            </>
          )}
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "feedback" ? (
        <FeedbackTab getAccessToken={getAccessToken} />
      ) : activeTab === "cases" ? (
        <TestCasesTab getAccessToken={getAccessToken} />
      ) : (
        /* ── Runs Tab ─────────────────────────────────────────────────────── */
        <div className="flex-1 flex overflow-hidden">
          <div className="w-80 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
            {scenarios.length > 0 && (
              <>
                <div className="p-3 border-b border-gray-200 flex-shrink-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 uppercase">Filters</span>
                    {hasActiveFilters && (
                      <button
                        onClick={() => {
                          setFilterPersona("DIRECT_REQUESTER");
                          setFilterCategory("all");
                          setFilterReview("all");
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white"
                  >
                    <option value="all">All categories</option>
                    {filterOptions.categories.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                  <select
                    value={filterPersona}
                    onChange={(e) => setFilterPersona(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white"
                  >
                    <option value="all">All personas</option>
                    {filterOptions.personas.map((p) => (
                      <option key={p} value={p}>
                        {p.replace(/_/g, " ").toLowerCase()}
                      </option>
                    ))}
                  </select>
                  <select
                    value={filterReview}
                    onChange={(e) => setFilterReview(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white"
                  >
                    <option value="all">All review statuses</option>
                    <option value="unreviewed">Unreviewed</option>
                    <option value="pass">Pass</option>
                    <option value="fail">Fail</option>
                    <option value="needs_review">Needs Review</option>
                    <option value="skipped">Skipped</option>
                  </select>
                </div>

                <div className="p-3 border-b border-gray-200 flex-shrink-0">
                  <div className="flex items-center gap-2 mb-2">
                    {globalStatus !== "running" ? (
                      <button
                        onClick={runFiltered}
                        disabled={pendingInView === 0}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 text-sm font-medium"
                      >
                        <Play className="w-4 h-4" />
                        Run {hasActiveFilters ? `${pendingInView} filtered` : `all ${pendingInView}`}
                      </button>
                    ) : (
                      <button
                        onClick={stopAll}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
                      >
                        <Square className="w-4 h-4" />
                        Stop
                      </button>
                    )}
                    <button
                      onClick={exportFiltered}
                      disabled={metrics.completed === 0}
                      className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg disabled:opacity-40"
                      title="Export completed scenarios"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-600">
                    <span>{metrics.total} scenarios</span>
                    {metrics.completed > 0 && (
                      <>
                        <span className="text-gray-300">|</span>
                        <span className="text-green-600 font-medium">{metrics.success} pass</span>
                        {metrics.partial > 0 && (
                          <span className="text-yellow-600 font-medium">{metrics.partial} partial</span>
                        )}
                        {metrics.failure > 0 && (
                          <span className="text-red-600 font-medium">{metrics.failure} fail</span>
                        )}
                        {metrics.blocked > 0 && (
                          <span className="text-gray-500 font-medium">{metrics.blocked} blocked</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            {scenarios.length === 0 ? (
              <div className="p-8 text-center text-gray-500 flex-1 flex items-center justify-center">
                <p className="text-sm">Load scenarios to begin</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 overflow-y-auto flex-1">
                {filteredScenarios.map((scenario, idx) => (
                  <div
                    key={scenario.id}
                    className={`flex items-start gap-2 hover:bg-gray-50 ${
                      selectedScenarioId === scenario.id ? "bg-blue-50 border-l-4 border-l-blue-600" : ""
                    }`}
                  >
                    <button
                      onClick={() => setSelectedScenarioId(scenario.id)}
                      className="flex-1 text-left px-4 py-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">{getStatusIcon(scenario.status)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-medium text-gray-400">#{idx + 1}</span>
                            <div className="flex items-center gap-1">
                              {scenario.reviewFlag && (
                                <span
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                                    reviewFlagStyles[scenario.reviewFlag].bg
                                  } ${reviewFlagStyles[scenario.reviewFlag].text}`}
                                >
                                  {reviewFlagStyles[scenario.reviewFlag].label}
                                </span>
                              )}
                              {scenario.result && (
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                                    verdictStyles[scenario.result.verdict]?.bg ?? "bg-gray-100"
                                  } ${verdictStyles[scenario.result.verdict]?.text ?? "text-gray-800"}`}
                                >
                                  {scenario.result.verdict}
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-gray-800 line-clamp-2 mb-1">{scenario.message}</p>
                          <div className="flex items-center gap-1 flex-wrap text-xs text-gray-500">
                            <span className="px-1.5 py-0.5 bg-gray-100 rounded">
                              {scenario.category?.replace(/_/g, " ") || "\u2014"}
                            </span>
                            <span className="text-gray-300">\u00b7</span>
                            <span>{scenario.personaId?.replace(/_/g, " ").toLowerCase()}</span>
                          </div>
                          {scenario.result && (
                            <div className="mt-1 text-xs text-gray-500">
                              {(scenario.result.fulfillmentScore * 100).toFixed(0)}% \u00b7{" "}
                              {scenario.result.turns} turns
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                    {(scenario.status === "pending" || scenario.status === "error") &&
                      globalStatus !== "running" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            runScenario(scenario.id);
                          }}
                          className="mt-3 mr-3 p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                          title="Run this scenario"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {!selectedScenario ? (
              <div className="h-full flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <Circle className="w-12 h-12 mx-auto mb-3 text-gray-200" />
                  <p>Select a scenario to view details</p>
                </div>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto space-y-6">
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h2 className="text-lg font-bold text-gray-900 mb-4">Scenario Details</h2>
                  <div className="flex items-center gap-2 flex-wrap text-sm mb-4">
                    <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                      {selectedScenario.category?.replace(/_/g, " ") || "\u2014"}
                    </span>
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                      {selectedScenario.needId}
                    </span>
                    <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs">
                      {selectedScenario.personaId?.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
                      Initial Query
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg text-sm">
                      {selectedScenario.message}
                    </div>
                  </div>
                </div>

                {selectedScenario.conversation && selectedScenario.conversation.length > 0 && (
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <h3 className="text-base font-semibold mb-4">
                      Conversation ({selectedScenario.conversation.length} messages)
                    </h3>
                    <ConversationView messages={selectedScenario.conversation} />
                  </div>
                )}

                {selectedScenario.result && (
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <h3 className="text-base font-semibold mb-4">Evaluation Results</h3>
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <div className="text-xs text-gray-500 mb-1">Fulfillment</div>
                          <div className="text-2xl font-bold">
                            {(selectedScenario.result.fulfillmentScore * 100).toFixed(0)}%
                          </div>
                        </div>
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <div className="text-xs text-gray-500 mb-1">Quality</div>
                          <div className="text-2xl font-bold">
                            {(selectedScenario.result.qualityScore * 100).toFixed(0)}%
                          </div>
                        </div>
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <div className="text-xs text-gray-500 mb-1">Duration</div>
                          <div className="text-2xl font-bold">
                            {(selectedScenario.result.duration / 1000).toFixed(1)}s
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-semibold mb-2">Reasoning</div>
                        <div className="p-4 bg-gray-50 rounded-lg text-sm">
                          {selectedScenario.result.reasoning}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {selectedScenario.status === "completed" && (
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <h3 className="text-base font-semibold mb-4">Reviewer Assessment</h3>
                    <div className="flex items-center gap-2 mb-4">
                      {(Object.keys(reviewFlagStyles) as ReviewFlag[]).map((flag) => {
                        const style = reviewFlagStyles[flag];
                        const isActive = selectedScenario.reviewFlag === flag;
                        return (
                          <button
                            key={flag}
                            onClick={() => setReviewFlag(selectedScenario.id, flag)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border ${
                              isActive
                                ? `${style.bg} ${style.text} ${style.border}`
                                : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                            }`}
                          >
                            <style.Icon className="w-4 h-4" />
                            {style.label}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      placeholder="Optional note..."
                      value={selectedScenario.reviewNote || ""}
                      onChange={(e) => setReviewNote(selectedScenario.id, e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
