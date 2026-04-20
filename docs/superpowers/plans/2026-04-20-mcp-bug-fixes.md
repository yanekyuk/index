# MCP Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four confirmed bugs in the Index Network MCP layer: an ownership bypass on intent mutation, an illegal state transition on opportunities, debug internals leaking into MCP responses, and a query-mode profile fetch crashing on fragmented user identities.

**Architecture:** All fixes are in `packages/protocol/src/`. Two are pure authorization guards added before existing graph delegation (intent tools, opportunity tools). One strips a key in the existing `sanitizeMcpResult` post-processor. One wraps a `Promise.all` map in try-catch for graceful degradation. No new abstractions, no schema changes, no migrations required.

**Tech Stack:** TypeScript, Zod, Bun test runner (`bun test <file>`)

---

## Bug Summary

| # | Bug | File | Confirmed by |
|---|---|---|---|
| 1 | `delete_intent` / `update_intent` — no ownership check | `intent/intent.tools.ts` | Live test: deleted Vicky's intent |
| 2 | `update_opportunity` — terminal states are mutable; no actor guard | `opportunity/opportunity.tools.ts` | Live test: rejected→accepted succeeded |
| 3 | `debugSteps` leaks other users' bios, RAG scores, model names | `mcp/mcp.server.ts` | Live test: create_opportunities response |
| 4 | `read_user_profiles(query)` crashes for some shared members | `profile/profile.tools.ts` | Live test: "chad" → "Access denied" |

---

## Task 1 — Intent ownership guard: `delete_intent` and `update_intent`

**Problem:** Both handlers skip ownership verification when the chat is not index-scoped (`context.networkId` absent). Any authenticated user can archive or update any intent by ID.

**Fix:** Before the graph call, use `systemDb.getIntentWithOwnership(intentId, context.userId)` which returns `null` when the intent either doesn't exist or doesn't belong to the caller.

**Files:**
- Modify: `packages/protocol/src/intent/intent.tools.ts` (delete_intent handler ~line 421, update_intent handler ~line 356)
- Modify: `packages/protocol/src/intent/tests/update-intent.spec.ts` (add ownership tests)
- Create: `packages/protocol/src/intent/tests/delete-intent.spec.ts`

---

- [ ] **Step 1.1 — Write failing tests for delete_intent ownership**

