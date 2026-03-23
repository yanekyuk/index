/**
 * Test: evaluator behavior for direct-connection candidates.
 *
 * Validates that the OpportunityEvaluator produces a meaningful opportunity
 * when given candidates shaped like the direct-connection fast path
 * (explicit_mention lens, ragScore=100). The graph-level direct-connection
 * logic (bypassing vector search) is tested in opportunity.graph.spec.ts.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { assertMatchesSchema, assertLLMEvaluate } from "../../../test-harness";
import {
  OpportunityEvaluator,
  type EvaluatorInput,
  type EvaluatorEntity,
} from "../../agents/opportunity.evaluator";

const DISCOVERER_ID = 'user-yanki';
const TARGET_ID = 'user-sam';

const sourceEntity: EvaluatorEntity = {
  userId: DISCOVERER_ID,
  profile: {
    name: 'Yankı Ekin Yüksel',
    bio: 'CTO at a digital media startup. Background in linguistics and software development. Built content distribution platforms and game development projects.',
    location: 'Istanbul, Turkey',
    interests: ['computational linguistics', 'game development', 'sound design', 'AI', 'machine learning', 'backend development'],
    skills: ['Laravel', 'Vue.js', 'Node.js', 'PostgreSQL', 'TypeScript', 'software engineering', 'project management'],
    context: 'Exploring the intersection of linguistics and sound design in game development. Looking for investors for a game project using Unreal Engine.',
  },
  intents: [
    { intentId: 'i-yanki-1', payload: 'Explore the intersection of linguistics and sound design in game development' },
    { intentId: 'i-yanki-2', payload: 'Find investors for a game project using Unreal Engine and TypeScript' },
  ],
  indexId: 'idx-shared',
};

const targetEntity: EvaluatorEntity = {
  userId: TARGET_ID,
  profile: {
    name: 'Samuel Rivera',
    bio: 'Seasoned full-stack developer based in Madrid. Builds efficient web solutions using Laravel and Vue. Active member of the gaming community.',
    location: 'Madrid, Spain',
    interests: ['web development', 'gaming', 'Laravel ecosystem', 'Vue.js', 'esports', 'game dev'],
    skills: ['Laravel', 'Vue.js', 'PHP', 'JavaScript', 'MySQL', 'full-stack development', 'API design'],
    context: 'Looking for a technical co-founder to build an AI/LLM-based developer tool. Seeking someone with ML, data engineering, and product experience.',
  },
  intents: [
    { intentId: 'i-sam-1', payload: 'Find a co-founder with ML/data engineering background to build LLM-based developer tools' },
    { intentId: 'i-sam-2', payload: 'Connect with Laravel and Vue developers interested in gaming projects' },
  ],
  indexId: 'idx-shared',
  ragScore: 100, // Explicit mention = perfect match
  matchedVia: 'explicit_mention',
};

const resultSchema = z.object({
  opportunities: z.array(z.object({
    reasoning: z.string(),
    score: z.number(),
    candidateUserId: z.string().min(1),
  })),
  durationMs: z.number(),
});

async function runDirectConnectionEval(): Promise<{ opportunities: Array<{ reasoning: string; score: number; candidateUserId: string }>; durationMs: number }> {
  const evaluator = new OpportunityEvaluator();
  const input: EvaluatorInput = {
    discovererId: DISCOVERER_ID,
    entities: [sourceEntity, targetEntity],
    discoveryQuery: 'What can I do with Samuel Rivera?',
  };
  // Retry up to 3 times — LLM non-determinism can yield empty results on some runs
  const MAX_ATTEMPTS = 3;
  let totalDurationMs = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const start = Date.now();
    const raw = await evaluator.invokeEntityBundle(input, { minScore: 0, returnAll: true });
    const durationMs = Date.now() - start;
    totalDurationMs += durationMs;
    const opportunities = raw
      .map(op => {
        const candidate = op.actors.find(a => a.userId !== DISCOVERER_ID);
        if (!candidate?.userId) return null;
        return { reasoning: op.reasoning, score: op.score, candidateUserId: candidate.userId };
      })
      .filter((op): op is { reasoning: string; score: number; candidateUserId: string } => op !== null);
    if (opportunities.length > 0 || attempt === MAX_ATTEMPTS) {
      return { opportunities, durationMs: totalDurationMs };
    }
    console.log(`  [Attempt ${attempt}/${MAX_ATTEMPTS}] Empty result, retrying...`);
  }
  return { opportunities: [], durationMs: totalDurationMs };
}

describe("OpportunityEvaluator: direct-connection candidates", () => {
  it("produces an opportunity when evaluating explicitly-mentioned users with genuine alignment", async () => {
    const { opportunities, durationMs } = await runDirectConnectionEval();

    // Deterministic: schema
    assertMatchesSchema({ opportunities, durationMs }, resultSchema);

    // Deterministic: at least one match with score >= 50
    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    const topMatch = opportunities.sort((a, b) => b.score - a.score)[0];
    expect(topMatch.score).toBeGreaterThanOrEqual(50);
    expect(topMatch.candidateUserId).toBe(TARGET_ID);

    // Semantic: verify the reasoning is grounded
    await assertLLMEvaluate(topMatch.reasoning, {
      criteria: [
        { text: "mentions shared technical skills like Laravel or Vue.js", required: true },
        { text: "identifies complementary goals between the two users", required: true },
        { text: "does not fabricate skills or interests not present in the profiles", required: true, min: 0.7 },
      ],
      minScore: 0.6,
      context: "Yankı (CTO, Laravel/Vue/game dev) was @-mentioned with Samuel (full-stack Laravel/Vue dev seeking ML co-founder). Both share web tech expertise and gaming interest.",
    });
  }, 120_000);
});
