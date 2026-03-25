# Contacts Simplification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Replace the dual contact storage system (`user_contacts` table + `index_members` with `'contact'` permission) with a single `index_members`-based approach, and simplify the ghost user claim flow to use adapter-level upsert instead of data transfer.

**Architecture:** `addContact(email)` becomes the single primitive — finds or creates a user (ghost or real), upserts an `index_members` row with `'contact'` permission on the owner's personal index. Ghost users are created via Better Auth's adapter. Ghost claim on signup is handled by `onConflictDoUpdate` in the Drizzle adapter's `create` method, eliminating the `prepareGhostClaim`/`claimGhostUser` flow.

**Tech Stack:** Bun, Drizzle ORM, PostgreSQL, Better Auth, BullMQ

**Design doc:** `docs/plans/2026-03-17-contacts-simplification-design.md`

---

### Task 1: Migration — Drop Ghost Data and `user_contacts` Table

**Files:**
- Create: `protocol/drizzle/0017_drop_ghost_users_and_user_contacts.sql`
- Modify: `protocol/drizzle/meta/_journal.json` (add entry for 0017)

**Step 1: Write the migration SQL**

Create `protocol/drizzle/0017_drop_ghost_users_and_user_contacts.sql`:

```sql
-- Step 1: Collect ghost user IDs
CREATE TEMP TABLE ghost_ids AS
SELECT id FROM "users" WHERE "is_ghost" = true;

-- Step 2: Delete all rows referencing ghost users
DELETE FROM "chat_message_metadata" WHERE "message_id" IN (
  SELECT "id" FROM "chat_messages" WHERE "session_id" IN (
    SELECT "id" FROM "chat_sessions" WHERE "user_id" IN (SELECT id FROM ghost_ids)
  )
);
DELETE FROM "chat_messages" WHERE "session_id" IN (
  SELECT "id" FROM "chat_sessions" WHERE "user_id" IN (SELECT id FROM ghost_ids)
);
DELETE FROM "chat_session_metadata" WHERE "session_id" IN (
  SELECT "id" FROM "chat_sessions" WHERE "user_id" IN (SELECT id FROM ghost_ids)
);
DELETE FROM "chat_sessions" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "intent_indexes" WHERE "intent_id" IN (
  SELECT "id" FROM "intents" WHERE "user_id" IN (SELECT id FROM ghost_ids)
);
DELETE FROM "intents" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "index_members" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "hyde_documents" WHERE "source_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "user_profiles" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "user_notification_settings" WHERE "user_id" IN (SELECT id FROM ghost_ids);
DELETE FROM "opportunities" WHERE "id" IN (
  SELECT "id" FROM "opportunities" WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements("actors") AS actor
    WHERE actor->>'userId' IN (SELECT id FROM ghost_ids)
  )
);

-- Step 3: Delete ghost users
DELETE FROM "users" WHERE "is_ghost" = true;

-- Step 4: Drop user_contacts table
DROP TABLE IF EXISTS "user_contacts";

-- Step 5: Drop contact source enum
DROP TYPE IF EXISTS "contact_source";

-- Cleanup
DROP TABLE IF EXISTS ghost_ids;
```

**Step 2: Update the journal**

Add the entry in `protocol/drizzle/meta/_journal.json` for migration `0017` with tag `0017_drop_ghost_users_and_user_contacts`.

**Step 3: Run the migration**

Run: `cd protocol && bun run db:migrate`
Expected: Migration applies successfully.

**Step 4: Verify no schema diff**

Run: `cd protocol && bun run db:generate`
Expected: Reports schema changes (because we haven't updated the schema file yet — that's Task 2).

**Step 5: Commit**

```bash
git add protocol/drizzle/0017_drop_ghost_users_and_user_contacts.sql protocol/drizzle/meta/_journal.json
git commit -m "feat(db): migration to drop ghost user data and user_contacts table"
```

---

### Task 2: Update Database Schema — Remove `user_contacts`

**Files:**
- Modify: `protocol/src/schemas/database.schema.ts:437-438,581-608,638-640`

**Step 1: Remove `contactSourceEnum`, `userContacts` table, `userContactsRelations`, and type exports**

In `protocol/src/schemas/database.schema.ts`:

1. Remove `contactSourceEnum` (line 581)
2. Remove `userContacts` table definition (lines 583-595)
3. Remove `userContactsRelations` (lines 597-608)
4. Remove type exports `UserContact`, `NewUserContact`, `ContactSource` (lines 638-640)
5. Remove `ownedContacts` and `contactOf` relation references from `usersRelations` (lines 437-438)

**Step 2: Verify schema generates clean**

Run: `cd protocol && bun run db:generate`
Expected: "No schema changes" (migration already dropped the table).

**Step 3: Fix any import errors**

Run: `cd protocol && npx tsc --noEmit`
Expected: Type errors in files that import `ContactSource`, `UserContact`, etc. — these will be fixed in subsequent tasks.

**Step 4: Commit**

```bash
git add protocol/src/schemas/database.schema.ts
git commit -m "feat(schema): remove user_contacts table and contactSourceEnum"
```

---

### Task 3: Simplify Ghost Claim — Adapter-Level Upsert

**Files:**
- Modify: `protocol/src/adapters/auth.adapter.ts:35-91`
- Modify: `protocol/src/lib/betterauth/betterauth.ts:12-19,44,63-101`
- Test: `protocol/src/adapters/tests/auth.adapter.spec.ts` (create new)

**Step 1: Write the failing test for ghost claim via upsert**

Create `protocol/src/adapters/tests/auth.adapter.spec.ts`:

