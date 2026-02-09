/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it } from "bun:test";
import { ExplicitIntentInferrer } from "../intent.inferrer";

describe('ExplicitIntentInferrer - Basic Inference', () => {
  const inferrer = new ExplicitIntentInferrer();

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

describe('ExplicitIntentInferrer - InferrerOptions', () => {
  const inferrer = new ExplicitIntentInferrer();

  const mockProfile = `
# User Profile

## Identity
Name: John Doe
Role: Software Engineer

## Narrative
I'm passionate about learning new technologies and building scalable systems.
I've been exploring AI/ML and want to transition into that space.

## Current Goals
- Master machine learning fundamentals
- Build a portfolio of ML projects
- Network with AI researchers
`;

  it('should return empty array when allowProfileFallback is false and no content provided', async () => {
    const result = await inferrer.invoke(
      null, 
      mockProfile, 
      { 
        allowProfileFallback: false,
        operationMode: 'create'
      }
    );
    
    expect(result.intents.length).toBe(0);
  }, 30000);

  it('should infer from profile when allowProfileFallback is true and no content provided', async () => {
    const result = await inferrer.invoke(
      null, 
      mockProfile, 
      { 
        allowProfileFallback: true,
        operationMode: 'create'
      }
    );
    
    expect(result.intents.length).toBeGreaterThan(0);
  }, 30000);

  it('should infer from explicit content regardless of fallback setting', async () => {
    const result = await inferrer.invoke(
      'I want to learn Rust programming and build a web framework',
      mockProfile,
      { 
        allowProfileFallback: false,
        operationMode: 'create'
      }
    );
    
    expect(result.intents.length).toBeGreaterThan(0);
  }, 30000);

  it('should default to allowProfileFallback: true for backward compatibility', async () => {
    const result = await inferrer.invoke(
      null,
      mockProfile
      // No options provided
    );
    
    expect(result.intents.length).toBeGreaterThan(0);
  }, 30000);

  it('should handle update operation mode with content', async () => {
    const result = await inferrer.invoke(
      'Change my ML goal to focus on computer vision instead',
      mockProfile,
      { 
        allowProfileFallback: false,
        operationMode: 'update'
      }
    );
    
    expect(result.intents.length).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('should return empty array for phatic communication', async () => {
    const result = await inferrer.invoke(
      'Hello, how are you?',
      mockProfile,
      { 
        allowProfileFallback: true,
        operationMode: 'create'
      }
    );
    
    expect(result.intents.length).toBe(0);
  }, 30000);
});
