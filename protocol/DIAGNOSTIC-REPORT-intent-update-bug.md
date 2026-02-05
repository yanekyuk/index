# Diagnostic Report: Intent Update Bug

## Problem Statement
User conversation leads to response: "Okay, I've updated your intent. Now, it reads: **Create a text-based RPG game with LLM-enhanced narration**"

But checking the database shows intent is unchanged: "Create an RPG game with LLM-enhanced narration"

## Root Cause Analysis

### 🔴 PRIMARY ISSUE: Router lacks conversation context

**Location**: [`router.agent.ts:205-209`](src/lib/protocol/agents/chat/router.agent.ts:205)

The router agent's `invoke()` method only receives:
```typescript
public async invoke(
  userMessage: string,      // ❌ ONLY current message
  profileContext: string,
  activeIntents: string
): Promise<RouterOutput>
```

**Missing**: Conversation history

**Impact**: When user says "Yes" to confirm an intent update:
- Router sees ONLY "Yes" without context
- Has no idea what user is confirming
- Routes to `target: "respond"` with `operationType: null`
- Intent graph never invoked → no database write

**Evidence from chat.graph.ts:381**:
```typescript
const decision = await routerAgent.invoke(
  userMessage,        // ❌ Single message only
  profileContext,
  state.activeIntents
);
```

Compare this to the intent subgraph invocation (chat.graph.ts:561):
```typescript
const intentInput = {
  userId: state.userId,
  userProfile: state.userProfile ? JSON.stringify(state.userProfile) : "",
  inputContent,
  conversationContext,  // ✅ HAS conversation history!
  operationMode,
  targetIntentIds: undefined,
};
```

### 🔴 SECONDARY ISSUE: Response Generator Hallucination

**Location**: [`response.generator.ts:356-377`](src/lib/protocol/agents/chat/response.generator.ts:356)

The response generator builds prompts including conversation history but lacks verification:

**What happens**:
1. Router routes "Yes" to `target: "respond"` (no subgraph execution)
2. No actions are taken, no database writes occur
3. Response generator receives conversation history via chat.graph.ts:782
4. LLM sees full context: prior suggestion to make RPG "text-based" + user confirmation "Yes"
5. LLM **assumes** the update happened and generates: "I've updated your intent..."
6. **Reality**: No actual database write occurred

**The Dangerous Mismatch**:
- Router: No conversation context → misroutes
- Response Generator: Has conversation context → hallucinates success

### 🟡 WHY ANAPHORIC OVERRIDE DOESN'T HELP

The anaphoric override (router.agent.ts:312-330) checks for:
```typescript
const actionVerbs = /\b(make|create|update|change|modify|set|add|remove|delete)\s+(that|this|it|the)\b/i;
```

"Yes" contains:
- ❌ No action verb
- ❌ No anaphoric pronoun
- ❌ No demonstrative reference

The override cannot trigger on simple affirmative responses.

## Conversation Flow That Triggers the Bug

### Hypothetical Prior Context:
```
User: "I want to build an RPG game"
Assistant: "I've captured your intent: Create an RPG game with LLM-enhanced narration"
User: "Make it text-based"
Assistant: "Should I update your intent to: Create a text-based RPG game with LLM-enhanced narration?"
User: "Yes"  ← BUG OCCURS HERE
```

### What SHOULD Happen:
1. Router sees "Yes" + prior confirmation question context
2. Recognizes this as confirming a pending intent update
3. Routes to `target: "intent_write"` with `operationType: "update"`
4. Intent graph processes the update
5. Database write occurs
6. Response confirms actual completion

### What ACTUALLY Happens:
1. Router sees ONLY "Yes" without context
2. Routes to `target: "respond"` with `operationType: null`
3. No subgraph execution
4. No database write
5. Response generator sees full conversation history
6. **Hallucinates** successful update based on context
7. Claims: "I've updated your intent..." ← LIE

## Impact Assessment

**Severity**: 🔴 CRITICAL

**User Impact**:
- Users believe their intents were updated
- Database remains unchanged
- Trust in system accuracy broken
- Data integrity compromised

**Frequency**:
- ANY implicit confirmation ("Yes", "Sure", "Okay", "Correct")
- ANY multi-turn intent refinement conversation
- Common in natural conversation flow

## Recommended Fixes

### Fix 1: Pass Conversation History to Router (PRIMARY)

**Priority**: 🔴 CRITICAL

**File**: `src/lib/protocol/agents/chat/router.agent.ts`

**Changes Required**:

1. **Update router signature**:
```typescript
public async invoke(
  userMessage: string,
  profileContext: string,
  activeIntents: string,
  conversationHistory?: BaseMessage[]  // NEW
): Promise<RouterOutput>
```

2. **Update router prompt** to include conversation context:
```typescript
const prompt = `
# User Message
${userMessage}

# Conversation History (Last 5 messages)
${conversationHistory ? formatConversationHistory(conversationHistory) : "No prior context."}