Create `packages/protocol/src/intent/tests/delete-intent.spec.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { createIntentTools } from "../intent.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(userId = "user-123"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function captureTool(deps: ToolDeps) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string> } | undefined;
  const defineTool = (def: any) => { if (def.name === "delete_intent") captured = def; return def; };
  createIntentTools(defineTool as any, deps);
  return captured!;
}

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";

describe("delete_intent", () => {
  test("returns error when intent belongs to another user", async () => {
    const deps = {
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getNetworksByScope: async () => [],
        getIntentWithOwnership: async (_intentId: string, _userId: string) => null, // null = not owned
      },
      graphs: {
        intent: { invoke: async () => ({ executionResults: [{ success: true }] }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("caller-user"), query: { intentId: VALID_UUID } })
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("own");
  });

  test("proceeds when intent belongs to the caller", async () => {
    const deps = {
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getNetworksByScope: async () => [],
        getIntentWithOwnership: async (_intentId: string, _userId: string) => ({ id: VALID_UUID, userId: "caller-user" }),
      },
      graphs: {
        intent: { invoke: async () => ({ executionResults: [{ success: true }] }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("caller-user"), query: { intentId: VALID_UUID } })
    );
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 1.2 — Run to confirm tests fail**

```bash
cd packages/protocol
bun test src/intent/tests/delete-intent.spec.ts
```

Expected: FAIL — `result.success` is `true` when it should be `false` (ownership not yet enforced).

- [ ] **Step 1.3 — Add ownership check to `delete_intent` handler**

In `packages/protocol/src/intent/intent.tools.ts`, **after** the UUID format check and **before** the scope-enforcement block, add:

```typescript
// Ownership guard: caller must own the intent
const ownedIntent = await deps.systemDb.getIntentWithOwnership(intentId, context.userId);
if (!ownedIntent) {
  return error("Intent not found or you can only delete your own intents.");
}
```

The full `delete_intent` handler around lines 421-461 becomes:

```typescript
handler: async ({ context, query }) => {
  const scopeErr = await ensureScopedMembership(context, deps.systemDb);
  if (scopeErr) return error(scopeErr);
  const intentId = query.intentId?.trim() ?? "";
  if (!UUID_REGEX.test(intentId)) {
    return error("Invalid intent ID format.");
  }

  // Ownership guard: caller must own the intent
  const ownedIntent = await deps.systemDb.getIntentWithOwnership(intentId, context.userId);
  if (!ownedIntent) {
    return error("Intent not found or you can only delete your own intents.");
  }

  // Strict scope enforcement: when chat is index-scoped, verify intent is linked to that index
  if (context.networkId) {
    const db = deps.userDb;
    const intentNetworks = await db.getNetworkIdsForIntent(intentId);
    if (!intentNetworks.includes(context.networkId)) {
      return error(
        `This chat is scoped to ${context.indexName ?? 'this index'}. You can only delete intents linked to this community.`
      );
    }
  }

  // ... rest unchanged (graph invocation)
```

- [ ] **Step 1.4 — Add ownership check to `update_intent` handler**

Same pattern. In `update_intent` handler (around line 356), after the UUID format check, add the same guard:

```typescript
// Ownership guard: caller must own the intent
const ownedIntent = await deps.systemDb.getIntentWithOwnership(intentId, context.userId);
if (!ownedIntent) {
  return error("Intent not found or you can only update your own intents.");
}
```

- [ ] **Step 1.5 — Add ownership tests for update_intent**

Extend `packages/protocol/src/intent/tests/update-intent.spec.ts`. Add after existing tests:

```typescript
describe("update_intent — ownership", () => {
  test("returns error when intent belongs to another user", async () => {
    const deps = {
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getNetworksByScope: async () => [],
        getIntentWithOwnership: async () => null,
      },
      graphs: {
        intent: { invoke: async () => ({ executionResults: [] }) },
      },
    } as unknown as ToolDeps;

    const tools = captureTools(deps);
    const tool = tools.find((t) => t.name === "update_intent")!;
    const result = JSON.parse(
      await tool.handler({
        context: makeContext("caller-user"),
        query: { intentId: "11111111-1111-4111-8111-111111111111", description: "Updated" },
      })
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("own");
  });

  test("proceeds when intent belongs to the caller", async () => {
    const deps = {
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getNetworksByScope: async () => [],
        getIntentWithOwnership: async () => ({ id: "11111111-1111-4111-8111-111111111111", userId: "caller-user" }),
      },
      graphs: {
        intent: { invoke: async () => ({ executionResults: [{ success: true }], inferredIntents: [] }) },
      },
    } as unknown as ToolDeps;

    const tools = captureTools(deps);
    const tool = tools.find((t) => t.name === "update_intent")!;
    const result = JSON.parse(
      await tool.handler({
        context: makeContext("caller-user"),
        query: { intentId: "11111111-1111-4111-8111-111111111111", description: "Updated" },
      })
    );
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 1.6 — Run all intent tests**

```bash
cd packages/protocol
bun test src/intent/tests/delete-intent.spec.ts src/intent/tests/update-intent.spec.ts
```

Expected: All PASS.

- [ ] **Step 1.7 — Commit**

```bash
git add packages/protocol/src/intent/intent.tools.ts \
        packages/protocol/src/intent/tests/delete-intent.spec.ts \
        packages/protocol/src/intent/tests/update-intent.spec.ts
git commit -m "fix(mcp): add ownership guard to delete_intent and update_intent"
```

---

## Task 2 — Opportunity state machine and actor guard

**Problem:** `update_opportunity` allows illegal state transitions (e.g. `rejected → accepted`) and does not verify the caller is a party to the opportunity when the chat is not index-scoped.

**Fix:** Always fetch the opportunity before the graph call. (1) Check that `context.userId` appears in `opportunity.actors`. (2) Reject updates when the current status is terminal (`accepted`, `rejected`, `expired`).

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.tools.ts` (~line 1063)
- Create: `packages/protocol/src/opportunity/tests/update-opportunity.spec.ts`

---

- [ ] **Step 2.1 — Write failing tests**

Create `packages/protocol/src/opportunity/tests/update-opportunity.spec.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { createOpportunityTools } from "../opportunity.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { Opportunity } from "../../shared/interfaces/database.interface.js";

const CALLER_ID = "caller-111";
const OTHER_ID  = "other-222";
const OPP_ID    = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeContext(userId = CALLER_ID): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Test", email: "t@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function makeOpportunity(status: string, actorIds = [CALLER_ID, OTHER_ID]): Opportunity {
  return {
    id: OPP_ID,
    status,
    actors: actorIds.map((userId) => ({ userId, role: "party" })),
  } as unknown as Opportunity;
}

function captureTool(deps: ToolDeps) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string> } | undefined;
  const defineTool = (def: any) => { if (def.name === "update_opportunity") captured = def; return def; };
  createOpportunityTools(defineTool as any, deps);
  return captured!;
}

describe("update_opportunity — state machine", () => {
  test("blocks transition from rejected to accepted", async () => {
    const deps = {
      systemDb: {
        getOpportunity: async () => makeOpportunity("rejected"),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { opportunityId: OPP_ID, status: "accepted" } })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already|terminal|cannot/i);
  });

  test("blocks transition from accepted to pending", async () => {
    const deps = {
      systemDb: {
        getOpportunity: async () => makeOpportunity("accepted"),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { opportunityId: OPP_ID, status: "pending" } })
    );
    expect(result.success).toBe(false);
  });

  test("allows pending to accepted", async () => {
    const deps = {
      systemDb: {
        getOpportunity: async () => makeOpportunity("pending"),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { opportunityId: OPP_ID, status: "accepted" } })
    );
    expect(result.success).toBe(true);
  });
});

