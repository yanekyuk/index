"use client";

import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Play, Square, RotateCcw, CheckCircle2, XCircle, AlertCircle, Loader2, Circle, Download } from "lucide-react";

interface Scenario {
  id: string;
  need: string;
  persona: string;
  message: string;
  status: "pending" | "running" | "completed" | "error";
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  result?: {
    verdict: "success" | "partial" | "failure" | "blocked" | "misunderstood";
    fulfillmentScore: number;
    qualityScore: number;
    reasoning: string;
    successSignals?: string[];
    failureSignals?: string[];
    turns: number;
    duration: number;
  };
}

interface SummaryMetrics {
  total: number;
  completed: number;
  success: number;
  partial: number;
  failure: number;
  blocked: number;
  avgFulfillmentScore: number;
  avgQualityScore: number;
}

export default function EvalDashboardPage() {
  const { getAccessToken } = usePrivy();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<SummaryMetrics>({
    total: 0,
    completed: 0,
    success: 0,
    partial: 0,
    failure: 0,
    blocked: 0,
    avgFulfillmentScore: 0,
    avgQualityScore: 0,
  });
  const [globalStatus, setGlobalStatus] = useState<"idle" | "loading" | "running" | "completed">("idle");

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId);

  // Connect to SSE
  useEffect(() => {
    let es: EventSource | null = null;

    const connectSSE = async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";
        es = new EventSource(`${apiUrl}/eval/stream?token=${token}`);

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            handleEvent(data);
          } catch (error) {
            console.error("Failed to parse SSE event:", error);
          }
        };

        es.onerror = (error) => {
          console.error("SSE error:", error);
        };
      } catch (error) {
        console.error("Failed to connect:", error);
      }
    };

    connectSSE();

    return () => {
      if (es) es.close();
    };
  }, [getAccessToken]);

  const handleEvent = (event: any) => {
    console.log('[eval] Event received:', event.type, event.data);
    
    switch (event.type) {
      case "scenarios_generated":
        const generatedScenarios: Scenario[] = (event.data.scenarios || []).map((s: any) => ({
          id: s.id,
          need: s.need,
          persona: s.persona,
          message: s.message,
          status: "pending",
        }));
        setScenarios(generatedScenarios);
        setMetrics((prev) => ({ ...prev, total: generatedScenarios.length }));
        setGlobalStatus("idle");
        break;

      case "suite_started":
        setGlobalStatus("running");
        break;

      case "scenario_started":
        console.log('[eval] Starting scenario:', event.data.scenarioId);
        setScenarios((prev) =>
          prev.map((s) =>
            s.id === event.data.scenarioId
              ? { ...s, status: "running", conversation: [{ role: "user", content: event.data.initialMessage }] }
              : s
          )
        );
        break;

      case "turn_completed":
        console.log('[eval] Turn completed:', {
          scenarioId: event.data.scenarioId,
          agentResponse: event.data.agentResponse?.substring(0, 50),
        });
        
        setScenarios((prev) =>
          prev.map((s) => {
            if (s.id === event.data.scenarioId) {
              const newConversation = [...(s.conversation || [])];
              // Add agent response if not already there
              if (!newConversation.find((m) => m.role === "assistant" && m.content === event.data.agentResponse)) {
                newConversation.push({ role: "assistant", content: event.data.agentResponse });
              }
              // Add user message if exists
              if (event.data.userMessage && event.data.turnNumber > 1) {
                newConversation.push({ role: "user", content: event.data.userMessage });
              }
              console.log('[eval] Updated conversation:', newConversation.length, 'messages');
              return { ...s, conversation: newConversation };
            }
            return s;
          })
        );
        break;

      case "scenario_completed":
        console.log('[eval] Scenario completed:', {
          scenarioId: event.data.scenarioId,
          verdict: event.data.verdict,
          conversationLength: event.data.conversation?.length,
        });
        
        setScenarios((prev) => {
          const updated = prev.map((s) =>
            s.id === event.data.scenarioId
              ? {
                  ...s,
                  status: "completed" as const,
                  conversation: event.data.conversation || s.conversation || [],  // Use full conversation from completed event
                  result: {
                    verdict: event.data.verdict,
                    fulfillmentScore: event.data.fulfillmentScore,
                    qualityScore: event.data.qualityScore,
                    reasoning: event.data.reasoning,
                    successSignals: event.data.successSignals,
                    failureSignals: event.data.failureSignals,
                    turns: event.data.turns,
                    duration: event.data.duration,
                  },
                }
              : s
          );

          // Update metrics based on the actual completed scenarios (avoid race conditions in parallel execution)
          const allCompleted = updated.filter((s) => s.status === "completed");
          const completedCount = allCompleted.length;
          
          const successCount = allCompleted.filter((s) => s.result?.verdict === "success").length;
          const partialCount = allCompleted.filter((s) => s.result?.verdict === "partial").length;
          const failureCount = allCompleted.filter((s) => s.result?.verdict === "failure").length;
          const blockedCount = allCompleted.filter((s) => s.result?.verdict === "blocked").length;
          
          const avgFulfillment = completedCount > 0
            ? allCompleted.reduce((sum, s) => sum + (s.result?.fulfillmentScore || 0), 0) / completedCount
            : 0;
          const avgQuality = completedCount > 0
            ? allCompleted.reduce((sum, s) => sum + (s.result?.qualityScore || 0), 0) / completedCount
            : 0;

          setMetrics((prevMetrics) => ({
            ...prevMetrics,
            completed: completedCount,
            success: successCount,
            partial: partialCount,
            failure: failureCount,
            blocked: blockedCount,
            avgFulfillmentScore: avgFulfillment,
            avgQualityScore: avgQuality,
          }));

          return updated;
        });
        break;

      case "suite_completed":
        setGlobalStatus("completed");
        break;
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

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api"}/eval/generate-scenarios`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) throw new Error("Failed to load scenarios");

      const data = await response.json();
      const loadedScenarios: Scenario[] = (data.scenarios || []).map((s: any) => ({
        id: s.id,
        need: s.needId,
        persona: s.personaId,
        message: s.message,
        status: "pending",
      }));

      setScenarios(loadedScenarios);
      setMetrics({ ...metrics, total: loadedScenarios.length });
      setGlobalStatus("idle");
    } catch (error) {
      console.error("Failed to load scenarios:", error);
      alert("Failed to load scenarios");
      setGlobalStatus("idle");
    }
  };

  const runScenario = async (scenarioId: string) => {
    try {
      const token = await getAccessToken();
      if (!token) {
        alert("Please log in");
        return;
      }

      // Mark as running
      setScenarios((prev) =>
        prev.map((s) => (s.id === scenarioId ? { ...s, status: "running", conversation: [] } : s))
      );

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api"}/eval/run-scenario`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ scenarioId }),
        }
      );

      if (!response.ok) throw new Error("Failed to run scenario");
    } catch (error) {
      console.error("Failed to run scenario:", error);
      setScenarios((prev) => prev.map((s) => (s.id === scenarioId ? { ...s, status: "error" } : s)));
    }
  };

  const runAll = async () => {
    try {
      const token = await getAccessToken();
      if (!token) {
        alert("Please log in");
        return;
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api"}/eval/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ scenarioCount: scenarios.length, maxTurns: 3 }),
      });

      if (!response.ok) throw new Error("Failed to start");
      setGlobalStatus("running");
    } catch (error) {
      console.error("Failed to start:", error);
      alert("Failed to start evaluation");
    }
  };

  const stopAll = async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;

      await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api"}/eval/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      setGlobalStatus("idle");
    } catch (error) {
      console.error("Failed to stop:", error);
    }
  };

  const restartAll = () => {
    setScenarios([]);
    setMetrics({
      total: 0,
      completed: 0,
      success: 0,
      partial: 0,
      failure: 0,
      blocked: 0,
      avgFulfillmentScore: 0,
      avgQualityScore: 0,
    });
    setSelectedScenarioId(null);
    setGlobalStatus("idle");
  };

  const exportConversations = () => {
    const completedScenarios = scenarios.filter((s) => s.status === "completed");
    
    if (completedScenarios.length === 0) {
      alert("No completed scenarios to export");
      return;
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      summary: {
        total: metrics.total,
        completed: metrics.completed,
        success: metrics.success,
        partial: metrics.partial,
        failure: metrics.failure,
        blocked: metrics.blocked,
        avgFulfillmentScore: metrics.avgFulfillmentScore,
        avgQualityScore: metrics.avgQualityScore,
        successRate: metrics.completed > 0 ? (metrics.success / metrics.completed) * 100 : 0,
      },
      scenarios: completedScenarios.map((s) => ({
        id: s.id,
        need: s.need,
        persona: s.persona,
        initialMessage: s.message,
        conversation: s.conversation,
        result: s.result,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
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

  const getVerdictBadge = (verdict: string) => {
    const styles: Record<string, { bg: string; text: string; icon: any }> = {
      success: { bg: "bg-green-100", text: "text-green-800", icon: CheckCircle2 },
      partial: { bg: "bg-yellow-100", text: "text-yellow-800", icon: AlertCircle },
      failure: { bg: "bg-red-100", text: "text-red-800", icon: XCircle },
      blocked: { bg: "bg-gray-100", text: "text-gray-800", icon: Square },
      misunderstood: { bg: "bg-purple-100", text: "text-purple-800", icon: AlertCircle },
    };

    const style = styles[verdict] || styles.failure;
    const Icon = style.icon;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${style.bg} ${style.text}`}>
        <Icon className="w-3 h-3" />
        {verdict}
      </span>
    );
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Top Controls and Summary */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Agent Evaluation Dashboard</h1>

          <div className="flex items-center gap-3">
            {scenarios.length === 0 && (
              <button
                onClick={loadScenarios}
                disabled={globalStatus === "loading"}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {globalStatus === "loading" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Load Scenarios
                  </>
                )}
              </button>
            )}

            {scenarios.length > 0 && (
              <>
                <button
                  onClick={runAll}
                  disabled={globalStatus === "running"}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
                >
                  <Play className="w-4 h-4" />
                  Run All
                </button>
                <button
                  onClick={stopAll}
                  disabled={globalStatus !== "running"}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
                >
                  <Square className="w-4 h-4" />
                  Stop All
                </button>
                <button
                  onClick={exportConversations}
                  disabled={scenarios.filter((s) => s.status === "completed").length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium"
                  title="Export all completed conversations as JSON"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
                <button
                  onClick={restartAll}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm font-medium"
                >
                  <RotateCcw className="w-4 h-4" />
                  Restart All
                </button>
              </>
            )}
          </div>
        </div>

        {/* Summary Metrics */}
        {scenarios.length > 0 && (
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-600">Total:</span>
              <span className="font-semibold text-gray-900">{metrics.total}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-600">Completed:</span>
              <span className="font-semibold text-gray-900">
                {metrics.completed}/{metrics.total}
              </span>
            </div>
            <div className="h-4 w-px bg-gray-300" />
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="font-semibold text-green-600">{metrics.success}</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              <span className="font-semibold text-yellow-600">{metrics.partial}</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-600" />
              <span className="font-semibold text-red-600">{metrics.failure}</span>
            </div>
            <div className="flex items-center gap-2">
              <Square className="w-4 h-4 text-gray-600" />
              <span className="font-semibold text-gray-600">{metrics.blocked}</span>
            </div>
            {metrics.completed > 0 && (
              <>
                <div className="h-4 w-px bg-gray-300" />
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">Success Rate:</span>
                  <span className="font-semibold text-gray-900">
                    {((metrics.success / metrics.completed) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">Avg Score:</span>
                  <span className="font-semibold text-gray-900">
                    {(metrics.avgFulfillmentScore * 100).toFixed(1)}%
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Scenarios List */}
        <div className="w-80 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Scenarios ({scenarios.length})</h2>
          </div>

          {scenarios.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p className="text-sm">Load scenarios to begin</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {scenarios.map((scenario, idx) => (
                <div
                  key={scenario.id}
                  className={`flex items-start gap-2 hover:bg-gray-50 transition-colors ${
                    selectedScenarioId === scenario.id ? "bg-blue-50 border-l-4 border-l-blue-600" : ""
                  }`}
                >
                  <button
                    onClick={() => setSelectedScenarioId(scenario.id)}
                    className="flex-1 text-left p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-1">{getStatusIcon(scenario.status)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-gray-900">#{idx + 1}</span>
                          {scenario.result && (
                            <span className="text-xs">{getVerdictBadge(scenario.result.verdict)}</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 line-clamp-2 mb-1">{scenario.message}</p>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>{scenario.need}</span>
                          <span>•</span>
                          <span>{scenario.persona}</span>
                        </div>
                        {scenario.result && (
                          <div className="mt-1 text-xs text-gray-600">
                            Score: {(scenario.result.fulfillmentScore * 100).toFixed(0)}% • {scenario.result.turns}{" "}
                            turns
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                  {scenario.status === "pending" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        runScenario(scenario.id);
                      }}
                      className="mt-3 mr-3 p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Run this scenario"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Content - Selected Scenario Details */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedScenario ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <Circle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-lg">Select a scenario to view details</p>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Scenario Header */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Scenario Details</h2>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded font-medium">
                        {selectedScenario.need}
                      </span>
                      <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded font-medium">
                        {selectedScenario.persona}
                      </span>
                      <span className="flex items-center gap-1">
                        {getStatusIcon(selectedScenario.status)}
                        <span className="text-gray-600 capitalize">{selectedScenario.status}</span>
                      </span>
                    </div>
                  </div>
                  {selectedScenario.result && (
                    <div className="text-right">
                      {getVerdictBadge(selectedScenario.result.verdict)}
                      <div className="mt-2 text-sm text-gray-600">
                        Score: {(selectedScenario.result.fulfillmentScore * 100).toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>

                {/* Initial Message */}
                <div>
                  <div className="text-xs font-semibold text-gray-600 uppercase mb-2">Initial Query</div>
                  <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-900">{selectedScenario.message}</div>
                </div>
              </div>

              {/* Conversation */}
              {selectedScenario.conversation && selectedScenario.conversation.length > 0 ? (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Conversation ({selectedScenario.conversation.length} messages)
                  </h3>
                  <div className="space-y-4">
                    {selectedScenario.conversation.map((msg, idx) => (
                      <div key={idx}>
                        <div className="text-xs font-semibold text-gray-600 uppercase mb-2">
                          {msg.role === "user" ? "USER" : "AGENT"}
                        </div>
                        <div
                          className={`p-4 rounded-lg ${
                            msg.role === "user"
                              ? "bg-blue-50 border border-blue-200 text-gray-900"
                              : "bg-green-50 border border-green-200 text-gray-900"
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Conversation</h3>
                  <div className="text-gray-500 text-center py-8">
                    {selectedScenario.status === "running" 
                      ? "Waiting for agent responses..." 
                      : "No conversation data available"}
                  </div>
                  <div className="text-xs text-gray-400 mt-2">
                    Debug: conversation={JSON.stringify(selectedScenario.conversation?.length || 0)}
                  </div>
                </div>
              )}

              {/* Evaluation Results */}
              {selectedScenario.result && (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Evaluation Results</h3>

                  <div className="space-y-4">
                    {/* Scores */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-600 mb-1">Fulfillment</div>
                        <div className="text-2xl font-bold text-gray-900">
                          {(selectedScenario.result.fulfillmentScore * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-600 mb-1">Quality</div>
                        <div className="text-2xl font-bold text-gray-900">
                          {(selectedScenario.result.qualityScore * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-600 mb-1">Duration</div>
                        <div className="text-2xl font-bold text-gray-900">
                          {(selectedScenario.result.duration / 1000).toFixed(1)}s
                        </div>
                      </div>
                    </div>

                    {/* Reasoning */}
                    <div>
                      <div className="text-sm font-semibold text-gray-900 mb-2">Reasoning</div>
                      <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-700 leading-relaxed">
                        {selectedScenario.result.reasoning}
                      </div>
                    </div>

                    {/* Signals Grid */}
                    <div className="grid grid-cols-2 gap-4">
                      {selectedScenario.result.successSignals && selectedScenario.result.successSignals.length > 0 && (
                        <div>
                          <div className="text-sm font-semibold text-green-900 mb-2">✓ Success Signals</div>
                          <div className="space-y-2">
                            {selectedScenario.result.successSignals.map((signal, idx) => (
                              <div key={idx} className="text-xs text-green-700 bg-green-50 p-2 rounded border border-green-200">
                                {signal}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedScenario.result.failureSignals && selectedScenario.result.failureSignals.length > 0 && (
                        <div>
                          <div className="text-sm font-semibold text-red-900 mb-2">✗ Failure Signals</div>
                          <div className="space-y-2">
                            {selectedScenario.result.failureSignals.map((signal, idx) => (
                              <div key={idx} className="text-xs text-red-700 bg-red-50 p-2 rounded border border-red-200">
                                {signal}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
