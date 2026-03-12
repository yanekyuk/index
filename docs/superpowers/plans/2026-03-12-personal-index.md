# Personal Index Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the singleton Global Index (`isGlobal`) with per-user Personal Indexes (`isPersonal`) that scope discovery to imported contacts.

**Architecture:** Add `ownerId` column to `indexes` table, add PK to `intent_indexes`, remove `isGlobal`. Personal indexes are created at user registration, contacts are auto-enrolled as members with `['contact']` permission, and their intents are auto-assigned via `intent_indexes`. Discovery works through standard index-scoped search; visibility is owner-only.

**Tech Stack:** Drizzle ORM, PostgreSQL, BullMQ, Bun, React, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-12-personal-index-design.md`

---

## File Map

### Modified Files

| File | Changes |
|------|---------|
| `protocol/src/schemas/database.schema.ts` | Remove `isGlobal`, add `ownerId`, update constraints, add PK to `intent_indexes`, update relations |
| `protocol/src/adapters/database.adapter.ts` | Remove global index functions, add personal index functions, update ghost creation, contact import, membership queries, opportunity queries, shared index verification |
| `protocol/src/main.ts` | Remove `ensureGlobalIndex()` call and import |
| `protocol/src/lib/betterauth/betterauth.ts` | Replace `ensureGlobalIndexMembership` with `ensurePersonalIndex` |
| `protocol/src/services/contact.service.ts` | Extend contact import to add members + intent_indexes to personal index |
| `protocol/src/services/intent.service.ts` | Auto-assign new intents to personal indexes where user is a contact |
| `protocol/src/types/indexes.types.ts` | Replace `isGlobal` with `isPersonal`, add `ownerId` |
| `frontend/src/app/networks/page.tsx` | Replace `isGlobal` sorting with `isPersonal` styling |
| `frontend/src/components/ChatContent.tsx` | Replace global index scope UI with personal index / "Everywhere" unscoped |

### Migration File (New)

| File | Purpose |
|------|---------|
| `protocol/drizzle/NNNN_replace_global_with_personal_index.sql` | Schema migration + data backfill |

---

## Chunk 1: Schema & Migration

### Task 1: Update Schema Definition

**Files:**
- Modify: `protocol/src/schemas/database.schema.ts:276-297` (indexes table)
- Modify: `protocol/src/schemas/database.schema.ts:323-327` (intentIndexes table)
- Modify: `protocol/src/schemas/database.schema.ts:449-453` (indexesRelations)

- [ ] **Step 1: Update `indexes` table — remove `isGlobal`, add `ownerId`**

In `protocol/src/schemas/database.schema.ts`, update the `indexes` table definition:

```typescript
export const indexes = pgTable('indexes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  prompt: text('prompt'),
  imageUrl: text('image_url'),
  isPersonal: boolean('is_personal').default(false).notNull(),
  ownerId: text('owner_id').references(() => users.id),
  permissions: json('permissions').$type<{
    joinPolicy: 'anyone' | 'invite_only';
    invitationLink: { code: string } | null;
    allowGuestVibeCheck: boolean;
  }>().default({
    joinPolicy: 'invite_only',
    invitationLink: null,
    allowGuestVibeCheck: false
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (t) => ({
  personalOwnerUnique: uniqueIndex('indexes_is_personal_owner').on(t.isPersonal, t.ownerId).where(sql`is_personal = true`),
  personalOwnerCheck: check('personal_owner_check', sql`NOT is_personal OR owner_id IS NOT NULL`),
}));
```

Key changes: removed `isGlobal` column and `globalUnique` constraint, added `ownerId` column, `personalOwnerUnique` constraint, and CHECK constraint ensuring personal indexes always have an owner.

- [ ] **Step 2: Add primary key to `intentIndexes`**

Update the `intentIndexes` table definition:

```typescript
export const intentIndexes = pgTable('intent_indexes', {
  intentId: text('intent_id').notNull().references(() => intents.id),
  indexId: text('index_id').notNull().references(() => indexes.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.intentId, t.indexId] }),
}));
```

- [ ] **Step 3: Update `indexesRelations`**

Add the `owner` relation:

```typescript
export const indexesRelations = relations(indexes, ({ many, one }) => ({
  members: many(indexMembers),
  intents: many(intentIndexes),
  integrations: many(userIntegrations),
  owner: one(users, { fields: [indexes.ownerId], references: [users.id] }),
}));
```

- [ ] **Step 4: Generate and rename migration**

```bash
cd protocol
bun run db:generate
```

Rename the generated file:
```bash
mv drizzle/NNNN_random_name.sql drizzle/NNNN_replace_global_with_personal_index.sql
```

Update `drizzle/meta/_journal.json` tag to match.

- [ ] **Step 5: Edit migration SQL to add data backfill**

The generated migration will include DDL statements (drop `isGlobal`, add `ownerId`, constraints, PK). **You must manually reorder the generated SQL** so that:

1. Data cleanup runs **before** `ALTER TABLE indexes DROP COLUMN is_global` (the cleanup queries reference `is_global`)
2. Deduplication and global index cleanup run **before** `ALTER TABLE intent_indexes ADD PRIMARY KEY`
3. The `ADD COLUMN owner_id` DDL runs before the backfill inserts that set `owner_id`

Restructure the migration SQL into this order:

```sql
-- ============================================================
-- PHASE 1: Data cleanup (while is_global column still exists)
-- ============================================================