describe("update_opportunity — actor guard", () => {
  test("blocks update when caller is not an actor", async () => {
    const deps = {
      systemDb: {
        // Opportunity only has OTHER_ID and a third party — not the caller
        getOpportunity: async () => makeOpportunity("pending", [OTHER_ID, "third-333"]),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(CALLER_ID), query: { opportunityId: OPP_ID, status: "accepted" } })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found|not a party/i);
  });

  test("allows update when caller is an actor", async () => {
    const deps = {
      systemDb: {
        getOpportunity: async () => makeOpportunity("pending", [CALLER_ID, OTHER_ID]),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(CALLER_ID), query: { opportunityId: OPP_ID, status: "accepted" } })
    );
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2.2 — Run to confirm tests fail**

```bash
cd packages/protocol
bun test src/opportunity/tests/update-opportunity.spec.ts
```

Expected: FAIL — state machine and actor guard not yet implemented.

- [ ] **Step 2.3 — Implement the fix in `update_opportunity` handler**

In `packages/protocol/src/opportunity/opportunity.tools.ts`, replace the handler body starting at line 1063 with:

```typescript
handler: async ({ context, query }) => {
  const opportunityId = query.opportunityId?.trim();
  if (!opportunityId || !UUID_REGEX.test(opportunityId)) {
    return error("Valid opportunityId required.");
  }

  // Always fetch the opportunity — needed for actor guard and state machine
  const opportunity = await systemDb.getOpportunity(opportunityId);
  if (!opportunity) {
    return error("Opportunity not found.");
  }

  // Actor guard: caller must be a party to the opportunity
  const isActor = opportunity.actors?.some((a) => a.userId === context.userId);
  if (!isActor) {
    return error("Opportunity not found.");
  }

  // State machine: terminal statuses cannot be updated
  const TERMINAL = new Set(["accepted", "rejected", "expired"]);
  if (TERMINAL.has(opportunity.status)) {
    return error(`This opportunity is already ${opportunity.status} and cannot be updated.`);
  }

  // Strict scope enforcement: when chat is index-scoped, verify opportunity is in that index
  if (context.networkId) {
    const opportunityIndexId =
      opportunity.context?.networkId ??
      opportunity.actors?.find((a) => a.networkId === context.networkId)?.networkId;
    if (!opportunityIndexId || opportunityIndexId !== context.networkId) {
      return error("Opportunity not found.");
    }
  }

  const isSend = query.status === "pending";
  const _updateGraphStart = Date.now();
  const _updateTraceEmitter = requestContext.getStore()?.traceEmitter;
  _updateTraceEmitter?.({ type: "graph_start", name: "opportunity" });
  const result = await graphs.opportunity.invoke({
    userId: context.userId,
    operationMode: isSend ? ("send" as const) : ("update" as const),
    opportunityId: query.opportunityId,
    ...(isSend ? {} : { newStatus: query.status }),
  });
  const _updateGraphMs = Date.now() - _updateGraphStart;
  _updateTraceEmitter?.({ type: "graph_end", name: "opportunity", durationMs: _updateGraphMs });

  if (result.mutationResult) {
    if (result.mutationResult.success) {
      return success({
        opportunityId: result.mutationResult.opportunityId,
        status: query.status,
        message: result.mutationResult.message,
        ...(result.mutationResult.notified && { notified: result.mutationResult.notified }),
        _graphTimings: [{ name: 'opportunity', durationMs: _updateGraphMs, agents: result.agentTimings ?? [] }],
      });
    }
    return error(result.mutationResult.error || "Failed to update opportunity.");
  }
  return error("Failed to update opportunity.");
},
```

- [ ] **Step 2.4 — Run tests**

```bash
cd packages/protocol
bun test src/opportunity/tests/update-opportunity.spec.ts
```

Expected: All PASS.

- [ ] **Step 2.5 — Run existing opportunity tool tests to check for regressions**

```bash
cd packages/protocol
bun test src/opportunity/tests/opportunity.tools.spec.ts
```

Expected: All PASS.

- [ ] **Step 2.6 — Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.tools.ts \
        packages/protocol/src/opportunity/tests/update-opportunity.spec.ts
git commit -m "fix(mcp): add actor guard and state machine to update_opportunity"
```

---

## Task 3 — Strip `debugSteps` from MCP responses

**Problem:** `create_intent` and `create_opportunities` include a `debugSteps` array in the response data that contains internal algorithm details (LLM model names, RAG scores, HyDE queries) and other users' private profile data (bios, locations, intent summaries). This leaks through to every MCP caller.

**Fix:** Extend `sanitizeMcpResult` in `mcp.server.ts` to strip `debugSteps` alongside the existing `_`-prefixed key removal. `sanitizeMcpResult` already runs on every MCP tool response before it's returned to the client.

**Files:**
- Modify: `packages/protocol/src/mcp/mcp.server.ts` (function `sanitizeMcpResult`, ~line 101)
- Modify: `packages/protocol/src/mcp/tests/mcp.server.spec.ts`

---

- [ ] **Step 3.1 — Write failing test**

Open `packages/protocol/src/mcp/tests/mcp.server.spec.ts` and add:

```typescript
import { sanitizeMcpResult } from "../mcp.server.js";

describe("sanitizeMcpResult — debugSteps", () => {
  test("strips debugSteps from data", () => {
    const input = JSON.stringify({
      success: true,
      data: {
        count: 3,
        debugSteps: [
          { step: "prep", detail: "Fetched 2 intent(s)" },
          { step: "candidate", detail: "Alice: ✓ passed", data: { bio: "private bio", ragScore: 0.9 } },
        ],
      },
    });
    const { text, isError } = sanitizeMcpResult(input);
    const parsed = JSON.parse(text);
    expect(parsed.data.debugSteps).toBeUndefined();
    expect(parsed.data.count).toBe(3);
    expect(isError).toBe(false);
  });

  test("still strips _-prefixed keys alongside debugSteps", () => {
    const input = JSON.stringify({
      success: true,
      data: {
        message: "ok",
        _graphTimings: [{ name: "intent", durationMs: 120 }],
        debugSteps: [{ step: "prep" }],
      },
    });
    const { text } = sanitizeMcpResult(input);
    const parsed = JSON.parse(text);
    expect(parsed.data._graphTimings).toBeUndefined();
    expect(parsed.data.debugSteps).toBeUndefined();
    expect(parsed.data.message).toBe("ok");
  });

  test("leaves data unchanged when no debugSteps present", () => {
    const input = JSON.stringify({
      success: true,
      data: { count: 5, message: "found" },
    });
    const { text } = sanitizeMcpResult(input);
    const parsed = JSON.parse(text);
    expect(parsed.data.count).toBe(5);
    expect(parsed.data.message).toBe("found");
  });
});
```

- [ ] **Step 3.2 — Run to confirm test fails**

```bash
cd packages/protocol
bun test src/mcp/tests/mcp.server.spec.ts
```

Expected: FAIL — `debugSteps` is still present.

- [ ] **Step 3.3 — Update `sanitizeMcpResult`**

In `packages/protocol/src/mcp/mcp.server.ts`, change the loop inside `sanitizeMcpResult` (around line 111):

```typescript
// Before:
for (const key of Object.keys(parsed.data)) {
  if (key.startsWith('_')) {
    delete parsed.data[key];
  }
}

// After:
for (const key of Object.keys(parsed.data)) {
  if (key.startsWith('_') || key === 'debugSteps') {
    delete parsed.data[key];
  }
}
```

- [ ] **Step 3.4 — Run tests**

```bash
cd packages/protocol
bun test src/mcp/tests/mcp.server.spec.ts
```

Expected: All PASS.

- [ ] **Step 3.5 — Commit**

```bash
git add packages/protocol/src/mcp/mcp.server.ts \
        packages/protocol/src/mcp/tests/mcp.server.spec.ts
git commit -m "fix(mcp): strip debugSteps from MCP responses to prevent data leaks"
```

---

## Task 4 — Resilient profile fetch in `read_user_profiles` query mode

**Problem:** When searching by name without a `networkId`, the handler calls `systemDb.getProfile(m.userId)` for each matched member. For users with fragmented identity records (multiple user IDs, common in this dataset), `getProfile` throws `"Access denied: no shared index with user"` because the access check inside `getProfile` uses a different user ID than the one stored in the member index. One failing profile lookup crashes the entire search response.

**Fix:** Wrap the parallel `getProfile` calls in individual try-catch so a single failure is degraded gracefully (return the member's name without profile details) rather than propagating the error.

**Files:**
- Modify: `packages/protocol/src/profile/profile.tools.ts` (~line 111)
- Create: `packages/protocol/src/profile/tests/read-user-profiles-query.spec.ts`

---

- [ ] **Step 4.1 — Write failing test**

Create `packages/protocol/src/profile/tests/read-user-profiles-query.spec.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { createProfileTools } from "../profile.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(userId = "viewer-111"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Viewer", email: "v@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    isOnboarding: false,
    hasName: true,
  } as unknown as ResolvedToolContext;
}

