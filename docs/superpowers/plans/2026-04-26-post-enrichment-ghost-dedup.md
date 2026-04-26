# Post-Enrichment Ghost Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a ghost user is enriched, detect if they match an existing user via social handles and merge the duplicate ghost into the target user.

**Scope note:** The embedding similarity fallback (for ghosts with no social handles) is deferred to a follow-up. Social handle matching alone covers the vast majority of real-world duplicates (LinkedIn/GitHub/X handles are globally unique identifiers).

**Architecture:** Two new methods on `ProfileGraphDatabase` interface (`findDuplicateUser`, `mergeGhostUser`) implemented in `ProfileDatabaseAdapter`. The profile graph's `autoGenerateNode` calls them after enrichment succeeds but before embedding. The merge transaction re-points all FK references and soft-deletes the ghost.

**Tech Stack:** Drizzle ORM, PostgreSQL JSONB queries, Bun test runner

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/protocol/src/shared/interfaces/database.interface.ts` | Modify | Add `findDuplicateUser` and `mergeGhostUser` to `Database` interface; add to `ProfileGraphDatabase` pick type |
| `backend/src/adapters/database.adapter.ts` | Modify | Implement `findDuplicateUser` and `mergeGhostUser` on `ProfileDatabaseAdapter`; expose via `ChatDatabaseAdapter` |
| `packages/protocol/src/profile/profile.graph.ts` | Modify | Call dedup after enrichment succeeds, before embedding |
| `backend/src/adapters/tests/ghost-dedup.spec.ts` | Create | Integration tests for findDuplicateUser and mergeGhostUser |

---

### Task 1: Add interface methods to `Database` and `ProfileGraphDatabase`

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts:436-652` (Database interface), `packages/protocol/src/shared/interfaces/database.interface.ts:1649-1652` (ProfileGraphDatabase pick type)

- [ ] **Step 1: Add `findDuplicateUser` and `mergeGhostUser` to the `Database` interface**

In `packages/protocol/src/shared/interfaces/database.interface.ts`, add these two methods inside the `Database` interface, after the `softDeleteGhost` method (after line 480):

```typescript
  /**
   * Find an existing user that matches the given social handles.
   * Checks LinkedIn, GitHub, and Twitter/X handles (case-insensitive, exact match).
   * Excludes the given userId and soft-deleted users.
   * Prefers real users over ghosts; among ghosts, returns the oldest.
   * @param userId - The ghost user being enriched (excluded from results)
   * @param socials - Enriched social handles to match against
   * @returns The matching user's id, or null if no match
   */
  findDuplicateUser(userId: string, socials: UserSocials): Promise<{ id: string } | null>;

  /**
   * Merge a ghost user (source) into a target user.
   * Re-points all data (intents, opportunities, memberships, etc.) from source to target,
   * deletes ghost-only records (profile, sessions, etc.), and soft-deletes the source user.
   * Runs in a single transaction.
   * @param sourceId - The ghost user to merge away
   * @param targetId - The user to merge into
   */
  mergeGhostUser(sourceId: string, targetId: string): Promise<void>;
```

- [ ] **Step 2: Add the new methods to the `ProfileGraphDatabase` pick type**

In the same file, update the `ProfileGraphDatabase` type (line 1649-1652) to include the new methods:

```typescript
export type ProfileGraphDatabase = Pick<
  Database,
  'getProfile' | 'getUser' | 'updateUser' | 'saveProfile' | 'getProfileByUserId' | 'getHydeDocument' | 'saveHydeDocument' | 'softDeleteGhost' | 'findDuplicateUser' | 'mergeGhostUser'
>;
```

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/shared/interfaces/database.interface.ts
git commit -m "feat(protocol): add findDuplicateUser and mergeGhostUser to Database interface"
```

---

### Task 2: Implement `findDuplicateUser` on `ProfileDatabaseAdapter`

**Files:**
- Modify: `backend/src/adapters/database.adapter.ts:3355-3566` (ProfileDatabaseAdapter class)

- [ ] **Step 1: Write the failing test for social handle matching**

Create `backend/src/adapters/tests/ghost-dedup.spec.ts`:

```typescript
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import db from '../../lib/drizzle/drizzle';
import {
  users,
  userProfiles,
  networks,
  networkMembers,
  intents,
  opportunities,
  opportunityDeliveries,
  files,
  links,
  hydeDocuments,
} from '../../schemas/database.schema';
import {
  conversations,
  conversationParticipants,
  messages,
} from '../../schemas/conversation.schema';
import { ProfileDatabaseAdapter } from '../database.adapter';

