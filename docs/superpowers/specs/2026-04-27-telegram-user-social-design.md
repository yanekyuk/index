# Add Telegram to User Socials

## Summary

Add `telegram` as a fourth named social link on `UserSocials`, alongside `x`, `linkedin`, and `github`. Surface it in the profile settings modal and on the public profile page. Deliberately exclude it from Parallel.ai enrichment and from the auto-profile-generation gate, because Parallel.ai is for public-web research and Telegram is a private contact channel.

This spec ignores the existing Telegram gateway in `backend/src/gateways/telegram.gateway.ts`. The new field is a plain social link with no behavioral coupling.

## Storage

`users.socials` is a `jsonb` column typed by `UserSocials`. No migration needed — jsonb absorbs the new optional field.

Convention: store the bare Telegram username (e.g. `yanekyuksel`), without `@` and without the `t.me/` prefix. Matches how `x`, `linkedin`, and `github` handles are stored.

## Changes

### Backend

**`backend/src/types/users.types.ts`** — add `telegram?: string` to `UserSocials`:

```ts
export interface UserSocials {
  x?: string;
  linkedin?: string;
  github?: string;
  telegram?: string;
  websites?: string[];
}
```

**`backend/src/adapters/database.adapter.ts`** — in the socials merge block (currently lines 3448–3457), add the telegram passthrough:

```ts
if (data.socials.telegram !== undefined) merged.telegram = data.socials.telegram;
```

This preserves the existing merge-don't-overwrite behavior so a partial update with only telegram does not wipe other socials.

### Frontend

**`frontend/src/components/modals/ProfileSettingsModal.tsx`**

- Add `socialTelegram` state initialized from `user?.socials?.telegram`.
- Add a `t.me/` prefixed input below the GitHub field, matching the existing prefix-input pattern.
- Include `telegram: socialTelegram` (when truthy) in the submitted `socials` object.
- Reset `socialTelegram` in the modal-open `useEffect`.

**`frontend/src/app/u/[id]/page.tsx`**

- Render a Telegram icon link when `profileData.socials?.telegram` is set: `<a href={\`https://t.me/${profileData.socials.telegram}\`} ...>` with a Telegram SVG icon, placed alongside the existing X/LinkedIn/GitHub icons.

## Deliberate Non-Changes

These files are intentionally untouched. Document them so future readers (and reviewers) don't think it was an oversight.

**`backend/src/lib/parallel/parallel.ts`** — `ParallelSearchRequestStruct`, `searchUser`, and `enrichUserProfile` do not gain a `telegram` field. Reason: Telegram is a private contact channel; the Parallel.ai pipeline is for public-web profile research. Including it would either leak the handle to Parallel or be ignored.

**`backend/src/controllers/auth.controller.ts:hasAtLeastOneSocial`** — telegram is not added to this disjunction. Reason: this gate (`shouldAutoGenerateProfile`) triggers automatic profile enrichment via Parallel.ai. A user with only a Telegram handle has no enrichable signal, so the gate should remain false in that case.

**`backend/src/adapters/database.adapter.ts:3608-3610`** — telegram is not added to ghost-dedup handle matching. Reason: ghost-dedup matches handles harvested from LinkedIn/GitHub/X imports. Telegram handles do not flow through those import paths, so adding it to the match set would create empty matches at best and false positives at worst.

## Validation

None beyond what other socials have (which is none). Trim whitespace on save like the other inputs do implicitly through React-controlled form state.

## Testing

No new tests required. The existing social-handling tests do not enumerate fields exhaustively; the change follows the established pattern. Affected tests:

- `backend/src/controllers/tests/auth.controller.spec.ts` — only verifies `hasAtLeastOneSocial` for the existing four signals; unchanged.
- `backend/src/adapters/tests/ghost-dedup.spec.ts` — unchanged because telegram is excluded from dedup.
- `backend/src/controllers/tests/profile.controller.spec.ts` — unchanged.

## Out of Scope

- Coupling to the Telegram gateway / bot identity.
- Telegram-handle validation (5–32 chars, `[A-Za-z0-9_]`).
- Editing telegram from any path other than the profile settings modal.
- Importing telegram handles from external sources.
