/**
 * Chat Agent Evaluator
 * 
 * Tests the full chat agent (ReAct loop with tools) end-to-end.
 * Includes scenario generation and evaluation logic.
 */

import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";

// Import all scenario definitions from central file
import {
  CHAT_AGENT_USER_NEEDS,
  USER_PERSONAS,
  USER_CONTEXTS,
  type UserPersona,
  type UserContext,
  type UserNeed,
} from "./chat.scenarios";

// Re-export for backward compatibility
export { USER_PERSONAS, USER_CONTEXTS, CHAT_AGENT_USER_NEEDS as USER_NEEDS };
export type { UserPersona, UserContext, UserNeed };

// Type helpers
type UserNeedId = keyof typeof CHAT_AGENT_USER_NEEDS;
type UserPersonaId = keyof typeof USER_PERSONAS;

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface EvaluationCriteria {
  successSignals: readonly string[];
  failureSignals: readonly string[];
  qualityFactors: readonly string[];
}

export interface GeneratedScenario {
  id: string;
  need: typeof CHAT_AGENT_USER_NEEDS[UserNeedId];
  persona: typeof USER_PERSONAS[UserPersonaId];
  context: UserContext;
  generatedMessage: string;
  evaluationCriteria: EvaluationCriteria;
}

/**
 * Dynamically generate evaluation criteria based on need and context using LLM
 */
async function generateEvaluationCriteria(
  need: typeof CHAT_AGENT_USER_NEEDS[UserNeedId],
  context: UserContext,
  model: ChatOpenAI
): Promise<EvaluationCriteria> {
  const prompt = `Given this user need and context, generate evaluation criteria.

User Need: ${need.description}
User Context:
- Has profile: ${context.hasProfile}
- Has intents: ${context.hasIntents}
- Is index owner: ${context.isIndexOwner}
- Index memberships: ${context.indexMembershipCount}

Generate:
1. Success signals: 3-5 indicators that the need was fulfilled
2. Failure signals: 3-5 indicators that the need was NOT fulfilled
3. Quality factors: 3-5 aspects to judge interaction quality

Respond ONLY with JSON:
{
  "successSignals": ["signal 1", "signal 2", ...],
  "failureSignals": ["signal 1", "signal 2", ...],
  "qualityFactors": ["factor 1", "factor 2", ...]
}`;

  const response = await model.invoke([new HumanMessage(prompt)]);
  const content = typeof response.content === "string" ? response.content : String(response.content);
  
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      successSignals: parsed.successSignals || [],
      failureSignals: parsed.failureSignals || [],
      qualityFactors: parsed.qualityFactors || [
        "clear communication",
        "appropriate tone",
        "efficient interaction",
        "meets user expectations",
      ],
    };
  } catch (error) {
    // Fallback to basic criteria if LLM fails
    return {
      successSignals: ["task completed", "appropriate response provided"],
      failureSignals: ["task failed", "incorrect response"],
      qualityFactors: [
        "clear communication",
        "appropriate tone",
        "efficient interaction",
        "meets user expectations",
      ],
    };
  }
}

/**
 * Chat Agent Scenario Generator
 * Uses the comprehensive CHAT_AGENT_USER_NEEDS taxonomy
 */