```typescript
import { loadEnv } from '../../lib/env';
loadEnv();

import { describe, it, expect, afterAll } from 'bun:test';
import { db } from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { eq } from 'drizzle-orm';
import { AuthDatabaseAdapter } from '../auth.adapter';

describe('AuthDatabaseAdapter', () => {
  const adapter = new AuthDatabaseAdapter();
  const testIds: string[] = [];

  afterAll(async () => {
    for (const id of testIds) {
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
  });

  describe('ghost claim via adapter upsert', () => {
    it('should create a ghost user normally', async () => {
      const ghostId = crypto.randomUUID();
      testIds.push(ghostId);

      const drizzleAdapter = adapter.createDrizzleAdapter();
      const adapterFn = typeof drizzleAdapter === 'function'
        ? drizzleAdapter({} as any)
        : drizzleAdapter;

      await (adapterFn as any).create({
        model: 'user',
        data: {
          id: ghostId,
          name: 'Ghost User',
          email: `ghost-test-${ghostId}@example.com`,
          isGhost: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const [ghost] = await db.select().from(schema.users).where(eq(schema.users.id, ghostId));
      expect(ghost).toBeDefined();
      expect(ghost.isGhost).toBe(true);
      expect(ghost.name).toBe('Ghost User');
    });

    it('should convert ghost to real user on email conflict', async () => {
      // Create ghost first
      const ghostId = crypto.randomUUID();
      testIds.push(ghostId);
      const email = `claim-test-${ghostId}@example.com`;

      await db.insert(schema.users).values({
        id: ghostId,
        name: 'Ghost Before',
        email,
        isGhost: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Simulate Better Auth signup with same email
      const drizzleAdapter = adapter.createDrizzleAdapter();
      const adapterFn = typeof drizzleAdapter === 'function'
        ? drizzleAdapter({} as any)
        : drizzleAdapter;

      const newId = crypto.randomUUID();
      // Don't track newId — the upsert should reuse ghostId
      const result = await (adapterFn as any).create({
        model: 'user',
        data: {
          id: newId,
          name: 'Real User',
          email,
          isGhost: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Should return the ghost's original ID, not the new one
      expect(result.id).toBe(ghostId);
      expect(result.isGhost).toBe(false);
      expect(result.name).toBe('Real User');

      // New ID should NOT exist
      const [shouldNotExist] = await db.select().from(schema.users).where(eq(schema.users.id, newId));
      expect(shouldNotExist).toBeUndefined();
    });

    it('should not upsert over a real user with same email', async () => {
      const realId = crypto.randomUUID();
      testIds.push(realId);
      const email = `real-test-${realId}@example.com`;

      await db.insert(schema.users).values({
        id: realId,
        name: 'Real Existing',
        email,
        isGhost: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const drizzleAdapter = adapter.createDrizzleAdapter();
      const adapterFn = typeof drizzleAdapter === 'function'
        ? drizzleAdapter({} as any)
        : drizzleAdapter;

      const newId = crypto.randomUUID();
      // This should throw or fail — duplicate email on a non-ghost user
      try {
        await (adapterFn as any).create({
          model: 'user',
          data: {
            id: newId,
            name: 'Duplicate',
            email,
            isGhost: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        // If it doesn't throw, the original user should be unchanged
        const [user] = await db.select().from(schema.users).where(eq(schema.users.id, realId));
        expect(user.name).toBe('Real Existing');
      } catch (e) {
        // Expected — unique constraint violation
        expect(e).toBeDefined();
      }
    });
  });
}, { timeout: 30_000 });
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/adapters/tests/auth.adapter.spec.ts`
Expected: FAIL — `createDrizzleAdapter` doesn't have upsert behavior yet.

**Step 3: Modify `AuthDatabaseAdapter.createDrizzleAdapter` to wrap the adapter**

In `protocol/src/adapters/auth.adapter.ts`, replace the current implementation:

```typescript
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq, and, sql } from 'drizzle-orm';

import { db } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { ensurePersonalIndex } from './database.adapter';

/**
 * Database adapter for Better Auth integration.
 * Provides the drizzle adapter config with ghost-claim-via-upsert
 * and personal index creation hooks.
 */
export class AuthDatabaseAdapter {
  /**
   * Returns a configured drizzle adapter for Better Auth's `database` option.
   * Wraps the default adapter to handle ghost user claims via ON CONFLICT:
   * when a real user signs up with an email that belongs to a ghost,
   * the ghost row is converted in-place (isGhost=false) instead of
   * creating a new row and transferring data.
   */
  createDrizzleAdapter() {
    const baseAdapter = drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        ...schema,
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        jwks: schema.jwks,
      },
    });

    // Wrap the adapter to intercept user creation
    return (options: any) => {
      const resolved = typeof baseAdapter === 'function' ? baseAdapter(options) : baseAdapter;
      const originalCreate = resolved.create.bind(resolved);

      return {
        ...resolved,
        create: async (params: { model: string; data: any; [key: string]: any }) => {
          if (params.model === 'user') {
            const result = await db
              .insert(schema.users)
              .values(params.data)
              .onConflictDoUpdate({
                target: schema.users.email,
                set: {
                  name: sql`EXCLUDED."name"`,
                  avatar: sql`EXCLUDED."avatar"`,
                  isGhost: sql`false`,
                  updatedAt: sql`now()`,
                },
                setWhere: eq(schema.users.isGhost, true),
              })
              .returning();
            return result[0];
          }
          return originalCreate(params);
        },
      };
    };
  }

  /**
   * Creates a personal index for the user if one doesn't exist.
   * Idempotent — safe to call on every sign-in.
   * @param userId - The authenticated user
   * @returns The personal index ID
   */
  async ensurePersonalIndex(userId: string): Promise<string> {
    return ensurePersonalIndex(userId);
  }
}
```

**Step 4: Simplify `AuthDbContract` and `createAuth`**

In `protocol/src/lib/betterauth/betterauth.ts`:

1. Remove `prepareGhostClaim`, `claimGhostUser`, `restoreGhostEmail` from `AuthDbContract`
2. Remove `pendingGhostClaims` map
3. Remove ghost claim logic from `create.before` and `create.after` hooks
4. Keep `ensurePersonalIndex` in `create.after` and `session.create.after`

