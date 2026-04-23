# MCP Tier-1 Tool Layer Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix response shape, field naming, pagination, and description issues across four MCP tool files — all changes confined to `packages/protocol/src/*/tools.ts`.

**Architecture:** Each task targets one tool file independently. No graph, service, or DB changes. Tests follow the existing `captureTool` / `captureTools` pattern already established in `packages/protocol/src/*/tests/`.

**Tech Stack:** TypeScript, Bun, `bun:test`, Zod

---

## File Map

| File | Change |
|------|--------|
| `packages/protocol/src/negotiation/negotiation.tools.ts` | `list_negotiations`: fix `isUsersTurn` for completed, fix `latestMessagePreview`, add pagination. `get_negotiation`: fix `isUsersTurn` for completed. |
| `packages/protocol/src/contact/contact.tools.ts` | `search_contacts`: rename `contactId` → `userId` in response, update description. |
| `packages/protocol/src/agent/agent.tools.ts` | `register_agent`: improve error message when called from agent context. |
| `packages/protocol/src/intent/intent.tools.ts` | `update_intent`: add `intentId` + `description` to success response. `create_intent`: remove web-UI "proposal card contract" paragraph from description. `delete_intent`: message text consistency. |
| `packages/protocol/src/negotiation/tests/negotiation.tools.spec.ts` | New test file. |
| `packages/protocol/src/contact/tests/search-contacts.spec.ts` | Add `userId` field assertion. |
| `packages/protocol/src/agent/tests/agent.tools.spec.ts` | New test file. |
| `packages/protocol/src/intent/tests/update-intent.spec.ts` | Add response-shape assertions. |
| `packages/protocol/src/intent/tests/delete-intent.spec.ts` | Add message-text assertion. |

---

## Task 1: `negotiation.tools.ts` — `list_negotiations` and `get_negotiation` fixes

**Files:**
- Modify: `packages/protocol/src/negotiation/negotiation.tools.ts`
- Create: `packages/protocol/src/negotiation/tests/negotiation.tools.spec.ts`

### Step 1.1 — Write failing tests

Create `packages/protocol/src/negotiation/tests/negotiation.tools.spec.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { createNegotiationTools } from "../negotiation.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(userId = "user-src"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function captureTool(name: string, deps: Partial<ToolDeps>) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string> } | undefined;
  const defineTool = (def: { name: string; handler: (...args: unknown[]) => unknown }) => {
    if (def.name === name) captured = def as typeof captured;
    return def;
  };
  createNegotiationTools(defineTool as never, deps as ToolDeps);
  return captured!;
}

function makeTask(state: string, sourceUserId: string, candidateUserId: string) {
  return {
    id: "task-1",
    conversationId: "conv-1",
    state,
    metadata: { type: "negotiation", sourceUserId, candidateUserId, maxTurns: 6 },
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
  };
}

function makeMessage(action: string, reasoning: string, message: string | null) {
  return {
    parts: [{ kind: "data", data: { action, assessment: { reasoning }, message } }],
  };
}

// ── isUsersTurn ────────────────────────────────────────────────────────────────

describe("list_negotiations — isUsersTurn", () => {
  test("completed negotiation always returns isUsersTurn=false even when parity says it is their turn", async () => {
    // 1 message → parity says source's turn → but status=completed → must be false
    const task = makeTask("completed", "user-src", "user-cand");
    const msg = makeMessage("propose", "reasoning", "proposal message");

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [msg],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} })
    );

    expect(result.success).toBe(true);
    expect(result.data.negotiations[0].isUsersTurn).toBe(false);
  });

  test("active negotiation with 0 messages → source's turn → isUsersTurn=true for source", async () => {
    const task = makeTask("working", "user-src", "user-cand");

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} })
    );

    expect(result.data.negotiations[0].status).toBe("active");
    expect(result.data.negotiations[0].isUsersTurn).toBe(true);
  });
});

// ── latestMessagePreview ───────────────────────────────────────────────────────

describe("list_negotiations — latestMessagePreview", () => {
  test("uses message field, not assessment.reasoning", async () => {
    const task = makeTask("completed", "user-src", "user-cand");
    const msg = makeMessage("accept", "Internal chain-of-thought reasoning here.", "I accept this connection.");

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [msg],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} })
    );

    const preview = result.data.negotiations[0].latestMessagePreview;
    expect(preview).toBe("I accept this connection.");
    expect(preview).not.toContain("chain-of-thought");
  });

  test("returns null preview when message is null", async () => {
    const task = makeTask("completed", "user-src", "user-cand");
    const msg = makeMessage("accept", "Internal reasoning.", null);

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [msg],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} })
    );

    expect(result.data.negotiations[0].latestMessagePreview).toBeNull();
  });
});

// ── pagination ─────────────────────────────────────────────────────────────────

describe("list_negotiations — pagination", () => {
  function makeTasks(n: number) {
    return Array.from({ length: n }, (_, i) =>
      makeTask("completed", "user-src", `user-cand-${i}`)
    ).map((t, i) => ({ ...t, id: `task-${i}` }));
  }

  test("returns first page with limit=2", async () => {
    const tasks = makeTasks(5);

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => tasks,
        getMessagesForConversation: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: { limit: 2, page: 1 } })
    );

    expect(result.data.negotiations).toHaveLength(2);
    expect(result.data.totalCount).toBe(5);
    expect(result.data.totalPages).toBe(3);
    expect(result.data.page).toBe(1);
  });

  test("returns second page", async () => {
    const tasks = makeTasks(5);

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => tasks,
        getMessagesForConversation: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: { limit: 2, page: 2 } })
    );

    expect(result.data.negotiations).toHaveLength(2);
    expect(result.data.page).toBe(2);
  });

  test("no pagination params → returns all results without totalCount", async () => {
    const tasks = makeTasks(3);

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => tasks,
        getMessagesForConversation: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} })
    );

    expect(result.data.negotiations).toHaveLength(3);
    expect(result.data.totalCount).toBeUndefined();
  });
});

// ── get_negotiation isUsersTurn ───────────────────────────────────────────────

describe("get_negotiation — isUsersTurn", () => {
  test("completed negotiation always returns isUsersTurn=false", async () => {
    const task = makeTask("completed", "user-src", "user-cand");
    const msg = makeMessage("accept", "reasoning", "accepted");

    const deps = {
      negotiationDatabase: {
        getTask: async () => task,
        getMessagesForConversation: async () => [msg],
        getArtifactsForTask: async () => [],
      },
    };

    const tool = captureTool("get_negotiation", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: { negotiationId: "task-1" } })
    );

    expect(result.success).toBe(true);
    expect(result.data.isUsersTurn).toBe(false);
  });
});
```

