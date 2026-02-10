/**
 * Chat Agent Evaluator - API-based
 * Uses sendMessage to call protocol chat stream, SimulatedUser + NeedFulfillmentEvaluator for eval.
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { sendMessage } from "./chat-client";
import {
  CHAT_AGENT_USER_NEEDS,
  USER_PERSONAS,
  type Scenario,
  type UserPersonaId,
} from "./scenarios";

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATED SCENARIO (for eval pipeline)
// ═══════════════════════════════════════════════════════════════════════════════

export interface EvaluationCriteria {
  successSignals: readonly string[];
  failureSignals: readonly string[];
  qualityFactors: readonly string[];
}

const DEFAULT_CRITERIA: EvaluationCriteria = {
  successSignals: ["task completed", "appropriate response provided"],
  failureSignals: ["task failed", "incorrect response"],
  qualityFactors: ["clear communication", "appropriate tone", "efficient interaction"],
};

export interface GeneratedScenario {
  id: string;
  need: { id: string; description: string; examples: string[] };
  persona: { id: string; description: string; communicationStyle: string };
  generatedMessage: string;
  evaluationCriteria: EvaluationCriteria;
}

export function scenarioToGenerated(s: Scenario): GeneratedScenario {
  const need = CHAT_AGENT_USER_NEEDS[s.needId];
  const persona = USER_PERSONAS[s.personaId as UserPersonaId];
  if (!need || !persona)
    throw new Error(`Unknown need or persona: ${s.needId}/${s.personaId}`);
  return {
    id: s.id,
    need: { id: need.id, description: need.description, examples: need.examples },
    persona: {
      id: persona.id,
      description: persona.description,
      communicationStyle: persona.communicationStyle,
    },
    generatedMessage: s.message,
    evaluationCriteria: DEFAULT_CRITERIA,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATED USER
// ═══════════════════════════════════════════════════════════════════════════════

export class ChatSimulatedUser {
  private model: ChatOpenAI;
  private scenario: GeneratedScenario;
  private conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  private turnCount = 0;
  private maxTurns: number;

  constructor(scenario: GeneratedScenario, maxTurns = 3) {
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

  async respond(
    assistantMessage: string
  ): Promise<{ message: string; shouldContinue: boolean; reason?: string }> {
    this.addAssistantMessage(assistantMessage);
    this.turnCount++;

    if (this.turnCount >= this.maxTurns)
      return { message: "", shouldContinue: false, reason: "max_turns_reached" };

    const prompt = `You are simulating a user with a SPECIFIC GOAL. STAY FOCUSED on your original need!

## YOUR ORIGINAL NEED
${this.scenario.need.description}

## Your Initial Message
${this.scenario.generatedMessage}

## Your Persona
${this.scenario.persona.communicationStyle}

## Turn ${this.turnCount}/${this.maxTurns}

## Last Assistant Response
${assistantMessage.slice(0, 500)}

1. If agent addresses your ORIGINAL need → shouldContinue: false, reason: "need_fulfilled"
2. If agent is off-topic → Redirect: "No, I wanted to [restate your need]", shouldContinue: true
3. If misunderstood → Try once to clarify, then give up

Respond ONLY with JSON:
{"shouldContinue": boolean, "reason": string, "message": string}`;

    const response = await this.model.invoke([new HumanMessage(prompt)]);
    const content = response.content.toString();

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON");
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.message) this.addUserMessage(parsed.message);
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
    fulfillmentScore: number;
    successSignalsMatched: string[];
    failureSignalsTriggered: string[];
    qualityScore: number;
    qualityNotes: string[];
    overallVerdict: "success" | "partial" | "failure" | "blocked";
    reasoning: string;
  }> {
    const conversationText = conversation
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    const prompt = `Evaluate this conversation:

## User's Underlying Need
${scenario.need.description}

## User's Initial Request
${scenario.generatedMessage}

## User Persona
${scenario.persona.description}
Style: ${scenario.persona.communicationStyle}

## Conversation
${conversationText}

## Success Signals
${scenario.evaluationCriteria.successSignals.map((s) => `- ${s}`).join("\n")}

## Failure Signals
${scenario.evaluationCriteria.failureSignals.map((s) => `- ${s}`).join("\n")}

## Quality Factors
${scenario.evaluationCriteria.qualityFactors.map((q) => `- ${q}`).join("\n")}

Evaluate: needFulfilled, fulfillmentScore 0-1, successSignalsMatched, failureSignalsTriggered, qualityScore 0-1, qualityNotes, overallVerdict (success|partial|failure|blocked), reasoning.

Respond in JSON:
{"needFulfilled": boolean, "fulfillmentScore": number, "successSignalsMatched": string[], "failureSignalsTriggered": string[], "qualityScore": number, "qualityNotes": string[], "overallVerdict": "success"|"partial"|"failure"|"blocked", "reasoning": string}`;

    const response = await this.model.invoke([new HumanMessage(prompt)]);
    const content = typeof response.content === "string" ? response.content : String(response.content);

    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        needFulfilled: false,
        fulfillmentScore: 0,
        successSignalsMatched: [],
        failureSignalsTriggered: ["evaluation_parse_error"],
        qualityScore: 0,
        qualityNotes: ["Failed to parse evaluation"],
        overallVerdict: "failure",
        reasoning: "Evaluation parsing failed",
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      return {
        needFulfilled: parsed.needFulfilled,
        fulfillmentScore: parsed.fulfillmentScore ?? 0,
        successSignalsMatched: parsed.successSignalsMatched || [],
        failureSignalsTriggered: parsed.failureSignalsTriggered || [],
        qualityScore: parsed.qualityScore ?? 0,
        qualityNotes: parsed.qualityNotes || [],
        overallVerdict: parsed.overallVerdict ?? "failure",
        reasoning: parsed.reasoning || "",
      };
    } catch {
      return {
        needFulfilled: false,
        fulfillmentScore: 0,
        successSignalsMatched: [],
        failureSignalsTriggered: ["evaluation_parse_error"],
        qualityScore: 0,
        qualityNotes: ["Failed to parse JSON"],
        overallVerdict: "failure",
        reasoning: "JSON parse failed",
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATION RESULT
// ═══════════════════════════════════════════════════════════════════════════════

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
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  durationMs: number;
  timedOut: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUN EVALUATION (API-based chat)
// ═══════════════════════════════════════════════════════════════════════════════

export async function runChatEvaluation(
  scenario: GeneratedScenario,
  options: {
    apiUrl: string;
    token: string;
    maxTurns?: number;
    timeoutMs?: number;
  }
): Promise<ChatEvaluationResult> {
  const startTime = Date.now();
  const maxTurns = options.maxTurns ?? 3;
  const timeoutMs = options.timeoutMs ?? 90000;
  const simulatedUser = new ChatSimulatedUser(scenario, maxTurns);
  const evaluator = new NeedFulfillmentEvaluator();

  let currentMessage = simulatedUser.getInitialMessage();
  simulatedUser.addUserMessage(currentMessage);

  let turnCount = 0;
  let timedOut = false;
  const fullConversation: Array<{ role: "user" | "assistant"; content: string }> = [];
  let sessionId: string | undefined;

  while (turnCount < maxTurns) {
    if (Date.now() - startTime > timeoutMs) {
      timedOut = true;
      break;
    }
    turnCount++;
    fullConversation.push({ role: "user", content: currentMessage });

    const result = await sendMessage(options.apiUrl, options.token, {
      message: currentMessage,
      sessionId,
    });

    if (result.error) break;

    sessionId = result.sessionId;
    const assistantMessage = result.response || "No response";
    fullConversation.push({ role: "assistant", content: assistantMessage });

    const userDecision = await simulatedUser.respond(assistantMessage);
    if (!userDecision.shouldContinue) break;

    currentMessage = userDecision.message;
    if (!currentMessage) break;
    simulatedUser.addUserMessage(currentMessage);
  }

  const elapsed = Date.now() - startTime;
  const evaluation = await evaluator.evaluate(
    scenario,
    fullConversation,
    { candidatesFound: 0 }
  );

  return {
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
    durationMs: elapsed,
    timedOut,
  };
}
