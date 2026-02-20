import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { evalScenarios } from "@/lib/db/schema";
import { CHAT_AGENT_USER_NEEDS, USER_PERSONAS, type UserPersonaId, getSeedRequirements } from "@/lib/scenarios";
import { eq, and } from "drizzle-orm";

/**
 * Bulk-upsert predefined scenarios from CHAT_AGENT_USER_NEEDS into eval_scenarios.
 * Creates one scenario per need × persona combination.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const entries = Object.entries(CHAT_AGENT_USER_NEEDS);
    const personaIds = Object.keys(USER_PERSONAS) as UserPersonaId[];
    let upserted = 0;

    for (const [needKey, need] of entries) {
      for (const personaId of personaIds) {
        const personaKey = USER_PERSONAS[personaId].id;
        const message =
          personaKey in need.messages
            ? (need.messages as Record<string, string>)[personaKey]
            : need.question;

        const seedRequirements = getSeedRequirements(need.category, needKey);

        const existing = await db
          .select({ id: evalScenarios.id })
          .from(evalScenarios)
          .where(
            and(
              eq(evalScenarios.needId, needKey),
              eq(evalScenarios.personaId, personaId),
              eq(evalScenarios.source, "predefined")
            )
          )
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(evalScenarios)
            .set({
              category: need.category,
              question: need.question,
              expectation: need.expectation,
              message,
              seedRequirements,
              updatedAt: new Date(),
            })
            .where(eq(evalScenarios.id, existing[0].id));
        } else {
          await db.insert(evalScenarios).values({
            source: "predefined",
            category: need.category,
            needId: needKey,
            question: need.question,
            expectation: need.expectation,
            message,
            personaId,
            seedRequirements,
          });
        }

        upserted++;
      }
    }

    return Response.json({ upserted });
  } catch (err) {
    console.error("seed scenarios", err);
    return Response.json({ error: "Failed to seed scenarios" }, { status: 500 });
  }
}
