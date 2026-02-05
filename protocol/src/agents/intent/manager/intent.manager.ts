import { BaseLangChainAgent } from "../../../lib/langchain/langchain";
import { IntentManagerResponse } from "./intent.manager.types";
import { InferredIntent } from "../inferrer/explicit/explicit.inferrer.types";
import { ExplicitIntentInferrer } from '../inferrer/explicit/explicit.inferrer';
import { ImplicitInferrer } from '../inferrer/implicit/implicit.inferrer';
import { z } from "zod";

import { log } from "../../../lib/log";
import { SemanticVerifierAgent } from "../evaluator/semantic/semantic.evaluator";

const logger = log.agent.from("agents/intent/manager/intent.manager.ts");

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
- IGNORE: If an Inferred Goal is effectively the same as an Active Intent, do nothing (e.g. Active="Learn Rust", Inferred="I want to learn Rust" -> Ignore).

Output a list of specific actions to apply.
IMPORTANT: The \`type\` field MUST be exactly one of: "create", "update", "expire" (lowercase).
`;

const CreateIntentActionSchema = z.object({
  type: z.literal("create"),
  payload: z.string().describe("The new intent description"),
  score: z.number().nullable().describe("The felicity score (0-100)"),
  reasoning: z.string().nullable().describe("Reasoning for the creation (including felicity)")
});

