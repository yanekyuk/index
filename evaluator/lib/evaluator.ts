/**
 * Chat Agent Evaluator - API-based
 * Uses sendMessage to call protocol chat stream, SimulatedUser + NeedFulfillmentEvaluator for eval.
 * Supports seed lifecycle: seed protocol DB -> auth -> evaluate -> cleanup.
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
import type { SeedRequirement, GeneratedSeedData } from "./seed/seed.types";
import { resolveSeedRequirements } from "./seed/seed.types";
import { generateSeedData } from "./seed/seed.generator";
import { seedProtocol, cleanupSeed, cleanupNoseedUser } from "./seed/protocol.seeder";
import { signIn, createAuthSession } from "./seed/auth.session";

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONA MESSAGE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

const PERSONA_STYLES: Record<string, string> = {
  direct_requester: "direct, brief, action-oriented — gets straight to the point",
  exploratory_seeker: "curious, asks follow-up questions, explores options",
  technical_precise: "precise, technical, detailed requirements",
  vague_requester: "vague, ambiguous, needs clarification",
};

export async function generatePersonaMessages(
  question: string,
  expectation: string
): Promise<Record<string, string>> {
  const model = new ChatOpenAI({
    model: "google/gemini-2.5-flash",
    configuration: {
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    },
    temperature: 0.4,
  });

  const personaList = Object.entries(PERSONA_STYLES)
    .map(([id, style]) => `- "${id}": ${style}`)
    .join("\n");

  const prompt = `Rephrase the following user question in 4 different communication styles. Each rephrasing should convey the same underlying intent but match the persona's style.

## Question
${question}

## Expected outcome
${expectation}

## Personas
${personaList}

Return ONLY a JSON object mapping persona id to the rephrased message. Keep messages concise (1-2 sentences max).

{"direct_requester": "...", "exploratory_seeker": "...", "technical_precise": "...", "vague_requester": "..."}`;

  const response = await model.invoke([new HumanMessage(prompt)]);
  const content = response.content.toString();
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to generate persona messages");
  return JSON.parse(jsonMatch[0]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATED SCENARIO (for eval pipeline)
// ═══════════════════════════════════════════════════════════════════════════════

export interface GeneratedScenario {
  id: string;
  need: { id: string; question: string; expectation: string };
  persona: { id: string; description: string; communicationStyle: string };
  generatedMessage: string;
  seedRequirements?: SeedRequirement | null;
  category?: string;
}

export function scenarioToGenerated(s: Scenario): GeneratedScenario {
  const need = CHAT_AGENT_USER_NEEDS[s.needId];
  const persona = USER_PERSONAS[s.personaId as UserPersonaId];
  if (!need || !persona)
    throw new Error(`Unknown need or persona: ${s.needId}/${s.personaId}`);
  return {
    id: s.id,
    need: { id: need.id, question: need.question, expectation: need.expectation },
    persona: {
      id: persona.id,
      description: persona.description,
      communicationStyle: persona.communicationStyle,
    },
    generatedMessage: s.message,
    category: s.category,
  };
}

/**
 * Build a GeneratedScenario from an eval_scenarios DB row.
 */
export function dbScenarioToGenerated(row: {
  id: string;
  question: string;
  expectation: string;
  message: string;
  personaId?: string | null;
  category: string;
  needId?: string | null;
  seedRequirements?: SeedRequirement | null;
}): GeneratedScenario {
  const personaKey = row.personaId as UserPersonaId | undefined;
  const persona = personaKey ? USER_PERSONAS[personaKey] : undefined;

  return {
    id: row.id,
    need: {
      id: row.needId || row.category,
      question: row.question,
      expectation: row.expectation,
    },
    persona: persona
      ? {
          id: persona.id,
          description: persona.description,
          communicationStyle: persona.communicationStyle,
        }
      : {
          id: "default",
          description: "Standard user",
          communicationStyle: "clear, conversational",
        },
    generatedMessage: row.message,
    seedRequirements: row.seedRequirements,
    category: row.category,
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
${this.scenario.need.question}

## What You Expect
${this.scenario.need.expectation}

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

## User's Question
${scenario.need.question}

## Expected Outcome
${scenario.need.expectation}

## User's Initial Request
${scenario.generatedMessage}

## User Persona
${scenario.persona.description}
Style: ${scenario.persona.communicationStyle}

## Conversation
${conversationText}

Evaluate whether the agent fulfilled the user's need based on the expected outcome above.

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
  seedData?: GeneratedSeedData;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUN EVALUATION (legacy: token-based, no seeding)
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
  return _runConversation(scenario, {
    apiUrl: options.apiUrl,
    authToken: options.token,
    maxTurns: options.maxTurns,
    timeoutMs: options.timeoutMs,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUN SEEDED EVALUATION (seed → auth → evaluate → cleanup)
// ═══════════════════════════════════════════════════════════════════════════════

export async function runSeededEvaluation(
  scenario: GeneratedScenario,
  options: {
    apiUrl: string;
    maxTurns?: number;
    timeoutMs?: number;
  }
): Promise<ChatEvaluationResult> {
  const requirements = resolveSeedRequirements(
    scenario.category || "meta",
    scenario.need.id,
    scenario.seedRequirements
  );

  const needsSeeding =
    requirements.user.hasProfile ||
    requirements.user.intentCount > 0 ||
    requirements.network.otherUsers > 0 ||
    requirements.indexes.count > 0;

  let seedData: GeneratedSeedData | undefined;
  let noseedEmail: string | undefined;
  let cookie: string | undefined;

  try {
    if (needsSeeding) {
      seedData = await generateSeedData(requirements, {
        question: scenario.need.question,
        expectation: scenario.need.expectation,
        category: scenario.category || "meta",
      });

      await seedProtocol(seedData, options.apiUrl);

      const session = await signIn(
        options.apiUrl,
        seedData.testUser.email,
        seedData.testUser.password
      );
      cookie = session.cookie;
    } else {
      noseedEmail = `eval-noseed-${crypto.randomUUID().slice(0, 8)}@test.indexnetwork.io`;
      const session = await createAuthSession(
        options.apiUrl,
        noseedEmail,
        `EvalTest!${crypto.randomUUID().slice(0, 8)}`,
        "Eval User"
      );
      cookie = session.cookie;
    }

    const result = await _runConversation(scenario, {
      apiUrl: options.apiUrl,
      cookie,
      maxTurns: options.maxTurns,
      timeoutMs: options.timeoutMs,
    });

    result.seedData = seedData;
    return result;
  } finally {
    if (seedData) {
      try {
        await cleanupSeed(seedData.seedTag);
      } catch (err) {
        console.error("Seed cleanup failed:", err);
      }
    }
    if (noseedEmail) {
      try {
        await cleanupNoseedUser(noseedEmail);
      } catch (err) {
        console.error("Noseed cleanup failed:", err);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL: conversation runner
// ═══════════════════════════════════════════════════════════════════════════════

async function _runConversation(
  scenario: GeneratedScenario,
  options: {
    apiUrl: string;
    authToken?: string;
    cookie?: string;
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

    const result = await sendMessage(
      options.apiUrl,
      options.authToken || "",
      {
        message: currentMessage,
        sessionId,
        cookie: options.cookie,
      }
    );

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
