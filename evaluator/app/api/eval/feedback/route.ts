import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { db } from "@/lib/db/drizzle";
import { userFeedback } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { analyzeFeedback } from "@/lib/feedback-analyzer";

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
    const [inserted] = await db
      .insert(userFeedback)
      .values({
        userId,
        feedback: body.feedback.trim(),
        sessionId: body.sessionId ?? null,
        conversation: body.conversation ?? null,
      })
      .returning({ id: userFeedback.id });

    if (inserted) {
      try {
        const analysis = await analyzeFeedback(
          body.feedback.trim(),
          body.conversation || []
        );
        await db
          .update(userFeedback)
          .set({
            aiExplanation: analysis.explanation,
            issueLabels: analysis.labels,
          })
          .where(eq(userFeedback.id, inserted.id));
      } catch (analysisErr) {
        console.error("Failed to analyze feedback", analysisErr);
        // Don't fail the request, just log the error
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Failed to save feedback", err);
    return Response.json(
      { error: "Failed to save feedback" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const entries = await db
      .select()
      .from(userFeedback)
      .where(eq(userFeedback.archived, false))
      .orderBy(desc(userFeedback.createdAt));

    return Response.json({ feedback: entries });
  } catch (err) {
    console.error("Failed to load feedback", err);
    return Response.json(
      { error: "Failed to load feedback" },
      { status: 500 }
    );
  }
}
