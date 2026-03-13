# Remove `indexes.ownerId` — Use `index_members` Ownership

**Date:** 2026-03-13
**Issue:** IND-158
**Status:** Approved

## Problem

The `indexes` table has an `ownerId` column that duplicates ownership already tracked in `index_members` via `permissions: ['owner']`. This creates two parallel ownership models with divergence risk. Every authorization check already uses `index_members` — personal indexes should be consistent.

## Design

### New Table: `personal_indexes`

```sql
CREATE TABLE personal_indexes (
  user_id TEXT NOT NULL REFERENCES users(id),
  index_id TEXT NOT NULL REFERENCES indexes(id),
  PRIMARY KEY (user_id),   -- one personal index per user
  UNIQUE (index_id)        -- an index can only be personal for one user
);
```

Replaces the `ownerId` column as the DB-level constraint enforcing one personal index per user. Also serves as a fast lookup path for `getPersonalIndexId()`.

### Schema Removals from `indexes`

- Column `owner_id`
- Unique index `indexes_is_personal_owner`
- CHECK constraint `personal_owner_check`
- Relation `owner` in `indexesRelations`

### Migration Strategy

Single migration:
1. Create `personal_indexes` table
2. Backfill: `INSERT INTO personal_indexes SELECT owner_id, id FROM indexes WHERE is_personal = true`
3. Drop `owner_id` column, unique index, and CHECK constraint

### Code Changes

**`database.adapter.ts`:**
- `ensurePersonalIndex(userId)` — write to `personal_indexes` instead of setting `ownerId`
- `getPersonalIndexId(userId)` — query `personal_indexes` instead of `indexes WHERE ownerId`
- `getIndexMemberships(userId)` — filter via `personal_indexes` join instead of `indexes.ownerId`
- `getIndexesForUser(userId)` — join through `index_members` with `'owner'` permission for owner info

**`database.schema.ts`:**
- Add `personalIndexes` table definition + relations
- Remove `ownerId`, constraints, and `owner` relation from `indexes`

**`indexes.types.ts`:**
- Remove `ownerId` from `Index` interface

**`database.interface.ts`:**
- Remove any `ownerId` references (method signatures unchanged)

**`personal-index.adapter.spec.ts`:**
- Update assertions checking `ownerId` on created indexes
- Verify via `personal_indexes` table instead

### Unchanged

- `userContacts.ownerId` — different table/concept
- `isIndexOwner()`, `getOwnedIndexes()` — already use `index_members`
- `createIndex()` — never set `ownerId`
- Graph files — already use membership-based ownership
- `contact.service.ts`, `opportunity.service.ts` — use `userContacts.ownerId`
