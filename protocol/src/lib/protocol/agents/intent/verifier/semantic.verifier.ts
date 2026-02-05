import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { log } from "../../../../log";

const logger = log.protocol.from("SemanticVerifier");

/**
 * Config
 */
import { config } from "dotenv";
config({ path: '.env.development', override: true });


const model = new ChatOpenAI({
  model: 'google/gemini-2.5-flash',
  configuration: { baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY }
});
// ──────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────

const systemPrompt = `
You are the Semantic Verification Engine (Illocutionary Layer).

TASK:
Analyze a User's Utterance against their User Profile to verify Searle's "Felicity Conditions" and apply Semantic Governance Metrics.
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

4. **Constraint Density (S)** -> Output as 'semantic_entropy'
   - Measure: The density of specific constraints (Time, Location, Tech Stack, Quantifiers).
   - High Constraint Density = Low Entropy (0.0).
   - Low Constraint Density = High Entropy (1.0).
   - Example 0.0: "Meet 50 senior react devs in SF by Friday."
   - Example 1.0: "Network."

5. **Referential Anchoring** -> Output as 'referential_anchor'
   - Measure: Does the intent refer to a specific, unique entity?
   - If YES, output the Entity Name. If NO (Attributive), output NULL.
   - Example: "I want to join Google" -> Anchor: "Google"
   - Example: "I want to join a startup" -> Anchor: NULL

OUTPUT RULES:
- Return a strict JSON object.
- If 'Authority' or 'Sincerity' is < 70, add a specific FLAG (e.g., "SKILL_MISMATCH", "WEAK_COMMITMENT").
- 'Classification' must be one of Searle's 5 categories:
  1. COMMISSIVE: Speaker commits to a future action (e.g., "I will learn Rust", "I promise to fix this"). -> VALID GOAL
  2. DIRECTIVE: Speaker gets listener to do something (e.g., "Find me a co-founder", "Help me build this"). -> VALID GOAL
  3. DECLARATION: Speaker changes reality via words (e.g., "I quit", "Project is cancelled"). -> TOMBSTONE
  4. ASSERTIVE: Speaker states a fact/belief (e.g., "Rust is fast", "The sky is blue"). -> INVALID (Noise)
  5. EXPRESSIVE: Speaker expresses psychological state (e.g., "I am happy", "Hello"). -> INVALID (Noise)
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

const responseFormat = z.object({
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

  // Semantic Governance Fields
  semantic_entropy: z.number().min(0).max(1).describe("Constraint Density Score (0=Specific, 1=Vague)"),
  referential_anchor: z.string().nullable().describe("The specific entity being referred to (Donnellan's Distinction), or null if attributive"),

  flags: z.array(z.string()).describe("List of semantic violation tags"),
  reasoning: z.string().describe("Brief analysis of the felicity conditions"),
});

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

export type SemanticVerifierOutput = z.infer<typeof responseFormat>;

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

export class SemanticVerifier {
  private model: any;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "semantic_verifier"
    });
  }

  /**
   * Verifies the semantic validity of an intent.
   * @param content - The user's raw utterance.
   * @param context - The User Profile as a JSON string.
   */
  public async invoke(content: string, context: string) {
    logger.info(`[SemanticVerifier.invoke] Verifying: "${content.substring(0, 30)}..."`);

    const prompt = `
      # User Profile (Context)
      ${context}

      # User Utterance (Content)
      "${content}"
      
      Verify the Felicity Conditions and Semantic Metrics for this utterance.
    `;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.model.invoke(messages);
      const output = responseFormat.parse(result);

      logger.info(`[SemanticVerifier.invoke] Verdict: ${output.classification} Entropy: ${output.semantic_entropy}`);
      return output;
    } catch (error) {
      logger.error("[SemanticVerifier] Error during invocation", { error });
      throw error;
    }
  }

  /**
   * Factory method to expose the agent as a LangChain tool.
   */
  public static asTool() {
    return tool(
      async (args: { content: string; context: string }) => {
        const agent = new SemanticVerifier();
        return await agent.invoke(args.content, args.context);
      },
      {
        name: 'semantic_verifier',
        description: 'Verifies the semantic validity and felicity conditions of an intent.',
        schema: z.object({
          content: z.string().describe('The intent content to verify'),
          context: z.string().describe('The user profile context')
        })
      }
    );
  }
}