Updated `AuthDbContract`:

```typescript
export interface AuthDbContract {
  /** Returns a configured adapter object for Better Auth's `database` option. */
  createDrizzleAdapter(): unknown;
  ensurePersonalIndex(userId: string): Promise<string>;
}
```

Updated `createAuth` — remove lines 44, 63-73, 87-101. The `user.create` hooks become:

```typescript
user: {
  create: {
    after: async (user) => {
      try {
        if (ensureWallet) await ensureWallet(user.id);
      } catch (_) { /* wallet generation failure shouldn't block registration */ }

      try {
        await authDb.ensurePersonalIndex(user.id);
      } catch (err) {
        logger.error('Failed to create personal index on registration', { userId: user.id, error: err });
      }
    },
  },
},
```

**Step 5: Run tests to verify they pass**

Run: `cd protocol && bun test src/adapters/tests/auth.adapter.spec.ts`
Expected: PASS

**Step 6: Run tsc to verify no type errors**

Run: `cd protocol && npx tsc --noEmit`
Expected: May have errors from removed `AuthDbContract` methods in `main.ts` — fix by removing references.

**Step 7: Commit**

```bash
git add protocol/src/adapters/auth.adapter.ts protocol/src/lib/betterauth/betterauth.ts protocol/src/adapters/tests/auth.adapter.spec.ts
git commit -m "feat(auth): simplify ghost claim to adapter-level upsert on email conflict"
```

---

### Task 4: Rewrite `ContactService` with `addContact` Primitive

**Files:**
- Modify: `protocol/src/services/contact.service.ts` (full rewrite)
- Modify: `protocol/src/adapters/database.adapter.ts` (add new methods, remove old)
- Modify: `protocol/src/lib/protocol/interfaces/database.interface.ts:1156-1178,1594,1672,1696`
- Test: `protocol/src/services/tests/contact.service.spec.ts` (full rewrite)

**Step 1: Write the failing tests for the new `addContact` primitive**

Rewrite `protocol/src/services/tests/contact.service.spec.ts`:

```typescript
import { loadEnv } from '../../lib/env';
loadEnv();

import { describe, it, expect, afterAll, beforeAll } from 'bun:test';
import { db } from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { eq, and, sql } from 'drizzle-orm';
import { ContactService } from '../contact.service';

describe('ContactService', () => {
  const service = new ContactService();
  const testUserIds: string[] = [];
  const testIndexIds: string[] = [];
  let ownerId: string;
  let ownerPersonalIndexId: string;

  beforeAll(async () => {
    // Create test owner with personal index
    ownerId = crypto.randomUUID();
    testUserIds.push(ownerId);
    await db.insert(schema.users).values({
      id: ownerId,
      name: 'Test Owner',
      email: `owner-${ownerId}@test.com`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    ownerPersonalIndexId = crypto.randomUUID();
    testIndexIds.push(ownerPersonalIndexId);
    await db.insert(schema.indexes).values({
      id: ownerPersonalIndexId,
      title: 'Personal',
      isPersonal: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(schema.personalIndexes).values({
      userId: ownerId,
      indexId: ownerPersonalIndexId,
    });
    await db.insert(schema.indexMembers).values({
      indexId: ownerPersonalIndexId,
      userId: ownerId,
      permissions: ['owner'],
    });
  });

  afterAll(async () => {
    // Cleanup in reverse dependency order
    for (const indexId of testIndexIds) {
      await db.delete(schema.indexMembers).where(eq(schema.indexMembers.indexId, indexId));
      await db.delete(schema.personalIndexes).where(eq(schema.personalIndexes.indexId, indexId));
      await db.delete(schema.indexes).where(eq(schema.indexes.id, indexId));
    }
    for (const userId of testUserIds) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  describe('addContact', () => {
    it('should add an existing real user as contact', async () => {
      const contactId = crypto.randomUUID();
      testUserIds.push(contactId);
      const email = `real-${contactId}@test.com`;
      await db.insert(schema.users).values({
        id: contactId,
        name: 'Real Contact',
        email,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.addContact(ownerId, email);
      expect(result.userId).toBe(contactId);
      expect(result.isGhost).toBe(false);
      expect(result.isNew).toBe(false);

      // Verify index_members row
      const [member] = await db.select()
        .from(schema.indexMembers)
        .where(and(
          eq(schema.indexMembers.indexId, ownerPersonalIndexId),
          eq(schema.indexMembers.userId, contactId),
        ));
      expect(member).toBeDefined();
      expect(member.permissions).toEqual(['contact']);
    });

    it('should create ghost user for unknown email and add as contact', async () => {
      const email = `ghost-${crypto.randomUUID()}@test.com`;
      const result = await service.addContact(ownerId, email);

      expect(result.isGhost).toBe(true);
      expect(result.isNew).toBe(true);
      testUserIds.push(result.userId);

      // Verify ghost user created
      const [ghost] = await db.select().from(schema.users).where(eq(schema.users.id, result.userId));
      expect(ghost).toBeDefined();
      expect(ghost.isGhost).toBe(true);
      expect(ghost.email).toBe(email);

      // Verify index_members row
      const [member] = await db.select()
        .from(schema.indexMembers)
        .where(and(
          eq(schema.indexMembers.indexId, ownerPersonalIndexId),
          eq(schema.indexMembers.userId, result.userId),
        ));
      expect(member).toBeDefined();
      expect(member.permissions).toEqual(['contact']);
    });

    it('should not restore soft-deleted contact by default', async () => {
      const contactId = crypto.randomUUID();
      testUserIds.push(contactId);
      const email = `softdel-${contactId}@test.com`;
      await db.insert(schema.users).values({
        id: contactId, name: 'Soft Del', email,
        createdAt: new Date(), updatedAt: new Date(),
      });
      // Create soft-deleted membership
      await db.insert(schema.indexMembers).values({
        indexId: ownerPersonalIndexId,
        userId: contactId,
        permissions: ['contact'],
        deletedAt: new Date(),
      });

      const result = await service.addContact(ownerId, email);
      expect(result.userId).toBe(contactId);

      // Should still be soft-deleted
      const [member] = await db.select()
        .from(schema.indexMembers)
        .where(and(
          eq(schema.indexMembers.indexId, ownerPersonalIndexId),
          eq(schema.indexMembers.userId, contactId),
        ));
      expect(member.deletedAt).not.toBeNull();
    });

    it('should restore soft-deleted contact when restore=true', async () => {
      const contactId = crypto.randomUUID();
      testUserIds.push(contactId);
      const email = `restore-${contactId}@test.com`;
      await db.insert(schema.users).values({
        id: contactId, name: 'Restore Me', email,
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.insert(schema.indexMembers).values({
        indexId: ownerPersonalIndexId,
        userId: contactId,
        permissions: ['contact'],
        deletedAt: new Date(),
      });

      const result = await service.addContact(ownerId, email, { restore: true });
      expect(result.userId).toBe(contactId);

      const [member] = await db.select()
        .from(schema.indexMembers)
        .where(and(
          eq(schema.indexMembers.indexId, ownerPersonalIndexId),
          eq(schema.indexMembers.userId, contactId),
        ));
      expect(member.deletedAt).toBeNull();
    });

    it('should clear reverse opt-out when adding contact', async () => {
      // User B has owner in their personal index as soft-deleted contact
      const userBId = crypto.randomUUID();
      testUserIds.push(userBId);
      const email = `reverse-${userBId}@test.com`;
      await db.insert(schema.users).values({
        id: userBId, name: 'User B', email,
        createdAt: new Date(), updatedAt: new Date(),
      });
      const userBPersonalIndexId = crypto.randomUUID();
      testIndexIds.push(userBPersonalIndexId);
      await db.insert(schema.indexes).values({
        id: userBPersonalIndexId, title: 'B Personal', isPersonal: true,
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.insert(schema.personalIndexes).values({
        userId: userBId, indexId: userBPersonalIndexId,
      });
      // Owner is soft-deleted in B's personal index
      await db.insert(schema.indexMembers).values({
        indexId: userBPersonalIndexId,
        userId: ownerId,
        permissions: ['contact'],
        deletedAt: new Date(),
      });

      // User B adds owner as contact
      await service.addContact(userBId, `owner-${ownerId}@test.com`);

      // The soft-deleted membership of owner in B's index should be cleared
      // (but that's handled by B calling addContact for owner)
      // The REVERSE: owner's soft-deleted membership in B's index should be hard-deleted
      const [member] = await db.select()
        .from(schema.indexMembers)
        .where(and(
          eq(schema.indexMembers.indexId, userBPersonalIndexId),
          eq(schema.indexMembers.userId, ownerId),
        ));
      expect(member).toBeUndefined();
    });
  });

  describe('removeContact', () => {
    it('should hard-delete the index_members row', async () => {
      const contactId = crypto.randomUUID();
      testUserIds.push(contactId);
      const email = `remove-${contactId}@test.com`;
      await db.insert(schema.users).values({
        id: contactId, name: 'To Remove', email,
        createdAt: new Date(), updatedAt: new Date(),
      });
      await service.addContact(ownerId, email);

      await service.removeContact(ownerId, contactId);

      const [member] = await db.select()
        .from(schema.indexMembers)
        .where(and(
          eq(schema.indexMembers.indexId, ownerPersonalIndexId),
          eq(schema.indexMembers.userId, contactId),
        ));
      expect(member).toBeUndefined();
    });
  });

  describe('listContacts', () => {
    it('should return contacts with user details', async () => {
      const contactId = crypto.randomUUID();
      testUserIds.push(contactId);
      const email = `list-${contactId}@test.com`;
      await db.insert(schema.users).values({
        id: contactId, name: 'Listed Contact', email,
        createdAt: new Date(), updatedAt: new Date(),
      });
      await service.addContact(ownerId, email);

      const contacts = await service.listContacts(ownerId);
      const found = contacts.find(c => c.userId === contactId);
      expect(found).toBeDefined();
      expect(found!.user.name).toBe('Listed Contact');
      expect(found!.user.email).toBe(email);
    });

    it('should not return soft-deleted contacts', async () => {
      const contactId = crypto.randomUUID();
      testUserIds.push(contactId);
      const email = `hidden-${contactId}@test.com`;
      await db.insert(schema.users).values({
        id: contactId, name: 'Hidden', email,
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.insert(schema.indexMembers).values({
        indexId: ownerPersonalIndexId,
        userId: contactId,
        permissions: ['contact'],
        deletedAt: new Date(),
      });

      const contacts = await service.listContacts(ownerId);
      const found = contacts.find(c => c.userId === contactId);
      expect(found).toBeUndefined();
    });
  });
}, { timeout: 60_000 });
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/services/tests/contact.service.spec.ts`
Expected: FAIL

**Step 3: Add new database adapter methods**

In `protocol/src/adapters/database.adapter.ts`, add these new methods and remove old ones:

**Remove** (old contact methods):
- `upsertContact` (~lines 2750-2767)
- `getContacts` (~lines 2774-2815)
- `removeContact` (~lines 2822-2877)
- `upsertContactsBulk` (~lines 3011-3032)
- `importContactsBulk` (~lines 3046-3164)
- `getUsersByEmails` (~lines 2922-2934) — keep, still needed
- `getSoftDeletedGhostEmails` (~lines 2734-2744) — keep, still needed

**Add** new methods:

```typescript
/**
 * Upsert a contact as an index_members row on the owner's personal index.
 * @param ownerId - The user adding the contact
 * @param contactUserId - The contact's user ID
 * @param options - { restore?: boolean } — if true, clears deletedAt on soft-deleted rows
 */
async upsertContactMembership(
  ownerId: string,
  contactUserId: string,
  options?: { restore?: boolean }
): Promise<void> {
  const personalIndex = await this.getPersonalIndex(ownerId);
  if (!personalIndex) throw new Error(`No personal index found for user ${ownerId}`);

  if (options?.restore) {
    await db.insert(schema.indexMembers)
      .values({
        indexId: personalIndex.indexId,
        userId: contactUserId,
        permissions: ['contact'],
        autoAssign: false,
      })
      .onConflictDoUpdate({
        target: [schema.indexMembers.indexId, schema.indexMembers.userId],
        set: { deletedAt: null },
      });
  } else {
    // Check if soft-deleted row exists — if so, skip
    const existing = await db.select({ deletedAt: schema.indexMembers.deletedAt })
      .from(schema.indexMembers)
      .where(and(
        eq(schema.indexMembers.indexId, personalIndex.indexId),
        eq(schema.indexMembers.userId, contactUserId),
      ))
      .limit(1);

    if (existing.length > 0 && existing[0].deletedAt !== null) {
      return; // Soft-deleted — don't restore
    }

    await db.insert(schema.indexMembers)
      .values({
        indexId: personalIndex.indexId,
        userId: contactUserId,
        permissions: ['contact'],
        autoAssign: false,
      })
      .onConflictDoNothing();
  }
}

/**
 * Hard-delete a contact's index_members row from the owner's personal index.
 * @param ownerId - The user removing the contact
 * @param contactUserId - The contact's user ID
 */
async hardDeleteContactMembership(ownerId: string, contactUserId: string): Promise<void> {
  const personalIndex = await this.getPersonalIndex(ownerId);
  if (!personalIndex) return;

  await db.delete(schema.indexMembers)
    .where(and(
      eq(schema.indexMembers.indexId, personalIndex.indexId),
      eq(schema.indexMembers.userId, contactUserId),
      sql`'contact' = ANY(${schema.indexMembers.permissions})`,
    ));
}

/**
 * Hard-delete any soft-deleted membership where contactUserId is a contact
 * in the other user's personal index. Used to clear reverse opt-outs.
 * @param contactUserId - The user who is adding someone as contact
 * @param otherUserId - The user whose personal index may have a soft-deleted row
 */
async clearReverseOptOut(contactUserId: string, otherUserId: string): Promise<void> {
  const personalIndexes = await this.getPersonalIndexesForContact(contactUserId);
  // Find personal indexes owned by otherUserId where contactUserId is soft-deleted
  for (const { indexId } of personalIndexes) {
    // Not quite right — we need otherUserId's personal index
  }
  // Simpler: query directly
  const otherPersonalIndex = await this.getPersonalIndex(otherUserId);
  if (!otherPersonalIndex) return;

  await db.delete(schema.indexMembers)
    .where(and(
      eq(schema.indexMembers.indexId, otherPersonalIndex.indexId),
      eq(schema.indexMembers.userId, contactUserId),
      sql`'contact' = ANY(${schema.indexMembers.permissions})`,
      sql`${schema.indexMembers.deletedAt} IS NOT NULL`,
    ));
}

/**
 * Get all contacts for a user (non-soft-deleted index_members with 'contact' permission
 * on their personal index).
 * @param ownerId - The user whose contacts to list
 * @returns Array of contacts with user details
 */
async getContactMembers(ownerId: string): Promise<Array<{
  userId: string;
  user: { id: string; name: string; email: string; avatar: string | null; isGhost: boolean };
}>> {
  const personalIndex = await this.getPersonalIndex(ownerId);
  if (!personalIndex) return [];

  return db.select({
    userId: schema.indexMembers.userId,
    user: {
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      avatar: schema.users.avatar,
      isGhost: schema.users.isGhost,
    },
  })
  .from(schema.indexMembers)
  .innerJoin(schema.users, eq(schema.indexMembers.userId, schema.users.id))
  .where(and(
    eq(schema.indexMembers.indexId, personalIndex.indexId),
    sql`'contact' = ANY(${schema.indexMembers.permissions})`,
    sql`${schema.indexMembers.deletedAt} IS NULL`,
  ));
}
```

Also check if `getPersonalIndex(userId)` exists. If not, add a helper:

```typescript
/**
 * Get the personal index ID for a user.
 * @param userId - The user's ID
 * @returns The personal index record or null
 */
async getPersonalIndex(userId: string): Promise<{ indexId: string } | null> {
  const [result] = await db.select({ indexId: schema.personalIndexes.indexId })
    .from(schema.personalIndexes)
    .where(eq(schema.personalIndexes.userId, userId))
    .limit(1);
  return result ?? null;
}
```

**Step 4: Update the database interface**

In `protocol/src/lib/protocol/interfaces/database.interface.ts`:

- Remove `upsertContact` from the interface (~line 1157)
- Remove `getContacts` (~line 1160)
- Remove `removeContact` (~line 1169)
- Update type unions that reference these methods (~lines 1594, 1672)
- Add `upsertContactMembership`, `hardDeleteContactMembership`, `getContactMembers`, `clearReverseOptOut` to the interface

**Step 5: Rewrite `ContactService`**

Replace `protocol/src/services/contact.service.ts`:

```typescript
import { log } from '../lib/log';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { profileQueue } from '../queues/profile.queue';

const logger = log.service.from('ContactService');

/** Email prefixes that indicate automated/service accounts. */
const NON_HUMAN_PREFIXES = new Set([
  'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply',
  'support', 'info', 'help', 'sales', 'marketing', 'hello',
  'notifications', 'notification', 'alerts', 'alert',
  'newsletter', 'newsletters', 'news', 'updates', 'update',
  'billing', 'invoices', 'receipts', 'orders',
  'admin', 'administrator', 'system', 'mailer', 'mailer-daemon',
  'daemon', 'postmaster', 'webmaster', 'hostmaster',
  'feedback', 'contact', 'team', 'service', 'services',
  'security', 'privacy', 'legal', 'compliance',
  'calendar', 'calendar-server', 'calendar-notification',
]);

/** Domain patterns that indicate automated/service emails. */
const NON_HUMAN_DOMAIN_PATTERNS = [
  /calendar-notification\.google\.com$/i,
  /accounts\.google\.com$/i,
  /notifications\..+\.com$/i,
  /noreply\..+$/i,
  /mailer\..+$/i,
  /^test\.(com|dev|local|internal)$/i,
];

/** Name patterns that indicate non-human contacts. */
const NON_HUMAN_NAME_PATTERNS = [
  /^no[ -_]?reply$/i,
  /support$/i,
  /team$/i,
  /^(the )?.+ (team|support|notifications|alerts)$/i,
];

/**
 * Determines if a contact appears to be a human (not a service/automated account).
 * @param email - The contact's email address
 * @param name - The contact's name (may be empty)
 * @returns true if the contact appears to be human
 */
export function isHumanContact(email: string, name: string): boolean {
  const [prefix, domain] = email.toLowerCase().split('@');
  if (NON_HUMAN_PREFIXES.has(prefix)) return false;
  if (NON_HUMAN_DOMAIN_PATTERNS.some(p => p.test(domain))) return false;
  if (name && NON_HUMAN_NAME_PATTERNS.some(p => p.test(name))) return false;
  return true;
}

/** Result of adding a single contact. */
export interface ContactResult {
  userId: string;
  isNew: boolean;
  isGhost: boolean;
}

/** Contact with user details (for listing). */
export interface Contact {
  userId: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
    isGhost: boolean;
  };
}

/** Result of bulk importing contacts. */
export interface ImportResult {
  imported: number;
  skipped: number;
  newContacts: number;
  existingContacts: number;
  details: Array<{ email: string; userId: string; isNew: boolean }>;
}

/**
 * Manages user contacts ("My Network").
 *
 * Contacts are stored as `index_members` rows with `'contact'` permission
 * on the owner's personal index. No separate `user_contacts` table.
 *
 * @remarks
 * - `addContact` is the single primitive for all contact creation
 * - Ghost users are created for unknown emails and enriched asynchronously
 * - Contacts are one-way: A adding B does not make A a contact of B
 */
export class ContactService {
  constructor(private db = new ChatDatabaseAdapter()) {}

  /**
   * Add a single contact by email. Creates a ghost user if the email is unknown.
   * Adds the user to the owner's personal index with `'contact'` permission.
   *
   * @param ownerId - The user adding the contact
   * @param email - Email of the contact to add
   * @param options - { name?: string, restore?: boolean }
   *   - `name`: Optional display name for ghost creation
   *   - `restore`: If true, reactivates soft-deleted memberships (e.g. from opportunity acceptance).
   *     Defaults to false.
   * @returns The contact result with userId, isNew, isGhost
   */
  async addContact(
    ownerId: string,
    email: string,
    options?: { name?: string; restore?: boolean }
  ): Promise<ContactResult> {
    const normalizedEmail = email.toLowerCase().trim();
    logger.info('[ContactService] Adding contact', { ownerId, email: normalizedEmail });

    // Resolve user
    let user = await this.db.getUserByEmail(normalizedEmail);
    let isNew = false;

    if (!user) {
      // Create ghost user
      const ghostId = crypto.randomUUID();
      const name = options?.name || normalizedEmail.split('@')[0];
      await this.db.createGhostUser(ghostId, name, normalizedEmail);
      user = { id: ghostId, name, email: normalizedEmail, isGhost: true };
      isNew = true;
    }

    // Upsert index_members row
    await this.db.upsertContactMembership(ownerId, user.id, { restore: options?.restore });

    // Clear reverse opt-out: if the contact has a personal index where
    // the owner is soft-deleted, hard-delete that row
    await this.db.clearReverseOptOut(ownerId, user.id);

    // Enqueue enrichment for new ghosts
    if (isNew && user.isGhost) {
      await profileQueue.addEnrichGhostJob({ userId: user.id });
      logger.info('[ContactService] Enrichment job enqueued for new ghost', { userId: user.id });
    }

    return { userId: user.id, isNew, isGhost: user.isGhost };
  }

  /**
   * Import contacts in bulk from an integration or manual input.
   * Filters non-human emails, deduplicates, and delegates to addContact for each.
   *
   * @param ownerId - The user importing contacts
   * @param contacts - Array of { name, email }
   * @returns Import statistics
   */
  async importContacts(
    ownerId: string,
    contacts: Array<{ name: string; email: string }>
  ): Promise<ImportResult> {
    logger.info('[ContactService] Importing contacts', { ownerId, count: contacts.length });

    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      newContacts: 0,
      existingContacts: 0,
      details: [],
    };

    const owner = await this.db.getUser(ownerId);
    const ownerEmail = owner?.email?.toLowerCase();

    // Normalize, filter, deduplicate
    const seenEmails = new Set<string>();
    const validContacts: Array<{ name: string; email: string }> = [];
    for (const contact of contacts) {
      const email = contact.email.toLowerCase().trim();
      if (!email || !email.includes('@')) { result.skipped++; continue; }
      if (ownerEmail === email) { result.skipped++; continue; }
      if (seenEmails.has(email)) { result.skipped++; continue; }
      const name = contact.name?.trim() || '';
      if (!isHumanContact(email, name)) { result.skipped++; continue; }
      seenEmails.add(email);
      validContacts.push({ name: name || email.split('@')[0], email });
    }

    if (validContacts.length === 0) {
      logger.info('[ContactService] No valid contacts to import', { ownerId });
      return result;
    }

    // Process each contact (restore=false — bulk imports don't restore opt-outs)
    for (const contact of validContacts) {
      const contactResult = await this.addContact(ownerId, contact.email, {
        name: contact.name,
        restore: false,
      });
      result.details.push({
        email: contact.email,
        userId: contactResult.userId,
        isNew: contactResult.isNew,
      });
      if (contactResult.isNew) result.newContacts++;
      else result.existingContacts++;
    }
    result.imported = result.details.length;

    logger.info('[ContactService] Import completed', {
      ownerId,
      imported: result.imported,
      skipped: result.skipped,
      newContacts: result.newContacts,
      existingContacts: result.existingContacts,
    });

    return result;
  }

  /**
   * List all contacts for a user (non-soft-deleted members with 'contact' permission).
   *
   * @param ownerId - The user whose contacts to list
   * @returns Array of contacts with user details
   */
  async listContacts(ownerId: string): Promise<Contact[]> {
    logger.verbose('[ContactService] Listing contacts', { ownerId });
    return this.db.getContactMembers(ownerId);
  }

  /**
   * Remove a contact from the user's network (hard delete).
   *
   * @param ownerId - The user removing the contact
   * @param contactUserId - The contact's user ID
   */
  async removeContact(ownerId: string, contactUserId: string): Promise<void> {
    logger.info('[ContactService] Removing contact', { ownerId, contactUserId });
    await this.db.hardDeleteContactMembership(ownerId, contactUserId);
  }
}

export const contactService = new ContactService();
```

