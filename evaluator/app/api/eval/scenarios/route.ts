import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { evalScenarios } from "@/lib/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { generatePersonaMessages } from "@/lib/evaluator";
import { getSeedRequirements } from "@/lib/scenarios";
import { addScenariosToActiveRuns } from "@/lib/runs";

export async function GET(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const source = searchParams.get("source");
  const category = searchParams.get("category");
  const enabled = searchParams.get("enabled");

  try {
    const conditions = [];
    if (source && source !== "all") {
      conditions.push(eq(evalScenarios.source, source as "predefined" | "feedback" | "generated"));
    }
    if (category && category !== "all") {
      conditions.push(eq(evalScenarios.category, category));
    }
    if (enabled === "true") {
      conditions.push(eq(evalScenarios.enabled, true));
    } else if (enabled === "false") {
      conditions.push(eq(evalScenarios.enabled, false));
    }

    const query = db
      .select()
      .from(evalScenarios)
      .orderBy(asc(evalScenarios.category), asc(evalScenarios.needId), desc(evalScenarios.createdAt));

    const scenarios =
      conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

    return Response.json({ scenarios });
  } catch (err) {
    console.error("list scenarios", err);
    return Response.json({ error: "Failed to list scenarios" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { category, needId, question, expectation, message, personaId, source } = body;

    if (!category || !question || !expectation) {
      return Response.json(
        { error: "Missing required fields (category, question, expectation)" },
        { status: 400 }
      );
    }

    const finalMessage = message || question;
    const seedRequirements = body.seedRequirements || getSeedRequirements(category, needId);

    const [scenario] = await db
      .insert(evalScenarios)
      .values({
        source: source || "predefined",
        category,
        needId: needId || null,
        question,
        expectation,
        message: finalMessage,
        personaId: personaId || null,
        seedRequirements,
      })
      .returning();

    await addScenariosToActiveRuns([scenario.id]);

    return Response.json({ scenario });
  } catch (err) {
    console.error("create scenario", err);
    return Response.json({ error: "Failed to create scenario" }, { status: 500 });
  }
}
