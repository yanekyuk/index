import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { CATEGORIES, CHAT_AGENT_USER_NEEDS } from "../scenarios";
import type { SeedRequirement } from "./seed.types";
import { DEFAULT_SEED_REQUIREMENTS } from "./seed.types";

export interface OrderedScenario {
  category: string;
  needId: string;
  question: string;
  expectation: string;
  message: string;
  seedRequirements: SeedRequirement;
  generationReason: string;
}

interface EvalResultSummary {
  scenarioId: string;
  category: string;
  needId?: string;
  question: string;
  verdict: string;
  fulfillmentScore: number;
  failureSignals?: string[];
}

/**
 * Analyze evaluation results and generate new scenarios to improve coverage.
 * Looks for failure clusters, coverage gaps, and feedback patterns.
 */
export async function orderNewScenarios(
  results: EvalResultSummary[],
  existingCategories: string[],
  maxScenarios: number = 5
): Promise<OrderedScenario[]> {
  const model = new ChatOpenAI({
    model: "google/gemini-2.5-flash",
    configuration: {
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    },
    temperature: 0.5,
  });

  const failedResults = results.filter(
    (r) => r.verdict === "failure" || r.verdict === "blocked"
  );
  const partialResults = results.filter((r) => r.verdict === "partial");

  const categoryGroups: Record<string, { total: number; failed: number; partial: number }> = {};
  for (const r of results) {
    if (!categoryGroups[r.category]) {
      categoryGroups[r.category] = { total: 0, failed: 0, partial: 0 };
    }
    categoryGroups[r.category].total++;
    if (r.verdict === "failure" || r.verdict === "blocked") categoryGroups[r.category].failed++;
    if (r.verdict === "partial") categoryGroups[r.category].partial++;
  }

  const allCategories = Object.values(CATEGORIES);
  const untestedCategories = allCategories.filter(
    (c) => !existingCategories.includes(c)
  );

  const availableNeedIds = Object.keys(CHAT_AGENT_USER_NEEDS).slice(0, 20);
  const seedCategoryKeys = Object.keys(DEFAULT_SEED_REQUIREMENTS);

  const prompt = `You are an evaluation scenario generator. Analyze these test results and generate ${maxScenarios} NEW scenarios to improve test coverage.

## Current Results Summary
Total scenarios tested: ${results.length}
Failed: ${failedResults.length}
Partial: ${partialResults.length}

## Category Performance
${Object.entries(categoryGroups)
  .map(([cat, stats]) => `- ${cat}: ${stats.total} total, ${stats.failed} failed, ${stats.partial} partial`)
  .join("\n")}

## Top Failure Signals
${failedResults
  .slice(0, 5)
  .map((r) => `- [${r.category}] ${r.question}: ${(r.failureSignals || []).join(", ")}`)
  .join("\n") || "(none)"}

## Untested Categories
${untestedCategories.join(", ") || "(all covered)"}

## Available Categories
${allCategories.join(", ")}

## Seed Category Keys (for seedCategory field)
${seedCategoryKeys.join(", ")}

## Example Need IDs
${availableNeedIds.join(", ")}

## Instructions
Generate ${maxScenarios} new scenarios focusing on:
1. **Failure clusters**: Create variations of frequently failing scenarios to probe the root cause
2. **Coverage gaps**: Test untested categories or need types
3. **Edge cases**: Create boundary/stress scenarios for weak areas
4. **Regression**: Create scenarios that verify partial successes become full successes

Return ONLY a JSON array:
[
  {
    "category": "...",
    "needId": "UNIQUE_NEED_ID",
    "question": "What the user wants",
    "expectation": "What the agent should do",
    "message": "Realistic user message to send",
    "seedCategory": "category key for seed requirements",
    "generationReason": "Why this scenario was generated"
  }
]`;

  const response = await model.invoke([new HumanMessage(prompt)]);
  const content = response.content.toString();

  const jsonMatch =
    content.match(/```json\s*([\s\S]*?)\s*```/) ||
    content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]) as Array<
      Record<string, string>
    >;

    return parsed.map((item) => ({
      category: item.category || "edge_case",
      needId: item.needId || `GENERATED_${Date.now()}`,
      question: item.question || "",
      expectation: item.expectation || "",
      message: item.message || "",
      seedRequirements:
        DEFAULT_SEED_REQUIREMENTS[item.seedCategory || item.category] ??
        DEFAULT_SEED_REQUIREMENTS["meta"],
      generationReason: item.generationReason || "auto-generated",
    }));
  } catch {
    return [];
  }
}
