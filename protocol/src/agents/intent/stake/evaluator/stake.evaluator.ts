import { createAgent, BaseLangChainAgent } from "../../../../lib/langchain/langchain";
import { z } from "zod";
import { StakeEvaluatorOutput } from "./stake.evaluator.types";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { log } from "../../../../lib/log";

const logger = log.agent.from("agents/intent/stake/evaluator/stake.evaluator.ts");

export const SYSTEM_PROMPT = `
  You are a semantic relationship analyst. Determine if two intents have MUTUAL relevance.

  INPUT:
  1. Primary Intent: A specific goal or need (User A)
  2. Candidate Intent: A potential match (User B)

  TASK:
  - Analyze if these two intents are COMPLEMENTARY or SIMILAR in a way that creates value.
  - Strict Mutuality: Both sides must gain from the connection.
  - Ignore superficial keywords if the core goal differs.

  OUTPUT:
  - isMatch: true/false
  - confidence: "high" | "medium" | "low"
  - reason: Concise explanation (1 sentence).

  CRITERIA for MATCH:
  - Supply meets Demand (e.g., "Offering Design" <-> "Looking for Designer")
  - Shared Goal (e.g., "Learn Rust" <-> "Study Partner for Rust")
  - Complementary Resources (e.g., "Has Capital" <-> "Needs Funding")
`;

export const MatchedStakeSchema = z.object({
  targetIntentId: z.string().describe("The ID of the candidate intent being evaluated"),
  isMutual: z.boolean().describe("Whether the two intents have mutual intent (both relate to or depend on each other)"),
  reasoning: z.string().describe("One sentence explanation. If mutual, explain why using subject matter. If not mutual, provide empty string."),
  confidenceScore: z.number().min(0).max(100).describe("Precise confidence score 0-100. Use full range 70-100 for mutual matches.")
});

export const StakeEvaluatorSchema = z.object({
  matches: z.array(MatchedStakeSchema).describe("List of evaluated matches")
});

/**
 * StakeEvaluator Agent
 * 
 * Analyzes two intents to determine if there is a "Mutual Stake" (Value-added connection).
 * 
 * CORE CRITERIA (Mutuality):
 * The connection must benefit BOTH parties.
 * - Good: "I want to hire design" <-> "I offer design" (Mutually beneficial)
 * - Bad: "I want to learn Rust" <-> "I am a Rust expert looking for funding" (One-sided, unless learner offers money)
 * 
 * ROLE IN SYSTEM:
 * - Used by `StakeService` to filter raw vector search candidates.
 * - Ensures we don't spam users with irrelevant connections just because embeddings were similar.
 */
export class StakeEvaluator extends BaseLangChainAgent {
  constructor(options: Partial<Parameters<typeof createAgent>[0]> = {}) {
    super({
      preset: 'intent-stake-evaluator',
      responseFormat: StakeEvaluatorSchema,
      temperature: 0.2, // Low temp for consistent scoring
      ...options
    });
  }

  /**
   * Batch Evaluation Logic
   * 
   * Compares one "Primary" intent against a list of "Candidate" intents.
   * 
   * WORKFLOW:
   * 1. Constructs a single prompt containing Primary and ALL Candidates.
   * 2. Asks LLM to evaluate IsMutual + Confidence + Reasoning for EACH.
   * 3. Filters results: Only returns matches with `isMutual=true` and `confidence >= 70`.
   * 
   * @param primaryIntent - The intent to find matches FOR.
   * @param candidates - List of potential matches (usually from vector search).
   * @returns Promise resolving to a list of High-Confidence Mutual Matches.
   */
  async run(
    primaryIntent: { id: string; payload: string },
    candidates: Array<{ id: string; payload: string }>
  ): Promise<StakeEvaluatorOutput> {
    logger.info(`[StakeEvaluator] Running match for intent "${primaryIntent.id}" against ${candidates.length} candidates.`);

    if (candidates.length === 0) {
      return { matches: [] };
    }

    // 2. Prepare Prompt
    const prompt = `
      Analyze the following intent against the candidates.

      PRIMARY INTENT:
      "${primaryIntent.payload}" (ID: ${primaryIntent.id})

      CANDIDATES:
      ${candidates.map((c, i) => `
        Candidate ${i + 1}:
        ID: ${c.id}
        Payload: "${c.payload}"
      `).join('\n')}

      For EACH candidate, determine isMutual, reasoning, and confidenceScore.
      Return the list of evaluations.
    `;

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt)
    ];

    try {
      // 3. Invoke LLM
      const result = await this.model.invoke({ messages });
      const output = result.structuredResponse as z.infer<typeof StakeEvaluatorSchema>;

      // 4. Process matches
      const finalMatches: StakeEvaluatorOutput['matches'] = [];

      for (const match of output.matches) {
        if (match.isMutual && match.confidenceScore >= 70) {
          finalMatches.push({
            candidateIntentId: match.targetIntentId, // normalized field name from schema
            isMatch: match.isMutual,
            confidence: match.confidenceScore,
            reason: match.reasoning
            // Removed extra fields to match pure interface if needed, or I should update interface.
            // Interface says: { candidateIntentId, isMatch, confidence, reason }
          });
        }
      }

      logger.info(`[StakeEvaluator] Found ${finalMatches.length} mutual matches (Score >= 70).`);
      return { matches: finalMatches };

    } catch (error) {
      logger.error("[StakeEvaluator] Error in StakeEvaluator run:", { error });
      return { matches: [] };
    }
  }
}
