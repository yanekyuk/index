import { BaseLangChainAgent } from "../../../lib/langchain/langchain";
import { IntentManagerResponse } from "./intent.manager.types";
import { InferredIntent } from "../inferrer/explicit/explicit.inferrer.types";
import { ExplicitIntentInferrer } from "../inferrer/explicit/explicit.inferrer";
import { z } from "zod";

import { log } from "../../../lib/log";

import { SemanticVerifierAgent } from "../../felicity/semantic/semantic.verifier";

const SYSTEM_PROMPT = `
You are an expert Intent Manager. Your goal is to reconcile NEWLY INFERRED intents with the user's ACTIVE intents.

You have access to:
1. Inferred Intents: Goals or Tombstones extracted from recent user activity.
2. Active Intents: What the user is currently working on.

YOUR TASK:
Compare the Inferred Intents against the Active Intents and decide on the necessary ACTIONS (Create, Update, Expire).

MATCHING LOGIC:
- You must determine if an Inferred Intent refers to the same underlying goal as an Active Intent.
- You must detect if an Inferred Intent CONTRADICTS an Active Intent (Change of Mind).

RULES:
- CREATE: If an Inferred Goal does NOT match any Active Intent, CREATE it.
- UPDATE: If an Inferred Goal matches an Active Intent but offers a better/different description, UPDATE it.
- EXPIRE: If an Inferred Tombstone matches an Active Intent (semantically), EXPIRE it.
- CONFLICT RESOLUTION: If a NEW Goal contradicts an Active Intent (e.g., Active="Avoid people", New="Go to party"), this indicates a CHANGE OF MIND. Action: EXPIRE the old conflicting intent (reason: "Contradicted by new goal") and CREATE the new one.
- DEDUPLICATION: If multiple Active Intents describe the same goal (or will do so after an update), you must DEDUPLICATE. Action: UPDATE one to the best description, and EXPIRE the others (reason: "Duplicate of [ID]").
- IGNORE: If an Inferred Goal is effectively the same as an Active Intent, do nothing.

Output a list of specific actions to apply.
`;

const CreateIntentActionSchema = z.object({
  type: z.literal("create"),
  payload: z.string().describe("The new intent description")
});

const UpdateIntentActionSchema = z.object({
  type: z.literal("update"),
  id: z.string().describe("The ID of the intent to update"),
  payload: z.string().describe("The updated intent description")
});

const ExpireIntentActionSchema = z.object({
  type: z.literal("expire"),
  id: z.string().describe("The ID of the intent to expire"),
  reason: z.string().describe("Why it is expired")
});

const IntentActionSchema = z.discriminatedUnion("type", [
  CreateIntentActionSchema,
  UpdateIntentActionSchema,
  ExpireIntentActionSchema
]);

const IntentManagerOutputSchema = z.object({
  actions: z.array(IntentActionSchema).describe("List of actions to apply")
});

/**
 * IntentManager Agent
 * 
 * Orchestrates the lifecycle of user intents by reconciling newly inferred "Explicit" or "Implicit" 
 * intents with the user's currently Active Intents.
 * 
 * CORE RESPONSIBILITY:
 * - Synthesis: Takes raw inferred intents (from ExplicitIntentInferrer) and decides how they modify the Active Intent state.
 * - Deduplication: Determines if a "New" intent is actually just a rephrasing of an "Active" one.
 * - Refresh: Updates descriptions of active intents if new data provides better clarity.
 * - Expiration: Detects "Tombstones" (statements of completion/abandonment) and marks active intents as expired.
 * 
 * ARCHITECTURE:
 * - Uses `ExplicitIntentInferrer` as a sub-agent to extract candidates from raw text.
 * - Uses GPT-4 (via BaseLangChainAgent) for the complex reasoning required to reconcile semantic duplicates.
 */
export class IntentManager extends BaseLangChainAgent {
  private explicitDetector: ExplicitIntentInferrer;
  private semanticVerifier: SemanticVerifierAgent;

  constructor() {
    super({
      model: 'openai/gpt-4o', // Use a strong model for synthesis
      responseFormat: IntentManagerOutputSchema,
      temperature: 0.2, // Low temp for decision making
    });
    this.explicitDetector = new ExplicitIntentInferrer();
    this.semanticVerifier = new SemanticVerifierAgent();
  }

