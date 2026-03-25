# Bilateral Agent Negotiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bilateral agent-to-agent negotiation as a consensus gate between opportunity evaluation and ranking, using A2A conversation primitives.

**Architecture:** A new `negotiation.graph.ts` LangGraph state machine (init → turn → evaluate → finalize) is invoked per candidate from a new `negotiateNode` in the opportunity graph. Two agents (proposer/responder) exchange structured turns via A2A messages within a dedicated conversation. The negotiation outcome (consensus yes/no) determines whether the candidate proceeds to ranking.

**Tech Stack:** LangGraph, Zod, Drizzle ORM (existing A2A tables), OpenRouter via `createModel()`, bun:test

**Spec:** `docs/superpowers/specs/2026-03-23-bilateral-negotiation-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `protocol/src/lib/protocol/states/negotiation.state.ts` | Annotation.Root state, Zod schemas for NegotiationTurn and NegotiationOutcome, UserNegotiationContext type |
| `protocol/src/lib/protocol/agents/negotiation.proposer.ts` | Agent that argues for the match — system prompt, structured output, invoke method |
| `protocol/src/lib/protocol/agents/negotiation.responder.ts` | Agent that evaluates against its user's interests — system prompt, structured output, invoke method |
| `protocol/src/lib/protocol/graphs/negotiation.graph.ts` | LangGraph state machine: NegotiationGraphFactory with initNode, turnNode, evaluateNode, finalizeNode |
| `protocol/tests/negotiation.graph.spec.ts` | Unit tests for negotiation graph routing and state transitions |
| `protocol/tests/negotiation.agents.spec.ts` | Unit tests for proposer and responder agents with mocked LLM |
| `protocol/tests/opportunity.negotiation.spec.ts` | Integration test for negotiateNode in opportunity graph |

### Modified Files

| File | Change |
|------|--------|
| `protocol/src/lib/protocol/agents/model.config.ts` | Add `negotiationProposer` and `negotiationResponder` entries |
| `protocol/src/lib/protocol/graphs/opportunity.graph.ts` | Add `negotiateNode`, rewire `evaluation → negotiate → ranking` edge, skip for continue_discovery and introduction modes |

---

## Task 1: Negotiation State & Zod Schemas

**Files:**
- Create: `protocol/src/lib/protocol/states/negotiation.state.ts`

- [ ] **Step 1: Create the Zod schemas and types**

```typescript
// protocol/src/lib/protocol/states/negotiation.state.ts
import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

/** Zod schema for a single negotiation turn (DataPart payload in A2A message). */
export const NegotiationTurnSchema = z.object({
  action: z.enum(["propose", "accept", "reject", "counter"]),
  assessment: z.object({
    fitScore: z.number().min(0).max(100),
    reasoning: z.string(),
    suggestedRoles: z.object({
      ownUser: z.enum(["agent", "patient", "peer"]),
      otherUser: z.enum(["agent", "patient", "peer"]),
    }),
  }),
});

export type NegotiationTurn = z.infer<typeof NegotiationTurnSchema>;

/** Zod schema for the negotiation outcome (Artifact payload on COMPLETED task). */
export const NegotiationOutcomeSchema = z.object({
  consensus: z.boolean(),
  finalScore: z.number().min(0).max(100),
  agreedRoles: z.array(z.object({
    userId: z.string(),
    role: z.enum(["agent", "patient", "peer"]),
  })),
  reasoning: z.string(),
  turnCount: z.number(),
  reason: z.string().optional(),
});

export type NegotiationOutcome = z.infer<typeof NegotiationOutcomeSchema>;

/** Context each agent receives about its user. */
export interface UserNegotiationContext {
  id: string;
  intents: Array<{ id: string; title: string; description: string; confidence: number }>;
  profile: { name?: string; bio?: string; location?: string; interests?: string[]; skills?: string[] };
  hydeDocuments: string[];
}

/** Seed assessment from the evaluator pre-filter. */
export interface SeedAssessment {
  score: number;
  reasoning: string;
  valencyRole: string;
  actors?: Array<{ userId: string; role: string }>;
}

/** A2A message record shape (matches messages table). */
interface NegotiationMessage {
  id: string;
  senderId: string;
  role: "agent";
  parts: unknown[];
  createdAt: Date;
}

/** LangGraph state annotation for the negotiation graph. */
export const NegotiationGraphState = Annotation.Root({
  sourceUser: Annotation<UserNegotiationContext>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({} as UserNegotiationContext),
  }),
  candidateUser: Annotation<UserNegotiationContext>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({} as UserNegotiationContext),
  }),
  indexContext: Annotation<{ indexId: string; prompt: string }>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ indexId: "", prompt: "" }),
  }),
  seedAssessment: Annotation<SeedAssessment>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ score: 0, reasoning: "", valencyRole: "" }),
  }),

  conversationId: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => "",
  }),
  taskId: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => "",
  }),
  messages: Annotation<NegotiationMessage[]>({
    reducer: (curr, next) => [...curr, ...(next || [])],
    default: () => [],
  }),
  turnCount: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),
  maxTurns: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 6,
  }),

  currentSpeaker: Annotation<"source" | "candidate">({
    reducer: (curr, next) => next ?? curr,
    default: () => "source" as const,
  }),
  lastTurn: Annotation<NegotiationTurn | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),

  outcome: Annotation<NegotiationOutcome | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),
  error: Annotation<string | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),
});
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd protocol && npx tsc --noEmit src/lib/protocol/states/negotiation.state.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add protocol/src/lib/protocol/states/negotiation.state.ts
git commit -m "feat(negotiation): add state annotation and Zod schemas"
```

---

## Task 2: Model Config Entries

**Files:**
- Modify: `protocol/src/lib/protocol/agents/model.config.ts`

- [ ] **Step 1: Add negotiation agent entries to MODEL_CONFIG**

Add these two entries to the `MODEL_CONFIG` object (after the `opportunityPresenter` entry):

```typescript
negotiationProposer:  { model: "google/gemini-2.5-flash" },
negotiationResponder: { model: "google/gemini-2.5-flash" },
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd protocol && npx tsc --noEmit src/lib/protocol/agents/model.config.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add protocol/src/lib/protocol/agents/model.config.ts
git commit -m "feat(negotiation): add model config for proposer and responder agents"
```

---

## Task 3: Negotiation Proposer Agent

**Files:**
- Create: `protocol/src/lib/protocol/agents/negotiation.proposer.ts`
- Test: `protocol/tests/negotiation.agents.spec.ts`

- [ ] **Step 1: Write the failing test for the proposer**

```typescript
// protocol/tests/negotiation.agents.spec.ts
import { config } from "dotenv";
config({ path: ".env.development" });

