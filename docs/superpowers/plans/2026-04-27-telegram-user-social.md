# Telegram User Social Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `telegram` as a fourth named social link on the user profile, editable via the profile settings modal and rendered on the public profile page, deliberately excluded from Parallel.ai enrichment and from the auto-profile-generation gate.

**Architecture:** `users.socials` is a jsonb column typed by `UserSocials`, so no DB migration is needed. The change threads a single optional field through the type, the partial-merge update path, the modal form, and the public profile renderer. Parallel.ai callers and ghost-dedup matching are intentionally not touched — the `telegram` key never reaches them.

**Tech Stack:** TypeScript, Bun, Drizzle ORM (schema only — no migration), React 19, Vite, Tailwind, Radix UI.

**Spec:** `docs/superpowers/specs/2026-04-27-telegram-user-social-design.md`

---

## File Map

- Modify: `backend/src/types/users.types.ts` — add `telegram` to `UserSocials`.
- Modify: `backend/src/adapters/database.adapter.ts` — extend the partial-merge block in `updateUserProfile` to pass `telegram` through.
- Modify: `frontend/src/components/modals/ProfileSettingsModal.tsx` — add Telegram input with `t.me/` prefix.
- Modify: `frontend/src/app/u/[id]/page.tsx` — render Telegram icon link.

No new files. No tests added (per spec — change follows the established pattern, no tests enumerate fields exhaustively).

---

### Task 1: Add `telegram` to the `UserSocials` type

**Files:**
- Modify: `backend/src/types/users.types.ts`

- [ ] **Step 1: Edit the type**

In `backend/src/types/users.types.ts`, update `UserSocials` from:

```ts
export interface UserSocials {
  x?: string;
  linkedin?: string;
  github?: string;
  websites?: string[];
}
```

to:

```ts
export interface UserSocials {
  x?: string;
  linkedin?: string;
  github?: string;
  telegram?: string;
  websites?: string[];
}
```

- [ ] **Step 2: Type-check the backend**

Run: `cd backend && bunx tsc --noEmit`
Expected: PASS (the new field is optional, no consumers break).

- [ ] **Step 3: Commit**

```bash
git add backend/src/types/users.types.ts
git commit -m "feat(types): add telegram to UserSocials"
```

---

### Task 2: Pass `telegram` through the socials partial-merge

**Files:**
- Modify: `backend/src/adapters/database.adapter.ts:3448-3457`

- [ ] **Step 1: Edit the merge block**

In `backend/src/adapters/database.adapter.ts`, locate the block that currently reads:

```ts
if (data.socials) {
  // Merge with existing socials instead of overwriting
  const existingSocials = current.socials ?? {};
  const merged = { ...existingSocials };
  if (data.socials.x !== undefined) merged.x = data.socials.x;
  if (data.socials.linkedin !== undefined) merged.linkedin = data.socials.linkedin;
  if (data.socials.github !== undefined) merged.github = data.socials.github;
  if (data.socials.websites !== undefined) merged.websites = data.socials.websites;
  updateFields.socials = merged;
}
```

Add a `telegram` line directly after the `github` line so it sits before `websites`:

```ts
if (data.socials) {
  // Merge with existing socials instead of overwriting
  const existingSocials = current.socials ?? {};
  const merged = { ...existingSocials };
  if (data.socials.x !== undefined) merged.x = data.socials.x;
  if (data.socials.linkedin !== undefined) merged.linkedin = data.socials.linkedin;
  if (data.socials.github !== undefined) merged.github = data.socials.github;
  if (data.socials.telegram !== undefined) merged.telegram = data.socials.telegram;
  if (data.socials.websites !== undefined) merged.websites = data.socials.websites;
  updateFields.socials = merged;
}
```

- [ ] **Step 2: Type-check**

Run: `cd backend && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/adapters/database.adapter.ts
git commit -m "feat(profile): merge telegram in socials partial update"
```

---

### Task 3: Add Telegram input to the profile settings modal

**Files:**
- Modify: `frontend/src/components/modals/ProfileSettingsModal.tsx`

- [ ] **Step 1: Add `socialTelegram` state**

After the existing `socialGithub` state declaration (around line 71):

```tsx
const [socialGithub, setSocialGithub] = useState(user?.socials?.github || '');
```

add:

```tsx
const [socialTelegram, setSocialTelegram] = useState(user?.socials?.telegram || '');
```

- [ ] **Step 2: Include `telegram` in the submitted socials object**

In `handleSubmit` (around lines 132-140), update the `socials` object construction from:

```tsx
const socials = {
  ...(socialX && { x: socialX }),
  ...(socialLinkedin && { linkedin: socialLinkedin }),
  ...(socialGithub && { github: socialGithub }),
  ...(websites.length > 0 && {
    websites: websites.filter(w => w)
  })
};
```

