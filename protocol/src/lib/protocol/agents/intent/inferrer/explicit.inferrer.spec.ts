import { config } from "dotenv";
config({ path: 'protocol/.env.development', override: true });

import { describe, expect, it } from "bun:test";
import { ExplicitIntentInferrer } from "./explicit.inferrer";
import { Database } from "../../../interfaces/database.interface";
import { Embedder } from "../../../interfaces/embedder.interface";

// Mock dependencies
const mockDatabase = {} as Database;
const mockEmbedder = {} as Embedder;

describe('ExplicitIntentInferrer', () => {
  const inferrer = new ExplicitIntentInferrer(mockDatabase, mockEmbedder);

  // We assume the user profile context string
  const profileContext = "User is an experienced software engineer interested in AI and crypto.";

  it('should extract a clear explicit goal', async () => {
    const content = "I want to deploy a Solidity contract to Ethereum mainnet by tomorrow.";
    const result = await inferrer.invoke(content, profileContext);

    expect(result.intents.length).toBeGreaterThan(0);
    const intent = result.intents.find(i => i.type === 'goal');
    expect(intent).toBeDefined();
    expect(intent?.description).toContain("Deploy");
    expect(intent?.confidence).toBe("high");
  }, 30000);

  it('should identify a tombstone (completed goal)', async () => {
    const content = "I finished the React course. It's done.";
    const result = await inferrer.invoke(content, profileContext);

    const tombstone = result.intents.find(i => i.type === 'tombstone');
    expect(tombstone).toBeDefined();
    expect(tombstone?.description).toContain("React course");
  }, 30000);

  it('should ignore vague or phatic communication', async () => {
    const content = "Hey how are you?";
    const result = await inferrer.invoke(content, profileContext);
    // Should be empty or filtered out by the rules
    // The extraction might find nothing or find it low confidence. 
    // Our prompt says "IGNORE purely phatic communication... return empty intents"
    expect(result.intents.length).toBe(0);
  }, 30000);
});
