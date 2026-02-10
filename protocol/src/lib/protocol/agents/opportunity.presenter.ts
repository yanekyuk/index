/**
 * Opportunity Presenter Agent
 *
 * Generates personalized, second-person explanations of why an opportunity
 * matters to the viewing user. Uses full opportunity data (interpretation,
 * actors, profiles, intents, index) to produce headline, personalizedSummary,
 * and suggestedAction for chat tools and user-facing surfaces.
 */

import { ChatOpenAI } from "@langchain/openai";
import type { Runnable } from "@langchain/core/runnables";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { protocolLogger } from "../support/protocol.logger";
import type { Opportunity } from "../interfaces/database.interface";
import type { ChatGraphCompositeDatabase } from "../interfaces/database.interface";

const logger = protocolLogger("OpportunityPresenter");

import { config } from "dotenv";
config({ path: ".env.development" });

const model = new ChatOpenAI({
  model: "google/gemini-2.5-flash",
  configuration: {
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
});

// ──────────────────────────────────────────────────────────────
// SCHEMA & TYPES
// ──────────────────────────────────────────────────────────────

const PresentationSchema = z.object({
  headline: z
    .string()
    .describe(
      "Short, compelling headline for this opportunity (e.g., 'A React expert who needs your design skills')"
    ),
  personalizedSummary: z
    .string()
    .describe(
      "2-3 sentence explanation using 'you' language, explaining why this opportunity is specifically valuable for the viewer based on their intents and profile"
    ),
  suggestedAction: z.string().describe("Brief suggested next step"),
});

const responseFormat = z.object({
  presentation: PresentationSchema,
});

export type OpportunityPresentationResult = z.infer<typeof PresentationSchema>;

/** Input for a single presenter call (all context pre-assembled). */
export interface PresenterInput {
  viewerContext: string;
  otherPartyContext: string;
  matchReasoning: string;
  category: string;
  confidence: number;
  signalsSummary: string;
  indexName: string;
  viewerRole: string;
}

// ──────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────

const systemPrompt = `
You are an expert at presenting connection opportunities to users in a way that feels personal and compelling.

Your goal: Given raw context about the viewer (their profile, intents), the other person, and why the system matched them, produce a short headline, a personalized summary, and a suggested action.

Rules:
1. Address the VIEWER directly using "you" and "your". This is for them.
2. Reference their specific intents, skills, or interests that align with this opportunity.
3. Explain what the other party brings and why the viewer should care.
4. Be concise and compelling — not analytical or third-party. No "The source user" or "The candidate"; use the other person's name or "they" where needed.
5. Headline: one short line that hooks (e.g., "A React expert who needs your design skills").
6. Personalized summary: 2-3 sentences max. Why is this opportunity for *them*?
7. Suggested action: one brief next step (e.g., "Send an intro request" or "View their profile and reach out").
8. Do not leak private or confidential details. Use only the context provided.
`;

// ──────────────────────────────────────────────────────────────
// CLASS
// ──────────────────────────────────────────────────────────────

export class OpportunityPresenter {
  private model: Runnable;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "opportunity_presenter",
    });
  }

  /**
   * Generate personalized presentation for a single opportunity.
   */
  public async present(input: PresenterInput): Promise<OpportunityPresentationResult> {
    const humanContent = `
VIEWER (the person seeing this opportunity):
${input.viewerContext}

OTHER PARTY:
${input.otherPartyContext}

MATCH CONTEXT:
- Category: ${input.category}
- Confidence: ${input.confidence}
- Why we matched: ${input.matchReasoning}
- Signals: ${input.signalsSummary}

COMMUNITY: ${input.indexName}
Viewer's role in this opportunity: ${input.viewerRole}

Produce headline, personalizedSummary (2-3 sentences in "you" language), and suggestedAction.
`;

    try {
      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(humanContent),
      ];
      const result = await this.model.invoke(messages);
      const parsed = responseFormat.parse(result);
      return parsed.presentation;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn("[OpportunityPresenter.present] LLM failed, returning fallback", {
        message,
      });
      return {
        headline: "A connection opportunity",
        personalizedSummary: input.matchReasoning.slice(0, 300),
        suggestedAction: "View opportunity and decide whether to reach out.",
      };
    }
  }

  /**
   * Process multiple opportunities in parallel with bounded concurrency.
   */
  public async presentBatch(
    inputs: PresenterInput[],
    options?: { concurrency?: number }
  ): Promise<OpportunityPresentationResult[]> {
    const concurrency = options?.concurrency ?? 5;
    const results: OpportunityPresentationResult[] = [];
    for (let i = 0; i < inputs.length; i += concurrency) {
      const chunk = inputs.slice(i, i + concurrency);
      const chunkResults = await Promise.all(chunk.map((inp) => this.present(inp)));
      results.push(...chunkResults);
    }
    return results;
  }
}

