import { createAgent, BaseLangChainAgent } from "../../../lib/langchain/langchain";
import { ActiveIntent, UserMemoryProfile } from "../manager/intent.manager.types";
import { IntentDetector, IntentDetectorResponse } from "./explicit.inferrer.types";
import { json2md } from "../../../lib/json2md/json2md";
import { z } from "zod";

/**
 * Model Configuration
 */
export const SYSTEM_PROMPT = `
  You are an expert Intent Manager. Your goal is to manage the lifecycle of user intents based on new content and their existing active intents.

  You have access to:
  1. User Memory Profile (Long-term context)
  2. Active Intents (What they are currently working on)
  3. New Content (What they just said/did)

  You must decide to:
  - CREATE a new intent if the user expresses a clear, new need.
  - UPDATE an existing intent if the new content refines, changes, or adds to it.
  - EXPIRE an existing intent if the user indicates it is completed or no longer relevant.
  - IGNORE if the content is trivial, irrelevant, or a clear duplicate without new info.

  Rules:
  - Be precise.
  - "Create" payloads should be self-contained and clear.
  - "Update" payloads should replace the old intent description with the new, refined one.
  - "Expire" reasons should be brief.
`;

/**
 * Output Schemas
 */
export const CreateIntentActionSchema = z.object({
  type: z.literal("create"),
  payload: z.string().describe("The new intent description")
});

export const UpdateIntentActionSchema = z.object({
  type: z.literal("update"),
  id: z.string().describe("The ID of the intent to update"),
  payload: z.string().describe("The updated intent description")
});

export const ExpireIntentActionSchema = z.object({
  type: z.literal("expire"),
  id: z.string().describe("The ID of the intent to expire"),
  reason: z.string().describe("Why it is expired")
});

export const IntentActionSchema = z.discriminatedUnion("type", [
  CreateIntentActionSchema,
  UpdateIntentActionSchema,
  ExpireIntentActionSchema
]);

export const ExplicitInferrerOutputSchema = z.object({
  actions: z.array(IntentActionSchema).describe("List of actions to apply to the intent state")
});

export type ExplicitInferrerOutput = z.infer<typeof ExplicitInferrerOutputSchema>;

export class ExplicitIntentDetector extends BaseLangChainAgent {
  constructor() {
    super({
      preset: 'intent-inferrer',
      responseFormat: ExplicitInferrerOutputSchema,
      temperature: 0,
    });
  }

  /**
   * Evaluates new content against the user's profile and active intents to determine
   * if any intent actions (Create, Update, Expire) are needed.
   *
   * @param content - The new user input or context string.
   * @param profile - The user's long-term memory profile.
   * @param activeIntents - List of currently active intents.
   * @returns A Promise resolving to an object containing a list of actions.
   *
   * @example
   * // Input
   * const content = "I want to learn Rust";
   * const profile = { identity: { name: "User" }, ... };
   * const activeIntents = [];
   *
   * // Output
   * // {
   * //   actions: [
   * //     { type: "create", payload: "Learn Rust" }
   * //   ]
   * // }
   */
  async run(content: string, profile: UserMemoryProfile, activeIntents: ActiveIntent[]): Promise<IntentDetectorResponse> {

    const prompt = `
      Context:
      # User Memory Profile
      ${json2md.fromObject(profile, 2)}

      ## Active Intents
      ${this.formatActiveIntents(activeIntents)}

      ## New Content
      ${content}
    `;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ];

    try {
      // Invoke pre-initialized agent
      const result = await this.model.invoke({ messages });
      // Return structured response directly
      return result.structuredResponse as IntentDetectorResponse;
    } catch (error) {
      console.error("Error in ExplicitIntentDetector", error);
      // Fallback: return empty actions if LLM fails
      return { actions: [] };
    }
  }

  /**
   * Formats active intents into a markdown table for the LLM prompt.
   *
   * @param intents - List of active intents.
   * @returns A markdown table string or "No active intents."
   *
   * @example
   * // Input
   * const intents = [{ id: "1", description: "Learn Rust", status: "active", created_at: 123456 }];
   *
   * // Output
   * // | ID | Description | Status | Created |
   * // | -- | ----------- | ------ | ------- |
   * // | 1  | Learn Rust  | active | 2024... |
   */
  private formatActiveIntents(intents: ActiveIntent[]): string {
    if (intents.length === 0) {
      return "No active intents.";
    }

    // Format data for the table
    const tableData = intents.map(intent => ({
      id: intent.id,
      description: intent.description,
      status: intent.status,
      created: new Date(intent.created_at).toISOString().split('T')[0]
    }));

    return json2md.table(tableData, {
      columns: [
        { header: "ID", key: "id" },
        { header: "Description", key: "description" },
        { header: "Status", key: "status" },
        { header: "Created", key: "created" }
      ]
    });
  }
}
