# Intent Archival Cascade Cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix intent archival to do full cascade cleanup (HyDE, opportunities, intent-indexes, queue jobs, events) and wire the frontend undo to use `PATCH /intents/:id/archive`.

**Architecture:** The `intentService.archive()` method currently only sets `archivedAt`. We add cascade cleanup steps after the soft delete: enqueue HyDE deletion, remove intent-index associations, expire related opportunities, and emit an event. The frontend replaces `POST /intents/undo-proposal` with `PATCH /intents/${intentId}/archive`.

**Tech Stack:** Drizzle ORM (PostgreSQL, JSONB queries), BullMQ, Bun, React/Next.js

**Design doc:** `docs/plans/2026-03-06-intent-archival-cascade-cleanup-design.md`

---

### Task 1: Create `IntentEvents` event hook

**Files:**
- Create: `protocol/src/events/intent.event.ts`

Follow the same pattern as `protocol/src/events/index_membership.event.ts:1-7`.

**Step 1: Create the event file**

```typescript
/**
 * Hook called when an intent is archived.
 * Set by main.ts to trigger cascade cleanup via queues/brokers.
 */
export const IntentEvents = {
  onArchived: (_intentId: string, _userId: string): void => {},
};
```

**Step 2: Commit**

```bash
git add protocol/src/events/intent.event.ts
git commit -m "feat(events): add IntentEvents with onArchived hook"
```

---

### Task 2: Add `deleteIntentIndexAssociations` to database adapter

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts` (IntentDatabaseAdapter class, after `archiveIntent` at ~line 256)
- Modify: `protocol/src/lib/protocol/interfaces/database.interface.ts` (add to interface)

**Step 1: Add method to `IntentDatabaseAdapter`**

Add after `archiveIntent` (~line 256) in `database.adapter.ts`:

```typescript
async deleteIntentIndexAssociations(intentId: string): Promise<void> {
  await db.delete(schema.intentIndexes)
    .where(eq(schema.intentIndexes.intentId, intentId));
}
```

Ensure `schema.intentIndexes` is imported (it's in `database.schema.ts:317-321`).

**Step 2: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "feat(adapter): add deleteIntentIndexAssociations method"
```

---

### Task 3: Add `expireOpportunitiesByIntentActor` to database adapter

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts` (after the method from Task 2)

This needs a JSONB query: find opportunities where any element in the `actors` array has `intent = intentId`, and those opportunities are not already expired. Then set `status = 'expired'`.

**Step 1: Add method**

```typescript
async expireOpportunitiesByIntentActor(intentId: string): Promise<number> {
  const result = await db.update(schema.opportunities)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(and(
      sql`${schema.opportunities.actors} @> ${JSON.stringify([{ intent: intentId }])}::jsonb`,
      ne(schema.opportunities.status, 'expired'),
    ))
    .returning({ id: schema.opportunities.id });
  return result.length;
}
```

Note: The `actors` JSONB column stores `OpportunityActor[]` where each actor has an optional `intent` field (`schema/database.schema.ts:216`). The `@>` operator checks if the array contains an element matching `{ intent: intentId }`.

Imports needed: `ne` from `drizzle-orm` (check if already imported), `sql` from `drizzle-orm`.

**Step 2: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "feat(adapter): add expireOpportunitiesByIntentActor JSONB query"
```

---

### Task 4: Expand `intentService.archive()` with cascade cleanup

**Files:**
- Modify: `protocol/src/services/intent.service.ts:254-264`

The current method:
```typescript
async archive(intentId: string, userId: string) {
  logger.verbose('[IntentService] Archiving intent', { intentId, userId });
  const owned = await this.adapter.isOwnedByUser(intentId, userId);
  if (!owned) {
    return { success: false, error: 'Intent not found or unauthorized' };
  }
  return this.adapter.archiveIntent(intentId);
}
```

**Step 1: Add imports at top of file**

```typescript
import { IntentEvents } from '../events/intent.event';
```