### Step 1.2 — Run tests to confirm they fail

```bash
cd packages/protocol
bun test src/negotiation/tests/negotiation.tools.spec.ts
```

Expected: all tests fail (features not yet implemented).

### Step 1.3 — Implement: fix `isUsersTurn` for completed in `list_negotiations`

In `packages/protocol/src/negotiation/negotiation.tools.ts`, find the `isUsersTurn` calculation inside the `list_negotiations` handler (around line 75):

```typescript
// Before:
const isUsersTurn = (isSource && currentSpeaker === 'source') || (!isSource && currentSpeaker === 'candidate');

// After — gate on status:
const isUsersTurn = status !== 'completed' &&
  ((isSource && currentSpeaker === 'source') || (!isSource && currentSpeaker === 'candidate'));
```

Note: `status` is computed on the line just above this one, so use it directly.

### Step 1.4 — Implement: fix `latestMessagePreview` in `list_negotiations`

Find the `latestMessagePreview` line (around line 91):

```typescript
// Before:
latestMessagePreview: lastTurnData?.assessment?.reasoning
  ? lastTurnData.assessment.reasoning.substring(0, 150) + (lastTurnData.assessment.reasoning.length > 150 ? '...' : '')
  : null,

// After — use message, not reasoning:
latestMessagePreview: lastTurnData?.message ?? null,
```

### Step 1.5 — Implement: pagination in `list_negotiations`

**a.** Add `limit` and `page` to the query schema (find the existing `querySchema` for `list_negotiations`):

```typescript
querySchema: z.object({
  status: z.enum(['active', 'waiting_for_agent', 'completed', 'all']).optional()
    .describe('Filter by negotiation status. Omit or use "all" to return all negotiations.'),
  limit: z.number().int().min(1).max(100).optional()
    .describe('Maximum negotiations to return per page (1-100). Omit to return all.'),
  page: z.number().int().min(1).optional()
    .describe('Page number (1-based). Only used when limit is provided. Defaults to 1.'),
}),
```

**b.** Apply pagination after the `filter(Boolean)` call at the end of the handler. Replace the final `return success(...)` block with:

```typescript
const filtered = negotiations.filter(Boolean);

const shouldPaginate = query.limit !== undefined;
if (shouldPaginate) {
  const limit = query.limit!;
  const page = query.page ?? 1;
  const offset = (page - 1) * limit;
  const paged = filtered.slice(offset, offset + limit);
  return success({
    count: paged.length,
    totalCount: filtered.length,
    limit,
    page,
    totalPages: Math.ceil(filtered.length / limit),
    negotiations: paged,
  });
}

return success({
  count: filtered.length,
  negotiations: filtered,
});
```

