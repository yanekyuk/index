# Remove `indexes.ownerId` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the redundant `indexes.ownerId` column and replace it with a `personal_indexes` mapping table for DB-level one-personal-index-per-user enforcement.

**Architecture:** New `personal_indexes` table (PK on `user_id`, unique on `index_id`) replaces the `ownerId` column + partial unique index. All personal index lookups and membership filtering switch from `indexes.ownerId` to `personal_indexes` joins.

**Tech Stack:** Drizzle ORM, PostgreSQL, Bun test

---

### Task 1: Schema — Add `personalIndexes` table, remove `ownerId` from `indexes`

**Files:**
- Modify: `protocol/src/schemas/database.schema.ts:276-298` (indexes table)
- Modify: `protocol/src/schemas/database.schema.ts:454-459` (indexesRelations)

**Step 1: Add `personalIndexes` table definition after `indexMembers` (after line 311)**

Add this table definition:

```typescript
export const personalIndexes = pgTable('personal_indexes', {
  userId: text('user_id').notNull().references(() => users.id),
  indexId: text('index_id').notNull().references(() => indexes.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId] }),
  indexUnique: uniqueIndex('personal_indexes_index_id_unique').on(t.indexId),
}));
```

**Step 2: Add relations for `personalIndexes` (after `indexMembersRelations`)**

```typescript
export const personalIndexesRelations = relations(personalIndexes, ({ one }) => ({
  user: one(users, {
    fields: [personalIndexes.userId],
    references: [users.id],
  }),
  index: one(indexes, {
    fields: [personalIndexes.indexId],
    references: [indexes.id],
  }),
}));
```

**Step 3: Remove `ownerId` and constraints from `indexes` table**

In the `indexes` table definition (line 276-298):
- Remove line 282: `ownerId: text('owner_id').references(() => users.id),`
- Remove line 296: `personalOwnerUnique: uniqueIndex(...)...`
- Remove line 297: `personalOwnerCheck: check(...)...`

In `indexesRelations` (line 454-459):
- Remove line 458: `owner: one(users, { fields: [indexes.ownerId], references: [users.id] }),`

**Step 4: Add export types for `personalIndexes`**

After line 583 (near other export types):

```typescript
export type PersonalIndex = typeof personalIndexes.$inferSelect;
export type NewPersonalIndex = typeof personalIndexes.$inferInsert;
```

**Step 5: Commit**

```bash
git add protocol/src/schemas/database.schema.ts
git commit -m "refactor(schema): add personal_indexes table, remove indexes.ownerId"
```

---

### Task 2: Generate and configure the migration

**Step 1: Generate the migration**

```bash
cd protocol && bun run db:generate
```

**Step 2: Rename the migration file**

Rename the generated file to `0014_add_personal_indexes_drop_owner_id.sql`.

**Step 3: Edit migration SQL — add backfill BEFORE the DROP**

Open the generated migration. Drizzle will generate the CREATE TABLE and DROP statements. You need to **insert a backfill statement** between the CREATE TABLE and the DROP COLUMN:

```sql
-- After CREATE TABLE "personal_indexes" ...
-- Before ALTER TABLE "indexes" DROP COLUMN "owner_id"

INSERT INTO "personal_indexes" ("user_id", "index_id")
SELECT "owner_id", "id" FROM "indexes" WHERE "is_personal" = true AND "owner_id" IS NOT NULL;
```

Ensure the migration order is:
1. CREATE TABLE `personal_indexes`
2. Add foreign keys / indexes
3. **Backfill** (INSERT ... SELECT)
4. DROP CONSTRAINT `personal_owner_check`
5. DROP INDEX `indexes_is_personal_owner`
6. ALTER TABLE DROP COLUMN `owner_id`

**Step 4: Update `drizzle/meta/_journal.json`**

Update the `tag` field for the new entry to match the renamed filename (without `.sql`).

**Step 5: Apply the migration**

```bash
cd protocol && bun run db:migrate
```

**Step 6: Verify no pending changes**

```bash
cd protocol && bun run db:generate
```

Expected: "No schema changes" or similar — no new migration generated.

**Step 7: Commit**

```bash
git add protocol/drizzle/
git commit -m "chore(migration): add 0014 personal_indexes table and drop owner_id"
```

---