export class ChatScenarioGenerator {
  private model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      model: "google/gemini-2.5-flash",
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
      },
      temperature: 0.7,
    });
  }

  /**
   * Generate a realistic user message for a given need and persona
   */
  async generateMessage(
    need: typeof CHAT_AGENT_USER_NEEDS[UserNeedId],
    persona: typeof USER_PERSONAS[UserPersonaId]
  ): Promise<string> {
    const prompt = `Generate a single realistic user message for this scenario:

User Need: ${need.description}
Communication Style: ${persona.communicationStyle}

Examples of this need:
${need.examples.map((ex) => `- "${ex}"`).join("\n")}

Examples of this persona:
${persona.examples.map((ex) => `- "${ex}"`).join("\n")}

Generate ONE new realistic message that combines this need with this communication style.
Be creative but stay true to the need and persona.

Respond with ONLY the user message, nothing else.`;

    const response = await this.model.invoke([new HumanMessage(prompt)]);
    const content = typeof response.content === "string" ? response.content : String(response.content);
    return content.trim().replace(/^["']|["']$/g, ""); // Remove quotes if present
  }

  /**
   * Generate a complete test scenario
   */
  async generateScenario(
    needId: UserNeedId,
    personaId: UserPersonaId,
    contextKey: keyof typeof USER_CONTEXTS
  ): Promise<GeneratedScenario> {
    const need = CHAT_AGENT_USER_NEEDS[needId];
    const persona = USER_PERSONAS[personaId];
    const context = USER_CONTEXTS[contextKey];

    const generatedMessage = await this.generateMessage(need, persona);
    const evaluationCriteria = await generateEvaluationCriteria(need, context, this.model);

    return {
      id: `${needId}-${personaId}-${contextKey}`,
      need,
      persona,
      context,
      generatedMessage,
      evaluationCriteria,
    };
  }

  /**
   * Generate a batch of scenarios with variety across all needs
   */
  async generateBatch(count: number): Promise<GeneratedScenario[]> {
    const scenarios: GeneratedScenario[] = [];
    const needIds = Object.keys(CHAT_AGENT_USER_NEEDS) as UserNeedId[];
    const personaIds = Object.keys(USER_PERSONAS) as UserPersonaId[];
    const contextKeys = Object.keys(USER_CONTEXTS) as Array<keyof typeof USER_CONTEXTS>;

    for (let i = 0; i < count; i++) {
      const needId = needIds[i % needIds.length];
      const personaId = personaIds[Math.floor((i / needIds.length)) % personaIds.length];
      const contextKey = contextKeys[Math.floor(i / (needIds.length * personaIds.length)) % contextKeys.length];

      scenarios.push(await this.generateScenario(needId, personaId, contextKey));
    }

    return scenarios;
  }
}

// Backward compatibility export (for code that imports ScenarioGenerator)
export const ScenarioGenerator = ChatScenarioGenerator;

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT AGENT INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Interface for testing the full chat agent (with ReAct loop and tools)
 */
export interface ChatAgentInterface {
  /**
   * Send a message and get the full response including tool calls
   */
  chat(message: string, options?: {
    userId?: string;
    sessionId?: string;
    indexId?: string;
  }): Promise<{
    response: string; // Final assistant response text
    rawMessages?: BaseMessage[]; // Full message history from the agent loop
    toolCalls?: Array<{ tool: string; args: any; result: any }>; // Tools that were called
    error?: string;
  }>;
  
  /**
   * Reset internal state (conversation history, etc.)
   */
  reset(): void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATED USER (Adapted for chat agent testing)
// ═══════════════════════════════════════════════════════════════════════════════

export class ChatSimulatedUser {
  private model: ChatOpenAI;
  private scenario: GeneratedScenario;
  private conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  private turnCount = 0;
  private maxTurns: number;

  constructor(scenario: GeneratedScenario, maxTurns: number = 3) {
    this.scenario = scenario;
    this.maxTurns = maxTurns;
    this.model = new ChatOpenAI({
      model: "google/gemini-2.5-flash",
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
      },
      temperature: 0.3,
    });
  }

  getInitialMessage(): string {
    return this.scenario.generatedMessage;
  }

  addUserMessage(message: string) {
    this.conversationHistory.push({ role: "user", content: message });
  }

  addAssistantMessage(message: string) {
    this.conversationHistory.push({ role: "assistant", content: message });
  }

  getConversation() {
    return this.conversationHistory;
  }

  async respond(assistantMessage: string): Promise<{ message: string; shouldContinue: boolean; reason?: string }> {
    this.addAssistantMessage(assistantMessage);
    this.turnCount++;

    if (this.turnCount >= this.maxTurns) {
      return { message: "", shouldContinue: false, reason: "max_turns_reached" };
    }

    const prompt = `You are simulating a user with a SPECIFIC GOAL. STAY FOCUSED on your original need - don't get sidetracked!

## YOUR ORIGINAL NEED (NEVER FORGET THIS!)
${this.scenario.need.description}

## Your Initial Message
${this.scenario.generatedMessage}

## Your Persona
${this.scenario.persona.communicationStyle}

## Turn ${this.turnCount}/${this.maxTurns}

## Last Assistant Response
${assistantMessage.slice(0, 500)}

## Decision Rules - CRITICAL: Stay on track!
1. **Agent addresses your ORIGINAL need** (${this.scenario.need.description}):
   - If results/answer provided → shouldContinue: false, reason: "need_fulfilled"
   - If asking clarifying question about YOUR need → answer it, shouldContinue: true

2. **Agent is off-topic or confused** (talking about something else):
   - Redirect them: "No, I wanted to [restate your original need]", shouldContinue: true
   - If they keep failing → shouldContinue: false, reason: "agent_confused"

3. **Agent misunderstood completely**:
   - Try ONCE to clarify, then give up if they still don't get it
   - shouldContinue: false, reason: "misunderstood"

**NEVER** get sidetracked into a different task. Your goal is: ${this.scenario.need.description}

Respond ONLY with JSON:
{"shouldContinue": boolean, "reason": string, "message": string}`;

    const response = await this.model.invoke([new HumanMessage(prompt)]);
    const content = response.content.toString();

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Add the user's response to history if continuing
      if (parsed.message) {
        this.addUserMessage(parsed.message);
      }
      
      return {
        shouldContinue: Boolean(parsed.shouldContinue),
        reason: parsed.reason || "unknown",
        message: parsed.message || "",
      };
    } catch {
      return { message: "", shouldContinue: false, reason: "parse_error" };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEED FULFILLMENT EVALUATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * LLM-based evaluator that judges whether user needs were fulfilled
 */
export class NeedFulfillmentEvaluator {
  private model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      model: "google/gemini-2.5-flash",
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
      },
      temperature: 0.2,
    });
  }

  async evaluate(
    scenario: GeneratedScenario,
    conversation: Array<{ role: "user" | "assistant"; content: string }>,
    metadata: { candidatesFound?: number }
  ): Promise<{
    needFulfilled: boolean;
    fulfillmentScore: number; // 0-1
    successSignalsMatched: string[];
    failureSignalsTriggered: string[];
    qualityScore: number; // 0-1
    qualityNotes: string[];
    overallVerdict: "success" | "partial" | "failure" | "blocked";
    reasoning: string;
  }> {
    const conversationText = conversation.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

    const prompt = `Evaluate this conversation:

## User's Underlying Need (THE GOAL!)
${scenario.need.description}

## User's Initial Request
${scenario.generatedMessage}

## User Persona
${scenario.persona.description}
Style: ${scenario.persona.communicationStyle}

## User Context
- Has profile: ${scenario.context.hasProfile}
- Has intents: ${scenario.context.hasIntents}
- Is index owner: ${scenario.context.isIndexOwner}
- Index memberships: ${scenario.context.indexMembershipCount}

## Conversation
${conversationText}

## Metadata
- Candidates found: ${metadata.candidatesFound ?? "unknown"}

## Success Signals (need met if these happen)
${scenario.evaluationCriteria.successSignals.map((s) => `- ${s}`).join("\n")}

## Failure Signals (problems if these happen)
${scenario.evaluationCriteria.failureSignals.map((s) => `- ${s}`).join("\n")}

## Quality Factors
${scenario.evaluationCriteria.qualityFactors.map((q) => `- ${q}`).join("\n")}

## CRITICAL: Check if agent stayed on-topic
- Did the agent ADDRESS the user's ORIGINAL need: "${scenario.need.description}"?
- Or did the agent get sidetracked into a different task?
- If the agent worked on the WRONG task → MAJOR FAILURE

Evaluate:
1. Was the user's ORIGINAL need fulfilled? (not some other task!)
2. Which success signals were matched?
3. Which failure signals were triggered?
4. Did agent stay focused on the original need? (critical for quality score)
5. Quality of the interaction (0-1 score) - PENALIZE heavily if off-topic
6. Quality notes (what was good/bad, mention if off-topic)
7. Overall verdict: success/partial/failure/blocked
8. Brief reasoning (1-2 sentences, mention if agent was off-topic)

Respond in JSON:
{
  "needFulfilled": boolean,
  "fulfillmentScore": 0-1,
  "successSignalsMatched": string[],
  "failureSignalsTriggered": string[],
  "qualityScore": 0-1,
  "qualityNotes": string[],
  "overallVerdict": "success" | "partial" | "failure" | "blocked",
  "reasoning": "..."
}`;

    const response = await this.model.invoke([new HumanMessage(prompt)]);
    const content = typeof response.content === "string" ? response.content : String(response.content);

    // Parse JSON (handle markdown code blocks)
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        needFulfilled: false,
        fulfillmentScore: 0,
        successSignalsMatched: [],
        failureSignalsTriggered: ["evaluation_parse_error"],
        qualityScore: 0,
        qualityNotes: ["Failed to parse evaluation response"],
        overallVerdict: "failure",
        reasoning: "Evaluation parsing failed",
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      return {
        needFulfilled: parsed.needFulfilled,
        fulfillmentScore: parsed.fulfillmentScore,
        successSignalsMatched: parsed.successSignalsMatched || [],
        failureSignalsTriggered: parsed.failureSignalsTriggered || [],
        qualityScore: parsed.qualityScore,
        qualityNotes: parsed.qualityNotes || [],
        overallVerdict: parsed.overallVerdict,
        reasoning: parsed.reasoning || "",
      };
    } catch (error) {
      return {
        needFulfilled: false,
        fulfillmentScore: 0,
        successSignalsMatched: [],
        failureSignalsTriggered: ["evaluation_parse_error"],
        qualityScore: 0,
        qualityNotes: ["Failed to parse evaluation JSON"],
        overallVerdict: "failure",
        reasoning: "Evaluation JSON parsing failed",
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═════════════════════════════════════════════════════════════════════════════════

export interface ChatEvaluationResult {
  scenarioId: string;
  need: string;
  persona: string;
  turns: number;
  verdict: "success" | "partial" | "failure" | "blocked";
  fulfillmentScore: number;
  qualityScore: number;
  reasoning: string;
  successSignals: string[];
  failureSignals: string[];
  qualityNotes: string[];
  conversation: Array<{ role: "user" | "assistant"; content: string; toolCalls?: any[] }>;
  rawMessages?: BaseMessage[]; // Full LangChain message history
  durationMs: number;
  timedOut: boolean;
}

/**
 * Run a single evaluation scenario against the chat agent
 */
export async function runChatEvaluation(
  scenario: GeneratedScenario,
  chatAgent: ChatAgentInterface,
  options?: {
    verbose?: boolean;
    maxTurns?: number;
    timeoutMs?: number;
    onEvent?: (event: any) => void;
    userId?: string; // Pass the real user ID for the chat agent
  }
): Promise<ChatEvaluationResult> {
  const startTime = Date.now();
  const maxTurns = options?.maxTurns || 3;
  const timeoutMs = options?.timeoutMs || 90000;
  const simulatedUser = new ChatSimulatedUser(scenario, maxTurns);
  const evaluator = new NeedFulfillmentEvaluator();
  const userId = options?.userId || "test-user"; // Use provided user ID

  chatAgent.reset();

  let currentMessage = simulatedUser.getInitialMessage();
  simulatedUser.addUserMessage(currentMessage);

  if (options?.verbose) {
    console.log(`\n=== Scenario: ${scenario.id} ===`);
    console.log(`Need: ${scenario.need.description}`);
    console.log(`Persona: ${scenario.persona.id}`);
  }

  options?.onEvent?.({
    type: "scenario_started",
    data: {
      scenarioId: scenario.id,
      need: scenario.need.id,
      persona: scenario.persona.id,
      initialMessage: currentMessage,
    },
  });

  let turnCount = 0;
  let timedOut = false;
  const fullConversation: Array<{ role: "user" | "assistant"; content: string; toolCalls?: any[] }> = [];
  let allRawMessages: BaseMessage[] = [];

  while (turnCount < maxTurns) {
    if (Date.now() - startTime > timeoutMs) {
      timedOut = true;
      if (options?.verbose) {
        console.log(`[TIMEOUT] Exceeded ${timeoutMs}ms`);
      }
      break;
    }

    turnCount++;

    if (options?.verbose) {
      console.log(`\n[Turn ${turnCount}/${maxTurns}] USER: ${currentMessage}`);
    }

    fullConversation.push({ role: "user", content: currentMessage });

    options?.onEvent?.({
      type: "turn_started",
      data: { scenarioId: scenario.id, turnNumber: turnCount, userMessage: currentMessage },
    });

    // Call chat agent
    let agentResult: Awaited<ReturnType<ChatAgentInterface["chat"]>>;
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Agent timeout")), 60000)
      );
      agentResult = await Promise.race([
        chatAgent.chat(currentMessage, { userId }), // Use the real user ID
        timeoutPromise,
      ]);
    } catch (e) {
      if (options?.verbose) {
        console.log(`[ERROR] Agent call failed: ${e}`);
      }
      break;
    }

    if (agentResult.error) {
      if (options?.verbose) {
        console.log(`[ERROR] ${agentResult.error}`);
      }
      break;
    }

    const assistantMessage = agentResult.response || "No response";
    fullConversation.push({
      role: "assistant",
      content: assistantMessage,
      toolCalls: agentResult.toolCalls,
    });

    if (agentResult.rawMessages) {
      allRawMessages = allRawMessages.concat(agentResult.rawMessages);
    }

    if (options?.verbose) {
      console.log(`[Turn ${turnCount}] ASSISTANT: ${assistantMessage.slice(0, 200)}${assistantMessage.length > 200 ? "..." : ""}`);
      if (agentResult.toolCalls?.length) {
        console.log(`[Turn ${turnCount}] Tools: ${agentResult.toolCalls.map((t) => t.tool).join(", ")}`);
      }
    }

    options?.onEvent?.({
      type: "turn_completed",
      data: {
        scenarioId: scenario.id,
        turnNumber: turnCount,
        agentResponse: assistantMessage,  // Frontend expects agentResponse
        userMessage: currentMessage,       // Include the user message
        toolsUsed: agentResult.toolCalls?.map((t) => t.tool) || [],
      },
    });

    // Check if conversation should continue
    const userDecision = await simulatedUser.respond(assistantMessage);

    if (options?.verbose && userDecision.reason) {
      console.log(`[Turn ${turnCount}] User decision: ${userDecision.reason}`);
    }

    if (!userDecision.shouldContinue) {
      break;
    }

    currentMessage = userDecision.message;
    if (!currentMessage) break;
    simulatedUser.addUserMessage(currentMessage);
  }

  const elapsed = Date.now() - startTime;

  // Evaluate
  const evaluation = await evaluator.evaluate(
    scenario,
    fullConversation,
    { candidatesFound: 0 } // Chat agent doesn't track candidates like opportunity graph
  );

  const result: ChatEvaluationResult = {
    scenarioId: scenario.id,
    need: scenario.need.id,
    persona: scenario.persona.id,
    turns: turnCount,
    verdict: evaluation.overallVerdict,
    fulfillmentScore: evaluation.fulfillmentScore,
    qualityScore: evaluation.qualityScore,
    reasoning: evaluation.reasoning,
    successSignals: evaluation.successSignalsMatched,
    failureSignals: evaluation.failureSignalsTriggered,
    qualityNotes: evaluation.qualityNotes,
    conversation: fullConversation,
    rawMessages: allRawMessages.length > 0 ? allRawMessages : undefined,
    durationMs: elapsed,
    timedOut,
  };

  if (options?.verbose) {
    console.log(`\n=== Result: ${result.verdict} (${result.fulfillmentScore}) ===`);
    console.log(`Reasoning: ${result.reasoning}`);
  }

  options?.onEvent?.({
    type: "scenario_completed",
    data: {
      scenarioId: scenario.id,
      verdict: result.verdict,
      fulfillmentScore: result.fulfillmentScore,
      qualityScore: result.qualityScore,
      turns: result.turns,
      duration: result.durationMs,  // Frontend expects 'duration', not 'durationMs'
      reasoning: result.reasoning,
      conversation: result.conversation,
      successSignals: result.successSignals,
      failureSignals: result.failureSignals,
      qualityNotes: result.qualityNotes,
    },
  });

  return result;
}

