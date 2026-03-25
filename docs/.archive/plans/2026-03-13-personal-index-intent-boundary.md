# Personal Index Intent Boundary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure personal indexes contain only the owner's intents, never contact intents.

**Architecture:** Remove 3 contact-intent leakage paths (intent service, intent graph, contact sync backfill), flip owner `autoAssign` to `true` so owner intents flow naturally via the HyDE queue, and add a migration to fix existing data.

**Tech Stack:** Drizzle ORM, PostgreSQL, Bun test

---

### Task 1: Update existing tests for new behavior

The existing test file `protocol/src/adapters/tests/personal-index.adapter.spec.ts` has a test that asserts contact intents ARE backfilled (line 269-279). This test needs to assert the opposite after our change.

**Files:**
- Modify: `protocol/src/adapters/tests/personal-index.adapter.spec.ts:231-293`

**Step 1: Update the contact import test to assert NO intent backfill**

In `importContactsBulk → personal index sync`, the test currently asserts `intentLinks` has length 1. Change it to assert length 0.

Replace lines 269-279:
```typescript
    // Verify the contact's active intent was NOT backfilled into the personal index
    // (personal indexes should only contain the owner's intents)
    const intentLinks = await db
      .select()
      .from(intentIndexes)
      .where(
        and(
          eq(intentIndexes.indexId, fixture.personalIndexId),
          eq(intentIndexes.intentId, fixture.contactIntentId),
        ),
      );
    expect(intentLinks).toHaveLength(0);
```

**Step 2: Run test to verify it FAILS (old behavior still in place)**

Run: `cd protocol && bun test src/adapters/tests/personal-index.adapter.spec.ts`
Expected: FAIL — the backfill still inserts the row, so length will be 1 not 0.

---

### Task 2: Add test for owner `autoAssign: true`

**Files:**
- Modify: `protocol/src/adapters/tests/personal-index.adapter.spec.ts`

**Step 1: Add a test asserting owner membership has `autoAssign: true`**

Add after the existing `creates an owner membership with ["owner"] permissions` test (around line 167):

```typescript
  it('creates owner membership with autoAssign enabled', async () => {
    const [membership] = await db
      .select()
      .from(indexMembers)
      .where(
        and(
          eq(indexMembers.indexId, fixture.personalIndexId),
          eq(indexMembers.userId, fixture.ownerUserId),
        ),
      );

    expect(membership).toBeDefined();
    expect(membership.autoAssign).toBe(true);
  });
```

**Step 2: Run test to verify it FAILS**

Run: `cd protocol && bun test src/adapters/tests/personal-index.adapter.spec.ts`
Expected: FAIL — `autoAssign` is currently `false`.

---

### Task 3: Fix `ensurePersonalIndex` — owner gets `autoAssign: true`

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts:49-54`

**Step 1: Change `autoAssign: false` to `autoAssign: true`**

At line 53, change:
```typescript
    autoAssign: false,
```
to:
```typescript
    autoAssign: true,
```

**Step 2: Run tests to verify the new autoAssign test passes**

Run: `cd protocol && bun test src/adapters/tests/personal-index.adapter.spec.ts`
Expected: The `autoAssign` test from Task 2 now PASSES. The backfill test from Task 1 still FAILS (backfill code not removed yet).

**Step 3: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts protocol/src/adapters/tests/personal-index.adapter.spec.ts
git commit -m "fix(personal-index): set owner autoAssign to true on personal index creation"
```

---

### Task 4: Remove contact intent backfill from `importContactsBulk`

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts:2818-2837`

**Step 1: Remove the backfill block**

Delete lines 2818-2837 (the comment `// Backfill active intents...` through the closing `}` of the `if (contactIntents.length > 0)` block):

```typescript
            // Backfill active intents for new contacts into the personal index
            const contactIntents = await tx
              .select({ id: schema.intents.id })
              .from(schema.intents)
              .where(
                and(
                  inArray(schema.intents.userId, newContactUserIds),
                  eq(schema.intents.status, 'ACTIVE'),
                  isNull(schema.intents.archivedAt),
                )
              );

            if (contactIntents.length > 0) {
              await tx.insert(schema.intentIndexes)
                .values(contactIntents.map(i => ({
                  intentId: i.id,
                  indexId: personalIndexId,
                })))
                .onConflictDoNothing();
            }
```

**Step 2: Run tests**

Run: `cd protocol && bun test src/adapters/tests/personal-index.adapter.spec.ts`
Expected: The backfill test from Task 1 now PASSES (no more intent backfill). All tests pass.

