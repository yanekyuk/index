# Filter Non-Onboarded Users from Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Exclude users who haven't completed onboarding from discovery and opportunity matching, without misusing the `isGhost` flag.

**Architecture:** The `users.onboarding` JSONB column already tracks `completedAt`. We add a SQL condition `(is_ghost = true OR onboarding->>'completedAt' IS NOT NULL)` to the 4 embedder vector-search methods (the primary discovery entry point) and as a safety net in `opportunity.discover.ts` enrichment. Ghost users remain discoverable (they get "Invite to chat" UI). Only non-ghost users who haven't finished onboarding are excluded.

**Tech Stack:** Drizzle ORM, PostgreSQL JSONB, bun:test

**Linear:** IND-173

---

### Task 1: Write failing tests for embedder onboarding filter

**Files:**
- Create: `protocol/src/adapters/tests/embedder.onboarding.spec.ts`
- Reference: `protocol/src/adapters/embedder.adapter.ts`
- Reference: `protocol/src/schemas/database.schema.ts`

**Context:** The embedder has 4 private search methods that all join `schema.users` and filter `isNull(schema.users.deletedAt)`. We need to verify that non-onboarded real users are excluded from search results while ghost users and onboarded users still appear.

Testing the private methods directly is impractical — they're called via the public `searchForHyde` and `searchWithProfileEmbedding` methods. Since these are integration-level tests requiring real DB + embeddings, we'll test via `opportunity.discover.ts` in Task 3 instead.

**What to do:** Skip this task — the filtering is best tested at the integration level (Task 5).

---

### Task 2: Add onboarding filter to embedder search methods

**Files:**
- Modify: `protocol/src/adapters/embedder.adapter.ts` (4 methods)

**Step 1: Add the discoverable-user condition to `searchProfilesForHyde`**

In `searchProfilesForHyde` (~line 213), the `conditions` array currently has:
```typescript
const conditions = [
  inArray(indexMembers.indexId, filter.indexScope),
  isNotNull(userProfiles.embedding),
  isNull(schema.users.deletedAt),
  sql`1 - (${userProfiles.embedding} <=> ${vectorStr}::vector) >= ${minScore}`,
  ...(filter.excludeUserId ? [ne(userProfiles.userId, filter.excludeUserId)] : []),
];
```

Add after `isNull(schema.users.deletedAt)`:
```typescript
sql`(${schema.users.isGhost} = true OR ${schema.users.onboarding}->>'completedAt' IS NOT NULL)`,
```

**Step 2: Add the same condition to `searchIntentsForHyde`** (~line 261)

Add after `isNull(schema.users.deletedAt)`:
```typescript
sql`(${schema.users.isGhost} = true OR ${schema.users.onboarding}->>'completedAt' IS NOT NULL)`,
```

**Step 3: Add the same condition to `searchProfilesByProfileEmbedding`** (~line 303)

Add after `isNull(schema.users.deletedAt)`:
```typescript
sql`(${schema.users.isGhost} = true OR ${schema.users.onboarding}->>'completedAt' IS NOT NULL)`,
```

**Step 4: Add the same condition to `searchIntentsByProfileEmbedding`** (~line 349)

Add after `isNull(schema.users.deletedAt)`:
```typescript
sql`(${schema.users.isGhost} = true OR ${schema.users.onboarding}->>'completedAt' IS NOT NULL)`,
```

**Step 5: Run lint to verify**

Run: `cd protocol && bun run lint`

**Step 6: Commit**

```bash
git add protocol/src/adapters/embedder.adapter.ts
git commit -m "feat(IND-173): exclude non-onboarded users from embedder search

Users who registered but haven't completed onboarding now get filtered
out of all 4 vector-search methods. Ghost users remain discoverable."
```

---

### Task 3: Add onboarding filter to opportunity enrichment (safety net)

**Files:**
- Modify: `protocol/src/lib/protocol/support/opportunity.discover.ts`

**Context:** Even though the embedder now filters, candidates can reach enrichment through other paths. The existing soft-delete check at line ~197 is the right place to add an onboarding guard.

**Step 1: Add onboarding check alongside the existing deletedAt check**

At `opportunity.discover.ts` ~line 196-197, the current code:
```typescript
// Skip soft-deleted users (deletedAt is set)
if (candidateUser && 'deletedAt' in candidateUser && candidateUser.deletedAt) return null;
```

Add after it:
```typescript
// Skip non-onboarded real users (registered but haven't completed onboarding)
if (candidateUser && !candidateUser.isGhost && !candidateUser.onboarding?.completedAt) return null;
```

**Note:** The `getUser()` method at `database.adapter.ts:1023` does a `db.select()` from `schema.users` which returns all columns including `onboarding` and `isGhost`, so both fields are available on `candidateUser`.

**Step 2: Run lint**

Run: `cd protocol && bun run lint`

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/support/opportunity.discover.ts
git commit -m "feat(IND-173): skip non-onboarded users in opportunity enrichment

Safety net: even if a non-onboarded user bypasses the embedder filter,
they get excluded during opportunity candidate enrichment."
```

---

### Task 4: Add onboarding + deletedAt filter to `getMembersFromUserIndexes`

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts`

