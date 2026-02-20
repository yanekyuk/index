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
  Sparkles,
} from "lucide-react";
import { EvaluatorShell } from "@/components/EvaluatorShell";

interface ScenarioRecord {
  id: string;
  source: "predefined" | "feedback" | "generated";
  category: string;
  needId?: string | null;
  question: string;
  expectation: string;
  message: string;
  personaId?: string | null;
  feedbackText?: string | null;
  seedRequirements?: Record<string, unknown> | null;
  enabled: boolean;
}

const SOURCE_LABELS: Record<string, { label: string; className: string }> = {
  predefined: { label: "Predefined", className: "bg-blue-100 text-blue-700" },
  feedback: { label: "Feedback", className: "bg-orange-100 text-orange-700" },
  generated: { label: "Generated", className: "bg-purple-100 text-purple-700" },
};

const CATEGORY_OPTIONS = [
  "profile",
  "intent",
  "index",
  "intent_index",
  "discovery",
  "url",
  "edge_case",
  "meta",
];

function ScenarioForm({
  draft,
  onChange,
}: {
  draft: Partial<ScenarioRecord>;
  onChange: (d: Partial<ScenarioRecord>) => void;
}) {
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
            placeholder="e.g. PROFILE_CREATE"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
          <select
            value={draft.category || "profile"}
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
          value={draft.question || ""}
          onChange={(e) => onChange({ ...draft, question: e.target.value })}
          placeholder="The user question to test"
          rows={2}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Expectation</label>
        <textarea
          value={draft.expectation || ""}
          onChange={(e) => onChange({ ...draft, expectation: e.target.value })}
          placeholder="What the agent should do"
          rows={2}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
        <textarea
          value={draft.message || ""}
          onChange={(e) => onChange({ ...draft, message: e.target.value })}
          placeholder="The actual user message to send"
          rows={2}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white resize-none"
        />
      </div>

      {draft.feedbackText && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Original Feedback
          </label>
          <div className="text-sm text-gray-600 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
            {draft.feedbackText}
          </div>
        </div>
      )}

      {draft.seedRequirements && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Seed Requirements
          </label>
          <pre className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 overflow-x-auto">
            {JSON.stringify(draft.seedRequirements, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function TestCasesContent() {
  const [scenarios, setScenarios] = useState<ScenarioRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ScenarioRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<Partial<ScenarioRecord> | null>(null);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [seeding, setSeeding] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchScenarios = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCategory !== "all") params.set("category", filterCategory);
      if (filterSource !== "all") params.set("source", filterSource);
      const res = await fetch(`/api/eval/scenarios?${params}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setScenarios(data.scenarios || []);
      }
    } catch (e) {
      console.error("Failed to fetch scenarios", e);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, filterSource]);

  useEffect(() => {
    fetchScenarios();
  }, [fetchScenarios]);

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/eval/scenarios/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (res.ok) {
        await fetchScenarios();
      } else {
        alert("Failed to seed");
      }
    } catch {
      alert("Failed to seed");
    } finally {
      setSeeding(false);
    }
  };

  const generateScenarios = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/eval/scenarios/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ maxScenarios: 5 }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Generated ${data.generated} new scenarios`);
        await fetchScenarios();
      } else {
        alert("Failed to generate scenarios");
      }
    } catch {
      alert("Failed to generate scenarios");
    } finally {
      setGenerating(false);
    }
  };

  const toggleEnabled = async (scenario: ScenarioRecord) => {
    const newVal = !scenario.enabled;
    setScenarios((prev) =>
      prev.map((s) => (s.id === scenario.id ? { ...s, enabled: newVal } : s))
    );
    await fetch(`/api/eval/scenarios/${scenario.id}`, {
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
      const res = await fetch(`/api/eval/scenarios/${editDraft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          category: editDraft.category,
          question: editDraft.question,
          expectation: editDraft.expectation,
          message: editDraft.message,
          needId: editDraft.needId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setScenarios((prev) =>
          prev.map((s) => (s.id === data.scenario.id ? data.scenario : s))
        );
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

  const createScenario = async () => {
    if (!newDraft) return;
    if (!newDraft.category || !newDraft.question || !newDraft.expectation) {
      alert("Category, question, and expectation are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/eval/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...newDraft,
          message: newDraft.message || newDraft.question,
        }),
      });
      if (res.ok) {
        await fetchScenarios();
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

  const deleteScenario = async (id: string) => {
    if (!confirm("Delete this scenario?")) return;
    const res = await fetch(`/api/eval/scenarios/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setScenarios((prev) => prev.filter((s) => s.id !== id));
      if (expandedId === id) {
        setExpandedId(null);
        setEditDraft(null);
      }
    }
  };

  const grouped = scenarios.reduce<Record<string, ScenarioRecord[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-gray-900">Scenarios</h2>
            <span className="text-sm text-gray-500">
              {scenarios.length} total / {scenarios.filter((s) => s.enabled).length} enabled
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
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
            >
              <option value="all">All sources</option>
              <option value="predefined">Predefined</option>
              <option value="feedback">Feedback</option>
              <option value="generated">Generated</option>
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
              {scenarios.length === 0 ? "Seed defaults" : "Sync predefined"}
            </button>
            <button
              onClick={generateScenarios}
              disabled={generating}
              className="flex items-center gap-2 px-3 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-sm font-medium disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Generate
            </button>
            <button
              onClick={() => {
                setCreating(true);
                setNewDraft({
                  category: "profile",
                  question: "",
                  expectation: "",
                  message: "",
                  enabled: true,
                });
              }}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> Add Scenario
            </button>
          </div>
        </div>

        {loading && scenarios.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading scenarios...
          </div>
        )}

        {!loading && scenarios.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <DatabaseZap className="w-12 h-12 mx-auto mb-3 text-gray-200" />
            <p className="mb-4">No scenarios yet</p>
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
              <h3 className="text-base font-semibold">New Scenario</h3>
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
            <ScenarioForm draft={newDraft} onChange={setNewDraft} />
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
                onClick={createScenario}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Create
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
                {items.map((scenario) => {
                  const isExpanded = expandedId === scenario.id;
                  const sourceStyle = SOURCE_LABELS[scenario.source] || SOURCE_LABELS.predefined;
                  return (
                    <div
                      key={scenario.id}
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
                              setExpandedId(scenario.id);
                              setEditDraft({ ...scenario });
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
                              {scenario.needId || scenario.question.slice(0, 40)}
                            </span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${sourceStyle.className}`}>
                              {sourceStyle.label}
                            </span>
                            {scenario.personaId && (
                              <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">
                                {scenario.personaId.replace(/_/g, " ").toLowerCase()}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 truncate mt-0.5">
                            {scenario.message}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleEnabled(scenario)}
                            className={`text-xs px-2 py-1 rounded-full font-medium ${
                              scenario.enabled
                                ? "bg-green-100 text-green-700"
                                : "bg-gray-100 text-gray-400"
                            }`}
                          >
                            {scenario.enabled ? "Enabled" : "Disabled"}
                          </button>
                          <button
                            onClick={() => deleteScenario(scenario.id)}
                            className="p-1.5 text-gray-300 hover:text-red-500"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {isExpanded && editDraft && editDraft.id === scenario.id && (
                        <div className="px-4 pb-4 border-t border-gray-100 pt-4">
                          <ScenarioForm
                            draft={editDraft}
                            onChange={(d) => setEditDraft(d as ScenarioRecord)}
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
                              Save
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