### Step 1.6 — Implement: fix `isUsersTurn` for completed in `get_negotiation`

In the same file, find the `isUsersTurn` calculation inside the `get_negotiation` handler (around line 226). Apply the same gate:

```typescript
// Before:
const isUsersTurn = (isSource && currentSpeaker === 'source') || (!isSource && currentSpeaker === 'candidate');

// After:
const isUsersTurn = status !== 'completed' &&
  ((isSource && currentSpeaker === 'source') || (!isSource && currentSpeaker === 'candidate'));
```

### Step 1.7 — Run tests to confirm they pass

```bash
cd packages/protocol
bun test src/negotiation/tests/negotiation.tools.spec.ts
```

Expected: all tests pass.

### Step 1.8 — Type-check

```bash
cd packages/protocol
bun run build 2>&1 | head -30
```

Expected: no errors.

### Step 1.9 — Commit

```bash
git add packages/protocol/src/negotiation/negotiation.tools.ts \
        packages/protocol/src/negotiation/tests/negotiation.tools.spec.ts
git commit -m "fix(mcp): list/get_negotiations — isUsersTurn on completed, preview uses message, add pagination"
```

---

## Task 2: `contact.tools.ts` — `search_contacts` field rename

**Files:**
- Modify: `packages/protocol/src/contact/contact.tools.ts`
- Modify: `packages/protocol/src/contact/tests/search-contacts.spec.ts`

### Step 2.1 — Write failing test

Add this test to `packages/protocol/src/contact/tests/search-contacts.spec.ts` (append inside the existing `describe("search_contacts", ...)` block):

```typescript
test("response uses userId not contactId", async () => {
  const contactService = {
    searchContacts: async () => [
      {
        contactId: "cid-42",
        name: "Bob Jones",
        email: "bob@example.com",
        avatar: null,
        isGhost: false,
      },
    ],
  };
  const tools = captureTools({ contactService } as unknown as ToolDeps);
  const tool = tools.find((t) => t.name === "search_contacts")!;

  const result = JSON.parse(
    await tool.handler({ context: makeContext("alice"), query: { query: "bob" } })
  );

  expect(result.success).toBe(true);
  const contact = result.data.contacts[0];
  expect(contact.userId).toBe("cid-42");
  expect(contact.contactId).toBeUndefined();
});
```

### Step 2.2 — Run test to confirm it fails

```bash
cd packages/protocol
bun test src/contact/tests/search-contacts.spec.ts --test-name-pattern "response uses userId"
```

Expected: FAIL — `contact.userId` is undefined because the handler passes through `contactId`.

### Step 2.3 — Implement: remap field in handler

In `packages/protocol/src/contact/contact.tools.ts`, find the `search_contacts` handler. Replace the `return success(...)` line:

```typescript
// Before:
return success({ count: rows.length, contacts: rows });

// After — remap contactId → userId:
return success({
  count: rows.length,
  contacts: rows.map(r => ({
    userId: r.contactId,
    name: r.name,
    email: r.email,
    avatar: r.avatar,
    isGhost: r.isGhost,
  })),
});
```

Also update the tool description line that says `contactId (userId)` to just say `userId`:

```typescript
// Find this line in the description:
"**Returns:** Array of matching contacts: contactId (userId), name, email, avatar, isGhost.",

// Replace with:
"**Returns:** Array of matching contacts: userId, name, email, avatar, isGhost.",
```

### Step 2.4 — Run tests to confirm they pass

```bash
cd packages/protocol
bun test src/contact/tests/search-contacts.spec.ts
```

Expected: all tests pass.

### Step 2.5 — Type-check

```bash
cd packages/protocol
bun run build 2>&1 | head -30
```

Expected: no errors.

### Step 2.6 — Commit

```bash
git add packages/protocol/src/contact/contact.tools.ts \
        packages/protocol/src/contact/tests/search-contacts.spec.ts
git commit -m "fix(mcp): search_contacts — rename contactId to userId in response"
```

---

## Task 3: `agent.tools.ts` — `register_agent` error message

**Files:**
- Modify: `packages/protocol/src/agent/agent.tools.ts`
- Create: `packages/protocol/src/agent/tests/agent.tools.spec.ts`

### Step 3.1 — Write failing test

