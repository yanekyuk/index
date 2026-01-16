import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { IntentIndexer } from './intent.indexer';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

describe('IntentIndexer Tests', () => {
  let indexer: IntentIndexer;

  beforeAll(() => {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("⚠️  No OPENROUTER_API_KEY found. Live LLM tests might fail.");
    }
    indexer = new IntentIndexer();
  });

  test('Highly Appropriate Fit', async () => {
    const intent = "I want to learn how to build autonomous agents";
    const indexPrompt = "A community for builders and researchers working on autonomous AI agents.";
    const memberPrompt = "Interested in AI, agents, and LLMs.";

    const res = await indexer.evaluate(intent, indexPrompt, memberPrompt, "test");

    expect(res).not.toBeNull();
    expect(res!.indexScore).toBeGreaterThan(0.8);
    expect(res!.memberScore).toBeGreaterThan(0.8);
  });

  test('Poor Index Fit', async () => {
    const intent = "Selling my old car";
    const indexPrompt = "A community for builders and researchers working on autonomous AI agents.";
    const memberPrompt = "Interested in AI, agents, and LLMs.";

    const res = await indexer.evaluate(intent, indexPrompt, memberPrompt, "test");

    expect(res).not.toBeNull();
    expect(res!.indexScore).toBeLessThan(0.3);
  });

  test('Good Index Fit, Poor Member Fit', async () => {
    const intent = "Looking for co-founders for a crypto trading bot";
    const indexPrompt = "A place to find co-founders for tech startups.";
    const memberPrompt = "I am strictly interested in biotech and health tech. No crypto.";

    const res = await indexer.evaluate(intent, indexPrompt, memberPrompt, "test");

    expect(res).not.toBeNull();
    expect(res!.indexScore).toBeGreaterThanOrEqual(0.7);
    expect(res!.memberScore).toBeLessThan(0.3);
  });

  test('Missing Member Prompt', async () => {
    const intent = "Just hanging out";
    const indexPrompt = "General chat.";

    // @ts-ignore
    const res = await evaluator.evaluate(intent, indexPrompt, null, "test");

    expect(res).not.toBeNull();
    expect(res!.memberScore).toBe(0);
  });
});
