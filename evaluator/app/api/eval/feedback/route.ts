import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { evalScenarios } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { classifyFeedback } from "@/lib/seed/feedback.classifier";
import { addScenariosToActiveRuns } from "@/lib/runs";

/**
 * POST: Submit feedback -> LLM classifies -> creates eval_scenarios row with source="feedback"
 */
export async function POST(req: NextRequest) {
  const userId = (await getUserIdFromRequest(req)) ?? "anonymous";

  let body: {
    feedback: string;
    sessionId?: string;
    conversation?: Array<{ role: string; content: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.feedback?.trim()) {
    return Response.json({ error: "Feedback is required" }, { status: 400 });
  }

  try {
    const classified = await classifyFeedback(
      body.feedback.trim(),
      body.conversation || []
    );

    const [scenario] = await db
      .insert(evalScenarios)
      .values({
        source: "feedback",
        category: classified.category,
        needId: classified.needId,
        question: classified.question,
        expectation: classified.expectation,
        message: classified.message,
        feedbackText: body.feedback.trim(),
        feedbackConversation: body.conversation || null,
        seedRequirements: classified.seedRequirements,
      })
      .returning();

    await addScenariosToActiveRuns([scenario.id]);

    return Response.json({ ok: true, scenario });
  } catch (err) {
    console.error("Failed to process feedback", err);
    return Response.json(
      { error: "Failed to process feedback" },
      { status: 500 }
    );
  }
}

function mapFeedbackRow(row: typeof evalScenarios.$inferSelect) {
  return {
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
    issueLabels: [row.category, row.needId].filter(Boolean) as string[],
  };
}

/**
 * GET: List feedback-sourced scenarios, mapped to FeedbackView shape
 */
export async function GET(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rows = await db
      .select()
      .from(evalScenarios)
      .where(
        and(eq(evalScenarios.source, "feedback"), eq(evalScenarios.enabled, true))
      )
      .orderBy(desc(evalScenarios.createdAt));

    return Response.json({ feedback: rows.map(mapFeedbackRow) });
  } catch (err) {
    console.error("Failed to load feedback", err);
    return Response.json(
      { error: "Failed to load feedback" },
      { status: 500 }
    );
  }
}
