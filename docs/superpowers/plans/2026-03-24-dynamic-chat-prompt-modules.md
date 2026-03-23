# Dynamic Chat Prompt Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the chat agent system prompt into a lean always-present core and conditional modules injected at runtime based on tool call history, user message patterns, and conversation context.

**Architecture:** `buildSystemContent(ctx)` becomes `buildSystemContent(ctx, iterCtx?)` which assembles core + scoping + onboarding + resolved modules. A new `chat.prompt.modules.ts` file defines 10 modules with trigger-based resolution. `chat.agent.ts` extracts tool call history from messages and passes it as `IterationContext`.

**Tech Stack:** TypeScript, LangChain BaseMessage types, Bun test, Smartest (LLM verification framework)

**Spec:** `docs/superpowers/specs/2026-03-24-dynamic-chat-prompt-modules-design.md`

---

### Task 1: Run regression baseline

**Files:**
- Read: `protocol/src/lib/protocol/graphs/tests/chat.graph.invoke.spec.ts`

Capture the current pass/fail state of existing chat tests before any changes. This is the baseline we must match after the refactor.

- [ ] **Step 1: Run existing chat graph invoke tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/chat.graph.invoke.spec.ts`
Expected: Note which tests pass/fail and their count. Save this output — it is the regression baseline.

- [ ] **Step 2: Run existing chat graph streaming tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/chat.graph.streaming.spec.ts`
Expected: Note pass/fail state.

- [ ] **Step 3: Run existing chat graph scope tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/chat.graph.scope.spec.ts`
Expected: Note pass/fail state.

---

### Task 2: Create module types and `extractRecentToolCalls`

**Files:**
- Create: `protocol/src/lib/protocol/agents/chat.prompt.modules.ts`
- Test: `protocol/src/lib/protocol/agents/chat.prompt.modules.spec.ts`

Start with the types, the extraction utility, and the resolution function — no modules yet. TDD.

- [ ] **Step 1: Write failing test for `extractRecentToolCalls`**

Create `protocol/src/lib/protocol/agents/chat.prompt.modules.spec.ts`:

```typescript
/** Config */
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, test, expect } from "bun:test";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

import { extractRecentToolCalls } from "./chat.prompt.modules";

