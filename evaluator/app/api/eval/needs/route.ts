import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { isMissingTableError, MIGRATE_HINT } from "@/lib/db/errors";
import { evalNeeds } from "@/lib/db/schema";
import { generatePersonaMessages } from "@/lib/evaluator";
import { asc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const needs = await db
      .select()
      .from(evalNeeds)
      .orderBy(asc(evalNeeds.category), asc(evalNeeds.needId));

    return Response.json({ needs });
  } catch (err) {
    console.error("list needs", err);
    if (isMissingTableError(err)) {
      return Response.json(
        { error: "eval_needs table does not exist", hint: MIGRATE_HINT },
        { status: 503 }
      );
    }
    return Response.json({ error: "Failed to list needs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { needId, category, question, expectation } = body;

    if (!needId || !category || !question) {
      return Response.json({ error: "Missing required fields (needId, category, question)" }, { status: 400 });
    }

    const messages = await generatePersonaMessages(question, expectation || "");

    const [need] = await db
      .insert(evalNeeds)
      .values({
        needId,
        category,
        question,
        expectation: expectation || "",
        messages,
      })
      .returning();

    return Response.json({ need });
  } catch (err: unknown) {
    console.error("create need", err);
    if (isMissingTableError(err)) {
      return Response.json(
        { error: "eval_needs table does not exist", hint: MIGRATE_HINT },
        { status: 503 }
      );
    }
    const msg = err instanceof Error && err.message.includes("unique")
      ? "Need ID already exists"
      : "Failed to create need";
    return Response.json({ error: msg }, { status: 500 });
  }
}
