# Introducer Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent negotiation from running automatically for introducer-pattern opportunities; instead, gate negotiation behind an explicit introducer approval action.

**Architecture:** Add `approved?: boolean` to `OpportunityActor`; per-opportunity check in `negotiateNode` skips opportunities whose introducer hasn't approved; new `approve_introduction` graph mode sets `approved: true` and enqueues a `negotiate_existing` job; new `negotiate_existing` graph mode loads an existing opportunity by ID and runs the negotiate node normally.

**Tech Stack:** TypeScript, LangGraph (`@langchain/langgraph`), Drizzle ORM, BullMQ, Bun test

---

## File Map

| File | Change |
|------|--------|
| `packages/protocol/src/shared/interfaces/database.interface.ts` | Add `approved?: boolean` to `OpportunityActor`; add `updateOpportunityActorApproval` to `Database` and `OpportunityGraphDatabase` |
| `backend/src/adapters/database.adapter.ts` | Implement `updateOpportunityActorApproval` |
| `packages/protocol/src/opportunity/opportunity.state.ts` | Add `negotiate_existing` and `approve_introduction` to `operationMode` union |
| `packages/protocol/src/opportunity/opportunity.graph.ts` | (1) persist node: write `approved: false` on introducer actor; (2) negotiate node: per-opportunity gate; (3) new `negotiateExistingNode`; (4) new `approveIntroductionNode`; (5) update `routeByMode` and graph wiring; (6) add `queueNegotiateExisting` constructor param |
| `backend/src/queues/opportunity.queue.ts` | Add `opportunityId` to `OpportunityJobData`; add `addNegotiateJob`; add `negotiate_existing` job handler; wire `queueNegotiateExisting` into factory |
| `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts` | Tests for negotiate gate, `negotiate_existing`, `approve_introduction` |

---

## Task 1: Add `approved` to `OpportunityActor` and persist it at create time

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts:36-41`
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts` (persist node, introducer path ~line 2323)

- [ ] **Step 1: Add `approved?: boolean` to `OpportunityActor`**

In `packages/protocol/src/shared/interfaces/database.interface.ts`, update the `OpportunityActor` interface:

```typescript
/** A participant (user + network) involved in an opportunity. */
export interface OpportunityActor {
  networkId: Id<'networks'>;
  userId: Id<'users'>;
  intent?: Id<'intents'>;
  role: string;
  /** Only set on role === 'introducer'. false until the introducer explicitly approves; true after approval. */
  approved?: boolean;
}
```

- [ ] **Step 2: Write `approved: false` on the introducer actor in the persist node**

In `opportunity.graph.ts`, find the introducer path in the persist node (~line 2324). Change:

```typescript
actors = viewerAlreadyInActors
  ? evaluatorActors
  : [
      ...evaluatorActors,
      { networkId: indexIdForActors!, userId: state.userId, role: 'introducer' as const },
    ];
```

To:

```typescript
actors = viewerAlreadyInActors
  ? evaluatorActors
  : [
      ...evaluatorActors,
      { networkId: indexIdForActors!, userId: state.userId, role: 'introducer' as const, approved: false },
    ];
```

- [ ] **Step 3: Run the existing introducer-path test to confirm no regression**

```bash
cd packages/protocol
bun test src/opportunity/tests/opportunity.graph.spec.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/shared/interfaces/database.interface.ts \
        packages/protocol/src/opportunity/opportunity.graph.ts
git -c commit.gpgsign=false commit -m "feat(opportunity): add approved field to OpportunityActor, write false at introducer persist time"
```

---

## Task 2: Add `updateOpportunityActorApproval` DB method

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts`
- Modify: `backend/src/adapters/database.adapter.ts`

- [ ] **Step 1: Write a failing test for the DB method**

Create `backend/tests/opportunity-actor-approval.spec.ts`:

```typescript
import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { DatabaseAdapter } from '../src/adapters/database.adapter';

