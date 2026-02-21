"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2, History } from "lucide-react";
import { EvaluatorShell } from "@/components/EvaluatorShell";
import { apiFetch } from "@/lib/api";

interface RunSummary {
  id: string;
  name?: string | null;
  status: string;
  createdAt: string;
  scenarioCount: number;
  completedCount: number;
}

export default function EvaluatorPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const loadRuns = useCallback(async (autoRedirect = false) => {
    setLoadingRuns(true);
    try {
      const res = await apiFetch("/api/eval/runs");
      if (!res.ok) return;
      const data = await res.json();
      const list: RunSummary[] = data.runs || [];
      setRuns(list);
      if (autoRedirect && list.length > 0) {
        router.replace(`/runs/${list[0].id}`);
      }
    } catch (e) {
      console.error("Failed to load runs", e);
    } finally {
      setLoadingRuns(false);
    }
  }, [router]);

  useEffect(() => {
    loadRuns(true);
  }, [loadRuns]);

  const startNewRun = async () => {
    setCreating(true);
    try {
      const res = await apiFetch("/api/eval/runs", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create run");
      }
      const data = await res.json();
      if (data.runId) {
        router.push(`/runs/${data.runId}`);
      }
    } catch (error) {
      console.error("Failed to create run:", error);
      alert(error instanceof Error ? error.message : "Failed to create run");
    } finally {
      setCreating(false);
    }
  };

  return (
    <EvaluatorShell>
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-md w-full mx-auto px-6 space-y-8">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Evaluation Runs
            </h2>
            <p className="text-sm text-gray-500">
              {process.env.NEXT_PUBLIC_API_URL || "API URL not set"}
            </p>
          </div>

          <button
            onClick={startNewRun}
            disabled={creating}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {creating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Creating run...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> Start new run
              </>
            )}
          </button>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <History className="w-4 h-4" /> Past runs
              </h3>
              {loadingRuns && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
              )}
            </div>

            {runs.length === 0 && !loadingRuns ? (
              <p className="text-sm text-gray-400 text-center py-6">
                No past runs yet
              </p>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => router.push(`/runs/${run.id}`)}
                    className="w-full text-left px-4 py-3 bg-white rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800">
                        {run.name ||
                          new Date(run.createdAt).toLocaleString()}
                      </span>
                      <span className="text-xs text-gray-400">
                        {run.completedCount}/{run.scenarioCount}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                      <span className="capitalize">{run.status}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </EvaluatorShell>
  );
}
