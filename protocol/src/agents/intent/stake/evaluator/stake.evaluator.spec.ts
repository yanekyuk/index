import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { StakeEvaluator } from './stake.evaluator';

// Load env
const envPath = path.resolve(__dirname, '../../../../../.env.development');
dotenv.config({ path: envPath });

describe('StakeMatcher Tests', () => {
  let matcher: StakeEvaluator;
  const primaryIntent = {
    id: "primary-123",
    payload: "I want to learn Rust programming"
  };

  const candidates = [
    { id: "c1", payload: "Teaching a Rust beginners course" }, // Good match
    { id: "c2", payload: "Looking for a Rust developer" }, // Mutual match
    { id: "c3", payload: "I like baking bread" } // Irrelevant
  ];

  beforeAll(() => {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("⚠️  No API Key found. Live LLM tests might fail.");
    }
    // Override preset with a standard model for testing
    matcher = new StakeEvaluator({ model: 'openai/gpt-4o-mini' });
  });

  test('Run Matcher', async () => {
    // Run Matcher (Pure)
    const result = await matcher.run(primaryIntent, candidates);
    result.matches.forEach((m) => {
    });
    expect(Array.isArray(result.matches)).toBe(true);
    // We generally expect matches here, but since it's an LLM test, strict assertion might be flaky without mocks. 
    // The original test just warned. I'll add a loose expectation that it returns a valid structure.
    expect(result).toHaveProperty('matches');
  });
});
