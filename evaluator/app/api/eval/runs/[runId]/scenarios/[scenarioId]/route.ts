import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { evalRuns, evalRunResults } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; scenarioId: string }> }
) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { runId, scenarioId } = await params;

  let body: { reviewFlag?: string | null; reviewNote?: string | null };
  try {
    body = (await req.json()) as { reviewFlag?: string | null; reviewNote?: string | null };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const [run] = await db
      .select()
      .from(evalRuns)
      .where(and(eq(evalRuns.id, runId), eq(evalRuns.userId, userId)));

    if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (body.reviewFlag !== undefined) {
      updates.reviewFlag = body.reviewFlag;
    }
    if (body.reviewNote !== undefined) {
      updates.reviewNote = body.reviewNote;
    }
    if (Object.keys(updates).length === 0) {
      return Response.json({ ok: true });
    }

    await db
      .update(evalRunResults)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(evalRunResults.evalRunId, runId),
          eq(evalRunResults.scenarioId, scenarioId)
        )
      );

    return Response.json({ ok: true });
  } catch (err) {
    console.error("patch scenario", err);
    return Response.json({ error: "Failed to update" }, { status: 500 });
  }
}
