// src/agents/intent/felicity/pragmatic/pragmatic-monitor.spec.ts

import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { PragmaticMonitorAgent } from './pragmatic.evaluator';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

describe('Pragmatic Monitor (Discourse Analysis)', () => {
  let agent: PragmaticMonitorAgent;

  beforeAll(() => {
    agent = new PragmaticMonitorAgent();
  });

  // TEST 1: Explicit Completion
  test('Detects FULFILLED status from chat', async () => {
    const intent = "I will write the introduction for the blog post.";
    const discourse = `
      [User]: Hey, just checking in.
      [User]: I finished the intro section this morning, it's on the drive.
      [User]: Now I'm starting on the conclusion.
    `;

    const res = await agent.run(intent, discourse);

    expect(res).toBeDefined();
    if (res) {
      expect(res.status).toBe("FULFILLED");
      expect(res.evidence_quote).toContain("finished the intro");
      expect(res.confidence_score).toBeGreaterThan(90);
    }
  });

  // TEST 2: Change of Mind (Contradiction)
  test('Detects CONTRADICTED status from new goals', async () => {
    const intent = "I am building a mobile app with React Native.";
    const discourse = `
      [User]: I've been thinking about the tech stack.
      [User]: Honestly, React Native is too sluggish for this.
      [User]: I decided to switch to Flutter entirely.
    `;

    const res = await agent.run(intent, discourse);

    expect(res).toBeDefined();
    if (res) {
      expect(res.status).toBe("CONTRADICTED"); // or BREACHED
      expect(res.evidence_quote).toContain("switch to Flutter");
      expect(res.reasoning).toContain("contradicts");
    }
  });

  // TEST 3: Ambiguity (Pending)
  test('Status PENDING when topic is unrelated', async () => {
    const intent = "I will fix the login bug.";
    const discourse = `
      [User]: Did you see the game last night?
      [User]: Also, we need to order lunch.
    `;

    const res = await agent.run(intent, discourse);

    expect(res).toBeDefined();
    if (res) {
      expect(res.status).toBe("PENDING");
      expect(res.confidence_score).toBeLessThan(50); // Low confidence because no signal exists
    }
  });
});