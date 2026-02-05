# CRITICAL HOTFIX: Prerequisites Check Hijacking User Requests

## Problem (Third Issue - The Big One)

The reactive flow refactoring introduced a **critical bug** where the prerequisites check was **hijacking explicit user requests**!

### User Experience
```
User: "Can you show me my profile in a table?"

System Flow:
1. ROUTER ✅ → "showing your profile" (correct!)
2. CHECK_PREREQUISITES → "user has profile but no intents"
3. ❌ SUGGEST_INTENTS → Ignores user request, suggests intents instead!

User gets: Intent suggestions instead of their profile!
```

### The Broken Flow

```
User asks: "show my profile"
         ↓
      ROUTER  
  "route to profile_query" ✅
         ↓
CHECK_PREREQUISITES
 "has profile but no intents"
         ↓
   ❌ HIJACKS REQUEST
         ↓
  SUGGEST_INTENTS
 (ignores router decision!)
         ↓
   User gets intent suggestions
   instead of their profile! ❌
```

## Root Cause

The `prerequisitesCondition` function was **too aggressive** in enforcing onboarding. It checked:

### Before (Broken):
```typescript
const prerequisitesCondition = (state) => {
  // Missing profile → onboarding
  if (!state.hasCompleteProfile) {
    return "profile_write";
  }
  
  // Has profile but no intents → ALWAYS suggest intents ❌
  if (!state.hasActiveIntents) {
    return "suggest_intents";  // BUG: Ignores user's explicit request!
  }
  
  // Both exist → proceed
  return "load_context";
};
```

**The bug:** When user has profile but no intents, it ALWAYS routes to `suggest_intents`, **completely ignoring what the user actually asked for!**

This means:
- ❌ "show my profile" → intent suggestions (wrong!)
- ❌ "what are my intents" → intent suggestions (wrong!)
- ❌ "find me opportunities" → intent suggestions (wrong!)

The prerequisites check became a **gatekeeper that blocked everything** unless user had intents!

## Solution

Make the prerequisites check **respect explicit user requests**:

### After (Fixed):
```typescript
const prerequisitesCondition = (state) => {
  const routingTarget = state.routingDecision?.target;
  
  // Check if user made an explicit request for data
  const hasExplicitRequest = routingTarget && (
    routingTarget === 'profile_query' ||
    routingTarget === 'intent_query' ||
    routingTarget === 'opportunity_subgraph'
  );
  
  // If profile incomplete, enforce onboarding
  // EXCEPT: Allow profile_query to show what they have
  if (!state.hasCompleteProfile && routingTarget !== 'profile_query') {
    return "profile_write";
  }
  
  // If user made an explicit request, HONOR IT ✅
  if (hasExplicitRequest) {
    log.info("[ChatGraph:PrerequisitesCondition] Explicit request detected, proceeding");
    return "load_context";  // Let the router's decision execute!
  }
  
  // Only suggest intents for GENERAL conversation (no explicit request)
  if (!state.hasActiveIntents) {
    return "suggest_intents";
  }
  
  return "load_context";
};
```

### Key Changes

1. **Detect Explicit Requests**
   ```typescript
   const hasExplicitRequest = routingTarget && (
     routingTarget === 'profile_query' ||
     routingTarget === 'intent_query' ||
     routingTarget === 'opportunity_subgraph'
   );
   ```

2. **Honor Explicit Requests**
   ```typescript
   if (hasExplicitRequest) {
     return "load_context";  // Execute the router's decision!
   }
   ```

3. **Only Suggest Intents for General Conversation**
   - "Hello" → suggest intents ✅
   - "What can I do?" → suggest intents ✅
   - "Show my profile" → execute profile_query ✅

## Fixed Flow

```
User asks: "show my profile"
         ↓
      ROUTER  
  "route to profile_query" ✅
         ↓
CHECK_PREREQUISITES
 "has profile but no intents"
 "BUT user made explicit request!"
         ↓
   ✅ RESPECTS REQUEST
         ↓
    LOAD_CONTEXT
         ↓
   PROFILE_QUERY
         ↓
   Shows profile! ✅
```

## When Prerequisites Check Acts

