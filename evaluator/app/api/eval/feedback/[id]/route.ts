import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { userFeedback } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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
    const [entry] = await db
      .select({ id: userFeedback.id })
      .from(userFeedback)
      .where(eq(userFeedback.id, id));

    if (!entry)
      return Response.json({ error: "Not found" }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (body.archived !== undefined) updates.archived = body.archived;

    if (Object.keys(updates).length === 0)
      return Response.json({ ok: true });

    await db
      .update(userFeedback)
      .set(updates)
      .where(eq(userFeedback.id, id));

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Failed to update feedback", err);
    return Response.json({ error: "Failed to update" }, { status: 500 });
  }
}
