# Personal Index Design Spec

**Date**: 2026-03-12
**Linear Issues**: IND-147, IND-132, IND-150
**Status**: Draft

## Problem

The Global Index (`isGlobal`) is a singleton that auto-enrolls all users for network-wide discovery. This creates architectural complexity, broken contact-only discovery paths, and doesn't model ownership or access control properly. We need a per-user personal index that gives each user a private discovery scope over their imported contacts.

## Solution

Replace `isGlobal` with `isPersonal` — a per-user index created at registration. Contacts imported into `user_contacts` are automatically added as members with a `contact` permission. Only the owner can see and operate on their personal index. Contacts' intents are auto-assigned to the personal index via `intent_indexes`, enabling standard index-scoped discovery.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| When to create personal index | At registration | Always present, no lazy-creation edge cases |
| Relationship to `contactsOnly` | Coexist independently | `contactsOnly` filters via `user_contacts`; personal index is a membership container. Scoping to a personal index + `contactsOnly=true` is redundant but harmless. `contactsOnly` with a regular index still filters by `user_contacts`. |
| Contact import behavior | Auto-add to personal index | Contacts become discoverable through the index scope |
| Contact permission type | `['contact']` in permissions array | Explicit, queryable, no schema changes to `index_members` |
| Index title/prompt | Fixed: "My Network", system prompt | Not editable by owner |
| Frontend visibility | Visible in Networks list for owner only | First-class index with distinct styling |
| Intent assignment | Auto-assign contact intents to personal index | Enables standard index-scoped search |

## Schema Changes

### `indexes` table

- **Remove**: `isGlobal` column and `indexes_is_global_unique` constraint
- **Add**: `ownerId: text('owner_id').references(() => users.id)` — nullable, set only for personal indexes. Used to enforce uniqueness and for efficient lookup.
- **Add**: unique constraint `indexes_is_personal_owner` on `(isPersonal, ownerId)` where `is_personal = true` — ensures one personal index per user
- **Add**: CHECK constraint `CHECK (NOT is_personal OR owner_id IS NOT NULL)` — prevents personal indexes without an owner
- **Keep**: `isPersonal` column (already exists in schema from IND-147 work)
- **Update**: `indexesRelations` — add `owner: one(users, { fields: [indexes.ownerId], references: [users.id] })` relation

### `intent_indexes` table

- **Add**: primary key on `(intentId, indexId)` — prevents duplicate entries and enables `onConflictDoNothing()` for idempotent inserts during contact import and intent creation

### `index_members` table

- No schema changes. New permission value `'contact'` used in existing `permissions` text array.

### Migration

1. Drop `indexes_is_global_unique` constraint
2. Drop `isGlobal` column from `indexes`
3. Add `ownerId` column to `indexes` (nullable text, FK to `users.id`)
4. Add `indexes_is_personal_owner` unique constraint on `(is_personal, owner_id)` where `is_personal = true`
5. Add CHECK constraint `CHECK (NOT is_personal OR owner_id IS NOT NULL)`
6. Delete `intent_indexes` rows referencing the global index
7. Delete `index_members` rows referencing the global index
8. Set `chat_sessions.indexId` to null where it references the global index
9. Delete the global index row from `indexes`
10. Deduplicate `intent_indexes`: `DELETE FROM intent_indexes a USING intent_indexes b WHERE a.ctid < b.ctid AND a.intent_id = b.intent_id AND a.index_id = b.index_id`
11. Add primary key `(intent_id, index_id)` on `intent_indexes`
12. Backfill: for each existing user, create a personal index ("My Network") with `ownerId` set, and add owner as `index_members` with `permissions: ['owner']`
13. Backfill: for each existing `user_contacts` row, add the contact as `index_members` of the owner's personal index with `permissions: ['contact']`
14. Backfill: for each contact member, create `intent_indexes` entries linking the contact's active intents to the personal index (using `onConflictDoNothing`)

## Personal Index Lifecycle

### Creation (at registration)

- `ensurePersonalIndex(userId)` replaces `ensureGlobalIndexMembership()`
- Creates personal index if not exists:
  - `title: 'My Network'`
  - `prompt: 'Personal index containing the owner\'s imported contacts for network-scoped discovery.'`
  - `isPersonal: true`
  - `ownerId: userId`
- Adds owner as member with `permissions: ['owner']`
- Uses `onConflictDoNothing()` for idempotence

### Contact import

- When contacts are added via `user_contacts`, also insert into `index_members` for the owner's personal index with `permissions: ['contact']`
- Backfill the contact's active intents into `intent_indexes` for the personal index
- All `intent_indexes` inserts use `onConflictDoNothing()` (safe due to new PK on `intent_indexes`)
- Ghost users created during contact import skip separate index enrollment — the contact-import flow handles adding them to the personal index