### Task 3: Update `ensurePersonalIndex` and `getPersonalIndexId`

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts:25-89`

**Step 1: Rewrite `ensurePersonalIndex`**

Replace the function (lines 25-69) with:

```typescript
export async function ensurePersonalIndex(userId: string): Promise<string> {
  // Fast path: check mapping table
  const existing = await db
    .select({ indexId: schema.personalIndexes.indexId })
    .from(schema.personalIndexes)
    .where(eq(schema.personalIndexes.userId, userId))
    .limit(1);

  if (existing.length > 0) return existing[0].indexId;

  const indexId = crypto.randomUUID();

  await db.insert(schema.indexes).values({
    id: indexId,
    title: 'My Network',
    prompt: 'Personal index containing the owner\'s imported contacts for network-scoped discovery.',
    isPersonal: true,
  }).onConflictDoNothing();

  await db.insert(schema.personalIndexes).values({
    userId,
    indexId,
  }).onConflictDoNothing();

  await db.insert(schema.indexMembers).values({
    indexId,
    userId,
    permissions: ['owner'],
    autoAssign: false,
  }).onConflictDoNothing();

  // Re-query to return the actual persisted ID (handles race with concurrent calls)
  const persisted = await db
    .select({ indexId: schema.personalIndexes.indexId })
    .from(schema.personalIndexes)
    .where(eq(schema.personalIndexes.userId, userId))
    .limit(1);

  return persisted[0]?.indexId ?? indexId;
}
```

**Step 2: Rewrite `getPersonalIndexId`**

Replace the function (lines 76-89) with:

```typescript
export async function getPersonalIndexId(userId: string): Promise<string | null> {
  const result = await db
    .select({ indexId: schema.personalIndexes.indexId })
    .from(schema.personalIndexes)
    .where(eq(schema.personalIndexes.userId, userId))
    .limit(1);

  return result[0]?.indexId ?? null;
}
```

**Step 3: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "refactor(adapter): ensurePersonalIndex and getPersonalIndexId use personal_indexes table"
```

---

### Task 4: Update `getIndexMemberships` and `getIndexesForUser`

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts:1060-1092` (getIndexMemberships)
- Modify: `protocol/src/adapters/database.adapter.ts:1183-1232` (getIndexesForUser)

**Step 1: Update `getIndexMemberships` — replace `indexes.ownerId` filter**

In `getIndexMemberships` (line 1074-1086), replace the `.where(...)` clause:

Old filter (lines 1074-1086):
```typescript
.where(
  and(
    eq(schema.indexMembers.userId, userId),
    isNull(schema.indexes.deletedAt),
    or(
      eq(schema.indexes.isPersonal, false),
      and(
        eq(schema.indexes.isPersonal, true),
        eq(schema.indexes.ownerId, userId),
      )
    ),
  )
)
```

New filter using `personal_indexes` left join:
```typescript
.leftJoin(schema.personalIndexes, eq(schema.indexes.id, schema.personalIndexes.indexId))
.where(
  and(
    eq(schema.indexMembers.userId, userId),
    isNull(schema.indexes.deletedAt),
    or(
      eq(schema.indexes.isPersonal, false),
      and(
        eq(schema.indexes.isPersonal, true),
        eq(schema.personalIndexes.userId, userId),
      )
    ),
  )
)
```

Note: Add the `.leftJoin(...)` line **before** the `.where(...)` line, after the existing `.innerJoin(schema.indexes, ...)`.

**Step 2: Update `getIndexesForUser` — replace owner join**

In `getIndexesForUser` (around lines 1183-1232), the current code joins `indexes` to `users` via `ownerId` to get owner name/avatar. Replace this with a subquery or join through `index_members`:

Replace the select and join (lines 1183-1198):

Old:
```typescript
const rows = await db
  .select({
    id: schema.indexes.id,
    title: schema.indexes.title,
    prompt: schema.indexes.prompt,
    imageUrl: schema.indexes.imageUrl,
    permissions: schema.indexes.permissions,
    isPersonal: schema.indexes.isPersonal,
    ownerId: schema.indexes.ownerId,
    createdAt: schema.indexes.createdAt,
    updatedAt: schema.indexes.updatedAt,
    ownerName: schema.users.name,
    ownerAvatar: schema.users.avatar,
  })
  .from(schema.indexes)
  .leftJoin(schema.users, eq(schema.indexes.ownerId, schema.users.id))
```

New (join through `index_members` with `'owner'` permission to find the owner user):
```typescript
const ownerMembers = db
  .select({
    indexId: schema.indexMembers.indexId,
    userId: schema.indexMembers.userId,
  })
  .from(schema.indexMembers)
  .where(sql`'owner' = ANY(${schema.indexMembers.permissions})`)
  .as('owner_members');

