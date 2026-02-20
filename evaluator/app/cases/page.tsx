"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  DatabaseZap,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { EvaluatorShell } from "@/components/EvaluatorShell";

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
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Need ID</label>
          <input
            type="text"
            value={draft.needId ?? ""}
            onChange={(e) =>
              onChange({ ...draft, needId: e.target.value.toUpperCase().replace(/\s+/g, "_") })
            }
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
                  {draft.messages[pid] || (
                    <span className="text-gray-300 italic">Not generated</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TestCasesContent() {
  const [needs, setNeeds] = useState<NeedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<NeedRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<Omit<NeedRecord, "id"> | null>(null);
  const [filterCategory, setFilterCategory] = useState("all");
  const [seeding, setSeeding] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchNeeds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/eval/needs", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setNeeds(data.needs || []);
      }
    } catch (e) {
      console.error("Failed to fetch needs", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNeeds();
  }, [fetchNeeds]);

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/eval/needs/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
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
    const newVal = !need.enabled;
    setNeeds((prev) => prev.map((n) => (n.id === need.id ? { ...n, enabled: newVal } : n)));
    await fetch(`/api/eval/needs/${need.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ enabled: newVal }),
    });
  };

  const saveEdit = async () => {
    if (!editDraft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/eval/needs/${editDraft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
      const res = await fetch("/api/eval/needs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
    const res = await fetch(`/api/eval/needs/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setNeeds((prev) => prev.filter((n) => n.id !== id));
      if (expandedId === id) {
        setExpandedId(null);
        setEditDraft(null);
      }
    }
  };

  const filtered =
    filterCategory === "all" ? needs : needs.filter((n) => n.category === filterCategory);
  const grouped = filtered.reduce<Record<string, NeedRecord[]>>((acc, n) => {
    (acc[n.category] ??= []).push(n);
    return acc;
  }, {});

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
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
              {seeding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <DatabaseZap className="w-4 h-4" />
              )}
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

        {loading && needs.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading test cases...
          </div>
        )}

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

        {creating && newDraft && (
          <div className="bg-white rounded-lg shadow-sm border border-blue-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">New Test Case</h3>
              <button
                onClick={() => {
                  setCreating(false);
                  setNewDraft(null);
                }}
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
                onClick={() => {
                  setCreating(false);
                  setNewDraft(null);
                }}
                className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={createNeed}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {saving ? "Generating messages..." : "Create"}
              </button>
            </div>
          </div>
        )}

        {Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([cat, items]) => (
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
                      className={`bg-white rounded-lg shadow-sm border ${
                        isExpanded ? "border-blue-200" : "border-gray-100"
                      }`}
                    >
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
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              {need.needId}
                            </span>
                            <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">
                              {need.category.replace(/_/g, " ")}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 truncate mt-0.5">
                            {need.question}
                          </p>
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

                      {isExpanded && editDraft && editDraft.id === need.id && (
                        <div className="px-4 pb-4 border-t border-gray-100 pt-4">
                          <NeedForm
                            draft={editDraft as Omit<NeedRecord, "id"> & { id?: string }}
                            onChange={(d) => setEditDraft(d as NeedRecord)}
                            needIdEditable={false}
                          />
                          <div className="flex justify-end gap-2 mt-4">
                            <button
                              onClick={() => {
                                setExpandedId(null);
                                setEditDraft(null);
                              }}
                              className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={saveEdit}
                              disabled={saving}
                              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
                            >
                              {saving ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
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

export default function CasesPage() {
  return (
    <EvaluatorShell>
      <TestCasesContent />
    </EvaluatorShell>
  );
}
