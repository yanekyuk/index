# Fix Opportunity "Someone" Fallback (IND-152) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Prevent non-UUID userIds from entering the `intents` table and propagating through the opportunity pipeline, which causes "Someone" fallback in opportunity cards.

**Architecture:** Three layers of defense: (1) Extract `isValidUUID()` helper to a shared location, (2) validate userId at intent creation in `database.adapter.ts`, (3) filter candidates with invalid userIds in the opportunity graph discovery phase, (4) validate actor userIds in `validateOpportunityActors()` as a final safety net.

**Tech Stack:** TypeScript, Bun test, Drizzle ORM, LangGraph

---

### Task 1: Extract `isValidUUID` helper to shared utility

The codebase already has `UUID_REGEX` in `tool.helpers.ts`, but that file is specific to chat agent tools. We need a shared utility that both `database.adapter.ts` and `opportunity.utils.ts` can import without crossing layering boundaries.

**Files:**
- Create: `protocol/src/lib/protocol/support/validation.utils.ts`
- Test: `protocol/src/lib/protocol/support/tests/validation.utils.spec.ts`

**Step 1: Write the failing test**

Create `protocol/src/lib/protocol/support/tests/validation.utils.spec.ts`:

```typescript
import { describe, expect, test } from 'bun:test';

import { isValidUUID } from '../validation.utils';

describe('isValidUUID', () => {
  test('accepts valid UUID v4', () => {
    expect(isValidUUID('c2505011-2e45-426e-81dd-b9abb9b72023')).toBe(true);
  });

  test('accepts uppercase UUID', () => {
    expect(isValidUUID('C2505011-2E45-426E-81DD-B9ABB9B72023')).toBe(true);
  });

  test('rejects non-UUID alphanumeric string', () => {
    expect(isValidUUID('TS9uwW4671WavtWJtSMrjeBLzL1KZJPb')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidUUID('')).toBe(false);
  });

  test('rejects UUID without dashes', () => {
    expect(isValidUUID('c25050112e45426e81ddb9abb9b72023')).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/lib/protocol/support/tests/validation.utils.spec.ts`
Expected: FAIL — `isValidUUID` is not defined / cannot find module

**Step 3: Write minimal implementation**

Create `protocol/src/lib/protocol/support/validation.utils.ts`:

```typescript
/** UUID v4 format: 8-4-4-4-12 hex chars. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that a string is a well-formed UUID (v4 hex format with dashes).
 *
 * @param value - The string to validate
 * @returns true if the string matches UUID format
 */
export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/lib/protocol/support/tests/validation.utils.spec.ts`
Expected: PASS — all 5 tests green

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/support/validation.utils.ts protocol/src/lib/protocol/support/tests/validation.utils.spec.ts
git commit -m "feat: add isValidUUID shared helper for userId validation"
```

---

### Task 2: Validate userId in `createIntent()` (root cause fix)

Both `IntentDatabaseAdapter.createIntent()` (line 238) and `ChatDatabaseAdapter.createIntent()` (line 1058) accept any string as `userId`. Add UUID validation to reject non-UUID values before they reach the database.

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts:238-271` (IntentDatabaseAdapter.createIntent)
- Modify: `protocol/src/adapters/database.adapter.ts:1058-1091` (ChatDatabaseAdapter.createIntent)
- Test: `protocol/src/adapters/tests/database.adapter.spec.ts` (add tests to existing file)

**Step 1: Write the failing test**

Add to `protocol/src/adapters/tests/database.adapter.spec.ts` (inside appropriate describe block, or create new one):

```typescript
import { isValidUUID } from '../../lib/protocol/support/validation.utils';

describe('createIntent userId validation', () => {
  test('rejects non-UUID userId with descriptive error', async () => {
    expect(() => {
      if (!isValidUUID('TS9uwW4671WavtWJtSMrjeBLzL1KZJPb')) {
        throw new Error('Invalid userId: must be a valid UUID');
      }
    }).toThrow('Invalid userId: must be a valid UUID');
  });
});
```

Note: The actual test should call `db.createIntent()` with a non-UUID userId if the test infrastructure supports it. If the existing spec has test setup for the adapter, use it. Otherwise, write a unit-level test that validates the guard logic.

Check the existing test file to understand the test setup pattern:

Run: `head -50 protocol/src/adapters/tests/database.adapter.spec.ts`

