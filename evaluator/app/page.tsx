"use client";

import { useState, useMemo, useRef } from "react";
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
} from "lucide-react";
import { loadPregeneratedScenarios } from "@/lib/scenarios";
import type { Scenario } from "@/lib/scenarios";

type ReviewFlag = "pass" | "fail" | "needs_review" | "skipped";

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

export default function EvaluatorPage() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const [scenarios, setScenarios] = useState<ScenarioState[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [globalStatus, setGlobalStatus] = useState<"idle" | "loading" | "running" | "completed">("idle");
  const [filterPersona, setFilterPersona] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterTool, setFilterTool] = useState<string>("all");
  const [filterReview, setFilterReview] = useState<string>("all");
  const cancelRef = useRef(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

  const filterOptions = useMemo(() => {
    const personas = new Set<string>();
    const categories = new Set<string>();
    const tools = new Set<string>();
    for (const s of scenarios) {
      if (s.personaId) personas.add(s.personaId);
      if (s.category) categories.add(s.category);
      for (const t of s.tools ?? []) tools.add(t);
    }
    return {
      personas: [...personas].sort(),
      categories: [...categories].sort(),
      tools: [...tools].sort(),
    };
  }, [scenarios]);

  const filteredScenarios = useMemo(() => {
    return scenarios.filter((s) => {
      if (filterPersona !== "all" && s.personaId !== filterPersona) return false;
      if (filterCategory !== "all" && s.category !== filterCategory) return false;
      if (filterTool !== "all" && !(s.tools ?? []).includes(filterTool)) return false;
      if (filterReview !== "all") {
        if (filterReview === "unreviewed") {
          if (s.reviewFlag) return false;
        } else if (s.reviewFlag !== filterReview) return false;
      }
      return true;
    });
  }, [scenarios, filterPersona, filterCategory, filterTool, filterReview]);

  const hasActiveFilters =
    filterPersona !== "all" ||
    filterCategory !== "all" ||
    filterTool !== "all" ||
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

  const loadScenarios = () => {
    setGlobalStatus("loading");
    const raw = loadPregeneratedScenarios();
    const list: ScenarioState[] = raw.map((s) => ({
      ...s,
      status: "pending" as const,
    }));
    setScenarios(list);
    setGlobalStatus("idle");
  };

  const runScenario = async (scenarioId: string) => {
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
        body: JSON.stringify({ scenarioId, apiUrl }),
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

    for (const scenario of pending) {
      if (cancelRef.current) break;
      await runScenario(scenario.id);
    }

    setGlobalStatus("completed");
  };

  const stopAll = () => {
    cancelRef.current = true;
    setGlobalStatus("idle");
  };

  const restartAll = () => {
    cancelRef.current = true;
    setScenarios([]);
    setSelectedScenarioId(null);
    setFilterPersona("all");
    setFilterCategory("all");
    setFilterTool("all");
    setFilterReview("all");
    setGlobalStatus("idle");
  };

  const setReviewFlag = (scenarioId: string, flag: ReviewFlag) => {
    const sc = scenarios.find((s) => s.id === scenarioId);
    const newFlag = sc?.reviewFlag === flag ? undefined : flag;
    setScenarios((prev) =>
      prev.map((s) => (s.id === scenarioId ? { ...s, reviewFlag: newFlag } : s))
    );
  };

  const setReviewNote = (scenarioId: string, note: string) => {
    setScenarios((prev) =>
      prev.map((s) => (s.id === scenarioId ? { ...s, reviewNote: note } : s))
    );
  };

  const exportFiltered = () => {
    const completed = filteredScenarios.filter((s) => s.status === "completed");
    if (completed.length === 0) {
      alert("No completed scenarios to export");
      return;
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      filters: { persona: filterPersona, category: filterCategory, tool: filterTool },
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
        tools: s.tools,
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
    pass: {
      bg: "bg-green-100",
      text: "text-green-700",
      border: "border-green-300",
      Icon: CheckCircle2,
      label: "Pass",
    },
    fail: {
      bg: "bg-red-100",
      text: "text-red-700",
      border: "border-red-300",
      Icon: XCircle,
      label: "Fail",
    },
    needs_review: {
      bg: "bg-yellow-100",
      text: "text-yellow-700",
      border: "border-yellow-300",
      Icon: AlertCircle,
      label: "Needs Review",
    },
    skipped: {
      bg: "bg-gray-100",
      text: "text-gray-500",
      border: "border-gray-300",
      Icon: Minus,
      label: "Skipped",
    },
  };

  const pendingInView = filteredScenarios.filter(
    (s) => s.status === "pending" || s.status === "error"
  ).length;

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
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900">Agent Evaluation</h1>
          <span className="text-sm text-gray-500">
            {process.env.NEXT_PUBLIC_API_URL || "API URL not set"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {scenarios.length === 0 ? (
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
                  <Play className="w-4 h-4" /> Load Scenarios
                </>
              )}
            </button>
          ) : (
            <button
              onClick={restartAll}
              className="flex items-center gap-2 px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          )}
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Log out
          </button>
        </div>
      </div>

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
                        setFilterPersona("all");
                        setFilterCategory("all");
                        setFilterTool("all");
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
                  value={filterTool}
                  onChange={(e) => setFilterTool(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white"
                >
                  <option value="all">All tools</option>
                  {filterOptions.tools.map((t) => (
                    <option key={t} value={t}>
                      {t}
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
                            {scenario.category?.replace(/_/g, " ") || "—"}
                          </span>
                          <span className="text-gray-300">·</span>
                          <span>{scenario.personaId?.replace(/_/g, " ").toLowerCase()}</span>
                        </div>
                        {scenario.result && (
                          <div className="mt-1 text-xs text-gray-500">
                            {(scenario.result.fulfillmentScore * 100).toFixed(0)}% ·{" "}
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
                    {selectedScenario.category?.replace(/_/g, " ") || "—"}
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
                  <div className="space-y-4">
                    {selectedScenario.conversation.map((msg, idx) => (
                      <div key={idx}>
                        <div className="text-xs font-semibold text-gray-500 uppercase mb-1">
                          {msg.role === "user" ? "User" : "Agent"}
                        </div>
                        <div
                          className={`p-4 rounded-lg text-sm ${
                            msg.role === "user"
                              ? "bg-blue-50 border border-blue-200"
                              : "bg-green-50 border border-green-200"
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))}
                  </div>
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
    </div>
  );
}