describe("extractRecentToolCalls", () => {
  test("returns empty array when no tool calls in messages", () => {
    const messages = [new HumanMessage("hello")];
    const result = extractRecentToolCalls(messages);
    expect(result).toEqual([]);
  });

  test("returns tool calls from most recent AI message", () => {
    const messages = [
      new HumanMessage("find me a mentor"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc1", name: "create_opportunities", args: { searchQuery: "mentor" }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc1", content: "results...", name: "create_opportunities" }),
    ];
    const result = extractRecentToolCalls(messages);
    expect(result).toEqual([{ name: "create_opportunities", args: { searchQuery: "mentor" } }]);
  });

  test("collects tool calls from ALL AI messages since last HumanMessage", () => {
    const messages = [
      new HumanMessage("find me a mentor"),
      // Iteration 1: agent calls read_user_profiles
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc1", name: "read_user_profiles", args: {}, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc1", content: "profile data", name: "read_user_profiles" }),
      // Iteration 2: agent calls create_opportunities
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc2", name: "create_opportunities", args: { searchQuery: "mentor" }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc2", content: "results...", name: "create_opportunities" }),
    ];
    const result = extractRecentToolCalls(messages);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(["read_user_profiles", "create_opportunities"]);
  });

  test("resets scope on new HumanMessage", () => {
    const messages = [
      new HumanMessage("first question"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc1", name: "read_intents", args: {}, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc1", content: "old intents", name: "read_intents" }),
      // New user turn
      new HumanMessage("second question"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc2", name: "create_intent", args: { description: "test" }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc2", content: "created", name: "create_intent" }),
    ];
    const result = extractRecentToolCalls(messages);
    // Only create_intent from after the second HumanMessage
    expect(result).toEqual([{ name: "create_intent", args: { description: "test" } }]);
  });

  test("handles AI message with multiple parallel tool calls", () => {
    const messages = [
      new HumanMessage("introduce Alice and Bob"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc1", name: "read_user_profiles", args: { userId: "alice" }, type: "tool_call" },
          { id: "tc2", name: "read_user_profiles", args: { userId: "bob" }, type: "tool_call" },
          { id: "tc3", name: "read_index_memberships", args: { userId: "alice" }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc1", content: "alice profile", name: "read_user_profiles" }),
      new ToolMessage({ tool_call_id: "tc2", content: "bob profile", name: "read_user_profiles" }),
      new ToolMessage({ tool_call_id: "tc3", content: "alice memberships", name: "read_index_memberships" }),
    ];
    const result = extractRecentToolCalls(messages);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ name: "read_user_profiles", args: { userId: "alice" } });
    expect(result[2]).toEqual({ name: "read_index_memberships", args: { userId: "alice" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/lib/protocol/agents/chat.prompt.modules.spec.ts`
Expected: FAIL — `extractRecentToolCalls` not found.

- [ ] **Step 3: Implement types and `extractRecentToolCalls`**

Create `protocol/src/lib/protocol/agents/chat.prompt.modules.ts`:

```typescript
import type { BaseMessage } from "@langchain/core/messages";
import type { AIMessage } from "@langchain/core/messages";

import type { ResolvedToolContext } from "../tools";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A conditional prompt section injected into the system prompt based on triggers.
 */
export interface PromptModule {
  /** Unique module identifier. */
  id: string;
  /** Tool names that activate this module. */
  triggers: string[];
  /** Module IDs to suppress when this module activates (unidirectional). */
  excludes?: string[];
  /** Optional filter applied after tool trigger match. Return false to skip despite trigger match. */
  triggerFilter?: (iterCtx: IterationContext) => boolean;
  /** User message pattern that activates this module (secondary trigger). */
  regex?: RegExp;
  /** Context predicate that activates this module (tertiary trigger). */
  context?: (ctx: ResolvedToolContext) => boolean;
  /** Returns the prompt text to inject. */
  content: (ctx: ResolvedToolContext) => string;
}

/**
 * State available to module resolution at each iteration.
 */
export interface IterationContext {
  /** Tool calls from all iterations since the last user message. */
  recentTools: Array<{ name: string; args: Record<string, unknown> }>;
  /** Text of the latest user message (for regex matching). */
  currentMessage?: string;
  /** Resolved tool context (user, profile, indexes, etc.). */
  ctx: ResolvedToolContext;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extracts tool calls from all AI messages since the last HumanMessage.
 *
 * Scans backwards to find the last HumanMessage, then collects all tool calls
 * from AIMessages after that point. This ensures multi-iteration tool history
 * is available for module resolution within a single user turn.
 *
 * @param messages - The current conversation message array
 * @returns Flattened array of tool name + args from the current agent turn
 */
export function extractRecentToolCalls(
  messages: BaseMessage[],
): Array<{ name: string; args: Record<string, unknown> }> {
  // Find the index of the last HumanMessage
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]._getType() === "human") {
      lastHumanIdx = i;
      break;
    }
  }

  // Collect tool calls from all AIMessages after the last HumanMessage
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const startIdx = lastHumanIdx + 1;

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i];
    if (msg._getType() === "ai") {
      const aiMsg = msg as AIMessage;
      const calls = aiMsg.tool_calls ?? [];
      for (const tc of calls) {
        toolCalls.push({
          name: tc.name,
          args: (tc.args ?? {}) as Record<string, unknown>,
        });
      }
    }
  }

  return toolCalls;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/lib/protocol/agents/chat.prompt.modules.spec.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.modules.ts protocol/src/lib/protocol/agents/chat.prompt.modules.spec.ts
git commit -m "refactor(chat): add PromptModule types and extractRecentToolCalls utility"
```

---

### Task 3: Implement `resolveModules` with empty registry

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.modules.ts`
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.modules.spec.ts`

Add `resolveModules` and the module registry, but with no modules registered yet. This tests the resolution engine in isolation.

- [ ] **Step 1: Write failing tests for `resolveModules`**

Append to `chat.prompt.modules.spec.ts`:

```typescript
import { resolveModules, type IterationContext } from "./chat.prompt.modules";

// Minimal mock for ResolvedToolContext — only fields needed by resolution logic
function mockCtx(overrides: Partial<{ indexId: string; isOwner: boolean; isOnboarding: boolean }> = {}): any {
  return {
    userId: "test-user",
    userEmail: "test@example.com",
    userName: "Test User",
    user: {},
    userProfile: {},
    userIndexes: [],
    scopedIndex: null,
    scopedMembershipRole: null,
    indexId: overrides.indexId ?? null,
    indexName: null,
    isOwner: overrides.isOwner ?? false,
    isOnboarding: overrides.isOnboarding ?? false,
    hasName: true,
  };
}

describe("resolveModules", () => {
  test("returns empty string when no tools, no regex match, no context match", () => {
    const iterCtx: IterationContext = {
      recentTools: [],
      currentMessage: "hello",
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toBe("");
  });

  test("returns empty string when isOnboarding is true (modules skipped)", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "create_opportunities", args: {} }],
      currentMessage: undefined,
      ctx: mockCtx({ isOnboarding: true }),
    };
    const result = resolveModules(iterCtx);
    expect(result).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/lib/protocol/agents/chat.prompt.modules.spec.ts`
Expected: FAIL — `resolveModules` not found.

- [ ] **Step 3: Implement `resolveModules` and empty registry**

Add to `chat.prompt.modules.ts`:

```typescript
// ═══════════════════════════════════════════════════════════════════════════════
// MODULE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

/** All registered prompt modules. Populated in subsequent tasks. */
export const PROMPT_MODULES: PromptModule[] = [];

// ═══════════════════════════════════════════════════════════════════════════════
// RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolves which prompt modules should be injected for the current iteration.
 *
 * Phase 1: Collect candidate modules by checking triggers, regex, and context.
 * Phase 2: Apply exclusions (unidirectional — the excluding module stays).
 * Phase 3: Skip all modules when onboarding is active.
 *
 * @param iterCtx - Current iteration context (tool history, user message, resolved context)
 * @returns Concatenated prompt text from all matched modules
 */
export function resolveModules(iterCtx: IterationContext): string {
  // Phase 3 (early exit): Skip all modules during onboarding
  if (iterCtx.ctx.isOnboarding) {
    return "";
  }

  const toolNames = new Set(iterCtx.recentTools.map((t) => t.name));

  // Phase 1: Collect candidates
  const candidates = new Map<string, PromptModule>();

  for (const mod of PROMPT_MODULES) {
    let matched = false;

    // Check tool triggers (with optional filter for arg-based disambiguation)
    if (mod.triggers.length > 0 && mod.triggers.some((t) => toolNames.has(t))) {
      matched = mod.triggerFilter ? mod.triggerFilter(iterCtx) : true;
    }

    // Check regex trigger
    if (!matched && mod.regex && iterCtx.currentMessage && mod.regex.test(iterCtx.currentMessage)) {
      matched = true;
    }

    // Check context predicate
    if (!matched && mod.context && mod.context(iterCtx.ctx)) {
      matched = true;
    }

    if (matched) {
      candidates.set(mod.id, mod);
    }
  }

  // Phase 2: Apply exclusions
  for (const mod of candidates.values()) {
    if (mod.excludes) {
      for (const excludedId of mod.excludes) {
        candidates.delete(excludedId);
      }
    }
  }

  // Build output
  const sections: string[] = [];
  for (const mod of candidates.values()) {
    sections.push(`\n## Context: ${mod.id}\n\n${mod.content(iterCtx.ctx)}`);
  }
  return sections.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/lib/protocol/agents/chat.prompt.modules.spec.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.modules.ts protocol/src/lib/protocol/agents/chat.prompt.modules.spec.ts
git commit -m "refactor(chat): add resolveModules engine with empty registry"
```

---

### Task 4: Extract core prompt into `buildCore`

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.ts`

Refactor `buildSystemContent` to separate core content from pattern content. This is a pure extraction — no content changes, no new functionality. The function still returns the exact same string.

- [ ] **Step 1: Read the full current `chat.prompt.ts`**

Read `protocol/src/lib/protocol/agents/chat.prompt.ts` in full. Identify the boundaries between:
- Core content (mission through tools table, architecture, output format, narration, general rules)
- Scoping content (the `ctx.indexId` conditional block)
- Onboarding content (the `ctx.isOnboarding` conditional block)
- Pattern content (Patterns 0-10, behavioral rules tied to specific patterns)

Refer to the spec's Content Split table (`docs/superpowers/specs/2026-03-24-dynamic-chat-prompt-modules-design.md`, lines 88-104) for the exact breakdown.

- [ ] **Step 2: Refactor `buildSystemContent` into `buildCore` + `buildScoping` + `buildOnboarding` + patterns**

Restructure `chat.prompt.ts`:

1. Create `function buildCore(ctx: ResolvedToolContext): string` — contains mission, voice, banned vocab, session context JSON, preloaded context policy, architecture philosophy, entity model, tools reference table, core routing rules (discovery-first extracted from Pattern 1), when to mention community, internal errors, narration style, output format, general behavioral rules.

2. Create `function buildScoping(ctx: ResolvedToolContext): string` — the index scoping block. Returns the scoped variant when `ctx.indexId` is truthy, the scopeless variant when falsy. Includes owner line when `ctx.isOwner && ctx.indexId`.

3. Create `function buildOnboarding(ctx: ResolvedToolContext): string` — the onboarding block. Returns the full onboarding flow when `ctx.isOnboarding`, empty string otherwise. This is already conditional — just extract it into its own function.

4. Create `function buildPatterns(ctx: ResolvedToolContext): string` — temporarily holds ALL pattern content (Patterns 0-10 + their behavioral rules). This is a staging area that will be emptied as modules are created in Task 5.

5. Update `buildSystemContent` to compose them:

```typescript
export function buildSystemContent(ctx: ResolvedToolContext, iterCtx?: IterationContext): string {
  const core = buildCore(ctx);
  const scoping = buildScoping(ctx);
  const onboarding = buildOnboarding(ctx);
  const modules = iterCtx ? resolveModules(iterCtx) : "";
  const patterns = buildPatterns(ctx);  // Temporary — shrinks as modules are added
  return core + scoping + onboarding + modules + patterns;
}
```

Import `resolveModules` and `IterationContext` from `./chat.prompt.modules`.

**CRITICAL: The output of `buildSystemContent(ctx)` (without `iterCtx`) must be byte-for-byte identical to the current output.** This ensures zero behavioral change before modules are populated.

- [ ] **Step 3: Capture prompt snapshot for verification**

Before any content moves, capture the current output as a snapshot. Add a test to `chat.prompt.modules.spec.ts`:

```typescript
import { buildSystemContent } from "./chat.prompt";

describe("prompt snapshot", () => {
  const ctx = mockCtx();
  const snapshot = buildSystemContent(ctx);

  test("buildSystemContent output is unchanged after refactor", () => {
    const current = buildSystemContent(ctx);
    expect(current).toBe(snapshot);
  });
});
```

This test will be run after each module extraction in Task 5 to catch any content drift. The snapshot is captured once from the refactored `buildSystemContent(ctx)` (no `iterCtx`) which should include core + scoping + onboarding + all patterns (since no modules are active without `iterCtx`).

- [ ] **Step 4: Run type check**

Run: `cd protocol && bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Run regression tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/chat.graph.invoke.spec.ts`
Expected: Same pass/fail as Task 1 baseline.

- [ ] **Step 6: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.ts
git commit -m "refactor(chat): split buildSystemContent into buildCore + buildScoping + buildOnboarding + buildPatterns"
```

---

### Task 5: Populate prompt modules and empty `buildPatterns`

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.modules.ts`
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.ts`
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.modules.spec.ts`

Move pattern content from `buildPatterns` in `chat.prompt.ts` into module definitions in `chat.prompt.modules.ts`. Do this one module at a time — after each module is moved, verify that the combined output (core + scoping + onboarding + modules + remaining patterns) hasn't changed for the case where all modules would activate.

**IMPORTANT:** This is a copy-paste extraction. Do not rewrite, rephrase, or edit any prompt text. The module `content` functions return the exact same strings that were in `buildPatterns`.

- [ ] **Step 1: Add the `discovery` module**

Add to `PROMPT_MODULES` in `chat.prompt.modules.ts`:

```typescript
const DISCOVERY_MODULE: PromptModule = {
  id: "discovery",
  triggers: ["create_opportunities", "update_opportunity"],
  content: (ctx) => `### 1. User wants to find connections or discover ...
[EXACT text from Pattern 1 + 1a + Pattern 7 + opportunity behavioral rules]`,
};
```

Copy the exact text from the current `buildPatterns` for Patterns 1, 1a, and 7 plus the opportunity-related behavioral rules. Remove this text from `buildPatterns`.

**Arg-based disambiguation for `create_opportunities`:** Both `discovery` and `introduction` trigger on `create_opportunities`, but introduction only applies when args contain `partyUserIds` or `introTargetUserId`. Use the `PromptModule.context` predicate (not hardcoded `mod.id` checks in `resolveModules`) to keep the resolution engine generic. The `excludes` mechanism handles the rest — introduction excludes discovery.

- [ ] **Step 2: Add the `introduction` module**

```typescript
/** Helper: checks if recent tool calls include create_opportunities with introduction args. */
function hasIntroductionArgs(recentTools: IterationContext["recentTools"]): boolean {
  return recentTools.some(
    (t) =>
      t.name === "create_opportunities" &&
      (t.args.partyUserIds || t.args.introTargetUserId),
  );
}

const INTRODUCTION_MODULE: PromptModule = {
  id: "introduction",
  triggers: ["create_opportunities"],
  excludes: ["discovery"],
  content: (ctx) => `### 6. Introduce two people ...
[EXACT text from Patterns 6, 6a + "no signal creation in introducer flows" + introduction-relevant subset of Pattern 7]`,
};
```

**How arg-based disambiguation works:** Both `discovery` and `introduction` trigger on `create_opportunities`. When `create_opportunities` was called with introduction args, BOTH modules match in Phase 1. Then in Phase 2, introduction's `excludes: ["discovery"]` removes discovery. When called WITHOUT introduction args, only discovery matches (introduction won't match because its trigger still fires, but we need an additional gate). To implement this gate cleanly, modify the `PromptModule` interface to accept `IterationContext` in the trigger check. Add a `triggerFilter` predicate:

```typescript
// Add to PromptModule interface:
/** Optional filter applied after tool trigger match. Return false to skip despite trigger match. */
triggerFilter?: (iterCtx: IterationContext) => boolean;
```

Set on the introduction module:
```typescript
triggerFilter: (iterCtx) => hasIntroductionArgs(iterCtx.recentTools),
```

In `resolveModules`, after the tool trigger match check:
```typescript
// Check tool triggers
if (mod.triggers.length > 0 && mod.triggers.some((t) => toolNames.has(t))) {
  // Apply optional filter (e.g., introduction checks for intro-specific args)
  matched = mod.triggerFilter ? mod.triggerFilter(iterCtx) : true;
}
```

This keeps the resolution engine generic — no `mod.id` string checks in `resolveModules`. The introduction module self-describes when it should activate.

Remove Pattern 6, 6a, and introducer-specific behavioral rules from `buildPatterns`.

**Do NOT add hardcoded `if (mod.id === "...")` checks in `resolveModules`.** The resolution engine must remain generic; modules describe their own activation logic via `triggers`, `triggerFilter`, `regex`, `context`, and `excludes`.

- [ ] **Step 3: Add remaining modules**

Add these modules to `PROMPT_MODULES`, copying exact text from `buildPatterns` and removing it from there:

- `INTENT_CREATION_MODULE` — triggers: `["create_intent"]`, content: Pattern 2
- `INTENT_MANAGEMENT_MODULE` — triggers: `["update_intent", "delete_intent"]`, content: Pattern 4
- `PERSON_LOOKUP_MODULE` — triggers: `["read_user_profiles"]`, content: Pattern 0
- `URL_SCRAPING_MODULE` — triggers: `["scrape_url"]`, regex: `/(https?:\/\/)/i`, content: Pattern 3
- `COMMUNITY_MODULE` — triggers: `["read_indexes", "create_index", "create_index_membership", "update_index", "delete_index", "delete_index_membership"]`, content: Pattern 8
- `CONTACTS_MODULE` — triggers: `["import_gmail_contacts", "add_contact", "list_contacts", "remove_contact"]`, content: Patterns 9-10
- `SHARED_CONTEXT_MODULE` — triggers: `["read_index_memberships"]`, content: Pattern 5
- `MENTIONS_MODULE` — regex: `/@\[.*?\]\(.*?\)/`, triggers: `[]`, content: @mentions explanation

Register all in `PROMPT_MODULES` array.

- [ ] **Step 4: Verify `buildPatterns` is empty**

After all modules are extracted, `buildPatterns` should return an empty string. If any pattern text remains, it was missed — move it to the appropriate module or to `buildCore`.

Delete the `buildPatterns` function and remove it from `buildSystemContent`.

Update `buildSystemContent`:

```typescript
export function buildSystemContent(ctx: ResolvedToolContext, iterCtx?: IterationContext): string {
  const core = buildCore(ctx);
  const scoping = buildScoping(ctx);
  const onboarding = buildOnboarding(ctx);
  const modules = iterCtx ? resolveModules(iterCtx) : "";
  return core + scoping + onboarding + modules;
}
```

- [ ] **Step 5: Add module resolution tests**

Append to `chat.prompt.modules.spec.ts`:

```typescript
describe("resolveModules with populated registry", () => {
  test("discovery module activates on create_opportunities", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "create_opportunities", args: { searchQuery: "mentor" } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: discovery");
    expect(result).not.toContain("Context: introduction");
  });

  test("introduction module activates on create_opportunities with introTargetUserId", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "create_opportunities", args: { introTargetUserId: "user-123" } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: introduction");
    expect(result).not.toContain("Context: discovery");
  });

  test("introduction module activates on create_opportunities with partyUserIds", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "create_opportunities", args: { partyUserIds: ["a", "b"] } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: introduction");
    expect(result).not.toContain("Context: discovery");
  });

  test("intent-creation module activates on create_intent", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "create_intent", args: { description: "test" } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: intent-creation");
  });

  test("intent-management module activates on update_intent", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "update_intent", args: { intentId: "x", newDescription: "y" } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: intent-management");
  });

  test("person-lookup module activates on read_user_profiles", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "read_user_profiles", args: {} }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: person-lookup");
  });

  test("url-scraping module activates on scrape_url", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "scrape_url", args: { url: "https://example.com" } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: url-scraping");
  });

  test("url-scraping module activates on regex match (URL in message)", () => {
    const iterCtx: IterationContext = {
      recentTools: [],
      currentMessage: "check out https://example.com/article",
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: url-scraping");
  });

  test("community module activates on read_indexes", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "read_indexes", args: {} }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: community");
  });

  test("contacts module activates on import_gmail_contacts", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "import_gmail_contacts", args: {} }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: contacts");
  });

  test("shared-context module activates on read_index_memberships", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "read_index_memberships", args: {} }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: shared-context");
  });

  test("mentions module activates on @mention regex", () => {
    const iterCtx: IterationContext = {
      recentTools: [],
      currentMessage: "connect me with @[Alice Smith](user-123)",
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: mentions");
  });

  test("multiple modules activate when multiple tools called", () => {
    const iterCtx: IterationContext = {
      recentTools: [
        { name: "read_user_profiles", args: {} },
        { name: "read_index_memberships", args: {} },
      ],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: person-lookup");
    expect(result).toContain("Context: shared-context");
  });

  test("all modules skipped when isOnboarding is true", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "create_opportunities", args: {} }],
      currentMessage: "https://example.com @[Alice](user-1)",
      ctx: mockCtx({ isOnboarding: true }),
    };
    const result = resolveModules(iterCtx);
    expect(result).toBe("");
  });

  test("discovery module activates on update_opportunity", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "update_opportunity", args: { opportunityId: "x", status: "pending" } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("Context: discovery");
  });
});
```

- [ ] **Step 6: Run all module tests**

Run: `cd protocol && bun test src/lib/protocol/agents/chat.prompt.modules.spec.ts`
Expected: All tests PASS.

- [ ] **Step 7: Run type check**

Run: `cd protocol && bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.modules.ts protocol/src/lib/protocol/agents/chat.prompt.modules.spec.ts protocol/src/lib/protocol/agents/chat.prompt.ts
git commit -m "refactor(chat): populate 10 prompt modules and extract patterns from buildSystemContent"
```

---

### Task 6: Wire `IterationContext` into `chat.agent.ts`

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.agent.ts`

This is where the modules become active. Both `runIteration` and `streamRun` need to extract tool history and pass it to `buildSystemContent`.

- [ ] **Step 1: Update imports in `chat.agent.ts`**

At `chat.agent.ts:14`, change:

```typescript
// Before:
import { ITERATION_NUDGE, buildSystemContent } from "./chat.prompt";

// After:
import { ITERATION_NUDGE, buildSystemContent } from "./chat.prompt";
import {
  extractRecentToolCalls,
  type IterationContext,
} from "./chat.prompt.modules";
```

- [ ] **Step 2: Add helper to extract current user message**

Add a private helper to `ChatAgent` class:

```typescript
/**
 * Extracts the text content of the most recent HumanMessage.
 */
private static getCurrentUserMessage(messages: BaseMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]._getType() === "human") {
      const content = messages[i].content;
      return typeof content === "string" ? content : undefined;
    }
  }
  return undefined;
}
```

- [ ] **Step 3: Update `runIteration` (line 197)**

Change `chat.agent.ts:197` from:

```typescript
const systemContent = buildSystemContent(this.resolvedContext);
```

to:

```typescript
const iterCtx: IterationContext = {
  recentTools: extractRecentToolCalls(messages),
  currentMessage: ChatAgent.getCurrentUserMessage(messages),
  ctx: this.resolvedContext,
};
const systemContent = buildSystemContent(this.resolvedContext, iterCtx);
```

- [ ] **Step 4: Update `streamRun` (line 605)**

Change `chat.agent.ts:605` from:

```typescript
const systemContent = buildSystemContent(this.resolvedContext);
```

to:

```typescript
const iterCtx: IterationContext = {
  recentTools: extractRecentToolCalls(messages),
  currentMessage: ChatAgent.getCurrentUserMessage(messages),
  ctx: this.resolvedContext,
};
const systemContent = buildSystemContent(this.resolvedContext, iterCtx);
```

- [ ] **Step 5: Run type check**

Run: `cd protocol && bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Run regression tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/chat.graph.invoke.spec.ts`
Expected: Same pass/fail as Task 1 baseline.

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/chat.graph.streaming.spec.ts`
Expected: Same pass/fail as Task 1 baseline.

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/chat.graph.scope.spec.ts`
Expected: Same pass/fail as Task 1 baseline.

- [ ] **Step 7: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.agent.ts
git commit -m "feat(chat): wire IterationContext into runIteration and streamRun"
```

