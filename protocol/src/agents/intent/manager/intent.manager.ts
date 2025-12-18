import { BaseLangChainAgent } from "../../../lib/langchain/langchain";
import { UserMemoryProfile, ActiveIntent, IntentManagerResponse, IntentAction } from "./intent.manager.types";
import { InferredIntent } from "../inferrer/explicit.inferrer.types";
import { ExplicitIntentDetector } from "../inferrer/explicit.inferrer";
import { z } from "zod";
import { json2md } from "../../../lib/json2md/json2md";

const SYSTEM_PROMPT = `
You are an expert Intent Manager. Your goal is to reconcile NEWLY INFERRED intents with the user's ACTIVE intents.

You have access to:
1. Inferred Intents: Goals or Tombstones extracted from recent user activity.
2. Active Intents: What the user is currently working on.

YOUR TASK:
Compare the Inferred Intents against the Active Intents and decide on the necessary ACTIONS (Create, Update, Expire).

MATCHING LOGIC:
- You must determine if an Inferred Intent refers to the same underlying goal as an Active Intent, even if the wording is slightly different (e.g., "Learn Rust" == "Learn Rust programming").

RULES:
- CREATE: If an Inferred Goal does NOT match any Active Intent, CREATE it.
- UPDATE: If an Inferred Goal matches an Active Intent but offers a better/different description, UPDATE it.
- EXPIRE: If an Inferred Tombstone matches an Active Intent (semantically), EXPIRE it. This is critical.
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

export class IntentManager extends BaseLangChainAgent {
  private explicitDetector: ExplicitIntentDetector;

  constructor() {
    super({
      model: 'openai/gpt-4o', // Use a strong model for synthesis
      responseFormat: IntentManagerOutputSchema,
      temperature: 0.2, // Low temp for decision making
    });
    this.explicitDetector = new ExplicitIntentDetector();
  }

  /**
   * Orchestrates the intent detection process.
   * 
   * @param content - The new text content from the user (e.g. a message or command).
   * @param profile - The user's long-term memory profile.
   * @param activeIntents - The list of currently active intents.
   * @returns A promise resolving to the detected actions (create, update, expire) or generic response.
   */
  async processIntent(
    content: string | null,
    profile: UserMemoryProfile,
    activeIntents: ActiveIntent[]
  ): Promise<IntentManagerResponse> {
    // 1. Run Explicit Detector (Pure Extraction)
    const { intents: inferredIntents } = await this.explicitDetector.run(content, profile);

    if (inferredIntents.length === 0) {
      return { actions: [] };
    }

    // 2. Reconcile with Active Intents (LLM Decision)
    return this.reconcileIntentsWithLLM(inferredIntents, activeIntents);
  }

  private async reconcileIntentsWithLLM(inferred: InferredIntent[], active: ActiveIntent[]): Promise<IntentManagerResponse> {
    const prompt = `
      # Active Intents
      ${this.formatActiveIntents(active)}

      # Inferred Intents (Candidates)
      ${this.formatInferredIntents(inferred)}

      Based on the Inferred Intents, determine the actions to modify the Active Intents state.
    `;
    console.debug("Prompt: ", prompt);
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ];

    try {
      const result = await this.model.invoke({ messages });
      const structuredResponse = result.structuredResponse as IntentManagerResponse;

      // Filter out "no-op" updates (where payload equals current description)
      const filteredActions = structuredResponse.actions.filter(action => {
        if (action.type === 'update') {
          const original = active.find(a => a.id === action.id);
          if (original && original.description === action.payload) {
            return false; // Ignore no-op updates
          }
        }
        return true;
      });

      return { actions: filteredActions };
    } catch (error) {
      console.error("Error in IntentManager reconciliation", error);
      return { actions: [] };
    }
  }

  private formatInferredIntents(intents: InferredIntent[]): string {
    if (intents.length === 0) return "No inferred intents.";

    const tableData = intents.map(i => ({
      Type: i.type,
      Description: i.description,
      Reasoning: i.reasoning,
      Confidence: i.confidence
    }));
    return json2md.table(tableData, {
      columns: [
        { header: "Type", key: "Type" },
        { header: "Description", key: "Description" },
        { header: "Reasoning", key: "Reasoning" },
        { header: "Confidence", key: "Confidence" }
      ]
    });
  }

  private formatActiveIntents(intents: ActiveIntent[]): string {
    if (intents.length === 0) return "No active intents.";

    // Minimal table for context
    const tableData = intents.map(i => ({
      ID: i.id,
      Description: i.description,
      Status: i.status
    }));
    return json2md.table(tableData, { columns: [{ header: "ID", key: "ID" }, { header: "Description", key: "Description" }, { header: "Status", key: "Status" }] });
  }
}