import { describe, it, expect } from "bun:test";
import { NegotiationProposer } from "../src/lib/protocol/agents/negotiation.proposer";
import type { UserNegotiationContext, SeedAssessment, NegotiationTurn } from "../src/lib/protocol/states/negotiation.state";

const sourceUser: UserNegotiationContext = {
  id: "user-source",
  intents: [{ id: "i1", title: "Looking for ML engineer", description: "Need ML expertise for recommendation system", confidence: 0.9 }],
  profile: { name: "Alice", bio: "Product manager at a startup", skills: ["product management", "AI strategy"] },
  hydeDocuments: ["A product leader seeking technical ML collaboration"],
};

const candidateUser: UserNegotiationContext = {
  id: "user-candidate",
  intents: [{ id: "i2", title: "Seeking PM collaboration", description: "ML engineer looking for product-minded co-founder", confidence: 0.85 }],
  profile: { name: "Bob", bio: "Senior ML engineer", skills: ["machine learning", "PyTorch", "recommendations"] },
  hydeDocuments: ["An ML engineer seeking product leadership for a startup venture"],
};

const seedAssessment: SeedAssessment = {
  score: 78,
  reasoning: "Strong complementary skills between product management and ML engineering",
  valencyRole: "Peer",
};

describe("NegotiationProposer", () => {
  it("generates a valid proposal turn", async () => {
    const proposer = new NegotiationProposer();
    const result = await proposer.invoke({
      ownUser: sourceUser,
      otherUser: candidateUser,
      indexContext: { indexId: "idx-1", prompt: "AI startup co-founders" },
      seedAssessment,
      history: [],
    });

    expect(result.action).toBe("propose");
    expect(result.assessment.fitScore).toBeGreaterThanOrEqual(0);
    expect(result.assessment.fitScore).toBeLessThanOrEqual(100);
    expect(result.assessment.reasoning).toBeTruthy();
    expect(["agent", "patient", "peer"]).toContain(result.assessment.suggestedRoles.ownUser);
    expect(["agent", "patient", "peer"]).toContain(result.assessment.suggestedRoles.otherUser);
  }, 30_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd protocol && bun test tests/negotiation.agents.spec.ts`
Expected: FAIL — cannot find module `negotiation.proposer`

- [ ] **Step 3: Implement the proposer agent**

```typescript
// protocol/src/lib/protocol/agents/negotiation.proposer.ts
import { createModel } from "./model.config";
import { NegotiationTurnSchema, type NegotiationTurn, type UserNegotiationContext, type SeedAssessment } from "../states/negotiation.state";

const SYSTEM_PROMPT = `You are a negotiation agent representing your user in an opportunity matching system.
Your role is to PROPOSE and ARGUE FOR a potential match between your user and another user.

You will receive:
- Your user's profile, intents, and context
- The other user's profile, intents, and context
- An initial assessment from a pre-screening evaluator
- Any prior negotiation history

Your job:
1. On the FIRST turn: Propose the match. Explain why this connection would benefit both parties. Set action to "propose".
2. On SUBSEQUENT turns (after a counter from the other agent): Address their objections. Either:
   - "counter" with updated reasoning if you still believe in the match
   - "accept" if the other agent's counter is reasonable and you agree
   - "reject" if their objections reveal this is genuinely not a good match

Rules:
- Be honest. Do not hallucinate fit where there is none.
- Focus on concrete intent alignment, not vague similarities.
- If the evaluator pre-screen score was low, acknowledge weaknesses.
- Your fitScore should reflect YOUR honest assessment, not just echo the seed score.
- suggestedRoles: "agent" = can help, "patient" = seeks help, "peer" = mutual benefit.`;

export interface NegotiationProposerInput {
  ownUser: UserNegotiationContext;
  otherUser: UserNegotiationContext;
  indexContext: { indexId: string; prompt: string };
  seedAssessment: SeedAssessment;
  history: NegotiationTurn[];
}

/**
 * Negotiation agent that argues for the match.
 * @remarks Uses structured output to produce a NegotiationTurn.
 */
export class NegotiationProposer {
  private model;

  constructor() {
    this.model = createModel("negotiationProposer").withStructuredOutput(
      NegotiationTurnSchema,
      { name: "negotiation_proposer" },
    );
  }

  /**
   * Generate a proposal or counter-proposal turn.
   * @param input - User contexts, seed assessment, and negotiation history
   * @returns A structured NegotiationTurn
   */
  async invoke(input: NegotiationProposerInput): Promise<NegotiationTurn> {
    const historyText = input.history.length > 0
      ? `\n\nNegotiation history:\n${input.history.map((t, i) => `Turn ${i + 1}: ${t.action} — fitScore: ${t.assessment.fitScore}, reasoning: ${t.assessment.reasoning}`).join("\n")}`
      : "";

    const userMessage = `YOUR USER:
Name: ${input.ownUser.profile.name ?? "Unknown"}
Bio: ${input.ownUser.profile.bio ?? "N/A"}
Skills: ${input.ownUser.profile.skills?.join(", ") ?? "N/A"}
Intents: ${input.ownUser.intents.map((i) => `- ${i.title}: ${i.description} (confidence: ${i.confidence})`).join("\n")}

OTHER USER:
Name: ${input.otherUser.profile.name ?? "Unknown"}
Bio: ${input.otherUser.profile.bio ?? "N/A"}
Skills: ${input.otherUser.profile.skills?.join(", ") ?? "N/A"}
Intents: ${input.otherUser.intents.map((i) => `- ${i.title}: ${i.description} (confidence: ${i.confidence})`).join("\n")}

INDEX CONTEXT: ${input.indexContext.prompt || "General discovery"}

EVALUATOR PRE-SCREEN: Score ${input.seedAssessment.score}/100 — ${input.seedAssessment.reasoning}
Suggested role: ${input.seedAssessment.valencyRole}${historyText}

${input.history.length === 0 ? "This is the opening turn. Propose the match." : "The other agent countered. Respond to their objections."}`;

    const result = await this.model.invoke([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);

    return result;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd protocol && bun test tests/negotiation.agents.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/protocol/agents/negotiation.proposer.ts protocol/tests/negotiation.agents.spec.ts
git commit -m "feat(negotiation): add proposer agent with LLM test"
```

---

## Task 4: Negotiation Responder Agent

**Files:**
- Create: `protocol/src/lib/protocol/agents/negotiation.responder.ts`
- Modify: `protocol/tests/negotiation.agents.spec.ts`

- [ ] **Step 1: Add the failing test for the responder**

Append to `protocol/tests/negotiation.agents.spec.ts`:

```typescript
import { NegotiationResponder } from "../src/lib/protocol/agents/negotiation.responder";

describe("NegotiationResponder", () => {
  it("evaluates a proposal and responds with accept, reject, or counter", async () => {
    const responder = new NegotiationResponder();

    const proposal: NegotiationTurn = {
      action: "propose",
      assessment: {
        fitScore: 78,
        reasoning: "Strong complementary skills — Alice needs ML, Bob needs product leadership",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      },
    };

    const result = await responder.invoke({
      ownUser: candidateUser,
      otherUser: sourceUser,
      indexContext: { indexId: "idx-1", prompt: "AI startup co-founders" },
      seedAssessment,
      history: [proposal],
    });

    expect(["accept", "reject", "counter"]).toContain(result.action);
    expect(result.assessment.fitScore).toBeGreaterThanOrEqual(0);
    expect(result.assessment.fitScore).toBeLessThanOrEqual(100);
    expect(result.assessment.reasoning).toBeTruthy();
  }, 30_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd protocol && bun test tests/negotiation.agents.spec.ts`
Expected: FAIL — cannot find module `negotiation.responder`

- [ ] **Step 3: Implement the responder agent**

```typescript
// protocol/src/lib/protocol/agents/negotiation.responder.ts
import { createModel } from "./model.config";
import { NegotiationTurnSchema, type NegotiationTurn, type UserNegotiationContext, type SeedAssessment } from "../states/negotiation.state";

const SYSTEM_PROMPT = `You are a negotiation agent representing your user in an opportunity matching system.
Your role is to EVALUATE proposals and PROTECT your user from poor matches.

You will receive:
- Your user's profile, intents, and context
- The other user's profile, intents, and context
- The proposal or counter-proposal from the other agent
- Full negotiation history

Your job:
1. Critically evaluate whether this match genuinely serves YOUR user's intents.
2. Respond with one of:
   - "accept" — the match is genuinely valuable for your user. Both sides benefit.
   - "reject" — the match does not serve your user's needs. Explain clearly why.
   - "counter" — partially convinced but have specific objections. State what's missing or weak.

Rules:
- Be skeptical. Your job is to protect your user from noise.
- Don't accept just because the other agent is enthusiastic.
- Look for concrete intent alignment, not vague overlap.
- If the other agent addressed your previous objections well, acknowledge it.
- If their counter didn't address your concerns, reject.
- Your fitScore should reflect YOUR independent assessment.
- suggestedRoles: "agent" = can help, "patient" = seeks help, "peer" = mutual benefit.`;

export interface NegotiationResponderInput {
  ownUser: UserNegotiationContext;
  otherUser: UserNegotiationContext;
  indexContext: { indexId: string; prompt: string };
  seedAssessment: SeedAssessment;
  history: NegotiationTurn[];
}

/**
 * Negotiation agent that evaluates proposals against its user's interests.
 * @remarks Uses structured output to produce a NegotiationTurn.
 */
export class NegotiationResponder {
  private model;

  constructor() {
    this.model = createModel("negotiationResponder").withStructuredOutput(
      NegotiationTurnSchema,
      { name: "negotiation_responder" },
    );
  }

  /**
   * Evaluate a proposal/counter and respond.
   * @param input - User contexts, seed assessment, and negotiation history
   * @returns A structured NegotiationTurn (accept/reject/counter)
   */
  async invoke(input: NegotiationResponderInput): Promise<NegotiationTurn> {
    const historyText = input.history
      .map((t, i) => `Turn ${i + 1}: ${t.action} — fitScore: ${t.assessment.fitScore}, reasoning: ${t.assessment.reasoning}`)
      .join("\n");

    const userMessage = `YOUR USER:
Name: ${input.ownUser.profile.name ?? "Unknown"}
Bio: ${input.ownUser.profile.bio ?? "N/A"}
Skills: ${input.ownUser.profile.skills?.join(", ") ?? "N/A"}
Intents: ${input.ownUser.intents.map((i) => `- ${i.title}: ${i.description} (confidence: ${i.confidence})`).join("\n")}

OTHER USER (proposing the match):
Name: ${input.otherUser.profile.name ?? "Unknown"}
Bio: ${input.otherUser.profile.bio ?? "N/A"}
Skills: ${input.otherUser.profile.skills?.join(", ") ?? "N/A"}
Intents: ${input.otherUser.intents.map((i) => `- ${i.title}: ${i.description} (confidence: ${i.confidence})`).join("\n")}

INDEX CONTEXT: ${input.indexContext.prompt || "General discovery"}

EVALUATOR PRE-SCREEN: Score ${input.seedAssessment.score}/100 — ${input.seedAssessment.reasoning}

NEGOTIATION HISTORY:
${historyText}

Evaluate the latest proposal/counter from the other agent. Does this match genuinely serve your user?`;

    const result = await this.model.invoke([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);

    return result;
  }
}
```

- [ ] **Step 4: Run all agent tests to verify they pass**

Run: `cd protocol && bun test tests/negotiation.agents.spec.ts`
Expected: PASS (both proposer and responder tests)

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/protocol/agents/negotiation.responder.ts protocol/tests/negotiation.agents.spec.ts
git commit -m "feat(negotiation): add responder agent with LLM test"
```

---

## Task 5: Negotiation Graph

**Files:**
- Create: `protocol/src/lib/protocol/graphs/negotiation.graph.ts`
- Test: `protocol/tests/negotiation.graph.spec.ts`

- [ ] **Step 1: Write the failing test for graph routing**

```typescript
// protocol/tests/negotiation.graph.spec.ts
import { config } from "dotenv";
config({ path: ".env.development" });

import { describe, it, expect, mock } from "bun:test";
import { NegotiationGraphFactory } from "../src/lib/protocol/graphs/negotiation.graph";
import type { UserNegotiationContext, SeedAssessment } from "../src/lib/protocol/states/negotiation.state";

const sourceUser: UserNegotiationContext = {
  id: "user-source",
  intents: [{ id: "i1", title: "Looking for ML engineer", description: "Need ML expertise", confidence: 0.9 }],
  profile: { name: "Alice", bio: "PM at startup", skills: ["product"] },
  hydeDocuments: [],
};

const candidateUser: UserNegotiationContext = {
  id: "user-candidate",
  intents: [{ id: "i2", title: "Seeking PM", description: "ML eng seeking product co-founder", confidence: 0.85 }],
  profile: { name: "Bob", bio: "ML engineer", skills: ["ML"] },
  hydeDocuments: [],
};

const seed: SeedAssessment = { score: 78, reasoning: "Complementary skills", valencyRole: "Peer" };

function createMockDeps(proposerAction = "propose", responderAction = "accept") {
  let callCount = 0;
  return {
    conversationService: {
      createConversation: mock(() => Promise.resolve({ id: "conv-1" })),
      sendMessage: mock(() => Promise.resolve({ id: "msg-1", senderId: "agent", role: "agent", parts: [], createdAt: new Date() })),
    },
    taskService: {
      createTask: mock(() => Promise.resolve({ id: "task-1", conversationId: "conv-1", state: "submitted" })),
      updateState: mock(() => Promise.resolve({})),
      createArtifact: mock(() => Promise.resolve({ id: "art-1" })),
    },
    proposer: {
      invoke: mock(() => {
        callCount++;
        return Promise.resolve({
          action: proposerAction,
          assessment: { fitScore: 80, reasoning: "Good match", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
        });
      }),
    },
    responder: {
      invoke: mock(() => {
        return Promise.resolve({
          action: responderAction,
          assessment: { fitScore: 75, reasoning: "Agreed, good fit", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
        });
      }),
    },
  };
}

describe("NegotiationGraph", () => {
  it("reaches consensus when responder accepts", async () => {
    const deps = createMockDeps("propose", "accept");
    const factory = new NegotiationGraphFactory(
      deps.conversationService as any,
      deps.taskService as any,
      deps.proposer as any,
      deps.responder as any,
    );
    const graph = factory.createGraph();
    const result = await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext: { indexId: "idx-1", prompt: "AI co-founders" },
      seedAssessment: seed,
    });

    expect(result.outcome).not.toBeNull();
    expect(result.outcome!.consensus).toBe(true);
    expect(result.outcome!.turnCount).toBe(2);
    expect(deps.taskService.createArtifact).toHaveBeenCalled();
  }, 30_000);

  it("rejects when responder rejects", async () => {
    const deps = createMockDeps("propose", "reject");
    const factory = new NegotiationGraphFactory(
      deps.conversationService as any,
      deps.taskService as any,
      deps.proposer as any,
      deps.responder as any,
    );
    const graph = factory.createGraph();
    const result = await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext: { indexId: "idx-1", prompt: "AI co-founders" },
      seedAssessment: seed,
    });

    expect(result.outcome).not.toBeNull();
    expect(result.outcome!.consensus).toBe(false);
  }, 30_000);

  it("rejects when turn cap is exceeded", async () => {
    const deps = createMockDeps("counter", "counter");
    const factory = new NegotiationGraphFactory(
      deps.conversationService as any,
      deps.taskService as any,
      deps.proposer as any,
      deps.responder as any,
    );
    const graph = factory.createGraph();
    const result = await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext: { indexId: "idx-1", prompt: "AI co-founders" },
      seedAssessment: seed,
      maxTurns: 4,
    });

    expect(result.outcome).not.toBeNull();
    expect(result.outcome!.consensus).toBe(false);
    expect(result.outcome!.reason).toBe("turn_cap");
    expect(result.turnCount).toBeLessThanOrEqual(4);
  }, 30_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd protocol && bun test tests/negotiation.graph.spec.ts`
Expected: FAIL — cannot find module `negotiation.graph`

- [ ] **Step 3: Implement the negotiation graph**

```typescript
// protocol/src/lib/protocol/graphs/negotiation.graph.ts
import { StateGraph, END } from "@langchain/langgraph";

import { NegotiationGraphState, type NegotiationTurn, type NegotiationOutcome } from "../states/negotiation.state";
import type { NegotiationProposer } from "../agents/negotiation.proposer";
import type { NegotiationResponder } from "../agents/negotiation.responder";

interface ConversationServiceLike {
  createConversation(participants: { participantId: string; participantType: "user" | "agent" }[]): Promise<{ id: string }>;
  sendMessage(
    conversationId: string,
    senderId: string,
    role: "user" | "agent",
    parts: unknown[],
    opts?: { taskId?: string; metadata?: Record<string, unknown> },
  ): Promise<{ id: string; senderId: string; role: string; parts: unknown[]; createdAt: Date }>;
}

interface TaskServiceLike {
  createTask(conversationId: string, metadata?: Record<string, unknown>): Promise<{ id: string; conversationId: string; state: string }>;
  updateState(taskId: string, state: string, statusMessage?: unknown): Promise<unknown>;
  createArtifact(taskId: string, data: { name?: string; parts: unknown[]; metadata?: Record<string, unknown> }): Promise<{ id: string }>;
}

interface ProposerLike {
  invoke(input: {
    ownUser: typeof NegotiationGraphState.State.sourceUser;
    otherUser: typeof NegotiationGraphState.State.candidateUser;
    indexContext: typeof NegotiationGraphState.State.indexContext;
    seedAssessment: typeof NegotiationGraphState.State.seedAssessment;
    history: NegotiationTurn[];
  }): Promise<NegotiationTurn>;
}

interface ResponderLike {
  invoke(input: {
    ownUser: typeof NegotiationGraphState.State.candidateUser;
    otherUser: typeof NegotiationGraphState.State.sourceUser;
    indexContext: typeof NegotiationGraphState.State.indexContext;
    seedAssessment: typeof NegotiationGraphState.State.seedAssessment;
    history: NegotiationTurn[];
  }): Promise<NegotiationTurn>;
}

/**
 * Factory for the bilateral negotiation LangGraph state machine.
 * @remarks Accepts dependencies via constructor for testability.
 */
export class NegotiationGraphFactory {
  constructor(
    private conversationService: ConversationServiceLike,
    private taskService: TaskServiceLike,
    private proposer: ProposerLike,
    private responder: ResponderLike,
  ) {}

  createGraph() {
    const { conversationService, taskService, proposer, responder } = this;

    const initNode = async (state: typeof NegotiationGraphState.State) => {
      try {
        const conversation = await conversationService.createConversation([
          { participantId: `agent:${state.sourceUser.id}`, participantType: "agent" },
          { participantId: `agent:${state.candidateUser.id}`, participantType: "agent" },
        ]);

        const task = await taskService.createTask(conversation.id, {
          type: "negotiation",
          sourceUserId: state.sourceUser.id,
          candidateUserId: state.candidateUser.id,
        });

        return {
          conversationId: conversation.id,
          taskId: task.id,
          currentSpeaker: "source" as const,
          turnCount: 0,
        };
      } catch (err) {
        return { error: `Init failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    };

    const turnNode = async (state: typeof NegotiationGraphState.State) => {
      try {
        const history: NegotiationTurn[] = state.messages.map((m) => {
          const dataPart = (m.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === "data");
          return dataPart?.data as NegotiationTurn;
        }).filter(Boolean);

        const isSource = state.currentSpeaker === "source";
        const agent = isSource ? proposer : responder;
        const ownUser = isSource ? state.sourceUser : state.candidateUser;
        const otherUser = isSource ? state.candidateUser : state.sourceUser;
        const senderId = `agent:${ownUser.id}`;

        const turn = await agent.invoke({
          ownUser,
          otherUser,
          indexContext: state.indexContext,
          seedAssessment: state.seedAssessment,
          history,
        });

        // First turn must be "propose"
        if (state.turnCount === 0 && turn.action !== "propose") {
          turn.action = "propose";
        }

        const parts = [{ kind: "data" as const, data: turn }];
        const message = await conversationService.sendMessage(
          state.conversationId,
          senderId,
          "agent",
          parts,
          { taskId: state.taskId },
        );

        const taskState = state.turnCount === 0 ? "working" : "input_required";
        await taskService.updateState(state.taskId, taskState);

        return {
          messages: [{
            id: message.id,
            senderId: message.senderId,
            role: "agent" as const,
            parts: message.parts,
            createdAt: message.createdAt,
          }],
          turnCount: state.turnCount + 1,
          currentSpeaker: (isSource ? "candidate" : "source") as "source" | "candidate",
          lastTurn: turn,
        };
      } catch (err) {
        return {
          lastTurn: {
            action: "reject" as const,
            assessment: { fitScore: 0, reasoning: `Agent error: ${err instanceof Error ? err.message : String(err)}`, suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
          },
          turnCount: state.turnCount + 1,
          error: `Turn failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    };

    const evaluateNode = (state: typeof NegotiationGraphState.State): string => {
      if (state.error) return "finalize";
      if (!state.lastTurn) return "finalize";
      if (state.lastTurn.action === "accept") return "finalize";
      if (state.lastTurn.action === "reject") return "finalize";
      if (state.turnCount >= state.maxTurns) return "finalize";
      return "turn";
    };

    const finalizeNode = async (state: typeof NegotiationGraphState.State) => {
      const history: NegotiationTurn[] = state.messages.map((m) => {
        const dataPart = (m.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === "data");
        return dataPart?.data as NegotiationTurn;
      }).filter(Boolean);

      const lastTurn = state.lastTurn;
      const consensus = lastTurn?.action === "accept";
      const atCap = state.turnCount >= state.maxTurns && lastTurn?.action === "counter";

      // Average fit scores from both sides for final score
      const scores = history.map((t) => t.assessment.fitScore);
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

      // Derive agreed roles from the last two turns (if consensus)
      let agreedRoles: Array<{ userId: string; role: string }> = [];
      if (consensus && history.length >= 2) {
        const lastTwo = history.slice(-2);
        agreedRoles = [
          { userId: state.sourceUser.id, role: lastTwo[0].assessment.suggestedRoles.ownUser },
          { userId: state.candidateUser.id, role: lastTwo[1].assessment.suggestedRoles.ownUser },
        ];
      }

      const outcome: NegotiationOutcome = {
        consensus,
        finalScore: consensus ? avgScore : 0,
        agreedRoles,
        reasoning: history.map((t) => t.assessment.reasoning).join(" | "),
        turnCount: state.turnCount,
        ...(atCap && { reason: "turn_cap" }),
      };

      try {
        await taskService.updateState(state.taskId, "completed");
        await taskService.createArtifact(state.taskId, {
          name: "negotiation-outcome",
          parts: [{ kind: "data", data: outcome }],
          metadata: { consensus, turnCount: state.turnCount },
        });
      } catch (err) {
        // DB failure is non-blocking — outcome is still returned via state
      }

      return { outcome };
    };

    const workflow = new StateGraph(NegotiationGraphState)
      .addNode("init", initNode)
      .addNode("turn", turnNode)
      .addNode("finalize", finalizeNode)
      .addConditionalEdges("turn", evaluateNode, {
        turn: "turn",
        finalize: "finalize",
      })
      .addEdge("__start__", "init")
      .addEdge("init", "turn")
      .addEdge("finalize", "__end__");

    return workflow.compile();
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd protocol && bun test tests/negotiation.graph.spec.ts`
Expected: PASS (all 3 tests: consensus, rejection, turn cap)

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/protocol/graphs/negotiation.graph.ts protocol/tests/negotiation.graph.spec.ts
git commit -m "feat(negotiation): add negotiation graph with routing tests"
```

---

## Task 6: Integrate negotiateNode into Opportunity Graph

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts`
- Test: `protocol/tests/opportunity.negotiation.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
// protocol/tests/opportunity.negotiation.spec.ts
import { config } from "dotenv";
config({ path: ".env.development" });

import { describe, it, expect, mock } from "bun:test";

describe("Opportunity Graph — Negotiation Integration", () => {
  it("negotiateNode filters candidates by negotiation consensus", async () => {
    // This test verifies the wiring: candidates that fail negotiation are dropped
    // We test the negotiateNode function in isolation by extracting it

    // Mock negotiation graph that accepts first candidate, rejects second
    const mockNegotiationGraph = {
      invoke: mock((input: any) => {
        const isFirstCandidate = input.candidateUser.id === "candidate-1";
        return Promise.resolve({
          outcome: {
            consensus: isFirstCandidate,
            finalScore: isFirstCandidate ? 82 : 0,
            agreedRoles: isFirstCandidate
              ? [{ userId: "source", role: "peer" }, { userId: "candidate-1", role: "peer" }]
              : [],
            reasoning: isFirstCandidate ? "Good match" : "No fit",
            turnCount: 2,
          },
        });
      }),
    };

    // Import the negotiate helper after mocking
    const { negotiateCandidates } = await import("../src/lib/protocol/graphs/negotiation.graph");

    const candidates = [
      { userId: "candidate-1", score: 78, reasoning: "OK", valencyRole: "Peer" },
      { userId: "candidate-2", score: 72, reasoning: "Weak", valencyRole: "Agent" },
    ];

    const sourceUser = {
      id: "source",
      intents: [{ id: "i1", title: "Test", description: "Test intent", confidence: 0.9 }],
      profile: { name: "Alice" },
      hydeDocuments: [],
    };

    const results = await negotiateCandidates(
      mockNegotiationGraph as any,
      sourceUser,
      candidates.map((c) => ({
        ...c,
        candidateUser: {
          id: c.userId,
          intents: [{ id: "i2", title: "Test", description: "Counter intent", confidence: 0.8 }],
          profile: { name: c.userId },
          hydeDocuments: [],
        },
      })),
      { indexId: "idx-1", prompt: "Test" },
    );

    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe("candidate-1");
    expect(results[0].negotiationScore).toBe(82);
  }, 30_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd protocol && bun test tests/opportunity.negotiation.spec.ts`
Expected: FAIL — `negotiateCandidates` not found

- [ ] **Step 3: Add the `negotiateCandidates` helper to negotiation.graph.ts**

Append to `protocol/src/lib/protocol/graphs/negotiation.graph.ts`:

```typescript
import type { UserNegotiationContext, SeedAssessment } from "../states/negotiation.state";

interface NegotiationCandidate {
  userId: string;
  score: number;
  reasoning: string;
  valencyRole: string;
  candidateUser: UserNegotiationContext;
}

interface NegotiationResult {
  userId: string;
  negotiationScore: number;
  agreedRoles: Array<{ userId: string; role: string }>;
  reasoning: string;
  turnCount: number;
}

/**
 * Runs bilateral negotiation for each candidate in parallel.
 * Returns only candidates that achieved consensus.
 */
export async function negotiateCandidates(
  negotiationGraph: { invoke: (input: any) => Promise<{ outcome: any }> },
  sourceUser: UserNegotiationContext,
  candidates: NegotiationCandidate[],
  indexContext: { indexId: string; prompt: string },
  maxTurns?: number,
): Promise<NegotiationResult[]> {
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const result = await negotiationGraph.invoke({
          sourceUser,
          candidateUser: candidate.candidateUser,
          indexContext,
          seedAssessment: {
            score: candidate.score,
            reasoning: candidate.reasoning,
            valencyRole: candidate.valencyRole,
          },
          ...(maxTurns !== undefined && { maxTurns }),
        });

        if (result.outcome?.consensus) {
          return {
            userId: candidate.userId,
            negotiationScore: result.outcome.finalScore,
            agreedRoles: result.outcome.agreedRoles,
            reasoning: result.outcome.reasoning,
            turnCount: result.outcome.turnCount,
          };
        }
        return null;
      } catch {
        return null; // Negotiation failure = no consensus
      }
    }),
  );

  return results.filter((r): r is NegotiationResult => r !== null);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd protocol && bun test tests/opportunity.negotiation.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/protocol/graphs/negotiation.graph.ts protocol/tests/opportunity.negotiation.spec.ts
git commit -m "feat(negotiation): add negotiateCandidates helper with integration test"
```

---

## Task 7: Wire negotiateNode into Opportunity Graph

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts`

This task modifies the opportunity graph to insert negotiation between evaluation and ranking. This is the most delicate change — it rewires existing graph edges.

- [ ] **Step 1: Read the current opportunity graph to locate exact insertion points**

Read `protocol/src/lib/protocol/graphs/opportunity.graph.ts` and identify:
- The `OpportunityGraphFactory` constructor (to add negotiation graph dependency)
- The `evaluationNode` output shape (what candidates look like post-evaluation)
- The `.addEdge('evaluation', 'ranking')` line (to replace with conditional routing)
- The `routeByMode` and `shouldContinueAfterPrep` functions (to understand skip logic)

- [ ] **Step 2: Add negotiation graph as a dependency to OpportunityGraphFactory**

In the constructor, add a new optional parameter:

```typescript
private negotiationGraph?: { invoke: (input: any) => Promise<{ outcome: any }> },
```

- [ ] **Step 3: Add the negotiateNode**

Add after the evaluationNode definition. The node:
1. Checks if negotiation should be skipped (continue_discovery, introduction mode, or no negotiation graph)
2. Builds `UserNegotiationContext` for source and each candidate from existing state
3. Calls `negotiateCandidates()` in parallel
4. Replaces the candidates list with only consensus results
5. Emits trace events

```typescript
// NOTE: The opportunity graph uses `evaluatedOpportunities` (multi-actor, from entity-bundle
// evaluator), NOT the legacy `evaluatedCandidates`. Each EvaluatedOpportunity has:
//   { actors: [{ userId, role, intentId, indexId }], score, reasoning }
// The source user's profile is in `state.sourceProfile` which has nested structure:
//   { identity?: { name?, bio?, location? }, attributes?: { skills?, interests? } }
// Chat path detection uses `state.options?.conversationId` (not chatSessionId).

const negotiateNode = async (state: typeof OpportunityGraphState.State) => {
  if (!this.negotiationGraph) {
    return {}; // Pass through — no negotiation configured
  }

  const traceEmitter = requestContext.getStore()?.traceEmitter;
  const graphStart = Date.now();
  traceEmitter?.({ type: "graph_start", name: "negotiation" });

  try {
    // Build source user context from state
    const sourceUser = {
      id: state.userId as string,
      intents: state.indexedIntents?.map(i => ({
        id: i.intentId as string,
        title: i.summary ?? '',
        description: i.payload ?? '',
        confidence: 1, // IndexedIntent has no confidence; use default
      })) ?? [],
      profile: {
        name: state.sourceProfile?.identity?.name,
        bio: state.sourceProfile?.identity?.bio,
        location: state.sourceProfile?.identity?.location,
        skills: state.sourceProfile?.attributes?.skills,
        interests: state.sourceProfile?.attributes?.interests,
      },
      hydeDocuments: [] as string[],
    };

    // Build candidate contexts from evaluatedOpportunities (multi-actor shape)
    // For each opportunity, find the non-source actor(s) as the candidate
    const negotiationCandidates = state.evaluatedOpportunities.map(opp => {
      const candidateActor = opp.actors.find(a => a.userId !== state.userId);
      if (!candidateActor) return null;

      return {
        userId: candidateActor.userId as string,
        score: opp.score,
        reasoning: opp.reasoning,
        valencyRole: candidateActor.role ?? 'peer',
        candidateUser: {
          id: candidateActor.userId as string,
          // NOTE: Candidate profile/intents need to be loaded from DB.
          // The evaluatedOpportunities don't carry full profiles — the implementer
          // must add a DB lookup here (similar to how opportunity.discover.ts
          // fetches profiles for enrichment). For now, use what's available in state.
          intents: candidateActor.intentId
            ? [{ id: candidateActor.intentId as string, title: '', description: '', confidence: 1 }]
            : [],
          profile: { name: '' },
          hydeDocuments: [] as string[],
        },
      };
    }).filter(Boolean);

    // Chat path uses reduced turn cap for latency; detected via options.conversationId
    const isChatPath = !!state.options?.conversationId;
    const maxTurns = isChatPath ? 4 : 6;

    const consensusResults = await negotiateCandidates(
      this.negotiationGraph, sourceUser, negotiationCandidates as any[],
      { indexId: state.indexId as string ?? '', prompt: '' },
      maxTurns,
    );

    // Filter evaluatedOpportunities to only those with consensus
    const consensusUserIds = new Set(consensusResults.map(r => r.userId));
    const filtered = state.evaluatedOpportunities.filter(opp => {
      const candidateActor = opp.actors.find(a => a.userId !== state.userId);
      return candidateActor && consensusUserIds.has(candidateActor.userId as string);
    });

    // Update scores with negotiation scores
    for (const opp of filtered) {
      const candidateActor = opp.actors.find(a => a.userId !== state.userId);
      if (!candidateActor) continue;
      const negResult = consensusResults.find(r => r.userId === (candidateActor.userId as string));
      if (negResult) {
        opp.score = negResult.negotiationScore;
      }
    }

    traceEmitter?.({ type: "graph_end", name: "negotiation", durationMs: Date.now() - graphStart });
    return { evaluatedOpportunities: filtered };
  } catch (err) {
    traceEmitter?.({ type: "graph_end", name: "negotiation", durationMs: Date.now() - graphStart });
    return {}; // On error, pass through without filtering
  }
};
```

- [ ] **Step 4: Register the node and rewire edges**

Replace the direct `evaluation → ranking` edge:

```typescript
// Before:
.addEdge('evaluation', 'ranking')

// After:
.addNode('negotiate', negotiateNode)
.addConditionalEdges('evaluation', (state) => {
  // Skip negotiation for continue_discovery (paginated cached candidates)
  // Note: create_introduction never reaches evaluation node (separate path)
  if (state.operationMode === 'continue_discovery') return 'ranking';
  if (!this.negotiationGraph) return 'ranking';
  return 'negotiate';
}, {
  negotiate: 'negotiate',
  ranking: 'ranking',
})
.addEdge('negotiate', 'ranking')
```

- [ ] **Step 5: Verify the opportunity graph still compiles**

Run: `cd protocol && npx tsc --noEmit src/lib/protocol/graphs/opportunity.graph.ts`
Expected: No errors

- [ ] **Step 6: Run existing opportunity graph tests to verify no regression**

Run: `cd protocol && bun test tests/maintenance-graph.spec.ts`
Expected: PASS (existing tests unaffected since negotiation graph is optional)

- [ ] **Step 7: Commit**

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "feat(negotiation): wire negotiateNode into opportunity graph pipeline"
```

---

## Task 8: End-to-End Smoke Test

**Files:**
- Create: `protocol/tests/negotiation.e2e.spec.ts`

- [ ] **Step 1: Write the E2E test with real LLM calls**

```typescript
// protocol/tests/negotiation.e2e.spec.ts
import { config } from "dotenv";
config({ path: ".env.development" });

import { describe, it, expect } from "bun:test";
import { NegotiationGraphFactory } from "../src/lib/protocol/graphs/negotiation.graph";
import { NegotiationProposer } from "../src/lib/protocol/agents/negotiation.proposer";
import { NegotiationResponder } from "../src/lib/protocol/agents/negotiation.responder";
import { ConversationService } from "../src/services/conversation.service";
import { TaskService } from "../src/services/task.service";

// Prerequisites: requires DATABASE_URL and OPENROUTER_API_KEY in .env.development
// Run with: cd protocol && bun test tests/negotiation.e2e.spec.ts

describe("Negotiation E2E", () => {
  it("runs a full negotiation with real agents and A2A persistence", async () => {
    const conversationService = new ConversationService();
    const taskService = new TaskService();
    const proposer = new NegotiationProposer();
    const responder = new NegotiationResponder();

    const factory = new NegotiationGraphFactory(
      conversationService,
      taskService,
      proposer,
      responder,
    );
    const graph = factory.createGraph();

    const result = await graph.invoke({
      sourceUser: {
        id: "e2e-source",
        intents: [{ id: "i1", title: "Looking for ML engineer", description: "Need ML expertise for recommendation system", confidence: 0.9 }],
        profile: { name: "Alice", bio: "Product manager building AI startup", skills: ["product management", "AI strategy"] },
        hydeDocuments: [],
      },
      candidateUser: {
        id: "e2e-candidate",
        intents: [{ id: "i2", title: "Seeking PM co-founder", description: "ML engineer looking for product-minded co-founder", confidence: 0.85 }],
        profile: { name: "Bob", bio: "Senior ML engineer with 8 years experience", skills: ["machine learning", "PyTorch"] },
        hydeDocuments: [],
      },
      indexContext: { indexId: "e2e-index", prompt: "AI startup co-founders" },
      seedAssessment: { score: 78, reasoning: "Complementary skills", valencyRole: "Peer" },
      maxTurns: 4,
    });

    // Verify outcome exists
    expect(result.outcome).not.toBeNull();
    expect(typeof result.outcome!.consensus).toBe("boolean");
    expect(result.outcome!.turnCount).toBeGreaterThanOrEqual(2);
    expect(result.outcome!.turnCount).toBeLessThanOrEqual(4);
    expect(result.outcome!.reasoning).toBeTruthy();

    // Verify A2A records were created
    expect(result.conversationId).toBeTruthy();
    expect(result.taskId).toBeTruthy();
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  }, 120_000); // 2 minute timeout for multiple LLM calls
});
```

- [ ] **Step 2: Run the E2E test**

Run: `cd protocol && bun test tests/negotiation.e2e.spec.ts`
Expected: PASS (requires database and OpenRouter API key)

- [ ] **Step 3: Commit**

```bash
git add protocol/tests/negotiation.e2e.spec.ts
git commit -m "test(negotiation): add E2E smoke test with real LLM calls"
```

---

## Summary

| Task | What | Files | Depends On |
|------|------|-------|------------|
| 1 | State & Zod schemas | `negotiation.state.ts` | — |
| 2 | Model config entries | `model.config.ts` | — |
| 3 | Proposer agent | `negotiation.proposer.ts`, tests | 1, 2 |
| 4 | Responder agent | `negotiation.responder.ts`, tests | 1, 2 |
| 5 | Negotiation graph | `negotiation.graph.ts`, tests | 1, 3, 4 |
| 6 | negotiateCandidates helper | `negotiation.graph.ts`, tests | 5 |
| 7 | Wire into opportunity graph | `opportunity.graph.ts` | 5, 6 |
| 8 | E2E smoke test | `negotiation.e2e.spec.ts` | 5, 7 |
