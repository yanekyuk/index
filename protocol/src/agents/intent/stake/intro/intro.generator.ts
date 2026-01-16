import { BaseLangChainAgent, createAgent } from "../../../../lib/langchain/langchain";
import { z } from "zod";
import { IntroGeneratorInput, IntroGeneratorResult } from "./intro.generator.types";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

/**
 * Model Configuration
 */
export const SYSTEM_PROMPT = `
You are an email introduction writer. Generate warm, conversational synthesis explaining why two people should connect.

Style:
- 2-3 sentences max
- Warm and conversational, not formal
- Focus on shared themes or complementary work
- No "What could happen here" phrasing
- Assume greetings already said
- No intent IDs or links

CRITICAL INSTRUCTIONS:
- You must ONLY output the synthesis text.
- NEVER ask for more information or clarification.
- If information is sparse, do your best to write a generic but warm connection statement based on available user names or vague reasons.
- Do NOT output "I need more detail" or similar refusals. Just write the synthesis.
`;

/**
 * Output Schemas
 */
export const IntroGeneratorOutputSchema = z.object({
  synthesis: z.string().describe("A warm, 2-3 sentence paragraph explaining the connection.")
});

/**
 * IntroGenerator Agent
 * 
 * Generates introduction synthesis text for user connection emails.
 */
export class IntroGenerator extends BaseLangChainAgent {
  constructor(options: Partial<Parameters<typeof createAgent>[0]> = {}) {
    super({
      model: 'openai/gpt-4o',
      responseFormat: IntroGeneratorOutputSchema,
      temperature: 0.4, // Slightly higher for "warmth"
      ...options
    });
  }

  /**
   * Generates the intro synthesis.
   * 
   * @param input - Structured input containing sender/recipient names and reasonings.
   * @returns Promise resolving to `IntroGeneratorResult` (synthesis).
   */
  async run(input: IntroGeneratorInput): Promise<IntroGeneratorResult> {
    const { sender, recipient } = input;

    const userMessage = `Write introduction synthesis for email connecting two users.

${sender.name}:
${sender.reasonings.map(r => `- ${r}`).join('\n')}

${recipient.name}:
${recipient.reasonings.map(r => `- ${r}`).join('\n')}

Example: "You both share a strong focus around coordination without platforms and trust-preserving discovery. Sarah's working on agent-led systems that negotiate access based on context, while David is exploring intent schemas that don't rely on reputation scores. This feels like a connection where you could build something meaningful together."

Generate synthesis:`;

    const rawResult: any = await this.model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(userMessage)
    ]);
    // console.log("[IntroGenerator] Raw LLM Result:", JSON.stringify(rawResult, null, 2));

    const output = rawResult.structuredResponse || rawResult;

    return {
      synthesis: output.synthesis
    };
  }
}
