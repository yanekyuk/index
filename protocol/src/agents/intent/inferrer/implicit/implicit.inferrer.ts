import { BaseLangChainAgent } from "../../../../lib/langchain/langchain";
import { z } from "zod";
import { ImplicitInferrerOutputSchema, ImplicitIntent } from "./implicit.inferrer.types";

import { log } from "../../../../lib/log";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

const logger = log.agent.from("agents/intent/inferrer/implicit/implicit.inferrer.ts");

// TODO: (@yanekyuk) Currently this returns "Expand my professional network in the tech community to gain insights into AI applications in AdTech"
//                    AdTech Part is too much specificity.
const SYSTEM_PROMPT = `
You are an expert Implicit Intent Inferrer.
Your task is to deduce the UNDERLYING user goal (Implicit Intent) that makes a specific Opportunity relevant to them.

Input:
1. User Profile (Who they are)
2. Opportunity Context (Why we matched them)

Output:
- A concise, first-person "Implicit Intent" that describes what the user is trying to achieve.
- Example: "Connect with Rust developers to learn systems programming" or "Find a co-founder for a fintech startup".

Constraint:
- The intent must be actionable and specific to the goal.
- IT MUST NOT CONTAIN PERSONAL NAMES (e.g., "Collaborate with John Doe" -> "Collaborate with a digital media expert").
- It must logically bridge the User's profile to the Opportunity.
- Focus on the content/topic/goal of the opportunity, not the specific person being matched.
`;

/**
 * ImplicitInferrer Agent
 * 
 * "Implicit" intents are goals that a user has NOT explicitly stated, but are logically necessary
 * to make a specific matching "Opportunity" valuable to them.
 * 
 * EXAMPLE:
 * - User: "Bio: Backend Engineer interested in Crypto"
 * - Opportunity: "Hackathon looking for Solidity developers"
 * - Implicit Intent: "Learn Solidity to participate in hackathons" (Inferred)
 * 
 * PURPOSE:
 * Bridges the gap between a generic profile and a specific opportunity, allowing us to "guess"
 * what the user *might* want, even if they haven't said it yet.
 */
export class ImplicitInferrer extends BaseLangChainAgent {
  constructor() {
    super({
      preset: 'implicit-intent-inferrer', // Capable model for reasoning
      responseFormat: ImplicitInferrerOutputSchema,
      temperature: 0.1,
    });
  }

  /**
   * Infers the missing "Why" link between a user and an opportunity.
   * 
   * LOGIC:
   * 1. Reads the user's Bio/Narrative.
   * 2. Reads the "Reasoning" for why an Opportunity was matched.
   * 3. Halls hallucinate a specific, first-person goal that would constrain this match.
   * 
   * @param profileContext - The formatted user's memory profile string.
   * @param opportunityContext - The string explanation of the opportunity match.
   * @returns A Promise resolving to an `ImplicitIntent` or null if confidence is low.
   */
  async run(
    profileContext: string,
    additionalContext: string
  ): Promise<ImplicitIntent | null> {
    logger.info(`[ImplicitInferrer] Inferring intent from opportunity context...`);

    const prompt = `
      # User Profile
      ${profileContext}

      # Additional Context
      "${additionalContext}"

      Based on this, what is the implicit intent/goal for this user?
    `;

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.model.invoke({ messages });
      const output = result.structuredResponse as z.infer<typeof ImplicitInferrerOutputSchema>;

      if (output.intent.confidence < 70) {
        logger.info(`[ImplicitInferrer] Low confidence (${output.intent.confidence}), skipping.`);
        return null;
      }

      logger.info(`[ImplicitInferrer] Inferred intent: "${output.intent.payload}"`);
      return output.intent;
    } catch (error) {
      logger.error("[ImplicitInferrer] Error inferring implicit intent", { error });
      return null;
    }
  }
}
