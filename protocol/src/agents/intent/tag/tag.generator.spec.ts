import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { IntentTagGenerator } from './tag.generator';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

describe('IntentTagGenerator Tests', () => {
  let generator: IntentTagGenerator;

  beforeAll(() => {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("⚠️  No OPENROUTER_API_KEY found. Live LLM tests might fail.");
    }
    generator = new IntentTagGenerator();
  });

  test('Job Search Intents', async () => {
    const intents = [
      "Looking for a frontend developer role",
      "Hiring a senior react engineer",
      "Seeking remote web dev contracts"
    ];

    const res = await generator.run(intents);

    expect(res).not.toBeNull();
    expect(res!.suggestions.length).toBeGreaterThan(0);

    const hasDevTag = res!.suggestions.some(t => t.value.includes('dev') || t.value.includes('engineer') || t.value.includes('react'));
    expect(hasDevTag).toBe(true);
  });

  test('With User Prompt "Crypto"', async () => {
    const intents = [
      "Building a DeFi protocol",
      "Looking for solidity devs",
      "Investing in new L1 chains",
      "Hiring for my AI startup"
    ];
    const userPrompt = "Focus on crypto and blockchain";

    const res = await generator.run(intents, userPrompt);

    expect(res).not.toBeNull();
    expect(res!.suggestions.length).toBeGreaterThan(0);

    const hasCryptoTag = res!.suggestions.some(t => t.value.includes('defi') || t.value.includes('crypto') || t.value.includes('blockchain'));
    expect(hasCryptoTag).toBe(true);
  });
});