-- 1a. Clean up global index references
DELETE FROM intent_indexes WHERE index_id IN (
  SELECT id FROM indexes WHERE is_global = true
);
DELETE FROM index_members WHERE index_id IN (
  SELECT id FROM indexes WHERE is_global = true
);
UPDATE chat_sessions SET index_id = NULL WHERE index_id IN (
  SELECT id FROM indexes WHERE is_global = true
);
DELETE FROM indexes WHERE is_global = true;

-- 1b. Deduplicate intent_indexes before adding PK
DELETE FROM intent_indexes a USING intent_indexes b
WHERE a.ctid < b.ctid
  AND a.intent_id = b.intent_id
  AND a.index_id = b.index_id;

-- ============================================================
-- PHASE 2: DDL changes (paste Drizzle-generated DDL here)
-- ============================================================
-- - DROP is_global column and its unique constraint
-- - ADD owner_id column with FK
-- - ADD personal_owner_unique constraint
-- - ADD personal_owner_check CHECK constraint
-- - ADD PRIMARY KEY (intent_id, index_id) on intent_indexes

-- ============================================================
-- PHASE 3: Data backfill
-- ============================================================

-- 3. Create personal indexes for existing users
INSERT INTO indexes (id, title, prompt, is_personal, owner_id, created_at, updated_at)
SELECT
  gen_random_uuid(),
  'My Network',
  'Personal index containing the owner''s imported contacts for network-scoped discovery.',
  true,
  u.id,
  NOW(),
  NOW()
FROM users u
WHERE u.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 4. Add owners as members of their personal indexes
INSERT INTO index_members (index_id, user_id, permissions, auto_assign, created_at, updated_at)
SELECT
  i.id,
  i.owner_id,
  ARRAY['owner'],
  false,
  NOW(),
  NOW()
FROM indexes i
WHERE i.is_personal = true
ON CONFLICT DO NOTHING;

-- 5. Add contacts as members of owner's personal indexes
INSERT INTO index_members (index_id, user_id, permissions, auto_assign, created_at, updated_at)
SELECT
  i.id,
  uc.user_id,
  ARRAY['contact'],
  false,
  NOW(),
  NOW()
FROM user_contacts uc
JOIN indexes i ON i.owner_id = uc.owner_id AND i.is_personal = true
WHERE uc.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 6. Backfill intent_indexes for contacts in personal indexes
INSERT INTO intent_indexes (intent_id, index_id, created_at)
SELECT
  int.id,
  i.id,
  NOW()
FROM user_contacts uc
JOIN indexes i ON i.owner_id = uc.owner_id AND i.is_personal = true
JOIN intents int ON int.user_id = uc.user_id AND int.status = 'ACTIVE' AND int.deleted_at IS NULL
WHERE uc.deleted_at IS NULL
ON CONFLICT DO NOTHING;
```

- [ ] **Step 6: Apply migration and verify**

```bash
cd protocol
bun run db:migrate
```

Verify no pending changes:
```bash
bun run db:generate
```

Expected: "No schema changes detected"

- [ ] **Step 7: Commit**

```bash
git add protocol/src/schemas/database.schema.ts protocol/drizzle/
git commit -m "feat(schema): replace isGlobal with ownerId, add intent_indexes PK, migrate data"
```

---

## Chunk 2: Backend — Remove Global Index, Add Personal Index

### Task 2: Remove Global Index Functions from database.adapter.ts

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts:19-95` (global index functions)

