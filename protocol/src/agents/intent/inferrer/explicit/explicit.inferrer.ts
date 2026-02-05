import { createAgent, BaseLangChainAgent } from "../../../../lib/langchain/langchain";

import { IntentDetector, IntentDetectorResponse } from "./explicit.inferrer.types";

import { z } from "zod";
import { log } from "../../../../lib/log";

const logger = log.agent.from("agents/intent/inferrer/explicit/explicit.inferrer.ts");

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
  - If "New Content" is empty or invalid, look at the Profile (Narrative/Goals) and extract implied ongoing goals.
  - IGNORE purely phatic communication (e.g., "Hello", "Hi", "Good morning") or empty statements. Do NOT fallback to Profile for these; return empty intents.
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

/**
 * ExplicitIntentInferrer Agent
 * 
 * Specialized agent for EXTRACTING intents directly from user input.
 * 
 * PURPOSE:
 * To parse unstructured user statements (messages, notes) into structured Intent Candidates.
 * It primarily looks for:
 * 1. "Goals" (I want to X)
 * 2. "Tombstones" (I am done with Y)
 * 
 * NOTE: 
 * This agent does NOT decide if an intent is "New" or a "Duplicate". 
 * It purely extracts what it sees. The `IntentManager` handles the state logic.
 */
export class ExplicitIntentInferrer extends BaseLangChainAgent {
  constructor() {
    super({
      preset: 'explicit-intent-inferrer',
      responseFormat: ExplicitInferrerOutputSchema,
      temperature: 0.5,
    });
  }

  /**
  /**
   * Run the extraction process.
   * 
   * @param content - The raw string content to analyze.
   * @param profileContext - The formatted profile context string.
   * @returns A Promise resolving to a list of `InferredIntent` objects.
   */
  async run(content: string | null, profileContext: string): Promise<IntentDetectorResponse> {
    const prompt = `
      Context:
      # User Memory Profile
      ${profileContext}

      ${content ? `## New Content\n\n${content}` : '(No content provided. Please infer intents from Profile Narrative and Aspirations)'}
    `;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ];

    try {
      // Invoke pre-initialized agent
      const result = await this.model.invoke({ messages });
      // Return structured response directly
      const response = result.structuredResponse as IntentDetectorResponse;
      logger.info(`[ExplicitIntentInferrer] Found ${response.intents.length} intents in content.`);
      return response;
    } catch (error) {
      logger.error("[ExplicitIntentInferrer] Error in ExplicitIntentInferrer", { error });
      // Fallback: return empty intents if LLM fails
      return { intents: [] };
    }
  }
}
