import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { CATEGORIES, CHAT_AGENT_USER_NEEDS } from "../scenarios";
import type { SeedRequirement } from "./seed.types";
import { DEFAULT_SEED_REQUIREMENTS } from "./seed.types";

export interface ClassifiedFeedback {
  category: string;
  needId: string;
  question: string;
  expectation: string;
  message: string;
  seedRequirements: SeedRequirement;
}

const categoryList = Object.values(CATEGORIES).join(", ");
const needIdExamples = Object.keys(CHAT_AGENT_USER_NEEDS).slice(0, 10).join(", ");

/**
 * Classify user feedback + conversation into a structured scenario
 * that can be inserted into eval_scenarios with source="feedback".
 */
export async function classifyFeedback(
  feedbackText: string,
  conversation: Array<{ role: string; content: string }>
): Promise<ClassifiedFeedback> {
  const model = new ChatOpenAI({
    model: "google/gemini-2.5-flash",
    configuration: {
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    },
    temperature: 0.3,
  });

  const conversationText = conversation
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const prompt = `You are classifying user feedback about a chat agent into a structured evaluation scenario.

## Feedback
"${feedbackText}"

## Conversation that prompted the feedback
${conversationText || "(no conversation provided)"}

## Available categories
${categoryList}

## Example need IDs (for reference style)
${needIdExamples}

## Task
Analyze the feedback and classify it into:
1. **category**: Which category does this feedback relate to? Pick from the list above.
2. **needId**: Create a snake_case UPPER_CASE need ID (e.g., INTENT_DELETE, PROFILE_UPDATE, DISCOVERY_HIRE). Use existing IDs if applicable, or create new ones.
3. **question**: What the user was trying to do (e.g., "User wants to delete their intent")
4. **expectation**: What the agent should have done (e.g., "Agent should find and delete the specified intent")
5. **message**: A realistic user message that would test this scenario (matching the complaint)
6. **seedCategory**: Which category to use for seed requirements (from: ${Object.keys(DEFAULT_SEED_REQUIREMENTS).join(", ")})

Respond ONLY with JSON:
{
  "category": "...",
  "needId": "...",
  "question": "...",
  "expectation": "...",
  "message": "...",
  "seedCategory": "..."
}`;

  const response = await model.invoke([new HumanMessage(prompt)]);
  const content = response.content.toString();

  const jsonMatch =
    content.match(/```json\s*([\s\S]*?)\s*```/) ||
    content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to classify feedback: no JSON in response");
  }

  const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);

  const seedCategory = parsed.seedCategory || parsed.category || "meta";
  const seedRequirements =
    DEFAULT_SEED_REQUIREMENTS[seedCategory] ??
    DEFAULT_SEED_REQUIREMENTS["meta"];

  return {
    category: parsed.category || "edge_case",
    needId: parsed.needId || "UNKNOWN",
    question: parsed.question || feedbackText,
    expectation: parsed.expectation || "Agent should handle this correctly",
    message: parsed.message || feedbackText,
    seedRequirements,
  };
}
