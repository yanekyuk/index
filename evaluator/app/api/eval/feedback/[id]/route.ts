import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { evalScenarios } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [row] = await db
      .select()
      .from(evalScenarios)
      .where(and(eq(evalScenarios.id, id), eq(evalScenarios.source, "feedback")));

    if (!row)
      return Response.json({ error: "Not found" }, { status: 404 });

    return Response.json({
      id: row.id,
      userId: "system",
      feedback: row.feedbackText ?? row.question,
      sessionId: null,
      conversation: row.feedbackConversation ?? null,
      retryConversation: null,
      retryStatus: null,
      archived: !row.enabled,
      createdAt: row.createdAt.toISOString(),
      aiExplanation: row.expectation,
      issueLabels: [row.category, row.needId].filter(Boolean),
    });
  } catch (err) {
    console.error("get feedback", err);
    return Response.json({ error: "Failed to get feedback" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: { archived?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.archived === "boolean") {
      updates.enabled = !body.archived;
    }

    await db
      .update(evalScenarios)
      .set(updates)
      .where(eq(evalScenarios.id, id));

    return Response.json({ ok: true });
  } catch (err) {
    console.error("patch feedback", err);
    return Response.json({ error: "Failed to update feedback" }, { status: 500 });
  }
}