function captureTool(deps: ToolDeps) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string> } | undefined;
  const defineTool = (def: any) => { if (def.name === "read_user_profiles") captured = def; return def; };
  createProfileTools(defineTool as any, deps);
  return captured!;
}

describe("read_user_profiles — query mode resilience", () => {
  test("returns partial results when getProfile throws for one member", async () => {
    const deps = {
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getMembersFromScope: async () => [
          { userId: "good-user", name: "Alice Smith", avatar: null },
          { userId: "bad-user",  name: "Alice Jones", avatar: null },
        ],
        // Throws for bad-user (e.g. fragmented identity), succeeds for good-user
        getProfile: async (userId: string) => {
          if (userId === "bad-user") throw new Error("Access denied: no shared index with user");
          return {
            identity: { name: "Alice Smith", bio: "Engineer", location: "NYC" },
            attributes: { skills: ["TypeScript"], interests: ["AI"] },
          };
        },
      },
      database: {},
      graphs: { profile: { invoke: async () => ({}) } },
      enricher: {},
      grantDefaultSystemPermissions: undefined,
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { query: "alice" } })
    );

    expect(result.success).toBe(true);
    expect(result.data.profiles).toHaveLength(2);

    const good = result.data.profiles.find((p: any) => p.userId === "good-user");
    expect(good.hasProfile).toBe(true);
    expect(good.profile.bio).toBe("Engineer");

    const bad = result.data.profiles.find((p: any) => p.userId === "bad-user");
    expect(bad.hasProfile).toBe(false);
    expect(bad.profile).toBeUndefined();
  });

  test("returns empty profiles array when no name matches", async () => {
    const deps = {
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getMembersFromScope: async () => [
          { userId: "user-a", name: "Bob Brown", avatar: null },
        ],
        getProfile: async () => null,
      },
      database: {},
      graphs: { profile: { invoke: async () => ({}) } },
      enricher: {},
      grantDefaultSystemPermissions: undefined,
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { query: "alice" } })
    );

    expect(result.success).toBe(true);
    expect(result.data.matchCount).toBe(0);
    expect(result.data.profiles).toHaveLength(0);
  });
});
```

- [ ] **Step 4.2 — Run to confirm test fails**

```bash
cd packages/protocol
bun test src/profile/tests/read-user-profiles-query.spec.ts
```

Expected: FAIL — the `getProfile` exception propagates and the whole call fails.

- [ ] **Step 4.3 — Wrap the profile fetch in try-catch**

In `packages/protocol/src/profile/profile.tools.ts`, replace the `Promise.all` block starting at line 111:

```typescript
// Before:
const profiles = await Promise.all(
  matched.map(async (m) => {
    const profile = await systemDb.getProfile(m.userId);
    return {
      userId: m.userId,
      name: m.name,
      hasProfile: !!profile,
      profile: profile
        ? {
            name: profile.identity.name,
            bio: profile.identity.bio,
            location: profile.identity.location,
            skills: profile.attributes.skills,
            interests: profile.attributes.interests,
          }
        : undefined,
    };
  })
);

