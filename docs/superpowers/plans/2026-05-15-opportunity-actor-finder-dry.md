# Opportunity-Actor Finder DRY Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate four opportunity-actor finder methods on the protocol `Database` interface into one unified reader plus the existing exists-check, after deleting one dead method. No behavioral change.

**Architecture:** Add `findOpportunitiesByActors(actorIds, options)` alongside the legacy methods; migrate callers one at a time; update test mocks; delete the legacy methods. The new method takes an `includeIntroducers` flag to bridge the SQL-level difference between the two surviving readers (`findOverlappingOpportunities` filters introducer-role actors, `getAcceptedOpportunitiesBetweenActors`'s `actorPairCondition` does not). `opportunityExistsBetweenActors` stays untouched as a semantically-distinct boolean check on a hot path.

**Tech Stack:** TypeScript strict, Drizzle ORM, Bun test, `@indexnetwork/protocol` (subtree-published npm package).

---

## Spec reference

`docs/superpowers/specs/2026-05-15-opportunity-actor-finder-dry-design.md`

## File map

| File | Action |
|---|---|
| `packages/protocol/src/shared/interfaces/database.interface.ts` | Modify: add new method to `Database` (line 448 onwards) and `SystemDatabase` (line 1569). Update Pick lists at 1766–1768, 1829–1831, 2020–2022. Delete three legacy method declarations. The `UserDatabase` (line 1371) loses `getAcceptedOpportunitiesBetweenActors` and gains nothing — no curried user-scoped equivalent (callers don't need one). |
| `backend/src/adapters/database.adapter.ts` | Modify: add `findOpportunitiesByActors` implementation in `OpportunityDatabaseAdapter` (alongside line 4335+). Wire delegate in the composite `ChatDatabaseAdapter` (alongside line 2839+). Drop the three legacy implementations, the user-scope wrapper at line 5665, and the system-scope wrappers at 5888 and 5892. |
| `packages/protocol/src/opportunity/opportunity.enricher.ts` | Modify: update interface `OpportunityEnricherDatabase` at line 42 and call site at line 234. |
| `packages/protocol/src/opportunity/opportunity.graph.ts` | Modify: three call sites at lines 2326, 2427, 2554. |
| `backend/src/services/opportunity.service.ts` | Modify: call site at line 857. |
| Protocol test files (mocks) | Modify: 11 files listed in Task 6 — replace mock stubs for the three removed methods with stubs of `findOpportunitiesByActors`. |
| Backend test files (mocks) | Modify: 3 files listed in Task 7. |
| `backend/src/adapters/tests/database.adapter.spec.ts` | Modify: add a new `describe('findOpportunitiesByActors')` block under `describe('OpportunityDatabaseAdapter', …)` covering the matrix. |
| `packages/protocol/package.json` | Modify: bump version `0.33.0` → `1.0.0` (breaking interface change). |
| `backend/package.json` | Modify: bump version `0.22.0` → `0.23.0`. |

## Test strategy reference

- Existing tests pin current behavior: `opportunity.graph.spec.ts` (dedup describe block starting line 897), `opportunity.enricher.spec.ts` (~40 tests), `opportunity.service.getChatContext.spec.ts:165–192`, `system-database.spec.ts:242,302`, `user-database.spec.ts:522`, `adapter-interface-alignment.spec.ts`.
- New tests added in Task 3 cover the `{ includeIntroducers, statuses, excludeStatuses }` option matrix at the adapter integration level.
- Validation commands per phase are listed inline in each task.

---

## Task 1: Set up worktree and confirm baseline green

**Files:** none yet — environment setup only.

- [ ] **Step 1: Create the isolated worktree off `dev`**

```bash
git worktree add .worktrees/refactor-opportunity-actor-finders dev
git -C .worktrees/refactor-opportunity-actor-finders checkout -b refactor/opportunity-actor-finders
```

- [ ] **Step 2: Symlink env files and install deps in the worktree**

```bash
bun run worktree:setup refactor-opportunity-actor-finders
```

- [ ] **Step 3: Run baseline targeted test suites and confirm green**

Run from `.worktrees/refactor-opportunity-actor-finders`:
```bash
(cd packages/protocol && bun test src/opportunity/tests/ src/chat/tests/chat.graph.spec.ts src/shared/agent/tests/tool.factory.spec.ts)
(cd backend && bun test src/adapters/tests/database.adapter.spec.ts src/adapters/tests/system-database.spec.ts src/adapters/tests/user-database.spec.ts src/adapters/tests/adapter-interface-alignment.spec.ts src/services/tests/opportunity.service.getChatContext.spec.ts)
```
Expected: all pass.

- [ ] **Step 4: Confirm baseline typecheck green in both packages**

```bash
(cd packages/protocol && bun run build)
(cd backend && bunx tsc --noEmit)
```
Expected: both succeed.

No commit. Baseline only.

---

## Task 2: Add `findOpportunitiesByActors` to the protocol `Database` interface

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts`

- [ ] **Step 1: Add method declaration to `Database` interface**

Insert immediately above the existing `getOpportunityBetweenActors` declaration at line 1230 (keep the legacy three methods for now; they will be deleted in Task 9):

```ts
  /**
   * Find opportunities whose actors contain all the given user IDs.
   *
   * Replaces the legacy trio (getOpportunityBetweenActors, findOverlappingOpportunities,
   * getAcceptedOpportunitiesBetweenActors). The `includeIntroducers` flag bridges the
   * SQL-level difference between the legacy readers: when false (default), actor matching
   * is restricted to non-introducer roles (was findOverlappingOpportunities); when true,
   * any role in `actors` counts (was actorPairCondition behavior).
   *
   * Index-agnostic. Ordered by updatedAt desc.
   *
   * @param actorIds - User IDs that must all appear in each returned opportunity's actors
   * @param options - includeIntroducers (default false), statuses (include filter), excludeStatuses (exclude filter)
   * @returns Matching opportunities, newest first
   */
  findOpportunitiesByActors(
    actorIds: string[],
    options?: {
      includeIntroducers?: boolean;
      statuses?: OpportunityStatus[];
      excludeStatuses?: OpportunityStatus[];
    }
  ): Promise<Opportunity[]>;
```

- [ ] **Step 2: Add the same declaration to `SystemDatabase` interface**

Insert above `getOpportunityBetweenActors` at line 1668:

```ts
  findOpportunitiesByActors(
    actorIds: string[],
    options?: { includeIntroducers?: boolean; statuses?: OpportunityStatus[]; excludeStatuses?: OpportunityStatus[] }
  ): Promise<Opportunity[]>;
```

- [ ] **Step 3: Add to the Pick lists**

Locate the three Pick blocks at lines 1766–1768, 1829–1831, and 2020–2022. In each block, insert a `| 'findOpportunitiesByActors'` line immediately above the first of the three legacy method names. (Leave the legacy entries in place — they will be removed in Task 9.) Example for the block at 1766:

```ts
  | 'opportunityExistsBetweenActors'
  | 'findOpportunitiesByActors'
  | 'getOpportunityBetweenActors'
  | 'findOverlappingOpportunities'
  | 'getAcceptedOpportunitiesBetweenActors'
```

- [ ] **Step 4: Run protocol build to confirm interface compiles**

```bash
(cd packages/protocol && bun run build)
```
Expected: fails — implementations are missing for `findOpportunitiesByActors` (this is the failing-test moral equivalent at the interface level; we are about to fix it).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/shared/interfaces/database.interface.ts
git commit -m "feat(protocol)!: add findOpportunitiesByActors interface declaration"
```

---

## Task 3: Write failing adapter tests for `findOpportunitiesByActors`

**Files:**
- Modify: `backend/src/adapters/tests/database.adapter.spec.ts`

- [ ] **Step 1: Locate the `OpportunityDatabaseAdapter` describe block**

It starts at line 468. The new tests go inside this block, after the existing `getOpportunitiesForUser` describes (around line 800) and before `describe('expireStaleOpportunities')` at line 800.

- [ ] **Step 2: Add the new describe block**

Insert before `describe('expireStaleOpportunities', …)` at line 800:

```ts
  describe('findOpportunitiesByActors', () => {
    const introId = TEST_PREFIX + 'finder-intro';
    const actorAId = TEST_PREFIX + 'finder-A';
    const actorBId = TEST_PREFIX + 'finder-B';
    const actorCId = TEST_PREFIX + 'finder-C';
    const networkId = TEST_PREFIX + 'finder-net';
    let oppPairId: string;
    let oppPairAcceptedId: string;
    let oppWithIntroducerId: string;
    let oppThreeActorId: string;

    beforeAll(async () => {
      // Seed users
      for (const id of [introId, actorAId, actorBId, actorCId]) {
        await db.insert(users).values({ id, email: TEST_PREFIX + id + '@test.com', name: id }).onConflictDoNothing();
      }

      // 1) Pair A+B, pending
      const pair = await db.insert(opportunities).values({
        actors: [{ userId: actorAId, role: 'patient' }, { userId: actorBId, role: 'peer' }],
        context: { networkId },
        status: 'pending',
        detection: { source: 'opportunity_graph', createdBy: 'test', timestamp: new Date().toISOString() },
      }).returning({ id: opportunities.id });
      oppPairId = pair[0].id;

      // 2) Pair A+B, accepted
      const accepted = await db.insert(opportunities).values({
        actors: [{ userId: actorAId, role: 'patient' }, { userId: actorBId, role: 'peer' }],
        context: { networkId },
        status: 'accepted',
        detection: { source: 'opportunity_graph', createdBy: 'test', timestamp: new Date().toISOString() },
      }).returning({ id: opportunities.id });
      oppPairAcceptedId = accepted[0].id;

      // 3) Trio with introducer: intro + A + B
      const intro = await db.insert(opportunities).values({
        actors: [
          { userId: introId, role: 'introducer' },
          { userId: actorAId, role: 'patient' },
          { userId: actorBId, role: 'peer' },
        ],
        context: { networkId },
        status: 'pending',
        detection: { source: 'opportunity_graph', createdBy: 'test', timestamp: new Date().toISOString() },
      }).returning({ id: opportunities.id });
      oppWithIntroducerId = intro[0].id;

      // 4) Three non-introducer actors: A + B + C
      const trio = await db.insert(opportunities).values({
        actors: [
          { userId: actorAId, role: 'patient' },
          { userId: actorBId, role: 'peer' },
          { userId: actorCId, role: 'peer' },
        ],
        context: { networkId },
        status: 'pending',
        detection: { source: 'opportunity_graph', createdBy: 'test', timestamp: new Date().toISOString() },
      }).returning({ id: opportunities.id });
      oppThreeActorId = trio[0].id;
    });

    afterAll(async () => {
      await db.delete(opportunities).where(
        inArray(opportunities.id, [oppPairId, oppPairAcceptedId, oppWithIntroducerId, oppThreeActorId])
      );
      await db.delete(users).where(inArray(users.id, [introId, actorAId, actorBId, actorCId]));
    });

    it('default (includeIntroducers omitted) excludes introducer-role actors from match', async () => {
      const rows = await adapter.opportunityAdapter.findOpportunitiesByActors([introId, actorAId]);
      // intro is introducer-role in opp #3 → that opp does NOT match for introId
      const ids = rows.map((r) => r.id);
      expect(ids).not.toContain(oppWithIntroducerId);
    });

    it('includeIntroducers=true matches actors regardless of role', async () => {
      const rows = await adapter.opportunityAdapter.findOpportunitiesByActors(
        [introId, actorAId],
        { includeIntroducers: true }
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(oppWithIntroducerId);
    });

    it('matches opportunities containing all given actorIds (superset allowed)', async () => {
      const rows = await adapter.opportunityAdapter.findOpportunitiesByActors([actorAId, actorBId]);
      const ids = new Set(rows.map((r) => r.id));
      // Pair, accepted-pair, and trio all contain both A and B (intro-opp excluded by introducer filter)
      expect(ids.has(oppPairId)).toBe(true);
      expect(ids.has(oppPairAcceptedId)).toBe(true);
      expect(ids.has(oppThreeActorId)).toBe(true);
      expect(ids.has(oppWithIntroducerId)).toBe(false);
    });

    it('statuses include-filter narrows results', async () => {
      const rows = await adapter.opportunityAdapter.findOpportunitiesByActors(
        [actorAId, actorBId],
        { statuses: ['accepted'] }
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual([oppPairAcceptedId]);
    });

    it('excludeStatuses removes matching statuses', async () => {
      const rows = await adapter.opportunityAdapter.findOpportunitiesByActors(
        [actorAId, actorBId],
        { excludeStatuses: ['accepted'] }
      );
      const ids = rows.map((r) => r.id);
      expect(ids).not.toContain(oppPairAcceptedId);
      expect(ids).toContain(oppPairId);
      expect(ids).toContain(oppThreeActorId);
    });

    it('empty actorIds returns []', async () => {
      const rows = await adapter.opportunityAdapter.findOpportunitiesByActors([]);
      expect(rows).toEqual([]);
    });

    it('orders by updatedAt desc', async () => {
      const rows = await adapter.opportunityAdapter.findOpportunitiesByActors([actorAId, actorBId]);
      for (let i = 1; i < rows.length; i++) {
        expect(new Date(rows[i - 1].updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(rows[i].updatedAt).getTime());
      }
    });
  });
```

- [ ] **Step 3: Confirm the import line at the top of the file includes `inArray`**

Open `backend/src/adapters/tests/database.adapter.spec.ts` and verify the drizzle-orm import at the top includes `inArray`. If not, add it. (It is likely already present, used elsewhere in this file.)

- [ ] **Step 4: Run the new tests to confirm they FAIL with "function not defined"**

```bash
(cd backend && bun test src/adapters/tests/database.adapter.spec.ts -t findOpportunitiesByActors)
```
Expected: FAIL with type error or runtime error: `adapter.opportunityAdapter.findOpportunitiesByActors is not a function`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/adapters/tests/database.adapter.spec.ts
git commit -m "test(backend): add failing tests for findOpportunitiesByActors"
```

---

## Task 4: Implement `findOpportunitiesByActors` in the adapter

**Files:**
- Modify: `backend/src/adapters/database.adapter.ts`

- [ ] **Step 1: Add the implementation to `OpportunityDatabaseAdapter`**

Insert immediately above the existing `getOpportunityBetweenActors` method at line 4400:

```ts
  async findOpportunitiesByActors(
    actorIds: string[],
    options?: {
      includeIntroducers?: boolean;
      statuses?: ('latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired')[];
      excludeStatuses?: ('latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired')[];
    }
  ): Promise<OpportunityRow[]> {
    if (actorIds.length === 0) return [];
    const includeIntroducers = options?.includeIntroducers ?? false;

    const containmentConditions = includeIntroducers
      ? actorIds.map(
          (uid) => sql`${opportunities.actors} @> ${JSON.stringify([{ userId: uid }])}::jsonb`
        )
      : actorIds.map(
          (uid) => sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) elem
            WHERE elem->>'userId' = ${uid}
              AND elem->>'role' IS DISTINCT FROM 'introducer'
          )`
        );

    const conditions = [and(...containmentConditions)!];
    if (options?.statuses && options.statuses.length > 0) {
      conditions.push(inArray(opportunities.status, options.statuses));
    }
    if (options?.excludeStatuses && options.excludeStatuses.length > 0) {
      conditions.push(notInArray(opportunities.status, options.excludeStatuses));
    }

    const rows = await db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.updatedAt));
    return rows.map(toOpportunityRow);
  }
```

Verify that `inArray` is imported at the top of the file alongside the other drizzle-orm helpers — it is already used by `findOverlappingOpportunities` and `expireStaleOpportunities`, so the import is present.

- [ ] **Step 2: Add delegate on the composite `ChatDatabaseAdapter`**

Insert immediately above the existing `getOpportunityBetweenActors` delegate at line 2839:

```ts
  async findOpportunitiesByActors(
    actorIds: string[],
    options?: Parameters<OpportunityDatabaseAdapter['findOpportunitiesByActors']>[1]
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.findOpportunitiesByActors(actorIds, options);
  }
```

- [ ] **Step 3: Add the same method to the `SystemDatabase` scope wrapper**

Insert immediately above the existing `getOpportunityBetweenActors` wrapper at line 5888:

```ts
    findOpportunitiesByActors: (actorIds: string[], options?: Parameters<ChatDatabaseAdapter['findOpportunitiesByActors']>[1]) =>
      db.findOpportunitiesByActors(actorIds, options),
```

- [ ] **Step 4: Run the adapter tests; expect green**

```bash
(cd backend && bun test src/adapters/tests/database.adapter.spec.ts -t findOpportunitiesByActors)
```
Expected: all 7 tests pass.

- [ ] **Step 5: Run the broader adapter and alignment suites; expect no regressions**

```bash
(cd backend && bun test src/adapters/tests/database.adapter.spec.ts src/adapters/tests/system-database.spec.ts src/adapters/tests/user-database.spec.ts src/adapters/tests/adapter-interface-alignment.spec.ts)
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/database.adapter.ts
git commit -m "feat(backend): implement findOpportunitiesByActors adapter"
```

---

## Task 5: Migrate `opportunity.enricher.ts`

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.enricher.ts`

- [ ] **Step 1: Update the local `OpportunityEnricherDatabase` interface**

Locate the interface declaration that includes `findOverlappingOpportunities` (around line 42). Replace the property with:

```ts
  findOpportunitiesByActors(
    actorIds: string[],
    options?: { includeIntroducers?: boolean; statuses?: OpportunityStatus[]; excludeStatuses?: OpportunityStatus[] }
  ): Promise<Opportunity[]>;
```

(Remove the old `findOverlappingOpportunities` line entirely.)

- [ ] **Step 2: Update the call site at line 234**

Replace:
```ts
const overlapping = await database.findOverlappingOpportunities(actorUserIds, { excludeStatuses });
```
with:
```ts
const overlapping = await database.findOpportunitiesByActors(actorUserIds, { excludeStatuses });
```

(No `includeIntroducers` arg — relies on default `false` to preserve the introducer-filter behavior.)

- [ ] **Step 3: Run the enricher tests**

```bash
(cd packages/protocol && bun test src/opportunity/tests/opportunity.enricher.spec.ts)
```
Expected: all tests fail with "findOpportunitiesByActors is not a function" because the mock stubs still use the old name. That is expected — Task 6 fixes the mocks.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.enricher.ts
git commit -m "refactor(protocol): migrate opportunity.enricher to findOpportunitiesByActors"
```

---

## Task 6: Migrate `opportunity.graph.ts` call sites

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts`

- [ ] **Step 1: Migrate the dedup path at line 2427**

Find the line:
```ts
                ? await this.database.findOverlappingOpportunities(
```
Replace `findOverlappingOpportunities` with `findOpportunitiesByActors`. The options arg shape is unchanged (it was `{ excludeStatuses }` and that is still valid; `includeIntroducers` defaults to false, preserving behavior).

- [ ] **Step 2: Migrate the dedup path at line 2554**

Same edit as Step 1 — replace the method name; keep the args identical.

- [ ] **Step 3: Migrate the sibling-accept path at line 2326**

Find:
```ts
                  .getAcceptedOpportunitiesBetweenActors(dedupUserId, counterpartyUserId)
```
Replace with:
```ts
                  .findOpportunitiesByActors([dedupUserId, counterpartyUserId], { includeIntroducers: true, statuses: ['accepted'] })
```

Also update the log message on line 2328 (`'[Graph:Persist] getAcceptedOpportunitiesBetweenActors failed'`) to `'[Graph:Persist] findOpportunitiesByActors (sibling-accept) failed'`, and update the type reference on line 2333:
```ts
                    return [] as Awaited<ReturnType<typeof this.database.findOpportunitiesByActors>>;
```

- [ ] **Step 4: Run graph tests; expect failures only from missing mock stubs**

```bash
(cd packages/protocol && bun test src/opportunity/tests/opportunity.graph.spec.ts -t 'Persist')
```
Expected: failures with "findOpportunitiesByActors is not a function" in the dedup describe block — mocks are updated in Task 8.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts
git commit -m "refactor(protocol): migrate opportunity.graph to findOpportunitiesByActors"
```

---

## Task 7: Migrate `opportunity.service.ts`

**Files:**
- Modify: `backend/src/services/opportunity.service.ts`

- [ ] **Step 1: Migrate the call at line 857**

Find:
```ts
      this.db.getAcceptedOpportunitiesBetweenActors(userId, peerUserId),
```
Replace with:
```ts
      this.db.findOpportunitiesByActors([userId, peerUserId], { includeIntroducers: true, statuses: ['accepted'] }),
```

- [ ] **Step 2: Run service tests**

```bash
(cd backend && bun test src/services/tests/opportunity.service.getChatContext.spec.ts)
```
Expected: failures from the mock stub still using the old name — fixed in Task 9.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/opportunity.service.ts
git commit -m "refactor(backend): migrate opportunity.service to findOpportunitiesByActors"
```

---

## Task 8: Update protocol-level mock stubs

**Files:**
- Modify: 11 protocol test files (listed in Step 1).

- [ ] **Step 1: For each file, replace mock stubs for the three legacy methods with a single `findOpportunitiesByActors` stub**

Files:
1. `packages/protocol/src/opportunity/tests/introducer-gating-lifecycle.spec.ts` (lines 69–71)
2. `packages/protocol/src/opportunity/tests/opportunity.graph.dedup.spec.ts` (lines 117–119; plus per-test overrides at 187, 209, 230, 261, 290, 310 currently using `findOverlappingOpportunities: async () => [oppX]` — rename each)
3. `packages/protocol/src/opportunity/tests/opportunity.graph.send-actedAt.spec.ts` (lines 46–48)
4. `packages/protocol/src/opportunity/tests/opportunity.graph.negotiate-timeout.spec.ts` (lines 41–43)
5. `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts` (lines 71–73, 165–167, 1433–1435, 1841–1843, 1949–1951, 2072–2074, 2234–2236, 2347–2349, 2592–2594; plus `spyOn(mockDb, 'findOverlappingOpportunities')` calls at lines 917, 955, 994, 1015, 1050, 1088, 1112 — rename to `findOpportunitiesByActors`)
6. `packages/protocol/src/opportunity/tests/opportunity.graph.self-accept-guard.spec.ts` (lines 34–36)
7. `packages/protocol/src/opportunity/tests/opportunity.graph.update.spec.ts` (lines 41–43)
8. `packages/protocol/src/opportunity/tests/opportunity.enricher.spec.ts` (all occurrences of `findOverlappingOpportunities` — see grep below)
9. `packages/protocol/src/opportunity/tests/opportunity.persist.spec.ts` (lines 51, 70, 91, 111, 130, 164)
10. `packages/protocol/src/chat/tests/chat.graph.mocks.ts` (lines 240–242)
11. `packages/protocol/src/shared/agent/tests/tool.factory.spec.ts` (line 182 type union; lines 307, 337; lines 1086, 1128, 1176, 1222, 2295; line 947, 966, 985 assertion handlers)

Replacement rule per file:

- Replace any line of the form `getOpportunityBetweenActors: ... ,` — DELETE it (this method is gone).
- Replace any `findOverlappingOpportunities: <stub>` → `findOpportunitiesByActors: <stub>`. The stub return type is unchanged (`Opportunity[]`).
- Replace any `getAcceptedOpportunitiesBetweenActors: <stub>` → `findOpportunitiesByActors: <stub>`. **WARNING:** if a single file mocks BOTH `findOverlappingOpportunities` and `getAcceptedOpportunitiesBetweenActors`, collapse to a single `findOpportunitiesByActors` mock. The two call paths in `opportunity.graph.ts` now call the same method, so the mock must serve both. For tests that previously needed different return values per legacy method, the mock should inspect the `options` arg: `{ statuses: ['accepted'] }` was the sibling-accept call; absence of `statuses` was the dedup call. Use a switch on `options?.statuses?.[0] === 'accepted'` to disambiguate.

Example mock for a file that needs both behaviors:
```ts
findOpportunitiesByActors: async (
  _actorIds: string[],
  options?: { statuses?: ('accepted' | string)[]; excludeStatuses?: string[]; includeIntroducers?: boolean }
) => {
  if (options?.statuses?.includes('accepted')) return [/* sibling-accept fixture */];
  return [/* dedup fixture */];
},
```

For test files where only `findOverlappingOpportunities` was mocked (no sibling-accept path), the mock is a pure rename — same return value, same arg shape (the `options.excludeStatuses` field still matches).

- [ ] **Step 2: Update the Omit type union at `tool.factory.spec.ts:182`**

Find the long type union:
```ts
"... | "getNetworkIntentsForMember" | "getNetworkWithPermissions" | "getOpportunity" | "updateOpportunityStatus" | "getActiveIntents" | "getIntentsInIndexForMember" | "getNetworkIdsForIntent" | "opportunityExistsBetweenActors" | "findOverlappingOpportunities" | "createOpportunity""
```
Replace `"findOverlappingOpportunities"` with `"findOpportunitiesByActors"`.

- [ ] **Step 3: Run all protocol tests touched by the migration**

```bash
(cd packages/protocol && bun test src/opportunity/tests/ src/chat/tests/chat.graph.spec.ts src/shared/agent/tests/tool.factory.spec.ts)
```
Expected: all pass. If a test still references a removed mock key, the message will be obvious.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/opportunity/tests/ packages/protocol/src/chat/tests/chat.graph.mocks.ts packages/protocol/src/shared/agent/tests/tool.factory.spec.ts
git commit -m "test(protocol): migrate mock stubs to findOpportunitiesByActors"
```

---

## Task 9: Update backend-level mock stubs

**Files:**
- Modify: `backend/src/adapters/tests/system-database.spec.ts`
- Modify: `backend/src/adapters/tests/user-database.spec.ts`
- Modify: `backend/src/services/tests/opportunity.service.getChatContext.spec.ts`

- [ ] **Step 1: `system-database.spec.ts`**

- Delete the mock for `getOpportunityBetweenActors` at line 71 and the test at lines 242–250.
- Rename the mock for `findOverlappingOpportunities` at line 72 to `findOpportunitiesByActors`.
- Update the test at lines 302–305 ("findOverlappingOpportunities delegates directly") to assert on `findOpportunitiesByActors`. New assertion:
  ```ts
  it('findOpportunitiesByActors delegates directly', async () => {
    const actorIds = [AUTH_USER, OTHER_USER];
    await sysDb.findOpportunitiesByActors(actorIds, { includeIntroducers: true });
    expect(mockDb.findOpportunitiesByActors).toHaveBeenCalledWith(actorIds, { includeIntroducers: true });
  });
  ```

- [ ] **Step 2: `user-database.spec.ts`**

- Delete the mock for `getAcceptedOpportunitiesBetweenActors` at line 157 and the test at lines 522–525. (UserDatabase no longer exposes a curried opportunity-by-actor finder; production never used it.)

- [ ] **Step 3: `opportunity.service.getChatContext.spec.ts`**

- In the database mock object around line 165, rename the `getAcceptedOpportunitiesBetweenActors` field (type around 165 and value around 192) to `findOpportunitiesByActors`. Adjust the mock to ignore the new options arg:
  ```ts
  findOpportunitiesByActors: mock(() => Promise.resolve(rows)),
  ```
- Ensure no callers within the test file inspect the args — if any `expect(mock.calls)` looks for the old signature, update it to `expect(...).toHaveBeenCalledWith([userId, peerUserId], { includeIntroducers: true, statuses: ['accepted'] })`.

- [ ] **Step 4: Run backend test suites**

```bash
(cd backend && bun test src/adapters/tests/system-database.spec.ts src/adapters/tests/user-database.spec.ts src/services/tests/opportunity.service.getChatContext.spec.ts)
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/adapters/tests/system-database.spec.ts backend/src/adapters/tests/user-database.spec.ts backend/src/services/tests/opportunity.service.getChatContext.spec.ts
git commit -m "test(backend): migrate mock stubs to findOpportunitiesByActors"
```

---

## Task 10: Delete legacy methods from interface and adapter

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts`
- Modify: `backend/src/adapters/database.adapter.ts`

- [ ] **Step 1: Delete from `Database` interface**

Remove the three method declarations:
- `getOpportunityBetweenActors` block at line 1230 (and its JSDoc above).
- `findOverlappingOpportunities` block at line 1245 (and its JSDoc above).
- `getAcceptedOpportunitiesBetweenActors` block at line 1285 (and its JSDoc above).

- [ ] **Step 2: Delete from `UserDatabase` interface**

Remove the `getAcceptedOpportunitiesBetweenActors(counterpartUserId: string)` line at 1534.

- [ ] **Step 3: Delete from `SystemDatabase` interface**

Remove:
- `getOpportunityBetweenActors(...)` at line 1668.
- `findOverlappingOpportunities(...)` at line 1671.

- [ ] **Step 4: Remove from the three Pick lists**

In each Pick block (lines 1766–1768, 1829–1831, 2020–2022), delete:
- `| 'getOpportunityBetweenActors'`
- `| 'findOverlappingOpportunities'`
- `| 'getAcceptedOpportunitiesBetweenActors'`

Keep the new `| 'findOpportunitiesByActors'` entries you added in Task 2 Step 3.

- [ ] **Step 5: Delete adapter implementations**

In `backend/src/adapters/database.adapter.ts`, delete:
- The composite-adapter delegates: `getOpportunityBetweenActors` (line 2839), `findOverlappingOpportunities` (line 2845), `getAcceptedOpportunitiesBetweenActors` (line 2860).
- The actual implementations in `OpportunityDatabaseAdapter`: `getAcceptedOpportunitiesBetweenActors` (line 4335), `getOpportunityBetweenActors` (line 4400), `findOverlappingOpportunities` (line 4424).
- The UserDatabase wrapper for `getAcceptedOpportunitiesBetweenActors` (line 5665).
- The SystemDatabase wrappers for `getOpportunityBetweenActors` (line 5888) and `findOverlappingOpportunities` (line 5892).

- [ ] **Step 6: Run typecheck across both packages**

```bash
(cd packages/protocol && bun run build)
(cd backend && bunx tsc --noEmit)
```
Expected: both succeed. Any remaining caller would surface here.

- [ ] **Step 7: Run all targeted test suites**

```bash
(cd packages/protocol && bun test src/opportunity/tests/ src/chat/tests/chat.graph.spec.ts src/shared/agent/tests/tool.factory.spec.ts)
(cd backend && bun test src/adapters/tests/database.adapter.spec.ts src/adapters/tests/system-database.spec.ts src/adapters/tests/user-database.spec.ts src/adapters/tests/adapter-interface-alignment.spec.ts src/services/tests/opportunity.service.getChatContext.spec.ts)
```
Expected: all pass.

- [ ] **Step 8: Run lint**

```bash
(cd packages/protocol && bun run lint)
(cd backend && bun run lint)
```
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/protocol/src/shared/interfaces/database.interface.ts backend/src/adapters/database.adapter.ts
git commit -m "refactor(protocol)!: remove legacy opportunity-actor finder methods

BREAKING CHANGE: getOpportunityBetweenActors, findOverlappingOpportunities,
and getAcceptedOpportunitiesBetweenActors are removed from the Database,
UserDatabase, and SystemDatabase interfaces. Use findOpportunitiesByActors."
```

---

## Task 11: Version bump

**Files:**
- Modify: `packages/protocol/package.json`
- Modify: `backend/package.json`

- [ ] **Step 1: Bump `packages/protocol/package.json`**

Change `"version": "0.33.0"` to `"version": "1.0.0"`.

- [ ] **Step 2: Bump `backend/package.json`**

Change `"version": "0.22.0"` to `"version": "0.23.0"`.

- [ ] **Step 3: Final verification — build + targeted tests + lint**

```bash
(cd packages/protocol && bun run build && bun run lint)
(cd backend && bunx tsc --noEmit && bun run lint)
(cd packages/protocol && bun test src/opportunity/tests/ src/chat/tests/chat.graph.spec.ts src/shared/agent/tests/tool.factory.spec.ts)
(cd backend && bun test src/adapters/tests/database.adapter.spec.ts src/adapters/tests/system-database.spec.ts src/adapters/tests/user-database.spec.ts src/adapters/tests/adapter-interface-alignment.spec.ts src/services/tests/opportunity.service.getChatContext.spec.ts)
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/package.json backend/package.json
git commit -m "chore: bump versions for opportunity-actor finder DRY

@indexnetwork/protocol: 0.33.0 -> 1.0.0 (breaking interface change)
backend: 0.22.0 -> 0.23.0"
```

---

## Task 12: Finishing checks before merge

- [ ] **Step 1: Delete the spec and plan from `docs/superpowers/`** (per the project's finishing-branch protocol)

```bash
git rm docs/superpowers/specs/2026-05-15-opportunity-actor-finder-dry-design.md docs/superpowers/plans/2026-05-15-opportunity-actor-finder-dry.md
git commit -m "chore(superpowers): remove plan + spec after implementation"
```

- [ ] **Step 2: Merge into `dev`**

From the parent repository (not the worktree):
```bash
git checkout dev
git merge --no-ff refactor/opportunity-actor-finders
```

- [ ] **Step 3: Push both remotes**

```bash
git push upstream dev
git push origin dev
```

- [ ] **Step 4: Clean up the worktree and branch**

```bash
git worktree remove .worktrees/refactor-opportunity-actor-finders
git branch -d refactor/opportunity-actor-finders
```

---

## Risk register (from spec)

- **Type drift between `Database` and the scoped variants** — caught by `adapter-interface-alignment.spec.ts` in Task 4 Step 5 and Task 10 Step 7.
- **Mock-stub churn** — every legacy method name is grep-friendly; Task 8 Step 3 and Task 9 Step 4 are the verification gates.
- **External `@indexnetwork/protocol` consumers** — none known. The breaking change is signaled by the major bump in Task 11.
