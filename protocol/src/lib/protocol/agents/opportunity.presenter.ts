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

/**
 * Minimal database interface required by gatherPresenterContext.
 * Any database adapter that implements these three methods can be passed.
 */
export type PresenterDatabase = Pick<ChatGraphCompositeDatabase, 'getProfile' | 'getActiveIntents' | 'getIndex'>;

const logger = protocolLogger("OpportunityPresenter");
const LLM_TIMEOUT_MS = 20_000;

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

/** Input for home-card presenter call; extends PresenterInput with optional mutual intent count. */
export interface HomeCardPresenterInput extends PresenterInput {
  /** Number of overlapping intents (for generating mutualIntentsLabel). */
  mutualIntentCount?: number;
}

/** Full home-card display contract returned by presentHomeCard. */
export const HomeCardPresentationSchema = z.object({
  headline: z.string().describe("Short, compelling headline for this opportunity"),
  personalizedSummary: z.string().describe("2-3 sentence explanation in 'you' language for the main card body"),
  suggestedAction: z.string().describe("Brief suggested next step (e.g. CTA line)"),
  narratorRemark: z.string().max(120).describe("One short sentence for the narrator chip (e.g. who is suggesting and why)"),
  primaryActionLabel: z.string().max(32).describe("Label for the primary button (accept = start a conversation). Conversation-oriented only, e.g. 'Start Chat', 'Say hello', 'Reply in chat'. Never 'View Project' or 'Review Opportunity'."),
  secondaryActionLabel: z.string().max(32).describe("Label for the secondary button (reject/dismiss: e.g. 'Skip', 'Not now')"),
  mutualIntentsLabel: z.string().max(48).describe("Short line for the subtitle under the other party name (e.g. '1 mutual intent', '2 overlapping intents')"),
});

const homeCardResponseFormat = z.object({
  presentation: HomeCardPresentationSchema,
});

export type HomeCardPresentationResult = z.infer<typeof HomeCardPresentationSchema>;

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
  opportunityStatus?: string;
  /** True when this opportunity was created via an explicit introduction (not automatic discovery). */
  isIntroduction?: boolean;
  /** Name of the person who made the introduction, if applicable. */
  introducerName?: string;
}

// ──────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────

const systemPrompt = `
You are an expert at presenting connection opportunities to users in a way that feels personal and compelling.

Your goal: Given raw context about the viewer (their profile, intents), the other person(s), and why the system matched them, produce a short headline, a personalized summary, and a suggested action.

Rules:
1. Address the VIEWER directly using "you" and "your". This is for them.
2. Be concise and compelling — not analytical or third-party. No "The source user" or "The candidate"; use names or "they" where needed.
3. Do not leak private or confidential details. Use only the context provided.

**Introduction-originated opportunities:**
When INTRODUCTION CONTEXT is provided, this opportunity was explicitly created by an introducer (a real person who saw value in this connection). This is NOT an automatic system discovery — someone made a deliberate judgment.
- For ALL roles: acknowledge the introducer's role naturally. E.g., "[Introducer name] thinks you should meet [other person]" or "[Introducer name] connected you because..."
- The introduction itself is a strong signal — treat it with the weight of a personal recommendation.
- If the parties' intents don't obviously overlap, that's fine — the introducer saw something worth connecting. Focus on what the introducer likely saw.

**Role-Specific Presentation:**

**If viewer is "introducer":**
- The viewer suggested this connection between two (or more) OTHER people. The opportunity is NOT about the viewer's own needs.
- Headline: describe the connection between the parties (e.g., "Connecting a React expert with a startup founder").
- Personalized summary: explain why the people YOU are introducing should meet. Reference THEIR profiles and intents, not yours. Frame it as "you're connecting X and Y because..." rather than "this matches your intent".
- Suggested action: guide sharing (e.g., "Share this with [name] to get things started").
- CRITICAL: Do NOT reference the introducer's own intents, skills, or needs. The introducer is the matchmaker, not a party.

**If viewer is "patient" or "party":**
- Reference their specific intents, skills, or interests that align with this opportunity.
- If this is an introduction: mention who introduced them and frame it as a personal recommendation.
- Headline: one short line that hooks (e.g., "[Name] thinks you should meet [Other]" or "A React expert who needs your design skills").
- Personalized summary: 2-3 sentences. Why is this opportunity for *them*? If introduced, lead with the introduction.
- Suggested action: encourage action ("Send a message to start the conversation" or "Share this intro").

**If viewer is "agent":**
- They are seeing this because someone already reached out.
- If this is an introduction: mention who made the introduction.
- Reference their skills/expertise that make them a match.
- Headline: what the other person needs that they can provide.
- Personalized summary: 2-3 sentences. Why someone reached out to them.
- Suggested action: "Someone is interested in connecting — check their message" or "Review and respond".

**If viewer is "peer":**
- Mutual opportunity. Reference shared or complementary interests.
- If this is an introduction: mention who connected them.
- Headline: the mutual connection angle.
- Personalized summary: 2-3 sentences. Why this is mutually valuable.
- Suggested action: "Send an intro to connect" or "Start a conversation".
`;

