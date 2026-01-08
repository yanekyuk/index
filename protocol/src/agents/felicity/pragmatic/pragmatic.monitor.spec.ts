// src/agents/intent/felicity/pragmatic/pragmatic-monitor.spec.ts

import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { PragmaticMonitorAgent } from './pragmatic.monitor';

// Load env
const envPath = path.resolve(__dirname, '../../../../../.env.development');
dotenv.config({ path: envPath });

describe('Pragmatic Monitor Agent (Phase 3)', () => {
  let agent: PragmaticMonitorAgent;

  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("⚠️  No OPENAI_API_KEY found. Live LLM tests might fail.");
    }
    agent = new PragmaticMonitorAgent();
  });

  // TEST 1: Execution Success (Austin's Completeness Condition met)
  test('Status: FULFILLED - Action found in logs', async () => {
    const intent = "I will fund the treasury with 500 USDC.";
    const logs = JSON.stringify([
      { timestamp: "10:00", action: "user_login" },
      { timestamp: "10:05", action: "wallet_connect" },
      { timestamp: "10:06", action: "transaction_success", details: "Transfer 500 USDC to Treasury" }
    ]);

    const res = await agent.run(intent, logs);

    expect(res).toBeDefined();
    if (res) {
      expect(res.status).toBe("FULFILLED");
      expect(res.execution_score).toBeGreaterThan(90);
      expect(res.evidence_summary).toContain("transaction_success");
    }
  });

  // TEST 2: Execution Failure (Timeout/Inaction)
  test('Status: BREACHED - Timeout / No Action', async () => {
    const intent = "I will upload the design files immediately.";
    const logs = JSON.stringify([
      { timestamp: "10:00", action: "msg_sent", text: "I will upload..." },
      { timestamp: "12:00", action: "system_check", status: "idle" },
      { timestamp: "24:00", action: "system_check", status: "idle" }
    ]);

    const res = await agent.run(intent, logs);

    expect(res).toBeDefined();
    if (res) {
      expect(res.status).toBe("BREACHED"); // or PENDING depending on strictness, but 14h gap implies breach of "immediately"
      expect(res.flags).toBeDefined();
    }
  });

  // TEST 3: Ambiguity (Pending)
  test('Status: PENDING - User is active but action is partial', async () => {
    const intent = "I will fix the bug.";
    const logs = JSON.stringify([
      { timestamp: "10:00", action: "github_pr_open", details: "WIP: Fix bug" }
    ]);

    // PR is open but not merged/completed.
    const res = await agent.run(intent, logs);

    expect(res).toBeDefined();
    if (res) {
      expect(res.status).toBe("PENDING");
      expect(res.evidence_summary).toContain("WIP");
    }
  });
});