const rows = await db
  .select({
    id: schema.indexes.id,
    title: schema.indexes.title,
    prompt: schema.indexes.prompt,
    imageUrl: schema.indexes.imageUrl,
    permissions: schema.indexes.permissions,
    isPersonal: schema.indexes.isPersonal,
    createdAt: schema.indexes.createdAt,
    updatedAt: schema.indexes.updatedAt,
    ownerId: ownerMembers.userId,
    ownerName: schema.users.name,
    ownerAvatar: schema.users.avatar,
  })
  .from(schema.indexes)
  .leftJoin(ownerMembers, eq(schema.indexes.id, ownerMembers.indexId))
  .leftJoin(schema.users, eq(ownerMembers.userId, schema.users.id))
```

Note: `ownerId` is now derived from `ownerMembers.userId`. The rest of the function (building `indexesWithCounts`) stays the same — `row.ownerId` will still resolve correctly.

**Step 3: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "refactor(adapter): getIndexMemberships and getIndexesForUser use personal_indexes/index_members"
```

---

### Task 5: Remove `ownerId` from types

**Files:**
- Modify: `protocol/src/types/indexes.types.ts:33`

**Step 1: Remove `ownerId` from `Index` interface**

Delete line 33: `ownerId?: string | null;`

**Step 2: Commit**

```bash
git add protocol/src/types/indexes.types.ts
git commit -m "refactor(types): remove ownerId from Index interface"
```

---

### Task 6: Update tests

**Files:**
- Modify: `protocol/src/adapters/tests/personal-index.adapter.spec.ts`

**Step 1: Add `personalIndexes` to imports**

Add `personalIndexes` to the schema import (line 22):

```typescript
import {
  users,
  userProfiles,
  indexes,
  indexMembers,
  personalIndexes,
  intents,
  intentIndexes,
  userContacts,
} from '../../schemas/database.schema';
```

**Step 2: Add `personalIndexes` cleanup in `afterAll`**

Add before the `indexes` delete (before line 128):

```typescript
await db.delete(personalIndexes).where(
  inArray(personalIndexes.userId, allUserIds),
);
```

**Step 3: Update test "creates a personal index with correct title and ownerId"**

Rename test (line 142) to: `'creates a personal index with correct title and personal_indexes entry'`

Replace the assertion block (lines 143-152):

```typescript
it('creates a personal index with correct title and personal_indexes entry', async () => {
  const [row] = await db
    .select()
    .from(indexes)
    .where(eq(indexes.id, fixture.personalIndexId));

  expect(row).toBeDefined();
  expect(row.title).toBe('My Network');
  expect(row.isPersonal).toBe(true);

  // Verify personal_indexes mapping
  const [mapping] = await db
    .select()
    .from(personalIndexes)
    .where(eq(personalIndexes.userId, fixture.ownerUserId));

  expect(mapping).toBeDefined();
  expect(mapping.indexId).toBe(fixture.personalIndexId);
});
```

**Step 4: Update idempotence test**

Replace the idempotence verification (lines 173-184):

```typescript
// Verify only one personal index mapping exists for this user
const rows = await db
  .select({ indexId: personalIndexes.indexId })
  .from(personalIndexes)
  .where(eq(personalIndexes.userId, fixture.ownerUserId));
expect(rows).toHaveLength(1);
```

**Step 5: Run the tests**

```bash
cd protocol && bun test src/adapters/tests/personal-index.adapter.spec.ts
```

Expected: All tests pass.

**Step 6: Commit**

```bash
git add protocol/src/adapters/tests/personal-index.adapter.spec.ts
git commit -m "test(personal-index): update tests for personal_indexes table"
```

---

### Task 7: Final verification

**Step 1: Run full lint**

```bash
cd protocol && bun run lint
```

Expected: No new errors.

**Step 2: Search for any remaining `ownerId` references on `indexes`**

```bash
# Search for indexes.ownerId or schema.indexes.ownerId
grep -rn 'indexes\.ownerId\|indexes\.owner_id' protocol/src/ --include='*.ts'
```

Expected: No matches (only `userContacts.ownerId` references should remain).

**Step 3: Run the full test suite**

```bash
cd protocol && bun test
```

Expected: All tests pass.

**Step 4: Commit any remaining fixes**

If lint or tests revealed issues, fix and commit.

```bash
git commit -m "fix: address lint/test issues from ownerId removal"
```