**Step 3: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "fix(personal-index): remove contact intent backfill from importContactsBulk"
```

---

### Task 5: Remove `getPersonalIndexesForContact` call from `IntentService`

**Files:**
- Modify: `protocol/src/services/intent.service.ts:169-181`

**Step 1: Remove the personal index auto-assign block**

Delete lines 169-181:

```typescript
    // Auto-assign to personal indexes where this user is a contact
    try {
      const personalIndexes = await this.adapter.getPersonalIndexesForContact(userId);
      for (const { indexId: pIndexId } of personalIndexes) {
        await this.adapter.assignIntentToIndex(created.id, pIndexId);
      }
    } catch (err) {
      logger.warn('[IntentService] Failed to auto-assign intent to personal indexes', {
        intentId: created.id,
        userId,
        error: err,
      });
    }
```

**Step 2: Run tests**

Run: `cd protocol && bun test src/adapters/tests/personal-index.adapter.spec.ts`
Expected: All tests still pass (this path was not exercised by the personal-index tests).

**Step 3: Commit**

```bash
git add protocol/src/services/intent.service.ts
git commit -m "fix(personal-index): remove contact intent auto-assign from IntentService"
```

---

### Task 6: Remove `getPersonalIndexesForContact` call from intent graph

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/intent.graph.ts:528-536`

**Step 1: Remove the personal index auto-assign block**

Delete lines 528-536:

```typescript
              // Auto-assign to personal indexes where this user is a contact
              try {
                const personalIndexes = await this.database.getPersonalIndexesForContact(state.userId);
                for (const { indexId } of personalIndexes) {
                  await this.database.assignIntentToIndex(created.id, indexId);
                }
              } catch (err) {
                logger.error('Failed to auto-assign intent to personal indexes', { intentId: created.id, error: err });
              }
```

**Step 2: Run tests**

Run: `cd protocol && bun test src/adapters/tests/personal-index.adapter.spec.ts`
Expected: All tests still pass.

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/graphs/intent.graph.ts
git commit -m "fix(personal-index): remove contact intent auto-assign from intent graph"
```

---

### Task 7: Write and apply migration

**Files:**
- Create: `protocol/drizzle/0014_fix_personal_index_intent_boundary.sql`
- Modify: `protocol/drizzle/meta/_journal.json`

**Step 1: Create the migration file**

```sql
-- Fix personal index intent boundary (IND-159)
-- 1. Set autoAssign = true for owner memberships of personal indexes
-- 2. Remove contact intents from personal indexes (keep owner intents)

UPDATE index_members
SET auto_assign = true
WHERE permissions @> ARRAY['owner']
AND index_id IN (SELECT id FROM indexes WHERE is_personal = true);

DELETE FROM intent_indexes
WHERE index_id IN (SELECT id FROM indexes WHERE is_personal = true)
AND intent_id IN (
  SELECT i.id FROM intents i
  WHERE i.user_id != (
    SELECT idx.owner_id FROM indexes idx
    WHERE idx.id = intent_indexes.index_id
  )
);
```

**Step 2: Update `drizzle/meta/_journal.json`**

Add a new entry to the `entries` array with the next sequence number (14), using the tag `0014_fix_personal_index_intent_boundary`. Copy the pattern from the last entry — increment `idx`, set `when` to current epoch ms, and use tag matching the filename without `.sql`.

**Step 3: Apply the migration**

Run: `cd protocol && bun run db:migrate`
Expected: Migration applies successfully.

**Step 4: Verify no pending schema changes**

Run: `cd protocol && bun run db:generate`
Expected: "No schema changes" (this migration is data-only, no DDL).

**Step 5: Commit**

```bash
git add protocol/drizzle/0014_fix_personal_index_intent_boundary.sql protocol/drizzle/meta/_journal.json
git commit -m "fix(personal-index): migration to fix owner autoAssign and remove contact intents"
```

---

### Task 8: Run full personal-index test suite and verify

**Step 1: Run the full test file**

Run: `cd protocol && bun test src/adapters/tests/personal-index.adapter.spec.ts`
Expected: All tests pass.

**Step 2: Run intent queue tests** (to confirm `getUserIndexIds` still works)

Run: `cd protocol && bun test src/queues/tests/intent.queue.spec.ts`
Expected: All tests pass (these use mocks, so unaffected by our data changes).

**Step 3: Commit all if any unstaged changes remain**

No new code expected — this is a verification step only.