const TEST_PREFIX = 'ghost_dedup_spec_' + Date.now() + '_';
const adapter = new ProfileDatabaseAdapter();

interface TestIds {
  realUserId: string;
  ghostAId: string;
  ghostBId: string;
  ghostNoSocialsId: string;
  differentPersonId: string;
}
let ids: TestIds;

beforeAll(async () => {
  ids = {
    realUserId: uuidv4(),
    ghostAId: uuidv4(),
    ghostBId: uuidv4(),
    ghostNoSocialsId: uuidv4(),
    differentPersonId: uuidv4(),
  };

  await db.insert(users).values([
    {
      id: ids.realUserId,
      email: TEST_PREFIX + 'real@index.network',
      name: 'Seref Yarar',
      isGhost: false,
      socials: { linkedin: 'serefyarar', github: 'serefyarar', x: 'hyperseref' },
    },
    {
      id: ids.ghostAId,
      email: TEST_PREFIX + 'ghost-a@index.as',
      name: 'Seref Yarar',
      isGhost: true,
      socials: { linkedin: 'serefyarar' },
    },
    {
      id: ids.ghostBId,
      email: TEST_PREFIX + 'ghost-b@gowit.dev',
      name: 'Serafettin Yarar',
      isGhost: true,
      socials: { github: 'serefyarar' },
    },
    {
      id: ids.ghostNoSocialsId,
      email: TEST_PREFIX + 'ghost-nosocials@test.com',
      name: 'Seref Yarar',
      isGhost: true,
      socials: null,
    },
    {
      id: ids.differentPersonId,
      email: TEST_PREFIX + 'different@nato.int',
      name: 'Seref Ozu',
      isGhost: true,
      socials: { linkedin: 'serefozu-b5b87322a' },
    },
  ]);
});

afterAll(async () => {
  const allIds = Object.values(ids);
  await db.delete(userProfiles).where(inArray(userProfiles.userId, allIds));
  await db.delete(users).where(inArray(users.id, allIds));
});

