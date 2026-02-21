# De-Emphasize Communities and Indexes (UX Copy) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Treat community/index association as a background concern. Mention "communities" and "indexes" only when necessary: (i) user needs to sign up to one post-onboarding, (ii) user explicitly asked about them, (iii) user wants to leave one, (iv) an owner changes index settings. Agent narration and errors should avoid phrases like "your current communities"; use scope-neutral language (e.g. "where you're connected") or the index title when context is scoped.

**Architecture:** Copy and prompt changes only — no schema or API changes. Protocol: chat prompt, tool descriptions, and tool error messages. Frontend: keep index as implementation detail; only surface index/community in the four cases above. Agent-facing strings stay technically correct but user-facing and agent-narration strings de-emphasize "community"/"index".

**Tech Stack:** TypeScript (protocol prompts/tools, frontend copy).

---

## Task 1: Chat prompt — onboarding and scope language

- [x] **Done**

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.ts`

**Step 1: Replace "Discover communities" with "Connect to groups" (onboarding)**

In the onboarding section (step 5), change the heading and example so we don't lead with "communities".

- Line ~119: Change "5. **Discover communities**" to "5. **Connect to groups** (only after complete_onboarding has been called)".
- Lines ~121–127: Keep `read_indexes()` and `publicIndexes`; change the example copy from "Here are some communities you might find interesting" to "Here are some groups you might find interesting" and keep the rest (index titles as group names). Change "Want to join any of these?" to keep; add note: "Do not use the word 'community' or 'index' when presenting these; use 'groups' or the group name."
- Line ~149: In "Community discovery is optional", change to "Group discovery is optional".
- Line ~150: "When presenting communities" → "When presenting groups".

**Step 2: Add rule: when to mention indexes/communities**

In the same file, in **Behavioral Rules** or **Output Format**, add a short rule:

- Only mention "community", "communities", "index", or "indexes" when: (i) post-onboarding sign-up to a group, (ii) user explicitly asked about their communities/indexes/groups, (iii) user wants to leave a group, (iv) owner is changing group settings. Otherwise describe scope in neutral language (e.g. "where you're connected", "in this group", or the group title). Never say "your current communities" in narration; prefer "where you're connected" or the specific group name.

**Step 3: Scope and orchestration wording**

- Line ~224: In the intent-creation pattern, "when index-scoped, this shows only intents in this community" → "when this chat is scoped to a group, this shows only intents in that group".
- Line ~230: "Scope note": replace "scoped to a community" with "scoped to a group"; keep the rest.
- Line ~264: "tell user they don't share a community" → "tell user they're not in any shared group".
- Line ~281: "Explore what a community is about" → "Explore what a group is about"; in the steps use "group" instead of "community" in the synthesis line.
- Lines ~307–312 (Index Scope block): Change "this community" to "this group" in the bullet points; keep "index" only where needed for tool/scope enforcement. Add: "In user-facing replies and narration, prefer 'group' or the index title; avoid 'community' and 'index' unless the user asked or the case is one of: sign-up, leave group, or owner settings."

**Step 4: Consolidate summary rule**

- Line ~327: "You're not in any communities" → "You're not in any groups."

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.ts
git commit -m "fix(protocol): de-emphasize community/index in chat prompt copy"
```

---

## Task 2: Protocol tool errors and descriptions — remove "community"

- [x] **Done**

**Files:**
- Modify: `protocol/src/lib/protocol/tools/profile.tools.ts`
- Modify: `protocol/src/lib/protocol/tools/opportunity.tools.ts`
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts`
- Modify: `protocol/src/lib/protocol/support/opportunity.discover.ts`

**Step 1: profile.tools.ts**

- Line ~37: "read profiles from this community" → "read profiles in this group" (use `context.indexName` when available: "read profiles in this group" or "read profiles in [indexName]").
- Line ~80: "read profiles of members in this community" → "read profiles of members in this group" (or index name).

**Step 2: opportunity.tools.ts**

- Line ~170: "You can only create opportunities in this community" → "You can only create opportunities in this group."
- Line ~420: "You can only list opportunities from this community" → "You can only list opportunities from this group."

**Step 3: opportunity.graph.ts**

- Line ~644: "This chat is scoped to a different community. You can only introduce members of the current community." → "This chat is scoped to a different group. You can only introduce people from the current group."
- Lines ~651, ~659: "members of the specified community" / "share an index" → "members of the specified group" / "in the same group".

**Step 4: opportunity.discover.ts**

- Line ~179: "You need to join at least one index (community) to discover opportunities. Use read_indexes to see available indexes, or create one." → "You need to join at least one group to discover opportunities. Use read_indexes to see available groups, or create one." (Tool name read_indexes stays; message is user/agent-facing.)

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/tools/profile.tools.ts protocol/src/lib/protocol/tools/opportunity.tools.ts protocol/src/lib/protocol/graphs/opportunity.graph.ts protocol/src/lib/protocol/support/opportunity.discover.ts
git commit -m "fix(protocol): use 'group' instead of 'community' in tool and graph errors"
```

