// src/agents/intent/input-validator/input-validator.ts

import { BaseLangChainAgent } from "../../../../lib/langchain/langchain";
import { z } from "zod";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { log } from "../../../../lib/log";
import { SyntacticValidatorOutput } from "./syntactic.evaluator.types";

const SYSTEM_PROMPT = `
  You are the Input Validation Gatekeeper for an Intent Protocol.

  TASK:
  Analyze the provided user text for structural integrity, language, and intelligibility. 
  You do NOT evaluate the intent's validity (e.g., if it's a lie); you only evaluate if it is *processable* text.

  INPUTS:
  1. User Text: The raw string to validate.

  CRITERIA FOR "PASS":
  - Language is English.
  - Text is intelligible (grammatically coherent, not random keystrokes).
  - Text is not obvious spam or malicious code injection.

  CRITERIA FOR "FAIL":
  - Gibberish (e.g., "asdf jkl", "h3ll0 w0rld").
  - Non-English text.
  - Malformed encoding or broken characters.
  - Extremely short/empty inputs (less than 3 meaningful words).

  OUTPUT RULES:
  - Return a strict JSON object.
  - 'status' must be "PASS" or "FAIL".
  - 'is_intelligible' must be boolean.
  - 'rejection_reason' is required only if status is "FAIL".
`;

// Define the Zod schema locally
const SyntacticValidatorOutputSchema = z.object({
  status: z.enum(["PASS", "FAIL"]).describe("Validation result"),
  language: z.string().length(2).describe("ISO 639-1 Language Code (e.g., 'en')"),
  is_intelligible: z.boolean().describe("Is the text coherent English?"),
  rejection_reason: z.string().nullable().describe("Reason for failure, if any"),
});

export class SyntacticValidatorAgent extends BaseLangChainAgent {
  constructor() {
    super({
      // Phase 1 uses a fast, cheap model as it runs on EVERY input
      model: 'openai/gpt-4o-mini',
      responseFormat: SyntacticValidatorOutputSchema,
      temperature: 0.0, // Strict determinism required for filters
    });
  }

  /**
   * Validates the raw input string.
   * * @param content - The raw user text (intent).
   * @param context - (Optional) Unused in this phase, kept for interface consistency.
   */
  async run(content: string): Promise<SyntacticValidatorOutput | null> {
    log.info(`[InputValidator] Validating input length: ${content.length}`);

    // Pre-flight optimization: Auto-fail empty or extremely short strings
    // This saves an LLM call for obvious garbage.
    if (!content || content.trim().length < 5) {
      log.info(`[InputValidator] Auto-reject: Input too short.`);
      return {
        status: "FAIL",
        language: "unknown",
        is_intelligible: false,
        rejection_reason: "Input too short or empty."
      };
    }

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(content)
    ];

    try {
      const result = await this.model.invoke({ messages });
      const output = result.structuredResponse as SyntacticValidatorOutput;

      log.info(`[InputValidator] Validation complete. Status: ${output.status}`);
      return output;
    } catch (error) {
      console.error(error)
      log.error("[InputValidator] Error during execution", { error });
      return null;
    }
  }
}