### Contact removal

- When a contact is removed from `user_contacts`, also remove their `index_members` row from the personal index (only if permission is `['contact']`)
- Clean up corresponding `intent_indexes` entries for the contact's intents in that personal index

### New intent creation

- When any user creates a new intent, query personal indexes where the user is a `contact` member
- Create `intent_indexes` entries for each matching personal index
- Uses `onConflictDoNothing()` for idempotence (handles race condition with concurrent contact import — both paths may try to insert the same row, the PK constraint makes this benign)

### Startup

- Remove `ensureGlobalIndex()` from `main.ts`
- No startup initialization needed — personal indexes are created per-user at registration

## Discovery & Visibility

### Intent assignment to personal indexes

- **On contact add**: backfill all of the contact's active intents into `intent_indexes` for the owner's personal index
- **On intent create**: auto-assign to every personal index where the intent's user is a `contact` member
- **On contact remove**: clean up `intent_indexes` entries from that personal index

### Opportunity visibility

- **Chat**: scoped to indexes the user has access to. Contacts cannot scope chat to personal indexes they're in — only the owner can.
- **Home feed**: shows opportunities where the user is an actor, regardless of originating index. A contact sees matches from the owner's personal index if the contact is an actor.
- **"Show all" scope**: previously the global index meant "show everything" (skip index filter). After migration, passing no `indexId` (or `indexId = undefined`) means "unscoped / show all." Frontend replaces the global index scope with an unscoped option.

### Access control

- Personal indexes are invisible to non-owners in index listings, chat scope selector, and networks page
- Contact members (`['contact']`) have no operational permissions on the index
- Only the owner can scope discovery to their personal index
- `isPersonalIndexOwner(indexId, userId)` helper for guards
- Personal indexes cannot be edited, deleted, or have members manually managed — enforced at controller level with appropriate error responses

### Membership queries

- `getIndexMemberships(userId)`: currently filters `isGlobal = false`. Replace with: return indexes where `isPersonal = false`, OR where `isPersonal = true AND ownerId = userId`. This ensures contacts don't see personal indexes they're members of, but owners see their own.
- `verifySharedIndex(userA, userB)`: currently falls back to global index. Replace fallback: check if either user's personal index contains the other as a contact member. If User B is a contact in User A's personal index, they share that context.

## Integration Points & Code Changes

### `database.adapter.ts`

- Remove `ensureGlobalIndex()`, `ensureGlobalIndexMembership()`, `getGlobalIndexId()`, `_globalIndexId` cache variable
- Add `ensurePersonalIndex(userId)` — creates personal index + owner membership
- Add `getPersonalIndexId(userId)` — returns the user's personal index ID (no module-level cache — query per user or use short-lived per-request cache)
- Extend contact import to also insert `index_members` (contact permission) and backfill `intent_indexes`
- Extend contact removal to clean up `index_members` and `intent_indexes`
- Remove `isGlobal` skip logic from `getOpportunitiesForUser` — unscoped query uses no `indexId` filter
- Update `getIndexMemberships` filter: replace `isGlobal = false` with personal index owner check (see Membership queries above)
- Update `verifySharedIndex` fallback (see Membership queries above)
- Update ghost user creation (`createGhostUser`, `createGhostUsersBulk`, `importContactsBulk`): remove `getGlobalIndexId()` calls and global index enrollment — contact-import flow handles personal index membership
- Update index listing queries: replace `isGlobal` field selection and ordering with `isPersonal`/`ownerId`. Simplify owner derivation — use `indexes.ownerId` directly instead of joining `index_members` to find the owner permission.

### `main.ts`

- Remove `ensureGlobalIndex()` call at startup

### Auth adapter (`betterauth.ts`)

- Replace `ensureGlobalIndexMembership` callback with `ensurePersonalIndex`

### Intent creation flow (intent service/queue)

- After creating an intent, query personal indexes where the user is a `contact` member
- Create `intent_indexes` entries for each (with `onConflictDoNothing`)

### Opportunity graph (`opportunity.graph.ts`)

- No changes to graph logic — index-scoped search works naturally via `intent_indexes`
- `contactsOnly` flag remains independent

### Frontend

- `networks/page.tsx`: replace `isGlobal` sorting with `isPersonal` styling, filter out others' personal indexes
- `ChatContent.tsx`: replace global index references with personal index references, show "My Network" instead of "Everywhere". Replace global index scope (used as "show all") with unscoped option.
- `indexes.types.ts`: replace `isGlobal?: boolean` with `isPersonal?: boolean`, add `ownerId?: string`

### Index controller/service

- Add guard at controller level: personal indexes cannot be edited, deleted, or have members manually managed. Return 403 with descriptive error.
- Filter personal indexes from other users' listings
