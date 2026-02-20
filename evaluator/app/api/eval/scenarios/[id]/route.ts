import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { evalScenarios } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.category !== undefined) updates.category = body.category;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.question !== undefined) updates.question = body.question;
    if (body.expectation !== undefined) updates.expectation = body.expectation;
    if (body.message !== undefined) updates.message = body.message;
    if (body.personaId !== undefined) updates.personaId = body.personaId;
    if (body.needId !== undefined) updates.needId = body.needId;
    if (body.seedRequirements !== undefined) updates.seedRequirements = body.seedRequirements;

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "No fields to update" }, { status: 400 });
    }

    updates.updatedAt = new Date();

    const [updated] = await db
      .update(evalScenarios)
      .set(updates)
      .where(eq(evalScenarios.id, id))
      .returning();

    if (!updated)
      return Response.json({ error: "Scenario not found" }, { status: 404 });

    return Response.json({ scenario: updated });
  } catch (err) {
    console.error("update scenario", err);
    return Response.json({ error: "Failed to update scenario" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [deleted] = await db
      .delete(evalScenarios)
      .where(eq(evalScenarios.id, id))
      .returning();

    if (!deleted)
      return Response.json({ error: "Scenario not found" }, { status: 404 });

    return Response.json({ success: true });
  } catch (err) {
    console.error("delete scenario", err);
    return Response.json({ error: "Failed to delete scenario" }, { status: 500 });
  }
}
