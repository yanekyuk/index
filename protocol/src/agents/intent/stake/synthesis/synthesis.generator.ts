import { BaseLangChainAgent, createAgent } from "../../../../lib/langchain/langchain";
import { format } from 'timeago.js';
import { z } from "zod";
import { log } from "../../../../lib/log";
import { SynthesisGeneratorInput, SynthesisGeneratorResult } from "./synthesis.generator.types";

const logger = log.agent.from("agents/intent/stake/synthesis/synthesis.generator.ts");
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

/**
 * Model Configuration
 */
export const SYSTEM_PROMPT = `
You are a collaboration synthesis generator. Create a concise 1-3 sentence explanation of why two people are mutual matches based on what they're explicitly looking for.

Also generate a short, punchy title for this match.

Style for Body:
- Warm and friendly, not formal (we're introducing humans, not robots)
- Direct and concise - exactly 1-3 sentences
- Add a small human touch—a light joke, casual aside, or relatable moment. Keep it natural.
- Clearly signal why the match works

Style for Subject (Title):
- Format: "{{target}} — [descriptive title]"
- Include the person's name ({{target}}) followed by em dash
- Stay under 12 words total
- Sound warm, professional, and action-oriented

Format:
- Body Markdown with inline hyperlinks: [descriptive phrase](https://index.network/intents/ID)
- **CRITICAL LINKING RULE**: ONLY hyperlink the INITIATOR'S intents. NEVER hyperlink {{target}}'s intents.
- Check the XML inputs: Only use IDs from <your_intent> or <{{initiator}}_intent>. DO NOT use IDs from <{{target}}_intent>.
- Hyperlinks must be max 3 words.
- Link natural phrases.
- No bold, italic, or title

Structure:
- Start with what {{initiator}} is explicitly looking for
- State what {{target}} provides or is looking for
- Explain the mutual fit using present tense and direct language
- Keep it to 1-3 sentences total.
- COMPREHENSIVENESS: If multiple distinct match topics exist (e.g. Funding AND Networking), you MUST mention ALL of them (and link the Initiator's intent for each). Combine them into the narrative.
`;

/**
 * Output Schemas
 */
export const SynthesisGeneratorOutputSchema = z.object({
  subject: z.string().describe("A short, punchy title for this match (under 12 words)"),
  body: z.string().describe("A concise 1-2 sentence explanation of why they match, with inline markdown links to context user intents")
});

export type SynthesisGeneratorOutput = z.infer<typeof SynthesisGeneratorOutputSchema>;

/**
 * SynthesisGenerator Agent
 * 
 * Generates the user-facing "Vibe Check" or "Synthesis" text that explains why a match exists.
 * 
 * OUTPUT CONTENT:
 * 1. Subject/Title: A punchy, short header for the match.
 * 2. Body: A warm, 1-2 sentence narrative explaining the mutual fit.
 * 
 * FEATURES:
 * - Dynamic Voice: Swaps "You" vs "Initiator Name" based on context (First vs Third person).
 * - Hyperlinking: Can insert markdown links to specific Intent IDs for context.
 * - Tone: Enforced as "Warm, Friendly, Professional" (not robotic).
 */
export class SynthesisGenerator extends BaseLangChainAgent {
  constructor(options: Partial<Parameters<typeof createAgent>[0]> = {}) {
    super({
      preset: 'synthesis-generator',
      responseFormat: SynthesisGeneratorOutputSchema,
      temperature: 0.2,
      ...options
    });
  }

  /**
   * Generates the synthesis text.
   * 
   * LOGIC:
   * 1. Constructs a dynamic prompt based on who is viewing (Initiator/Subject vs Third Person).
   * 2. Feeds in the exact "Intent Pairs" that triggered the match (so the LLM knows WHY they matched).
   * 3. Feeds in the Target's Intro/Bio for personalization.
   * 
   * @param input - Structured input containing users, context, and intent pairs.
   * @returns Promise resolving to `SynthesisGeneratorResult` (subject + body).
   */
  async run(input: SynthesisGeneratorInput): Promise<SynthesisGeneratorResult> {
    const { initiator, target, targetIntro, isThirdPerson, intentPairs, characterLimit } = input;

    // Dynamic System Prompt adjustment
    // We handle perspective via specific rules, not just blind replace which breaks grammar.
    // {{target}} is safe to replace.
    const perspectiveRule = isThirdPerson
      ? `perspective: Third Person. Refer to the initiator as "${initiator}" and the match as "${target}".`
      : `perspective: Second Person. Refer to the initiator as "You" and the match as "${target}".`;

    let systemMsgContent = SYSTEM_PROMPT
      .replace(/{{target}}/g, target)
      .replace(/{{initiator}}/g, isThirdPerson ? initiator : 'You');

    systemMsgContent += `\n\n${perspectiveRule}`;

    if (characterLimit) {
      systemMsgContent += `\n- Maximum ${characterLimit} characters for body`;
    }

    // User prompt
    const userMsg = this.buildUserMessage(input, initiator, target, isThirdPerson || false);

    const messages = [
      new SystemMessage(systemMsgContent),
      new HumanMessage(userMsg),
    ];

    try {
      const result = await this.model.invoke(messages);

      // Typed response from structure output
      const response = result.structuredResponse as SynthesisGeneratorResult;

      // Fallback or validation if needed, but Zod handles it
      if (!response) {
        throw new Error("Empty response from SynthesisGenerator");
      }

      return response;
    } catch (error) {
      logger.error("[SynthesisGenerator] Error generating vibe check", { error });
      throw error;
    }
  }

  private buildUserMessage(
    data: SynthesisGeneratorInput,
    initiator: string,
    target: string,
    isThirdPerson: boolean
  ) {
    const pairsXml = data.intentPairs
      .slice(0, 3)
      .map((pair, i) => {
        const contextLabel = isThirdPerson ? `${initiator}_intent` : 'your_intent';
        const targetLabel = `${target.toLowerCase().replace(/\s+/g, '_')}_intent`;

        return `  <pair_${i + 1}>
    <${contextLabel} id="${pair.contextUserIntent.id}">
      <what_they_want>${pair.contextUserIntent.payload}</what_they_want>
      <created>${format(pair.contextUserIntent.createdAt)}</created>
    </${contextLabel}>
    <${targetLabel} id="${pair.targetUserIntent.id}">
      <what_they_want>${pair.targetUserIntent.payload}</what_they_want>
      <created>${format(pair.targetUserIntent.createdAt)}</created>
    </${targetLabel}>
  </pair_${i + 1}>`;
      })
      .join('\n');

    return {
      role: "user",
      content: `Generate collaboration synthesis between ${initiator} ${isThirdPerson ? `and ${target}` : `(authenticated user) and ${target}`}.

<other_person>
  <name>${target}</name>
  <bio>${data.targetIntro}</bio>
</other_person>

<intent_pairs>
${pairsXml}
</intent_pairs>

Note: Use the actual <created> timestamps from the intent pairs above.`
    };
  }
}