- [ ] **Step 1: Remove `_globalIndexId`, `getGlobalIndexId`, `ensureGlobalIndex`, `ensureGlobalIndexMembership`**

Delete lines 19-95 of `database.adapter.ts`:
- `_globalIndexId` variable (line 20)
- `getGlobalIndexId()` function (lines 23-33)
- `ensureGlobalIndex()` function (lines 40-82)
- `ensureGlobalIndexMembership()` function (lines 88-95)

Also remove these exports from the file.

- [ ] **Step 2: Remove global index references from ghost user creation**

In `createGhostUser()` (lines 2342-2370): remove the `getGlobalIndexId()` call and the `indexMembers` insert for global index (lines 2357-2367).

In `createGhostUsersBulk()` (lines 2520-2580): remove `getGlobalIndexId()` call (line 2523) and global index membership inserts (lines 2559-2568).

In `importContactsBulk()` (lines 2621-2726): remove `getGlobalIndexId()` call (line 2632) and global index membership inserts (lines 2662-2671).

- [ ] **Step 3: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "refactor(adapter): remove global index functions and references"
```

### Task 3: Add Personal Index Functions

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts`

- [ ] **Step 1: Add `ensurePersonalIndex(userId)` function**

Add near the top of the file (replacing the removed global index functions):

```typescript
/**
 * Creates a personal index for the user if one doesn't exist.
 * Adds the user as the owner member.
 * @param userId - The user to create a personal index for
 * @returns The personal index ID
 */
export async function ensurePersonalIndex(userId: string): Promise<string> {
  // Check if personal index already exists
  const existing = await db
    .select({ id: schema.indexes.id })
    .from(schema.indexes)
    .where(
      and(
        eq(schema.indexes.isPersonal, true),
        eq(schema.indexes.ownerId, userId),
      )
    )
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const indexId = crypto.randomUUID();

  await db.insert(schema.indexes).values({
    id: indexId,
    title: 'My Network',
    prompt: 'Personal index containing the owner\'s imported contacts for network-scoped discovery.',
    isPersonal: true,
    ownerId: userId,
  }).onConflictDoNothing();

  await db.insert(schema.indexMembers).values({
    indexId,
    userId,
    permissions: ['owner'],
    autoAssign: false,
  }).onConflictDoNothing();

  return indexId;
}

/**
 * Returns the personal index ID for a user.
 * @param userId - The user to look up
 * @returns The personal index ID, or null if not found
 */
export async function getPersonalIndexId(userId: string): Promise<string | null> {
  const result = await db
    .select({ id: schema.indexes.id })
    .from(schema.indexes)
    .where(
      and(
        eq(schema.indexes.isPersonal, true),
        eq(schema.indexes.ownerId, userId),
      )
    )
    .limit(1);

  return result[0]?.id ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "feat(adapter): add ensurePersonalIndex and getPersonalIndexId"
```

### Task 4: Update Startup and Auth

**Files:**
- Modify: `protocol/src/main.ts:17` (imports)
- Modify: `protocol/src/lib/betterauth/betterauth.ts:29,38,71-72`

- [ ] **Step 1: Update main.ts**

Remove the import of `ensureGlobalIndex` and `ensureGlobalIndexMembership` from `database.adapter`. Remove the `await ensureGlobalIndex()` call at startup. Import `ensurePersonalIndex` instead, and pass it to the auth adapter.

Replace:
```typescript
import { ensureGlobalIndex, ensureGlobalIndexMembership } from './adapters/database.adapter';
```
With:
```typescript
import { ensurePersonalIndex } from './adapters/database.adapter';
```

Remove:
```typescript
await ensureGlobalIndex();
```

Update the auth creation to pass `ensurePersonalIndex` instead of `ensureGlobalIndexMembership`.

- [ ] **Step 2: Update betterauth.ts**

Replace `ensureGlobalIndexMembership` parameter and usage:

Change the parameter type from:
```typescript
ensureGlobalIndexMembership?: (userId: string) => Promise<void>;
```
To:
```typescript
ensurePersonalIndex?: (userId: string) => Promise<string>;
```

