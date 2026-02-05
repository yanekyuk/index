import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';

import { BaseLangChainAgent } from '../../../lib/langchain/langchain';
import { log } from '../../../lib/log';
import { Embedder } from '../../common/types';

const logger = log.agent.from("agents/profile/hyde/hyde.generator.ts");

// System prompt for HyDE Generation
const HYDE_GENERATION_PROMPT = `
    You are a Profile Profiler.
    Given a user's profile, imagine a **Hypothetical User Profile** person that would be the best match for the user to accomplish their goals.
    
    Imagine this ideal candidate actually exists. Write a profile for THEM.
    Your output will be used to vector-search a database of real user profiles.

    Structure your response as a natural language Bio/Narrative written in the **Third Person**.
    
    The description should include:
    1. **Context**: Who they are (role, background).
    2. **Skills/lnterests**: What they are good at that complements the user.
    3. **Goals**: What they are trying to achieve that aligns with the user.
    
    **CRITICAL INSTRUCTION - COMPLEMENTARY MATCHING:**
    - Do NOT just look for "similar" people. Look for people who provide what the user NEEDS (Supply/Demand).
    - If the user is a **Founder**, describe an **Investor** or **VC**.
    - If the user is a **Learner**, describe a **Mentor** or **Expert**.
    - If the user is a **Builder**, describe a **Collaborator** or **Co-founder**.
    
    Do NOT describe the Source User. Describe the TARGET Match.
    Do NOT invent a name for the candidate. Refer to them as "The candidate", "They", or "This individual".
    Do NOT include locations.
`;

const HydeDescriptionSchema = z.object({
  description: z.string().describe("The hypothetical ideal candidate description"),
});

export interface HydeResponse {
  description: string;
  embedding?: number[];
}

export interface HydeOptions {
  /** Optional instruction to guide the type of match (e.g., "investors", "advisors", "collaborators") */
  instruction?: string;
}

/**
 * HydeGenerator Agent (Hypothetical Document Embeddings)
 * 
 * Generates a "Hypothetical Ideal Profile" (HyDE) based on a user's aspirations.
 * 
 * CORE CONCEPT:
 * Instead of searching for "Who matches User A?", we ask the LLM:
 * "Imagine the perfect person to help User A achieve their goals. Describe that person."
 * 
 * We then embed THAT hypothetical description and search the vector database for real users who look like it.
 * This technique (HyDE) significantly improves semantic retrieval for "Complementary" matches 
 * (Supply vs Demand) rather than just "Similarity" matches.
 */
export class HydeGeneratorAgent extends BaseLangChainAgent {
  private embedder?: Embedder;

  constructor(embedder?: Embedder) {
    super({
      preset: 'hyde-generator',
      temperature: 0.5,
      responseFormat: HydeDescriptionSchema
    });
    this.embedder = embedder;
  }

  /**
   * Generates a hypothetical "Ideal Match" description.
   * 
   * @param profileContext - The formatted source user's memory profile (who is looking).
   * @param options - Optional configuration including instruction to bias the match type.
   * @returns Promise resolving to a string description of the *Target* user.
   */
  async generate(profileContext: string, options?: HydeOptions): Promise<HydeResponse> {
    const instruction = options?.instruction;
    
    // Build the human message with optional instruction
    let humanPrompt = `
        Person who is looking for a match:
        ${profileContext}
        
        Who is the single most valuable connection for this person right now? 
        Describe that Person.
      `;
    
    // If instruction provided, add it to guide the match type
    if (instruction) {
      humanPrompt = `
        Person who is looking for a match:
        ${profileContext}
        
        **SPECIFIC SEARCH CONTEXT**: ${instruction}
        
        Based on this context, describe the ideal person to connect with.
        Focus on finding someone who matches this specific need.
      `;
    }

    const messages = [
      new SystemMessage(HYDE_GENERATION_PROMPT),
      new HumanMessage(humanPrompt)
    ];

    logger.info(`[HydeGenerator] Generating HyDE profile for user...`);

    try {
      // The model is configured with structured output
      const result = await this.model.invoke(messages) as any;

      // Handle potential wrapping of structured output
      let description = "";
      if (result.structuredResponse) {
        description = result.structuredResponse.description;
      } else {
        description = result.description;
      }

      logger.info(`[HydeGenerator] Successfully generated HyDE profile.`);

      let embedding: number[] | undefined;
      if (this.embedder) {
        logger.info(`[HydeGenerator] Generating embedding for HyDE profile...`);
        const embedResult = await this.embedder.generate(description);
        // Helper to handle number[] | number[][]
        embedding = Array.isArray(embedResult[0]) ? (embedResult as number[][])[0] : (embedResult as number[]);
      }

      return { description, embedding };

    } catch (error) {
      logger.error("[HydeGenerator] Error generating HyDE profile", { error });
      throw error;
    }
  }
}
