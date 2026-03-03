# Post-Opportunity Intent Signal Suggestion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After discovery returns results, if the user has no related intent, the agent asks if they'd like to create a signal; if they agree, the agent proposes an intent via the standard `create_intent` flow.

**Architecture:** Two small changes — (1) `opportunity.tools.ts` returns a `suggestIntentCreationForVisibility` flag in the discovery success response, (2) `chat.prompt.ts` instructs the agent to ask the user and, on agreement, call `create_intent` exactly as it would for an explicit intent creation request.

**Tech Stack:** TypeScript, Bun, LangChain (chat agent + tools)

---

### Task 1: Add `suggestIntentCreationForVisibility` flag to the discovery success response

**Context:** When `create_opportunities` runs in discovery mode and finds results, return two extra fields so the agent knows to offer intent creation. The no-results path (`createIntentSuggested`) is untouched.

**Files:**
- Modify: `protocol/src/lib/protocol/tools/opportunity.tools.ts:564-573`

**Step 1: Locate the discovery success return**

Open `opportunity.tools.ts`. Find the final `return success({...})` in the discovery path — the one that runs after `opportunityBlocks` is built. It currently looks like:

```typescript
return success({
  found: true,
  count: result.count,
  message,
  ...(result.existingConnections?.length ? { existingConnections: result.existingConnections } : {}),
  ...(result.pagination ? { pagination: result.pagination } : {}),
  debugSteps: allDebugSteps,
});
```

**Step 2: Add the flag**

Replace that return with:

```typescript
return success({
  found: true,
  count: result.count,
  message,
  ...(result.existingConnections?.length ? { existingConnections: result.existingConnections } : {}),
  ...(result.pagination ? { pagination: result.pagination } : {}),
  debugSteps: allDebugSteps,
  ...(searchQuery
    ? {
        suggestIntentCreationForVisibility: true,
        suggestedIntentDescription: searchQuery,
      }
    : {}),
});
```

The spread guard (`searchQuery` non-empty) ensures the flag is only included for real discovery queries, not programmatic calls with no query text.

**Step 3: Verify no TypeScript errors**

```bash
cd protocol && bun run lint
```

Expected: no new errors.

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/tools/opportunity.tools.ts
git commit -m "feat(tools): return suggestIntentCreationForVisibility flag after discovery results"
```

---

### Task 2: Instruct the agent to handle the flag

**Context:** Two places in `chat.prompt.ts` need updating — the Pattern 1 description (the orchestration recipe) and the behavioural rules section (the always-on constraints). Both must be consistent.

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.ts`

**Step 1: Update Pattern 1 (discovery orchestration recipe)**

Find this block (around line 256–261):

```
- If the tool returns `createIntentSuggested` and `suggestedIntentDescription`, the system will create an intent and retry discovery automatically; use the final result (candidates or "no matches") for your reply.
- If the user **explicitly** says they want to create/save an intent (e.g. "add a priority", "create an intent", "save that I'm looking for X", "remember this"), use pattern 2 instead.
```

Add a new bullet directly after the `createIntentSuggested` line:

```
- If the tool returns `suggestIntentCreationForVisibility: true` and `suggestedIntentDescription`, after presenting the opportunity cards ask the user whether they'd also like to create a signal so others can find them. If they agree, call `create_intent(description=suggestedIntentDescription)` and include the returned \`\`\`intent_proposal block verbatim — this is the same proposal flow as explicit intent creation; the user approves or skips via the card.
```

**Step 2: Update the "Discovery-first; intent as follow-up" behavioural rule**

Find this block (around line 358–361):

```
### Discovery-first; intent as follow-up
- For connection-seeking (find connections, discover, who's looking for X), use `create_opportunities(searchQuery=...)` first. Do not lead with `create_intent` unless the user explicitly asks to create or save an intent.
- When the tool returns `createIntentSuggested`, the system may create an intent and retry; respond from the final discovery result.
- Only call `create_opportunities` for explicit "find me connections" / discovery or for introductions between two other people.
```

Add a bullet after the `createIntentSuggested` line:

```
- When the tool returns `suggestIntentCreationForVisibility: true`, after showing results ask the user if they'd like to create a signal so others can find them. If they agree, call `create_intent(description=suggestedIntentDescription)` and include the `intent_proposal` block.
```

**Step 3: Verify no TypeScript errors**

```bash
cd protocol && bun run lint
```

Expected: no new errors (this file has no compiled output, but the linter still catches syntax issues).

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.ts
git commit -m "feat(prompt): ask about signal creation after discovery returns results"
```

---

### Task 3: Smoke-test the end-to-end behaviour

There is no automated test for LLM-driven conversational behaviour; verify manually.

**Step 1: Start the protocol server**

```bash
cd protocol && bun run dev
```

**Step 2: Open the chat UI and send a discovery query**

Example: *"I'm looking for investors for my game project"*

Expected sequence in the response:
1. A `> Finding…` narration blockquote
2. One or more `opportunity` code blocks rendered as cards
3. A follow-up sentence asking whether the user also wants to create a signal (e.g. *"Would you also like to create a signal for this so investors can find you?"*)

**Step 3: Reply "Yes"**

Expected:
- Agent calls `create_intent` (visible in the narration or debug panel)
- An `intent_proposal` card appears for the user to approve or skip

**Step 4: Verify the no-results path is unchanged**

Send a query that yields no results (e.g. a very obscure request in a small index).

Expected: the existing `createIntentSuggested` auto-creation path fires as before — no signal-suggestion question is asked.

**Step 5: Verify an explicit "Create intent" request is unchanged**

Type: *"Create intent: looking for a co-founder"*

Expected: agent immediately calls `create_intent` and returns a proposal card — no change in behaviour.