---

## Task 3: Chat prompt — internal vocabulary and Output Format

- [x] **Done**

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.ts`

**Step 1: Internal vocabulary rule**

In **Output Format** (around line ~316), the rule says "Never use internal vocabulary (intent, index, opportunity, profile) in replies." Extend it:

- Add: "Prefer 'group' over 'community' or 'index' in user-facing text. Only say 'community' or 'index' when the user asked about communities/indexes, or when: post-onboarding sign-up, leaving a group, or owner changing group settings."

**Step 2: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.ts
git commit -m "docs(protocol): extend internal vocabulary rule for community/index"
```

---

## Task 4: Frontend — index/community copy (when to show)

- [x] **Done**

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/components/SharedChatView.tsx`
- Audit (no change if already minimal): `frontend/src/components/chat/OpportunityCardInChat.tsx`, `frontend/src/components/chat/ChatView.tsx`

**Step 1: Sidebar**

- Keep "Create Index" / index creation as-is (owner/create flow). Optionally rename button/label to "New group" if product prefers; otherwise leave and only ensure we don't add new prominent "communities" copy.
- Session list: the small session index title (lines ~305–307) is acceptable as context; no need to say "community". If any tooltip or aria-label says "community", change to "group" or remove.

**Step 2: SharedChatView**

- "Go to Index" / "This is a shared conversation from Index" / "Try Index": these refer to the product name "Index". Leave "Index" as the product name. If any string says "community" (e.g. "from this community"), change to "from this group" or drop. Check lines 64, 79, 117, 139, 145.

**Step 3: OpportunityCardInChat / ChatView**

- Narrator chip "Index" is product name — keep. Ensure no new "community" copy is added. If discovery or intro cards mention "community", change to "group" or neutral wording.

**Step 4: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/components/SharedChatView.tsx
# Add other files only if changed
git commit -m "fix(frontend): de-emphasize community/index in UI copy"
```

---

## Task 5: Smoke check and docs

- [x] **Done**

**Files:**
- Modify: `docs/plans/2026-02-21-de-emphasize-communities-indexes.md` (this file — add "Done" checkboxes after execution)

**Step 1: Grep for remaining user-facing "community"**

Run:

```bash
rg -n "community|communities" -t ts protocol/src frontend/src
```

Review hits: protocol tool errors and prompts should say "group" where user/agent sees them; comments and internal variable names can stay. Fix any missed user-facing strings.

**Step 2: Update plan**

In this doc, add a short "Verification" section: "Grep for community/communities in protocol and frontend; confirm only acceptable uses remain (e.g. comments, or explicit sign-up/leave/settings flows)."

**Step 3: Commit**

```bash
git add docs/plans/2026-02-21-de-emphasize-communities-indexes.md
git commit -m "docs: add verification note for de-emphasize communities plan"
```

---

## Verification

**Execution complete:** Grep for `community|communities` in `protocol/src` and `frontend/src`; confirm only acceptable uses remain (e.g. comments, or explicit sign-up/leave/settings flows). Any user-facing or agent-facing tool errors and prompts were updated to say "group" where appropriate.

- Grep for `community|communities` in `protocol/src` and `frontend/src`: only acceptable uses (comments, or explicit flows: sign-up, leave, owner settings) should remain.
- In chat, trigger a scoped lookup (e.g. "find Brad Burnham"); agent reply should not say "your current communities" — should use "where you're connected", group name, or similar.
- Onboarding step 5: copy should say "groups" and present "groups you might find interesting", not "communities".

---

## Execution handoff

After saving the plan, use **using-git-worktrees** to create a worktree (e.g. `feat/de-emphasize-communities-indexes`), then either:

1. **Subagent-driven (this session)** — Use superpowers:subagent-driven-development; one subagent per task, review between tasks.
2. **Parallel session** — Open a new session in the worktree and use superpowers:executing-plans for batch execution with checkpoints.

Which approach?
