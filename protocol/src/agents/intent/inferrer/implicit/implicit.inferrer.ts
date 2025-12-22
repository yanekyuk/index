import { BaseLangChainAgent } from "../../../../lib/langchain/langchain";
import { z } from "zod";
import { ImplicitInferrerOutputSchema, ImplicitIntent } from "./implicit.inferrer.types";
import { UserMemoryProfile } from "../../manager/intent.manager.types";
import { json2md } from "../../../../lib/json2md/json2md";
import { log } from "../../../../lib/log";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

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

export class ImplicitInferrer extends BaseLangChainAgent {
  constructor() {
    super({
      model: 'openai/gpt-4o', // Capable model for reasoning
      responseFormat: ImplicitInferrerOutputSchema,
      temperature: 0.1,
    });
  }

  /**
   * Infers an implicit intent for a user based on an opportunity match.
   */
  async run(
    profile: UserMemoryProfile,
    opportunityContext: string
  ): Promise<ImplicitIntent | null> {
    log.info(`[ImplicitInferrer] Inferring intent from opportunity context...`);

    const prompt = `
      # User Profile
      ${json2md.fromObject({
      bio: profile.identity.bio,
      aspirations: profile.narrative?.aspirations,
      context: profile.narrative?.context
    })}

      # Opportunity Context
      "${opportunityContext}"

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
        log.info(`[ImplicitInferrer] Low confidence (${output.intent.confidence}), skipping.`);
        return null;
      }

      log.info(`[ImplicitInferrer] Inferred intent: "${output.intent.payload}"`);
      return output.intent;
    } catch (error) {
      log.error("[ImplicitInferrer] Error inferring implicit intent", { error });
      return null;
    }
  }
}