Update the call site (line 71-72):
```typescript
if (ensurePersonalIndex) await ensurePersonalIndex(user.id);
```

- [ ] **Step 3: Commit**

```bash
git add protocol/src/main.ts protocol/src/lib/betterauth/betterauth.ts
git commit -m "feat(auth): create personal index on user registration"
```

### Task 5: Update Membership Queries

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts:1042-1068` (getIndexMemberships)
- Modify: `protocol/src/adapters/database.adapter.ts:4341-4353` (verifySharedIndex)

- [ ] **Step 1: Update `getIndexMemberships` filter**

Replace the `isGlobal = false` filter (line 1060):

```typescript
// Old:
eq(schema.indexes.isGlobal, false)

// New: show non-personal indexes, plus personal indexes owned by this user
or(
  eq(schema.indexes.isPersonal, false),
  and(
    eq(schema.indexes.isPersonal, true),
    eq(schema.indexes.ownerId, userId),
  )
)
```

- [ ] **Step 2: Update `verifySharedIndex` fallback**

Replace the global index fallback (lines 4341-4353). The existing code checks if both users share the global index as a last resort. Replace with a personal index contact check:

```typescript
// Old (approximate — read actual code before editing):
// const globalId = await getGlobalIndexId();
// if (!globalId) return false;
// const theirGlobalMembership = await db.getIndexMembership(globalId, userId);
// if (!theirGlobalMembership) return false;
// const myGlobalMembership = await db.getIndexMembership(globalId, authUserId);
// return !!myGlobalMembership;

// New: check if either user's personal index contains the other as a contact
const myPersonalId = await getPersonalIndexId(authUserId);
const theirPersonalId = await getPersonalIndexId(userId);

if (myPersonalId) {
  const theirMembership = await db.getIndexMembership(myPersonalId, userId);
  if (theirMembership) return true;
}
if (theirPersonalId) {
  const myMembership = await db.getIndexMembership(theirPersonalId, authUserId);
  if (myMembership) return true;
}
return false;
```

- [ ] **Step 3: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "refactor(adapter): update membership queries for personal index model"
```

### Task 6: Update Opportunity Queries

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts:3043-3056` (getOpportunitiesForUser)

- [ ] **Step 1: Remove global index skip logic**

Replace the `isGlobal` check in `getOpportunitiesForUser`:

```typescript
// Old:
if (options?.indexId) {
  const globalId = await getGlobalIndexId();
  if (options.indexId !== globalId) {
    conditions.push(sql`(...)`);
  }
}

// New: always apply index filter when indexId is provided
if (options?.indexId) {
  conditions.push(sql`(
    ${opportunities.context}->>'indexId' = ${options.indexId}
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS actor
      WHERE actor->>'indexId' = ${options.indexId}
    )
  )`);
}
```

When no `indexId` is provided, no filter is applied (unscoped = show all).

- [ ] **Step 2: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "refactor(adapter): remove global index skip from opportunity queries"
```

### Task 7: Update Index Listing Queries

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts` (index listing/ordering queries that reference `isGlobal`)

- [ ] **Step 1: Update index listing queries**

Search for all `isGlobal` references in `database.adapter.ts` and replace:
- Field selections: replace `isGlobal` with `isPersonal` and `ownerId`
- Ordering: replace `desc(schema.indexes.isGlobal)` with `desc(schema.indexes.isPersonal)` (personal indexes first for owner)
- Owner derivation: simplify queries that derive `ownerId` from a LEFT JOIN on `index_members` with `'owner' = ANY(permissions)` — use `indexes.ownerId` directly instead
- Any remaining `isGlobal` filters

- [ ] **Step 2: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "refactor(adapter): replace isGlobal with isPersonal in index queries"
```

---

## Chunk 3: Backend — Contact & Intent Integration

### Task 8: Extend Contact Import to Add Personal Index Members

**Files:**
- Modify: `protocol/src/services/contact.service.ts:134-140`
- Modify: `protocol/src/adapters/database.adapter.ts` (importContactsBulk or contact creation methods)

- [ ] **Step 1: Update contact import to add members to personal index**

In the contact import flow (after contacts are inserted into `user_contacts`), add logic to:

1. Look up the owner's personal index ID via `getPersonalIndexId(ownerId)`
2. Insert `index_members` rows with `permissions: ['contact']` for each new contact
3. Backfill `intent_indexes` for each contact's active intents