# User Profile Context
${profileContext || "No profile loaded yet."}

# Active Intents
${activeIntents || "No active intents."}

Analyze this message IN CONTEXT of the conversation history to determine the best routing action.
`.trim();
```

3. **Update chat.graph.ts router invocation** (line 381):
```typescript
const decision = await routerAgent.invoke(
  userMessage,
  profileContext,
  state.activeIntents,
  state.messages.slice(-10)  // Last 10 messages for context
);
```

4. **Add confirmation detection** to router system prompt:
```markdown
### CONFIRMATION Responses
When user provides affirmative/negative responses in context:
- Yes, Sure, Okay, Correct, Right, Exactly → Check conversation for pending operation
- No, Nope, Cancel, Nevermind → Abort pending operation

Look at conversation history to identify:
- Did system just ask for confirmation?
- What operation was being confirmed?
- Route accordingly (intent_write/profile_write/respond)
```

**Benefits**:
- Router can understand implicit confirmations
- Handles natural multi-turn conversations
- Aligns router context with response generator context

### Fix 2: Add Safety Checks to Response Generator (SECONDARY)

**Priority**: 🟡 HIGH

**File**: `src/lib/protocol/agents/chat/response.generator.ts`

**Changes Required**:

1. **Add verification prompt** before claiming success:
```typescript
## CRITICAL: Verify Before Claiming Success

Before stating that an action was completed (e.g., "I've updated...", "I've created..."):
1. Check subgraphResults for actual actions taken
2. If target was "respond" with no subgraph results:
   - DO NOT claim any data was modified
   - Provide conversational response only
3. Only confirm operations that actually occurred in subgraphResults

Examples:
- ✅ target="intent_write" + actions=[{type:"update",...}] → "I've updated your intent"
- ❌ target="respond" + no actions → "I understand, but I need more information to update your intent"
- ❌ target="respond" + actions=[] → DO NOT SAY "I've updated"
```

2. **Add validation in formatSubgraphResults** (line 188):
```typescript
public formatSubgraphResults(results: SubgraphResults): string {
  const sections: string[] = [];
  
  // Validate write operations
  if (results.intent?.mode === 'write') {
    const hasActions = results.intent.actions && results.intent.actions.length > 0;
    if (!hasActions) {
      sections.push('⚠️ WARNING: Intent write mode but NO ACTIONS TAKEN');
      sections.push('Do NOT claim any intents were updated/created.');
    }
  }
  
  // ... rest of formatting
}
```

**Benefits**:
- Prevents hallucinated confirmations
- Acts as safety net if router misroutes
- Improves system reliability

### Fix 3: Add Confirmation State Tracking (OPTIONAL)

**Priority**: 🟢 NICE-TO-HAVE

**Location**: `src/lib/protocol/graphs/chat/chat.graph.state.ts`

**Concept**:
```typescript
export interface PendingConfirmation {
  operationType: 'intent_update' | 'intent_create' | 'profile_update';
  context: string;
  timestamp: Date;
}

// Add to ChatGraphState
pendingConfirmation?: PendingConfirmation;
```

**Benefits**:
- Explicit confirmation tracking
- Clear state management
- Easier debugging

**Drawbacks**:
- More complex state management
- Requires graph state changes
- May not handle all conversation patterns

## Testing Strategy

### Unit Tests Required:

1. **Router with conversation history**:
```typescript
// Test: "Yes" after confirmation question
const history = [
  { role: "assistant", content: "Should I update your intent to: Create a text-based RPG?" },
  { role: "user", content: "Yes" }
];
const result = await router.invoke("Yes", profileCtx, intents, history);
expect(result.target).toBe("intent_write");
expect(result.operationType).toBe("update");
```

2. **Response generator safety**:
```typescript
// Test: No actions taken, shouldn't claim success
const result = await responseGen.invoke(
  "Yes",
  { target: "respond", operationType: null, ... },
  {} // No subgraph results
);
expect(result.response).not.toContain("I've updated");
expect(result.response).not.toContain("I've created");
```

### Integration Tests Required:

1. Full conversation flow with implicit confirmation
2. Multi-turn intent refinement
3. Negative confirmation ("No", cancel operation)

## Timeline

- **Fix 1 (Conversation History to Router)**: 2-3 hours development + testing
- **Fix 2 (Response Generator Safety)**: 1-2 hours development + testing
- **Testing & Validation**: 2-3 hours
- **Total**: 1 day to implement and test both fixes

## Conclusion

This is a **critical architectural mismatch** where:
- Router operates on single message (no context)
- Response generator operates on full conversation (has context)

The fix requires passing conversation history to the router so both components operate on the same information. Additionally, safety checks in the response generator will prevent hallucinated confirmations even if routing errors occur.

**Recommendation**: Implement Fix 1 (PRIMARY) and Fix 2 (SECONDARY) together for complete resolution.