---

### Task 7: Run full regression and verify prompt size reduction

**Files:**
- Read: `protocol/src/lib/protocol/agents/chat.prompt.ts`
- Read: `protocol/src/lib/protocol/agents/chat.prompt.modules.ts`

Final verification that everything works and the prompt size targets are met.

- [ ] **Step 1: Run all chat graph tests**

```bash
cd protocol
bun test src/lib/protocol/graphs/tests/chat.graph.invoke.spec.ts
bun test src/lib/protocol/graphs/tests/chat.graph.streaming.spec.ts
bun test src/lib/protocol/graphs/tests/chat.graph.scope.spec.ts
bun test src/lib/protocol/graphs/tests/chat.graph.opportunities.spec.ts
bun test src/lib/protocol/graphs/tests/chat.graph.profile.spec.ts
```

Expected: All match Task 1 baseline.

- [ ] **Step 2: Run module unit tests**

Run: `cd protocol && bun test src/lib/protocol/agents/chat.prompt.modules.spec.ts`
Expected: All PASS.

- [ ] **Step 3: Verify prompt size reduction**

Write a quick verification in a test or script. Call `buildSystemContent(ctx)` with no `iterCtx` (first iteration scenario) and measure the character count. Compare against the current ~41,800 chars.

Expected: First-iteration prompt is ~35,000 chars or less (~16% reduction). The difference should roughly equal the total size of all module content strings.

