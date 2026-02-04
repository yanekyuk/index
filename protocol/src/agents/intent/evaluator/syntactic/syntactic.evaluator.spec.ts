// src/agents/intent/input-validator/input-validator.spec.ts
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll } from 'bun:test';
import { SyntacticValidatorAgent } from './syntactic.evaluator';

describe('Input Validator Agent (Phase 1)', () => {
  let agent: SyntacticValidatorAgent;

  beforeAll(() => {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("⚠️  No OPENROUTER_API_KEY found. Live LLM tests might fail.");
    }
    agent = new SyntacticValidatorAgent();
  });

  test('Happy Path: Valid English Intent', async () => {
    const content = "I want to build a decentralized finance dashboard using React.";
    const res = await agent.run(content);

    expect(res).toBeDefined();
    if (res) {
      expect(res.status).toBe("PASS");
      expect(res.language).toBe("en");
      expect(res.is_intelligible).toBe(true);
    }
  });

  test('Edge Case: Gibberish', async () => {
    const content = "lkjhasd fkjahsd fkjh asdf";
    const res = await agent.run(content);

    expect(res).toBeDefined();
    if (res) {
      expect(res.status).toBe("FAIL");
      expect(res.is_intelligible).toBe(false);
      expect(res.rejection_reason).toBeDefined();
    }
  });

  test('Edge Case: Non-English Input', async () => {
    // Protocol is English-only for now
    const content = "Je veux créer une application de finance.";
    const res = await agent.run(content);

    expect(res).toBeDefined();
    if (res) {
      expect(res.status).toBe("FAIL");
      // Depending on model, language might be detected correctly as 'fr'
      expect(res.language).not.toBe("en");
    }
  });

  test('Optimization: Auto-reject Short Input', async () => {
    const content = "Hi"; // Too short
    const res = await agent.run(content);

    expect(res).toBeDefined();
    if (res) {
      expect(res.status).toBe("FAIL");
      expect(res.rejection_reason).toContain("too short");
    }
  });
});