/**
 * Run a batch of evaluations
 */
export async function runChatEvaluationSuite(
  scenarios: GeneratedScenario[],
  chatAgent: ChatAgentInterface,
  options?: {
    verbose?: boolean;
    parallel?: boolean;
    maxTurns?: number;
    timeoutMs?: number;
    userId?: string; // Real user ID to pass to each evaluation
    onEvent?: (event: any) => void;
  }
): Promise<{
  results: ChatEvaluationResult[];
  summary: {
    total: number;
    success: number;
    partial: number;
    failure: number;
    blocked: number;
    avgFulfillment: number;
    avgQuality: number;
  };
}> {
  const results: ChatEvaluationResult[] = [];

  if (options?.parallel) {
    // Run in parallel
    const promises = scenarios.map((scenario) => runChatEvaluation(scenario, chatAgent, { ...options, userId: options?.userId }));
    results.push(...(await Promise.all(promises)));
  } else {
    // Run sequentially
    for (const scenario of scenarios) {
      const result = await runChatEvaluation(scenario, chatAgent, { ...options, userId: options?.userId });
      results.push(result);
    }
  }

  // Calculate summary
  const summary = {
    total: results.length,
    success: results.filter((r) => r.verdict === "success").length,
    partial: results.filter((r) => r.verdict === "partial").length,
    failure: results.filter((r) => r.verdict === "failure").length,
    blocked: results.filter((r) => r.verdict === "blocked").length,
    avgFulfillment: results.reduce((sum, r) => sum + r.fulfillmentScore, 0) / results.length,
    avgQuality: results.reduce((sum, r) => sum + r.qualityScore, 0) / results.length,
  };

  return { results, summary };
}