describe('updateOpportunityActorApproval', () => {
  const db = new DatabaseAdapter();

  it('sets approved=true on the introducer actor without changing status', async () => {
    // Create an opportunity with an introducer actor directly via createOpportunity
    const opp = await db.createOpportunity({
      detection: { source: 'manual', createdBy: 'test', timestamp: new Date().toISOString() },
      actors: [
        { networkId: 'net-1' as any, userId: 'target-1' as any, role: 'patient' },
        { networkId: 'net-1' as any, userId: 'candidate-1' as any, role: 'agent' },
        { networkId: 'net-1' as any, userId: 'introducer-1' as any, role: 'introducer', approved: false },
      ],
      interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.8, signals: [] },
      context: { networkId: 'net-1' as any },
      confidence: '0.8',
      status: 'latent',
    });

    const updated = await db.updateOpportunityActorApproval(opp.id, 'introducer-1', true);

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('latent');
    const introducerActor = updated!.actors.find((a: any) => a.role === 'introducer');
    expect(introducerActor?.approved).toBe(true);

    // Other actors unchanged
    const patientActor = updated!.actors.find((a: any) => a.role === 'patient');
    expect(patientActor?.approved).toBeUndefined();

    await db.updateOpportunityStatus(opp.id, 'expired');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
bun test tests/opportunity-actor-approval.spec.ts
```

Expected: FAIL — `db.updateOpportunityActorApproval is not a function`

- [ ] **Step 3: Add method signature to `Database` interface**

In `database.interface.ts`, after `updateOpportunityStatus`:

```typescript
/**
 * Update the `approved` field on an opportunity's introducer actor.
 * Fetches the opportunity, patches the matching actor in JS, and writes
 * the updated actors JSONB back. Returns the updated opportunity or null.
 */
updateOpportunityActorApproval(
  id: string,
  introducerUserId: string,
  approved: boolean,
): Promise<Opportunity | null>;
```

Add `'updateOpportunityActorApproval'` to the `OpportunityGraphDatabase` Pick (around line 1729):

```typescript
export type OpportunityGraphDatabase = Pick<
  Database,
  | 'getProfile'
  | 'createOpportunity'
  | 'opportunityExistsBetweenActors'
  | 'getOpportunityBetweenActors'
  | 'findOverlappingOpportunities'
  | 'getAcceptedOpportunitiesBetweenActors'
  | 'getUserIndexIds'
  | 'getNetworkMemberships'
  | 'getActiveIntents'
  | 'getNetworkIdsForIntent'
  | 'getNetwork'
  | 'getNetworkMemberCount'
  | 'getIntentIndexScores'
  | 'getNetworkMemberContext'
  // Read/update/send modes
  | 'getOpportunity'
  | 'getOpportunitiesForUser'
  | 'updateOpportunityStatus'
  | 'updateOpportunityActorApproval'   // NEW
  | 'isNetworkMember'
  | 'isIndexOwner'
  | 'getUser'
  // Load candidate intent payload/summary for evaluator
  | 'getIntent'
>;
```

- [ ] **Step 4: Implement `updateOpportunityActorApproval` in the adapter**

In `backend/src/adapters/database.adapter.ts`, after `updateOpportunityStatus`:

```typescript
async updateOpportunityActorApproval(
  id: string,
  introducerUserId: string,
  approved: boolean,
): Promise<OpportunityRow | null> {
  const existing = await this.getOpportunity(id);
  if (!existing) return null;
  const updatedActors = existing.actors.map((actor: OpportunityActor) =>
    actor.role === 'introducer' && actor.userId === introducerUserId
      ? { ...actor, approved }
      : actor,
  );
  const [row] = await db
    .update(opportunities)
    .set({ actors: updatedActors, updatedAt: new Date() })
    .where(eq(opportunities.id, id))
    .returning();
  return row ? toOpportunityRow(row) : null;
}
```

Also add the method stub to any mock database classes in the codebase that implement `Database` (search for classes implementing `OpportunityGraphDatabase` in test helpers — add `updateOpportunityActorApproval: () => Promise.resolve(null)` stubs).

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend
bun test tests/opportunity-actor-approval.spec.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/shared/interfaces/database.interface.ts \
        backend/src/adapters/database.adapter.ts \
        backend/tests/opportunity-actor-approval.spec.ts
git -c commit.gpgsign=false commit -m "feat(db): add updateOpportunityActorApproval method"
```

---

## Task 3: Gate negotiate node — skip unapproved introducer opportunities

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts` (negotiateNode ~line 1673)
- Modify: `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`

- [ ] **Step 1: Write a failing test**

In `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`, add after the existing tests:

```typescript
test('negotiateNode does not negotiate when introducer actor has approved: false', async () => {
  const negotiationInvocations: unknown[] = [];
  const mockNegotiationGraph: NegotiationGraphLike = {
    invoke: mock((input) => {
      negotiationInvocations.push(input);
      return Promise.resolve({
        outcome: { hasOpportunity: false, agreedRoles: [], reasoning: '', turnCount: 0 },
      });
    }),
  };

  const mockDb: OpportunityGraphDatabase = {
    ...buildMinimalMockDb(),
    createOpportunity: (data) =>
      Promise.resolve({
        id: 'opp-introducer',
        ...data,
        status: data.status ?? 'latent',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      }),
    findOverlappingOpportunities: () => Promise.resolve([]),
    updateOpportunityActorApproval: () => Promise.resolve(null),
  };

  const factory = new OpportunityGraphFactory(
    mockDb,
    buildMinimalMockEmbedder(),
    buildMinimalMockHyde(),
    createMockEvaluator([{
      reasoning: 'Good match',
      score: 85,
      actors: [
        { userId: 'target-user' as Id<'users'>, role: 'patient' as const, intentId: null },
        { userId: 'candidate-user' as Id<'users'>, role: 'agent' as const, intentId: null },
      ],
    }]),
    undefined,
    mockNegotiationGraph,
  );

  await factory.createGraph().invoke({
    userId: 'introducer-user' as Id<'users'>,
    onBehalfOfUserId: 'target-user' as Id<'users'>,
    searchQuery: 'co-founder',
    operationMode: 'create',
    options: { initialStatus: 'latent' as const },
  });

  // Negotiation must NOT have been called — introducer has not approved yet
  expect(negotiationInvocations).toHaveLength(0);
});
```

Note: `buildMinimalMockDb`, `buildMinimalMockEmbedder`, `buildMinimalMockHyde` are helper calls — use the existing `createMockGraph` helper in the file instead, extracting its `mockDb`, `mockEmbedder`, `mockHydeGenerator`. Adapt as needed so the factory is constructed with the mock negotiation graph.

The simplest approach: add `negotiationGraph?: NegotiationGraphLike` to `createMockGraph`'s `deps` parameter and pass it through to the factory constructor.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/protocol
bun test src/opportunity/tests/opportunity.graph.spec.ts 2>&1 | tail -20
```

Expected: FAIL — the mock negotiation graph IS being called (current behavior)

- [ ] **Step 3: Add the per-opportunity gate in `negotiateNode`**

In `opportunity.graph.ts`, locate the `candidateEntries` map inside `negotiateNode` (~line 1673). Add the introducer check as the first condition:

```typescript
const candidateEntries = state.opportunities
  .map(opp => {
    // Skip opportunities where an introducer exists but has not yet approved.
    const introducerActor = (opp.actors as OpportunityActor[])
      .find(a => a.role === 'introducer');
    if (introducerActor && introducerActor.approved !== true) return null;

    const candidateActor = (opp.actors as Array<{ userId: string; role?: string; networkId?: string; intentId?: string }>)
      .find(a => a.userId !== discoveryUserId);
    if (!candidateActor) return null;
    return { opp, candidateActor };
  })
  .filter((e): e is NonNullable<typeof e> => e !== null);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/protocol
bun test src/opportunity/tests/opportunity.graph.spec.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 5: Confirm existing negotiation tests still pass**

```bash
cd backend
bun test tests/opportunity.negotiation.spec.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts \
        packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts
git -c commit.gpgsign=false commit -m "feat(opportunity): gate negotiate node — skip unapproved introducer opportunities"
```

---

## Task 4: Add `negotiate_existing` operation mode

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.state.ts:249`
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts`
- Modify: `backend/src/queues/opportunity.queue.ts`
- Modify: `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`

- [ ] **Step 1: Write a failing test**

In `opportunity.graph.spec.ts`, add:

```typescript
test('negotiate_existing mode runs negotiation for a specific existing opportunity', async () => {
  const negotiationInvocations: Array<{ sourceUser: { id: string }; candidateUser: { id: string } }> = [];
  const mockNegotiationGraph: NegotiationGraphLike = {
    invoke: mock((input) => {
      negotiationInvocations.push({ sourceUser: input.sourceUser, candidateUser: input.candidateUser });
      return Promise.resolve({
        outcome: { hasOpportunity: true, agreedRoles: [], reasoning: 'ok', turnCount: 2 },
      });
    }),
  };

  const existingOpp: Opportunity = {
    id: 'opp-existing' as any,
    status: 'latent',
    actors: [
      { networkId: 'idx-1' as any, userId: 'target-user' as any, role: 'patient' },
      { networkId: 'idx-1' as any, userId: 'candidate-user' as any, role: 'agent' },
      { networkId: 'idx-1' as any, userId: 'introducer-user' as any, role: 'introducer', approved: true },
    ],
    detection: { source: 'manual', createdBy: 'introducer-user', timestamp: new Date().toISOString() },
    interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.8, signals: [] },
    context: { networkId: 'idx-1' as any },
    confidence: '0.8',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };

  const { compiledGraph } = createMockGraph({
    negotiationGraph: mockNegotiationGraph,
    getOpportunity: () => Promise.resolve(existingOpp),
    updateOpportunityActorApproval: () => Promise.resolve(null),
  });

  await compiledGraph.invoke({
    userId: 'introducer-user' as Id<'users'>,
    opportunityId: 'opp-existing',
    operationMode: 'negotiate_existing' as any,
  });

  expect(negotiationInvocations).toHaveLength(1);
  expect(negotiationInvocations[0].sourceUser.id).toBe('target-user');
  expect(negotiationInvocations[0].candidateUser.id).toBe('candidate-user');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/protocol
bun test src/opportunity/tests/opportunity.graph.spec.ts 2>&1 | tail -20
```

Expected: FAIL — `negotiate_existing` mode does not exist yet

- [ ] **Step 3: Add `negotiate_existing` and `approve_introduction` to `operationMode` union in `opportunity.state.ts`**

In `opportunity.state.ts`, update the `operationMode` annotation (~line 249):

```typescript
operationMode: Annotation<'create' | 'create_introduction' | 'continue_discovery' | 'read' | 'update' | 'delete' | 'send' | 'negotiate_existing' | 'approve_introduction'>({
  reducer: (curr, next) => next ?? curr,
  default: () => 'create' as const,
}),
```

Also update the JSDoc comment above it to document the two new modes:

```typescript
/**
 * Operation mode controls graph flow:
 * - 'create': Existing discover pipeline (Prep → Scope → Discovery → Evaluation → Ranking → Persist)
 * - 'create_introduction': Introduction path (validation → evaluation → persist) for chat-driven intros
 * - 'continue_discovery': Pagination path (Prep → Evaluation → Ranking → Persist) using pre-loaded candidates
 * - 'read': List opportunities filtered by userId and optionally networkId (fast path)
 * - 'update': Change opportunity status (accept, reject, etc.)
 * - 'delete': Expire/archive an opportunity
 * - 'send': Promote latent opportunity to pending + queue notification
 * - 'negotiate_existing': Load an existing opportunity by opportunityId and run bilateral negotiation.
 *   Used after introducer approval to trigger the normal negotiation flow.
 * - 'approve_introduction': Mark the caller as having approved a latent introducer opportunity,
 *   then enqueue a negotiate_existing job for that opportunity.
 *
 * Defaults to 'create' for backward compatibility.
 */
```

- [ ] **Step 4: Add `negotiateExistingNode` to `opportunity.graph.ts`**

Add this node inside `createGraph()`, after the `sendNode` definition and before the routing functions section:

```typescript
/**
 * Node: Negotiate Existing
 * Loads a single persisted opportunity by ID, derives source/candidate context
 * from its actors, and runs bilateral negotiation exactly as the normal pipeline would.
 * Entry point: approve_introduction sets approved=true then enqueues this mode.
 */
const negotiateExistingNode = async (state: typeof OpportunityGraphState.State) => {
  if (!state.opportunityId) {
    return { error: 'opportunityId required for negotiate_existing mode' };
  }
  if (!this.negotiationGraph) return {};

  const opp = await this.database.getOpportunity(state.opportunityId as string);
  if (!opp) {
    return { error: `Opportunity ${state.opportunityId} not found` };
  }

  const actors = opp.actors as OpportunityActor[];
  const nonIntroducerActors = actors.filter(a => a.role !== 'introducer');

  // Source user: patient or party (the target who was introduced); fall back to first non-introducer
  const sourceActor =
    nonIntroducerActors.find(a => a.role === 'patient' || a.role === 'party') ??
    nonIntroducerActors[0];
  if (!sourceActor) return { error: 'No source actor found in opportunity actors' };

  const candidateActor = nonIntroducerActors.find(a => a.userId !== sourceActor.userId);
  if (!candidateActor) return { error: 'No candidate actor found in opportunity actors' };

  const [sourceAccount, sourceProfile, sourceIntents, candidateAccount, candidateProfile, candidateIntents] =
    await Promise.all([
      this.database.getUser(sourceActor.userId as string).catch(() => null),
      this.database.getProfile(sourceActor.userId as string).catch(() => null),
      this.database.getActiveIntents(sourceActor.userId as string).catch(() => []),
      this.database.getUser(candidateActor.userId as string).catch(() => null),
      this.database.getProfile(candidateActor.userId as string).catch(() => null),
      this.database.getActiveIntents(candidateActor.userId as string).catch(() => []),
    ]);

  const toNegIntent = (i: { id?: string | null; summary?: string | null; payload?: string | null }) => ({
    id: i.id as string,
    title: i.summary ?? '',
    description: i.payload ?? '',
    confidence: 1 as const,
  });

  const sourceUser = {
    id: sourceActor.userId as string,
    intents: sourceIntents.slice(0, 5).map(toNegIntent),
    profile: {
      name: sourceProfile?.identity?.name ?? sourceAccount?.name,
      bio: sourceProfile?.identity?.bio ?? sourceAccount?.intro ?? undefined,
      location: sourceProfile?.identity?.location ?? sourceAccount?.location ?? undefined,
      skills: sourceProfile?.attributes?.skills,
      interests: sourceProfile?.attributes?.interests,
    },
  };

  const candidateNegIntents = candidateIntents.slice(0, 5).map(toNegIntent);

  const candidate: NegotiationCandidate = {
    userId: candidateActor.userId as string,
    opportunityId: opp.id as string,
    reasoning: (opp.interpretation as { reasoning?: string } | null)?.reasoning ?? '',
    valencyRole: candidateActor.role ?? 'peer',
    networkId: candidateActor.networkId as string,
    candidateUser: {
      id: candidateActor.userId as string,
      intents: candidateNegIntents,
      profile: {
        name: candidateProfile?.identity?.name ?? candidateAccount?.name,
        bio: candidateProfile?.identity?.bio ?? candidateAccount?.intro ?? undefined,
        location: candidateProfile?.identity?.location ?? candidateAccount?.location ?? undefined,
        skills: candidateProfile?.attributes?.skills,
        interests: candidateProfile?.attributes?.interests,
      },
    },
  };

  const indexContextMap = new Map<string, string>();
  if (candidateActor.networkId) {
    const ctx = await this.database
      .getNetworkMemberContext(candidateActor.networkId as string, sourceActor.userId as string)
      .catch(() => null);
    const prompt = [ctx?.indexPrompt, ctx?.memberPrompt]
      .filter((v): v is string => !!v?.trim())
      .join('\n\n');
    if (prompt) indexContextMap.set(candidateActor.networkId as string, prompt);
  }

  await negotiateCandidates(
    this.negotiationGraph,
    sourceUser,
    [candidate],
    { networkId: '', prompt: '' },
    {
      maxTurns: 6,
      timeoutMs: AMBIENT_PARK_WINDOW_MS,
      indexContextOverrides: indexContextMap,
      trigger: 'ambient',
    },
  );

  return {};
};
```

- [ ] **Step 5: Update `routeByMode` and graph wiring**

In `routeByMode`, add before the default `return 'prep'`:

```typescript
if (mode === 'negotiate_existing') return 'negotiate_existing';
if (mode === 'approve_introduction') return 'approve_introduction';
```

In the graph builder, add the new node and its edge:

```typescript
.addNode('negotiate_existing', negotiateExistingNode)
// ...add after the send node is added
```

Update the `addConditionalEdges(START, routeByMode, {...})` map to include the new modes:

```typescript
.addConditionalEdges(START, routeByMode, {
  prep: 'prep',
  intro_validation: 'intro_validation',
  read: 'read',
  update: 'update',
  delete_opp: 'delete_opp',
  send: 'send',
  negotiate_existing: 'negotiate_existing',
  approve_introduction: 'approve_introduction',   // added in Task 5
})
```

Add the edge to END:

```typescript
.addEdge('negotiate_existing', END)
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd packages/protocol
bun test src/opportunity/tests/opportunity.graph.spec.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 7: Add `opportunityId` to `OpportunityJobData` and `negotiate_existing` handler in the queue**

In `backend/src/queues/opportunity.queue.ts`, update `OpportunityJobData`:

```typescript
export interface OpportunityJobData {
  intentId: string;
  userId: string;
  networkIds?: string[];
  /** When set, run discovery on behalf of this contact user (introducer discovery). */
  contactUserId?: string;
  /** When set (with job name 'negotiate_existing'), run negotiation for this existing opportunity. */
  opportunityId?: string;
}
```

Add `addNegotiateJob` method to `OpportunityQueue`:

```typescript
/**
 * Enqueue a negotiate_existing job for a specific opportunity.
 * Called after introducer approval to trigger bilateral negotiation.
 */
async addNegotiateJob(data: { opportunityId: string; userId: string }): Promise<Job<OpportunityJobData>> {
  return this.queue.add(
    'negotiate_existing',
    { intentId: '', userId: data.userId, opportunityId: data.opportunityId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
    },
  );
}
```

Add `'negotiate_existing'` case to `processJob`:

```typescript
async processJob(name: string, data: OpportunityJobData): Promise<void> {
  switch (name) {
    case 'discover_opportunities':
      await this.handleDiscoverOpportunities(data);
      break;
    case 'negotiate_existing':
      await this.handleNegotiateExisting(data);
      break;
    default:
      this.logger.warn(`[OpportunityQueue] Unknown job name: ${name}`);
  }
}
```

Add `handleNegotiateExisting` private method:

```typescript
private async handleNegotiateExisting(data: OpportunityJobData): Promise<void> {
  const { opportunityId, userId } = data;
  if (!opportunityId) {
    this.logger.warn('[NegotiateExisting] Missing opportunityId, skipping');
    return;
  }
  this.logger.info('[NegotiateExisting] Starting', { opportunityId, userId });

  const embedder: Embedder = new EmbedderAdapter();
  const dummyHyde = {
    invoke: async () => ({ hydeEmbeddings: {} as Record<string, number[]> }),
  };

  const opportunityGraph = new OpportunityGraphFactory(
    this.graphDb as OpportunityGraphDatabase,
    embedder,
    dummyHyde,
    undefined,
    undefined,
    this.deps?.negotiationGraph,
    this.deps?.agentDispatcher,
  ).createGraph();

  const result = await opportunityGraph.invoke({
    userId: userId as Id<'users'>,
    opportunityId,
    operationMode: 'negotiate_existing',
  });

  if (result.error) {
    this.logger.error('[NegotiateExisting] Graph failed', { opportunityId, error: result.error });
    throw new Error(typeof result.error === 'string' ? result.error : 'negotiate_existing graph failed');
  }

  this.logger.info('[NegotiateExisting] Complete', { opportunityId });
}
```

- [ ] **Step 8: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.state.ts \
        packages/protocol/src/opportunity/opportunity.graph.ts \
        packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts \
        backend/src/queues/opportunity.queue.ts
git -c commit.gpgsign=false commit -m "feat(opportunity): add negotiate_existing operation mode and queue handler"
```

---

## Task 5: Add `approve_introduction` operation mode

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts`
- Modify: `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`

- [ ] **Step 1: Write a failing test**

In `opportunity.graph.spec.ts`, add:

```typescript
test('approve_introduction sets approved=true on introducer actor and enqueues negotiate job', async () => {
  const negotiateJobsEnqueued: Array<{ opportunityId: string; userId: string }> = [];

  const existingOpp: Opportunity = {
    id: 'opp-456' as any,
    status: 'latent',
    actors: [
      { networkId: 'idx-1' as any, userId: 'target-user' as any, role: 'patient' },
      { networkId: 'idx-1' as any, userId: 'candidate-user' as any, role: 'agent' },
      { networkId: 'idx-1' as any, userId: 'introducer-user' as any, role: 'introducer', approved: false },
    ],
    detection: { source: 'manual', createdBy: 'introducer-user', timestamp: new Date().toISOString() },
    interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.8, signals: [] },
    context: { networkId: 'idx-1' as any },
    confidence: '0.8',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };

  const approvalCalls: Array<[string, string, boolean]> = [];

  const { compiledGraph } = createMockGraph({
    getOpportunity: () => Promise.resolve(existingOpp),
    updateOpportunityActorApproval: mock((id, userId, approved) => {
      approvalCalls.push([id, userId, approved]);
      const updatedActors = existingOpp.actors.map((a: any) =>
        a.role === 'introducer' && a.userId === userId ? { ...a, approved } : a,
      );
      return Promise.resolve({ ...existingOpp, actors: updatedActors });
    }),
    queueNegotiateExisting: async (opportunityId: string, userId: string) => {
      negotiateJobsEnqueued.push({ opportunityId, userId });
    },
  });

  await compiledGraph.invoke({
    userId: 'introducer-user' as Id<'users'>,
    opportunityId: 'opp-456',
    operationMode: 'approve_introduction' as any,
  });

  expect(approvalCalls).toHaveLength(1);
  expect(approvalCalls[0]).toEqual(['opp-456', 'introducer-user', true]);
  expect(negotiateJobsEnqueued).toHaveLength(1);
  expect(negotiateJobsEnqueued[0].opportunityId).toBe('opp-456');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/protocol
bun test src/opportunity/tests/opportunity.graph.spec.ts 2>&1 | tail -20
```

Expected: FAIL — `approve_introduction` mode does not exist yet

- [ ] **Step 3: Add `queueNegotiateExisting` optional constructor param to `OpportunityGraphFactory`**

In `opportunity.graph.ts`, update the constructor:

```typescript
export class OpportunityGraphFactory {
  constructor(
    private database: OpportunityGraphDatabase,
    private embedder: Embedder,
    private hydeGenerator: {
      invoke: (input: HydeGeneratorInvokeInput) => Promise<{
        hydeEmbeddings: Record<string, number[]>;
        lenses?: Array<{ label: string; corpus: 'profiles' | 'intents' }>;
        hydeDocuments?: Record<string, { hydeText?: string; lens?: string }>;
      }>;
    },
    private optionalEvaluator?: OpportunityEvaluatorLike,
    private queueNotification?: QueueOpportunityNotificationFn,
    private negotiationGraph?: NegotiationGraphLike,
    private agentDispatcher?: Pick<AgentDispatcher, 'hasPersonalAgent'>,
    /** Enqueue a negotiate_existing job after introducer approval. */
    private queueNegotiateExisting?: (opportunityId: string, userId: string) => Promise<void>,
  ) {}
```

- [ ] **Step 4: Add `approveIntroductionNode` to `opportunity.graph.ts`**

Add this node inside `createGraph()`, after `negotiateExistingNode`:

```typescript
/**
 * Node: Approve Introduction
 * Called by the introducer to approve a latent introducer-pattern opportunity.
 * Sets approved=true on the introducer actor (status stays latent), then
 * enqueues a negotiate_existing job so the parties negotiate normally.
 */
const approveIntroductionNode = async (state: typeof OpportunityGraphState.State) => {
  const { opportunityId, userId } = state;
  if (!opportunityId) {
    return { mutationResult: { success: false, error: 'opportunityId required for approve_introduction' } };
  }

  const opp = await this.database.getOpportunity(opportunityId as string);
  if (!opp) {
    return { mutationResult: { success: false, error: 'Opportunity not found' } };
  }

  const introducerActor = (opp.actors as OpportunityActor[])
    .find(a => a.role === 'introducer' && a.userId === userId);
  if (!introducerActor) {
    return { mutationResult: { success: false, error: 'You are not the introducer for this opportunity' } };
  }
  if (introducerActor.approved === true) {
    return { mutationResult: { success: false, error: 'Introduction already approved' } };
  }

  const updated = await this.database.updateOpportunityActorApproval(opportunityId as string, userId as string, true);
  if (!updated) {
    return { mutationResult: { success: false, error: 'Failed to update approval' } };
  }

  if (this.queueNegotiateExisting) {
    await this.queueNegotiateExisting(opportunityId as string, userId as string);
  }

  return { mutationResult: { success: true, opportunityId } };
};
```

- [ ] **Step 5: Wire `approveIntroductionNode` into the graph**

Add the node and edge in the graph builder:

```typescript
.addNode('approve_introduction', approveIntroductionNode)
// ...
.addEdge('approve_introduction', END)
```

The `routeByMode` and `addConditionalEdges(START, ...)` map were already updated in Task 4 Step 5 to include `approve_introduction`.

- [ ] **Step 6: Wire `queueNegotiateExisting` in the queue**

In `backend/src/queues/opportunity.queue.ts`, update the `OpportunityGraphFactory` construction inside `handleDiscoverOpportunities` to pass `this.addNegotiateJob.bind(this)` as the new constructor arg. Also do the same in `handleNegotiateExisting`:

```typescript
const opportunityGraph = new OpportunityGraphFactory(
  this.graphDb as OpportunityGraphDatabase,
  embedder,
  hydeGraph,          // or dummyHyde in handleNegotiateExisting
  undefined,
  undefined,
  this.deps?.negotiationGraph,
  this.deps?.agentDispatcher,
  async (opportunityId: string, userId: string) => {   // NEW: queueNegotiateExisting
    await this.addNegotiateJob({ opportunityId, userId });
  },
).createGraph();
```

Update both `handleDiscoverOpportunities` and `handleNegotiateExisting` factory constructions.

- [ ] **Step 7: Run test to verify it passes**

```bash
cd packages/protocol
bun test src/opportunity/tests/opportunity.graph.spec.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 8: Run the full opportunity test suite**

```bash
cd packages/protocol
bun test src/opportunity/tests/
```

Expected: all tests pass

```bash
cd backend
bun test tests/opportunity.negotiation.spec.ts tests/opportunity-actor-approval.spec.ts
```

Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts \
        packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts \
        backend/src/queues/opportunity.queue.ts
git -c commit.gpgsign=false commit -m "feat(opportunity): add approve_introduction mode — gating negotiation behind introducer approval"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - `OpportunityActor.approved` → Task 1
  - Negotiate gate (per-opportunity, introducer unapproved) → Task 3
  - `approve_introduction` sets approved + enqueues job → Task 5
  - `negotiate_existing` loads opportunity, runs negotiate node → Task 4
  - Queue handles `negotiate_existing` job → Task 4 Step 7
- [x] **No placeholders** — all steps contain actual code
- [x] **Type consistency** — `OpportunityActor` with `approved?: boolean` is defined in Task 1 and referenced consistently across Tasks 2–5; `updateOpportunityActorApproval` signature matches between interface (Task 2 Step 3) and usage in `approveIntroductionNode` (Task 5 Step 4)
