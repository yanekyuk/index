// src/agents/intent/felicity/semantic/semantic-verifier.ts

import { BaseLangChainAgent } from "../../../../lib/langchain/langchain";
import { z } from "zod";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { log } from "../../../../lib/log";
import { SemanticVerifierOutput } from "./semantic.evaluator.types";

const logger = log.agent.from("agents/intent/evaluator/semantic/semantic.evaluator.ts");

const SYSTEM_PROMPT = `
You are the Semantic Verification Engine (Illocutionary Layer).

TASK:
Analyze a User's Utterance against their User Profile to verify Searle's "Felicity Conditions".
You are the judge of whether a user's statement is a valid, credible intent or just noise.

INPUTS:
1. User Profile (Context): JSON data covering role, skills, and reputation.
2. Utterance (Content): The statement the user is making.

EVALUATION FRAMEWORK (0-100 Score):

1. **Clarity (The Essential Condition)**
   - Measure: How unambiguous is the intent?
   - 100: "I will deploy the smart contract to Mainnet by Friday." (Specific, Actionable)
   - 20: "We should do something cool." (Vague)

2. **Authority (The Preparatory Condition)**
   - Measure: Does the speaker have the *ability* and *right* to perform this act?
   - CHECK: Compare 'User Skills' against the 'Action' in the utterance.
   - 100: Profile="Senior Dev" -> Utterance="I will fix the bug." (Valid)
   - 10: Profile="Junior Marketer" -> Utterance="I will rewrite the Rust compiler." (Invalid/Dreamer)

3. **Sincerity (The Sincerity Condition)**
   - Measure: Does the linguistic form imply genuine commitment?
   - CHECK: Look for modality (will vs. might) and detailed planning.
   - 100: "I have started the task and pushed the branch."
   - 40: "I could probably try to look into it." (Hedging)

OUTPUT RULES:
- Return a strict JSON object.
- If 'Authority' or 'Sincerity' is < 50, add a specific FLAG (e.g., "SKILL_MISMATCH", "WEAK_COMMITMENT").
- 'Classification' must be one of Searle's 5 categories:
  1. COMMISSIVE: Speaker commits to a future action (e.g., "I will learn Rust", "I promise to fix this"). -> VALID GOAL
  2. DIRECTIVE: Speaker gets listener to do something (e.g., "Find me a co-founder", "Help me build this"). -> VALID GOAL
  3. DECLARATION: Speaker changes reality via words (e.g., "I quit", "Project is cancelled"). -> TOMBSTONE
  4. ASSERTIVE: Speaker states a fact/belief (e.g., "Rust is fast", "The sky is blue"). -> INVALID (Noise)
  5. EXPRESSIVE: Speaker expresses psychological state (e.g., "I am happy", "Hello"). -> INVALID (Noise)
`;

// Define Zod schema locally for the agent
const SemanticVerifierOutputSchema = z.object({
  classification: z.enum([
    "COMMISSIVE",
    "DIRECTIVE",
    "ASSERTIVE",
    "EXPRESSIVE",
    "DECLARATION",
    "UNKNOWN"
  ]).describe("Searle's Speech Act Category"),

  felicity_scores: z.object({
    clarity: z.number().min(0).max(100).describe("Essential Condition Score"),
    authority: z.number().min(0).max(100).describe("Preparatory Condition Score"),
    sincerity: z.number().min(0).max(100).describe("Sincerity Condition Score"),
  }),

  flags: z.array(z.string()).describe("List of semantic violation tags"),
  reasoning: z.string().describe("Brief analysis of the felicity conditions"),
});

export class SemanticVerifierAgent extends BaseLangChainAgent {
  constructor() {
    super({
      // Phase 2 requires high intelligence for context matching (Profile vs Text)
      preset: 'semantic-evaluator',
      responseFormat: SemanticVerifierOutputSchema,
      temperature: 0.2, // Low temperature for consistent scoring
    });
  }

  /**
   * Verifies the semantic validity of an intent.
   * * @param content - The user's raw utterance.
   * @param context - The User Profile as a JSON string.
   */
  async run(content: string, context: string): Promise<SemanticVerifierOutput | null> {
    logger.info(`[SemanticVerifier] Verifying felicity conditions...`);

    const prompt = `
      # User Profile (Context)
      ${context}

      # User Utterance (Content)
      "${content}"
      
      Verify the Felicity Conditions for this utterance.
    `;

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.model.invoke({ messages });
      const output = result.structuredResponse as SemanticVerifierOutput;

      logger.info(`[SemanticVerifier] Verdict: ${output.classification} with scores of auth ${output.felicity_scores.authority}, sincerity ${output.felicity_scores.sincerity}, and clarity ${output.felicity_scores.clarity}. Flags: ${output.flags.join(', ')}. Reasoning: ${output.reasoning}`);
      return output;
    } catch (error) {
      logger.error("[SemanticVerifier] Error during execution", { error });
      return null;
    }
  }
}