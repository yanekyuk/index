# Opportunity Time-Based Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pair-existence dedup with time-based dedup (10 min window) to allow new opportunities between already-connected pairs while preventing parallel job duplicates.

**Architecture:** Modify the persist node's dedup logic in two places (introduction path and discovery path). Add `DEDUP_WINDOW_MS` constant. Change status handling: reactivate `expired`/`stalled`, upgrade `latent`, time-gate `accepted`/`rejected`/`pending`/`negotiating`.

**Tech Stack:** TypeScript, Bun test

**Spec:** `docs/superpowers/specs/2026-04-22-opportunity-time-based-dedup-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/protocol/src/opportunity/opportunity.graph.ts` | Modify | Add constant, refactor dedup logic in persist node |
| `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts` | Modify | Add time-based dedup tests |

---

### Task 1: Add DEDUP_WINDOW_MS constant

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts:2239`

- [ ] **Step 1: Add the constant after DEDUP_SKIP_STATUSES**

At line 2239, after `const DEDUP_SKIP_STATUSES`, add:

```typescript
          const DEDUP_SKIP_STATUSES: Array<'draft'> = ['draft'];
          const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts
git commit -m "feat(opportunity): add DEDUP_WINDOW_MS constant (10 min)"
```

---

### Task 2: Refactor discovery path dedup logic

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts:2477-2517`

- [ ] **Step 1: Replace the discovery path dedup block**

Find the block starting at line 2477 (`if (overlapping.length > 0) {`) in the discovery path (inside the `else` branch that handles non-introduction discovery, around line 2431).

Replace lines 2477-2517:

```typescript
              if (overlapping.length > 0) {
                const existing = overlapping[0];
                const existingIndexId = (existing.context?.networkId ?? state.networkId ?? state.userNetworks?.[0] ?? '') as Id<'networks'>;

                if (existing.status === 'expired') {
                  const reactivated = await this.database.updateOpportunityStatus(existing.id, initialStatus);
                  if (reactivated) {
                    logger.verbose('[Graph:Persist] Reactivated expired opportunity', {
                      opportunityId: existing.id,
                      candidateUserId,
                      newStatus: initialStatus,
                    });
                    reactivatedOpportunities.push(reactivated);
                  }
                } else if (existing.status === 'latent' && initialStatus !== 'latent') {
                  // Upgrade latent (background-discovered) to the higher-priority status (e.g. pending)
                  const upgraded = await this.database.updateOpportunityStatus(existing.id, initialStatus);
                  if (upgraded) {
                    logger.verbose('[Graph:Persist] Upgraded latent opportunity to higher-priority status', {
                      opportunityId: existing.id,
                      candidateUserId,
                      previousStatus: 'latent',
                      newStatus: initialStatus,
                    });
                    reactivatedOpportunities.push(upgraded);
                  }
                } else if (candidateUserId) {
                  existingBetweenActors.push({
                    candidateUserId: candidateUserId as Id<'users'>,
                    networkId: existingIndexId,
                    existingOpportunityId: existing.id as Id<'opportunities'>,
                    existingStatus: existing.status,
                  });
                  logger.verbose('[Graph:Persist] Skipping duplicate; opportunity already exists between actors', {
                    candidateUserId,
                    existingStatus: existing.status,
                    existingOpportunityId: existing.id,
                  });
                }
                continue;
              }
```

With this new block:

