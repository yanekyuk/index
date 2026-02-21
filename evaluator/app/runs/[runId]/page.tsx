"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
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
  ChevronDown,
  ChevronRight,
  Database,
} from "lucide-react";
import type { GeneratedSeedData } from "@/lib/seed/seed.types";
import { EvaluatorShell } from "@/components/EvaluatorShell";
import { ConversationView } from "@/components/ConversationView";
import { apiFetch } from "@/lib/api";

type ReviewFlag = "pass" | "fail" | "needs_review" | "skipped";

interface ScenarioState {
  id: string;
  scenarioId: string;
  resultId?: string;
  needId?: string;
  personaId?: string;
  message: string;
  category: string;
  source?: string;
  question?: string;
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
  seedData?: GeneratedSeedData | null;
}

function SeedDataPanel({ seedData }: { seedData: GeneratedSeedData }) {
  const [open, setOpen] = useState(false);
  const { testUser, intents, indexes, otherUsers, opportunities } = seedData;

  return (
    <div className="bg-white rounded-lg shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 p-4 text-left hover:bg-gray-50 rounded-lg"
      >
        <Database className="w-4 h-4 text-gray-500" />
        <span className="text-base font-semibold flex-1">Seed Data</span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {open && (
        <div className="px-6 pb-6 space-y-4">
          {testUser?.profile && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Test User</div>
              <div className="p-3 bg-gray-50 rounded-lg text-sm space-y-1">
                <div><span className="font-medium">Name:</span> {testUser.profile.identity?.name}</div>
                <div><span className="font-medium">Email:</span> {testUser.email}</div>
                {testUser.profile.identity?.bio && (
                  <div><span className="font-medium">Bio:</span> {testUser.profile.identity.bio}</div>
                )}
                {testUser.profile.identity?.location && (
                  <div><span className="font-medium">Location:</span> {testUser.profile.identity.location}</div>
                )}
                {testUser.profile.attributes?.skills?.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="font-medium">Skills:</span>
                    {testUser.profile.attributes.skills.map((s: string) => (
                      <span key={s} className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{s}</span>
                    ))}
                  </div>
                )}
                {testUser.profile.attributes?.interests?.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="font-medium">Interests:</span>
                    {testUser.profile.attributes.interests.map((i: string) => (
                      <span key={i} className="px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded text-xs">{i}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {intents.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Intents ({intents.length})</div>
              <div className="space-y-1">
                {intents.map((intent, i) => (
                  <div key={i} className="p-2 bg-gray-50 rounded text-sm">{intent}</div>
                ))}
              </div>
            </div>
          )}

          {indexes.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Indexes ({indexes.length})</div>
              <div className="space-y-1">
                {indexes.map((idx, i) => (
                  <div key={i} className="p-2 bg-gray-50 rounded text-sm">
                    <span className="font-medium">{idx.title}</span>
                    {idx.prompt && <span className="text-gray-500"> — {idx.prompt}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {otherUsers && otherUsers.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Network Users ({otherUsers.length})</div>
              <div className="space-y-2">
                {otherUsers.map((u, i) => (
                  <div key={i} className="p-3 bg-gray-50 rounded-lg text-sm space-y-1">
                    <div className="font-medium">{u.name} <span className="text-gray-400 font-normal text-xs">{u.email}</span></div>
                    {u.profile?.identity?.bio && <div className="text-gray-600 text-xs">{u.profile.identity.bio}</div>}
                    {u.intents.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap text-xs">
                        {u.intents.map((intent, j) => (
                          <span key={j} className="px-1.5 py-0.5 bg-green-100 text-green-800 rounded">{intent}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {opportunities && opportunities.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Opportunities ({opportunities.length})</div>
              <div className="space-y-1">
                {opportunities.map((opp, i) => (
                  <div key={i} className="p-2 bg-gray-50 rounded text-sm flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-xs">{opp.status}</span>
                    <span>{opp.category}</span>
                    <span className="text-gray-400 text-xs">({Math.round(opp.confidence * 100)}%)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const router = useRouter();

  const [scenarios, setScenarios] = useState<ScenarioState[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [globalStatus, setGlobalStatus] = useState<"idle" | "loading" | "running" | "completed">("loading");
  const [filterPersona, setFilterPersona] = useState<string>("DIRECT_REQUESTER");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterReview, setFilterReview] = useState<string>("all");
  const cancelRef = useRef(false);
  const noteDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/eval/runs/${runId}`);
        if (!res.ok) throw new Error("Failed to load run");
        const data = await res.json();
        if (cancelled) return;
        const list: ScenarioState[] = (data.scenarios || []).map(
          (s: Record<string, unknown>) => ({
            id: String(s.id ?? s.scenarioId),
            scenarioId: String(s.scenarioId ?? s.id),
            resultId: s.resultId ? String(s.resultId) : undefined,
            needId: s.needId ? String(s.needId) : undefined,
            personaId: s.personaId ? String(s.personaId) : undefined,
            message: String(s.message ?? ""),
            category: String(s.category ?? ""),
            source: s.source ? String(s.source) : undefined,
            question: s.question ? String(s.question) : undefined,
            status: (s.status as ScenarioState["status"]) ?? "pending",
            conversation: s.conversation as ScenarioState["conversation"],
            result: s.result as ScenarioState["result"],
            reviewFlag: s.reviewFlag as ScenarioState["reviewFlag"],
            reviewNote: s.reviewNote as string | undefined,
            seedData: (s.seedData as GeneratedSeedData) ?? null,
          })
        );
        setScenarios(list);
        setGlobalStatus("idle");
      } catch (e) {
        console.error("Failed to load run", e);
        if (!cancelled) {
          alert("Failed to load run");
          router.push("/");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, router]);

  const saveReview = useCallback(
    async (
      id: string,
      payload: { reviewFlag?: ReviewFlag | null; reviewNote?: string | null }
    ) => {
      await apiFetch(`/api/eval/runs/${runId}/scenarios/${id}`, {
        method: "PATCH",
        json: payload,
      });
    },
    [runId]
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
      if (filterSource !== "all" && s.source !== filterSource) return false;
      if (filterReview !== "all") {
        if (filterReview === "unreviewed") {
          if (s.reviewFlag) return false;
        } else if (s.reviewFlag !== filterReview) return false;
      }
      return true;
    });
  }, [scenarios, filterPersona, filterCategory, filterSource, filterReview]);

  const hasActiveFilters =
    filterPersona !== "all" ||
    filterCategory !== "all" ||
    filterSource !== "all" ||
    filterReview !== "all";

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId);

  const metrics = useMemo(() => {
    const set = filteredScenarios;
    const completed = set.filter((s) => s.status === "completed");
    const total = set.length;
    const completedCount = completed.length;
    const success = completed.filter(
      (s) => s.result?.verdict === "success"
    ).length;
    const partial = completed.filter(
      (s) => s.result?.verdict === "partial"
    ).length;
    const failure = completed.filter(
      (s) => s.result?.verdict === "failure"
    ).length;
    const blocked = completed.filter(
      (s) => s.result?.verdict === "blocked"
    ).length;
    const avgFulfillment =
      completedCount > 0
        ? completed.reduce(
            (sum, s) => sum + (s.result?.fulfillmentScore || 0),
            0
          ) / completedCount
        : 0;
    const avgQuality =
      completedCount > 0
        ? completed.reduce(
            (sum, s) => sum + (s.result?.qualityScore || 0),
            0
          ) / completedCount
        : 0;
    const reviewed = completed.filter((s) => s.reviewFlag).length;
    const reviewPass = completed.filter(
      (s) => s.reviewFlag === "pass"
    ).length;
    const reviewFail = completed.filter(
      (s) => s.reviewFlag === "fail"
    ).length;
    const reviewNeedsReview = completed.filter(
      (s) => s.reviewFlag === "needs_review"
    ).length;
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

  const runScenario = async (scenarioId: string) => {
    setScenarios((prev) =>
      prev.map((s) =>
        s.id === scenarioId || s.scenarioId === scenarioId
          ? { ...s, status: "running", conversation: [] }
          : s
      )
    );

    const actualScenarioId = scenarios.find(
      (s) => s.id === scenarioId || s.scenarioId === scenarioId
    )?.scenarioId ?? scenarioId;

    try {
      const res = await apiFetch("/api/eval/run", {
        method: "POST",
        json: {
          runId,
          scenarioId: actualScenarioId,
          apiUrl,
          useSeeding: true,
        },
      });
      const data = await res.json();
      const result = data.results?.[0];

      const matchId = (s: ScenarioState) =>
        s.id === scenarioId || s.scenarioId === scenarioId || s.scenarioId === actualScenarioId;

      if (result?.error) {
        setScenarios((prev) =>
          prev.map((s) =>
            matchId(s) ? { ...s, status: "error" } : s
          )
        );
        return;
      }

      setScenarios((prev) =>
        prev.map((s) =>
          matchId(s)
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
        prev.map((s) =>
          (s.id === scenarioId || s.scenarioId === scenarioId)
            ? { ...s, status: "error" }
            : s
        )
      );
    }
  };

  const runFiltered = async () => {
    const pending = filteredScenarios.filter(
      (s) => s.status === "pending" || s.status === "error"
    );
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

  const setReviewFlag = (scenarioId: string, flag: ReviewFlag) => {
    const sc = scenarios.find((s) => s.id === scenarioId);
    const newFlag = sc?.reviewFlag === flag ? undefined : flag;
    setScenarios((prev) =>
      prev.map((s) =>
        s.id === scenarioId ? { ...s, reviewFlag: newFlag } : s
      )
    );
    saveReview(scenarioId, {
      reviewFlag: newFlag ?? null,
      reviewNote: sc?.reviewNote ?? null,
    });
  };

  const setReviewNote = (scenarioId: string, note: string) => {
    setScenarios((prev) =>
      prev.map((s) =>
        s.id === scenarioId ? { ...s, reviewNote: note } : s
      )
    );
    if (noteDebounceRef.current[scenarioId])
      clearTimeout(noteDebounceRef.current[scenarioId]);
    noteDebounceRef.current[scenarioId] = setTimeout(() => {
      saveReview(scenarioId, { reviewNote: note });
      delete noteDebounceRef.current[scenarioId];
    }, 500);
  };

  const exportFiltered = () => {
    const completed = filteredScenarios.filter(
      (s) => s.status === "completed"
    );
    if (completed.length === 0) {
      alert("No completed scenarios to export");
      return;
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      filters: {
        persona: filterPersona,
        category: filterCategory,
        source: filterSource,
      },
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
          metrics.completed > 0
            ? (metrics.success / metrics.completed) * 100
            : 0,
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

  const verdictStyles: Record<
    string,
    { bg: string; text: string; Icon: typeof CheckCircle2 }
  > = {
    success: {
      bg: "bg-green-100",
      text: "text-green-800",
      Icon: CheckCircle2,
    },
    partial: {
      bg: "bg-yellow-100",
      text: "text-yellow-800",
      Icon: AlertCircle,
    },
    failure: { bg: "bg-red-100", text: "text-red-800", Icon: XCircle },
    blocked: { bg: "bg-gray-100", text: "text-gray-800", Icon: Square },
  };

  const reviewFlagStyles: Record<
    ReviewFlag,
    {
      bg: string;
      text: string;
      border: string;
      Icon: typeof CheckCircle2;
      label: string;
    }
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

  const headerExtra = (
    <button
      onClick={() => router.push("/")}
      className="flex items-center gap-2 px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
    >
      <RotateCcw className="w-4 h-4" />
      Reset
    </button>
  );

  if (globalStatus === "loading") {
    return (
      <EvaluatorShell headerExtra={headerExtra}>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </EvaluatorShell>
    );
  }

  return (
    <EvaluatorShell headerExtra={headerExtra}>
      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
          {scenarios.length > 0 && (
            <>
              <div className="p-3 border-b border-gray-200 flex-shrink-0 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase">
                    Filters
                  </span>
                  {hasActiveFilters && (
                    <button
                      onClick={() => {
                        setFilterPersona("DIRECT_REQUESTER");
                        setFilterCategory("all");
                        setFilterSource("all");
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
                <select
                  value={filterSource}
                  onChange={(e) => setFilterSource(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white"
                >
                  <option value="all">All sources</option>
                  <option value="predefined">Predefined</option>
                  <option value="feedback">Feedback</option>
                  <option value="generated">Generated</option>
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
                      Run{" "}
                      {hasActiveFilters
                        ? `${pendingInView} filtered`
                        : `all ${pendingInView}`}
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
                      <span className="text-green-600 font-medium">
                        {metrics.success} pass
                      </span>
                      {metrics.partial > 0 && (
                        <span className="text-yellow-600 font-medium">
                          {metrics.partial} partial
                        </span>
                      )}
                      {metrics.failure > 0 && (
                        <span className="text-red-600 font-medium">
                          {metrics.failure} fail
                        </span>
                      )}
                      {metrics.blocked > 0 && (
                        <span className="text-gray-500 font-medium">
                          {metrics.blocked} blocked
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {scenarios.length === 0 ? (
            <div className="p-8 text-center text-gray-500 flex-1 flex items-center justify-center">
              <p className="text-sm">No scenarios in this run</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 overflow-y-auto flex-1">
              {filteredScenarios.map((scenario, idx) => (
                <div
                  key={scenario.id}
                  className={`flex items-start gap-2 hover:bg-gray-50 ${
                    selectedScenarioId === scenario.id
                      ? "bg-blue-50 border-l-4 border-l-blue-600"
                      : ""
                  }`}
                >
                  <button
                    onClick={() => setSelectedScenarioId(scenario.id)}
                    className="flex-1 text-left px-4 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {getStatusIcon(scenario.status)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-medium text-gray-400">
                            #{idx + 1}
                          </span>
                          <div className="flex items-center gap-1">
                            {scenario.reviewFlag && (
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                                  reviewFlagStyles[scenario.reviewFlag].bg
                                } ${
                                  reviewFlagStyles[scenario.reviewFlag].text
                                }`}
                              >
                                {reviewFlagStyles[scenario.reviewFlag].label}
                              </span>
                            )}
                            {scenario.result && (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                                  verdictStyles[scenario.result.verdict]?.bg ??
                                  "bg-gray-100"
                                } ${
                                  verdictStyles[scenario.result.verdict]
                                    ?.text ?? "text-gray-800"
                                }`}
                              >
                                {scenario.result.verdict}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-800 line-clamp-2 mb-1">
                          {scenario.message}
                        </p>
                        <div className="flex items-center gap-1 flex-wrap text-xs text-gray-500">
                          <span className="px-1.5 py-0.5 bg-gray-100 rounded">
                            {scenario.category?.replace(/_/g, " ") || "\u2014"}
                          </span>
                          <span className="text-gray-300">{"\u00b7"}</span>
                          <span>
                            {scenario.personaId
                              ?.replace(/_/g, " ")
                              .toLowerCase()}
                          </span>
                        </div>
                        {scenario.result && (
                          <div className="mt-1 text-xs text-gray-500">
                            {(
                              scenario.result.fulfillmentScore * 100
                            ).toFixed(0)}
                            % {"\u00b7"} {scenario.result.turns} turns
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                  {(scenario.status === "pending" ||
                    scenario.status === "error") &&
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
                <h2 className="text-lg font-bold text-gray-900 mb-4">
                  Scenario Details
                </h2>
                <div className="flex items-center gap-2 flex-wrap text-sm mb-4">
                  <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                    {selectedScenario.category?.replace(/_/g, " ") ||
                      "\u2014"}
                  </span>
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                    {selectedScenario.needId}
                  </span>
                  <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs">
                    {selectedScenario.personaId
                      ?.replace(/_/g, " ")
                      .toLowerCase()}
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

              {selectedScenario.seedData && (
                <SeedDataPanel seedData={selectedScenario.seedData} />
              )}

              {selectedScenario.conversation &&
                selectedScenario.conversation.length > 0 && (
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <h3 className="text-base font-semibold mb-4">
                      Conversation (
                      {selectedScenario.conversation.length} messages)
                    </h3>
                    <ConversationView
                      messages={selectedScenario.conversation}
                    />
                  </div>
                )}

              {selectedScenario.result && (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h3 className="text-base font-semibold mb-4">
                    Evaluation Results
                  </h3>
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-500 mb-1">
                          Fulfillment
                        </div>
                        <div className="text-2xl font-bold">
                          {(
                            selectedScenario.result.fulfillmentScore * 100
                          ).toFixed(0)}
                          %
                        </div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-500 mb-1">
                          Quality
                        </div>
                        <div className="text-2xl font-bold">
                          {(
                            selectedScenario.result.qualityScore * 100
                          ).toFixed(0)}
                          %
                        </div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-500 mb-1">
                          Duration
                        </div>
                        <div className="text-2xl font-bold">
                          {(
                            selectedScenario.result.duration / 1000
                          ).toFixed(1)}
                          s
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold mb-2">
                        Reasoning
                      </div>
                      <div className="p-4 bg-gray-50 rounded-lg text-sm">
                        {selectedScenario.result.reasoning}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {selectedScenario.status === "completed" && (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h3 className="text-base font-semibold mb-4">
                    Reviewer Assessment
                  </h3>
                  <div className="flex items-center gap-2 mb-4">
                    {(Object.keys(reviewFlagStyles) as ReviewFlag[]).map(
                      (flag) => {
                        const style = reviewFlagStyles[flag];
                        const isActive =
                          selectedScenario.reviewFlag === flag;
                        return (
                          <button
                            key={flag}
                            onClick={() =>
                              setReviewFlag(selectedScenario.id, flag)
                            }
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
                      }
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="Optional note..."
                    value={selectedScenario.reviewNote || ""}
                    onChange={(e) =>
                      setReviewNote(selectedScenario.id, e.target.value)
                    }
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </EvaluatorShell>
  );
}
