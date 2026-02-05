import { BaseLangChainAgent } from "../../../lib/langchain/langchain";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { log } from "../../../lib/log";
import { z } from "zod";
import { IntentSuggesterOutput } from "./intent.suggester.types";

const logger = log.agent.from("agents/intent/suggester/intent.suggester.ts");

/**
 * System prompt defining the IntentSuggester's behavior.
 * 
 * The agent generates contextual refinement suggestions that help users
 * narrow down their intents. It produces two types of suggestions:
 * - "direct": Complete refinements applied immediately on click
 * - "prompt": Partial refinements that prefill the input for user completion
 */
const SYSTEM_PROMPT = `You are a helpful assistant that suggests ways to refine or narrow down a user's intent.

Generate 3-5 contextual refinement suggestions based on the user's intent. Each suggestion has:
- label: Short chip label (max 40 chars)
- type: Either "direct" or "prompt"
- followupText: Complete refinement text (required for "direct" type)
- prefill: Partial text for user to complete (required for "prompt" type)

Use "direct" type when the suggestion is complete and can be applied immediately:
- { label: "Founded recently", type: "direct", followupText: "Founded in the last 2 years" }
- { label: "Seed stage only", type: "direct", followupText: "Only seed stage companies" }

Use "prompt" type when user input is needed to complete the refinement:
- { label: "Add location", type: "prompt", prefill: "Focus on companies based in " }
- { label: "Specific industry", type: "prompt", prefill: "In the " }
- { label: "Company size", type: "prompt", prefill: "With team size of " }

Mix both types to give users quick options and customizable refinements.`;

/**
 * Zod schema for validating the structured output.
 * Ensures the LLM response matches the expected format.
 * 
 * Note: OpenAI structured output requires `.nullable()` for optional fields.
 */
const SuggestionSchema = z.object({
  label: z.string().max(40).describe("Short chip label (max 40 chars)"),
  type: z.enum(["direct", "prompt"]).describe("direct = apply on click, prompt = prefill input for user to complete"),
  followupText: z.string().nullable().describe("The followup text to apply (required for direct type)"),
  prefill: z.string().nullable().describe("Partial text to prefill input (required for prompt type)"),
});

const IntentSuggesterOutputSchema = z.object({
  suggestions: z.array(SuggestionSchema).describe("Array of 3-5 refinement suggestions"),
});

/**
 * IntentSuggester generates contextual refinement suggestions for user intents.
 * 
 * Given an intent payload, this agent produces a list of chip-style suggestions
 * that help users narrow down or clarify their intent. The suggestions are
 * designed to be displayed as clickable chips in the UI.
 * 
 * @example
 * ```ts
 * const suggester = new IntentSuggester();
 * const result = await suggester.run("Looking for AI startups to invest in");
 * // Returns suggestions like:
 * // [
 * //   { label: "Seed stage", type: "direct", followupText: "Only seed stage companies" },
 * //   { label: "Add location", type: "prompt", prefill: "Based in " }
 * // ]
 * ```
 */
export class IntentSuggester extends BaseLangChainAgent {
  constructor() {
    super({
      preset: 'intent-suggester',
      responseFormat: IntentSuggesterOutputSchema,
      temperature: 0.7, // Slightly higher temperature for creative suggestions
    });
  }

  /**
   * Generates refinement suggestions for the given intent payload.
   * 
   * Analyzes the intent content and produces 3-5 contextual suggestions
   * that help the user narrow down or clarify their intent.
   * 
   * @param intentPayload - The intent text to generate suggestions for
   * @returns Structured suggestions or null if generation fails
   */
  async run(intentPayload: string): Promise<IntentSuggesterOutput | null> {
    logger.info(`[IntentSuggester] Generating suggestions for intent...`);

    const prompt = `Generate refinement suggestions for this intent:

${intentPayload}`;

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.model.invoke({ messages });
      const output = result.structuredResponse as IntentSuggesterOutput;

      logger.info(`[IntentSuggester] Generated ${output.suggestions.length} suggestions`);
      return output;
    } catch (error: any) {
      logger.error("[IntentSuggester] Error during execution", {
        error,
        message: error?.message,
        stack: error?.stack
      });
      return null;
    }
  }
}
