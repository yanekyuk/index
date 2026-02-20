import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { evalRuns, evalRunResults, evalScenarios } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { runId } = await params;

  try {
    const [run] = await db
      .select()
      .from(evalRuns)
      .where(and(eq(evalRuns.id, runId), eq(evalRuns.userId, userId)));

    if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

    const results = await db
      .select({
        id: evalRunResults.id,
        scenarioId: evalRunResults.scenarioId,
        status: evalRunResults.status,
        seedData: evalRunResults.seedData,
        conversation: evalRunResults.conversation,
        result: evalRunResults.result,
        reviewFlag: evalRunResults.reviewFlag,
        reviewNote: evalRunResults.reviewNote,
        createdAt: evalRunResults.createdAt,
        scenario: {
          id: evalScenarios.id,
          needId: evalScenarios.needId,
          personaId: evalScenarios.personaId,
          category: evalScenarios.category,
          question: evalScenarios.question,
          expectation: evalScenarios.expectation,
          message: evalScenarios.message,
          source: evalScenarios.source,
        },
      })
      .from(evalRunResults)
      .leftJoin(evalScenarios, eq(evalRunResults.scenarioId, evalScenarios.id))
      .where(eq(evalRunResults.evalRunId, runId))
      .orderBy(evalRunResults.createdAt);

    const scenarios = results.map((r) => ({
      id: r.scenario?.id ?? r.scenarioId,
      scenarioId: r.scenarioId,
      resultId: r.id,
      needId: r.scenario?.needId,
      personaId: r.scenario?.personaId,
      category: r.scenario?.category,
      question: r.scenario?.question,
      message: r.scenario?.message,
      source: r.scenario?.source,
      status: r.status,
      conversation: r.conversation,
      result: r.result,
      reviewFlag: r.reviewFlag,
      reviewNote: r.reviewNote,
    }));

    return Response.json({
      run: { id: run.id, name: run.name, status: run.status, createdAt: run.createdAt },
      scenarios,
    });
  } catch (err) {
    console.error("get run", err);
    return Response.json({ error: "Failed to get run" }, { status: 500 });
  }
}