- [ ] **Step 4: Run type check**

Run: `cd protocol && bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore(chat): verify dynamic prompt modules regression and size reduction"
```

---

### Task 8: Add Smartest behavioral tests

**Files:**
- Create: `protocol/src/lib/protocol/agents/chat.prompt.dynamic.spec.ts`

LLM-verified tests that confirm the agent behaves correctly with the dynamically assembled prompt. These use the same Smartest framework as existing chat graph tests.

**Note:** These tests require LLM calls and are slow (~30-180s each). They validate that the dynamic prompt assembly doesn't break agent behavior.

- [ ] **Step 1: Create behavioral test file**

Create `protocol/src/lib/protocol/agents/chat.prompt.dynamic.spec.ts`. Structure it like `chat.graph.invoke.spec.ts` — same mock database pattern, same Smartest imports, same `ChatGraphFactory` setup.

Test scenarios:

1. **Discovery routing (core rule, no module needed):** User says "find me a mentor" → agent calls `create_opportunities` (not `create_intent`). This validates the core routing rule works without the discovery module loaded on the first iteration.

2. **URL triggers scraping module:** User sends "check out https://example.com/article" → agent calls `scrape_url` first. This validates the regex trigger.

3. **@mention triggers mentions module:** User sends "tell me about @[Alice Smith](user-123)" → agent extracts the userId correctly. This validates the regex trigger.