```typescript
// After contact insertion in importContactsBulk or contact.service.ts:
const personalIndexId = await getPersonalIndexId(ownerId);
if (personalIndexId) {
  // Add contacts as members
  const contactMemberValues = newContactUserIds.map(userId => ({
    indexId: personalIndexId,
    userId,
    permissions: ['contact'] as string[],
    autoAssign: false,
  }));
  if (contactMemberValues.length > 0) {
    await db.insert(schema.indexMembers)
      .values(contactMemberValues)
      .onConflictDoNothing();
  }

  // Backfill intents for new contacts
  const contactIntents = await db
    .select({ id: schema.intents.id })
    .from(schema.intents)
    .where(
      and(
        inArray(schema.intents.userId, newContactUserIds),
        eq(schema.intents.status, 'ACTIVE'),
        isNull(schema.intents.deletedAt),
      )
    );

  if (contactIntents.length > 0) {
    await db.insert(schema.intentIndexes)
      .values(contactIntents.map(i => ({
        intentId: i.id,
        indexId: personalIndexId,
      })))
      .onConflictDoNothing();
  }
}
```

- [ ] **Step 2: Update contact removal to clean up personal index**

In `ChatDatabaseAdapter.removeContact()` at `database.adapter.ts:2448`, the method receives `contactId` (the `user_contacts` record ID), not the contact's `userId`. First look up the `userId` from the record, then clean up:

```typescript
// In removeContact(ownerId, contactId) at database.adapter.ts:2448:
async removeContact(ownerId: string, contactId: string): Promise<void> {
  // Look up the contact's userId before soft-deleting
  const [contact] = await db
    .select({ userId: schema.userContacts.userId })
    .from(schema.userContacts)
    .where(
      and(
        eq(schema.userContacts.id, contactId),
        eq(schema.userContacts.ownerId, ownerId),
      )
    );

  // Soft-delete the contact
  await db
    .update(schema.userContacts)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.userContacts.id, contactId),
        eq(schema.userContacts.ownerId, ownerId)
      )
    );

  // Clean up personal index membership and intent assignments
  if (contact) {
    const personalIndexId = await getPersonalIndexId(ownerId);
    if (personalIndexId) {
      await db.delete(schema.indexMembers)
        .where(
          and(
            eq(schema.indexMembers.indexId, personalIndexId),
            eq(schema.indexMembers.userId, contact.userId),
          )
        );

      await db.delete(schema.intentIndexes)
        .where(
          and(
            eq(schema.intentIndexes.indexId, personalIndexId),
            inArray(
              schema.intentIndexes.intentId,
              db.select({ id: schema.intents.id })
                .from(schema.intents)
                .where(eq(schema.intents.userId, contact.userId))
            ),
          )
        );
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add protocol/src/services/contact.service.ts protocol/src/adapters/database.adapter.ts
git commit -m "feat(contacts): sync contact changes to personal index members and intents"
```

### Task 9: Auto-Assign New Intents to Personal Indexes

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts` (add `getPersonalIndexesForContact`, update all 3 `assignIntentToIndex` implementations)
- Modify: `protocol/src/lib/protocol/interfaces/database.interface.ts` (add method to `Database` interface)
- Modify: `protocol/src/services/intent.service.ts:157-167` (add auto-assign after `createFromProposal`)
- Modify: `protocol/src/lib/protocol/graphs/intent.graph.ts:504-526` (add auto-assign after `createIntent` in graph)

**Important:** Intents are created through two paths:
1. `IntentService.createFromProposal()` — service-level creation (lines 157-167)
2. `IntentGraphFactory` execute node — graph-level creation (lines 504-526 in `intent.graph.ts`)

Both paths need personal index auto-assignment. We will NOT add it to `createIntentForSeed()` (seed utility, not a production path).

- [ ] **Step 1: Add `getPersonalIndexesForContact` to `Database` interface**

In `protocol/src/lib/protocol/interfaces/database.interface.ts`, add the method to the `Database` interface:

```typescript
/**
 * Returns personal indexes where the user is a contact member.
 * @param userId - The contact user ID
 * @returns Array of { indexId } for personal indexes containing this user as a contact
 */
