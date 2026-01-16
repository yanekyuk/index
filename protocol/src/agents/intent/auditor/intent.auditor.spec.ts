import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { IntentAuditor } from './intent.auditor';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

describe('IntentAuditor Tests', () => {
  let auditor: IntentAuditor;

  beforeAll(() => {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("⚠️  No OPENROUTER_API_KEY found. Live LLM tests might fail.");
    }
    auditor = new IntentAuditor();
  });

  test('Explicit Expiration (Past Date)', async () => {
    const expiredContent = "I need a ticket for the conference happening on Jan 1st 2020";
    const context = "Current Date: 2025-01-05";

    const res = await auditor.run(expiredContent, context);

    expect(res).not.toBeNull();
    expect(res!.isExpired).toBe(true);
    expect(res!.confidenceScore).toBeGreaterThan(80);
  });

  test('Valid Intent (Future/Recent)', async () => {
    const validContent = "I am looking for a co-founder for my new AI startup";
    const context = "Current Date: 2025-01-05. Intent created 2 days ago.";

    const res = await auditor.run(validContent, context);

    expect(res).not.toBeNull();
    expect(res!.isExpired).toBe(false);
  });

  test('Implicit Expiration (Stale Job Search)', async () => {
    const staleContent = "Looking for a summer internship";
    const context = "Current Date: 2025-10-01. Intent created in March 2025.";

    const res = await auditor.run(staleContent, context);

    expect(res).not.toBeNull();
    expect(res!.isExpired).toBe(true);
  });

  test('Intro Incompatibility', async () => {
    const content = "Looking to get hired as a junior frontend dev";
    const context = `
      Current Date: 2025-01-05.
      User Intro: "Senior Backend Engineer at Google with 10 years of experience."
    `;

    const res = await auditor.run(content, context);

    expect(res).not.toBeNull();
    expect(res!.isExpired).toBe(true);
  });
});
