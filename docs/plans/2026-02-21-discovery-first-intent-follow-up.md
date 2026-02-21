# Discovery-First, Intent as Follow-Up — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the chat agent prefer opportunity discovery first for connection-seeking; intent creation is the path only when the user explicitly asks to create/save an intent, or when the tool returns createIntentSuggested.

**Architecture:** Prompt and behavioral-rule changes only in `protocol/src/lib/protocol/agents/chat.prompt.ts`. No schema or API changes. Existing callback in `chat.agent.ts` (createIntentSuggested → create_intent → retry) stays as-is.

**Tech Stack:** TypeScript (chat prompt).

---

## Task 1: Add discovery-first orchestration pattern and renumber

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.ts` (Orchestration Patterns section, ~234–258)

**Step 1: Insert new pattern 1**

Immediately after the line `## Orchestration Patterns` and the line `You compose these primitives. Here's how to handle key scenarios:`, add the following as the first pattern (before the current "### 1. User wants to create an intent"):

```markdown
### 1. User wants to find connections or discover (default for connection-seeking)

For open-ended connection-seeking ("find me a mentor", "who needs a React dev", "I want to meet people in AI"), run **discovery first**.

- Call \`create_opportunities(searchQuery=user's request)\` (with indexId when scoped). Do not call \`create_intent\` first unless the user explicitly asked to create or save an intent.
- If the tool returns \`createIntentSuggested\` and \`suggestedIntentDescription\`, the system will create an intent and retry discovery automatically; use the final result (candidates or "no matches") for your reply.
- If the user **explicitly** says they want to create/save an intent (e.g. "add a priority", "create an intent", "save that I'm looking for X"), use pattern 2 instead.

### 2. User explicitly wants to create or save an intent
```

**Step 2: Renumber existing patterns**

- Change the existing "### 1. User wants to create an intent" heading to "### 2. User explicitly wants to create or save an intent" (if not already done by the block above).
- Change "### 2. User includes a URL" → "### 3. User includes a URL"
- Change "### 3. Update or delete an intent" → "### 4. Update or delete an intent"
- Change "### 4. Find shared context between two users" → "### 5. Find shared context between two users"
- Change "### 5. Introduce two people" → "### 6. Introduce two people"
- Change "### 6. Present opportunities to the user" → "### 7. Present opportunities to the user"
- Change "### 7. Explore what a community is about" → "### 8. Explore what a community is about"
- Continue renumbering any remaining patterns (e.g. 8 → 9).

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.ts
git commit -m "feat(protocol): add discovery-first orchestration pattern and renumber"
```

---

## Task 2: Replace Intent-First Discovery with Discovery-first behavioral rule

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.ts` (Behavioral Rules section, ~334–339)

**Step 1: Replace the Intent-First Discovery block**

Find the block:

```markdown
### Intent-First Discovery
- When user expresses a need/want/priority → create an intent (after vagueness check)
- Intent creation auto-triggers background discovery — tell the user matches will keep coming
- Only call create_opportunities for explicit "find me connections" or introductions between OTHER people
```

Replace it with:

```markdown
### Discovery-first; intent as follow-up
- For connection-seeking (find connections, discover, who's looking for X), use \`create_opportunities(searchQuery=...)\` first. Do not lead with \`create_intent\` unless the user explicitly asks to create or save an intent.
- When the tool returns \`createIntentSuggested\`, the system may create an intent and retry; respond from the final discovery result.
- Only call \`create_opportunities\` for explicit "find me connections" / discovery or for introductions between two other people.
```

**Step 2: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.ts
git commit -m "fix(protocol): discovery-first behavioral rule, intent as follow-up"
```

---

## Task 3: Optional tool-table note for create_opportunities

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.ts` (tool table row for create_opportunities, ~228)

**Step 1: Add optional one-line note**

In the tool table, the row for `create_opportunities` is:

`| **create_opportunities** | searchQuery?, indexId?, partyUserIds?, entities?, hint? | Discovery (query text) or Introduction (partyUserIds + entities + hint) |`

Either keep as-is or append to the description: `Discovery (query) first for connection-seeking; intent creation can be suggested by the tool.` Use your judgment for length; if the table gets too wide, skip this step.

**Step 2: Commit (if changed)**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.ts
git commit -m "docs(protocol): note discovery-first for create_opportunities in tool table"
```

---

## Task 4: Verification and plan doc update

**Files:**
- Modify: `docs/plans/2026-02-21-discovery-first-intent-follow-up.md` (this file)

**Step 1: Smoke check**

- Grep for "Intent-First" in the prompt: should be gone.
- Grep for "Discovery-first" in the prompt: should appear in Behavioral Rules and in the new pattern 1 title.

**Step 2: Add Verification section to this plan**

Append to this file:

```markdown
## Verification

- Chat prompt has "### 1. User wants to find connections or discover" and "### 2. User explicitly wants to create or save an intent".
- Behavioral Rules section has "### Discovery-first; intent as follow-up" with the three bullets above.
- No remaining "Intent-First Discovery" in chat.prompt.ts.
```

**Step 3: Commit**

```bash
git add docs/plans/2026-02-21-discovery-first-intent-follow-up.md
git commit -m "docs: add verification section for discovery-first plan"
```

---

## Verification

- Chat prompt has "### 1. User wants to find connections or discover" and "### 2. User explicitly wants to create or save an intent".
- Behavioral Rules section has "### Discovery-first; intent as follow-up" with the three bullets.
- No remaining "Intent-First Discovery" in chat.prompt.ts.

---

## Execution handoff

Plan is saved to `docs/plans/2026-02-21-discovery-first-intent-follow-up.md`.

**Worktree:** Implementation should be done in the worktree at:

`/Users/aposto/Projects/index/.worktrees/feat-discovery-first-intent-follow-up`

(Branch: `feat/discovery-first-intent-follow-up`. Protocol deps installed; full test run hit a Bun runtime crash in this environment; run tests locally when ready.)

**Two execution options:**

1. **Subagent-driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel session (separate)** — Open a new session in the worktree and use superpowers:executing-plans for batch execution with checkpoints.

Which approach do you want?
