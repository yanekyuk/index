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
  You are an expert Intent Analyst. Your goal is to infer the user's current intentions based on their profile and new content.

  You have access to:
  1. User Memory Profile (Identity, Narrative, Attributes) - The long-term context.
  2. New Content - What they just said/did.

  YOUR TASK:
  Analyze the "New Content" in the context of the "Profile".
  Extract a list of **Inferred Intents**.

  INTENT TYPES:
  - 'goal': The user wants to start, continue, or achieve something. (e.g., "I want to learn Rust", "Looking for a co-founder")
  - 'tombstone': The user explicitly states they have COMPLETED, stopped, or abandoned a goal. (e.g., "I finished the course", "I'm done with crypto", "Delete my running goal")

  RULES:
  - Be precise.
  - Descriptions should be self-contained (e.g., "Learn Rust programming" instead of "Learn it").
  - Do NOT try to manage existing IDs or check for duplicates. Just extract what is valid NOW.
  - If "New Content" is empty or invalid, look at the Profile (Narrative/Goals) and extract implied ongoing goals.
  - IGNORE purely phatic communication (e.g., "Hello", "Hi", "Good morning") or empty statements. Do NOT fallback to Profile for these; return empty intents.
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

const InferredIntentSchema = z.object({
  type: z.enum(['goal', 'tombstone']).describe("The type of intent inferred"),
  description: z.string().describe("Concise description of the intent"),
  reasoning: z.string().describe("Why this intent was inferred"),
  confidence: z.enum(['high', 'medium', 'low']).describe("Confidence level of the inference")
});

const responseFormat = z.object({
  intents: z.array(InferredIntentSchema).describe("List of inferred intents")
});

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

type ResponseType = z.infer<typeof responseFormat>;
export type InferredIntent = z.infer<typeof InferredIntentSchema>;

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

export class ExplicitIntentInferrer {
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
   * Main entry point. Invokes the agent with input and returns structured output.
   * @param content - The raw string content to analyze.
   * @param profileContext - The formatted profile context string.
   */
  public async invoke(content: string | null, profileContext: string) {
    log.info('[ExplicitIntentInferrer.invoke] Received input', { contentPreview: content?.substring(0, 50) });

    const prompt = `
      Context:
      # User Memory Profile
      ${profileContext}

      ${content ? `## New Content\n\n${content}` : '(No content provided. Please infer intents from Profile Narrative and Aspirations)'}
    `;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.agent.invoke({ messages });

      // Handle the fact that structured output might be in result or result.structuredResponse
      // Depending on createAgent implementation. 
      // Current createAgent implementation (checked in Step 150) returns result directly if no specific middleware wrapper.
      // BUT if options.responseFormat is set, createAgent sets defaultModel.withStructuredOutput.
      // And withStructuredOutput returns the parsed object directly (usually).
      // However, line 179 of langchain.ts wrapper says:
      // "if (options.responseFormat) { return { structuredResponse: result }; }"
      // So it WRAPS it.

      const output = responseFormat.parse(result.structuredResponse);

      log.info(`[ExplicitIntentInferrer.invoke] Found ${output.intents.length} intents.`);
      return output;
    } catch (error: any) {
      log.error("[ExplicitIntentInferrer] Error during invocation", {
        message: error.message,
        stack: error.stack
      });
      return { intents: [] };
    }
  }

  /**
   * Factory method to expose the agent as a LangChain tool.
   * Useful for composing agents into larger graphs.
   */
  public static asTool(database: Database, embedder: Embedder) {
    return tool(
      async (args: { content: string | null; profileContext: string }) => {
        const agent = new ExplicitIntentInferrer(database, embedder);
        return await agent.invoke(args.content, args.profileContext);
      },
      {
        name: 'explicit_intent_inferrer',
        description: 'Extracts explicit intents from user content and profile context.',
        schema: z.object({
          content: z.string().nullable().describe('The new content to analyze'),
          profileContext: z.string().describe('The user profile context')
        })
      }
    );
  }
}