const homeCardSystemPrompt = `
You are an expert at presenting connection opportunities for a home feed card.

Given context about the viewer, the other person, and why they were matched, produce:
1. headline: one short hook line.
2. personalizedSummary: 2-3 sentences in "you" language (main body text).
3. suggestedAction: one brief suggested next step.
4. narratorRemark: one short sentence for the narrator chip (who is suggesting and why; max ~80 chars).
5. primaryActionLabel: label for the primary button. Accept means accepting to have a conversation — so this must always be conversation-oriented. Use only labels like "Start Chat", "Have a conversation", "Say hello", "Reply in chat", "Open chat". Never use "View Project", "Review Opportunity", "View details", or similar.
6. secondaryActionLabel: label for the secondary button (dismiss/skip). Examples: "Skip", "Not now", "Later".
7. mutualIntentsLabel: short subtitle under the other party's name. Examples: "1 mutual intent", "2 overlapping intents", "Shared interests" — keep it brief. Based on actors field of the opportunity.

Rules:
- Address the viewer with "you"/"your". Be concise and compelling.
- primaryActionLabel must always invite starting or having a conversation (e.g. Start Chat, Say hello). Never use viewing/reviewing wording.
- secondaryActionLabel must be short (under ~20 chars). narratorRemark should feel like a single sentence from the narrator (Index or a person), not meta-commentary.
- narratorRemark is displayed with the narrator name prepended (e.g. "Index: …" or "Alice: …"). Do NOT start narratorRemark with the narrator's name or repeat it; write only the remark (e.g. "Based on your overlapping intents" or "introduced you two, sensing a valuable connection").

**Introduction-originated opportunities (ONLY when INTRODUCTION CONTEXT is provided):**
When INTRODUCTION CONTEXT is provided, this opportunity was explicitly created by an introducer. It was NOT automatically discovered.
- For parties/patients/agents/peers viewing an introduction: mention who introduced them. The headline and summary should acknowledge the introduction (e.g., "[Name] thinks you should meet [Other]"). The narratorRemark should reference the introducer (without repeating their name at the start).
- This is a personal recommendation, not an algorithm match. Frame it accordingly.

**When INTRODUCTION CONTEXT is NOT provided (system-discovered match):**
- Do NOT use introducer-style wording. Do NOT say "you suggested", "this is an introduction you suggested", or "you suggested this connection". The system found this match; no human introducer was involved.
- Instead, narratorRemark should describe why the match is relevant (e.g. "Based on your overlapping intents", "Your skills align with what they need").
- narratorRemark should describe why the match is relevant (e.g. "Based on your overlapping intents", "Your skills align with what they need").

- Exception for connector/introducer: if viewer role is "introducer" (any status), this is a curation/connector card. Use:
  - primaryActionLabel: "Good match"
  - secondaryActionLabel: "Pass"
  - suggestedAction: one short line about sharing the intro or confirming the match.
  - mutualIntentsLabel: a short connector label (e.g. "Connector opportunity", "You can bridge this").
  - headline: describe the connection between the parties (e.g., "Connecting a PhD researcher with a translator"). Do NOT reference the introducer's own needs.
  - personalizedSummary: explain why the parties you're introducing should meet, referencing THEIR profiles and intents, not yours.
- Exception for new-connection reveal: if viewer role is "agent", status is "accepted", and there is an introducer, this is the agent's first time seeing this opportunity. Use:
  - primaryActionLabel: "Open chat"
  - secondaryActionLabel: "Later"
  - suggestedAction: a short line about joining the conversation.
`;

// ──────────────────────────────────────────────────────────────
// CLASS
// ──────────────────────────────────────────────────────────────