```typescript
              if (overlapping.length > 0) {
                const existing = overlapping[0];
                const existingIndexId = (existing.context?.networkId ?? state.networkId ?? state.userNetworks?.[0] ?? '') as Id<'networks'>;
                const isRecent = new Date(existing.createdAt).getTime() > Date.now() - DEDUP_WINDOW_MS;

                if (existing.status === 'expired' || existing.status === 'stalled') {
                  // Reactivate expired or stalled opportunities
                  const reactivated = await this.database.updateOpportunityStatus(existing.id, initialStatus);
                  if (reactivated) {
                    logger.verbose('[Graph:Persist] Reactivated opportunity', {
                      opportunityId: existing.id,
                      candidateUserId,
                      previousStatus: existing.status,
                      newStatus: initialStatus,
                    });
                    reactivatedOpportunities.push(reactivated);
                  }
                  continue;
                } else if (existing.status === 'latent' && initialStatus !== 'latent') {
                  // Upgrade latent (background-discovered) to the higher-priority status (e.g. pending)
                  const upgraded = await this.database.updateOpportunityStatus(existing.id, initialStatus);
                  if (upgraded) {
                    logger.verbose('[Graph:Persist] Upgraded latent opportunity to higher-priority status', {
                      opportunityId: existing.id,
                      candidateUserId,
                      previousStatus: 'latent',
                      newStatus: initialStatus,
                    });
                    reactivatedOpportunities.push(upgraded);
                  }
                  continue;
                } else if (isRecent && candidateUserId) {
                  // Time-gated skip: only skip if opportunity was created within DEDUP_WINDOW_MS
                  // This prevents parallel job duplicates while allowing new discoveries for long-connected pairs
                  existingBetweenActors.push({
                    candidateUserId: candidateUserId as Id<'users'>,
                    networkId: existingIndexId,
                    existingOpportunityId: existing.id as Id<'opportunities'>,
                    existingStatus: existing.status,
                  });
                  logger.verbose('[Graph:Persist] Skipping recent duplicate; opportunity created within dedup window', {
                    candidateUserId,
                    existingStatus: existing.status,
                    existingOpportunityId: existing.id,
                    createdAt: existing.createdAt,
                  });
                  continue;
                }
                // Else: existing opportunity is old enough (>10 min), allow new opportunity creation
                logger.verbose('[Graph:Persist] Allowing new opportunity; existing is outside dedup window', {
                  candidateUserId,
                  existingStatus: existing.status,
                  existingOpportunityId: existing.id,
                  createdAt: existing.createdAt,
                });
              }
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts
git commit -m "feat(opportunity): time-based dedup for discovery path

Replace pair-existence skip with time-gated skip (10 min window).
Reactivate expired/stalled, upgrade latent, allow new opps for old pairs."
```

---

