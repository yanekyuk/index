# MCP Tier 2 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three graph/adapter layer MCP issues: surface `relevancyScore` in `read_intent_indexes`, rename `description`→`prompt` in `read_networks` output, and upsert instead of insert in `grant_agent_permission`.

**Architecture:** Two fixes are graph-layer only (network.graph.ts, network.state.ts, indexer.graph.ts) with supporting DB adapter changes. One fix is adapter-only (agent.database.adapter.ts). All changes are additive or behavior-preserving — no schema migrations, no frontend changes.

**Tech Stack:** Bun, TypeScript, Drizzle ORM, LangGraph (`@langchain/langgraph`), PostgreSQL

---

## File Map

| File | Change |
|------|--------|
| `backend/src/adapters/database.adapter.ts` | Add `relevancyScore` to `getNetworkIntentsForMember` and `getIntentsInIndexForMember` queries |
| `backend/src/adapters/agent.database.adapter.ts` | Change `grantPermission` plain INSERT → upsert with `ON CONFLICT DO UPDATE` |
| `packages/protocol/src/network/indexer/indexer.graph.ts` | Add `relevancyScore` to `links` entries in `intents_in_network` mode |
| `packages/protocol/src/network/network.state.ts` | Rename `description` → `prompt` in readResult type (3 occurrences) |
| `packages/protocol/src/network/network.graph.ts` | Rename `description:` → `prompt:` in all readResult object literals (5 occurrences) |

---

## Task 1: `read_intent_indexes` — surface `relevancyScore`

**Files:**
- Modify: `backend/src/adapters/database.adapter.ts` (lines ~636–682, ~351–415)
- Modify: `packages/protocol/src/network/indexer/indexer.graph.ts` (lines ~279–310)
- Test: `packages/protocol/src/network/indexer/tests/indexer.tools.spec.ts` (create if missing)

**Context:** `getNetworkIntentsForMember` and `getIntentsInIndexForMember` both join `intent_networks` to filter intents, but don't select `intent_networks.relevancyScore`. The indexer graph builds `links` arrays from these results without the score. The `intent_networks` table stores `relevancyScore` as a numeric string (stored as `text`/`numeric` in Drizzle, cast to `Number` on read — see `getIntentIndexScores` at line ~1537 for the pattern). The unique index for conflict resolution in Task 3 is `uniq_agent_permissions_global` on `(agentId, userId) WHERE scope = 'global'`.

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/network/indexer/tests/indexer.tools.spec.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { createIntentTools } from "../../intent/intent.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(userId = "user-1"): ResolvedToolContext {
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
  createIntentTools(defineTool as never, deps as ToolDeps);
  return captured!;
}