getPersonalIndexesForContact(userId: string): Promise<{ indexId: string }[]>;
```

Also add `'getPersonalIndexesForContact'` to the `IntentGraphDatabase` Pick type (line 1657) so the intent graph can call it.

- [ ] **Step 2: Implement `getPersonalIndexesForContact` in database adapter**

Add the implementation to **all adapter classes** that implement the `Database` interface (e.g., `ChatDatabaseAdapter`, `IntentDatabaseAdapter`, and any other concrete adapter classes in `database.adapter.ts`). The `IntentService` uses `IntentDatabaseAdapter` (not `ChatDatabaseAdapter`), so it must be present on that class too:

```typescript
async getPersonalIndexesForContact(userId: string): Promise<{ indexId: string }[]> {
  return db
    .select({ indexId: schema.indexMembers.indexId })
    .from(schema.indexMembers)
    .innerJoin(schema.indexes, eq(schema.indexes.id, schema.indexMembers.indexId))
    .where(
      and(
        eq(schema.indexMembers.userId, userId),
        eq(schema.indexes.isPersonal, true),
        sql`'contact' = ANY(${schema.indexMembers.permissions})`,
      )
    );
}
```

- [ ] **Step 3: Update all 3 `assignIntentToIndex` implementations to use `onConflictDoNothing`**

There are three separate implementations in `database.adapter.ts` (lines 518, 1414, 3366). Update all three:

```typescript
async assignIntentToIndex(intentId: string, indexId: string): Promise<void> {
  await db.insert(schema.intentIndexes)
    .values({ intentId, indexId })
    .onConflictDoNothing();
}
```

- [ ] **Step 4: Add auto-assign in `intent.service.ts` (createFromProposal path)**

After the existing `assignIntentToIndex` call in `createFromProposal` (line 159):

```typescript
// Auto-assign to personal indexes where this user is a contact
const personalIndexes = await this.adapter.getPersonalIndexesForContact(userId);
for (const { indexId } of personalIndexes) {
  await this.adapter.assignIntentToIndex(created.id, indexId);
}
```

Note: `this.adapter` is typed as `IntentDatabaseAdapter` which is derived from the `Database` interface — adding `getPersonalIndexesForContact` to the `Database` interface and the `IntentGraphDatabase` Pick type (Step 1) makes it available.

- [ ] **Step 5: Add auto-assign in `intent.graph.ts` (graph creation path)**

After the `createIntent` call at line 523-525 in the intent graph execute node:

```typescript
// Auto-assign to personal indexes where this user is a contact
const personalIndexes = await this.database.getPersonalIndexesForContact(state.userId);
for (const { indexId } of personalIndexes) {
  await this.database.assignIntentToIndex(created.id, indexId);
}
```

This works because `IntentGraphDatabase` will include `getPersonalIndexesForContact` (added in Step 1). Also add `'assignIntentToIndex'` to the `IntentGraphDatabase` Pick type at `database.interface.ts:1657-1670` — it is currently missing and needed for this call.

- [ ] **Step 6: Commit**

```bash
git add protocol/src/services/intent.service.ts protocol/src/adapters/database.adapter.ts protocol/src/lib/protocol/interfaces/database.interface.ts protocol/src/lib/protocol/graphs/intent.graph.ts
git commit -m "feat(intents): auto-assign new intents to personal indexes via both creation paths"
```

---

## Chunk 4: Frontend & Types

### Task 10: Update TypeScript Types

**Files:**
- Modify: `protocol/src/types/indexes.types.ts:32`

- [ ] **Step 1: Replace `isGlobal` with `isPersonal` and add `ownerId`**

```typescript
// Old:
isGlobal?: boolean;

// New:
isPersonal?: boolean;
ownerId?: string | null;
```

- [ ] **Step 2: Commit**

```bash
git add protocol/src/types/indexes.types.ts
git commit -m "refactor(types): replace isGlobal with isPersonal, add ownerId"
```

### Task 11: Update Networks Page

**Files:**
- Modify: `frontend/src/app/networks/page.tsx:29-34`

- [ ] **Step 1: Replace `isGlobal` sorting with `isPersonal` styling**

```typescript
// Old:
const allNetworks = [...(rawIndexes || [])].sort((a, b) => {
  if (a.isGlobal && !b.isGlobal) return -1;
  if (!a.isGlobal && b.isGlobal) return 1;
  return 0;
});