Also ensure `intentQueue` is imported (check if it already is — it's used elsewhere in this service for `addGenerateHydeJob`).

**Step 2: Expand the archive method**

```typescript
async archive(intentId: string, userId: string) {
  logger.verbose('[IntentService] Archiving intent', { intentId, userId });

  const owned = await this.adapter.isOwnedByUser(intentId, userId);
  if (!owned) {
    return { success: false, error: 'Intent not found or unauthorized' };
  }

  const result = await this.adapter.archiveIntent(intentId);
  if (!result.success) return result;

  // Cascade cleanup (best-effort, logged but non-blocking)
  try {
    await this.adapter.deleteIntentIndexAssociations(intentId);
  } catch (err) {
    logger.error('[IntentService] Failed to delete intent-index associations', { intentId, error: err });
  }

  try {
    const expiredCount = await this.adapter.expireOpportunitiesByIntentActor(intentId);
    if (expiredCount > 0) {
      logger.verbose('[IntentService] Expired opportunities referencing intent', { intentId, expiredCount });
    }
  } catch (err) {
    logger.error('[IntentService] Failed to expire opportunities', { intentId, error: err });
  }

  try {
    await intentQueue.addDeleteHydeJob({ intentId });
  } catch (err) {
    logger.error('[IntentService] Failed to enqueue HyDE deletion', { intentId, error: err });
  }

  IntentEvents.onArchived(intentId, userId);

  return result;
}
```

**Step 3: Commit**

```bash
git add protocol/src/services/intent.service.ts
git commit -m "feat(intent): cascade cleanup on archive (indexes, opportunities, HyDE, events)"
```

---

### Task 5: Wire `IntentEvents.onArchived` in main.ts

**Files:**
- Modify: `protocol/src/main.ts` (after `IndexMembershipEvents.onMemberAdded` at ~line 40-44)

**Step 1: Add import and hook**

Add import alongside existing event import (~line 31):
```typescript
import { IntentEvents } from './events/intent.event';
```

Add hook after the `IndexMembershipEvents` block (~line 44):
```typescript
IntentEvents.onArchived = (intentId: string, userId: string) => {
  log.from('IntentEvents').verbose('Intent archived', { intentId, userId });
};
```

This is a no-op for now — it logs the event. Brokers can be wired here later.

**Step 2: Commit**

```bash
git add protocol/src/main.ts
git commit -m "feat(main): wire IntentEvents.onArchived hook"
```

---

### Task 6: Frontend — wire undo to `PATCH /intents/:id/archive`

**Files:**
- Modify: `.worktrees/feat-intent-proposal-autosave/frontend/src/components/ChatContent.tsx:673-717`

**Step 1: Update `handleIntentProposalApprove` (~line 673)**

The confirm response returns `{ success, proposalId, intentId }`. Capture `intentId` and use it in the undo action.

Replace lines 673-693:
```typescript
const handleIntentProposalApprove = useCallback(
  async (proposalId: string, description: string, indexId?: string) => {
    try {
      const res = await apiClient.post<{ intentId: string }>("/intents/confirm", { proposalId, description, indexId });
      setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "created" }));
      addNotification({
        type: "intent_broadcast",
        title: "Broadcasting Signal",
        message: description,
        duration: 10000,
        onAction: async () => {
          await apiClient.patch(`/intents/${res.intentId}/archive`);
          setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "rejected" }));
        },
      });
    } catch (err) {
      throw err;
    }
  },
  [addNotification],
);
```

**Step 2: Update `handleIntentProposalUndo` (~line 707)**

This also needs the `intentId`. Since the card's inline undo fires with `proposalId`, we need a mapping. Add state to track it.

Add near other state declarations (~line 609 area):
```typescript
const [proposalIntentMap, setProposalIntentMap] = useState<Record<string, string>>({});
```

In `handleIntentProposalApprove`, after getting `res`, store the mapping:
```typescript
setProposalIntentMap((prev) => ({ ...prev, [proposalId]: res.intentId }));
```

Update `handleIntentProposalUndo`:
```typescript
const handleIntentProposalUndo = useCallback(
  async (proposalId: string) => {
    const intentId = proposalIntentMap[proposalId];
    if (!intentId) throw new Error("Intent ID not found for proposal");
    try {
      await apiClient.patch(`/intents/${intentId}/archive`);
      setIntentProposalStatusMap((prev) => ({ ...prev, [proposalId]: "rejected" }));
    } catch (err) {
      throw err;
    }
  },
  [proposalIntentMap],
);
```

**Step 3: Commit**

```bash
git add frontend/src/components/ChatContent.tsx
git commit -m "feat(chat): wire undo to PATCH /intents/:id/archive"
```

---

### Task 7: Test the full flow manually

**Steps:**
1. Run protocol dev server: `cd protocol && bun run dev`
2. Run frontend dev server: `cd frontend && bun run dev`
3. Open chat, trigger an intent proposal
4. Let the 5-second countdown finish (intent created)
5. Click "Undo" in the toast within 10 seconds
6. Verify:
   - Intent has `archivedAt` set in DB
   - `intent_indexes` rows removed
   - Opportunities expired
   - HyDE deletion job enqueued
7. Test without undo — verify intent persists normally

---

### Task 8: Final commit and cleanup

**Step 1: Remove dead code**

Search for any remaining `undo-proposal` references in the frontend and remove them.

**Step 2: Commit**

```bash
git add -A
git commit -m "chore: remove dead undo-proposal references"
```
