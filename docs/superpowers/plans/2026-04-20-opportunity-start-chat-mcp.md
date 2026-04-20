# Opportunity Start Chat via MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `update_opportunity` with `accepted` create a DM conversation (matching frontend "Start Chat"), and teach the MCP agent to ask user approval before accepting.

**Architecture:** Extend the opportunity graph's `update` node to call `getOrCreateDM` when `newStatus === 'accepted'`, propagate `conversationId` through state and tool response, then add approval-gating guidance to `MCP_INSTRUCTIONS`.

**Tech Stack:** TypeScript, LangGraph (`Annotation`), Bun test

---

### Task 1: Add `conversationId` to `mutationResult` state type

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.state.ts:438-447`

- [ ] **Step 1: Add `conversationId` field to the `mutationResult` Annotation**

In `opportunity.state.ts` replace the `mutationResult` Annotation definition (lines 438–447):

```typescript
  /** Output for update/delete/send modes. */
  mutationResult: Annotation<{
    success: boolean;
    message?: string;
    opportunityId?: string;
    notified?: string[];
    conversationId?: string;
    error?: string;
  } | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/protocol && bun run build 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.state.ts
git commit -m "feat(opportunity): add conversationId to mutationResult state"
```

---

### Task 2: Add `getOrCreateDM` to `OpportunityGraphDatabase`

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts:1740-1750`

- [ ] **Step 1: Add `'getOrCreateDM'` to the `OpportunityGraphDatabase` Pick**

In `database.interface.ts`, in the `OpportunityGraphDatabase` Pick block, add after `| 'getUser'`:

```typescript
  // Read/update/send modes
  | 'getOpportunity'
  | 'getOpportunitiesForUser'
  | 'updateOpportunityStatus'
  | 'updateOpportunityActorApproval'
  | 'isNetworkMember'
  | 'isIndexOwner'
  | 'getUser'
  | 'getOrCreateDM'
  // Load candidate intent payload/summary for evaluator
  | 'getIntent'
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/protocol && bun run build 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/shared/interfaces/database.interface.ts
git commit -m "feat(opportunity): expose getOrCreateDM on OpportunityGraphDatabase"
```

---

### Task 3: Write failing test for `update` node `accepted` path

**Files:**
- Create: `packages/protocol/src/opportunity/tests/opportunity.graph.update.spec.ts`

> **Note:** Do NOT add to the existing `opportunity.graph.spec.ts` — it has pre-existing import bugs (`test` and `spyOn` not imported). Write a new standalone file following the pattern of `introducer-gating-lifecycle.spec.ts`.
>
> **Note:** Protocol tests must be run from the `backend/` directory so that `.env.test` (which contains `OPENROUTER_API_KEY`) is resolved. All `bun test` commands for protocol tests in this plan run from `backend/`.

- [ ] **Step 1: Create the new spec file**

Create `packages/protocol/src/opportunity/tests/opportunity.graph.update.spec.ts`:

```typescript
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, test, expect } from 'bun:test';
import { OpportunityGraphFactory } from '../opportunity.graph.js';
import type { Id } from '../../types/common.types.js';
import type {
  OpportunityGraphDatabase,
  Opportunity,
} from '../../shared/interfaces/database.interface.js';
import type { Embedder } from '../../shared/interfaces/embedder.interface.js';
import type { OpportunityEvaluatorLike } from '../opportunity.graph.js';

const mockEvaluator: OpportunityEvaluatorLike = {
  invokeEntityBundle: async () => [],
};

const dummyEmbedder = {
  generate: async () => [],
  search: async () => [],
  searchWithHydeEmbeddings: async () => [],
  searchWithProfileEmbedding: async () => [],
} as unknown as Embedder;

const dummyHyde = {
  invoke: async () => ({ hydeEmbeddings: { mirror: [], reciprocal: [] } }),
};

function buildDb(overrides: Partial<OpportunityGraphDatabase>): OpportunityGraphDatabase {
  const base: OpportunityGraphDatabase = {
    getProfile: async () => null,
    createOpportunity: async (data) => ({
      ...data,
      id: 'opp-1',
      status: 'pending' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    }),
    opportunityExistsBetweenActors: async () => false,
    getAcceptedOpportunitiesBetweenActors: async () => [],
    getOpportunityBetweenActors: async () => null,
    findOverlappingOpportunities: async () => [],
    getUserIndexIds: async () => [] as Id<'networks'>[],
    getNetworkMemberships: async () => [],
    getActiveIntents: async () => [],
    getNetworkIdsForIntent: async () => [],
    getNetwork: async () => null,
    getNetworkMemberCount: async () => 0,
    getIntentIndexScores: async () => [],
    getNetworkMemberContext: async () => null,
    getOpportunity: async () => null,
    getOpportunitiesForUser: async () => [],
    updateOpportunityStatus: async () => null,
    updateOpportunityActorApproval: async () => null,
    isNetworkMember: async () => true,
    isIndexOwner: async () => false,
    getUser: async (id) => ({ id, name: 'Test', email: 'test@example.com' }),
    getOrCreateDM: async () => ({ id: 'conv-default' }),
    getIntent: async () => null,
  };
  return { ...base, ...overrides };
}

const USER_ID = 'u0000000-0000-4000-8000-000000000001' as Id<'users'>;
const COUNTERPART_ID = 'u0000000-0000-4000-8000-000000000002' as Id<'users'>;
const OPP_ID = 'op000000-0000-4000-8000-000000000001';
const CONV_ID = 'conv0000-0000-4000-8000-000000000001';
const NET_ID = 'net00000-0000-4000-8000-000000000001' as Id<'networks'>;

const mockOpportunity = {
  id: OPP_ID,
  status: 'pending',
  actors: [
    { userId: USER_ID, role: 'party', networkId: NET_ID },
    { userId: COUNTERPART_ID, role: 'party', networkId: NET_ID },
  ],
  detection: { source: 'manual' },
  interpretation: { reasoning: '', confidence: 1 },
  context: {},
  confidence: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: null,
} as unknown as Opportunity;

describe('opportunity graph — update node (accepted)', () => {
  test('calls getOrCreateDM with userId and counterpart, returns conversationId', async () => {
    let dmCalledWith: [string, string] | null = null;

    const db = buildDb({
      getOpportunity: async () => mockOpportunity,
      updateOpportunityStatus: async () => null,
      getOrCreateDM: async (a, b) => {
        dmCalledWith = [a, b];
        return { id: CONV_ID };
      },
    });

    const graph = new OpportunityGraphFactory(db, dummyEmbedder, dummyHyde, mockEvaluator, async () => undefined).createGraph();
    const result = await graph.invoke({
      userId: USER_ID,
      operationMode: 'update' as const,
      opportunityId: OPP_ID,
      newStatus: 'accepted',
    });

    expect(result.mutationResult?.success).toBe(true);
    expect(result.mutationResult?.conversationId).toBe(CONV_ID);
    expect(dmCalledWith).toEqual([USER_ID, COUNTERPART_ID]);
  });

  test('does NOT call getOrCreateDM when newStatus is rejected', async () => {
    let dmCalled = false;

    const db = buildDb({
      getOpportunity: async () => mockOpportunity,
      updateOpportunityStatus: async () => null,
      getOrCreateDM: async () => {
        dmCalled = true;
        return { id: CONV_ID };
      },
    });

    const graph = new OpportunityGraphFactory(db, dummyEmbedder, dummyHyde, mockEvaluator, async () => undefined).createGraph();
    const result = await graph.invoke({
      userId: USER_ID,
      operationMode: 'update' as const,
      opportunityId: OPP_ID,
      newStatus: 'rejected',
    });

    expect(result.mutationResult?.success).toBe(true);
    expect(result.mutationResult?.conversationId).toBeUndefined();
    expect(dmCalled).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (run from `backend/` directory)**

```bash
cd backend && bun test ../packages/protocol/src/opportunity/tests/opportunity.graph.update.spec.ts 2>&1 | tail -15
```

Expected: both new tests fail — `getOrCreateDM` is not a property on `OpportunityGraphDatabase` / `conversationId` is undefined.

---

### Task 4: Implement `getOrCreateDM` call in the graph update node

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts:2756-2767`

- [ ] **Step 1: Replace the update node's status-update and return block**

In `opportunity.graph.ts`, replace lines 2756–2767 (from `await this.database.updateOpportunityStatus(` through the closing `};` of the success return):

```typescript
          let conversationId: string | undefined;
          if (state.newStatus === 'accepted') {
            const counterpart = opp.actors.find(
              (a: OpportunityActor) => a.userId !== state.userId && a.role !== 'introducer'
            );
            if (counterpart) {
              const dm = await this.database.getOrCreateDM(state.userId, counterpart.userId);
              conversationId = dm.id;
            }
          }

          await this.database.updateOpportunityStatus(
            state.opportunityId,
            state.newStatus as 'accepted' | 'rejected' | 'expired'
          );

          return {
            mutationResult: {
              success: true,
              opportunityId: state.opportunityId,
              message: `Opportunity status updated to ${state.newStatus}.`,
              ...(conversationId && { conversationId }),
            },
          };
```

