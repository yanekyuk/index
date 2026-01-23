import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { IntentSuggester } from './intent.suggester';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

describe('IntentSuggester Tests', () => {
  let suggester: IntentSuggester;

  beforeAll(() => {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("⚠️  No OPENROUTER_API_KEY found. Live LLM tests might fail.");
    }
    suggester = new IntentSuggester();
  });

  test('Happy Path - Investment Intent', async () => {
    const intentPayload = "Looking for AI startups to invest in at the seed stage";

    const result = await suggester.run(intentPayload);
    console.log("Result:", JSON.stringify(result, null, 2));

    expect(result).not.toBeNull();
    expect(result!.suggestions).toBeArray();
    expect(result!.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(result!.suggestions.length).toBeLessThanOrEqual(5);

    // Verify each suggestion has required fields
    for (const suggestion of result!.suggestions) {
      expect(suggestion.label).toBeDefined();
      expect(suggestion.label.length).toBeLessThanOrEqual(40);
      expect(['direct', 'prompt']).toContain(suggestion.type);

      if (suggestion.type === 'direct') {
        expect(suggestion.followupText).toBeDefined();
      } else {
        expect(suggestion.prefill).toBeDefined();
      }
    }
  });

  test('Happy Path - Hiring Intent', async () => {
    const intentPayload = "Looking to hire a senior backend engineer";

    const result = await suggester.run(intentPayload);
    console.log("Result:", JSON.stringify(result, null, 2));

    expect(result).not.toBeNull();
    expect(result!.suggestions).toBeArray();
    expect(result!.suggestions.length).toBeGreaterThanOrEqual(3);
  });

  test('Short Intent', async () => {
    const intentPayload = "Need co-founder";

    const result = await suggester.run(intentPayload);
    console.log("Result:", JSON.stringify(result, null, 2));

    expect(result).not.toBeNull();
    expect(result!.suggestions).toBeArray();
    // Even short intents should produce suggestions
    expect(result!.suggestions.length).toBeGreaterThanOrEqual(1);
  });
});
