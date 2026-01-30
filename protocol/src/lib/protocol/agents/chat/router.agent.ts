import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { log } from "../../../log";

/**
 * Config
 */
import { config } from "dotenv";
config({ path: '.env.development', override: true });

const model = new ChatOpenAI({
  model: 'google/gemini-2.5-flash',
  configuration: {
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY
  }
});

// ──────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────

const systemPrompt = `
You are a Routing Agent for a professional networking platform.
Your task is to analyze user messages and determine the appropriate action.

## Routing Options

1. **intent_subgraph** - Route here when:
   - User expresses goals, desires, or things they want to achieve
   - User updates preferences or changes their objectives
   - User mentions looking for something specific
   - Keywords: "I want", "looking for", "need", "goal", "interested in"

2. **profile_subgraph** - Route here when:
   - User asks about their profile or wants to see their info
   - User wants to update their bio, skills, or attributes
   - User asks "who am I" or "what do you know about me"
   - Keywords: "my profile", "update my", "my skills", "about me"

3. **opportunity_subgraph** - Route here when:
   - User asks for recommendations or matches
   - User wants to discover people or opportunities
   - User asks "who should I meet" or "find me someone"
   - Keywords: "find", "recommend", "discover", "match", "connect me"

4. **respond** - Route here when:
   - General conversation or greeting
   - Questions about how the system works
   - Acknowledgment or follow-up to previous action
   - No specific action needed

5. **clarify** - Route here when:
   - Message is ambiguous or too vague
   - Multiple possible interpretations exist
   - Missing critical context to proceed

## Output Rules
- Always provide confidence (0.0-1.0) in your routing decision
- Extract any relevant context that should be passed to the subgraph
- Explain your reasoning briefly
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

const routingResponseSchema = z.object({
  target: z.enum([
    "intent_subgraph",
    "profile_subgraph", 
    "opportunity_subgraph",
    "respond",
    "clarify"
  ]).describe("The routing target"),
  confidence: z.number().min(0).max(1).describe("Confidence in this routing decision (0.0-1.0)"),
  reasoning: z.string().describe("Brief explanation for this routing choice"),
  extractedContext: z.string().nullable().optional().describe("Relevant context extracted from message for subgraph processing")
});

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

export type RouterOutput = z.infer<typeof routingResponseSchema>;
export type RouteTarget = RouterOutput['target'];

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

/**
 * RouterAgent analyzes user messages to determine the appropriate routing target.
 * It uses structured output to ensure consistent routing decisions.
 */
export class RouterAgent {
  private model: any;

  constructor() {
    this.model = model.withStructuredOutput(routingResponseSchema, {
      name: "router_agent"
    });
  }

  /**
   * Invokes the router agent to analyze a user message and determine routing.
   * @param userMessage - The user's message to analyze
   * @param profileContext - Formatted string of user profile for context
   * @param activeIntents - Formatted string of user's active intents
   * @returns RouterOutput with target, confidence, reasoning, and optional extracted context
   */
  public async invoke(
    userMessage: string, 
    profileContext: string,
    activeIntents: string
  ): Promise<RouterOutput> {
    log.info('[RouterAgent.invoke] Analyzing message...', { 
      messagePreview: userMessage.substring(0, 50) 
    });

    const prompt = `
# User Message
${userMessage}

# User Profile Context
${profileContext || "No profile loaded yet."}

# Active Intents
${activeIntents || "No active intents."}

Analyze this message and determine the best routing action.
    `.trim();

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt)
    ];
    
    try {
      const result = await this.model.invoke(messages);
      const output = routingResponseSchema.parse(result);
      
      log.info('[RouterAgent.invoke] Routing decision made', { 
        target: output.target, 
        confidence: output.confidence 
      });
      
      return output;
    } catch (error: unknown) {
      log.error('[RouterAgent.invoke] Error during routing', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      // Default to clarify on error
      return {
        target: "clarify",
        confidence: 0.0,
        reasoning: "Failed to process message, asking for clarification"
      };
    }
  }
}