// After:
const profiles = await Promise.all(
  matched.map(async (m) => {
    try {
      const profile = await systemDb.getProfile(m.userId);
      return {
        userId: m.userId,
        name: m.name,
        hasProfile: !!profile,
        profile: profile
          ? {
              name: profile.identity.name,
              bio: profile.identity.bio,
              location: profile.identity.location,
              skills: profile.attributes.skills,
              interests: profile.attributes.interests,
            }
          : undefined,
      };
    } catch {
      return { userId: m.userId, name: m.name, hasProfile: false };
    }
  })
);
```

- [ ] **Step 4.4 — Run tests**

```bash
cd packages/protocol
bun test src/profile/tests/read-user-profiles-query.spec.ts
```

Expected: All PASS.

- [ ] **Step 4.5 — Run existing profile tests to check for regressions**

```bash
cd packages/protocol
bun test src/profile/tests/
```

Expected: All PASS.

- [ ] **Step 4.6 — Commit**

```bash
git add packages/protocol/src/profile/profile.tools.ts \
        packages/protocol/src/profile/tests/read-user-profiles-query.spec.ts
git commit -m "fix(mcp): graceful profile fetch degradation in read_user_profiles query mode"
```

---

## Task 5 — Final verification

- [ ] **Step 5.1 — Run full test suite for affected domains**

```bash
cd packages/protocol
bun test src/intent/tests/ src/opportunity/tests/ src/profile/tests/ src/mcp/tests/
```

Expected: All PASS.

- [ ] **Step 5.2 — Type-check the protocol package**

```bash
cd packages/protocol
bun run build
```

Expected: No TypeScript errors.

- [ ] **Step 5.3 — Run backend tests**

```bash
cd backend
bun test tests/mcp.test.ts
```

Expected: All PASS.

- [ ] **Step 5.4 — Final commit (if any cleanup)**

If no changes needed, skip. Otherwise:

```bash
git add -A
git commit -m "chore: cleanup after MCP bug fix batch"
```

---

## Self-Review

**Spec coverage check:**
- Bug 1 (delete_intent/update_intent ownership): ✅ Task 1
- Bug 2 (update_opportunity state machine + actor guard): ✅ Task 2
- Bug 3 (debugSteps leak): ✅ Task 3
- Bug 4 (read_user_profiles query crash): ✅ Task 4

**Placeholder scan:** None found. All test code is complete, all implementation code is complete, all commands have expected outputs.

**Type consistency:** All methods used (`systemDb.getIntentWithOwnership`, `systemDb.getOpportunity`, `opportunity.actors`) are confirmed to exist in `database.interface.ts` and in the existing opportunity tools spec.

**Scope:** Four independent fixes, no cross-task dependencies. Tasks 1–4 can be executed in any order.
