# Design: Personal Index Intent Boundary (IND-159)

## Problem

Personal indexes expose contact intents — contacts' intents are auto-assigned to the index owner's personal index, leaking what contacts are looking for. Only the owner's intents should be in their personal index; contacts should be visible only via profile embeddings.

## Expected Behavior

- **Owner's intents** are always assigned to their own personal index
- **Contact's intents** are never assigned to the owner's personal index
- Intents created in a non-personal index scope do not escape to personal indexes

## Current Leakage Sources

| # | Location | Mechanism |
|---|----------|-----------|
| 1 | `intent.service.ts:169-181` | `getPersonalIndexesForContact()` assigns new intents to every personal index where the creator is a contact |
| 2 | `intent.graph.ts:528-536` | Same pattern in executor node |
| 3 | `database.adapter.ts:2818-2837` | Contact sync backfills existing active intents into personal index |

Additionally, the owner's personal index membership is created with `autoAssign: false` (`database.adapter.ts:53`), so the owner's own intents are not assigned to their personal index via the HyDE queue's `getUserIndexIds()` path either.

## Changes

### 1. Owner gets `autoAssign: true` on personal index membership

**File**: `database.adapter.ts:49-54` (personal index creation)

Change owner membership from `autoAssign: false` to `autoAssign: true`. This makes `getUserIndexIds()` in the HyDE queue (`intent.queue.ts:195`) naturally include the personal index for the owner, so their intents flow there via existing assignment logic.

**Migration**: Update existing owner memberships:
```sql
UPDATE index_members
SET auto_assign = true
WHERE permissions @> '{owner}'
AND index_id IN (SELECT id FROM indexes WHERE is_personal = true);
```

### 2. Remove `getPersonalIndexesForContact()` calls from intent creation

**File**: `intent.service.ts:169-181` — Remove the block that calls `getPersonalIndexesForContact()` and assigns intents to personal indexes.

**File**: `intent.graph.ts:528-536` — Remove the same block in the executor node.

These calls bypass `autoAssign` and push a user's intents into other people's personal indexes.

### 3. Remove contact intent backfill from contact sync

**File**: `database.adapter.ts:2818-2837` — Remove the block that backfills active intents for new contacts into the personal index.

### 4. Migration: Clean up existing data

Delete contact intents from personal indexes (keep owner intents):
```sql
DELETE FROM intent_indexes
WHERE index_id IN (SELECT id FROM indexes WHERE is_personal = true)
AND intent_id IN (
  SELECT i.id FROM intents i
  JOIN indexes idx ON idx.is_personal = true AND intent_indexes.index_id = idx.id
  WHERE i.user_id != idx.owner_id
);
```

## What stays unchanged

- `getPersonalIndexesForContact()` method — remains available, just no longer called for intent assignment
- Profile embedding searches — continue working for personal indexes (contacts visible via profiles)
- Contact sync — still adds users as members of personal indexes, just stops backfilling their intents
- `getUserIndexIds()` — no filter changes needed; `autoAssign: false` on contact memberships already prevents contact intent assignment through this path
- Search/embedder methods — no guards needed; once data is correct, queries return correct results
