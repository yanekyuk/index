import { BaseLangChainAgent } from "../../../lib/langchain/langchain";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { log } from "../../../lib/log";
import { IntentAuditorOutput } from "./intent.auditor.types";

const logger = log.agent.from("agents/intent/auditor/intent.auditor.ts");
import { z } from "zod";

const IntentAuditorOutputSchema = z.object({
  isExpired: z.boolean().describe("Whether the intent has expired"),
  confidenceScore: z.number().min(0).max(100).describe("Confidence score 0-100 indicating certainty of expiration"),
  reasoning: z.string().describe("Brief explanation of why the intent is considered expired or valid"),
});

const SYSTEM_PROMPT = `You are an intent freshness analyzer. Determine if an intent has EXPIRED based on both explicit temporal markers AND the inherent nature of the intent type.

EXPLICIT EXPIRATION - An intent is EXPIRED if it contains:
1. Past dates or time periods (e.g., "Q1 2024" when current date is later)
2. Time-sensitive opportunities that have clearly passed (e.g., "attending conference next week" from 6 months ago)
3. Job postings with stale timelines (e.g., "hiring for Summer 2023 internship" when we're in 2025)
4. Event-specific intents tied to past dates (e.g., "speaking at DevConf March 15" when that date has passed)
5. Seasonal or time-bound offers that are clearly outdated

IMPLICIT EXPIRATION - Consider the nature and typical lifecycle of intent types:

SHORT-TERM INTENTS (typically expire after 1-3 months):
- Job searching / "looking for work" / "open to opportunities"
- Seeking specific roles or positions
- Attending upcoming events or conferences
- Buying/selling specific items or services
- Urgent help or immediate needs
- Short-term project collaborations

MEDIUM-TERM INTENTS (typically expire after 3-6 months):
- Looking for co-founders or team members
- Fundraising or seeking investment
- Beta testing or early access requests
- Specific project launches
- Learning specific skills for near-term goals
- Networking for specific opportunities

EVERGREEN INTENTS (rarely expire without explicit markers):
- General research interests or areas of expertise
- Professional background and capabilities
- Open to consulting or advisory roles (general)
- Industry interests and passions
- Building long-term projects or companies
- Core professional identity statements

INTRO COMPATIBILITY - If the user has an intro (bio), old intents that are incompatible with the intro should be expired:
- If the intro describes a different role, company, or focus than the intent, the intent is likely outdated
- If the intro indicates the user has moved on from what the intent describes, mark it expired
- If the intro contradicts the intent (e.g., intro says "currently building X" but intent says "looking to build Y"), expire the intent

EXPIRATION GUIDELINES:
- A "looking for work" intent from 4+ months ago is likely stale (either found work or gave up)
- A "seeking co-founder" intent from 6+ months ago is probably outdated
- An event attendance from 2+ weeks ago is definitely expired
- General interests and expertise are evergreen regardless of age
- Consider context: "building X" is ongoing, "looking to build X" may expire
- If user has an intro that contradicts or supersedes the intent, expire it

An intent is NOT EXPIRED if:
- It's evergreen in nature (expertise, interests, ongoing projects)
- It's recent enough for its type (job search under 2 months, etc.)
- Context suggests ongoing relevance
- It's a statement of capability rather than seeking
- It's compatible with the user's current intro

Confidence scoring:
- 90-100: Clear expired temporal markers OR obviously stale for its intent type OR incompatible with intro
- 75-89: Strong signals of expiration (time-sensitive intent that's aged out or intro incompatibility)
- 70-74: Probable expiration (intent type + age suggest staleness or minor intro conflicts)
- Below 70: Not confident enough to archive

Be thoughtful about intent types but err on the side of caution.`;

export class IntentAuditor extends BaseLangChainAgent {
  constructor() {
    super({
      preset: 'intent-auditor',
      responseFormat: IntentAuditorOutputSchema,
      temperature: 0.1,
    });
  }

  /**
   * Runs the agent on the given intent content and context.
   * 
   * @param content - The intent payload text.
   * @param context - The context string (created date, user intro, etc.).
   */
  async run(content: string, context: string): Promise<IntentAuditorOutput | null> {
    logger.info(`[IntentAuditor] Processing intent...`);

    const prompt = `
      # Context
      ${context}

      # Intent Content
      ${content}
      
      Analyze this intent for expiration according to your instructions.
    `;

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.model.invoke({ messages });
      const output = result.structuredResponse as IntentAuditorOutput;

      logger.info(`[IntentAuditor] Analysis complete. Expired: ${output.isExpired}, Confidence: ${output.confidenceScore}`);
      return output;
    } catch (error) {
      logger.error("[IntentAuditor] Error during execution", { error });
      return null;
    }
  }
}