const UpdateIntentActionSchema = z.object({
  type: z.literal("update"),
  id: z.string().describe("The ID of the intent to update"),
  payload: z.string().describe("The updated intent description"),
  score: z.number().nullable().describe("The felicity score (0-100)"),
  reasoning: z.string().nullable().describe("Reasoning for the update")
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
  private implicitInferrer: ImplicitInferrer;

  constructor() {
    super({
      preset: 'intent-manager', // Use a strong model for synthesis
      responseFormat: IntentManagerOutputSchema,
      temperature: 0.2, // Low temp for decision making
    });
    this.explicitDetector = new ExplicitIntentInferrer();
    this.semanticVerifier = new SemanticVerifierAgent();
    this.implicitInferrer = new ImplicitInferrer();
  }

  /**
   * Process Explicit User Input (Messages, Notes)
   * 
   * 1. Extract intents using ExplicitInferrer
   * 2. Verify validity
   * 3. Reconcile with active intents
   */
  async processExplicitIntent(
    content: string | null,
    profileContext: string,
    activeIntentsContext: string
  ): Promise<IntentManagerResponse> {
    // 1. Run Explicit Detector (Pure Extraction)
    logger.info(`[IntentManagerAgent] Processing explicit content: "${content ? content.substring(0, 50) + '...' : 'None'}"`);
    const { intents: inferredIntents } = await this.explicitDetector.run(content, profileContext);
    logger.info(`[IntentManagerAgent] Inferred ${inferredIntents.length} explicit intents.`);

    return this.verifyAndReconcile(inferredIntents, activeIntentsContext, profileContext);
  }

  /**
   * Process Implicit Opportunity Context
   * 
   * 1. Infer intent using ImplicitInferrer from Opportunity Context
   * 2. Verify validity
   * 3. Reconcile with active intents
   */
  async processImplicitIntent(
    profileContext: string,
    additionalContext: string,
    activeIntentsContext: string
  ): Promise<IntentManagerResponse> {
    logger.info(`[IntentManagerAgent] Processing implicit context...`);

    // 1. Run Implicit Inferrer
    const implicitIntent = await this.implicitInferrer.run(profileContext, additionalContext);

    if (!implicitIntent) {
      logger.info(`[IntentManagerAgent] No implicit intent inferred.`);
      return { actions: [] };
    }

    logger.info(`[IntentManagerAgent] Inferred implicit intent: "${implicitIntent.payload}" (${implicitIntent.confidence}%)`);

    // Map to InferredIntent format for shared processing
    const inferredIntents: InferredIntent[] = [{
      type: 'goal', // Implicit is always a goal
      description: implicitIntent.payload,
      reasoning: 'Implicitly inferred from additional context',
      confidence: implicitIntent.confidence > 80 ? 'high' : 'medium'
    }];

    return this.verifyAndReconcile(inferredIntents, activeIntentsContext, profileContext);
  }

  /**
   * Shared Logic: Semantic Verification & LLM Reconciliation
   * By reconcile we mean that we will use the LLM to verify the inferred intent and reconcile it with the active intents.
   */
  private async verifyAndReconcile(
    inferredIntents: InferredIntent[],
    activeIntentsContext: string,
    profileContext: string
  ): Promise<IntentManagerResponse> {
    if (inferredIntents.length === 0) {
      return { actions: [] };
    }

    // 2. Run Semantic Verifier (Quality Check)
    const verifiedIntents: typeof inferredIntents = [];

    for (const intent of inferredIntents) {
      const verdict = await this.semanticVerifier.run(intent.description, profileContext);
      logger.info(`[IntentManagerAgent] Verdict for "${intent.description}":`, (verdict as unknown) as Record<string, unknown> || {});

      if (!verdict) {
        logger.warn(`[IntentManagerAgent] Skipping intent verification due to error: "${intent.description}"`);
        continue;
      }

      // Filter by Speech Act Type only: Goals must be Commissive (Commitment), Directive (Action), or Declaration.
      // Expressive (Greetings) and Assertive (Facts) are not actionable goals.
      // Authority and Sincerity are NOT used for filtering—they flow through for stake scoring.
      const VALID_TYPES = ['COMMISSIVE', 'DIRECTIVE', 'DECLARATION'];
      const isValidType = VALID_TYPES.includes(verdict.classification);

      if (!isValidType) {
        logger.warn(`[IntentManagerAgent] Rejected intent (invalid Speech Act Type): "${intent.description}" Type: ${verdict.classification}`, {
          reason: verdict.reasoning,
          scores: verdict.felicity_scores
        });
        continue;
      }

      // Calculate Felicity Score for Stake (used downstream for single and multi-intent stakes)
      // Score = min(Authority, Sincerity, Clarity) — the weakest link determines overall quality
      const score = Math.min(
        verdict.felicity_scores.authority,
        verdict.felicity_scores.sincerity,
        verdict.felicity_scores.clarity
      );

      // Append score and reasoning to the intent so it can be passed to the LLM
      intent.reasoning = `${intent.reasoning}. Verification: ${verdict.classification} (Score: ${score}, Auth: ${verdict.felicity_scores.authority}, Sinc: ${verdict.felicity_scores.sincerity}, Clarity: ${verdict.felicity_scores.clarity}). ${verdict.reasoning}`;

      verifiedIntents.push({ ...intent, score } as any);
    }

    if (verifiedIntents.length === 0) {
      logger.info(`[IntentManagerAgent] All inferred intents were rejected by Semantic Verifier.`);
      return { actions: [] };
    }

    // 3. Reconcile with Active Intents (LLM Decision)
    logger.info(`[IntentManagerAgent] Reconciling ${verifiedIntents.length} verified intents...`);
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
      IMPORTANT:
      - If you CREATE or UPDATE an intent, you MUST popuate the 'score' and 'reasoning' fields.
      - Extract the 'score' from the Inferred Intent's data (it is the felicity score).
      - Include the verification details in the 'reasoning'.
      - For EXPIRE actions, 'score' and 'reasoning' are not required (leave null).
    `;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ];

    try {
      const result = await this.model.invoke({ messages });
      const structuredResponse = result.structuredResponse as IntentManagerResponse;
      logger.info(`[IntentManagerAgent] Decision: ${structuredResponse.actions.length} actions generated.`);
      return structuredResponse;
    } catch (error) {
      logger.error("[IntentManagerAgent] Error in IntentManager reconciliation", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        raw: error
      });
      return { actions: [] };
    }
  }

  private formatInferredIntents(intents: InferredIntent[]): string {
    if (intents.length === 0) return "No inferred intents.";

    // Simple markdown table formatter
    const header = "| Type | Description | Reasoning | Confidence | Score |";
    const separator = "|---|---|---|---|---|";
    const rows = intents.map(i => `| ${i.type} | ${i.description} | ${i.reasoning} | ${i.confidence} | ${(i as any).score || 'N/A'} |`).join('\n');

    return `${header}\n${separator}\n${rows}`;
  }
}