### Enforces Onboarding (Blocks Request)
```
User: "Hello" (no explicit request)
Prerequisites: "No profile" → profile_write ✅

User: "Hello" (no explicit request)  
Prerequisites: "Profile exists, no intents" → suggest_intents ✅
```

### Respects Explicit Requests (Allows Through)
```
User: "Show my profile"
Prerequisites: "Explicit request for profile_query" → load_context → profile_query ✅

User: "What are my intents"
Prerequisites: "Explicit request for intent_query" → load_context → intent_query ✅

User: "Find opportunities"
Prerequisites: "Explicit request for opportunity_subgraph" → load_context → opportunity ✅
```

## Test Cases

### Test 1: Explicit Profile Query (No Intents)
```
Input: "show my profile"
State: { hasCompleteProfile: true, hasActiveIntents: false }
Router: profile_query

Expected: load_context → profile_query → show profile ✅
NOT: suggest_intents ❌
```

### Test 2: Explicit Intent Query (No Intents)
```
Input: "what are my intents"
State: { hasCompleteProfile: true, hasActiveIntents: false }
Router: intent_query

Expected: load_context → intent_query → show "no intents" ✅
NOT: suggest_intents ❌
```

### Test 3: General Conversation (No Intents)
```
Input: "hello"
State: { hasCompleteProfile: true, hasActiveIntents: false }
Router: respond

Expected: suggest_intents → intent suggestions ✅
Correct: No explicit request, so suggest intents
```

### Test 4: Profile Query (With Intents)
```
Input: "show my profile"
State: { hasCompleteProfile: true, hasActiveIntents: true }
Router: profile_query

Expected: load_context → profile_query → show profile ✅
```

## Architecture Lesson

### The Prerequisite Paradox

**Problem:** How do you enforce onboarding without blocking legitimate requests?

**Wrong Approach (What I Did Initially):**
```
if (user_missing_something) {
  force_onboarding();  // Blocks EVERYTHING
}
```

**Right Approach (What It Should Be):**
```
if (user_missing_something && !explicit_request) {
  suggest_onboarding();
} else if (explicit_request) {
  honor_request();  // Even if missing things
}
```

### Design Principles

1. **Explicit Requests Take Priority**
   - User asks for X → give them X
   - Even if setup isn't complete
   - Honor user intent above all

2. **Onboarding for Ambiguity**
   - Only suggest onboarding for general conversation
   - "Hello" → suggest profile creation ✅
   - "Show profile" → show what they have ✅

3. **Graceful Degradation**
   - No intents? Show empty list, offer to create
   - Incomplete profile? Show what they have, offer to complete
   - Don't block, guide

## Files Modified

- `protocol/src/lib/protocol/graphs/chat/chat.graph.ts`
  - Fixed `prerequisitesCondition` to respect explicit requests
  - Updated flow documentation

## Related Issues

This is the **third and most critical** issue in the reactive flow refactoring:

1. **First Issue:** Router routing to `respond` instead of query routes
   - Fix: Enhanced router system prompt
   
2. **Second Issue:** Router confused by format variations ("in a table")
   - Fix: Added explicit format examples to router
   
3. **Third Issue:** Prerequisites check hijacking explicit requests ⚠️
   - Fix: Made prerequisites check respect explicit requests
   - **This was the root cause of the user experience breaking**

## Prevention

### Testing Checklist for Future Changes

When modifying flow control:

- [ ] Test with explicit requests (show X, what are X)
- [ ] Test with general conversation (hello, what can I do)
- [ ] Test with missing prerequisites (no profile, no intents)
- [ ] Verify routing decisions are honored
- [ ] Check that onboarding doesn't block legitimate requests

### Design Checklist

When adding gates/checks:

- [ ] Does this respect explicit user requests?
- [ ] Does this only activate for ambiguous cases?
- [ ] Can users still access their data if partially set up?
- [ ] Does this fail gracefully?

---

**Status**: ✅ Fixed  
**Severity**: CRITICAL (broke core UX)  
**Date**: January 30, 2026  
**Impact**: User requests were being hijacked and ignored  
**Resolution**: Prerequisites check now respects explicit requests
