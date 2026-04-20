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
- Modify: `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`

- [ ] **Step 1: Add test for `accepted` path calling `getOrCreateDM`**

Append this `describe` block to `opportunity.graph.spec.ts` (after the existing test blocks):

```typescript
describe('updateNode — accepted status', () => {
  const userId = 'u0000000-0000-4000-8000-000000000001' as Id<'users'>;
  const counterpartId = 'u0000000-0000-4000-8000-000000000002' as Id<'users'>;
  const opportunityId = 'op000000-0000-4000-8000-000000000001';
  const conversationId = 'conv0000-0000-4000-8000-000000000001';
  const networkId = 'net00000-0000-4000-8000-000000000001' as Id<'networks'>;

  const mockOpportunity = {
    id: opportunityId,
    status: 'pending',
    actors: [
      { userId, role: 'party', networkId },
      { userId: counterpartId, role: 'party', networkId },
    ],
    detection: { source: 'manual' },
    interpretation: { reasoning: '', confidence: 1 },
    context: {},
    confidence: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  } as unknown as Opportunity;

  test('calls getOrCreateDM with userId and counterpart, returns conversationId', async () => {
    let getOrCreateDMCalled = false;
    let getOrCreateDMArgs: [string, string] | null = null;

    const factory = createMockGraph({
      getOpportunity: mockOpportunity,
    });

    // Override getOrCreateDM on the mock after factory creation is not possible
    // directly — so we override via the deps approach: pass overrides
    const overriddenDb: OpportunityGraphDatabase = {
      ...factory['database' as never],
      getOpportunity: () => Promise.resolve(mockOpportunity),
      updateOpportunityStatus: () => Promise.resolve(null),
      getOrCreateDM: (a: string, b: string) => {
        getOrCreateDMCalled = true;
        getOrCreateDMArgs = [a, b];
        return Promise.resolve({ id: conversationId });
      },
    };

    const overriddenFactory = new OpportunityGraphFactory(
      overriddenDb,
      { generate: () => Promise.resolve([]), search: () => Promise.resolve([]), searchWithHydeEmbeddings: () => Promise.resolve([]), searchWithProfileEmbedding: () => Promise.resolve([]) } as unknown as Embedder,
      { invoke: () => Promise.resolve({ hydeEmbeddings: { mirror: [], reciprocal: [] } }) },
      createMockEvaluator(),
      async () => undefined,
    );

    const graph = overriddenFactory.createGraph();
    const result = await graph.invoke({
      userId,
      operationMode: 'update',
      opportunityId,
      newStatus: 'accepted',
    });

    expect(result.mutationResult?.success).toBe(true);
    expect(result.mutationResult?.conversationId).toBe(conversationId);
    expect(getOrCreateDMCalled).toBe(true);
    expect(getOrCreateDMArgs).toEqual([userId, counterpartId]);
  });

  test('does NOT call getOrCreateDM when newStatus is rejected', async () => {
    let getOrCreateDMCalled = false;

    const overriddenDb: OpportunityGraphDatabase = {
      ...({} as OpportunityGraphDatabase),
      getOpportunity: () => Promise.resolve(mockOpportunity),
      updateOpportunityStatus: () => Promise.resolve(null),
      getOrCreateDM: () => {
        getOrCreateDMCalled = true;
        return Promise.resolve({ id: conversationId });
      },
      getUserIndexIds: () => Promise.resolve([networkId]),
      getNetworkMemberships: async () => [],
      getActiveIntents: async () => [],
      getNetwork: async () => ({ id: networkId, title: 'Test' }),
      getNetworkMemberCount: async () => 2,
      getNetworkIdsForIntent: async () => [],
      getIntentIndexScores: async () => [],
      getNetworkMemberContext: async () => null,
      getProfile: async () => null,
      createOpportunity: async (data) => ({ ...data, id: 'opp-1', status: 'pending', createdAt: new Date(), updatedAt: new Date(), expiresAt: null }),
      opportunityExistsBetweenActors: async () => false,
      getOpportunityBetweenActors: async () => null,
      findOverlappingOpportunities: async () => [],
      getAcceptedOpportunitiesBetweenActors: async () => [],
      getOpportunitiesForUser: async () => [],
      updateOpportunityActorApproval: async () => null,
      isNetworkMember: async () => true,
      isIndexOwner: async () => false,
      getUser: async (id) => ({ id, name: 'Test', email: 'test@example.com' }),
      getIntent: async () => null,
    } as unknown as OpportunityGraphDatabase;

    const overriddenFactory = new OpportunityGraphFactory(
      overriddenDb,
      { generate: () => Promise.resolve([]), search: () => Promise.resolve([]), searchWithHydeEmbeddings: () => Promise.resolve([]), searchWithProfileEmbedding: () => Promise.resolve([]) } as unknown as Embedder,
      { invoke: () => Promise.resolve({ hydeEmbeddings: { mirror: [], reciprocal: [] } }) },
      createMockEvaluator(),
      async () => undefined,
    );

    const graph = overriddenFactory.createGraph();
    const result = await graph.invoke({
      userId,
      operationMode: 'update',
      opportunityId,
      newStatus: 'rejected',
    });

    expect(result.mutationResult?.success).toBe(true);
    expect(result.mutationResult?.conversationId).toBeUndefined();
    expect(getOrCreateDMCalled).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/protocol && bun test src/opportunity/tests/opportunity.graph.spec.ts 2>&1 | tail -20
```

Expected: both new tests fail — `getOrCreateDM` is not a method / `conversationId` is undefined.

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

- [ ] **Step 2: Run the new tests**

```bash
cd packages/protocol && bun test src/opportunity/tests/opportunity.graph.spec.ts 2>&1 | tail -20
```

Expected: both new tests pass.

- [ ] **Step 3: Run the full opportunity graph spec to check for regressions**

```bash
cd packages/protocol && bun test src/opportunity/tests/ 2>&1 | tail -20
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
        packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts
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