  /**
   * Main Entry Point: Orchestrates the intent detection and reconciliation process.
   * 
   * LOGIC FLOW:
   * 1. Extraction: Calls `ExplicitIntentInferrer` to extract candidate intents from the raw content.
   * 2. Filtering: If no candidates are found, returns early.
   * 3. Reconciliation: Calls `reconcileIntentsWithLLM` to compare candidates against the active intents context.
   * 
   * @param content - The new text input from the user (e.g., a message, note, or command).
   * @param profileContext - The formatted profile context string.
   * @param activeIntentsContext - The formatted active intents context string.
   * @returns A Promise resolving to a list of `IntentAction` (Create, Update, Expire) to be applied to the DB.
   */
  async processIntent(
    content: string | null,
    profileContext: string,
    activeIntentsContext: string
  ): Promise<IntentManagerResponse> {
    // 1. Run Explicit Detector (Pure Extraction)
    log.info(`[IntentManagerAgent] Processing content: "${content ? content.substring(0, 50) + '...' : 'None'}"`);
    const { intents: inferredIntents } = await this.explicitDetector.run(content, profileContext);
    log.info(`[IntentManagerAgent] Inferred ${inferredIntents.length} intents.`);

    if (inferredIntents.length === 0) {
      return { actions: [] };
    }

    // 2. Run Semantic Verifier (Quality Check)
    const verifiedIntents: typeof inferredIntents = [];

    for (const intent of inferredIntents) {
      // Basic check: tombstones might not need deep verification, but goals do.
      // For now, let's verify everything to ensure "I am done with X" is also a valid statement.

      const verdict = await this.semanticVerifier.run(intent.description, profileContext);
      log.info(`[IntentManagerAgent] Verdict for "${intent.description}":`, (verdict as unknown) as Record<string, unknown> || {});
      if (!verdict) {
        log.warn(`[IntentManagerAgent] Skipping intent verification due to error: "${intent.description}"`);
        continue;
      }

      // CLARITY is useful debug info, but hard to threshold (valid intents can be vague).
      // We enforce Authority and Sincerity.
      const MIN_SCORE = 40;

      // Filter by Speech Act Type: Goals must be Commissive (Commitment) or Directive (Action).
      // Expressive (Greetings) and Assertive (Facts) are not goals.
      const VALID_TYPES = ['COMMISSIVE', 'DIRECTIVE', 'DECLARATION'];
      // Be lenient with classification if Auth/Sinc are high (e.g. 80+)
      const isStrongIntent = verdict.felicity_scores.authority >= 70 && verdict.felicity_scores.sincerity >= 70;
      const isValidType = VALID_TYPES.includes(verdict.classification) || isStrongIntent;

      if (
        verdict.felicity_scores.authority >= MIN_SCORE &&
        verdict.felicity_scores.sincerity >= MIN_SCORE &&
        isValidType
      ) {
        verifiedIntents.push(intent);
      } else {
        log.warn(`[IntentManagerAgent] Rejected intent: "${intent.description}" Type: ${verdict.classification}`, {
          reason: verdict.reasoning,
          scores: verdict.felicity_scores
        });
      }
    }

    if (verifiedIntents.length === 0) {
      log.info(`[IntentManagerAgent] All inferred intents were rejected by Semantic Verifier.`);
      return { actions: [] };
    }

    // 3. Reconcile with Active Intents (LLM Decision)
    log.info(`[IntentManagerAgent] Reconciling ${verifiedIntents.length} verified intents...`);
    return this.reconcileIntentsWithLLM(verifiedIntents, activeIntentsContext);
  }

  /**
   * LLM Reconciliation Step
   * 
   * Compares "Inferred" candidates against "Active" intents to decide on actions.
   * This is the "Brain" of the IntentManager.
   * 
   * DECISION RULES (Enforced by System Prompt):
   * - CREATE: Candidate does not match any Active Intent.
   * - UPDATE: Candidate matches an Active Intent but offers a better description.
   * - EXPIRE: Candidate is a "Tombstone" (completion marker) for an Active Intent.
   * - IGNORE: Candidate is a semantic duplicate of an Active Intent with no new info.
   * 
   * @param inferred - List of intents extracted from recent content.
   * @param activeIntentsContext - Formatted string of active intents.
   */
  private async reconcileIntentsWithLLM(
    inferred: InferredIntent[],
    activeIntentsContext: string
  ): Promise<IntentManagerResponse> {
    const prompt = `
      # Active Intents
      ${activeIntentsContext}

      # Inferred Intents (Candidates)
      ${this.formatInferredIntents(inferred)}

      Based on the Inferred Intents, determine the actions to modify the Active Intents state.
    `;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ];

    try {
      const result = await this.model.invoke({ messages });
      const structuredResponse = result.structuredResponse as IntentManagerResponse;
      log.info(`[IntentManagerAgent] Decision: ${structuredResponse.actions.length} actions generated.`);
      return structuredResponse;
    } catch (error) {
      log.error("[IntentManagerAgent] Error in IntentManager reconciliation", { error });
      return { actions: [] };
    }
  }

  private formatInferredIntents(intents: InferredIntent[]): string {
    if (intents.length === 0) return "No inferred intents.";

    // Simple markdown table formatter
    const header = "| Type | Description | Reasoning | Confidence |";
    const separator = "|---|---|---|---|";
    const rows = intents.map(i => `| ${i.type} | ${i.description} | ${i.reasoning} | ${i.confidence} |`).join('\n');

    return `${header}\n${separator}\n${rows}`;
  }
}
