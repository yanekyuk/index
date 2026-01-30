import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";
import { log } from "../../../log";
import type { RouterOutput } from "./router.agent";

/**
 * Config
 */
import { config } from "dotenv";
config({ path: '.env.development', override: true });

// ──────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────

export const RESPONSE_GENERATOR_SYSTEM_PROMPT = `
You are a Response Generator for a professional networking platform.
Your task is to synthesize a helpful, natural response based on system outputs.

## Response Guidelines

1. **Be Conversational** - Write like a helpful assistant, not a robot
2. **Be Specific** - Reference actual results, not generic responses
3. **Be Actionable** - Suggest next steps when appropriate
4. **Be Concise** - Respect user's time, avoid unnecessary verbosity

## Context Handling

- If intents were created/updated: Acknowledge the change and summarize what was captured
- If profile was updated: Confirm what was changed and offer to do more
- If opportunities found: Present them clearly with key highlights, focusing on why each match is relevant
- If clarification needed: Ask specific questions to disambiguate
- If no action taken: Engage naturally in conversation, be helpful and friendly

## Tone
Professional but friendly. Like a knowledgeable colleague who wants to help.
Avoid corporate jargon. Be genuine and human.

## Format
- Use short paragraphs for readability
- Use bullet points for lists of items (opportunities, skills, etc.)
- Bold important names or key information when appropriate
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

export const responseSchema = z.object({
  response: z.string().describe("The response text to send to the user"),
  suggestedActions: z.array(z.string()).optional().describe("Suggested follow-up actions the user might want to take")
});

// Schema for just suggested actions (used after streaming)
export const suggestedActionsSchema = z.object({
  suggestedActions: z.array(z.string()).describe("Suggested follow-up actions the user might want to take")
});

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

export type ResponseGeneratorOutput = z.infer<typeof responseSchema>;

/**
 * Intent action types from IntentReconcilerOutput.
 * Matches the discriminated union from intent.reconciler.ts
 */
export type IntentAction =
  | {
      type: "create";
      payload: string;
      score: number | null;
      reasoning: string | null;
      intentMode: "REFERENTIAL" | "ATTRIBUTIVE" | null;
      referentialAnchor: string | null;
      semanticEntropy: number | null;
    }
  | {
      type: "update";
      id: string;
      payload: string;
      score: number | null;
      reasoning: string | null;
      intentMode: "REFERENTIAL" | "ATTRIBUTIVE" | null;
    }
  | {
      type: "expire";
      id: string;
      reason: string;
    };

/**
 * Opportunity type from OpportunityEvaluator.
 * Matches the schema from opportunity.evaluator.ts
 */
export interface OpportunityResult {
  sourceDescription: string;
  candidateDescription: string;
  score: number;
  valencyRole: "Agent" | "Patient" | "Peer";
  sourceId: string;
  candidateId: string;
}

/**
 * Subgraph results structure passed to the response generator.
 * This is a flexible structure that accumulates outputs from various subgraphs.
 */
export interface SubgraphResults {
  intent?: {
    actions: IntentAction[];
    inferredIntents: string[];
  };
  profile?: {
    updated: boolean;
    profile?: {
      identity: { name: string; bio: string; location: string };
      narrative: { context: string };
      attributes: { interests: string[]; skills: string[] };
    };
  };
  opportunity?: {
    opportunities: OpportunityResult[];
    searchQuery?: string;
  };
}

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

/**
 * ResponseGeneratorAgent synthesizes natural language responses from subgraph results.
 * It takes the routing decision and accumulated results to create a coherent user response.
 */
export class ResponseGeneratorAgent {
  private structuredModel: Runnable;
  private suggestedActionsModel: ChatOpenAI;

  constructor() {
    // Model for structured response generation (non-streaming, for backward compatibility)
    const baseModel = new ChatOpenAI({
      model: 'google/gemini-2.5-flash',
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY
      }
    });
    
    // Wrap with structured output for the invoke() method
    this.structuredModel = baseModel.withStructuredOutput(responseSchema);
    
    // Separate model for suggested actions (non-streaming, structured output)
    this.suggestedActionsModel = new ChatOpenAI({
      model: 'google/gemini-2.5-flash',
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY
      }
    });
  }

  /**
   * Gets the system prompt for response generation.
   * Used by external callers needing to build streaming prompts.
   */
  public getSystemPrompt(): string {
    return RESPONSE_GENERATOR_SYSTEM_PROMPT;
  }

  /**
   * Formats subgraph results into a readable string for the LLM prompt.
   * Public to allow external callers to build prompts for streaming.
   */
  public formatSubgraphResults(results: SubgraphResults): string {
    const sections: string[] = [];

    if (results.intent) {
      sections.push('## Intent Processing Results');
      if (results.intent.actions.length > 0) {
        sections.push('Actions taken:');
        results.intent.actions.forEach(a => {
          // Handle different action types
          if (a.type === 'create') {
            sections.push(`- CREATE: "${a.payload}"`);
          } else if (a.type === 'update') {
            sections.push(`- UPDATE (${a.id}): "${a.payload}"`);
          } else if (a.type === 'expire') {
            sections.push(`- EXPIRE (${a.id}): ${a.reason}`);
          }
        });
      }
      if (results.intent.inferredIntents.length > 0) {
        sections.push('Intents detected:');
        results.intent.inferredIntents.forEach(i => {
          sections.push(`- ${i}`);
        });
      }
    }

    if (results.profile) {
      sections.push('## Profile Results');
      sections.push(`Updated: ${results.profile.updated ? 'Yes' : 'No'}`);
      if (results.profile.profile) {
        const p = results.profile.profile;
        sections.push(`Name: ${p.identity.name}`);
        sections.push(`Bio: ${p.identity.bio}`);
        sections.push(`Skills: ${p.attributes.skills.join(', ')}`);
      }
    }

    if (results.opportunity) {
      sections.push('## Opportunity Results');
      if (results.opportunity.searchQuery) {
        sections.push(`Search: "${results.opportunity.searchQuery}"`);
      }
      if (results.opportunity.opportunities.length > 0) {
        sections.push(`Found ${results.opportunity.opportunities.length} matches:`);
        results.opportunity.opportunities.forEach((o, i) => {
          sections.push(`${i + 1}. Candidate: ${o.candidateId}`);
          sections.push(`   Score: ${o.score}/100`);
          sections.push(`   Role: ${o.valencyRole}`);
          sections.push(`   For you: ${o.sourceDescription}`);
          sections.push(`   For them: ${o.candidateDescription}`);
        });
      } else {
        sections.push('No matching opportunities found.');
      }
    }

    return sections.length > 0 ? sections.join('\n') : 'No subgraph results available.';
  }

  /**
   * Invokes the response generator to synthesize a user response.
   * @param originalMessage - The original user message
   * @param routingDecision - The routing decision from RouterAgent
   * @param subgraphResults - Accumulated results from subgraph processing
   * @returns ResponseGeneratorOutput with response text and optional suggested actions
   */
  public async invoke(
    originalMessage: string,
    routingDecision: RouterOutput,
    subgraphResults: SubgraphResults
  ): Promise<ResponseGeneratorOutput> {
    log.info('[ResponseGeneratorAgent.invoke] Generating response...', { 
      target: routingDecision.target 
    });

    const formattedResults = this.formatSubgraphResults(subgraphResults);

    const prompt = `
