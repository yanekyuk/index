import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import type { SeedRequirement, GeneratedSeedData, SeedProfile } from "./seed.types";

const SEED_EMAIL_DOMAIN = "test.indexnetwork.io";

function makeSeedTag(): string {
  return `eval-${crypto.randomUUID().slice(0, 8)}`;
}

function makeSeedEmail(seedTag: string, suffix: string): string {
  return `${seedTag}-${suffix}@${SEED_EMAIL_DOMAIN}`;
}

/**
 * Generate fresh, realistic seed data for a scenario using LLM.
 * Each invocation produces unique names, bios, intents, etc.
 */
export async function generateSeedData(
  requirements: SeedRequirement,
  scenario: { question: string; expectation: string; category: string }
): Promise<GeneratedSeedData> {
  const seedTag = makeSeedTag();
  const password = `EvalTest!${seedTag}`;

  const model = new ChatOpenAI({
    model: "google/gemini-2.5-flash",
    configuration: {
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    },
    temperature: 0.7,
  });

  const prompt = `Generate realistic test data for an evaluation scenario.

## Scenario
Category: ${scenario.category}
Question: ${scenario.question}
Expectation: ${scenario.expectation}

## Requirements
- Test user needs profile: ${requirements.user.hasProfile}
- Test user intent count: ${requirements.user.intentCount}
- Test user index memberships: ${requirements.user.indexMemberships}
- Other users in network: ${requirements.network.otherUsers}
- Other users have intents: ${requirements.network.withIntents}
- Indexes to create: ${requirements.indexes.count}
${requirements.opportunities ? `- Opportunities: ${requirements.opportunities.count} with statuses [${requirements.opportunities.statuses.join(", ")}]` : ""}

## Email Pattern
Use these exact emails:
- Test user: ${makeSeedEmail(seedTag, "main")}
${requirements.network.otherUsers > 0 ? Array.from({ length: requirements.network.otherUsers }, (_, i) => `- Other user ${i + 1}: ${makeSeedEmail(seedTag, `user${i + 1}`)}`).join("\n") : ""}

## Output Format
Return ONLY valid JSON matching this structure:
{
  "testUser": {
    "name": "Full Name",
    "email": "${makeSeedEmail(seedTag, "main")}",
    "profile": {
      "identity": { "name": "Full Name", "bio": "2-3 sentence professional bio", "location": "City, Country" },
      "narrative": { "context": "1-2 sentence professional context" },
      "attributes": { "interests": ["interest1", "interest2"], "skills": ["skill1", "skill2", "skill3"] }
    }
  },
  "intents": ["intent text 1", "intent text 2"],
  "indexes": [{ "title": "Index Name", "prompt": "what this index is about" }],
  "otherUsers": [
    {
      "name": "Other Name",
      "email": "${requirements.network.otherUsers > 0 ? makeSeedEmail(seedTag, "user1") : ""}",
      "profile": { "identity": {...}, "narrative": {...}, "attributes": {...} },
      "intents": ["their intent"]
    }
  ]${requirements.opportunities ? `,
  "opportunities": [
    { "category": "collaboration", "reasoning": "why this match", "confidence": 0.85, "status": "${requirements.opportunities.statuses[0] || "pending"}" }
  ]` : ""}
}

Make the data realistic, diverse, and relevant to the scenario category "${scenario.category}".
${!requirements.user.hasProfile ? "Since no profile is needed, set testUser.profile to null." : ""}
${requirements.user.intentCount === 0 ? 'Set "intents" to an empty array.' : ""}
${requirements.indexes.count === 0 ? 'Set "indexes" to an empty array.' : ""}
${requirements.network.otherUsers === 0 ? 'Set "otherUsers" to an empty array.' : ""}`;

  const response = await model.invoke([new HumanMessage(prompt)]);
  const content = response.content.toString();

  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to generate seed data: no JSON in response");
  }

  const raw = JSON.parse(jsonMatch[1] || jsonMatch[0]);

  return {
    seedTag,
    testUser: {
      name: raw.testUser.name,
      email: raw.testUser.email || makeSeedEmail(seedTag, "main"),
      password,
      profile: raw.testUser.profile as SeedProfile | null as unknown as SeedProfile,
    },
    intents: raw.intents || [],
    indexes: raw.indexes || [],
    otherUsers: (raw.otherUsers || []).map((u: Record<string, unknown>, i: number) => ({
      name: u.name as string,
      email: (u.email as string) || makeSeedEmail(seedTag, `user${i + 1}`),
      password,
      profile: u.profile as SeedProfile,
      intents: (u.intents as string[]) || [],
    })),
    opportunities: raw.opportunities || undefined,
  };
}