- [ ] **Step 2: Run the new tests (from `backend/` directory)**

```bash
cd backend && bun test ../packages/protocol/src/opportunity/tests/opportunity.graph.update.spec.ts 2>&1 | tail -15
```

Expected: both new tests pass.

- [ ] **Step 3: Run related protocol tests to check for regressions (from `backend/` directory)**

```bash
cd backend && bun test ../packages/protocol/src/opportunity/tests/introducer-gating-lifecycle.spec.ts ../packages/protocol/src/opportunity/tests/opportunity.graph.update.spec.ts 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd packages/protocol && bun run build 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts \
        packages/protocol/src/opportunity/tests/opportunity.graph.update.spec.ts
git commit -m "feat(opportunity): call getOrCreateDM when accepting opportunity in graph update node"
```

---

### Task 5: Thread `conversationId` through the `update_opportunity` tool

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.tools.ts:1041-1113`

- [ ] **Step 1: Update the `accepted` description and thread `conversationId` in the handler**

In `opportunity.tools.ts`, make two edits:

**Edit 1** — Replace the `accepted` line in the description (line ~1046):

```typescript
      "- `accepted`: Accept a received opportunity — opens a direct conversation between both parties. " +
      "Returns a conversationId to surface to the user.\n" +
```

**Edit 2** — In the success return block (lines ~1097-1105), add `conversationId`:

```typescript
          return success({
            opportunityId: result.mutationResult.opportunityId,
            status: query.status,
            message: result.mutationResult.message,
            ...(result.mutationResult.notified && {
              notified: result.mutationResult.notified,
            }),
            ...(result.mutationResult.conversationId && {
              conversationId: result.mutationResult.conversationId,
            }),
            _graphTimings: [{ name: 'opportunity', durationMs: _updateGraphMs, agents: result.agentTimings ?? [] }],
          });
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/protocol && bun run build 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.tools.ts
git commit -m "feat(opportunity): surface conversationId in update_opportunity accepted response"
```

---

### Task 6: Add opportunity lifecycle guidance to `MCP_INSTRUCTIONS`

**Files:**
- Modify: `packages/protocol/src/mcp/mcp.server.ts:147-179`

- [ ] **Step 1: Add the `# Opportunity lifecycle` section to `MCP_INSTRUCTIONS`**

In `mcp.server.ts`, insert the following section before the closing `` `.trim() `` (after the `# Authentication` section):

```typescript
# Opportunity lifecycle
Opportunities move through: draft → pending → accepted (or rejected).

- **draft** (you created it, not yet sent): offer to send it; confirm before calling update_opportunity with pending.
- **pending, you sent it**: waiting for the other side — nothing to do.
- **pending, you received it**: the other person is waiting for your response. Surface it to the user and ask if they want to start a chat. Only call update_opportunity with accepted after explicit user confirmation.
- **accepted**: both sides are connected — a direct conversation exists. Surface the conversationId to the user if available.

Never accept a received opportunity without explicit user approval in the current conversation.
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/protocol && bun run build 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/mcp/mcp.server.ts
git commit -m "feat(mcp): add opportunity lifecycle approval guidance to MCP_INSTRUCTIONS"
```

---

## Self-Review

**Spec coverage:**
- ✅ Graph update node calls `getOrCreateDM` when `accepted` — Task 4
- ✅ `conversationId` returned from graph → state type → tool response — Tasks 1, 4, 5
- ✅ `update_opportunity` description updated for `accepted` — Task 5
- ✅ `MCP_INSTRUCTIONS` approval guidance — Task 6
- ✅ `OpportunityGraphDatabase` includes `getOrCreateDM` — Task 2
- ✅ Tests cover `accepted` calls DM and `rejected` does not — Task 3

**Placeholder scan:** No TBDs, no "similar to task N", all code blocks complete.

**Type consistency:**
- `conversationId` field name consistent across state (Task 1), graph (Task 4), and tool (Task 5).
- `getOrCreateDM(a, b)` returns `{ id: string }` — matches `DatabaseInterface` declaration at line 1250. ✅
- `OpportunityActor` imported in graph file already (line 2751 references it). ✅