// New: personal index first, then alphabetical
const allNetworks = [...(rawIndexes || [])].sort((a, b) => {
  if (a.isPersonal && !b.isPersonal) return -1;
  if (!a.isPersonal && b.isPersonal) return 1;
  return (a.title || '').localeCompare(b.title || '');
});
```

The personal index already won't appear for non-owners (backend filters it out of `getIndexMemberships`).

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/networks/page.tsx
git commit -m "refactor(frontend): replace isGlobal sorting with isPersonal on networks page"
```

### Task 12: Update Chat Scope Selector

**Files:**
- Modify: `frontend/src/components/ChatContent.tsx:1026-1140`

- [ ] **Step 1: Replace global index references with personal index**

Replace the scope dropdown logic:

```typescript
// Old:
const globalIndex = indexes.find((i) => i.isGlobal);

// New:
const personalIndex = indexes.find((i) => i.isPersonal);
```

Update icon logic (lines 1041-1049):
```typescript
// Old:
selectedIndex?.isGlobal || selectedIndex?.permissions?.joinPolicy === "invite_only" ? (
  <Lock className="w-4 h-4" />
)

// New:
selectedIndex?.isPersonal ? (
  <Users className="w-4 h-4" />
) : selectedIndex?.permissions?.joinPolicy === "invite_only" ? (
  <Lock className="w-4 h-4" />
)
```

Replace the global index button (lines 1096-1111) with personal index button:
```typescript
// Old:
{globalIndex && (
  <button onClick={() => { handleIndexSelect(globalIndex.id); ... }}>
    <Lock className="w-4 h-4" /> {globalIndex.title}
  </button>
)}

// New:
{personalIndex && (
  <button onClick={() => { handleIndexSelect(personalIndex.id); ... }}>
    <Users className="w-4 h-4" /> {personalIndex.title}
  </button>
)}
```

Update the index filter (line 1114):
```typescript
// Old:
.filter((i) => !i.isGlobal)

// New:
.filter((i) => !i.isPersonal)
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ChatContent.tsx
git commit -m "refactor(frontend): replace global index with personal index in chat scope"
```

---

## Chunk 5: Guards & Verification

### Task 13: Add Personal Index Guards

**Files:**
- Modify: `protocol/src/controllers/index.controller.ts` or `protocol/src/services/index.service.ts`

- [ ] **Step 1: Add guard logic for personal index operations**

In the index controller or service, add checks that prevent:
- Editing a personal index (title, prompt, settings)
- Deleting a personal index
- Manually adding/removing members on a personal index

```typescript
// In relevant controller methods (update, delete, addMember, removeMember):
const index = await this.adapter.getIndex(indexId);
if (index?.isPersonal) {
  return res.status(403).json({ error: 'Personal indexes cannot be modified directly.' });
}
```

- [ ] **Step 2: Filter personal indexes from public index listings**

In `database.adapter.ts`, update `getPublicIndexesNotJoined` (line 1218) to exclude personal indexes. Add `eq(schema.indexes.isPersonal, false)` to the `whereConditions` array at line 1226-1228:

```typescript
// In getPublicIndexesNotJoined, add to whereConditions:
eq(schema.indexes.isPersonal, false),
```

Search for any other index listing endpoints that could expose personal indexes and add the same filter.

- [ ] **Step 3: Commit**

```bash
git add protocol/src/controllers/index.controller.ts protocol/src/services/index.service.ts protocol/src/adapters/database.adapter.ts
git commit -m "feat(guards): prevent modification of personal indexes, filter from public listings"
```

### Task 14: Smoke Test & Final Verification

- [ ] **Step 1: Run linting**

```bash
cd protocol && bun run lint
cd ../frontend && bun run lint
```

- [ ] **Step 2: Run protocol tests**

```bash
cd protocol
bun test
```

Fix any failures related to `isGlobal` references in tests.

- [ ] **Step 3: Run frontend build**

```bash
cd frontend && bun run build
```

- [ ] **Step 4: Manual smoke test**

Start the dev servers and verify:
1. New user registration creates a personal index
2. Personal index appears as "My Network" in Networks page
3. Personal index appears in chat scope selector
4. Importing contacts adds them as members to the personal index
5. Contact intents appear in `intent_indexes` for the personal index
6. Discovery scoped to personal index finds contact matches
7. Other users cannot see the personal index

```bash
bun run dev
```

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```
