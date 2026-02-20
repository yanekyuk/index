import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { evalRuns, evalRunResults, evalScenarios } from "@/lib/db/schema";
import {
  dbScenarioToGenerated,
  runChatEvaluation,
  runSeededEvaluation,
} from "@/lib/evaluator";
import { eq, and, inArray } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const auth = req.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  let body: {
    scenarioId?: string;
    scenarioIds?: string[];
    runId?: string;
    apiUrl?: string;
    useSeeding?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apiUrl =
    body.apiUrl?.trim() ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:3001/api";
  const runId = body.runId?.trim();
  const useSeeding = body.useSeeding ?? true;

  if (!useSeeding && !token) {
    return Response.json(
      { error: "Missing Authorization header (required when useSeeding=false)" },
      { status: 401 }
    );
  }

  const ids = body.scenarioIds?.length
    ? body.scenarioIds
    : body.scenarioId
      ? [body.scenarioId]
      : [];

  if (ids.length === 0)
    return Response.json({ error: "Provide scenarioId or scenarioIds" }, { status: 400 });

  if (runId) {
    const [run] = await db
      .select()
      .from(evalRuns)
      .where(and(eq(evalRuns.id, runId), eq(evalRuns.userId, userId)));
    if (!run)
      return Response.json({ error: "Run not found" }, { status: 404 });
  }

  const scenarioRows = await db
    .select()
    .from(evalScenarios)
    .where(inArray(evalScenarios.id, ids));

  const scenarioMap = new Map(scenarioRows.map((s) => [s.id, s]));

  const results = [];

  for (const scenarioId of ids) {
    const row = scenarioMap.get(scenarioId);
    if (!row) {
      results.push({ scenarioId, error: "Scenario not found" });
      continue;
    }

    try {
      if (runId) {
        await db
          .update(evalRunResults)
          .set({ status: "running", updatedAt: new Date() })
          .where(
            and(
              eq(evalRunResults.evalRunId, runId),
              eq(evalRunResults.scenarioId, scenarioId)
            )
          );
      }

      const generated = dbScenarioToGenerated(row);
      const result = useSeeding
        ? await runSeededEvaluation(generated, { apiUrl })
        : await runChatEvaluation(generated, { apiUrl, token: token! });

      results.push(result);

      if (runId) {
        await db
          .update(evalRunResults)
          .set({
            status: "completed",
            conversation: result.conversation,
            seedData: result.seedData || null,
            result: {
              verdict: result.verdict,
              fulfillmentScore: result.fulfillmentScore,
              qualityScore: result.qualityScore,
              reasoning: result.reasoning,
              successSignals: result.successSignals,
              failureSignals: result.failureSignals,
              turns: result.turns,
              duration: result.durationMs,
            },
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(evalRunResults.evalRunId, runId),
              eq(evalRunResults.scenarioId, scenarioId)
            )
          );
      }
    } catch (err) {
      results.push({
        scenarioId,
        error: err instanceof Error ? err.message : "Evaluation failed",
      });
      if (runId) {
        await db
          .update(evalRunResults)
          .set({ status: "error", updatedAt: new Date() })
          .where(
            and(
              eq(evalRunResults.evalRunId, runId),
              eq(evalRunResults.scenarioId, scenarioId)
            )
          );
      }
    }
  }

  return Response.json({ results });
}
