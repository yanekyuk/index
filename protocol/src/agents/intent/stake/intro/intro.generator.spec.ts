import { describe, test, expect, beforeAll } from 'bun:test';
import { IntroGenerator } from './intro.generator';
import { IntroGeneratorInput } from './intro.generator.types';
import dotenv from 'dotenv';
import path from 'path';

// Load env
const envPath = path.resolve(__dirname, '../../../../../.env.development');
dotenv.config({ path: envPath });

describe('IntroGenerator Tests', () => {
  let generator: IntroGenerator;

  beforeAll(() => {
    generator = new IntroGenerator();
  });

  test('Standard Generation', async () => {
    const mockInput: IntroGeneratorInput = {
      sender: {
        name: "Alice",
        reasonings: [
          "Interested in AI Agents",
          "Building a protocol for decentralized compute"
        ]
      },
      recipient: {
        name: "Bob",
        reasonings: [
          "Investing in AI Infrastructure",
          "Looking for fresh protocols"
        ]
      }
    };

    const result = await generator.run(mockInput);

    expect(result.synthesis).toBeDefined();
    // The original test throws if synthesis length < 10
    expect(result.synthesis.length).toBeGreaterThanOrEqual(10);
  });

  test('Sparse Data', async () => {
    const sparseInput: IntroGeneratorInput = {
      sender: { name: "Mystery User", reasonings: ["Tech"] },
      recipient: { name: "Anon", reasonings: ["Crypto"] }
    };

    const result = await generator.run(sparseInput);

    expect(result.synthesis).toBeDefined();
    expect(result.synthesis.length).toBeGreaterThan(0);
  });
});