**Step 6: Add `createGhostUser` to database adapter**

In `protocol/src/adapters/database.adapter.ts`, add:

```typescript
/**
 * Create a ghost user directly in the users table.
 * @param id - The ghost user's ID
 * @param name - Display name
 * @param email - Email address
 */
async createGhostUser(id: string, name: string, email: string): Promise<void> {
  await db.insert(schema.users).values({
    id,
    name,
    email,
    isGhost: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();
}
```

**Step 7: Run tests**

Run: `cd protocol && bun test src/services/tests/contact.service.spec.ts`
Expected: PASS

**Step 8: Run tsc**

Run: `cd protocol && npx tsc --noEmit`
Expected: PASS (or errors from downstream consumers — fixed in subsequent tasks)

**Step 9: Commit**

```bash
git add protocol/src/services/contact.service.ts protocol/src/services/tests/contact.service.spec.ts protocol/src/adapters/database.adapter.ts protocol/src/lib/protocol/interfaces/database.interface.ts
git commit -m "feat(contacts): rewrite ContactService with addContact primitive on index_members"
```

---

### Task 5: Update Contact Chat Tools

**Files:**
- Modify: `protocol/src/lib/protocol/tools/contact.tools.ts:14-151`

**Step 1: Update tool implementations**

In `protocol/src/lib/protocol/tools/contact.tools.ts`:

- `import_contacts` — remove `source` parameter, call `contactService.importContacts(userId, contacts)`
- `list_contacts` — update return shape (no more `source`, `importedAt`, `id` fields)
- `add_contact` — call `contactService.addContact(userId, email, { name })`
- `remove_contact` — change input from `contactId` (record ID) to `contactUserId` (user ID), call `contactService.removeContact(userId, contactUserId)`

**Step 2: Run tsc**

Run: `cd protocol && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/tools/contact.tools.ts
git commit -m "refactor(tools): update contact tools for index_members-based contacts"
```

---

### Task 6: Update Integration Tools (Gmail Import)

**Files:**
- Modify: `protocol/src/lib/protocol/tools/integration.tools.ts:109-113`

**Step 1: Update Gmail import call**

In `protocol/src/lib/protocol/tools/integration.tools.ts`, change:

```typescript
// Before:
const result = await contactService.importContacts(context.userId, contacts, 'gmail');

// After:
const result = await contactService.importContacts(context.userId, contacts);
```

Remove the `source` parameter.

**Step 2: Run tsc**

Run: `cd protocol && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/tools/integration.tools.ts
git commit -m "refactor(tools): remove source param from gmail contact import"
```

---

### Task 7: Update Opportunity Service

**Files:**
- Modify: `protocol/src/services/opportunity.service.ts:~291`

**Step 1: Replace `db.upsertContact` with `contactService.addContact`**

In `protocol/src/services/opportunity.service.ts`, change the opportunity acceptance handler:

```typescript
// Before:
await this.db.upsertContact({ ownerId: userId, userId: counterpart.userId, source: 'manual' });

// After:
import { contactService } from './contact.service';
// ...
const counterpartUser = await this.db.getUser(counterpart.userId);
if (counterpartUser) {
  await contactService.addContact(userId, counterpartUser.email, { restore: true });
}
```

Note: `restore: true` because opportunity acceptance should reactivate soft-deleted contacts.

**Step 2: Run existing opportunity tests**

Run: `cd protocol && bun test src/services/tests/opportunity.service.updateStatus.spec.ts`
Expected: PASS (may need test adjustments)

**Step 3: Run tsc**

Run: `cd protocol && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add protocol/src/services/opportunity.service.ts
git commit -m "refactor(opportunity): use addContact with restore on acceptance"
```

---

### Task 8: Update Unsubscribe Flow

**Files:**
- Modify: `protocol/src/services/unsubscribe.service.ts`
- Modify: `protocol/src/adapters/database.adapter.ts` (`softDeleteGhostByUnsubscribeToken` ~line 2682)

**Step 1: Update `softDeleteGhostByUnsubscribeToken`**

The current implementation soft-deletes the ghost **user row** (`users.deletedAt`). In the new design, it should soft-delete all `index_members` rows where this ghost is a contact (i.e., soft-delete in every personal index where they appear).

In `protocol/src/adapters/database.adapter.ts`, update `softDeleteGhostByUnsubscribeToken`:

