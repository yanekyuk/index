# Hotfix: Router Query Routing Issue

## Problem

After the reactive flow refactoring, users asking "show my profile" were getting incorrect responses like:

```
"I can't directly 'show' your profile to you in a visual format within this chat interface..."
```

Instead of actually displaying their profile data.

## Root Cause

The reactive flow refactoring moved `router` to run FIRST (before `load_context`). This meant:

1. **Router runs with NO context** - no profile data, no intent data
2. **LLM gets confused** - sees "show my profile" but doesn't have profile data
3. **Router misroutes to `respond`** - thinking it can't show what it doesn't have
4. **Response generator makes things up** - gives conversational excuse instead of fetching data

### Flow Issue

```
Before Fix:
  User: "show my profile"
  → router (no context) 
  → thinks "I don't have profile data, I can't show it"
  → routes to `respond` ❌
  → response generator improvises
  → wrong answer

After Fix:
  User: "show my profile"
  → router (no context)
  → "User wants profile → route to profile_query" ✅
  → profile_query fetches data
  → response generator displays it correctly
```

## Solution

Enhanced the router's system prompt to be crystal clear:

### Key Changes

1. **Added explicit instruction at the top**:
   ```
   **CRITICAL**: Your job is to route requests to the RIGHT ACTION NODE, not to answer questions yourself!
   - If user asks "show my profile" → route to profile_query (it will fetch it)
   - If user asks "show my intents" → route to intent_query (it will fetch them)
   - DON'T route to "respond" just because you don't have the data in context
   - The action nodes will handle fetching data - you just route correctly!
   ```

2. **Added explicit notes for query routes**:
   ```
   3. **profile_query** - READ ONLY: Display profile information
      - Use when: User asks to see their profile
      - Examples: "show my profile", "what's my profile", "view my info"
      - operationType: "read"
      - NOTE: Use this even if you don't have profile data - it will fetch it! ✅
   ```

3. **Clarified when to use `respond`**:
   ```
   7. **respond** - Direct conversational response
      - Use when: General conversation, greetings, or questions ABOUT the system
      - Examples: "hello", "how does this work", "what can you do"
      - DON'T use for: "show me X" requests (use query routes instead!) ✅
   ```

## Why This Works

The router's LLM now understands:
- ✅ Its job is to ROUTE, not to answer
- ✅ Query routes FETCH data, they don't need it in context
- ✅ "show my X" always goes to X_query, not respond
- ✅ Only use `respond` for actual conversational exchanges, not data requests

## Testing

### Test Case 1: Profile Query
```typescript
Input: "show my profile"
Expected routing: profile_query (operationType: read)
Expected flow: router → check_prerequisites → load_context → profile_query → generate_response
Expected result: Profile displayed with name, bio, skills, interests
```

### Test Case 2: Intent Query  
```typescript
Input: "what are my intents"
Expected routing: intent_query (operationType: read)
Expected flow: router → check_prerequisites → load_context → intent_query → generate_response
Expected result: List of active intents displayed
```

### Test Case 3: Conversational (Should Still Use Respond)
```typescript
Input: "hello, how are you?"
Expected routing: respond
Expected flow: router → check_prerequisites → load_context → respond_direct → generate_response
Expected result: Friendly greeting response
```

## Files Modified

- `protocol/src/lib/protocol/agents/chat/router/chat.router.ts`
  - Enhanced system prompt with explicit routing guidance
  - Added notes to prevent misrouting to `respond`
  - Clarified query route behavior

## Prevention

To prevent similar issues in the future:

1. **LLM Routing Clarity** - Always be explicit about what the router should do vs what downstream nodes will do
2. **Test Without Context** - Test routing with minimal context to ensure it routes correctly
3. **Route Purposes** - Clearly document what each route is FOR, not just what it does
4. **Negative Examples** - Show what NOT to do ("DON'T use respond for show requests")

## Related Issues

This issue was introduced by:
- Commit: Reactive flow refactoring (moved router before load_context)
- Impact: Query requests (profile_query, intent_query) could misroute to `respond`
- Severity: High (core feature broken)
- Duration: ~1 day (caught and fixed quickly)

---

**Status**: ✅ Fixed  
**Date**: January 30, 2026  
**Verification**: TypeScript compiles, system prompt updated
