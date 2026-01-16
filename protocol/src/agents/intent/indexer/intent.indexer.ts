import { BaseLangChainAgent } from "../../../lib/langchain/langchain";
import { z } from "zod";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { log } from "../../../lib/log";
import { IntentIndexerOutput } from "./intent.indexer.types";

const SYSTEM_PROMPT = `
You are an expert Intent Evaluator for a social networking protocol.

TASK:
Determine if a User Intent is appropriate for a specific Index (community) and matches a Member's sharing preferences.

INPUTS:
1. Intent: The content/action the user wants to perform.
2. Index Prompt: The purpose/scope of the target community (Index).
3. Member Prompt: The specific sharing preferences of the user in that community (optional).
4. Source: Origin of the intent (file, link, etc.) (optional).

SCORING RUBRIC:
- 0.9-1.0: Highly appropriate, perfect match.
- 0.7-0.8: Good match, relevant.
- 0.5-0.6: Moderate, borderline.
- 0.3-0.4: Low appropriateness, poor fit.
- 0.0-0.2: Not appropriate.

OUTPUT RULES:
- Provide \`indexScore\` based on how well the Intent fits the Index Prompt.
- Provide \`memberScore\` based on how well the Intent fits the Member Prompt (if provided). If Member Prompt is missing/empty, return 0.0 for memberScore.
- Provide concise \`reasoning\`.
`;

/**
 * Zod schema for the Intent Evaluator output.
 */
const IntentIndexerOutputSchema = z.object({
  indexScore: z.number().min(0).max(1).describe("Score for index appropriateness (0.0-1.0)"),
  memberScore: z.number().min(0).max(1).describe("Score for member preference match (0.0-1.0)"),
  reasoning: z.string().describe("Brief reasoning for the scores"),
});

export class IntentIndexer extends BaseLangChainAgent {
  constructor() {
    super({
      model: 'openai/gpt-4o',
      responseFormat: IntentIndexerOutputSchema,
      temperature: 0.1, // Deterministic evaluation
    });
  }

  /**
   * Evaluates the appropriateness of an intent for a given index and member context.
   * 
   * @param intent - The intent payload.
   * @param indexPrompt - The purpose of the index.
   * @param memberPrompt - The member's sharing preferences.
   * @param sourceName - Optional source name for context.
   */
  async evaluate(
    intent: string,
    indexPrompt: string | null,
    memberPrompt: string | null,
    sourceName?: string | null
  ): Promise<IntentIndexerOutput | null> {
    log.info(`[IntentIndexer] Evaluating intent...`);

    const contextParts = [];
    if (sourceName) contextParts.push(`Source: ${sourceName}`);
    if (indexPrompt) contextParts.push(`Index Purpose: ${indexPrompt}`);
    else contextParts.push(`Index Purpose: (Not provided)`);

    if (memberPrompt) contextParts.push(`Member Preferences: ${memberPrompt}`);
    else contextParts.push(`Member Preferences: (Not provided)`);

    const prompt = `
      # Context
      ${contextParts.join('\n')}

      # Intent
      ${intent}
      
      Evaluate the appropriateness of this intent.
    `;

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.model.invoke({ messages });
      const output = result.structuredResponse as IntentIndexerOutput;

      log.info(`[IntentIndexer] Evaluation complete. IndexScore: ${output.indexScore}, MemberScore: ${output.memberScore}`);
      return output;
    } catch (error) {
      log.error("[IntentIndexer] Error during execution", { error });
      return null;
    }
  }
}