to:

```tsx
const socials = {
  ...(socialX && { x: socialX }),
  ...(socialLinkedin && { linkedin: socialLinkedin }),
  ...(socialGithub && { github: socialGithub }),
  ...(socialTelegram && { telegram: socialTelegram }),
  ...(websites.length > 0 && {
    websites: websites.filter(w => w)
  })
};
```

- [ ] **Step 3: Reset `socialTelegram` when the modal opens**

In the modal-open `useEffect` (around lines 161-175), after the line:

```tsx
setSocialGithub(user.socials?.github || '');
```

add:

```tsx
setSocialTelegram(user.socials?.telegram || '');
```

- [ ] **Step 4: Add the Telegram input field**

After the GitHub input block (around lines 322-333), insert a Telegram block matching the existing prefix-input pattern. The GitHub block currently reads:

```tsx
{/* GitHub */}
<div className="flex items-center border border-gray-200 rounded-sm hover:border-gray-400 focus-within:border-gray-900 transition-colors duration-150">
  <div className="px-3 py-2 bg-gray-50 text-gray-500 font-ibm-plex-mono text-sm border-r border-gray-200 whitespace-nowrap select-none">
    github.com/
  </div>
  <Input
    id="socialGithub"
    value={socialGithub}
    onChange={(e) => setSocialGithub(e.target.value)}
    className="flex-1 border-0 hover:border-0 focus:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
  />
</div>
```

Add directly after it:

```tsx
{/* Telegram */}
<div className="flex items-center border border-gray-200 rounded-sm hover:border-gray-400 focus-within:border-gray-900 transition-colors duration-150">
  <div className="px-3 py-2 bg-gray-50 text-gray-500 font-ibm-plex-mono text-sm border-r border-gray-200 whitespace-nowrap select-none">
    t.me/
  </div>
  <Input
    id="socialTelegram"
    value={socialTelegram}
    onChange={(e) => setSocialTelegram(e.target.value)}
    className="flex-1 border-0 hover:border-0 focus:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
  />
</div>
```

- [ ] **Step 5: Type-check the frontend**

Run: `cd frontend && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Lint**

Run: `cd frontend && bun run lint`
Expected: PASS for the modified file.

- [ ] **Step 7: Manual smoke test (optional but recommended)**

Run the dev server (`bun run dev` from the worktree), open Profile Settings, type a handle into the Telegram field, save, reopen — verify the value persists.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/modals/ProfileSettingsModal.tsx
git commit -m "feat(profile-modal): add telegram social input"
```

---

### Task 4: Render Telegram icon on the public profile page

**Files:**
- Modify: `frontend/src/app/u/[id]/page.tsx`

- [ ] **Step 1: Add the Telegram icon link**

In `frontend/src/app/u/[id]/page.tsx`, locate the GitHub icon block (around lines 150-154):

```tsx
{profileData.socials?.github && (
  <a href={`https://github.com/${profileData.socials.github}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-black transition-colors">
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
  </a>
)}
```

Add a Telegram icon block directly after it, before the websites map:

```tsx
{profileData.socials?.telegram && (
  <a href={`https://t.me/${profileData.socials.telegram}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-black transition-colors">
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
  </a>
)}
```

- [ ] **Step 2: Type-check the frontend**

Run: `cd frontend && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `cd frontend && bun run lint`
Expected: PASS for the modified file.

- [ ] **Step 4: Manual smoke test (optional but recommended)**

Visit `/u/<your-id>` after saving a Telegram handle from Task 3 — verify the icon renders and links to `https://t.me/<handle>`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/u/[id]/page.tsx
git commit -m "feat(profile-page): render telegram icon link"
```

---

### Task 5: Final verification

- [ ] **Step 1: Re-run type checks across both workspaces**

Run:

```bash
cd backend && bunx tsc --noEmit
cd ../frontend && bunx tsc --noEmit
```

Expected: PASS in both.

- [ ] **Step 2: Confirm Parallel.ai surface is untouched**

Run: `git diff dev -- backend/src/lib/parallel/parallel.ts backend/src/controllers/auth.controller.ts`
Expected: empty diff (both files intentionally not modified per the spec's "Deliberate Non-Changes" section).

- [ ] **Step 3: Confirm ghost-dedup is untouched**

Run: `git diff dev -- backend/src/adapters/tests/ghost-dedup.spec.ts`
Expected: empty diff.

Also confirm the dedup match block in `database.adapter.ts:3608-3610` was not modified — only the partial-merge block at 3448-3457 was touched. Run:

```bash
grep -n "field: 'telegram'" backend/src/adapters/database.adapter.ts
```

Expected: no match (telegram is intentionally not added to ghost-dedup matching).
