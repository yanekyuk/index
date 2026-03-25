# Contacts Simplification Design

## Problem

Contacts are tracked in two parallel systems: a `user_contacts` table and `index_members` rows with `'contact'` permission on personal indexes. This duplication adds complexity with no benefit. The ghost user claim flow is also unnecessarily complex — creating a new user, transferring all data, then deleting the ghost.

## Design

### Core Primitive: `addContact(email, { restore? })`

Single entry point for all contact creation. Handles both ghost and real users.

```typescript
addContact(
  ownerId: string,
  email: string,
  options?: { name?: string; restore?: boolean }
): Promise<ContactResult>
```

**Flow:**

1. Look up email in `users` table
2. If not found, create ghost user via Better Auth adapter (with `isGhost: true`)
3. Get owner's personal index ID
4. Upsert `index_members` row with `permissions: ['contact']`, `autoAssign: false`
   - If `restore: true` — set `deletedAt = null` (reactivates soft-deleted memberships)
   - If `restore: false` (default) — skip if soft-deleted row exists
5. Side effect: if the contact has a personal index where the owner is soft-deleted, hard-delete that row (clears reverse opt-out)
6. If ghost was newly created, enqueue `ghost.enrich` job
7. Return `{ userId, isNew, isGhost }`

**Callers:**

- `importContacts` — bulk orchestrator, delegates to `addContact` for each valid contact
- `opportunity.service.ts` — on opportunity acceptance, calls `addContact(email, { restore: true })`
- Chat tools — `add_contact`, `import_contacts`

### `importContacts` Changes

Keeps its bulk filtering/dedup responsibilities:

1. Normalize, filter non-human emails, deduplicate
2. Check for soft-deleted ghosts (opted-out contacts — skip them)
3. Bulk resolve existing users by email
4. Bulk create ghosts for unknown emails
5. For each valid contact — call the same adapter method `addContact` uses (upsert `index_members` with `'contact'` permission), batched for performance
6. Enqueue enrichment for newly created ghosts
7. Return `ImportResult`

### Contact Removal

Two deletion paths:

| Action | Type | Restorable by |
|--------|------|---------------|
| `removeContact(ownerId, contactUserId)` — owner removes contact | Hard delete | Re-import or `addContact` |
| Email opt-out — ghost clicks unsubscribe | Soft delete (`deletedAt`) | Only `addContact({ restore: true })` from opportunity acceptance |

Note: `removeContact` signature changes from `(ownerId, contactId)` to `(ownerId, contactUserId)` — no separate contact record ID.

### Contacts Are One-Way

If User B is a contact of User A, it does not make User A a contact of User B.

### Ghost User Simplification

**Ghost creation** — ghosts are created through Better Auth's adapter like normal users, with `isGhost: true`. No separate ghost creation code path.

**Ghost claim on signup** — handled by a custom `create` override in the Drizzle adapter:

```sql
INSERT INTO users (...) VALUES (...)
ON CONFLICT (email) DO UPDATE SET
  isGhost = false,
  name = EXCLUDED.name,
  avatar = EXCLUDED.avatar,
  updatedAt = now()
WHERE users.isGhost = true
RETURNING *
```

- `WHERE users.isGhost = true` ensures only ghosts are upserted, not real users
- `.returning()` gives Better Auth the ghost's original ID
- Session is created for the correct user
- All existing data (index memberships, intents, profiles, HyDE docs) already references that ID — no data transfer needed

**Eliminated:**

- `prepareGhostClaim()`
- `claimGhostUser()`
- `restoreGhostEmail()`
- `pendingGhostClaims` map
- `AuthDbContract` ghost claim methods

### Migration

Single migration that:

1. Deletes all rows referencing ghost user IDs from: `opportunities` (actors), `user_profiles`, `index_members`, `intents`, `intent_indexes`, `hyde_documents`, `chat_sessions`, `chat_messages`, `chat_message_metadata`, `chat_session_metadata`
2. Deletes all ghost user rows (`WHERE isGhost = true`)
3. Drops `user_contacts` table
4. Drops `contactSourceEnum`

## Changes Summary

**Drop:**

- `user_contacts` table (migration)
- `contactSourceEnum` from schema
- `prepareGhostClaim`, `claimGhostUser`, `restoreGhostEmail` from `auth.adapter.ts`
- `pendingGhostClaims` map from `betterauth.ts`
- `AuthDbContract` ghost claim methods
- All existing ghost users and their data (migration)

**Modify:**

- `ContactService` — `addContact(email, { restore? })` as core primitive; `importContacts` delegates to it; `removeContact` hard-deletes `index_members`
- Drizzle adapter for Better Auth — custom `create` for `user` model with `onConflictDoUpdate` on email
- Ghost creation — via Better Auth adapter instead of manual inserts
- `opportunity.service.ts` — calls `addContact(email, { restore: true })` on acceptance
- `UnsubscribeController` — opt-out soft-deletes `index_members` row
- Chat tools (`contact.tools.ts`) — updated signatures
- Integration tools (`integration.tools.ts`) — Gmail import uses updated `importContacts`
- `database.adapter.ts` — remove `user_contacts` methods, add/update `index_members` contact methods

**Tests:**

- `addContact` — creates ghost via Better Auth, adds to personal index
- `addContact` — finds existing real user, adds to personal index
- `addContact({ restore: true })` — restores soft-deleted membership
- `addContact({ restore: false })` — skips soft-deleted membership
- `addContact` — clears reverse opt-out when adding back
- `importContacts` — bulk flow with filtering, dedup, delegation to `addContact`
- Ghost claim via adapter upsert — signup with ghost email reuses ghost row
- Ghost claim — existing data (index memberships, intents, profiles) stays intact
- `removeContact` — hard deletes `index_members` row
- Email opt-out — soft deletes `index_members` row
