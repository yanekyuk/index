# User Socials Table Migration

**Date:** 2026-05-04
**Status:** Draft
**Scope:** Backend schema, adapter, controllers, protocol profile pipeline, frontend

## Problem

User social links are stored as a JSON column (`socials`) on the `users` table. This makes it impossible to add new social platforms without changing a TypeScript interface, conflates known platforms with arbitrary URLs in a single bag, and blocks telegram from participating in the profile pipeline (it's stored but excluded everywhere).

## Solution

Migrate `socials` from a JSON column to a dedicated `user_socials` table. Each row represents one social link. A shared utility auto-detects the platform label from a URL.

## Table Schema

```sql
CREATE TABLE user_socials (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,   -- 'linkedin', 'twitter', 'github', 'telegram', 'custom'
  value      TEXT NOT NULL,   -- URL or handle
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_user_socials_user_id ON user_socials(user_id);
```

No unique constraint on `(user_id, label)` — multiple entries per label are allowed (e.g. multiple `custom` entries).

`label` is `text`, not a Postgres enum. New platforms are added in the application layer without a migration.

### Known Labels

| Label      | Example value          |
|------------|------------------------|
| `linkedin` | `johndoe`              |
| `twitter`  | `johndoe`              |
| `github`   | `johndoe`              |
| `telegram` | `johndoe`              |
| `custom`   | `https://myblog.com`   |

## Migration (0059)

Single migration `0059_migrate_socials_to_table.sql`:

1. Create `user_socials` table with index.
2. For each user with non-null `socials` JSON:
   - Insert a row with `label = 'linkedin'` if `socials->>'linkedin'` exists.
   - Insert a row with `label = 'twitter'` if `socials->>'x'` exists (note: old key is `x`, new label is `twitter`).
   - Insert a row with `label = 'github'` if `socials->>'github'` exists.
   - Insert a row with `label = 'telegram'` if `socials->>'telegram'` exists.
   - For each element in `socials->'websites'` array, insert a row with `label = 'custom'`.
3. Drop the `socials` column from `users`.

## API Shape Change

### Before

```ts
socials: { x?: string; linkedin?: string; github?: string; telegram?: string; websites?: string[] }
```

### After

```ts
socials: Array<{ id: string; userId: string; label: string; value: string }>
```

## Auto-Detection of Label from URL

A shared utility function detects the platform from a URL or handle:

```ts
function detectSocialLabel(value: string): string {
  const url = value.toLowerCase();
  if (url.includes('linkedin.com'))                        return 'linkedin';
  if (url.includes('x.com') || url.includes('twitter.com')) return 'twitter';
  if (url.includes('github.com'))                          return 'github';
  if (url.includes('t.me') || url.includes('telegram.me')) return 'telegram';
  return 'custom';
}
```

This runs in three places:

1. **Frontend** — when the user pastes/types a URL in the "add social" input, auto-selects the label and routes to the dedicated input field if one exists.
2. **Backend adapter** — safety net when persisting. If a caller passes `label: 'custom'` but the value contains `linkedin.com`, it corrects to `linkedin`.
3. **Profile tools / MCP** — when `createUserProfile` receives a URL via `linkedinUrl`, `githubUrl`, `twitterUrl` params, it maps to the correct label. For generic URLs, detection kicks in.

## Adapter Layer Changes

### New Methods

- `getUserSocials(userId: string): Promise<UserSocial[]>` — returns all rows for user.
- `setUserSocials(userId: string, socials: { label: string; value: string }[]): Promise<void>` — replaces all socials (delete + insert in a transaction). Callers must send the complete list, not a diff. Runs `detectSocialLabel` as a safety net on each entry.

### Removed

- `updateUser` no longer accepts or merges a `socials` field. Callers use `setUserSocials` instead.

### Updated

- `findByIds` and other user-returning methods join `user_socials` and return the array shape.
- `findDuplicateUser` queries `user_socials` table instead of JSON operators.

### Helper

A utility function `socialsToEnrichmentRequest(socials: UserSocial[])` converts the array into the flat `{ linkedin?, twitter?, github?, websites? }` shape that the Parallel enrichment API expects. Used by `enrichFromUserRecord` and `autoGenerateNode`.

## Schema Changes

### `database.schema.ts`

- Add `userSocials` table definition.
- Remove `socials` column from `users` table.
- Remove `UserSocials` interface (replaced by the table row type).

### `backend/src/types/users.types.ts`

- Replace `UserSocials` interface with:
  ```ts
  interface UserSocial {
    id: string;
    userId: string;
    label: string;
    value: string;
  }
  ```
- Update `User.socials` to `UserSocial[]`.
- Update `UpdateProfileRequest` to remove `socials` (socials are updated via a separate endpoint or adapter call).

## Files Changed

| Layer | File | Change |
|-------|------|--------|
| Schema | `backend/src/schemas/database.schema.ts` | Add `userSocials` table, remove `socials` from `users`, remove `UserSocials` interface |
| Types | `backend/src/types/users.types.ts` | Replace `UserSocials` with `UserSocial`, update `User`, `UpdateProfileRequest` |
| Migration | `backend/drizzle/0059_migrate_socials_to_table.sql` | Create table, migrate data, drop column |
| Journal | `backend/drizzle/meta/_journal.json` | Add entry for 0059 |
| Adapter | `backend/src/adapters/database.adapter.ts` | Add `getUserSocials`/`setUserSocials`, remove socials merge from `updateUser`, update `findByIds`, update `findDuplicateUser` |
| Auth controller | `backend/src/controllers/auth.controller.ts` | `hasAtLeastOneSocial` reads from array; `updateProfile` delegates socials to `setUserSocials` |
| Profile tools | `packages/protocol/src/profile/profile.tools.ts` | `enrichFromUserRecord` uses `socialsToEnrichmentRequest`; `createUserProfile` persists via `setUserSocials`; socials type annotations updated throughout |
| Profile graph | `packages/protocol/src/profile/profile.graph.ts` | `hasSocials` check, `socialParts` builder, enrichment socials persist — all adapted to array |
| Enrichment interface | `packages/protocol/src/shared/interfaces/enrichment.interface.ts` | No change — enricher request/result stay flat. Conversion happens at adapter boundary. |
| DB seed | `backend/src/cli/db-seed.ts` | Insert socials into `user_socials` table instead of JSON column |
| Parallel enricher | `backend/src/lib/parallel/parallel.ts` | No change — receives flat request, returns flat result |
| Frontend types | Symlinked from `backend/src/types/users.types.ts` | `UserSocial` array replaces `UserSocials` object |
| Frontend settings | `frontend/src/app/settings/page.tsx` | Read/write socials as array; known labels get dedicated inputs, custom gets dynamic add/remove with auto-detection |
| Frontend modal | `frontend/src/components/modals/ProfileSettingsModal.tsx` | Same pattern as settings page |
| Frontend profile | `frontend/src/app/u/[id]/page.tsx` | Render socials from array — known labels get icons, custom gets globe icon |
| Frontend member | `frontend/src/services/networks.ts` | Update `Member.socials` type to array |

## What Does NOT Change

- `EnrichmentRequest` / `EnrichmentResult` interfaces — flat shape stays, conversion at boundary.
- `parallel.ts` enricher — consumes/produces flat shapes.
- Telegram connection/notification prefs (`TelegramPrefs` in `user_notification_settings`) — completely separate concern, untouched.

## Edge Cases

- **Empty socials**: Users with no socials get zero rows. `getUserSocials` returns `[]`.
- **Migration of null socials**: Users with `socials IS NULL` are skipped — no rows inserted.
- **Duplicate detection during migration**: If a user somehow has the same value in both `x` and `websites`, both rows are created — no dedup during migration.
- **Auto-detection override**: If a user explicitly sets `label: 'custom'` for a LinkedIn URL (via API), the backend corrects it to `linkedin`. The frontend prevents this by auto-detecting before submission.
