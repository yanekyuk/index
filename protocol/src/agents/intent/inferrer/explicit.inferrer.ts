import { createAgent, BaseLangChainAgent } from "../../../lib/langchain/langchain";
import { UserMemoryProfile } from "../manager/intent.manager.types";
import { IntentDetector, IntentDetectorResponse } from "./explicit.inferrer.types";
import { json2md } from "../../../lib/json2md/json2md";
import { z } from "zod";

/**
 * Model Configuration
 */
export const SYSTEM_PROMPT = `
  You are an expert Intent Analyst. Your goal is to infer the user's current intentions based on their profile and new content.

  You have access to:
  1. User Memory Profile (Identity, Narrative, Attributes) - The long-term context.
  2. New Content - What they just said/did.

  YOUR TASK:
  Analyze the "New Content" in the context of the "Profile".
  Extract a list of **Inferred Intents**.

  INTENT TYPES:
  - 'goal': The user wants to start, continue, or achieve something. (e.g., "I want to learn Rust", "Looking for a co-founder")
  - 'tombstone': The user explicitly states they have COMPLETED, stopped, or abandoned a goal. (e.g., "I finished the course", "I'm done with crypto", "Delete my running goal")

  RULES:
  - Be precise.
  - Descriptions should be self-contained (e.g., "Learn Rust programming" instead of "Learn it").
  - Do NOT try to manage existing IDs or check for duplicates. Just extract what is valid NOW.
  - If "New Content" is empty, look at the Profile (Narrative/Goals) and extract implied ongoing goals.
`;


/**
 * Output Schemas
 */
export const InferredIntentSchema = z.object({
  type: z.enum(['goal', 'tombstone']),
  description: z.string().describe("Concise description of the intent"),
  reasoning: z.string().describe("Why this intent was inferred"),
  confidence: z.enum(['high', 'medium', 'low'])
});

export const ExplicitInferrerOutputSchema = z.object({
  intents: z.array(InferredIntentSchema).describe("List of inferred intents")
});

export type ExplicitInferrerOutput = z.infer<typeof ExplicitInferrerOutputSchema>;

export class ExplicitIntentDetector extends BaseLangChainAgent {
  constructor() {
    super({
      preset: 'intent-inferrer',
      responseFormat: ExplicitInferrerOutputSchema,
      temperature: 0.5,
    });
  }

  /**
   * Evaluates new content against the user's profile to infer intents.
   *
   * @param content - The new user input or context string.
   * @param profile - The user's long-term memory profile.
   * @returns A Promise resolving to an object containing a list of inferred intents.
   */
  async run(content: string | null, profile: UserMemoryProfile): Promise<IntentDetectorResponse> {

    console.debug('Profile: ', profile);

    const prompt = `
      Context:
      # User Memory Profile
      ${this.formatProfile(profile)}

      ## New Content
      ${content ? content : '(None. Please infer intents from Profile Narrative and Aspirations)'}
    `;

    console.debug('Prompt: ', prompt);

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ];

    try {
      // Invoke pre-initialized agent
      const result = await this.model.invoke({ messages });
      // Return structured response directly
      return result.structuredResponse as IntentDetectorResponse;
    } catch (error) {
      console.error("Error in ExplicitIntentDetector", error);
      // Fallback: return empty intents if LLM fails
      return { intents: [] };
    }
  }
  // TODO: json2md should handle profile. Add tests to json2md with a profile object
  private formatProfile(profile: UserMemoryProfile): string {
    return json2md.keyValue(profile);
  }

}