describe('ProfileDatabaseAdapter.findDuplicateUser', () => {
  it('matches by LinkedIn handle and prefers real user over ghost', async () => {
    const result = await adapter.findDuplicateUser(ids.ghostAId, { linkedin: 'serefyarar' });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(ids.realUserId);
  });

  it('matches by GitHub handle', async () => {
    const result = await adapter.findDuplicateUser(ids.ghostBId, { github: 'serefyarar' });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(ids.realUserId);
  });

  it('matches by X handle', async () => {
    const newGhostId = uuidv4();
    await db.insert(users).values({
      id: newGhostId,
      email: TEST_PREFIX + 'ghost-x@test.com',
      name: 'Seref X',
      isGhost: true,
    });
    try {
      const result = await adapter.findDuplicateUser(newGhostId, { x: 'hyperseref' });
      expect(result).not.toBeNull();
      expect(result!.id).toBe(ids.realUserId);
    } finally {
      await db.delete(users).where(eq(users.id, newGhostId));
    }
  });

  it('is case-insensitive', async () => {
    const result = await adapter.findDuplicateUser(ids.ghostAId, { linkedin: 'SerefYarar' });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(ids.realUserId);
  });

  it('does not match different social handles', async () => {
    const result = await adapter.findDuplicateUser(ids.differentPersonId, { linkedin: 'serefozu-b5b87322a' });
    // Only matches against OTHER users, the only user with this handle is itself
    expect(result).toBeNull();
  });

  it('returns null when no socials provided', async () => {
    const result = await adapter.findDuplicateUser(ids.ghostNoSocialsId, {});
    expect(result).toBeNull();
  });

  it('excludes soft-deleted users from matching', async () => {
    const deletedId = uuidv4();
    await db.insert(users).values({
      id: deletedId,
      email: TEST_PREFIX + 'deleted@test.com',
      name: 'Deleted User',
      isGhost: true,
      socials: { linkedin: 'deleted-handle-unique' },
      deletedAt: new Date(),
    });
    try {
      const result = await adapter.findDuplicateUser(ids.ghostAId, { linkedin: 'deleted-handle-unique' });
      expect(result).toBeNull();
    } finally {
      await db.delete(users).where(eq(users.id, deletedId));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test src/adapters/tests/ghost-dedup.spec.ts`
Expected: FAIL with "adapter.findDuplicateUser is not a function"

- [ ] **Step 3: Implement `findDuplicateUser` on `ProfileDatabaseAdapter`**

In `backend/src/adapters/database.adapter.ts`, add this method to `ProfileDatabaseAdapter` (after `softDeleteGhost`, before the class closing brace):

```typescript
  /**
   * Find an existing user matching the given social handles.
   * Checks LinkedIn, GitHub, and X handles in priority order (case-insensitive).
   * Excludes the given userId and soft-deleted users.
   * Prefers real users over ghosts; among ghosts picks the oldest.
   */
  async findDuplicateUser(
    userId: string,
    socials: { x?: string; linkedin?: string; github?: string; websites?: string[] },
  ): Promise<{ id: string } | null> {
    const handles: { field: string; value: string }[] = [];
    if (socials.linkedin) handles.push({ field: 'linkedin', value: socials.linkedin.toLowerCase() });
    if (socials.github) handles.push({ field: 'github', value: socials.github.toLowerCase() });
    if (socials.x) handles.push({ field: 'x', value: socials.x.toLowerCase() });

    if (handles.length === 0) return null;

    const conditions = handles.map(
      (h) => sql`LOWER(${schema.users.socials}->>'${sql.raw(h.field)}') = ${h.value}`,
    );

    const results = await db
      .select({ id: schema.users.id, isGhost: schema.users.isGhost, createdAt: schema.users.createdAt })
      .from(schema.users)
      .where(
        and(
          sql`(${sql.join(conditions, sql` OR `)})`,
          not(eq(schema.users.id, userId)),
          isNull(schema.users.deletedAt),
        ),
      )
      .orderBy(asc(schema.users.isGhost), asc(schema.users.createdAt))
      .limit(1);

    return results[0] ? { id: results[0].id } : null;
  }
```

Ensure these Drizzle imports are present at the top of the file (add any that are missing): `and`, `not`, `asc`, `isNull`, `sql`.

- [ ] **Step 4: Expose `findDuplicateUser` on `ChatDatabaseAdapter`**

The `ChatDatabaseAdapter` class delegates profile methods to `ProfileDatabaseAdapter`. Add:

```typescript
  async findDuplicateUser(
    userId: string,
    socials: { x?: string; linkedin?: string; github?: string; websites?: string[] },
  ): Promise<{ id: string } | null> {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.findDuplicateUser(userId, socials);
  }
```

Add this near the other profile-delegating methods (`softDeleteGhost`, `updateUser`, `saveProfile`) around line 1003-1006.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && bun test src/adapters/tests/ghost-dedup.spec.ts`
Expected: All `findDuplicateUser` tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/database.adapter.ts backend/src/adapters/tests/ghost-dedup.spec.ts
git commit -m "feat(protocol): implement findDuplicateUser for social handle matching"
```

---

### Task 3: Implement `mergeGhostUser` on `ProfileDatabaseAdapter`

**Files:**
- Modify: `backend/src/adapters/database.adapter.ts:3355-3566` (ProfileDatabaseAdapter class)
- Modify: `backend/src/adapters/tests/ghost-dedup.spec.ts`

- [ ] **Step 1: Write the failing test for merge**

Add to `backend/src/adapters/tests/ghost-dedup.spec.ts`, inside a new `describe('ProfileDatabaseAdapter.mergeGhostUser')` block. This test sets up a ghost with related data across all tables and verifies that merging re-points everything correctly.

Add these additional test fixtures in `beforeAll` (after the existing user inserts):

```typescript
  // Create a network and memberships for merge testing
  const mergeNetworkId = uuidv4();
  const mergeGhostId = uuidv4();
  const mergeTargetId = uuidv4();

  // Store for merge tests
  (ids as any).mergeNetworkId = mergeNetworkId;
  (ids as any).mergeGhostId = mergeGhostId;
  (ids as any).mergeTargetId = mergeTargetId;

  await db.insert(users).values([
    {
      id: mergeTargetId,
      email: TEST_PREFIX + 'merge-target@index.network',
      name: 'Target User',
      isGhost: false,
    },
    {
      id: mergeGhostId,
      email: TEST_PREFIX + 'merge-ghost@other.com',
      name: 'Ghost To Merge',
      isGhost: true,
    },
  ]);

  await db.insert(userProfiles).values([
    {
      userId: mergeTargetId,
      identity: { name: 'Target User', bio: 'target bio', location: 'NYC' },
      narrative: { context: 'target context' },
      attributes: { skills: ['a'], interests: ['b'] },
    },
    {
      userId: mergeGhostId,
      identity: { name: 'Ghost', bio: 'ghost bio', location: 'LA' },
      narrative: { context: 'ghost context' },
      attributes: { skills: ['c'], interests: ['d'] },
    },
  ]);

  await db.insert(networks).values({
    id: mergeNetworkId,
    title: TEST_PREFIX + 'Merge Test Network',
  });

  await db.insert(networkMembers).values({
    networkId: mergeNetworkId,
    userId: mergeGhostId,
    permissions: ['contact'],
  });
```

Update the `afterAll` to also clean up merge fixtures:

```typescript
afterAll(async () => {
  const allIds = [
    ...Object.values(ids),
    (ids as any).mergeGhostId,
    (ids as any).mergeTargetId,
  ].filter(Boolean);
  // Clean up in FK order
  await db.delete(networkMembers).where(
    eq(networkMembers.networkId, (ids as any).mergeNetworkId),
  );
  await db.delete(networks).where(eq(networks.id, (ids as any).mergeNetworkId));
  await db.delete(userProfiles).where(inArray(userProfiles.userId, allIds));
  await db.delete(users).where(inArray(users.id, allIds));
});
```

Add the merge test block:

```typescript
describe('ProfileDatabaseAdapter.mergeGhostUser', () => {
  it('re-points network memberships and soft-deletes ghost', async () => {
    const ghostId = (ids as any).mergeGhostId as string;
    const targetId = (ids as any).mergeTargetId as string;
    const networkId = (ids as any).mergeNetworkId as string;

    await adapter.mergeGhostUser(ghostId, targetId);

    // Ghost should be soft-deleted
    const [ghost] = await db.select({ deletedAt: users.deletedAt })
      .from(users).where(eq(users.id, ghostId));
    expect(ghost.deletedAt).not.toBeNull();

    // Ghost's profile should be deleted
    const ghostProfile = await db.select()
      .from(userProfiles).where(eq(userProfiles.userId, ghostId));
    expect(ghostProfile).toHaveLength(0);

    // Target's profile should still exist
    const targetProfile = await db.select()
      .from(userProfiles).where(eq(userProfiles.userId, targetId));
    expect(targetProfile).toHaveLength(1);

    // Membership should be re-pointed to target
    const membership = await db.select()
      .from(networkMembers)
      .where(and(
        eq(networkMembers.networkId, networkId),
        eq(networkMembers.userId, targetId),
      ));
    expect(membership).toHaveLength(1);
  });

  it('skips memberships where target already belongs to the network', async () => {
    const ghostId = uuidv4();
    const targetId = uuidv4();
    const netId = uuidv4();

    await db.insert(users).values([
      { id: ghostId, email: TEST_PREFIX + 'skip-ghost@test.com', name: 'G', isGhost: true },
      { id: targetId, email: TEST_PREFIX + 'skip-target@test.com', name: 'T', isGhost: false },
    ]);
    await db.insert(userProfiles).values({
      userId: ghostId,
      identity: { name: 'G', bio: '', location: '' },
      narrative: { context: '' },
      attributes: { skills: [], interests: [] },
    });
    await db.insert(networks).values({ id: netId, title: TEST_PREFIX + 'skip-net' });
    await db.insert(networkMembers).values([
      { networkId: netId, userId: ghostId, permissions: ['contact'] },
      { networkId: netId, userId: targetId, permissions: ['owner'] },
    ]);

    try {
      await adapter.mergeGhostUser(ghostId, targetId);

      // Ghost's membership should be soft-deleted (not re-pointed, since target already in network)
      const ghostMembership = await db.select()
        .from(networkMembers)
        .where(and(eq(networkMembers.networkId, netId), eq(networkMembers.userId, ghostId)));
      expect(ghostMembership).toHaveLength(1);
      expect(ghostMembership[0].deletedAt).not.toBeNull();

      // Target's membership should be unchanged
      const targetMembership = await db.select()
        .from(networkMembers)
        .where(and(eq(networkMembers.networkId, netId), eq(networkMembers.userId, targetId)));
      expect(targetMembership).toHaveLength(1);
      expect(targetMembership[0].permissions).toContain('owner');
    } finally {
      await db.delete(networkMembers).where(eq(networkMembers.networkId, netId));
      await db.delete(networks).where(eq(networks.id, netId));
      await db.delete(userProfiles).where(inArray(userProfiles.userId, [ghostId, targetId]));
      await db.delete(users).where(inArray(users.id, [ghostId, targetId]));
    }
  });

  it('re-points intents from ghost to target', async () => {
    const ghostId = uuidv4();
    const targetId = uuidv4();
    const intentId = uuidv4();

    await db.insert(users).values([
      { id: ghostId, email: TEST_PREFIX + 'intent-ghost@test.com', name: 'G', isGhost: true },
      { id: targetId, email: TEST_PREFIX + 'intent-target@test.com', name: 'T', isGhost: false },
    ]);
    await db.insert(userProfiles).values({
      userId: ghostId,
      identity: { name: 'G', bio: '', location: '' },
      narrative: { context: '' },
      attributes: { skills: [], interests: [] },
    });
    await db.insert(intents).values({
      id: intentId,
      userId: ghostId,
      payload: TEST_PREFIX + 'test intent',
    });

    try {
      await adapter.mergeGhostUser(ghostId, targetId);

      const [intent] = await db.select({ userId: intents.userId })
        .from(intents).where(eq(intents.id, intentId));
      expect(intent.userId).toBe(targetId);
    } finally {
      await db.delete(intents).where(eq(intents.id, intentId));
      await db.delete(userProfiles).where(inArray(userProfiles.userId, [ghostId, targetId]));
      await db.delete(users).where(inArray(users.id, [ghostId, targetId]));
    }
  });

  it('re-points opportunity actors JSONB from ghost to target', async () => {
    const ghostId = uuidv4();
    const targetId = uuidv4();
    const netId = uuidv4();
    const oppId = uuidv4();

    await db.insert(users).values([
      { id: ghostId, email: TEST_PREFIX + 'opp-ghost@test.com', name: 'G', isGhost: true },
      { id: targetId, email: TEST_PREFIX + 'opp-target@test.com', name: 'T', isGhost: false },
    ]);
    await db.insert(userProfiles).values({
      userId: ghostId,
      identity: { name: 'G', bio: '', location: '' },
      narrative: { context: '' },
      attributes: { skills: [], interests: [] },
    });
    await db.insert(networks).values({ id: netId, title: TEST_PREFIX + 'opp-net' });
    await db.insert(opportunities).values({
      id: oppId,
      actors: [
        { userId: ghostId, networkId: netId, role: 'seeker' },
        { userId: targetId, networkId: netId, role: 'provider' },
      ],
      detection: { source: 'enrichment', timestamp: new Date().toISOString(), createdBy: ghostId },
      interpretation: { category: 'test', reasoning: 'test', confidence: 0.9 },
      context: { networkId: netId },
      confidence: '0.9',
    });

    try {
      await adapter.mergeGhostUser(ghostId, targetId);

      const [opp] = await db.select({ actors: opportunities.actors, detection: opportunities.detection })
        .from(opportunities).where(eq(opportunities.id, oppId));
      const actors = opp.actors as { userId: string }[];
      const ghostActors = actors.filter(a => a.userId === ghostId);
      expect(ghostActors).toHaveLength(0);
      const targetActors = actors.filter(a => a.userId === targetId);
      expect(targetActors.length).toBeGreaterThanOrEqual(1);

      const detection = opp.detection as { createdBy?: string };
      expect(detection.createdBy).toBe(targetId);
    } finally {
      await db.delete(opportunities).where(eq(opportunities.id, oppId));
      await db.delete(networks).where(eq(networks.id, netId));
      await db.delete(userProfiles).where(inArray(userProfiles.userId, [ghostId, targetId]));
      await db.delete(users).where(inArray(users.id, [ghostId, targetId]));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test src/adapters/tests/ghost-dedup.spec.ts`
Expected: FAIL with "adapter.mergeGhostUser is not a function"

- [ ] **Step 3: Implement `mergeGhostUser` on `ProfileDatabaseAdapter`**

In `backend/src/adapters/database.adapter.ts`, add this method to `ProfileDatabaseAdapter`, after `findDuplicateUser`:

```typescript
  /**
   * Merge a ghost user (source) into a target user.
   * Re-points all references, deletes ghost-only records, soft-deletes source.
   */
  async mergeGhostUser(sourceId: string, targetId: string): Promise<void> {
    await db.transaction(async (tx) => {
      // ── 1. Delete ghost-only records (unique constraints) ──

      await tx.delete(schema.userProfiles).where(eq(schema.userProfiles.userId, sourceId));
      await tx.delete(schema.userNotificationSettings).where(eq(schema.userNotificationSettings.userId, sourceId));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, sourceId));
      await tx.delete(schema.accounts).where(eq(schema.accounts.userId, sourceId));
      await tx.delete(schema.apikeys).where(eq(schema.apikeys.userId, sourceId));
      await tx.delete(schema.agentPermissions).where(eq(schema.agentPermissions.userId, sourceId));
      await tx.delete(schema.agents).where(eq(schema.agents.ownerId, sourceId));

      // Delete ghost's HyDE documents
      await tx.delete(schema.hydeDocuments).where(
        and(
          eq(schema.hydeDocuments.sourceType, 'profile'),
          eq(schema.hydeDocuments.sourceId, sourceId),
        ),
      );

      // ── 2. Re-point simple FK references ──

      await tx.update(schema.intents)
        .set({ userId: targetId })
        .where(eq(schema.intents.userId, sourceId));

      await tx.update(schema.files)
        .set({ userId: targetId })
        .where(eq(schema.files.userId, sourceId));

      await tx.update(linksTable)
        .set({ userId: targetId })
        .where(eq(linksTable.userId, sourceId));

      // ── 3. Re-point network_members (composite PK: skip if target already member) ──

      const ghostMemberships = await tx.select({ networkId: schema.networkMembers.networkId })
        .from(schema.networkMembers)
        .where(and(eq(schema.networkMembers.userId, sourceId), isNull(schema.networkMembers.deletedAt)));

      const targetMemberships = await tx.select({ networkId: schema.networkMembers.networkId })
        .from(schema.networkMembers)
        .where(eq(schema.networkMembers.userId, targetId));
      const targetNetworkIds = new Set(targetMemberships.map(m => m.networkId));

      for (const gm of ghostMemberships) {
        if (targetNetworkIds.has(gm.networkId)) {
          // Target already in this network — soft-delete ghost's membership
          await tx.update(schema.networkMembers)
            .set({ deletedAt: new Date() })
            .where(and(
              eq(schema.networkMembers.networkId, gm.networkId),
              eq(schema.networkMembers.userId, sourceId),
            ));
        } else {
          // Re-point ghost's membership to target
          await tx.update(schema.networkMembers)
            .set({ userId: targetId })
            .where(and(
              eq(schema.networkMembers.networkId, gm.networkId),
              eq(schema.networkMembers.userId, sourceId),
            ));
        }
      }

      // ── 4. Re-point opportunity_deliveries (conditional unique: skip conflicts) ──

      const ghostDeliveries = await tx.select({
        id: schema.opportunityDeliveries.id,
        opportunityId: schema.opportunityDeliveries.opportunityId,
        channel: schema.opportunityDeliveries.channel,
        deliveredAtStatus: schema.opportunityDeliveries.deliveredAtStatus,
        deliveredAt: schema.opportunityDeliveries.deliveredAt,
      })
        .from(schema.opportunityDeliveries)
        .where(eq(schema.opportunityDeliveries.userId, sourceId));

      const targetDeliveries = await tx.select({
        opportunityId: schema.opportunityDeliveries.opportunityId,
        channel: schema.opportunityDeliveries.channel,
        deliveredAtStatus: schema.opportunityDeliveries.deliveredAtStatus,
      })
        .from(schema.opportunityDeliveries)
        .where(and(
          eq(schema.opportunityDeliveries.userId, targetId),
          sql`${schema.opportunityDeliveries.deliveredAt} IS NOT NULL`,
        ));

      const targetDeliveryKeys = new Set(
        targetDeliveries.map(d => `${d.opportunityId}:${d.channel}:${d.deliveredAtStatus}`),
      );

      for (const gd of ghostDeliveries) {
        const wouldConflict = gd.deliveredAt !== null &&
          targetDeliveryKeys.has(`${gd.opportunityId}:${gd.channel}:${gd.deliveredAtStatus}`);
        if (wouldConflict) {
          await tx.delete(schema.opportunityDeliveries).where(eq(schema.opportunityDeliveries.id, gd.id));
        } else {
          await tx.update(schema.opportunityDeliveries)
            .set({ userId: targetId })
            .where(eq(schema.opportunityDeliveries.id, gd.id));
        }
      }

      // ── 5. Re-point conversation_participants (composite PK: skip if target already in conversation) ──

      await tx.execute(sql`
        UPDATE conversation_participants
        SET participant_id = ${targetId}
        WHERE participant_id = ${sourceId}
          AND participant_type = 'user'
          AND conversation_id NOT IN (
            SELECT conversation_id FROM conversation_participants WHERE participant_id = ${targetId}
          )
      `);
      // Delete remaining ghost participants (where target already in conversation)
      await tx.execute(sql`
        DELETE FROM conversation_participants
        WHERE participant_id = ${sourceId} AND participant_type = 'user'
      `);

      // ── 6. Re-point messages ──

      await tx.execute(sql`
        UPDATE messages SET sender_id = ${targetId}
        WHERE sender_id = ${sourceId} AND role = 'user'
      `);

      // ── 7. Re-point opportunity actors JSONB ──

      const affectedOpps = await tx.execute(sql`
        SELECT id, actors, detection FROM opportunities
        WHERE actors::text LIKE ${'%' + sourceId + '%'}
           OR detection::text LIKE ${'%' + sourceId + '%'}
      `);

      for (const row of affectedOpps.rows as { id: string; actors: any; detection: any }[]) {
        const actors = (Array.isArray(row.actors) ? row.actors : []) as { userId: string; [k: string]: unknown }[];
        const updatedActors = actors.map(a =>
          a.userId === sourceId ? { ...a, userId: targetId } : a,
        );

        const detection = (row.detection ?? {}) as { createdBy?: string; [k: string]: unknown };
        const updatedDetection = detection.createdBy === sourceId
          ? { ...detection, createdBy: targetId }
          : detection;

        await tx.execute(sql`
          UPDATE opportunities
          SET actors = ${JSON.stringify(updatedActors)}::jsonb,
              detection = ${JSON.stringify(updatedDetection)}::jsonb
          WHERE id = ${row.id}
        `);
      }

      // ── 8. Soft-delete the ghost user ──

      await tx.update(schema.users)
        .set({ deletedAt: new Date() })
        .where(eq(schema.users.id, sourceId));
    });
  }
```

Note: The `linksTable` import — the `links` export in the schema is already imported. Check the existing imports at the top of the file; the schema uses `const linksTable = pgTable(...)` and exports `export const links = linksTable`. Use whichever name is imported in the adapter file (likely `schema.links` or import `links` directly).

- [ ] **Step 4: Expose `mergeGhostUser` on `ChatDatabaseAdapter`**

Add near the other profile-delegating methods:

```typescript
  async mergeGhostUser(sourceId: string, targetId: string): Promise<void> {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.mergeGhostUser(sourceId, targetId);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && bun test src/adapters/tests/ghost-dedup.spec.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/database.adapter.ts backend/src/adapters/tests/ghost-dedup.spec.ts
git commit -m "feat(protocol): implement mergeGhostUser with full FK re-pointing"
```

---

### Task 4: Integrate dedup into the profile graph

**Files:**
- Modify: `packages/protocol/src/profile/profile.graph.ts:432-484`

- [ ] **Step 1: Add the dedup check in `autoGenerateNode`**

In `packages/protocol/src/profile/profile.graph.ts`, inside the `if (hasMeaningfulEnrichment)` block (line 432), insert the dedup logic **after** the user record is updated with enriched socials (after line 474, where `await this.database.updateUser(state.userId, updatePayload)` completes) and **before** the `return { prePopulatedProfile: ... }` statement (line 476).

This ordering is important: the ghost's socials must be persisted first so that `findDuplicateUser` can see them, and so the ghost's enriched socials survive on the soft-deleted record for audit.

Insert this block after line 474 (`}`  closing the `if (Object.keys(updatePayload).length > 0)` block):

```typescript
              // Post-enrichment dedup: check if this ghost matches an existing user
              if (user.isGhost) {
                const enrichedSocials: { x?: string; linkedin?: string; github?: string; websites?: string[] } = {};
                if (enrichment!.socials.twitter) enrichedSocials.x = enrichment!.socials.twitter;
                if (enrichment!.socials.linkedin) enrichedSocials.linkedin = enrichment!.socials.linkedin;
                if (enrichment!.socials.github) enrichedSocials.github = enrichment!.socials.github;
                if (enrichment!.socials.websites?.length) enrichedSocials.websites = enrichment!.socials.websites;

                const duplicate = await this.database.findDuplicateUser(state.userId, enrichedSocials);
                if (duplicate) {
                  logger.info("Post-enrichment dedup: merging ghost into existing user", {
                    ghostId: state.userId,
                    targetId: duplicate.id,
                  });
                  await this.database.mergeGhostUser(state.userId, duplicate.id);
                  return { error: `Merged as duplicate of user ${duplicate.id}` };
                }
              }
```

- [ ] **Step 2: Verify the graph still compiles**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds with no type errors

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/profile/profile.graph.ts
git commit -m "feat(protocol): integrate post-enrichment ghost dedup into profile graph"
```

---

### Task 5: Run full test suite and verify

**Files:**
- No new files

- [ ] **Step 1: Run the ghost dedup tests**

Run: `cd backend && bun test src/adapters/tests/ghost-dedup.spec.ts`
Expected: All tests PASS

- [ ] **Step 2: Run existing profile-related tests to check for regressions**

Run: `cd backend && bun test src/adapters/tests/database.adapter.spec.ts`
Expected: All existing tests PASS

- [ ] **Step 3: Run existing auth adapter tests**

Run: `cd backend && bun test src/adapters/tests/auth.adapter.spec.ts`
Expected: All existing tests PASS

- [ ] **Step 4: Commit (if any fixes were needed)**

If any test adjustments were required, commit them:

```bash
git add -A
git commit -m "fix(protocol): resolve test regressions from ghost dedup integration"
```
