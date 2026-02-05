import { BaseLangChainAgent } from "../../../lib/langchain/langchain";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { log } from "../../../lib/log";
import { z } from "zod";
import { IntentRefinerOutput } from "./intent.refiner.types";

const logger = log.agent.from("agents/intent/refiner/intent.refiner.ts");

/**
 * System prompt defining the IntentRefiner's behavior.
 * 
 * The agent combines an original intent with followup input to produce
 * a refined, more specific intent that preserves the core meaning.
 */
const SYSTEM_PROMPT = `You are an intent refinement specialist. Your task is to refine a user's intent based on their followup input.

Rules:
- Combine the original intent with the followup refinement
- Keep the refined intent concise and clear (under 500 characters)
- Preserve the core meaning while incorporating the refinement
- Output ONLY the refined intent text, nothing else`;

/**
 * Zod schema for structured output.
 * 
 * Note: OpenAI structured output requires all fields to be defined.
 */
const IntentRefinerOutputSchema = z.object({
  refinedPayload: z.string().max(500).describe("The refined intent text combining original with followup"),
});

/**
 * IntentRefiner combines an original intent with followup input to produce
 * a refined, more specific intent.
 * 
 * @example
 * ```ts
 * const refiner = new IntentRefiner();
 * const result = await refiner.run(
 *   "Looking for AI startups",
 *   "Only in the healthcare sector"
 * );
 * // Returns: { refinedPayload: "Looking for AI startups focused on healthcare" }
 * ```
 */
export class IntentRefiner extends BaseLangChainAgent {
  constructor() {
    super({
      preset: 'intent-refiner',
      responseFormat: IntentRefinerOutputSchema,
      temperature: 0.3, // Lower temperature for more consistent refinements
    });
  }

  /**
   * Refines an intent by combining it with followup input.
   * 
   * @param originalPayload - The original intent text
   * @param followupText - The followup refinement to incorporate
   * @returns Refined intent payload or null if generation fails
   */
  async run(originalPayload: string, followupText: string): Promise<IntentRefinerOutput | null> {
    logger.info(`[IntentRefiner] Refining intent...`);

    const prompt = `Original intent: ${originalPayload}

Followup refinement: ${followupText}

Generate the refined intent:`;

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.model.invoke({ messages });
      const output = result.structuredResponse as IntentRefinerOutput;

      logger.info(`[IntentRefiner] Refined payload: ${output.refinedPayload.substring(0, 50)}...`);
      return output;
    } catch (error: any) {
      logger.error("[IntentRefiner] Error during execution", {
        error,
        message: error?.message,
        stack: error?.stack
      });
      return null;
    }
  }
}
