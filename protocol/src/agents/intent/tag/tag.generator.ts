import { BaseLangChainAgent } from "../../../lib/langchain/langchain";
import { z } from "zod";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { log } from "../../../lib/log";
import { IntentTagGeneratorOutput } from "./tag.generator.types";

const logger = log.agent.from("agents/intent/tag/tag.generator.ts");

/**
 * Zod schema for the Intent Tag Generator output.
 */
const IntentTagGeneratorOutputSchema = z.object({
  suggestions: z.array(z.object({
    value: z.string().describe("Lowercase tag value to be added to prompt (1-3 words, clear and specific)"),
    score: z.number().min(0).max(1).describe("Relevance score between 0 and 1")
  })).describe("Array of tag suggestions ordered by relevance")
});

const SYSTEM_PROMPT = `
You are a tag suggestion analyst. Analyze user intents to identify themes and generate relevant tags.

Tag rules:
- 1-3 words, lowercase, specific
- Scores 0-1 (higher is better)
- Avoid generic terms like "technology" or "work"
- Each tag should cluster multiple related intents
- Order by relevance to user prompt (if provided) or prominence across intents
`;

export class IntentTagGenerator extends BaseLangChainAgent {
  constructor() {
    super({
      preset: 'intent-tag-generator',
      responseFormat: IntentTagGeneratorOutputSchema,
      temperature: 0.1,
    });
  }

  /**
   * Generates tags based on a list of intents and an optional user prompt.
   * 
   * @param intents - List of intent descriptions/payloads.
   * @param userPrompt - Optional user focus or specific request.
   */
  async run(intents: string[], userPrompt?: string): Promise<IntentTagGeneratorOutput | null> {
    logger.info(`[IntentTagGenerator] Generating tags for ${intents.length} intents...`);

    const intentList = intents.map(intent => `- ${intent}`).join('\n');

    const prompt = `
      ${userPrompt ? `User's focus: "${userPrompt}"\n\n` : ''}Analyze these intents and suggest relevant tags:

      ${intentList}
      
      Generate tag suggestions according to the rules.
    `;

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.model.invoke({ messages });
      const output = result.structuredResponse as IntentTagGeneratorOutput;

      logger.info(`[IntentTagGenerator] Generated ${output.suggestions.length} tags.`);
      return output;
    } catch (error) {
      logger.error("[IntentTagGenerator] Error during execution", { error });
      return null;
    }
  }
}