Each test follows the Smartest pattern:

```typescript
const result = await runScenario(defineScenario({
  name: "discovery-routing-without-module",
  description: "Agent routes to create_opportunities on first iteration without discovery module",
  fixtures: { userId: testUserId, message: "find me a mentor in AI" },
  sut: {
    type: "graph",
    factory: () => compiledGraph,
    invoke: async (instance, resolvedInput) => {
      const input = resolvedInput as { userId: string; message: string };
      return await instance.invoke({
        userId: input.userId,
        messages: [new HumanMessage(input.message)],
      });
    },
    input: { userId: "@fixtures.userId", message: "@fixtures.message" },
  },
  verification: {
    schema: chatGraphOutputSchema,
    criteria: "Agent must have called create_opportunities tool (not create_intent). Response should present connections or state no matches found. No raw JSON or internal tool names visible.",
    llmVerify: true,
  },
}));
expectSmartest(result);
```

- [ ] **Step 2: Run behavioral tests**

Run: `cd protocol && bun test src/lib/protocol/agents/chat.prompt.dynamic.spec.ts`
Expected: All PASS (may take 3-5 minutes due to LLM calls).

- [ ] **Step 3: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.dynamic.spec.ts
git commit -m "test(chat): add Smartest behavioral tests for dynamic prompt modules"
```
