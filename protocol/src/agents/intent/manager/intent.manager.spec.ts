import { describe, test, expect, beforeAll } from 'bun:test';
import * as dotenv from 'dotenv';
import path from 'path';
import { IntentManager } from './intent.manager';

// Load env
const envPath = path.resolve(__dirname, '../../../../.env.development');
dotenv.config({ path: envPath });

// Mock Data for Tests
const mockProfile = {
  userId: "test-user-123",
  identity: {
    name: "Test User",
    bio: "A software engineer interested in AI and crypto.",
    location: "San Francisco, CA"
  },
  attributes: {
    interests: ["AI", "Blockchain", "Rust"],
    skills: ["TypeScript", "Solidity", "Team Management", "Hiring"],
    goals: ["Build a startup"]
  }
};

const mockActiveIntents = [
  {
    id: "intent-1",
    description: "Learn Rust",
    status: "active" as const,
    created_at: Date.now()
  }
];

describe('IntentManager Tests', () => {
  let manager: IntentManager;
  let profileContext: string;
  let activeIntentsContext: string;

  beforeAll(() => {
    // Check for API keys
    if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
      throw new Error("⚠️  No API Key found. Live LLM tests might fail.");
    }
    manager = new IntentManager();

    profileContext = `
      Bio: ${mockProfile.identity.bio}
      Location: ${mockProfile.identity.location}
      Interests: ${mockProfile.attributes.interests.join(', ')}
      Skills: ${mockProfile.attributes.skills.join(', ')}
      Goals: ${mockProfile.attributes.goals.join(', ')}
    `;

    activeIntentsContext = mockActiveIntents.map(i => `ID: ${i.id}, Description: ${i.description}, Status: ${i.status}`).join('\n');
  });

  test('Manager Process (New Intent)', async () => {
    // "Learn Rust" is active. "Hire designer" is new.
    const res1 = await manager.processIntent("I will hire a UI designer for my startup", profileContext, activeIntentsContext);

    const hasCreateAction = res1.actions.some(a => a.type === 'create' && a.payload.toLowerCase().includes('designer'));
    expect(hasCreateAction).toBe(true);
  });

  test('Manager Process (Duplicate)', async () => {
    // "Learn Rust" is active. Input "I want to learn Rust".
    const res2 = await manager.processIntent("I want to learn Rust", profileContext, activeIntentsContext);

    const createdDuplicates = res2.actions.filter(a => a.type === 'create' && a.payload.toLowerCase().includes('rust'));
    expect(createdDuplicates.length).toBe(0);
  });

  test('Manager Process (Expire)', async () => {
    const res3 = await manager.processIntent("I'm done with learning Rust, I hate it", profileContext, activeIntentsContext);

    const hasExpireAction = res3.actions.some(a => a.type === 'expire' && a.id === 'intent-1');
    expect(hasExpireAction).toBe(true);
  });

  test('Manager Process (Update)', async () => {
    // "Learn Rust" is active. User provides more detail.
    const res4 = await manager.processIntent("I want to specifically focus on Rust Async streams now", profileContext, activeIntentsContext);

    const hasUpdateAction = res4.actions.some(a => a.type === 'update' && a.id === 'intent-1');
    expect(hasUpdateAction).toBe(true);
  });

  test('Manager Process (Explicit Ignore)', async () => {
    // Use a local active intent that matches what the inferrer prefers ("Learn Rust programming")
    // to ensure we test the IGNORE path, not the trivial UPDATE path.
    const perfectMatchIntents = [{
      id: "intent-1",
      description: "Learn Rust programming",
      status: "active" as const,
      created_at: Date.now()
    }];

    const activeContext = perfectMatchIntents.map(i => `ID: ${i.id}, Description: ${i.description}, Status: ${i.status}`).join('\n');

    const res5 = await manager.processIntent("I want to learn Rust", profileContext, activeContext);

    expect(res5.actions.length).toBe(0);
  });

  test('Manager Process (Semantic Verification Rejection)', async () => {
    // Input a VAGUELY worded intent or one with NO authority
    // "I will rewrite the Linux Kernel in HTML" -> Zero Authority (Skill Mismatch + Technical Impossibility)

    const vagueInput = "I will rewrite the Linux Kernel in HTML";
    const res = await manager.processIntent(vagueInput, profileContext, activeIntentsContext);

    // Should be filtered out by Semantic Verifier
    expect(res.actions.length).toBe(0);
  });
});
