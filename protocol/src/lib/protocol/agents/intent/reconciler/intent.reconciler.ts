import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "../../../../langchain/langchain";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Runnable } from "@langchain/core/runnables";
import { z } from "zod";
import { log } from "../../../../log";
import { Database } from "../../../interfaces/database.interface";
import { Embedder } from "../../../interfaces/embedder.interface";

/**
 * Config
 */
import { config } from "dotenv";
config({ path: '.env.development', override: true });

// ──────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────

const systemPrompt = `
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
IMPORTANT: The type field MUST be exactly one of: "create", "update", "expire" (lowercase).
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

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

const responseFormat = z.object({
  actions: z.array(
    z.discriminatedUnion("type", [
      CreateIntentActionSchema,
      UpdateIntentActionSchema,
      ExpireIntentActionSchema
    ])
  ).describe("List of actions to apply")
});

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

export type IntentReconcilerOutput = z.infer<typeof responseFormat>;

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

export class IntentReconcilerAgent {
  private agent: Runnable;
  private database: Database;
  private embedder: Embedder;

  constructor(database: Database, embedder: Embedder) {
    this.agent = createAgent({
      model: 'openai/gpt-4o',
      responseFormat
    });
    this.database = database;
    this.embedder = embedder;
  }

  /**
   * Reconciles inferred intents with active intents.
   * @param inferredIntentsFormatted - Formatted string of inferred intents.
   * @param activeIntentsContext - Formatted string of active intents.
   */
  public async invoke(inferredIntentsFormatted: string, activeIntentsContext: string) {
    log.info(`[IntentReconciler.invoke] Reconciling intents...`);

    const prompt = `
      # Active Intents
      ${activeIntentsContext}

      # Inferred Intents (Candidates)
      ${inferredIntentsFormatted}

      Based on the Inferred Intents, determine the actions to modify the Active Intents state.
      IMPORTANT:
      - If you CREATE or UPDATE an intent, you MUST popuate the 'score' and 'reasoning' fields.
      - Extract the 'score' from the Inferred Intent's data (it is the felicity score).
      - Include the verification details in the 'reasoning'.
      - For EXPIRE actions, 'score' and 'reasoning' are not required (leave null).
    `;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.agent.invoke({ messages });
      const output = responseFormat.parse(result.structuredResponse);

      log.info(`[IntentReconciler.invoke] Decision: ${output.actions.length} actions.`);
      return output;
    } catch (error) {
      log.error("[IntentReconciler] Error during invocation", { error });
      return { actions: [] };
    }
  }

  /**
   * Factory method to expose the agent as a LangChain tool.
   */
  public static asTool(database: Database, embedder: Embedder) {
    return tool(
      async (args: { inferredIntents: string; activeIntents: string }) => {
        const agent = new IntentReconcilerAgent(database, embedder);
        return await agent.invoke(args.inferredIntents, args.activeIntents);
      },
      {
        name: 'intent_reconciler',
        description: 'Reconciles inferred intents with active intents to determine state changes.',
        schema: z.object({
          inferredIntents: z.string().describe('Formatted string of inferred intents'),
          activeIntents: z.string().describe('Formatted string of active intents')
        })
      }
    );
  }
}