Create `packages/protocol/src/agent/tests/agent.tools.spec.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { createAgentTools } from "../agent.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(overrides: Partial<ResolvedToolContext> = {}): ResolvedToolContext {
  return {
    userId: "user-123",
    user: { id: "user-123", name: "Alice", email: "a@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    ...overrides,
  } as unknown as ResolvedToolContext;
}

function makeAgentDb() {
  return {
    createAgent: async (input: { ownerId: string; name: string; description?: string; type: string }) =>
      ({ id: "agent-new", ...input }),
    getAgentWithRelations: async () => ({
      id: "agent-new",
      ownerId: "user-123",
      name: "My Agent",
      description: null,
      type: "personal",
      status: "active",
      metadata: {},
      lastSeenAt: null,
      notifyOnOpportunity: false,
      dailySummaryEnabled: false,
      handleNegotiations: false,
      lastDailySummaryAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      transports: [],
      permissions: [],
    }),
    listAgentsForUser: async () => [],
    getAgent: async () => null,
    updateAgent: async () => null,
    deleteAgent: async () => {},
    grantPermission: async () => ({ id: "perm-1", agentId: "agent-new", userId: "user-123", scope: "global", scopeId: null, actions: [], createdAt: new Date() }),
    revokePermission: async () => {},
  };
}

function captureTool(name: string, deps: Partial<ToolDeps>) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string> } | undefined;
  const defineTool = (def: { name: string; handler: (...args: unknown[]) => unknown }) => {
    if (def.name === name) captured = def as typeof captured;
    return def;
  };
  createAgentTools(defineTool as never, { agentDatabase: makeAgentDb(), ...deps } as ToolDeps);
  return captured!;
}

describe("register_agent", () => {
  test("returns helpful error message when called from agent context", async () => {
    const tool = captureTool("register_agent", {});
    const contextWithAgent = makeContext({ agentId: "existing-agent-id" } as never);

    const result = JSON.parse(
      await tool.handler({ context: contextWithAgent, query: { name: "New Agent" } })
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("web app");
    expect(result.error).toContain("user session");
  });

  test("succeeds when called from a user session (no agentId)", async () => {
    const tool = captureTool("register_agent", {});

    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { name: "My New Agent" } })
    );

    expect(result.success).toBe(true);
    expect(result.data.agent.name).toBe("My New Agent");
  });
});
```

### Step 3.2 — Run test to confirm it fails

```bash
cd packages/protocol
bun test src/agent/tests/agent.tools.spec.ts --test-name-pattern "helpful error message"
```

Expected: FAIL — current error message is `"This agent can only manage its own registration."` which doesn't contain "web app" or "user session".

### Step 3.3 — Implement: improve error message

In `packages/protocol/src/agent/agent.tools.ts`, find the guard at the start of `registerAgent`'s handler (around line 72):

```typescript
// Before:
if (context.agentId) {
  return error('This agent can only manage its own registration.');
}

// After:
if (context.agentId) {
  return error(
    'Agent registration must be done from a user session (web UI or personal API key), ' +
    'not from within an existing agent context. To register a new agent, visit the Index web app.'
  );
}
```

### Step 3.4 — Run tests to confirm they pass

```bash
cd packages/protocol
bun test src/agent/tests/agent.tools.spec.ts
```

Expected: both tests pass.

### Step 3.5 — Type-check

```bash
cd packages/protocol
bun run build 2>&1 | head -30
```

Expected: no errors.

### Step 3.6 — Commit

```bash
git add packages/protocol/src/agent/agent.tools.ts \
        packages/protocol/src/agent/tests/agent.tools.spec.ts
git commit -m "fix(mcp): register_agent — improve error message when called from agent context"
```

---

## Task 4: `intent.tools.ts` — response shape and description fixes

**Files:**
- Modify: `packages/protocol/src/intent/intent.tools.ts`
- Modify: `packages/protocol/src/intent/tests/update-intent.spec.ts`
- Modify: `packages/protocol/src/intent/tests/delete-intent.spec.ts`

### Step 4.1 — Write failing tests

**a.** Add to `packages/protocol/src/intent/tests/update-intent.spec.ts` (append inside `describe("update_intent", ...)` before the closing `}`):

```typescript
test("success response includes intentId and description", async () => {
  const tools = captureTools({
    userDb: {},
    systemDb: {
      getIntent: async () => ({ id: "11111111-1111-4111-8111-111111111111", userId: "caller-user" }),
    },
    graphs: {
      profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
      intent: {
        invoke: async () => ({ executionResults: [{ success: true }], agentTimings: [] }),
      },
    },
  } as unknown as ToolDeps);
  const tool = tools.find((t) => t.name === "update_intent")!;

  const result = JSON.parse(
    await tool.handler({
      context: makeContext("caller-user"),
      query: {
        intentId: "11111111-1111-4111-8111-111111111111",
        description: "Find a TypeScript architect for a 3-month contract",
      },
    })
  );

  expect(result.success).toBe(true);
  expect(result.data.intentId).toBe("11111111-1111-4111-8111-111111111111");
  expect(result.data.description).toBe("Find a TypeScript architect for a 3-month contract");
});
```

