import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { IntentRefiner } from './intent.refiner';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

describe('IntentRefiner Tests', () => {
  let refiner: IntentRefiner;

  beforeAll(() => {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("⚠️  No OPENROUTER_API_KEY found. Live LLM tests might fail.");
    }
    refiner = new IntentRefiner();
  });

  test('Happy Path - Add Location Refinement', async () => {
    const original = "Looking for AI startups to invest in";
    const followup = "Only in the Bay Area";

    const result = await refiner.run(original, followup);
    console.log("Result:", JSON.stringify(result, null, 2));

    expect(result).not.toBeNull();
    expect(result!.refinedPayload).toBeDefined();
    expect(result!.refinedPayload.length).toBeLessThanOrEqual(500);
    // Should mention both AI startups and Bay Area
    expect(result!.refinedPayload.toLowerCase()).toContain("ai");
  });

  test('Happy Path - Add Stage Refinement', async () => {
    const original = "Looking to hire engineers";
    const followup = "Senior level with backend experience";

    const result = await refiner.run(original, followup);
    console.log("Result:", JSON.stringify(result, null, 2));

    expect(result).not.toBeNull();
    expect(result!.refinedPayload).toBeDefined();
    expect(result!.refinedPayload.length).toBeGreaterThan(0);
  });

  test('Short Inputs', async () => {
    const original = "Need co-founder";
    const followup = "Technical";

    const result = await refiner.run(original, followup);
    console.log("Result:", JSON.stringify(result, null, 2));

    expect(result).not.toBeNull();
    expect(result!.refinedPayload).toBeDefined();
  });
});
