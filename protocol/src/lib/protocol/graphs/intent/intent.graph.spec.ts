/**
 * Tests for IntentGraph
 */
import { config } from "dotenv";
config({ path: 'protocol/.env.development', override: true });

import { describe, expect, it, beforeAll } from "bun:test";
import { IntentGraphFactory } from "./intent.graph";
import { Database } from "../../interfaces/database.interface"; // Mock
import { Embedder } from "../../interfaces/embedder.interface"; // Mock
import { IntentGraphState } from "./intent.graph.state";

// Mock Database and Embedder
const mockDatabase = {
  exists: async () => false,
  update: async () => { },
  create: async () => { },
  find: async () => []
} as unknown as Database;

const mockEmbedder = {
  generate: async () => []
} as unknown as Embedder;

describe('IntentGraph', () => {
  let graphRunner: any;

  beforeAll(() => {
    const factory = new IntentGraphFactory(mockDatabase, mockEmbedder);
    graphRunner = factory.createGraph();
  });

  it('should process a clear goal correctly', async () => {
    const inputState: typeof IntentGraphState.State = {
      userProfile: "User is a Senior Developer named Alice. She likes generic coding.",
      activeIntents: "No active intents.",
      inputContent: "I want to build a new React app for my portfolio.",
      inferredIntents: [],
      verifiedIntents: [],
      actions: []
    };

    const result = await graphRunner.invoke(inputState);

    console.log("Graph Result:", JSON.stringify(result, null, 2));

    // Expectations
    expect(result.inferredIntents.length).toBeGreaterThan(0);
    expect(result.verifiedIntents.length).toBeGreaterThan(0);
    expect(result.actions.length).toBeGreaterThan(0);

    const action = result.actions[0];
    expect(action.type).toBe("create");
    expect(action.payload).toContain("React");
  }, 60000);

  it('should ignore vague nonsense', async () => {
    const inputState: typeof IntentGraphState.State = {
      userProfile: "User is a Senior Developer named Alice.",
      activeIntents: "No active intents.",
      inputContent: "I feel like doing something maybe.",
      inferredIntents: [],
      verifiedIntents: [],
      actions: []
    };

    const result = await graphRunner.invoke(inputState);
    console.log("Graph Result (Vague):", JSON.stringify(result, null, 2));

    // It might infer an intent, but the Verifier should drop it, or Reconciler ignore it.
    // If Verifier drops it, verifiedIntents should be empty.
    // OR Reconciler returns 0 actions.
    expect(result.actions.length).toBe(0);
  }, 60000);
});
