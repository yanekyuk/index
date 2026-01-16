// src/agents/intent/felicity/semantic/semantic-verifier.spec.ts

import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { SemanticVerifierAgent } from './semantic.evaluator';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

describe('Semantic Verifier Agent (Phase 2)', () => {
  let agent: SemanticVerifierAgent;

  beforeAll(() => {
    if (!process.env.OPENROUTER_API_KEY) {
      console.warn("⚠️  No OPENROUTER_API_KEY found. Live LLM tests might fail.");
    }
    agent = new SemanticVerifierAgent();
  });

  // TEST 1: The Ideal Match (High Authority, High Sincerity)
  test('Happy Path: Qualified Commissive', async () => {
    const context = JSON.stringify({
      role: "Senior Backend Engineer",
      skills: ["Node.js", "PostgreSQL", "System Design"],
      years_experience: 8
    });
    const content = "I will structure the database schema for the user module by tomorrow.";

    const res = await agent.run(content, context);

    expect(res).toBeDefined();
    if (res) {
      expect(res.classification).toBe("COMMISSIVE");
      expect(res.felicity_scores.authority).toBeGreaterThan(80); // Skill matches Task
      expect(res.felicity_scores.sincerity).toBeGreaterThan(80); // "I will" is strong
      expect(res.flags).toHaveLength(0);
    }
  });

  // TEST 2: The "Dreamer" (Low Authority check)
  test('Condition Failure: Preparatory (Skill Mismatch)', async () => {
    const context = JSON.stringify({
      role: "Graphic Designer",
      skills: ["Figma", "Photoshop"],
      years_experience: 2
    });
    // User claims to do a task they technically cannot do
    const content = "I can rewrite the Rust kernel modules for better performance.";

    const res = await agent.run(content, context);

    expect(res).toBeDefined();
    if (res) {
      expect(res.felicity_scores.authority).toBeLessThan(50); // Should fail authority
      expect(res.flags.some(f => f.includes("MISMATCH") || f.includes("SKILL"))).toBe(true);
      console.log("Dreamer Detection Reasoning:", res.reasoning);
    }
  });

  // TEST 3: The "Soft No" (Low Sincerity check)
  test('Condition Failure: Sincerity (Hedging)', async () => {
    const context = JSON.stringify({
      role: "Angel Investor",
      liquid_assets: "$500k"
    });
    // User has money (Authority=High), but is non-committal (Sincerity=Low)
    const content = "We should definitely look into maybe funding this at some point.";

    const res = await agent.run(content, context);

    expect(res).toBeDefined();
    if (res) {
      expect(res.felicity_scores.sincerity).toBeLessThan(60);
      expect(res.felicity_scores.clarity).toBeLessThan(60);
      expect(res.flags.some(f => f.includes("COMMITMENT") || f.includes("HEDGING"))).toBe(true);
    }
  });
});