# Hotfix: Router Format Variation Handling

## Problem (Second Issue)

Even after the first router fix, users asking **"Can you show me my profile in a table?"** were STILL getting incorrect responses:

```
"I can definitely show you your profile! However, I don't have the functionality 
to display it in a table format."
```

The router was still routing to `respond` instead of `profile_query`.

## Root Cause Analysis

### Why First Fix Wasn't Enough

The first fix added examples like:
- ✅ "show my profile" → profile_query
- ✅ "what's my profile" → profile_query

But the LLM was **overthinking format variations**:
- ❌ "show my profile **in a table**" → respond (routing failed!)

The LLM thought:
1. "User wants profile data" ✅
2. "But they want it IN A TABLE" 🤔
3. "That's a special formatting request"
4. "Maybe I can't handle that" ❌
5. **Routes to `respond` instead of `profile_query`**

### The Mental Model Problem

The router LLM didn't understand that:
- Routing is about **WHAT data**, not **HOW formatted**
- Query nodes handle formatting - router just identifies intent
- "show X in a table" = "show X" (same routing!)

## Solution

### 1. Made Routing Intent Crystal Clear

**Added explicit section at top of router prompt:**

```typescript
**CRITICAL**: Your job is to route requests to the RIGHT ACTION NODE, not to answer questions yourself!

ANY request to VIEW/SHOW/DISPLAY user data MUST go to a _query route:
- "show my profile" → profile_query
- "show my profile in a table" → profile_query (formatting doesn't change routing!)
- "can you show me my profile" → profile_query  
- "display my profile" → profile_query
- "what's my profile" → profile_query

DON'T route to "respond" for data requests! The query nodes will:
1. Fetch the data
2. Format it however the user wants (table, list, etc.)
3. Display it properly

Your ONLY job: Identify that user wants data → route to correct _query node
```

**Key insight**: Explicitly showed that formatting variations don't change routing!

### 2. Enhanced profile_query Examples

**BEFORE:**
```typescript
3. **profile_query** - READ ONLY: Display profile information
   - Use when: User asks to see their profile
   - Examples: "show my profile", "what's my profile", "view my info"
```

**AFTER:**
```typescript
3. **profile_query** - READ ONLY: Display profile information
   - Use when: User asks to see/view/display their profile (ANY format request!)
   - Examples: 
     * "show my profile"
     * "show my profile in a table"  ← NEW!
     * "can you display my profile"
     * "what's my profile"
     * "view my info"
     * "show me my data"
   - NOTE: Use this route regardless of formatting (table/list/markdown) - it will handle it!
```

### 3. Strengthened `respond` Route Guardrails

**BEFORE:**
```typescript
7. **respond** - Direct conversational response
   - DON'T use for: "show me X" requests (use query routes instead!)
```

**AFTER:**
```typescript
7. **respond** - Direct conversational response
   - NEVER use for:
     * "show me X" → use query routes
     * "display X" → use query routes  
     * "what's my X" → use query routes
     * "can you show X" → use query routes
```

### 4. Added Markdown Table Support

Also updated the **Response Generator** to handle table formatting:

```typescript
## Format
**You MUST format your responses using markdown syntax:**
...
- Use markdown tables when user requests tabular format (| Column | Column | with rows)

When user asks for "table format", create a proper markdown table with pipes and dashes.
```

And updated profile query results formatting:

```typescript
'Task: Present this profile information in the format the user requested.'
'- If user asked for a table, use markdown table format'
'- If user asked for a list, use bullet points'
'- Otherwise, present conversationally with proper markdown formatting'
```

## Test Cases

### Test 1: Profile in Table Format
```
Input: "Can you show me my profile in a table?"
Expected routing: profile_query (operationType: read)
Expected result: Profile displayed in markdown table format
```

### Test 2: Profile (No Format)
```
Input: "show my profile"
Expected routing: profile_query (operationType: read)
Expected result: Profile displayed conversationally
```

### Test 3: Intents in List
```
Input: "list my intents"
Expected routing: intent_query (operationType: read)
Expected result: Intents displayed as list
```

## Files Modified

1. **`protocol/src/lib/protocol/agents/chat/router/chat.router.ts`**
   - Enhanced routing prompt with format variation examples
   - Added explicit "formatting doesn't change routing" guidance
   - Strengthened `respond` route guardrails

2. **`protocol/src/lib/protocol/agents/chat/generator/chat.generator.ts`**
   - Added markdown table support to format section
   - Updated profile query task instructions for format handling

## Key Learnings

### 1. LLM Prompt Engineering for Intent Detection

**Don't assume LLMs understand boundaries:**
- ❌ "route based on what user wants" (too vague)
- ✅ "route based on WHAT data, ignore HOW formatted"

**Show both positive AND negative examples:**
- ✅ "show my profile in a table" → profile_query
- ❌ Don't route to respond just because of formatting

### 2. Separation of Concerns

**Router's job:**
- Identify WHAT user wants (profile? intents? opportunity?)
- Route to appropriate node

**Node's job:**
- Fetch the data
- Format according to request
- Display properly

**Router should NOT worry about:**
- Can I format it?
- Do I have the data?
- Is this request supported?

### 3. Iterative Prompt Refinement

First fix: ✅ Added basic examples
Second fix: ✅ Added format variations
Pattern: LLMs need **explicit coverage** of edge cases

## Prevention Strategies

1. **Test Format Variations**
   - "show X"
   - "show X in a table"
   - "display X as a list"
   - "can you show me X"

2. **Separate Routing from Formatting**
   - Router: identifies intent
   - Nodes: handle formatting
   - Generator: renders format

3. **Explicit Negative Examples**
   - Show what NOT to do
   - Explain why not
   - Redirect to correct behavior

---

**Status**: ✅ Fixed (Round 2)  
**Date**: January 30, 2026  
**Verification**: TypeScript compiles, prompts updated  
**Related**: HOTFIX-router-query-routing.md (Round 1)