**b.** Add to `packages/protocol/src/intent/tests/delete-intent.spec.ts` (append a new test inside the existing `describe` block):

```typescript
test("success message says 'Intent archived successfully.'", async () => {
  const deps = {
    userDb: { getNetworkIdsForIntent: async () => [] },
    systemDb: {
      isNetworkMember: async () => true,
      getNetworksByScope: async () => [],
      getIntent: async () => ({ id: "11111111-1111-4111-8111-111111111111", userId: "caller-user" }),
    },
    graphs: {
      intent: { invoke: async () => ({ executionResults: [{ success: true }], agentTimings: [] }) },
    },
  } as unknown as ToolDeps;

  const tool = captureTool(deps);
  const result = JSON.parse(
    await tool.handler({ context: makeContext("caller-user"), query: { intentId: "11111111-1111-4111-8111-111111111111" } })
  );
  expect(result.success).toBe(true);
  expect(result.data.message).toBe("Intent archived successfully.");
});
```

### Step 4.2 — Run tests to confirm they fail

```bash
cd packages/protocol
bun test src/intent/tests/update-intent.spec.ts --test-name-pattern "includes intentId"
bun test src/intent/tests/delete-intent.spec.ts --test-name-pattern "archived successfully"
```

Expected: both fail — `intentId` and `description` not in response; message text doesn't match.

### Step 4.3 — Implement: `update_intent` response shape

In `packages/protocol/src/intent/intent.tools.ts`, find the success `return` inside `updateIntent`'s handler (around line 409):

```typescript
// Before:
return success({
  message: "Intent updated.",
  _graphTimings: [...],
});

// After — add intentId and description:
return success({
  message: "Intent updated.",
  intentId,
  description: query.description,
  _graphTimings: [
    { name: 'profile', durationMs: _profileGraphMs2, agents: profileResult.agentTimings ?? [] },
    { name: 'intent', durationMs: _intentGraphMs2, agents: result.agentTimings ?? [] },
  ],
});
```

### Step 4.4 — Implement: `delete_intent` message text

In the same file, find the success `return` inside `deleteIntent`'s handler (around line 472):

```typescript
// Before:
return success({
  message: "Intent archived.",
  _graphTimings: [...],
});

// After:
return success({
  message: "Intent archived successfully.",
  _graphTimings: [{ name: 'intent', durationMs: _deleteIntentGraphMs, agents: result.agentTimings ?? [] }],
});
```

### Step 4.5 — Implement: `update_intent` description — update Returns line

In the same file, find the `update_intent` description string. Update the `**Returns:**` line:

```typescript
// Before:
"**Returns:** Confirmation of update. The intent's embeddings and index relevancy scores are recalculated automatically.",

// After:
"**Returns:** Updated `intentId` and `description`, plus a confirmation message. The intent's embeddings and index relevancy scores are recalculated automatically.",
```

### Step 4.6 — Implement: `create_intent` description cleanup

In the same file, find the `create_intent` description. Remove the "Proposal card contract" paragraph — specifically these three lines (around lines 173–175):

```typescript
// Remove this block from the description string:
"**Proposal card contract.** The response contains an ```intent_proposal code block. Include that block " +
"VERBATIM in your reply to the user — do not summarize it, do not write an intent_proposal block yourself. " +
"Only this tool returns valid blocks (they embed a proposalId the UI needs to persist the intent on approval).",
```

The description should end after the "URL handling" paragraph, before the removed block. No other changes to the description.

### Step 4.7 — Run tests to confirm they pass

```bash
cd packages/protocol
bun test src/intent/tests/update-intent.spec.ts
bun test src/intent/tests/delete-intent.spec.ts
```

Expected: all tests pass.

### Step 4.8 — Type-check

```bash
cd packages/protocol
bun run build 2>&1 | head -30
```

Expected: no errors.

### Step 4.9 — Commit

```bash
git add packages/protocol/src/intent/intent.tools.ts \
        packages/protocol/src/intent/tests/update-intent.spec.ts \
        packages/protocol/src/intent/tests/delete-intent.spec.ts
git commit -m "fix(mcp): intent tools — update_intent returns intentId/desc, align delete message, clean create_intent description"
```

---

## Final: run full protocol test suite

```bash
cd packages/protocol
bun test
```

Expected: all tests pass, no regressions.