```typescript
async softDeleteGhostByUnsubscribeToken(token: string): Promise<boolean> {
  const [settings] = await db.select({ userId: schema.userNotificationSettings.userId })
    .from(schema.userNotificationSettings)
    .where(eq(schema.userNotificationSettings.unsubscribeToken, token))
    .limit(1);
  if (!settings) return false;

  // Verify user is a ghost
  const [user] = await db.select({ id: schema.users.id, isGhost: schema.users.isGhost })
    .from(schema.users)
    .where(eq(schema.users.id, settings.userId))
    .limit(1);
  if (!user || !user.isGhost) return false;

  // Soft-delete all index_members rows where this ghost is a contact
  const result = await db.update(schema.indexMembers)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(schema.indexMembers.userId, settings.userId),
      sql`'contact' = ANY(${schema.indexMembers.permissions})`,
      isNull(schema.indexMembers.deletedAt),
    ))
    .returning({ indexId: schema.indexMembers.indexId });

  return result.length > 0;
}
```

**Step 2: Run tsc**

Run: `cd protocol && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts protocol/src/services/unsubscribe.service.ts
git commit -m "refactor(unsubscribe): soft-delete index_members instead of user row"
```

---

### Task 9: Clean Up Old Code

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts` — remove old contact methods
- Modify: `protocol/src/lib/protocol/interfaces/database.interface.ts` — remove old contact method signatures
- Remove: `protocol/src/services/tests/contact.filter.spec.ts` — keep (still valid, tests `isHumanContact`)
- Modify: `protocol/src/adapters/tests/personal-index.adapter.spec.ts` — update contact-related tests
- Modify: `protocol/src/adapters/tests/database.adapter.spec.ts` — remove ghost transfer tests

**Step 1: Remove old database adapter methods**

Remove from `protocol/src/adapters/database.adapter.ts`:
- `upsertContact` (~lines 2750-2767)
- Old `getContacts` (~lines 2774-2815)
- Old `removeContact` (~lines 2822-2877)
- `upsertContactsBulk` (~lines 3011-3032)
- `importContactsBulk` (~lines 3046-3164)

**Step 2: Remove old interface methods**

Remove from `protocol/src/lib/protocol/interfaces/database.interface.ts`:
- `upsertContact` (~line 1157)
- Old `getContacts` (~line 1160)
- Old `removeContact` (~line 1169)
- References in type unions (~lines 1594, 1672)

**Step 3: Update adapter tests**

In `protocol/src/adapters/tests/personal-index.adapter.spec.ts`:
- Update tests that reference `user_contacts` or `importContactsBulk` to use new `upsertContactMembership` / `getContactMembers` methods

In `protocol/src/adapters/tests/database.adapter.spec.ts`:
- Remove ghost transfer tests (~lines 937-1011) that test `claimGhostUser` data transfer
- Add test for `upsertContactMembership`, `hardDeleteContactMembership`, `getContactMembers`, `clearReverseOptOut`

**Step 4: Run all affected tests**

Run: `cd protocol && bun test src/services/tests/contact.service.spec.ts src/services/tests/contact.filter.spec.ts src/adapters/tests/auth.adapter.spec.ts src/adapters/tests/personal-index.adapter.spec.ts src/adapters/tests/database.adapter.spec.ts`
Expected: PASS

**Step 5: Run tsc**

Run: `cd protocol && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts protocol/src/lib/protocol/interfaces/database.interface.ts protocol/src/adapters/tests/personal-index.adapter.spec.ts protocol/src/adapters/tests/database.adapter.spec.ts
git commit -m "refactor: remove old user_contacts methods and update adapter tests"
```

---

### Task 10: Update `main.ts` and Fix Remaining References

**Files:**
- Modify: `protocol/src/main.ts:108` — `AuthDatabaseAdapter` no longer needs ghost claim methods
- Any remaining files that import `ContactSource`, `UserContact`, `NewUserContact`

**Step 1: Fix `main.ts`**

The `AuthDatabaseAdapter` instantiation in `main.ts` should work as-is since we simplified the class. Verify no errors.

**Step 2: Search for remaining references**

Run: `cd protocol && npx tsc --noEmit 2>&1 | head -50`

Fix any remaining type errors from removed types/methods.

**Step 3: Run full test suite**

Run: `cd protocol && bun test`
Expected: PASS (all tests)

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: resolve remaining type errors from contacts simplification"
```

---

### Task 11: Verify `deletedAt` Column on `index_members`

**Files:**
- Check: `protocol/src/schemas/database.schema.ts` — verify `index_members` has a `deletedAt` column

**Step 1: Check if `deletedAt` exists on `index_members`**

If `index_members` does not have a `deletedAt` column, we need to add it via migration.

If missing:
1. Add `deletedAt: timestamp('deleted_at')` to the `indexMembers` schema
2. Create migration `0018_add_index_members_deleted_at.sql`
3. Run `bun run db:generate` then rename, update journal, `bun run db:migrate`

**Step 2: Verify**

Run: `cd protocol && bun run db:generate`
Expected: "No schema changes"

**Step 3: Commit (if changes needed)**

```bash
git add protocol/src/schemas/database.schema.ts protocol/drizzle/
git commit -m "feat(schema): add deletedAt to index_members for contact soft-delete"
```

---

### Task 12: Final Integration Test

**Files:**
- Test: `protocol/src/services/tests/contact.service.spec.ts` (already written in Task 4)

**Step 1: Run all tests**

Run: `cd protocol && bun test`
Expected: PASS

**Step 2: Run tsc**

Run: `cd protocol && npx tsc --noEmit`
Expected: PASS

**Step 3: Manual smoke test**

Start the dev server and verify:
1. Gmail contact import works through chat
2. Adding a single contact works through chat
3. Listing contacts works through chat
4. Removing a contact works through chat

Run: `cd protocol && bun run dev`

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: integration fixes for contacts simplification"
```