// ──────────────────────────────────────────────────────────────
// CONTEXT GATHERER (used by tools)
// ──────────────────────────────────────────────────────────────

/**
 * Gather all context needed for the presenter from the database.
 * Fetches viewer profile, viewer intents, other party profile(s), and index in parallel.
 */
export async function gatherPresenterContext(
  database: ChatGraphCompositeDatabase,
  opportunity: Opportunity,
  viewerId: string
): Promise<PresenterInput> {
  const myActor = opportunity.actors.find((a) => a.identityId === viewerId);
  if (!myActor) {
    throw new Error("Viewer is not an actor in this opportunity");
  }

  const otherActors = opportunity.actors.filter((a) => a.identityId !== viewerId);
  const otherPartyIds = otherActors.map((a) => a.identityId);

  const [viewerProfile, viewerIntents, indexRecord, ...otherProfiles] = await Promise.all([
    database.getProfile(viewerId),
    database.getActiveIntents(viewerId),
    database.getIndex(opportunity.indexId),
    ...otherPartyIds.map((uid) => database.getProfile(uid)),
  ]);

  const viewerContextLines = [
    "Profile:",
    `Name: ${viewerProfile?.identity?.name ?? "Unknown"}`,
    `Bio: ${viewerProfile?.identity?.bio ?? ""}`,
    `Location: ${viewerProfile?.identity?.location ?? ""}`,
    `Skills: ${viewerProfile?.attributes?.skills?.join(", ") ?? ""}`,
    `Interests: ${viewerProfile?.attributes?.interests?.join(", ") ?? ""}`,
    `Context: ${viewerProfile?.narrative?.context ?? ""}`,
    "Active intents:",
    ...(viewerIntents?.length
      ? viewerIntents.map((i) => `- ${i.payload}${i.summary ? ` (${i.summary})` : ""}`)
      : ["(none listed)"]),
  ];
  const viewerContext = viewerContextLines.join("\n");

  const otherParts = otherPartyIds.map((uid, idx) => {
    const profile = otherProfiles[idx] as Awaited<ReturnType<typeof database.getProfile>>;
    const name = profile?.identity?.name ?? "Unknown";
    const bio = profile?.identity?.bio ?? "";
    const skills = profile?.attributes?.skills?.join(", ") ?? "";
    const interests = profile?.attributes?.interests?.join(", ") ?? "";
    return `${name}: ${bio}. Skills: ${skills}. Interests: ${interests}`;
  });
  const otherPartyContext = otherParts.join("\n\n") || "Other party (details not available).";

  const interp = opportunity.interpretation;
  const signalsSummary =
    interp.signals?.map((s) => `${s.type}: ${s.detail ?? s.type}`).join("; ") ?? "Match based on profile and intent alignment.";

  return {
    viewerContext,
    otherPartyContext,
    matchReasoning: interp.reasoning,
    category: interp.category ?? "connection",
    confidence:
      typeof interp.confidence === "number" ? interp.confidence : parseFloat(String(interp.confidence ?? 0)) || 0,
    signalsSummary,
    indexName: indexRecord?.title ?? opportunity.indexId,
    viewerRole: myActor.role ?? "party",
  };
}
