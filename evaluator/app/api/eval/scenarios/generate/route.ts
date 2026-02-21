import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { evalScenarios, evalRunResults } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { orderNewScenarios } from "@/lib/seed/scenario.orderer";
import { addScenariosToActiveRuns } from "@/lib/runs";

/**
 * LLM generates new scenarios based on evaluation results and coverage gaps.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const maxScenarios = body.maxScenarios ?? 5;

    const allResults = await db
      .select({
        scenarioId: evalRunResults.scenarioId,
        result: evalRunResults.result,
      })
      .from(evalRunResults)
      .where(eq(evalRunResults.status, "completed"));

    const scenarioIds = [...new Set(allResults.map((r) => r.scenarioId))];
    const scenarioRows = scenarioIds.length > 0
      ? await db
          .select({
            id: evalScenarios.id,
            category: evalScenarios.category,
            needId: evalScenarios.needId,
            question: evalScenarios.question,
          })
          .from(evalScenarios)
      : [];

    const scenarioMap = new Map(scenarioRows.map((s) => [s.id, s]));

    const resultSummaries = allResults
      .filter((r) => r.result)
      .map((r) => {
        const scenario = scenarioMap.get(r.scenarioId);
        return {
          scenarioId: r.scenarioId,
          category: scenario?.category || "unknown",
          needId: scenario?.needId || undefined,
          question: scenario?.question || "",
          verdict: (r.result as Record<string, unknown>).verdict as string,
          fulfillmentScore: (r.result as Record<string, unknown>).fulfillmentScore as number,
          failureSignals: (r.result as Record<string, unknown>).failureSignals as string[] | undefined,
        };
      });

    const existingCategories = [...new Set(scenarioRows.map((s) => s.category))];

    const ordered = await orderNewScenarios(
      resultSummaries,
      existingCategories,
      maxScenarios
    );

    const created = [];
    for (const scenario of ordered) {
      const [inserted] = await db
        .insert(evalScenarios)
        .values({
          source: "generated",
          category: scenario.category,
          needId: scenario.needId,
          question: scenario.question,
          expectation: scenario.expectation,
          message: scenario.message,
          seedRequirements: scenario.seedRequirements,
        })
        .returning();
      if (inserted) created.push(inserted);
    }

    await addScenariosToActiveRuns(created.map((s) => s.id));

    return Response.json({
      generated: created.length,
      scenarios: created,
    });
  } catch (err) {
    console.error("generate scenarios", err);
    return Response.json({ error: "Failed to generate scenarios" }, { status: 500 });
  }
}