Adapt the test to use the existing test infrastructure. The key assertion: calling `createIntent({ userId: 'TS9uwW4671WavtWJtSMrjeBLzL1KZJPb', ... })` must throw `'Invalid userId: must be a valid UUID'`.

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/adapters/tests/database.adapter.spec.ts --test-name-pattern "rejects non-UUID"`
Expected: FAIL — currently `createIntent()` does not validate userId

**Step 3: Write minimal implementation**

In `protocol/src/adapters/database.adapter.ts`, add the import at the top (with other deep relative imports):

```typescript
import { isValidUUID } from '../lib/protocol/support/validation.utils';
```

Then add validation to `IntentDatabaseAdapter.createIntent()` (line 238, before the try block):

```typescript
async createIntent(data: CreateIntentInput): Promise<CreatedIntentRow> {
    if (!isValidUUID(data.userId)) {
      throw new Error('Invalid userId: must be a valid UUID');
    }
    try {
      // ... existing code
```

And the same validation to `ChatDatabaseAdapter.createIntent()` (line 1058):

```typescript
async createIntent(data: CreateIntentInput): Promise<CreatedIntentRow> {
    if (!isValidUUID(data.userId)) {
      throw new Error('Invalid userId: must be a valid UUID');
    }
    try {
      // ... existing code
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/adapters/tests/database.adapter.spec.ts --test-name-pattern "rejects non-UUID"`
Expected: PASS

Also run full adapter spec to check for regressions:
Run: `cd protocol && bun test src/adapters/tests/database.adapter.spec.ts`
Expected: All existing tests still pass

**Step 5: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts protocol/src/adapters/tests/database.adapter.spec.ts
git commit -m "fix: validate userId is UUID before inserting intents"
```

---

### Task 3: Filter non-UUID candidates in opportunity graph discovery

The opportunity graph takes `result.userId` from embedder search and casts it to `Id<'users'>` without validation (lines ~542, 599, 610, 825, 837). Existing bad data in the DB will still propagate. Add a guard that skips candidates with non-UUID userIds.

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts`
- Test: `protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts` (create new file)

**Step 1: Write the failing test**

Create `protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`:

```typescript
import { describe, expect, test } from 'bun:test';

import { isValidUUID } from '../../support/validation.utils';

describe('Opportunity graph candidate filtering', () => {
  test('filters out candidates with non-UUID userIds', () => {
    const candidates = [
      { userId: 'c2505011-2e45-426e-81dd-b9abb9b72023', score: 0.9, id: 'intent-1', type: 'intent' as const, matchedVia: 'lens-1' },
      { userId: 'TS9uwW4671WavtWJtSMrjeBLzL1KZJPb', score: 0.85, id: 'intent-2', type: 'intent' as const, matchedVia: 'lens-2' },
    ];

    const filtered = candidates.filter(r => isValidUUID(r.userId));

    expect(filtered).toHaveLength(1);
    expect(filtered[0].userId).toBe('c2505011-2e45-426e-81dd-b9abb9b72023');
  });
});
```

**Step 2: Run test to verify it passes** (this test validates the filtering logic, not the graph integration — it should pass immediately since `isValidUUID` already works)

Since the test validates the filter logic and `isValidUUID` exists, this test will pass. The real "failing test" aspect is that the opportunity graph code does NOT currently apply this filter. The test documents the expected behavior.

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`

**Step 3: Apply the filter in the opportunity graph**

In `protocol/src/lib/protocol/graphs/opportunity.graph.ts`, add the import:

```typescript
import { isValidUUID } from '../support/validation.utils';
```

Then wrap each candidate push with a UUID check. There are multiple locations where `result.userId as Id<'users'>` appears. At each location, add a guard:

**Location 1 (~line 540-551, query path candidates):**
```typescript
for (const result of results) {
  if (!isValidUUID(result.userId)) {
    logger.warn('[Graph:Discovery] Skipping candidate with non-UUID userId', { userId: result.userId });
    continue;
  }
  profileCandidates.push({
    candidateUserId: result.userId as Id<'users'>,
    // ...
  });
}
```

Apply the same pattern at all other locations where `candidateUserId: result.userId as Id<'users'>` appears (~lines 599, 610, 825, 837).

**Step 4: Run test to verify it passes + run tsc**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`
Run: `cd protocol && npx tsc --noEmit`
Expected: PASS, no type errors

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
git commit -m "fix: filter candidates with non-UUID userIds in opportunity discovery"
```

---

### Task 4: Validate actor userIds in `validateOpportunityActors()` (safety net)

The existing `validateOpportunityActors()` only checks introducer count. Extend it to also reject actors with non-UUID userIds.

**Files:**
- Modify: `protocol/src/lib/protocol/support/opportunity.utils.ts:51-60`
- Test: `protocol/src/lib/protocol/support/tests/opportunity.utils.spec.ts` (create new file)

**Step 1: Write the failing test**

Create `protocol/src/lib/protocol/support/tests/opportunity.utils.spec.ts`:

```typescript
import { describe, expect, test } from 'bun:test';

import { validateOpportunityActors } from '../opportunity.utils';

describe('validateOpportunityActors', () => {
  test('accepts actors with valid UUID userIds', () => {
    expect(() =>
      validateOpportunityActors([
        { userId: 'c2505011-2e45-426e-81dd-b9abb9b72023', role: 'patient' },
        { userId: 'a1234567-b234-c345-d456-e56789abcdef', role: 'agent' },
      ])
    ).not.toThrow();
  });

  test('rejects actors with non-UUID userIds', () => {
    expect(() =>
      validateOpportunityActors([
        { userId: 'c2505011-2e45-426e-81dd-b9abb9b72023', role: 'patient' },
        { userId: 'TS9uwW4671WavtWJtSMrjeBLzL1KZJPb', role: 'agent' },
      ])
    ).toThrow('non-UUID userId');
  });

  test('still validates introducer rule', () => {
    expect(() =>
      validateOpportunityActors([
        { userId: 'c2505011-2e45-426e-81dd-b9abb9b72023', role: 'introducer' },
      ])
    ).toThrow('introducer must have one or two other actors');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/lib/protocol/support/tests/opportunity.utils.spec.ts`
Expected: FAIL — the "rejects actors with non-UUID userIds" test should fail because `validateOpportunityActors` doesn't currently check userId format. Note: the function signature currently only requires `{ role: string }` — it needs to accept `{ userId?: string; role: string }`.

**Step 3: Write minimal implementation**

Update `validateOpportunityActors` in `protocol/src/lib/protocol/support/opportunity.utils.ts`:

```typescript
import { isValidUUID } from './validation.utils';
```

Update the function signature and add userId validation:

```typescript
export function validateOpportunityActors(actors: Array<{ userId?: string; role: string }>): void {
  // Validate userId format for all actors that have one
  const invalidActors = actors.filter((a) => a.userId && !isValidUUID(a.userId));
  if (invalidActors.length > 0) {
    throw new Error(
      `Opportunity has actor(s) with non-UUID userId: ${invalidActors.map((a) => a.userId).join(', ')}`
    );
  }

  const introducerCount = actors.filter((a) => a.role === 'introducer').length;
  const nonIntroducerCount = actors.filter((a) => a.role !== 'introducer').length;

  if (introducerCount > 0 && (nonIntroducerCount < 1 || nonIntroducerCount > 2)) {
    throw new Error(
      'An opportunity with an introducer must have one or two other actors.'
    );
  }
}
```

**Step 4: Run test to verify it passes + run tsc**

Run: `cd protocol && bun test src/lib/protocol/support/tests/opportunity.utils.spec.ts`
Run: `cd protocol && npx tsc --noEmit`
Expected: PASS, no type errors

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/support/opportunity.utils.ts protocol/src/lib/protocol/support/tests/opportunity.utils.spec.ts
git commit -m "fix: validate actor userIds are UUIDs in validateOpportunityActors"
```

---

### Task 5: Update `tool.helpers.ts` to reuse shared `isValidUUID`

Now that `isValidUUID` and `UUID_REGEX` live in the shared `validation.utils.ts`, update `tool.helpers.ts` to re-export from there instead of defining its own regex. This avoids drift between two UUID regex definitions.

**Files:**
- Modify: `protocol/src/lib/protocol/tools/tool.helpers.ts:286-287`

**Step 1: Update import**

In `tool.helpers.ts`, replace the local `UUID_REGEX` definition with a re-export:

```typescript
export { isValidUUID } from '../support/validation.utils';
```

Keep `UUID_REGEX` as a re-export or inline reference to avoid breaking existing consumers:

```typescript
import { isValidUUID } from '../support/validation.utils';

/** @deprecated Use isValidUUID() instead */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

**Step 2: Run tsc to verify no breakage**

Run: `cd protocol && npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/tools/tool.helpers.ts
git commit -m "refactor: add isValidUUID export to tool.helpers, deprecate UUID_REGEX"
```

---

### Task 6: Final verification

**Step 1: Run all affected tests**

```bash
cd protocol
bun test src/lib/protocol/support/tests/validation.utils.spec.ts
bun test src/lib/protocol/support/tests/opportunity.utils.spec.ts
bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
bun test src/adapters/tests/database.adapter.spec.ts
```

**Step 2: Run type check**

```bash
cd protocol && npx tsc --noEmit
```

**Step 3: Run lint**

```bash
cd protocol && bun run lint
```

All must pass before creating PR.