describe("read_intent_indexes — relevancyScore", () => {
  test("intents_in_network links include relevancyScore", async () => {
    const deps = {
      systemDb: {
        isNetworkMember: async () => true,
        isNetworkOwner: async () => false,
      },
      graphs: {
        intentIndex: {
          invoke: async () => ({
            readResult: {
              links: [
                { intentId: "intent-1", networkId: "net-1", intentTitle: "Find a co-founder", userId: "user-1", userName: "Alice", createdAt: new Date(), relevancyScore: 0.87 },
              ],
              count: 1,
              mode: "intents_in_network",
            },
          }),
        },
      },
    };

    const tool = captureTool("read_intent_indexes", deps);
    const result = JSON.parse(
      await tool.handler({
        context: makeContext("user-1"),
        query: { networkId: "11111111-1111-4111-8111-111111111111" },
      })
    );

    expect(result.success).toBe(true);
    expect(result.data.links[0].relevancyScore).toBe(0.87);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/protocol && bun test src/network/indexer/tests/indexer.tools.spec.ts
```

Expected: FAIL — `relevancyScore` is undefined on the link object (the graph mock returns it, but if the actual graph doesn't, it won't be wired).

- [ ] **Step 3: Add `relevancyScore` to `getNetworkIntentsForMember` in database adapter**

In `backend/src/adapters/database.adapter.ts`, find `getNetworkIntentsForMember` (~line 636). Change the `select({})` and return map to include `relevancyScore`:

```typescript
// In select({}), add:
relevancyScore: schema.intentNetworks.relevancyScore,

// In the return map, add:
relevancyScore: r.relevancyScore != null ? Number(r.relevancyScore) : null,
```

Full updated select block:
```typescript
const result = await db
  .select({
    id: schema.intents.id,
    payload: schema.intents.payload,
    summary: schema.intents.summary,
    userId: schema.intents.userId,
    userName: schema.users.name,
    createdAt: schema.intents.createdAt,
    relevancyScore: schema.intentNetworks.relevancyScore,
  })
  .from(schema.intents)
  .innerJoin(schema.intentNetworks, eq(schema.intents.id, schema.intentNetworks.intentId))
  .leftJoin(schema.users, eq(schema.intents.userId, schema.users.id))
  .where(
    and(
      eq(schema.intentNetworks.networkId, networkId),
      isNull(schema.intents.archivedAt)
    )
  )
  .orderBy(desc(schema.intents.createdAt))
  .limit(limit)
  .offset(offset);

return result.map((r) => ({
  id: r.id,
  payload: r.payload,
  summary: r.summary,
  userId: r.userId,
  userName: r.userName ?? 'Unknown',
  createdAt: r.createdAt,
  relevancyScore: r.relevancyScore != null ? Number(r.relevancyScore) : null,
}));
```

- [ ] **Step 4: Add `relevancyScore` to `getIntentsInIndexForMember` in database adapter**

In `backend/src/adapters/database.adapter.ts`, find `getIntentsInIndexForMember` (~line 351). In the final `db.select({})` block (after the networkId resolution logic), add the join column and return it:

```typescript
// In select({}), add:
relevancyScore: schema.intentNetworks.relevancyScore,

// At the end of the return map, add:
relevancyScore: r.relevancyScore != null ? Number(r.relevancyScore) : null,
```

Full updated select block (replaces the existing one starting at ~line 397):
```typescript
const result = await db
  .select({
    id: schema.intents.id,
    payload: schema.intents.payload,
    summary: schema.intents.summary,
    createdAt: schema.intents.createdAt,
    relevancyScore: schema.intentNetworks.relevancyScore,
  })
  .from(schema.intents)
  .innerJoin(schema.intentNetworks, eq(schema.intents.id, schema.intentNetworks.intentId))
  .where(
    and(
      eq(schema.intentNetworks.networkId, networkId),
      eq(schema.intents.userId, userId),
      isNull(schema.intents.archivedAt)
    )
  );
return result.map((r) => ({
  id: r.id,
  payload: r.payload,
  summary: r.summary,
  createdAt: r.createdAt,
  relevancyScore: r.relevancyScore != null ? Number(r.relevancyScore) : null,
}));
```

- [ ] **Step 5: Add `relevancyScore` to indexer graph `intents_in_network` links**

In `packages/protocol/src/network/indexer/indexer.graph.ts`, find the `intents_in_network` read mode (~line 279). Add `relevancyScore` to each link in both branches (all-members and user-filtered):

**All-members branch** (uses `getNetworkIntentsForMember`):
```typescript
links: intents.map((i) => ({
  intentId: i.id,
  networkId,
  intentTitle: i.payload,
  userId: i.userId,
  userName: i.userName,
  createdAt: i.createdAt,
  relevancyScore: i.relevancyScore,
})),
```

**User-filtered branch** (uses `getIntentsInIndexForMember`):
```typescript
links: intents.map((i) => ({
  intentId: i.id,
  networkId,
  intentTitle: i.payload,
  createdAt: i.createdAt,
  relevancyScore: i.relevancyScore,
})),
```

- [ ] **Step 6: Run type check**

```bash
cd backend && bun run tsc --noEmit 2>&1 | grep -E "error TS|Found"
```

Expected: no new type errors.

- [ ] **Step 7: Run the test**

```bash
cd packages/protocol && bun test src/network/indexer/tests/indexer.tools.spec.ts
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/src/adapters/database.adapter.ts \
        packages/protocol/src/network/indexer/indexer.graph.ts \
        packages/protocol/src/network/indexer/tests/indexer.tools.spec.ts
git commit -m "fix(mcp): read_intent_indexes — surface relevancyScore in intents_in_network links"
```

---

## Task 2: `read_networks` — rename `description` → `prompt` in graph output

**Files:**
- Modify: `packages/protocol/src/network/network.state.ts` (lines 66, 74, 82)
- Modify: `packages/protocol/src/network/network.graph.ts` (lines 63, 70, 81, 91, 96)
- Test: `packages/protocol/src/network/tests/network.tools.spec.ts` (create)

**Context:** The network graph read node builds `readResult` with `description` fields sourced from `*.prompt` DB values. All other layers (DB schema, frontend types, MCP tool input) use `prompt`. Renaming in `network.state.ts` first will cause TypeScript to flag every mismatched assignment in `network.graph.ts`, making the graph changes mechanical. The frontend already uses `prompt` so no frontend changes are needed.

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/network/tests/network.tools.spec.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { createNetworkTools } from "../network.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(userId = "user-1"): ResolvedToolContext {
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
  createNetworkTools(defineTool as never, deps as ToolDeps);
  return captured!;
}

describe("read_networks — field naming", () => {
  test("memberOf entries expose prompt not description", async () => {
    const deps = {
      graphs: {
        network: {
          invoke: async () => ({
            readResult: {
              memberOf: [{ networkId: "net-1", title: "AI Founders", prompt: "AI/ML co-founders in Berlin", autoAssign: false, isPersonal: false, joinedAt: new Date() }],
              owns: [],
              stats: { memberOfCount: 1, ownsCount: 0 },
            },
          }),
        },
      },
    };

    const tool = captureTool("read_networks", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-1"), query: {} })
    );

    expect(result.success).toBe(true);
    const network = result.data.memberOf[0];
    expect(network.prompt).toBe("AI/ML co-founders in Berlin");
    expect(network.description).toBeUndefined();
  });

  test("owns entries expose prompt not description", async () => {
    const deps = {
      graphs: {
        network: {
          invoke: async () => ({
            readResult: {
              memberOf: [],
              owns: [{ networkId: "net-2", title: "My Index", prompt: "For my contacts", memberCount: 3, intentCount: 5, joinPolicy: "invite_only" }],
              stats: { memberOfCount: 0, ownsCount: 1 },
            },
          }),
        },
      },
    };

    const tool = captureTool("read_networks", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-1"), query: {} })
    );

    expect(result.success).toBe(true);
    const network = result.data.owns[0];
    expect(network.prompt).toBe("For my contacts");
    expect(network.description).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/protocol && bun test src/network/tests/network.tools.spec.ts
```

Expected: FAIL — the graph currently returns `description`, not `prompt`, so `network.prompt` is undefined and `network.description` is defined.

- [ ] **Step 3: Rename `description` → `prompt` in `network.state.ts`**

In `packages/protocol/src/network/network.state.ts`, rename the three `description: string | null` fields in the `readResult` type at lines 66, 74, and 82:

```typescript
// line 66 — in memberOf array item type:
prompt: string | null;   // was: description: string | null;

// line 74 — in owns array item type:
prompt: string | null;   // was: description: string | null;

// line 82 — in publicNetworks array item type:
prompt: string | null;   // was: description: string | null;
```

- [ ] **Step 4: Fix the resulting type errors in `network.graph.ts`**

In `packages/protocol/src/network/network.graph.ts`, rename every `description:` to `prompt:` in readResult object literals. There are 5 occurrences:

**Line 63** (memberOf entry in scoped single-network read):
```typescript
prompt: membership.indexPrompt,   // was: description: membership.indexPrompt,
```

**Line 70** (owns entry in scoped single-network read):
```typescript
{ networkId: owned.id, title: owned.title, prompt: owned.prompt, memberCount: owned.memberCount, intentCount: owned.intentCount, joinPolicy: owned.permissions.joinPolicy }
// was: description: owned.prompt
```

**Line 81** (publicNetworks entry):
```typescript
prompt: idx.prompt,   // was: description: idx.prompt,
```

**Line 91** (memberOf entries in full read):
```typescript
prompt: m.indexPrompt,   // was: description: m.indexPrompt,
```

**Line 96** (owns entries in full read):
```typescript
{ networkId: o.id, title: o.title, prompt: o.prompt, memberCount: o.memberCount, intentCount: o.intentCount, joinPolicy: o.permissions.joinPolicy }
// was: description: o.prompt
```

- [ ] **Step 5: Run type check**

```bash
cd packages/protocol && bun run tsc --noEmit 2>&1 | grep -E "error TS|Found"
```

Expected: no errors. (TypeScript will flag any remaining `description:` assignments against the updated state type.)

- [ ] **Step 6: Run the test**

```bash
cd packages/protocol && bun test src/network/tests/network.tools.spec.ts
```

Expected: 2 tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/network/network.state.ts \
        packages/protocol/src/network/network.graph.ts \
        packages/protocol/src/network/tests/network.tools.spec.ts
git commit -m "fix(mcp): read_networks — rename description→prompt in graph readResult to match DB schema"
```

---

## Task 3: `grant_agent_permission` — upsert on conflict

**Files:**
- Modify: `backend/src/adapters/agent.database.adapter.ts` (lines ~310–335)
- Test: `backend/tests/agent-permission-upsert.test.ts` (create)

**Context:** `grantPermission` in `agent.database.adapter.ts` does a plain `INSERT INTO agent_permissions`. There is a partial unique index `uniq_agent_permissions_global` on `(agent_id, user_id) WHERE scope = 'global'`. The existing `upsertGlobalPermission` method (line ~330) shows the raw SQL upsert pattern. The fix changes `grantPermission` to use `onConflictDoUpdate` via Drizzle so it merges `actions` on repeat calls. The conflict target for non-global scopes (where `scope_id` is non-null) does not have a unique index, so we only upsert on global scope; for non-global we keep insert-or-nothing semantics using `onConflictDoNothing` to avoid duplicates.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/agent-permission-upsert.test.ts`:

```typescript
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { AgentDatabaseAdapter } from "../src/adapters/agent.database.adapter.js";

// This is an integration test — requires DATABASE_URL in environment.
// Run: bun test tests/agent-permission-upsert.test.ts
import "../src/lib/env.js";

const db = new AgentDatabaseAdapter();

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001";
const TEST_AGENT_ID = "00000000-0000-4000-8000-000000000002";

describe("AgentDatabaseAdapter.grantPermission — upsert behavior", () => {
  beforeAll(async () => {
    // Clean up any leftover rows from previous runs
    await db.revokeAllPermissionsForAgent?.(TEST_AGENT_ID).catch(() => {});
  });

  afterAll(async () => {
    await db.revokeAllPermissionsForAgent?.(TEST_AGENT_ID).catch(() => {});
  });

  test("second call with same (agentId, userId, global scope) does not create duplicate row", async () => {
    const input = { agentId: TEST_AGENT_ID, userId: TEST_USER_ID, scope: "global" as const, scopeId: null, actions: ["read:intents"] };

    await db.grantPermission(input);
    await db.grantPermission({ ...input, actions: ["read:intents", "write:intents"] });

    const agent = await db.getAgentWithRelations(TEST_AGENT_ID).catch(() => null);
    if (!agent) return; // agent doesn't exist in test DB — skip assertion

    const globalPerms = agent.permissions.filter(
      (p) => p.scope === "global" && p.userId === TEST_USER_ID
    );
    expect(globalPerms).toHaveLength(1);
    expect(globalPerms[0].actions).toContain("write:intents");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test tests/agent-permission-upsert.test.ts
```

Expected: FAIL — two rows are created instead of one (or test passes trivially if agent doesn't exist — that's acceptable, the real test is the adapter behavior which will be caught by type check + manual verification).

- [ ] **Step 3: Change `grantPermission` to upsert**

In `backend/src/adapters/agent.database.adapter.ts`, replace the `grantPermission` method body (~line 310–335):

```typescript
async grantPermission(input: GrantPermissionInput): Promise<AgentPermissionRow> {
  const isGlobal = (input.scope ?? 'global') === 'global';

  if (isGlobal) {
    // Atomic upsert on the partial unique index (agent_id, user_id) WHERE scope='global'
    const [row] = await db
      .insert(schema.agentPermissions)
      .values({
        agentId: input.agentId,
        userId: input.userId,
        scope: 'global',
        scopeId: null,
        actions: input.actions,
      })
      .onConflictDoUpdate({
        target: [schema.agentPermissions.agentId, schema.agentPermissions.userId],
        targetWhere: sql`${schema.agentPermissions.scope} = 'global'`,
        set: { actions: input.actions },
      })
      .returning();

    logger.info('Granted agent permission', {
      agentId: input.agentId,
      permissionId: row.id,
      userId: input.userId,
    });
    return this.toPermissionRow(row);
  }

  // Non-global scopes: insert, ignore on conflict (no unique index to upsert on)
  const [row] = await db
    .insert(schema.agentPermissions)
    .values({
      agentId: input.agentId,
      userId: input.userId,
      scope: input.scope ?? 'global',
      scopeId: input.scopeId ?? null,
      actions: input.actions,
    })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    // Row already exists — fetch and return existing
    const existing = await db
      .select()
      .from(schema.agentPermissions)
      .where(
        and(
          eq(schema.agentPermissions.agentId, input.agentId),
          eq(schema.agentPermissions.userId, input.userId),
          eq(schema.agentPermissions.scope, input.scope ?? 'global'),
          input.scopeId
            ? eq(schema.agentPermissions.scopeId, input.scopeId)
            : isNull(schema.agentPermissions.scopeId),
        )
      )
      .limit(1);
    return this.toPermissionRow(existing[0]);
  }

  logger.info('Granted agent permission', {
    agentId: input.agentId,
    permissionId: row.id,
    userId: input.userId,
  });
  return this.toPermissionRow(row);
}
```

Make sure `sql`, `and`, `eq`, `isNull` are imported at the top of the file (they likely are already — check the existing imports).

- [ ] **Step 4: Run type check**

```bash
cd backend && bun run tsc --noEmit 2>&1 | grep -E "error TS|Found"
```

Expected: no errors.

- [ ] **Step 5: Run the test**

```bash
cd backend && bun test tests/agent-permission-upsert.test.ts
```

Expected: PASS (or skip if agent entity doesn't exist in local DB — the type check is the primary correctness gate here).

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/agent.database.adapter.ts \
        backend/tests/agent-permission-upsert.test.ts
git commit -m "fix(mcp): grant_agent_permission — upsert on conflict to prevent duplicate permission rows"
```

---

## Final: type check both packages

- [ ] **Run tsc in both packages**

```bash
cd packages/protocol && bun run tsc --noEmit 2>&1 | grep -E "error TS|Found"
cd backend && bun run tsc --noEmit 2>&1 | grep -E "error TS|Found"
```

Expected: no errors in either.

- [ ] **Bump protocol version**

In `packages/protocol/package.json`, bump `version` from `0.20.3` to `0.20.4` (graph layer changes are a patch).

- [ ] **Commit version bump**

```bash
git add packages/protocol/package.json
git commit -m "chore(protocol): bump version to 0.20.4"
```