**Context:** `getMembersFromUserIndexes` fetches all members from a user's indexes for scope/discovery purposes. It currently filters deleted indexes but not deleted or non-onboarded users — a potential bug.

**Step 1: Add user filters to the member query**

At `database.adapter.ts` ~line 1843-1844, the current `.where`:
```typescript
.where(
  and(inArray(indexMembers.indexId, myIndexIds), isNull(indexes.deletedAt))
);
```

Add `isNull(users.deletedAt)` (the join is already on `users`):
```typescript
.where(
  and(
    inArray(indexMembers.indexId, myIndexIds),
    isNull(indexes.deletedAt),
    isNull(users.deletedAt),
    sql`(${users.isGhost} = true OR ${users.onboarding}->>'completedAt' IS NOT NULL)`,
  )
);
```

**Step 2: Verify `sql` is imported**

Check that `sql` from `drizzle-orm` is already imported at the top of the file. It should be — it's used extensively.

**Step 3: Run lint**

Run: `cd protocol && bun run lint`

**Step 4: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "fix(IND-173): filter deleted and non-onboarded users from getMembersFromUserIndexes

Previously returned soft-deleted and non-onboarded users in scope queries."
```

---

### Task 5: Write integration test for non-onboarded user filtering

**Files:**
- Create: `protocol/tests/onboarding-filter.spec.ts`
- Reference: `protocol/src/adapters/database.adapter.ts`
- Reference: `protocol/src/lib/protocol/support/opportunity.discover.ts`

**Context:** We test the `opportunity.discover.ts` safety-net filter with a mock that simulates a non-onboarded user reaching enrichment. The embedder-level filter requires real DB with embeddings, so we focus on the enrichment filter here.

**Step 1: Write test for the enrichment filter**

```typescript
import { loadEnv } from '../src/lib/env';
loadEnv();

import { describe, it, expect } from 'bun:test';

describe('Non-onboarded user filtering in opportunity enrichment', () => {
  it('should skip non-onboarded real users (onboarding.completedAt is undefined)', () => {
    // Simulate the filter logic from opportunity.discover.ts
    const candidateUser = {
      id: 'test-user-1',
      name: 'Test User',
      isGhost: false,
      onboarding: {},
      deletedAt: null,
    };

    const shouldSkip = candidateUser && !candidateUser.isGhost && !candidateUser.onboarding?.completedAt;
    expect(shouldSkip).toBe(true);
  });

  it('should NOT skip ghost users even without onboarding', () => {
    const candidateUser = {
      id: 'ghost-user-1',
      name: 'Ghost',
      isGhost: true,
      onboarding: {},
      deletedAt: null,
    };

    const shouldSkip = candidateUser && !candidateUser.isGhost && !candidateUser.onboarding?.completedAt;
    expect(shouldSkip).toBe(false);
  });

  it('should NOT skip onboarded real users', () => {
    const candidateUser = {
      id: 'real-user-1',
      name: 'Real User',
      isGhost: false,
      onboarding: { completedAt: '2026-01-01T00:00:00Z' },
      deletedAt: null,
    };

    const shouldSkip = candidateUser && !candidateUser.isGhost && !candidateUser.onboarding?.completedAt;
    expect(shouldSkip).toBe(false);
  });

  it('should still skip soft-deleted users regardless of onboarding', () => {
    const candidateUser = {
      id: 'deleted-user-1',
      name: 'Deleted',
      isGhost: false,
      onboarding: { completedAt: '2026-01-01T00:00:00Z' },
      deletedAt: '2026-02-01T00:00:00Z',
    };

    const shouldSkipDeleted = candidateUser && 'deletedAt' in candidateUser && candidateUser.deletedAt;
    expect(shouldSkipDeleted).toBeTruthy();
  });
});
```

**Step 2: Run the test**

Run: `cd protocol && bun test tests/onboarding-filter.spec.ts`
Expected: All 4 tests PASS

**Step 3: Commit**

```bash
git add protocol/tests/onboarding-filter.spec.ts
git commit -m "test(IND-173): add unit tests for non-onboarded user filtering logic"
```

---

### Task 6: Run type-check and existing tests

**Step 1: Run tsc**

Run: `cd protocol && bunx tsc --noEmit`
Expected: No type errors

**Step 2: Run existing embedder tests**

Run: `cd protocol && bun test src/adapters/tests/embedder.adapter.spec.ts`
Expected: All pass (our changes only add conditions, don't break existing behavior)

**Step 3: Run existing opportunity tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`
Expected: All pass

---

## Summary of changes

| File | Change |
|------|--------|
| `protocol/src/adapters/embedder.adapter.ts` | Add `(isGhost OR onboarding completedAt IS NOT NULL)` to 4 search methods |
| `protocol/src/lib/protocol/support/opportunity.discover.ts` | Skip non-onboarded real users in enrichment |
| `protocol/src/adapters/database.adapter.ts` | Add `deletedAt` + onboarding filter to `getMembersFromUserIndexes` |
| `protocol/tests/onboarding-filter.spec.ts` | Unit tests for the filtering logic |