export class OpportunityPresenter {
  private model: Runnable;
  private homeCardModel: Runnable;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "opportunity_presenter",
    });
    this.homeCardModel = model.withStructuredOutput(homeCardResponseFormat, {
      name: "opportunity_presenter_home_card",
    });
  }

  private async invokeWithTimeout(targetModel: Runnable, messages: (SystemMessage | HumanMessage)[]): Promise<unknown> {
    const timeoutReason = `LLM invoke timed out after ${LLM_TIMEOUT_MS}ms`;
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const invokePromise = targetModel.invoke(messages, {
      signal: controller.signal,
    } as Record<string, unknown>);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort(timeoutReason);
        reject(new Error(timeoutReason));
      }, LLM_TIMEOUT_MS);
    });

    try {
      return await Promise.race([invokePromise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Generate personalized presentation for a single opportunity.
   */
  public async present(input: PresenterInput): Promise<OpportunityPresentationResult> {
    const introContext = input.isIntroduction
      ? `\nINTRODUCTION CONTEXT: This opportunity was created by an explicit introduction from ${input.introducerName ?? 'someone in the community'}. It was NOT discovered automatically — a real person made this connection.\n`
      : '';
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
${introContext}
COMMUNITY: ${input.indexName}
Viewer's role in this opportunity: ${input.viewerRole}

Produce headline, personalizedSummary (2-3 sentences in "you" language), and suggestedAction.
`;

    try {
      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(humanContent),
      ];
      const result = await this.invokeWithTimeout(this.model, messages);
      const parsed = responseFormat.parse(result);
      return parsed.presentation;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const timeoutReason = message.includes("timed out") ? message : undefined;
      logger.warn("[OpportunityPresenter.present] LLM failed, returning fallback", {
        message,
        timeoutReason,
      });
      return {
        headline: "A connection opportunity",
        personalizedSummary: input.matchReasoning.slice(0, 300),
        suggestedAction: "View opportunity and decide whether to reach out.",
      };
    }
  }

  /**
   * Generate full home-card display contract (headline, body, narrator remark, action labels, mutual-intent label).
   */
  public async presentHomeCard(input: HomeCardPresenterInput): Promise<HomeCardPresentationResult> {
    const mutualHint =
      input.mutualIntentCount != null
        ? `There are ${input.mutualIntentCount} overlapping intent(s) between viewer and other party.`
        : "Match is based on profile and intent alignment.";
    const introContext = input.isIntroduction
      ? `\nINTRODUCTION CONTEXT: This opportunity was created by an explicit introduction from ${input.introducerName ?? 'someone in the community'}. It was NOT discovered automatically — a real person made this connection.\n`
      : '';
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
- ${mutualHint}
${introContext}
COMMUNITY: ${input.indexName}
Viewer's role in this opportunity: ${input.viewerRole}
Opportunity status: ${input.opportunityStatus ?? "pending"}

Produce headline, personalizedSummary, suggestedAction, narratorRemark, primaryActionLabel, secondaryActionLabel, and mutualIntentsLabel.
`;

    try {
      const messages = [
        new SystemMessage(homeCardSystemPrompt),
        new HumanMessage(humanContent),
      ];
      const result = await this.invokeWithTimeout(this.homeCardModel, messages);
      const parsed = homeCardResponseFormat.parse(result);
      return parsed.presentation;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const timeoutReason = message.includes("timed out") ? message : undefined;
      logger.warn("[OpportunityPresenter.presentHomeCard] LLM failed, returning fallback", {
        message,
        timeoutReason,
      });
      const isIntroducer = input.viewerRole === "introducer";
      return {
        headline: "A connection opportunity",
        personalizedSummary: input.matchReasoning.slice(0, 300),
        suggestedAction: isIntroducer
          ? "Share this introduction to get things started."
          : "View opportunity and decide whether to reach out.",
        narratorRemark: "Worth a look.",
        primaryActionLabel: isIntroducer ? "Good match" : "Start Chat",
        secondaryActionLabel: isIntroducer ? "Pass" : "Skip",
        mutualIntentsLabel: isIntroducer
          ? "Connector opportunity"
          : input.mutualIntentCount != null
            ? `${input.mutualIntentCount} mutual intent${input.mutualIntentCount !== 1 ? "s" : ""}`
            : "Shared interests",
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
  database: PresenterDatabase,
  opportunity: Opportunity,
  viewerId: string
): Promise<PresenterInput> {
  const myActor = opportunity.actors.find((a) => a.userId === viewerId);
  if (!myActor) {
    throw new Error("Viewer is not an actor in this opportunity");
  }

  const isIntroducer = myActor.role === "introducer";
  const otherActors = opportunity.actors.filter((a) => a.userId !== viewerId);
  const otherPartyIds = [...new Set(otherActors.map((a) => a.userId))];

  const contextIndexId = opportunity.context?.indexId;

  // For introducers: fetch profiles + intents for both parties; skip introducer's own intents.
  // For other roles: fetch viewer's profile + intents and other party profiles.
  const [viewerProfile, indexRecord, ...otherProfiles] = await Promise.all([
    database.getProfile(viewerId),
    contextIndexId ? database.getIndex(contextIndexId) : Promise.resolve(null),
    ...otherPartyIds.map((uid) => database.getProfile(uid)),
  ]);

  // Fetch intents: for introducer, fetch each party's intents; otherwise fetch viewer's intents.
  let viewerIntents: Awaited<ReturnType<typeof database.getActiveIntents>> | undefined;
  let partyIntentsMap: Map<string, Awaited<ReturnType<typeof database.getActiveIntents>>> | undefined;

  if (isIntroducer) {
    const partyIntentResults = await Promise.all(
      otherPartyIds.map(async (uid) => ({
        uid,
        intents: await database.getActiveIntents(uid),
      }))
    );
    partyIntentsMap = new Map(partyIntentResults.map((r) => [r.uid, r.intents]));
  } else {
    viewerIntents = await database.getActiveIntents(viewerId);
  }

  let viewerContext: string;
  let otherPartyContext: string;

  if (isIntroducer) {
    // Introducer view: minimal viewer context (just name + role), rich other-party context with intents
    viewerContext = [
      "Profile:",
      `Name: ${viewerProfile?.identity?.name ?? "Unknown"}`,
      "Role: You are the introducer who suggested this connection.",
    ].join("\n");

    const otherParts = otherPartyIds.map((uid, idx) => {
      const profile = otherProfiles[idx] as Awaited<ReturnType<typeof database.getProfile>>;
      const name = profile?.identity?.name ?? "Unknown";
      const bio = profile?.identity?.bio ?? "";
      const location = profile?.identity?.location ?? "";
      const skills = profile?.attributes?.skills?.join(", ") ?? "";
      const interests = profile?.attributes?.interests?.join(", ") ?? "";
      const context = profile?.narrative?.context ?? "";
      const intents = partyIntentsMap?.get(uid);
      const intentLines = intents?.length
        ? intents.slice(0, 5).map((i) => `  - ${i.payload}${i.summary ? ` (${i.summary})` : ""}`)
        : ["  (no active intents)"];
      return [
        `${name}:`,
        `  Bio: ${bio}`,
        location ? `  Location: ${location}` : null,
        skills ? `  Skills: ${skills}` : null,
        interests ? `  Interests: ${interests}` : null,
        context ? `  Context: ${context}` : null,
        `  Active intents:`,
        ...intentLines,
      ].filter(Boolean).join("\n");
    });
    otherPartyContext = otherParts.join("\n\n") || "Parties (details not available).";
  } else {
    // Non-introducer view: full viewer profile + intents, other party profiles
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
    viewerContext = viewerContextLines.join("\n");

    const otherParts = otherPartyIds.map((uid, idx) => {
      const profile = otherProfiles[idx] as Awaited<ReturnType<typeof database.getProfile>>;
      const name = profile?.identity?.name ?? "Unknown";
      const bio = profile?.identity?.bio ?? "";
      const skills = profile?.attributes?.skills?.join(", ") ?? "";
      const interests = profile?.attributes?.interests?.join(", ") ?? "";
      return `${name}: ${bio}. Skills: ${skills}. Interests: ${interests}`;
    });
    otherPartyContext = otherParts.join("\n\n") || "Other party (details not available).";
  }

  const interp = opportunity.interpretation;
  const signalsSummary =
    interp.signals?.map((s) => `${s.type}: ${s.detail ?? s.type}`).join("; ") ?? "Match based on profile and intent alignment.";

  // Detect introduction-originated opportunities: only when there is an explicit introducer actor.
  // Do NOT use detection.source === "manual" alone — system-discovered opportunities can have manual source without an introducer.
  const introducerActor = opportunity.actors.find((a) => a.role === "introducer");
  const isIntroduction = !!introducerActor;
  let introducerName: string | undefined;
  if (introducerActor) {
    introducerName = (opportunity.detection as unknown as Record<string, unknown>)?.createdByName as string | undefined;
    if (!introducerName) {
      const introducerProfile = await database.getProfile(introducerActor.userId);
      introducerName = introducerProfile?.identity?.name ?? undefined;
    }
  }

  const result: PresenterInput = {
    viewerContext,
    otherPartyContext,
    matchReasoning: interp.reasoning,
    category: interp.category ?? "connection",
    confidence:
      typeof interp.confidence === "number" ? interp.confidence : parseFloat(String(interp.confidence ?? 0)) || 0,
    signalsSummary,
    indexName: indexRecord?.title ?? (contextIndexId ?? ''),
    viewerRole: myActor.role ?? "party",
    isIntroduction,
    introducerName,
  };

  return result;
}