# Original User Message
${originalMessage}

# Routing Decision
Target: ${routingDecision.target}
Confidence: ${routingDecision.confidence}
Reasoning: ${routingDecision.reasoning}

# Processing Results
${formattedResults}

Generate an appropriate, natural response for the user based on the above context and results.
    `.trim();

    const messages = [
      new SystemMessage(RESPONSE_GENERATOR_SYSTEM_PROMPT),
      new HumanMessage(prompt)
    ];
    
    try {
      const result = await this.structuredModel.invoke(messages);
      // withStructuredOutput returns the parsed object directly
      const output = responseSchema.parse(result);
      
      log.info('[ResponseGeneratorAgent.invoke] Response generated', { 
        responseLength: output.response.length,
        suggestedActions: output.suggestedActions?.length || 0
      });
      
      return output;
    } catch (error: unknown) {
      log.error('[ResponseGeneratorAgent.invoke] Error generating response', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      // Fallback response
      return {
        response: "I apologize, but I encountered an issue processing your request. Could you please try rephrasing your message?",
        suggestedActions: ["Try a simpler request", "Ask for help"]
      };
    }
  }

  /**
   * Builds the user prompt for response generation.
   * Used by external callers needing to build streaming prompts.
   */
  public buildUserPrompt(
    originalMessage: string,
    routingDecision: RouterOutput,
    subgraphResults: SubgraphResults
  ): string {
    const formattedResults = this.formatSubgraphResults(subgraphResults);

    return `
# Original User Message
${originalMessage}

# Routing Decision
Target: ${routingDecision.target}
Confidence: ${routingDecision.confidence}
Reasoning: ${routingDecision.reasoning}

# Processing Results
${formattedResults}

Generate an appropriate, natural response for the user based on the above context and results.
    `.trim();
  }

  /**
   * Generates suggested actions based on the response that was already streamed.
   * This is called AFTER streaming the main response to get follow-up suggestions.
   *
   * @param streamedResponse - The response text that was already streamed to the user
   * @param routingDecision - The routing decision for context
   * @returns Array of suggested actions
   */
  public async getSuggestedActions(
    streamedResponse: string,
    routingDecision: RouterOutput
  ): Promise<string[]> {
    log.info('[ResponseGeneratorAgent.getSuggestedActions] Generating suggested actions...');

    try {
      const structuredModel = this.suggestedActionsModel.withStructuredOutput(suggestedActionsSchema);

      const prompt = `
Based on this response that was just given to the user:

"${streamedResponse}"

The conversation context was: ${routingDecision.target} (${routingDecision.reasoning})

Generate 2-3 helpful follow-up actions the user might want to take next.
Examples: "Update my profile", "Search for more connections", "Create a new intent", etc.
      `.trim();

      const result = await structuredModel.invoke([
        new SystemMessage("You generate helpful suggested follow-up actions for a professional networking assistant."),
        new HumanMessage(prompt)
      ]);

      log.info('[ResponseGeneratorAgent.getSuggestedActions] Generated actions', {
        count: result.suggestedActions?.length || 0
      });

      return result.suggestedActions || [];
    } catch (error) {
      log.error('[ResponseGeneratorAgent.getSuggestedActions] Error generating suggestions', {
        error: error instanceof Error ? error.message : String(error)
      });
      return ["Ask me another question", "Update my profile"];
    }
  }
}
