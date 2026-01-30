import { config } from "dotenv";
config({ path: '.env.development', override: true });

import { describe, expect, it } from "bun:test";
import { RouterAgent } from './router/chat.router';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

describe('RouterAgent - Phase 1: Read/Write Operations', () => {
  const router = new RouterAgent();
  const profileContext = "Software engineer interested in Rust and AI";
  const activeIntents = "Learning Python, Building a startup";

  // READ operations - should route to *_query
  it('should route simple intent query to intent_query with read operation', async () => {
    const result = await router.invoke("what are my intents?", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_query");
    expect(result.operationType).toBe("read");
  }, 30000);

  it('should route display intents request to intent_query with read operation', async () => {
    const result = await router.invoke("show me my goals", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_query");
    expect(result.operationType).toBe("read");
  }, 30000);

  it('should route list intents request to intent_query with read operation', async () => {
    const result = await router.invoke("list my current intentions", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_query");
    expect(result.operationType).toBe("read");
  }, 30000);

  it('should route check intents status to intent_query with read operation', async () => {
    const result = await router.invoke("do I have any active goals?", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_query");
    expect(result.operationType).toBe("read");
  }, 30000);

  it('should route profile query to profile_query with read operation', async () => {
    const result = await router.invoke("what's my profile?", profileContext, activeIntents);
    
    expect(result.target).toBe("profile_query");
    expect(result.operationType).toBe("read");
  }, 30000);

  // WRITE operations - CREATE
  it('should route new intent creation to intent_write with create operation', async () => {
    const result = await router.invoke("I want to learn Rust", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("create");
  }, 30000);

  it('should route intent declaration to intent_write with create operation', async () => {
    const result = await router.invoke("looking for a co-founder", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("create");
  }, 30000);

  it('should route interest declaration to intent_write with create operation', async () => {
    const result = await router.invoke("I'm interested in AI", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("create");
  }, 30000);

  // WRITE operations - UPDATE
  it('should route profile update to profile_write with update operation', async () => {
    const result = await router.invoke("update my bio to senior engineer", profileContext, activeIntents);
    
    expect(result.target).toBe("profile_write");
    expect(result.operationType).toBe("update");
  }, 30000);

  it('should route intent update to intent_write with update operation', async () => {
    const result = await router.invoke("change my goal from Python to Rust", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("update");
  }, 30000);

  // WRITE operations - DELETE
  it('should route intent deletion to intent_write with delete operation', async () => {
    const result = await router.invoke("remove my coding goal", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("delete");
  }, 30000);

  it('should route intent tombstone to intent_write with delete operation', async () => {
    const result = await router.invoke("I'm done with machine learning", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("delete");
  }, 30000);
});

describe('RouterAgent - Anaphoric Override (Rule 0)', () => {
  const router = new RouterAgent();
  const profileContext = "Software engineer interested in Rust and AI";
  const activeIntents = "Learning Python, Building a text-based RPG game";

  // SHOULD TRIGGER - Strong anaphoric references with action verbs
  it('should trigger override for "Make that" with action verb', async () => {
    const result = await router.invoke("Make that text-based RPG game", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("update");
    expect(result.reasoning).toContain('[ANAPHORIC OVERRIDE]');
  }, 30000);

  it('should trigger override for "Update this" with action verb', async () => {
    const result = await router.invoke("Update this goal to include AI", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("update");
    expect(result.reasoning).toContain('[ANAPHORIC OVERRIDE]');
  }, 30000);

  it('should trigger override for "Change it" with action verb', async () => {
    const result = await router.invoke("Change it to be more specific", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("update");
    expect(result.reasoning).toContain('[ANAPHORIC OVERRIDE]');
  }, 30000);

  it('should route "Remove that" to delete operation', async () => {
    const result = await router.invoke("Remove that from my intents", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("delete");
  }, 30000);

  // SHOULD NOT TRIGGER - Conversational messages without strong anaphoric signals
  it('should not trigger override for general questions', async () => {
    const result = await router.invoke("What can you do?", profileContext, activeIntents);
    
    expect(result.target).toBe("respond");
    expect(result.operationType).toBe(null);
    expect(result.reasoning).not.toContain('[ANAPHORIC OVERRIDE]');
  }, 30000);

  it('should not trigger override for conversational responses', async () => {
    const result = await router.invoke("That sounds interesting", profileContext, activeIntents);
    
    expect(result.target).toBe("respond");
    expect(result.operationType).toBe(null);
    expect(result.reasoning).not.toContain('[ANAPHORIC OVERRIDE]');
  }, 30000);

  // SHOULD NOT TRIGGER - Direct commands without anaphoric references
  it('should not trigger override for direct intent creation', async () => {
    const result = await router.invoke("I want to learn TypeScript", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("create");
    expect(result.reasoning).not.toContain('[ANAPHORIC OVERRIDE]');
  }, 30000);

  it('should not trigger override for explicit create command', async () => {
    const result = await router.invoke("Create a goal for machine learning", profileContext, activeIntents);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("create");
    expect(result.reasoning).not.toContain('[ANAPHORIC OVERRIDE]');
  }, 30000);
});

describe('RouterAgent - Confirmation Routing', () => {
  const router = new RouterAgent();
  const profileContext = "Name: Test User\nBio: Software developer";
  const activeIntents = "Create an RPG game with LLM-enhanced narration";

  it('should detect confirmation after intent update suggestion', async () => {
    const conversationHistory = [
      new HumanMessage("I want to create an RPG game"),
      new AIMessage("I've noted your intent to create an RPG game. Should I update it to be more specific, like 'Create a text-based RPG game with LLM-enhanced narration'?"),
    ];
    
    const result = await router.invoke("Yes", profileContext, activeIntents, conversationHistory);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("update");
  }, 30000);

  it('should detect confirmation with "Sure" for deletion', async () => {
    const conversationHistory = [
      new HumanMessage("Can you delete my coding goal?"),
      new AIMessage("I can help with that. Should I delete your intent about 'Learn advanced TypeScript'?"),
    ];
    
    const result = await router.invoke("Sure, go ahead", profileContext, "Learn advanced TypeScript", conversationHistory);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("delete");
  }, 30000);

  it('should detect confirmation with "Okay" for creation', async () => {
    const conversationHistory = [
      new HumanMessage("I'm interested in learning Rust"),
      new AIMessage("Would you like me to create an intent for 'Learn Rust programming language'?"),
    ];
    
    const result = await router.invoke("Okay", profileContext, "No active intents.", conversationHistory);
    
    expect(result.target).toBe("intent_write");
    expect(result.operationType).toBe("create");
  }, 30000);

  it('should handle ambiguous "Yes" without conversation history', async () => {
    const result = await router.invoke("Yes", profileContext, "No active intents.");
    
    expect(result.target === "respond" || result.target === "clarify").toBe(true);
    expect(result.operationType).toBe(null);
  }, 30000);

  it('should handle negative confirmation - not creating intent', async () => {
    const conversationHistory = [
      new HumanMessage("I want to learn Python"),
      new AIMessage("Should I create an intent for 'Learn Python programming'?"),
    ];
    
    const result = await router.invoke("No, never mind", profileContext, "No active intents.", conversationHistory);
    
    // Should not create - either respond or potentially delete (if inferring user changed mind about the intent)
    expect(result.operationType).not.toBe("create");
  }, 30000);
});
