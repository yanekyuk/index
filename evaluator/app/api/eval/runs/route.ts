import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { evalRuns, evalRunResults, evalScenarios } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const runs = await db
      .select({
        id: evalRuns.id,
        name: evalRuns.name,
        status: evalRuns.status,
        createdAt: evalRuns.createdAt,
      })
      .from(evalRuns)
      .where(eq(evalRuns.userId, userId))
      .orderBy(desc(evalRuns.createdAt))
      .limit(50);

    const withCounts = await Promise.all(
      runs.map(async (r) => {
        const results = await db
          .select({ status: evalRunResults.status })
          .from(evalRunResults)
          .where(eq(evalRunResults.evalRunId, r.id));
        const scenarioCount = results.length;
        const completedCount = results.filter(
          (x) => x.status === "completed" || x.status === "error"
        ).length;
        return {
          id: r.id,
          name: r.name,
          status: r.status,
          createdAt: r.createdAt,
          scenarioCount,
          completedCount,
        };
      })
    );

    return Response.json({ runs: withCounts });
  } catch (err) {
    console.error("list runs", err);
    return Response.json({ error: "Failed to list runs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const categoryFilter = body.category;
    const sourceFilter = body.source;

    let scenarioQuery = db
      .select()
      .from(evalScenarios)
      .where(eq(evalScenarios.enabled, true));

    const allScenarios = await scenarioQuery;

    let filtered = allScenarios;
    if (categoryFilter && categoryFilter !== "all") {
      filtered = filtered.filter((s) => s.category === categoryFilter);
    }
    if (sourceFilter && sourceFilter !== "all") {
      filtered = filtered.filter((s) => s.source === sourceFilter);
    }

    if (filtered.length === 0) {
      return Response.json(
        { error: "No scenarios found. Seed scenarios first." },
        { status: 400 }
      );
    }

    const [run] = await db
      .insert(evalRuns)
      .values({ userId, name: body.name || null, status: "draft" })
      .returning();

    if (!run) return Response.json({ error: "Failed to create run" }, { status: 500 });

    await db.insert(evalRunResults).values(
      filtered.map((s) => ({
        evalRunId: run.id,
        scenarioId: s.id,
      }))
    );

    return Response.json({
      runId: run.id,
      scenarioCount: filtered.length,
      scenarios: filtered.map((s) => ({
        id: s.id,
        needId: s.needId,
        personaId: s.personaId,
        message: s.message,
        category: s.category,
        source: s.source,
      })),
    });
  } catch (err) {
    console.error("create run", err);
    return Response.json({ error: "Failed to create run" }, { status: 500 });
  }
}