### Task 3: Refactor introduction path dedup logic

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts:2373-2404`

- [ ] **Step 1: Replace the introduction path dedup block**

Find the block starting at line 2373 (`if (overlapping.length > 0) {`) in the introduction path (inside the `else if (state.onBehalfOfUserId)` branch).

Replace lines 2373-2404:

```typescript
              if (overlapping.length > 0) {
                const existing = overlapping[0];
                const sameIntroducer = existing.actors?.some(
                  (actor) => actor.role === 'introducer' && actor.userId === state.userId,
                );
                if (existing.status === 'expired' && sameIntroducer) {
                  const reactivated = await this.database.updateOpportunityStatus(existing.id, 'draft');
                  if (reactivated) reactivatedOpportunities.push(reactivated);
                  continue;
                }
                if (existing.status === 'latent') {
                  // Upgrade latent to draft for introduction path
                  const upgraded = await this.database.updateOpportunityStatus(existing.id, 'draft');
                  if (upgraded) {
                    logger.verbose('[Graph:Persist] Upgraded latent opportunity to draft (introduction path)', {
                      opportunityId: existing.id,
                      candidateUserId,
                    });
                    reactivatedOpportunities.push(upgraded);
                  }
                  continue;
                }
                if (existing.status !== 'expired' && candidateUserId) {
                  existingBetweenActors.push({
                    candidateUserId: candidateUserId as Id<'users'>,
                    networkId: (state.networkId ?? indexIdForActors ?? '') as Id<'networks'>,
                    existingOpportunityId: existing.id as Id<'opportunities'>,
                    existingStatus: existing.status,
                  });
                  continue;
                }
              }
```

With this new block:

```typescript
              if (overlapping.length > 0) {
                const existing = overlapping[0];
                const isRecent = new Date(existing.createdAt).getTime() > Date.now() - DEDUP_WINDOW_MS;
                const sameIntroducer = existing.actors?.some(
                  (actor) => actor.role === 'introducer' && actor.userId === state.userId,
                );

                if (existing.status === 'expired' || existing.status === 'stalled') {
                  // Reactivate expired or stalled opportunities (only if same introducer for expired)
                  if (existing.status === 'stalled' || sameIntroducer) {
                    const reactivated = await this.database.updateOpportunityStatus(existing.id, 'draft');
                    if (reactivated) {
                      logger.verbose('[Graph:Persist] Reactivated opportunity (introduction path)', {
                        opportunityId: existing.id,
                        candidateUserId,
                        previousStatus: existing.status,
                      });
                      reactivatedOpportunities.push(reactivated);
                    }
                    continue;
                  }
                } else if (existing.status === 'latent') {
                  // Upgrade latent to draft for introduction path
                  const upgraded = await this.database.updateOpportunityStatus(existing.id, 'draft');
                  if (upgraded) {
                    logger.verbose('[Graph:Persist] Upgraded latent opportunity to draft (introduction path)', {
                      opportunityId: existing.id,
                      candidateUserId,
                    });
                    reactivatedOpportunities.push(upgraded);
                  }
                  continue;
                } else if (isRecent && candidateUserId) {
                  // Time-gated skip: only skip if opportunity was created within DEDUP_WINDOW_MS
                  existingBetweenActors.push({
                    candidateUserId: candidateUserId as Id<'users'>,
                    networkId: (state.networkId ?? indexIdForActors ?? '') as Id<'networks'>,
                    existingOpportunityId: existing.id as Id<'opportunities'>,
                    existingStatus: existing.status,
                  });
                  logger.verbose('[Graph:Persist] Skipping recent duplicate (introduction path)', {
                    candidateUserId,
                    existingStatus: existing.status,
                    existingOpportunityId: existing.id,
                  });
                  continue;
                }
                // Else: existing opportunity is old enough, allow new opportunity creation
                logger.verbose('[Graph:Persist] Allowing new opportunity; existing is outside dedup window (introduction path)', {
                  candidateUserId,
                  existingStatus: existing.status,
                  existingOpportunityId: existing.id,
                });
              }
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts
git commit -m "feat(opportunity): time-based dedup for introduction path

Apply same time-gated dedup logic to introducer discovery flow."
```

---

### Task 4: Add test for parallel job dedup (IND-166 regression)

**Files:**
- Modify: `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`

- [ ] **Step 1: Add test for parallel job dedup**

Add this test at the end of the file, before the closing of the main `describe` block:

```typescript
describe('time-based dedup', () => {
  test('skips creation when opportunity was created within 10 minutes (parallel job dedup)', async () => {
    const recentOpportunity: Opportunity = {
      id: 'recent-opp-1',
      status: 'latent',
      createdAt: new Date(), // Just created
      updatedAt: new Date(),
      expiresAt: null,
      detection: { source: 'opportunity_graph', createdBy: 'agent', timestamp: new Date().toISOString() },
      actors: [
        { networkId: 'idx-1', userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' },
        { networkId: 'idx-1', userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' },
      ],
      interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.8 },
      context: { networkId: 'idx-1' },
      confidence: '0.8',
    };

    const mockDb: OpportunityGraphDatabase = {
      ...createMockGraph().mockDb,
      findOverlappingOpportunities: () => Promise.resolve([recentOpportunity]),
      createOpportunity: () => { throw new Error('Should not create'); },
    };

    const factory = new OpportunityGraphFactory(
      mockDb,
      { generate: () => Promise.resolve([dummyEmbedding]) } as Embedder,
      { invoke: () => Promise.resolve({ hydeEmbeddings: { default: dummyEmbedding } }) },
      createMockEvaluator(),
    );
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
      searchQuery: 'Find collaborators',
      operationMode: 'create',
      options: {},
    });

    // Should skip creation, existing opportunity is within dedup window
    expect(result.opportunities.length).toBe(0);
    expect(result.existingBetweenActors?.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (TDD red phase)**

Run: `cd packages/protocol && bun test tests/opportunity.graph.spec.ts -t "skips creation when opportunity was created within 10 minutes"`
Expected: FAIL (test infrastructure may need adjustment)

- [ ] **Step 3: If test fails due to missing mockDb export, fix the test setup**

The test may need access to the mockDb. If `createMockGraph()` doesn't expose it, inline the mock:

```typescript
  test('skips creation when opportunity was created within 10 minutes (parallel job dedup)', async () => {
    const recentOpportunity: Opportunity = {
      id: 'recent-opp-1',
      status: 'latent',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
      detection: { source: 'opportunity_graph', createdBy: 'agent', timestamp: new Date().toISOString() },
      actors: [
        { networkId: 'idx-1', userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' },
        { networkId: 'idx-1', userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' },
      ],
      interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.8 },
      context: { networkId: 'idx-1' },
      confidence: '0.8',
    };

    let createCalled = false;
    const mockDb: OpportunityGraphDatabase = {
      getProfile: () => Promise.resolve(null),
      createOpportunity: () => { createCalled = true; return Promise.resolve(recentOpportunity); },
      opportunityExistsBetweenActors: () => Promise.resolve(false),
      getAcceptedOpportunitiesBetweenActors: () => Promise.resolve([]),
      getOpportunityBetweenActors: () => Promise.resolve(null),
      findOverlappingOpportunities: () => Promise.resolve([recentOpportunity]),
      getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
      getNetworkMemberships: () => Promise.resolve([{ networkId: 'idx-1', networkTitle: 'Test', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }]),
      getActiveIntents: () => Promise.resolve([{ id: 'intent-1' as Id<'intents'>, payload: 'Test', summary: 'Test', createdAt: new Date() }]),
      getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
      getNetworkMemberCount: () => Promise.resolve(2),
      getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
      getUser: () => Promise.resolve({ id: 'user-1', name: 'Test', email: 'test@test.com' }),
      isNetworkMember: () => Promise.resolve(true),
      isIndexOwner: () => Promise.resolve(false),
      getOpportunity: () => Promise.resolve(null),
      getOpportunitiesForUser: () => Promise.resolve([]),
      updateOpportunityStatus: () => Promise.resolve(null),
      updateOpportunityActorApproval: () => Promise.resolve(null),
      getIntent: () => Promise.resolve(null),
      getIntentNetworkIds: () => Promise.resolve([]),
      getIndexMembersWithProfiles: () => Promise.resolve([]),
      searchProfilesByEmbedding: () => Promise.resolve([]),
      searchIntentsByEmbedding: () => Promise.resolve([]),
    };

    const factory = new OpportunityGraphFactory(
      mockDb,
      { generate: () => Promise.resolve([dummyEmbedding]) } as Embedder,
      { invoke: () => Promise.resolve({ hydeEmbeddings: { default: dummyEmbedding } }) },
      createMockEvaluator(),
    );
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
      searchQuery: 'Find collaborators',
      operationMode: 'create',
      options: {},
    });

    expect(createCalled).toBe(false);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/protocol && bun test tests/opportunity.graph.spec.ts -t "skips creation when opportunity was created within 10 minutes"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts
git commit -m "test(opportunity): add parallel job dedup test (IND-166 regression)"
```

---

### Task 5: Add test for allowing new opportunity for old accepted pair

**Files:**
- Modify: `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`

- [ ] **Step 1: Add test for old accepted pair**

Add this test inside the `describe('time-based dedup')` block:

```typescript
  test('allows new opportunity when accepted opportunity is older than 10 minutes', async () => {
    const oldAcceptedOpportunity: Opportunity = {
      id: 'old-accepted-opp',
      status: 'accepted',
      createdAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
      updatedAt: new Date(Date.now() - 15 * 60 * 1000),
      expiresAt: null,
      detection: { source: 'opportunity_graph', createdBy: 'agent', timestamp: new Date().toISOString() },
      actors: [
        { networkId: 'idx-1', userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' },
        { networkId: 'idx-1', userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' },
      ],
      interpretation: { category: 'collaboration', reasoning: 'old reason', confidence: 0.8 },
      context: { networkId: 'idx-1' },
      confidence: '0.8',
    };

    let createCalled = false;
    const mockDb: OpportunityGraphDatabase = {
      getProfile: () => Promise.resolve(null),
      createOpportunity: (data) => {
        createCalled = true;
        return Promise.resolve({
          id: 'new-opp-1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
        } as Opportunity);
      },
      opportunityExistsBetweenActors: () => Promise.resolve(false),
      getAcceptedOpportunitiesBetweenActors: () => Promise.resolve([oldAcceptedOpportunity]),
      getOpportunityBetweenActors: () => Promise.resolve(null),
      findOverlappingOpportunities: () => Promise.resolve([oldAcceptedOpportunity]),
      getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
      getNetworkMemberships: () => Promise.resolve([{ networkId: 'idx-1', networkTitle: 'Test', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }]),
      getActiveIntents: () => Promise.resolve([{ id: 'intent-1' as Id<'intents'>, payload: 'Test', summary: 'Test', createdAt: new Date() }]),
      getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
      getNetworkMemberCount: () => Promise.resolve(2),
      getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
      getUser: () => Promise.resolve({ id: 'user-1', name: 'Test', email: 'test@test.com' }),
      isNetworkMember: () => Promise.resolve(true),
      isIndexOwner: () => Promise.resolve(false),
      getOpportunity: () => Promise.resolve(null),
      getOpportunitiesForUser: () => Promise.resolve([]),
      updateOpportunityStatus: () => Promise.resolve(null),
      updateOpportunityActorApproval: () => Promise.resolve(null),
      getIntent: () => Promise.resolve(null),
      getIntentNetworkIds: () => Promise.resolve([]),
      getIndexMembersWithProfiles: () => Promise.resolve([]),
      searchProfilesByEmbedding: () => Promise.resolve([]),
      searchIntentsByEmbedding: () => Promise.resolve([]),
    };

    const factory = new OpportunityGraphFactory(
      mockDb,
      { generate: () => Promise.resolve([dummyEmbedding]) } as Embedder,
      { invoke: () => Promise.resolve({ hydeEmbeddings: { default: dummyEmbedding } }) },
      createMockEvaluator(),
    );
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
      searchQuery: 'Find collaborators for new project',
      operationMode: 'create',
      options: {},
    });

    expect(createCalled).toBe(true);
    expect(result.opportunities.length).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/protocol && bun test tests/opportunity.graph.spec.ts -t "allows new opportunity when accepted opportunity is older than 10 minutes"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts
git commit -m "test(opportunity): verify new opp allowed for old accepted pairs"
```

---

### Task 6: Add test for stalled reactivation

**Files:**
- Modify: `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`

- [ ] **Step 1: Add test for stalled reactivation**

Add this test inside the `describe('time-based dedup')` block:

```typescript
  test('reactivates stalled opportunity instead of creating new', async () => {
    const stalledOpportunity: Opportunity = {
      id: 'stalled-opp-1',
      status: 'stalled',
      createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
      updatedAt: new Date(Date.now() - 30 * 60 * 1000),
      expiresAt: null,
      detection: { source: 'opportunity_graph', createdBy: 'agent', timestamp: new Date().toISOString() },
      actors: [
        { networkId: 'idx-1', userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' },
        { networkId: 'idx-1', userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' },
      ],
      interpretation: { category: 'collaboration', reasoning: 'stalled reason', confidence: 0.7 },
      context: { networkId: 'idx-1' },
      confidence: '0.7',
    };

    let updateStatusCalled = false;
    let updateStatusArgs: { id: string; status: string } | null = null;
    const mockDb: OpportunityGraphDatabase = {
      getProfile: () => Promise.resolve(null),
      createOpportunity: () => { throw new Error('Should not create new opportunity'); },
      opportunityExistsBetweenActors: () => Promise.resolve(false),
      getAcceptedOpportunitiesBetweenActors: () => Promise.resolve([]),
      getOpportunityBetweenActors: () => Promise.resolve(null),
      findOverlappingOpportunities: () => Promise.resolve([stalledOpportunity]),
      getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
      getNetworkMemberships: () => Promise.resolve([{ networkId: 'idx-1', networkTitle: 'Test', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }]),
      getActiveIntents: () => Promise.resolve([{ id: 'intent-1' as Id<'intents'>, payload: 'Test', summary: 'Test', createdAt: new Date() }]),
      getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
      getNetworkMemberCount: () => Promise.resolve(2),
      getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
      getUser: () => Promise.resolve({ id: 'user-1', name: 'Test', email: 'test@test.com' }),
      isNetworkMember: () => Promise.resolve(true),
      isIndexOwner: () => Promise.resolve(false),
      getOpportunity: () => Promise.resolve(null),
      getOpportunitiesForUser: () => Promise.resolve([]),
      updateOpportunityStatus: (id, status) => {
        updateStatusCalled = true;
        updateStatusArgs = { id, status };
        return Promise.resolve({ ...stalledOpportunity, status } as Opportunity);
      },
      updateOpportunityActorApproval: () => Promise.resolve(null),
      getIntent: () => Promise.resolve(null),
      getIntentNetworkIds: () => Promise.resolve([]),
      getIndexMembersWithProfiles: () => Promise.resolve([]),
      searchProfilesByEmbedding: () => Promise.resolve([]),
      searchIntentsByEmbedding: () => Promise.resolve([]),
    };

    const factory = new OpportunityGraphFactory(
      mockDb,
      { generate: () => Promise.resolve([dummyEmbedding]) } as Embedder,
      { invoke: () => Promise.resolve({ hydeEmbeddings: { default: dummyEmbedding } }) },
      createMockEvaluator(),
    );
    const graph = factory.createGraph();

    await graph.invoke({
      userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
      searchQuery: 'Find collaborators',
      operationMode: 'create',
      options: {},
    });

    expect(updateStatusCalled).toBe(true);
    expect(updateStatusArgs?.id).toBe('stalled-opp-1');
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/protocol && bun test tests/opportunity.graph.spec.ts -t "reactivates stalled opportunity"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts
git commit -m "test(opportunity): verify stalled opportunities are reactivated"
```

---

### Task 7: Add test for stuck negotiating fix

**Files:**
- Modify: `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`

- [ ] **Step 1: Add test for stuck negotiating**

Add this test inside the `describe('time-based dedup')` block:

```typescript
  test('allows new opportunity when negotiating opportunity is older than 10 minutes (unstick)', async () => {
    const stuckNegotiatingOpportunity: Opportunity = {
      id: 'stuck-negotiating-opp',
      status: 'negotiating',
      createdAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
      updatedAt: new Date(Date.now() - 15 * 60 * 1000),
      expiresAt: null,
      detection: { source: 'opportunity_graph', createdBy: 'agent', timestamp: new Date().toISOString() },
      actors: [
        { networkId: 'idx-1', userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' },
        { networkId: 'idx-1', userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' },
      ],
      interpretation: { category: 'collaboration', reasoning: 'stuck', confidence: 0.8 },
      context: { networkId: 'idx-1' },
      confidence: '0.8',
    };

    let createCalled = false;
    const mockDb: OpportunityGraphDatabase = {
      getProfile: () => Promise.resolve(null),
      createOpportunity: (data) => {
        createCalled = true;
        return Promise.resolve({
          id: 'new-opp-1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
        } as Opportunity);
      },
      opportunityExistsBetweenActors: () => Promise.resolve(false),
      getAcceptedOpportunitiesBetweenActors: () => Promise.resolve([]),
      getOpportunityBetweenActors: () => Promise.resolve(null),
      findOverlappingOpportunities: () => Promise.resolve([stuckNegotiatingOpportunity]),
      getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
      getNetworkMemberships: () => Promise.resolve([{ networkId: 'idx-1', networkTitle: 'Test', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }]),
      getActiveIntents: () => Promise.resolve([{ id: 'intent-1' as Id<'intents'>, payload: 'Test', summary: 'Test', createdAt: new Date() }]),
      getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
      getNetworkMemberCount: () => Promise.resolve(2),
      getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
      getUser: () => Promise.resolve({ id: 'user-1', name: 'Test', email: 'test@test.com' }),
      isNetworkMember: () => Promise.resolve(true),
      isIndexOwner: () => Promise.resolve(false),
      getOpportunity: () => Promise.resolve(null),
      getOpportunitiesForUser: () => Promise.resolve([]),
      updateOpportunityStatus: () => Promise.resolve(null),
      updateOpportunityActorApproval: () => Promise.resolve(null),
      getIntent: () => Promise.resolve(null),
      getIntentNetworkIds: () => Promise.resolve([]),
      getIndexMembersWithProfiles: () => Promise.resolve([]),
      searchProfilesByEmbedding: () => Promise.resolve([]),
      searchIntentsByEmbedding: () => Promise.resolve([]),
    };

    const factory = new OpportunityGraphFactory(
      mockDb,
      { generate: () => Promise.resolve([dummyEmbedding]) } as Embedder,
      { invoke: () => Promise.resolve({ hydeEmbeddings: { default: dummyEmbedding } }) },
      createMockEvaluator(),
    );
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
      searchQuery: 'Find collaborators',
      operationMode: 'create',
      options: {},
    });

    expect(createCalled).toBe(true);
    expect(result.opportunities.length).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/protocol && bun test tests/opportunity.graph.spec.ts -t "allows new opportunity when negotiating opportunity is older than 10 minutes"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts
git commit -m "test(opportunity): verify stuck negotiating allows new opp after 10 min"
```

---

### Task 8: Run full test suite and final commit

**Files:**
- All modified files

- [ ] **Step 1: Run all opportunity graph tests**

Run: `cd packages/protocol && bun test tests/opportunity.graph.spec.ts`
Expected: All tests PASS

- [ ] **Step 2: Run type check**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Run related tests to check for regressions**

Run: `cd packages/protocol && bun test tests/opportunity.persist.spec.ts tests/opportunity.enricher.spec.ts`
Expected: All tests PASS

- [ ] **Step 4: Final verification commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore(opportunity): fix any test adjustments from review"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add DEDUP_WINDOW_MS constant |
| 2 | Refactor discovery path dedup |
| 3 | Refactor introduction path dedup |
| 4 | Test: parallel job dedup (IND-166 regression) |
| 5 | Test: old accepted pair allows new opp |
| 6 | Test: stalled reactivation |
| 7 | Test: stuck negotiating fix |
| 8 | Full test suite verification |
