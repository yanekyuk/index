# Router System Prompt Changes

## Issue

Router was misrouting "show my profile" requests to `respond` instead of `profile_query` after the reactive flow refactoring.

## Changes Made

### 1. Added Critical Instruction at Top

**BEFORE:**
```typescript
const systemPrompt = `
You are a Routing Agent for a professional networking platform.

**USE CONTEXT**: Look at conversation history. Don't ask for clarification when context is obvious:
```

**AFTER:**
```typescript
const systemPrompt = `
You are a Routing Agent for a professional networking platform.

**CRITICAL**: Your job is to route requests to the RIGHT ACTION NODE, not to answer questions yourself!
- If user asks "show my profile" → route to profile_query (it will fetch it)
- If user asks "show my intents" → route to intent_query (it will fetch them)
- DON'T route to "respond" just because you don't have the data in context
- The action nodes will handle fetching data - you just route correctly!

**USE CONTEXT**: Look at conversation history. Don't ask for clarification when context is obvious:
```

**Why**: Makes it crystal clear that the router's job is to route to the correct node, not to worry about whether data exists.

---

### 2. Enhanced Query Route Descriptions

**BEFORE:**
```typescript
## Routing Options

1. **intent_query** - READ ONLY: Fetch and display existing intents
   - Use when: User asks questions about their intents
   - operationType: "read"
   
2. **intent_write** - WRITE: Create, update, or delete intents
   - Use when: User states new goals, updates, or deletions
   - operationType: "create" | "update" | "delete"

3. **profile_query** - READ ONLY: Display profile information
   - Use when: User asks about their profile
   - operationType: "read"

4. **profile_write** - WRITE: Update profile data
   - Use when: User wants to modify their profile
   - operationType: "update"
```

**AFTER:**
```typescript
## Routing Options

**IMPORTANT: Route to _query and _write targets even if you don't have the data yet - they will fetch it!**

1. **intent_query** - READ ONLY: Fetch and display existing intents
   - Use when: User asks questions/wants to see their intents
   - Examples: "show my intents", "what are my goals", "list my intentions"
   - operationType: "read"
   - NOTE: Use this even if you don't have intent data - it will fetch it!
   
2. **intent_write** - WRITE: Create, update, or delete intents
   - Use when: User states new goals, updates, or deletions
   - operationType: "create" | "update" | "delete"

3. **profile_query** - READ ONLY: Display profile information
   - Use when: User asks to see their profile
   - Examples: "show my profile", "what's my profile", "view my info"
   - operationType: "read"
   - NOTE: Use this even if you don't have profile data - it will fetch it!

4. **profile_write** - WRITE: Update profile data
   - Use when: User wants to modify their profile
   - operationType: "update"
```

**Why**: 
- Added explicit note at top: "Route even if you don't have the data"
- Added concrete examples for each query route
- Added NOTE reminders that query routes will fetch data

---

### 3. Clarified `respond` Route Usage

**BEFORE:**
```typescript
7. **respond** - Direct conversational response
   - Use when: General conversation or system questions
   - No operationType needed
```

**AFTER:**
```typescript
7. **respond** - Direct conversational response
   - Use when: General conversation, greetings, or questions ABOUT the system
   - Examples: "hello", "how does this work", "what can you do"
   - DON'T use for: "show me X" requests (use query routes instead!)
   - No operationType needed
```

**Why**: 
- Added examples of what `respond` IS for
- Added explicit negative example (DON'T use for "show me X")
- Prevents confusion between conversational responses and data queries

---

## Impact

### Before Changes (Broken)
```
User: "show my profile"
Router thinks: "I don't have profile data in context"
Router decision: respond (confidence: 0.6)
Result: ❌ "I can't show your profile in this chat interface..."
```

### After Changes (Fixed)
```
User: "show my profile"
Router thinks: "User wants to see profile → use profile_query"
Router decision: profile_query (operationType: read, confidence: 0.9)
Flow: profile_query → fetches profile → displays it
Result: ✅ Profile displayed correctly
```

---

## Lessons Learned

### 1. LLM Prompt Engineering for Routing
- Be explicit about what each component's JOB is
- Clarify boundaries: "You route, the nodes fetch"
- Use examples liberally (both positive and negative)

### 2. Context-Free Routing
When a router runs without full context:
- ✅ DO: Make routing decisions based on user intent
- ❌ DON'T: Avoid actions because "I don't have the data"
- ✅ DO: Trust downstream nodes to handle data fetching
- ❌ DON'T: Try to answer questions that data nodes should handle

### 3. Testing Edge Cases
- Test routing with minimal context
- Test routing with no context
- Test after architectural changes that affect data flow

---

## Verification Checklist

- [x] TypeScript compiles without errors
- [x] No linter errors
- [x] System prompt is clearer about routing vs answering
- [x] Query routes have explicit "will fetch data" notes
- [x] `respond` route has negative examples
- [x] Documentation created for the fix

---

**File Modified**: `protocol/src/lib/protocol/agents/chat/router/chat.router.ts`  
**Lines Changed**: ~30 (system prompt enhancements)  
**Status**: ✅ Complete
