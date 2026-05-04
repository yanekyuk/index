# User Socials Table Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JSON `socials` column on the `users` table with a dedicated `user_socials` table, add auto-detection of social platform from URLs, and make telegram a first-class social throughout the profile pipeline.

**Architecture:** A single SQL migration creates the new table, copies existing data, and drops the old column. The adapter exposes `getUserSocials`/`setUserSocials` methods. A shared `detectSocialLabel()` utility normalizes labels. All consumers (profile tools, profile graph, auth controller, frontend) switch from the old `{ x?, linkedin?, ... }` object to a `UserSocial[]` array.

**Tech Stack:** PostgreSQL, Drizzle ORM, Bun, TypeScript, React, Vite

**Spec:** `docs/superpowers/specs/2026-05-04-user-socials-table-migration-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `backend/drizzle/0059_migrate_socials_to_table.sql` | SQL migration: create table, copy data, drop column |
| Modify | `backend/drizzle/meta/_journal.json` | Add migration 0059 entry |
| Modify | `backend/src/schemas/database.schema.ts` | Add `userSocials` table, remove `socials` from `users`, remove `UserSocials` interface |
| Modify | `backend/src/types/users.types.ts` | Replace `UserSocials` with `UserSocial`, update `User`, `UpdateProfileRequest` |
| Modify | `packages/protocol/src/shared/interfaces/database.interface.ts` | Replace `UserSocials` with `UserSocial`, update `UserRecord`, `ProfileGraphDatabase`, `UserDatabaseAdapter` interface signatures |
| Create | `packages/protocol/src/shared/utils/social-label.ts` | `detectSocialLabel()` and `socialsToEnrichmentRequest()` utilities |
| Modify | `backend/src/adapters/database.adapter.ts` | Add `getUserSocials`/`setUserSocials`, update `updateUser`, `findDuplicateUser`, `findByIds`, `findWithGraph` |
| Modify | `backend/src/controllers/auth.controller.ts` | Update `hasAtLeastOneSocial`, update `updateProfile` to delegate socials |
| Modify | `backend/src/services/user.service.ts` | Wire through new socials methods |
| Modify | `packages/protocol/src/profile/profile.tools.ts` | Update `enrichFromUserRecord`, `createUserProfile` socials persist, socials type annotations |
| Modify | `packages/protocol/src/profile/profile.graph.ts` | Update `hasSocials`, `socialParts`, enrichment socials persist in `autoGenerateNode` |
| Modify | `backend/src/cli/db-seed.ts` | Insert socials into `user_socials` table |
| Modify | `frontend/src/app/settings/page.tsx` | Read/write socials as array with auto-detection |
| Modify | `frontend/src/components/modals/ProfileSettingsModal.tsx` | Same pattern as settings page |
| Modify | `frontend/src/app/u/[id]/page.tsx` | Render socials from array |
| Modify | `frontend/src/services/networks.ts` | Update `Member.socials` type |

---

### Task 1: Schema, Types, and Migration

**Files:**
- Modify: `backend/src/schemas/database.schema.ts:25-31,62`
- Modify: `backend/src/types/users.types.ts:3-9,24-49`
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts:17-23,66-78,460-491,1342-1346`
- Create: `backend/drizzle/0059_migrate_socials_to_table.sql`
- Modify: `backend/drizzle/meta/_journal.json`

- [ ] **Step 1: Add `userSocials` table to Drizzle schema and remove `socials` column**

In `backend/src/schemas/database.schema.ts`, replace the `UserSocials` interface (lines 25-31) and remove the `socials` column (line 62):

```ts
// DELETE the UserSocials interface (lines 25-31)

// ADD after the users table definition (after line 76):
export const userSocials = pgTable('user_socials', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userSocialsUserIdIdx: index('idx_user_socials_user_id').on(table.userId),
}));
```

Remove line 62 (`socials: json('socials').$type<UserSocials>(),`) from the `users` table definition.

- [ ] **Step 2: Update `backend/src/types/users.types.ts`**

Replace the entire file:

```ts
import { ISODateString, UUID } from './common.types';

export interface UserSocial {
  id: string;
  userId: string;
  label: string;
  value: string;
}

export interface NotificationPreferences {
  connectionUpdates: boolean;
  weeklyNewsletter: boolean;
}

export interface OnboardingState {
  completedAt?: ISODateString | null;
  flow?: 1 | 2 | 3;
  currentStep?: 'profile' | 'summary' | 'connections' | 'create_network' | 'invite_members' | 'join_networks';
  networkId?: UUID | null;
  invitationCode?: string;
}

export interface User {
  id: UUID;
  email: string | null;
  name: string;
  intro: string | null;
  avatar: string | null;
  location?: string | null;
  timezone?: string | null;
  isGhost?: boolean;
  socials: UserSocial[];
  notificationPreferences?: NotificationPreferences;
  onboarding?: OnboardingState;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString | null;
}

export interface UpdateProfileRequest {
  name?: string;
  intro?: string;
  avatar?: string;
  location?: string;
  timezone?: string;
  notificationPreferences?: NotificationPreferences;
}

export interface UserSummary {
  id: UUID;
  name: string;
  avatar: string | null;
}
```

Note: `socials` removed from `UpdateProfileRequest` — socials are updated via a separate adapter call.

- [ ] **Step 3: Update protocol database interface**

In `packages/protocol/src/shared/interfaces/database.interface.ts`:

Replace `UserSocials` interface (lines 17-23) with:

```ts
/** Single social-link row from the user_socials table. */
export interface UserSocial {
  id: string;
  userId: string;
  label: string;
  value: string;
}
```

Update `UserRecord` (lines 66-78) — change `socials` field:

```ts
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  intro?: string | null;
  avatar?: string | null;
  location?: string | null;
  socials: UserSocial[];
  onboarding?: OnboardingState | null;
  isGhost?: boolean;
  deletedAt?: Date | null;
}
```

Update `ProfileGraphDatabase.updateUser` signature (line 472) — remove `socials` from the data param:

```ts
  updateUser(userId: string, data: { name?: string; intro?: string; location?: string; onboarding?: OnboardingState }): Promise<UserRecord | null>;
```

Add new methods to `ProfileGraphDatabase` (after `updateUser`):

```ts
  getUserSocials(userId: string): Promise<UserSocial[]>;
  setUserSocials(userId: string, socials: { label: string; value: string }[]): Promise<void>;
```

Update `findDuplicateUser` signature (line 491) — change `socials` param:

```ts
  findDuplicateUser(userId: string, socials: UserSocial[]): Promise<{ id: string } | null>;
```

Update `UserDatabaseAdapter.updateUser` signature (line 1346) — remove `socials`:

```ts
  updateUser(data: { name?: string; intro?: string; location?: string; onboarding?: OnboardingState }): Promise<UserRecord | null>;
```

Add to `UserDatabaseAdapter` interface (after `updateUser`):

```ts
  getUserSocials(): Promise<UserSocial[]>;
  setUserSocials(socials: { label: string; value: string }[]): Promise<void>;
```

Replace all occurrences of `UserSocials` with `UserSocial` in this file (the old interface name is plural, the new one is singular — representing a single row).

- [ ] **Step 4: Write the SQL migration**

Create `backend/drizzle/0059_migrate_socials_to_table.sql`:

```sql
CREATE TABLE IF NOT EXISTS "user_socials" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "value" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_user_socials_user_id" ON "user_socials" ("user_id");

-- Migrate existing JSON socials to rows
INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT id, 'linkedin', socials->>'linkedin'
FROM "users"
WHERE socials->>'linkedin' IS NOT NULL AND socials->>'linkedin' != '';

INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT id, 'twitter', socials->>'x'
FROM "users"
WHERE socials->>'x' IS NOT NULL AND socials->>'x' != '';

INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT id, 'github', socials->>'github'
FROM "users"
WHERE socials->>'github' IS NOT NULL AND socials->>'github' != '';

INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT id, 'telegram', socials->>'telegram'
FROM "users"
WHERE socials->>'telegram' IS NOT NULL AND socials->>'telegram' != '';

INSERT INTO "user_socials" ("user_id", "label", "value")
SELECT u.id, 'custom', w.value
FROM "users" u,
     jsonb_array_elements_text(u.socials::jsonb->'websites') AS w(value)
WHERE u.socials IS NOT NULL
  AND u.socials::jsonb->'websites' IS NOT NULL
  AND jsonb_array_length(u.socials::jsonb->'websites') > 0;

-- Drop the old column
ALTER TABLE "users" DROP COLUMN IF EXISTS "socials";
```

- [ ] **Step 5: Update `_journal.json`**

Add a new entry to the `entries` array in `backend/drizzle/meta/_journal.json`:

```json
    {
      "idx": 59,
      "version": "7",
      "when": 1746355200000,
      "tag": "0059_migrate_socials_to_table",
      "breakpoints": true
    }
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/schemas/database.schema.ts backend/src/types/users.types.ts packages/protocol/src/shared/interfaces/database.interface.ts backend/drizzle/0059_migrate_socials_to_table.sql backend/drizzle/meta/_journal.json
git commit -m "feat: add user_socials table schema, types, and migration"
```

---

### Task 2: Shared Utilities — `detectSocialLabel` and `socialsToEnrichmentRequest`

**Files:**
- Create: `packages/protocol/src/shared/utils/social-label.ts`
- Create: `packages/protocol/src/shared/utils/tests/social-label.spec.ts`

- [ ] **Step 1: Write failing tests for `detectSocialLabel`**

Create `packages/protocol/src/shared/utils/tests/social-label.spec.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { detectSocialLabel, socialsToEnrichmentRequest } from '../social-label';

describe('detectSocialLabel', () => {
  it('detects linkedin URLs', () => {
    expect(detectSocialLabel('https://linkedin.com/in/johndoe')).toBe('linkedin');
    expect(detectSocialLabel('https://www.linkedin.com/in/johndoe')).toBe('linkedin');
  });

  it('detects twitter/x URLs', () => {
    expect(detectSocialLabel('https://x.com/johndoe')).toBe('twitter');
    expect(detectSocialLabel('https://twitter.com/johndoe')).toBe('twitter');
  });

  it('detects github URLs', () => {
    expect(detectSocialLabel('https://github.com/johndoe')).toBe('twitter');
    // FIX: this should be github — corrected below
  });

  it('detects telegram URLs', () => {
    expect(detectSocialLabel('https://t.me/johndoe')).toBe('telegram');
    expect(detectSocialLabel('https://telegram.me/johndoe')).toBe('telegram');
  });

  it('returns custom for unknown URLs', () => {
    expect(detectSocialLabel('https://myblog.com')).toBe('custom');
    expect(detectSocialLabel('johndoe')).toBe('custom');
  });

  it('is case-insensitive', () => {
    expect(detectSocialLabel('https://LINKEDIN.COM/in/foo')).toBe('linkedin');
    expect(detectSocialLabel('https://GitHub.com/foo')).toBe('github');
  });
});

describe('socialsToEnrichmentRequest', () => {
  it('converts UserSocial[] to flat enrichment shape', () => {
    const socials = [
      { id: '1', userId: 'u1', label: 'linkedin', value: 'johndoe' },
      { id: '2', userId: 'u1', label: 'twitter', value: 'johndoe' },
      { id: '3', userId: 'u1', label: 'github', value: 'johndoe' },
      { id: '4', userId: 'u1', label: 'custom', value: 'https://myblog.com' },
    ];
    const result = socialsToEnrichmentRequest(socials);
    expect(result).toEqual({
      linkedin: 'johndoe',
      twitter: 'johndoe',
      github: 'johndoe',
      websites: ['https://myblog.com'],
    });
  });

  it('returns empty object for empty array', () => {
    expect(socialsToEnrichmentRequest([])).toEqual({});
  });

  it('collects multiple custom entries into websites array', () => {
    const socials = [
      { id: '1', userId: 'u1', label: 'custom', value: 'https://a.com' },
      { id: '2', userId: 'u1', label: 'custom', value: 'https://b.com' },
    ];
    const result = socialsToEnrichmentRequest(socials);
    expect(result).toEqual({ websites: ['https://a.com', 'https://b.com'] });
  });

  it('includes telegram in output', () => {
    const socials = [
      { id: '1', userId: 'u1', label: 'telegram', value: 'johndoe' },
    ];
    const result = socialsToEnrichmentRequest(socials);
    expect(result).toEqual({ telegram: 'johndoe' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/protocol && bun test src/shared/utils/tests/social-label.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the utilities**

Create `packages/protocol/src/shared/utils/social-label.ts`:

```ts
import type { UserSocial } from '../interfaces/database.interface.js';

export function detectSocialLabel(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('x.com') || lower.includes('twitter.com')) return 'twitter';
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('t.me') || lower.includes('telegram.me')) return 'telegram';
  return 'custom';
}

export function socialsToEnrichmentRequest(
  socials: UserSocial[],
): { linkedin?: string; twitter?: string; github?: string; telegram?: string; websites?: string[] } {
  const result: { linkedin?: string; twitter?: string; github?: string; telegram?: string; websites?: string[] } = {};
  for (const s of socials) {
    switch (s.label) {
      case 'linkedin': result.linkedin = s.value; break;
      case 'twitter': result.twitter = s.value; break;
      case 'github': result.github = s.value; break;
      case 'telegram': result.telegram = s.value; break;
      case 'custom': {
        if (!result.websites) result.websites = [];
        result.websites.push(s.value);
        break;
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Fix the test typo and run tests**

Fix the github test case in the spec (line that says `'twitter'` should say `'github'`):

```ts
  it('detects github URLs', () => {
    expect(detectSocialLabel('https://github.com/johndoe')).toBe('github');
  });
```

Run: `cd packages/protocol && bun test src/shared/utils/tests/social-label.spec.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/shared/utils/social-label.ts packages/protocol/src/shared/utils/tests/social-label.spec.ts
git commit -m "feat: add detectSocialLabel and socialsToEnrichmentRequest utilities"
```

---

### Task 3: Database Adapter — `getUserSocials`, `setUserSocials`, update existing methods

**Files:**
- Modify: `backend/src/adapters/database.adapter.ts:960-974,3428-3482,3595-3630,4490-4512,4544-4576,4683-4727`

- [ ] **Step 1: Add imports for `userSocials` table in adapter**

At the top of `backend/src/adapters/database.adapter.ts`, where `users` is imported from schema, also import `userSocials`. Also import `detectSocialLabel` from the protocol utils:

```ts
import { detectSocialLabel } from '@indexnetwork/protocol/shared/utils/social-label';
```

And add `userSocials` to wherever `users` is destructured from `schema` or imported directly.

- [ ] **Step 2: Add `getUserSocials` and `setUserSocials` to `ProfileDatabaseAdapter`**

Add these methods to the `ProfileDatabaseAdapter` class (near the existing `updateUser` method around line 3482):

```ts
  async getUserSocials(userId: string): Promise<Array<{ id: string; userId: string; label: string; value: string }>> {
    const rows = await db.select()
      .from(schema.userSocials)
      .where(eq(schema.userSocials.userId, userId));
    return rows.map(r => ({ id: r.id, userId: r.userId, label: r.label, value: r.value }));
  }

  async setUserSocials(userId: string, socials: { label: string; value: string }[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(schema.userSocials).where(eq(schema.userSocials.userId, userId));
      if (socials.length > 0) {
        await tx.insert(schema.userSocials).values(
          socials
            .filter(s => s.value.trim() !== '')
            .map(s => ({
              userId,
              label: detectSocialLabel(s.value) === 'custom' ? s.label : detectSocialLabel(s.value),
              value: s.value.trim(),
            })),
        );
      }
    });
  }
```

- [ ] **Step 3: Update `ProfileDatabaseAdapter.updateUser` — remove socials**

In `ProfileDatabaseAdapter.updateUser` (line 3433), remove the `socials` parameter and all socials merge logic (lines 3448-3457).

New signature:

```ts
  async updateUser(
    userId: string,
    data: { name?: string; intro?: string; location?: string; onboarding?: OnboardingState }
  ): Promise<{ id: string; name: string; email: string; intro?: string | null; avatar?: string | null; location?: string | null; socials: Array<{ id: string; userId: string; label: string; value: string }>; onboarding?: OnboardingState | null } | null> {
```

Remove the `if (data.socials)` block entirely. After the DB update, fetch and attach socials:

```ts
    const socials = await this.getUserSocials(userId);
    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      intro: updated.intro,
      avatar: updated.avatar,
      location: updated.location,
      socials,
      onboarding: (updated as { onboarding?: unknown }).onboarding as OnboardingState | null,
    };
```

- [ ] **Step 4: Update `ProfileDatabaseAdapter.getUser` — attach socials**

The `getUser` method (around line 960) currently returns the user row which includes `socials` from the JSON column. After the column is dropped, it needs to fetch socials from the new table. Find the `getUser` method and add a socials fetch after the user query:

```ts
  async getUser(userId: string): Promise<UserRecord | null> {
    const result = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const user = result[0];
    if (!user) return null;
    const socials = await this.getUserSocials(userId);
    return { ...user, socials };
  }
```

- [ ] **Step 5: Update `findDuplicateUser` — query `user_socials` table**

Replace the existing `findDuplicateUser` (lines 3604-3630) to query the `user_socials` table instead of JSON operators:

```ts
  async findDuplicateUser(
    userId: string,
    socials: Array<{ id: string; userId: string; label: string; value: string }>,
  ): Promise<{ id: string } | null> {
    const handles = socials
      .filter(s => ['linkedin', 'github', 'twitter'].includes(s.label))
      .map(s => ({ label: s.label, value: s.value.toLowerCase() }));

    if (handles.length === 0) return null;

    const conditions = handles.map(
      (h) => sql`(LOWER(${schema.userSocials.value}) = ${h.value} AND ${schema.userSocials.label} = ${h.label})`,
    );

    const results = await db
      .selectDistinct({ id: schema.userSocials.userId, isGhost: schema.users.isGhost, createdAt: schema.users.createdAt })
      .from(schema.userSocials)
      .innerJoin(schema.users, eq(schema.userSocials.userId, schema.users.id))
      .where(
        and(
          sql`(${sql.join(conditions, sql` OR `)})`,
          not(eq(schema.userSocials.userId, userId)),
          isNull(schema.users.deletedAt),
        ),
      )
      .orderBy(asc(schema.users.isGhost), asc(schema.users.createdAt))
      .limit(1);

    return results[0] ? { id: results[0].id } : null;
  }
```

- [ ] **Step 6: Update the delegate in the top-level adapter class**

Around line 967-974, update the delegate `updateUser` method to match the new signature (no `socials` param). Also add delegate methods for `getUserSocials` and `setUserSocials`:

```ts
  async updateUser(
    userId: string,
    data: { name?: string; intro?: string; location?: string; onboarding?: OnboardingState }
  ) {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.updateUser(userId, data);
  }

  async getUserSocials(userId: string) {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.getUserSocials(userId);
  }

  async setUserSocials(userId: string, socials: { label: string; value: string }[]) {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.setUserSocials(userId, socials);
  }
```

- [ ] **Step 7: Update `UserDatabaseAdapter.findByIds` — join socials**

In `UserDatabaseAdapter.findByIds` (line 4560), replace the simple select with a query that also fetches socials. Since one user can have multiple socials rows, query them separately and merge:

```ts
  async findByIds(userIds: string[]): Promise<Array<{ id: string; name: string; intro: string | null; avatar: string | null; location: string | null; socials: Array<{ id: string; userId: string; label: string; value: string }>; isGhost: boolean; createdAt: Date; updatedAt: Date }>> {
    if (userIds.length === 0) return [];
    const userRows = await db.select({
      id: users.id,
      name: users.name,
      intro: users.intro,
      avatar: users.avatar,
      location: users.location,
      isGhost: users.isGhost,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
      .from(users)
      .where(inArray(users.id, userIds));

    const socialRows = await db.select()
      .from(userSocials)
      .where(inArray(userSocials.userId, userIds));

    const socialsByUser = new Map<string, Array<{ id: string; userId: string; label: string; value: string }>>();
    for (const s of socialRows) {
      const arr = socialsByUser.get(s.userId) ?? [];
      arr.push({ id: s.id, userId: s.userId, label: s.label, value: s.value });
      socialsByUser.set(s.userId, arr);
    }

    return userRows.map(u => ({
      ...u,
      socials: socialsByUser.get(u.id) ?? [],
    }));
  }
```

- [ ] **Step 8: Update `UserWithGraph` interface and `findWithGraph`**

Update the `UserWithGraph` interface (line 4493) — change `socials: unknown` to `socials: Array<{ id: string; userId: string; label: string; value: string }>`.

Update `findWithGraph` (line 4683) to fetch and attach socials:

```ts
  async findWithGraph(userId: string): Promise<UserWithGraph | null> {
    const userResult = await db.select({
      user: users,
      settings: userNotificationSettings,
      profile: userProfiles
    })
      .from(users)
      .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(eq(users.id, userId))
      .limit(1);

    if (userResult.length === 0) {
      return null;
    }

    const { user, settings, profile } = userResult[0];

    const socialRows = await db.select()
      .from(userSocials)
      .where(eq(userSocials.userId, userId));

    return {
      ...user,
      socials: socialRows.map(s => ({ id: s.id, userId: s.userId, label: s.label, value: s.value })),
      profile,
      notificationPreferences: settings?.preferences as {
        connectionUpdates: boolean;
        weeklyNewsletter: boolean;
      } || {
        connectionUpdates: true,
        weeklyNewsletter: true,
      }
    };
  }
```

- [ ] **Step 9: Update `UserDatabaseAdapter.update` method**

The `update` method (line 4717) takes a `Partial<User>` and sets it directly. Since `User` no longer has a `socials` JSON field, the method no longer needs to handle it. Ensure the `data` spread doesn't try to set a `socials` column that no longer exists — callers that previously passed `socials` in this object must be updated. Check all callers of `UserDatabaseAdapter.update` and ensure none pass `socials`.

- [ ] **Step 10: Commit**

```bash
git add backend/src/adapters/database.adapter.ts
git commit -m "feat: add getUserSocials/setUserSocials, update adapter to use user_socials table"
```

---

### Task 4: Auth Controller and User Service

**Files:**
- Modify: `backend/src/controllers/auth.controller.ts:10-30,91-112`
- Modify: `backend/src/services/user.service.ts`

- [ ] **Step 1: Update `hasAtLeastOneSocial` in auth controller**

Replace the function (lines 10-30) in `backend/src/controllers/auth.controller.ts`:

```ts
function hasAtLeastOneSocial(socials: unknown): boolean {
  if (!Array.isArray(socials)) return false;
  return socials.length > 0;
}
```

Remove the old comment about telegram being excluded — it's now included as a first-class social.

- [ ] **Step 2: Update `updateProfile` endpoint**

In `updateProfile` (line 93), extract `socials` from the body and handle it separately:

```ts
  async updateProfile(req: Request, user: AuthenticatedUser) {
    const body = await req.json().catch(() => ({})) as {
      name?: string;
      intro?: string;
      avatar?: string;
      location?: string;
      timezone?: string;
      socials?: Array<{ label: string; value: string }>;
      notificationPreferences?: { connectionUpdates?: boolean; weeklyNewsletter?: boolean };
    };
    const { notificationPreferences, socials, ...userFields } = body;

    if (Object.keys(userFields).length > 0) {
      await userService.update(user.id, userFields);
    }
    if (socials) {
      await userService.setSocials(user.id, socials);
    }
    if (notificationPreferences) {
      await userService.updateNotificationPreferences(user.id, notificationPreferences);
    }

    const fullUser = await userService.findWithGraph(user.id);
    if (!fullUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }
    const { profile: _profileOut, notificationPreferences: prefs, ...userFieldsOut } = fullUser;
    return Response.json({
      user: { ...userFieldsOut, notificationPreferences: prefs },
    });
  }
```

- [ ] **Step 3: Add `setSocials` to user service**

In `backend/src/services/user.service.ts`, add a `setSocials` method that delegates to the adapter:

```ts
  async setSocials(userId: string, socials: { label: string; value: string }[]) {
    return this.db.setSocials(userId, socials);
  }
```

Wire it to the adapter's `setUserSocials`. Check the existing service pattern to match the delegation style (likely `this.db.setUserSocials(userId, socials)`).

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/auth.controller.ts backend/src/services/user.service.ts
git commit -m "feat: update auth controller and user service for user_socials table"
```

---

### Task 5: Profile Tools — `enrichFromUserRecord`, `createUserProfile`, socials persistence

**Files:**
- Modify: `packages/protocol/src/profile/profile.tools.ts:26-35,277-298,330-345`

- [ ] **Step 1: Update `enrichFromUserRecord`**

Replace the function (lines 26-35) to use `socialsToEnrichmentRequest`:

```ts
  async function enrichFromUserRecord(user: { name?: string | null; email?: string | null; socials: Array<{ id: string; userId: string; label: string; value: string }> }) {
    const enrichmentSocials = socialsToEnrichmentRequest(user.socials);
    return enricher.enrichUserProfile({
      name: user.name || undefined,
      email: user.email || undefined,
      linkedin: enrichmentSocials.linkedin || undefined,
      twitter: enrichmentSocials.twitter || undefined,
      github: enrichmentSocials.github || undefined,
      websites: enrichmentSocials.websites?.length ? enrichmentSocials.websites : undefined,
    });
  }
```

Add import at the top:

```ts
import { socialsToEnrichmentRequest, detectSocialLabel } from "../shared/utils/social-label.js";
```

- [ ] **Step 2: Update `createUserProfile` socials persistence (lines 277-298)**

Replace the socials persistence block in `createUserProfile` handler. The current code builds a `socialsUpdate` object and passes it to `userDb.updateUser`. Replace with `userDb.setUserSocials`:

```ts
      const hasSocialsFromQuery = Boolean(linkedinUrl || githubUrl || twitterUrl || websites?.length);
      if (name || location || hasSocialsFromQuery) {
        if (name || location) {
          await userDb.updateUser({
            ...(name ? { name } : {}),
            ...(location ? { location } : {}),
          });
        }
        if (hasSocialsFromQuery) {
          const existingSocials = await userDb.getUserSocials();
          const newSocials: { label: string; value: string }[] = [];
          if (linkedinUrl) newSocials.push({ label: 'linkedin', value: linkedinUrl });
          if (githubUrl) newSocials.push({ label: 'github', value: githubUrl });
          if (twitterUrl) newSocials.push({ label: 'twitter', value: twitterUrl });
          if (websites?.length) {
            for (const w of websites) newSocials.push({ label: detectSocialLabel(w) === 'custom' ? 'custom' : detectSocialLabel(w), value: w });
          }
          // Merge: keep existing socials whose labels aren't being overridden
          const newLabels = new Set(newSocials.map(s => s.label));
          const kept = existingSocials
            .filter(s => !newLabels.has(s.label) || s.label === 'custom')
            .map(s => ({ label: s.label, value: s.value }));
          // For custom, only keep existing ones if we're not adding new custom entries
          const merged = newLabels.has('custom')
            ? [...kept.filter(s => s.label !== 'custom'), ...newSocials]
            : [...kept, ...newSocials];
          await userDb.setUserSocials(merged);
        }
        logger.verbose("Persisted user-info fields to user record", { userId: context.userId });
      }
```

- [ ] **Step 3: Update enrichment socials persistence in preview mode (lines 330-345)**

Replace the block that persists enrichment socials to user record. Instead of updating `userDb.updateUser` with a `socials` object, use `userDb.setUserSocials`:

```ts
              const socials: { label: string; value: string }[] = [];
              if (enrichment.socials.twitter) socials.push({ label: 'twitter', value: enrichment.socials.twitter });
              if (enrichment.socials.linkedin) socials.push({ label: 'linkedin', value: enrichment.socials.linkedin });
              if (enrichment.socials.github) socials.push({ label: 'github', value: enrichment.socials.github });
              if (enrichment.socials.websites?.length) {
                for (const w of enrichment.socials.websites) socials.push({ label: 'custom', value: w });
              }
              if (socials.length > 0) await userDb.setUserSocials(socials);
```

And update the `updatePayload` type to remove `socials`:

```ts
              const updatePayload: {
                name?: string;
                intro?: string;
                location?: string;
              } = {};
```

- [ ] **Step 4: Update all inline socials type annotations**

Search the file for any remaining `{ x?: string; linkedin?: string; github?: string; websites?: string[] }` type annotations and replace them. Remove any references to `socialsUpdate` objects — they're now handled by `setUserSocials`.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/profile/profile.tools.ts
git commit -m "feat: update profile tools to use user_socials table and socialsToEnrichmentRequest"
```

---

### Task 6: Profile Graph — `hasSocials`, `socialParts`, enrichment persist

**Files:**
- Modify: `packages/protocol/src/profile/profile.graph.ts:188-194,309-314,388-391,450-470`

- [ ] **Step 1: Add import**

Add at the top of `packages/protocol/src/profile/profile.graph.ts`:

```ts
import { socialsToEnrichmentRequest } from "../shared/utils/social-label.js";
```

- [ ] **Step 2: Update `hasSocials` check in `checkStateNode` (lines 190-194)**

Replace:

```ts
            const hasSocials = !!(user.socials && (
              user.socials.x ||
              user.socials.linkedin ||
              user.socials.github ||
              (user.socials.websites && user.socials.websites.length > 0)
            ));
```

With:

```ts
            const socials = await this.database.getUserSocials(state.userId);
            const hasSocials = socials.length > 0;
```

- [ ] **Step 3: Update `socialParts` builder in `scrapeNode` (lines 309-314)**

Replace:

```ts
          if (user.socials) {
            if (user.socials.x) socialParts.push(`X/Twitter: ${user.socials.x}`);
            if (user.socials.linkedin) socialParts.push(`LinkedIn: ${user.socials.linkedin}`);
            if (user.socials.github) socialParts.push(`GitHub: ${user.socials.github}`);
            if (user.socials.websites && user.socials.websites.length > 0) {
              user.socials.websites.forEach((url: string) => socialParts.push(`Website: ${url}`));
            }
          }
```

With:

```ts
          const socials = await this.database.getUserSocials(state.userId);
          for (const s of socials) {
            switch (s.label) {
              case 'twitter': socialParts.push(`X/Twitter: ${s.value}`); break;
              case 'linkedin': socialParts.push(`LinkedIn: ${s.value}`); break;
              case 'github': socialParts.push(`GitHub: ${s.value}`); break;
              case 'telegram': socialParts.push(`Telegram: ${s.value}`); break;
              default: socialParts.push(`Website: ${s.value}`); break;
            }
          }
```

- [ ] **Step 4: Update enricher request in `autoGenerateNode` (lines 388-391)**

Replace:

```ts
          const request = {
            name: user.name || undefined,
            email: user.email || undefined,
            linkedin: user.socials?.linkedin || undefined,
            twitter: user.socials?.x || undefined,
            github: user.socials?.github || undefined,
            websites: user.socials?.websites?.length ? user.socials.websites : undefined,
          };
```

With:

```ts
          const socials = await this.database.getUserSocials(state.userId);
          const enrichmentSocials = socialsToEnrichmentRequest(socials);
          const request = {
            name: user.name || undefined,
            email: user.email || undefined,
            linkedin: enrichmentSocials.linkedin || undefined,
            twitter: enrichmentSocials.twitter || undefined,
            github: enrichmentSocials.github || undefined,
            websites: enrichmentSocials.websites?.length ? enrichmentSocials.websites : undefined,
          };
```

- [ ] **Step 5: Update enrichment socials persist in `autoGenerateNode` (lines 450-470)**

Replace the block that builds a `socials` object and passes it in `updatePayload`:

```ts
              // Remove `socials` from updatePayload type
              const updatePayload: {
                name?: string;
                intro?: string;
                location?: string;
              } = {};
```

And after the `updatePayload` is applied, persist socials separately:

```ts
              const newSocials: { label: string; value: string }[] = [];
              if (enrichment!.socials.twitter) newSocials.push({ label: 'twitter', value: enrichment!.socials.twitter });
              if (enrichment!.socials.linkedin) newSocials.push({ label: 'linkedin', value: enrichment!.socials.linkedin });
              if (enrichment!.socials.github) newSocials.push({ label: 'github', value: enrichment!.socials.github });
              if (enrichment!.socials.websites?.length) {
                for (const w of enrichment!.socials.websites) newSocials.push({ label: 'custom', value: w });
              }
              if (newSocials.length > 0) await this.database.setUserSocials(state.userId, newSocials);
```

- [ ] **Step 6: Update post-enrichment dedup call (line 478)**

Replace:

```ts
                const duplicate = await this.database.findDuplicateUser(state.userId, socials);
```

With:

```ts
                const currentSocials = await this.database.getUserSocials(state.userId);
                const duplicate = await this.database.findDuplicateUser(state.userId, currentSocials);
```

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/profile/profile.graph.ts
git commit -m "feat: update profile graph to use user_socials table"
```

---

### Task 7: DB Seed

**Files:**
- Modify: `backend/src/cli/db-seed.ts:206-231`

- [ ] **Step 1: Update `createUser` to insert into `user_socials`**

Replace the `createUser` function (lines 206-231):

```ts
async function createUser(account: SeedAccount): Promise<{ id: string }> {
  const normalizedEmail = account.email.toLowerCase().trim();
  let userId: string;
  try {
    const [user] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        name: account.name,
        intro: `Test account for ${account.name}`,
        onboarding: { completedAt: new Date().toISOString() },
      })
      .returning({ id: users.id });
    userId = user!.id;
  } catch {
    const [byEmail] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${normalizedEmail}`).limit(1);
    if (byEmail) return byEmail;
    throw new Error(`createUser failed for ${normalizedEmail}: insert failed and no existing user found by email`);
  }

  // Insert socials into user_socials table
  const socialRows: { userId: string; label: string; value: string }[] = [];
  if (account.linkedin) socialRows.push({ userId, label: 'linkedin', value: account.linkedin });
  if (account.github) socialRows.push({ userId, label: 'github', value: account.github });
  if (account.x) socialRows.push({ userId, label: 'twitter', value: account.x });
  if (account.website) socialRows.push({ userId, label: 'custom', value: account.website });
  if (socialRows.length > 0) {
    await db.insert(userSocials).values(socialRows);
  }

  return { id: userId };
}
```

Add `userSocials` to the imports from the schema at the top of the file.

- [ ] **Step 2: Commit**

```bash
git add backend/src/cli/db-seed.ts
git commit -m "feat: update db seed to use user_socials table"
```

---

### Task 8: Frontend — Settings Page

**Files:**
- Modify: `frontend/src/app/settings/page.tsx:41-45,77-95,129-163`

- [ ] **Step 1: Update state initialization**

Replace individual social state variables (lines 41-45):

```ts
  const [socialX, setSocialX] = useState("");
  const [socialLinkedin, setSocialLinkedin] = useState("");
  const [socialGithub, setSocialGithub] = useState("");
  const [socialTelegram, setSocialTelegram] = useState("");
  const [websites, setWebsites] = useState<string[]>([]);
```

With a helper that extracts known socials from the array and maintains backwards-compatible state:

```ts
  const [socials, setSocials] = useState<Array<{ label: string; value: string }>>([]);
```

Add a helper to get/set known socials:

```ts
  const getSocial = (label: string) => socials.find(s => s.label === label)?.value ?? '';
  const setSocial = (label: string, value: string) => {
    setSocials(prev => {
      const without = prev.filter(s => s.label !== label);
      return value ? [...without, { label, value }] : without;
    });
    mark();
  };
  const customSocials = socials.filter(s => !['linkedin', 'twitter', 'github', 'telegram'].includes(s.label));
```

- [ ] **Step 2: Update `resetForm`**

Replace lines 83-87:

```ts
    setSocialX(u.socials?.x || "");
    setSocialLinkedin(u.socials?.linkedin || "");
    setSocialGithub(u.socials?.github || "");
    setSocialTelegram(u.socials?.telegram || "");
    setWebsites(u.socials?.websites || []);
```

With:

```ts
    setSocials((u.socials ?? []).map(s => ({ label: s.label, value: s.value })));
```

- [ ] **Step 3: Update `handleSave`**

Replace the socials construction (lines 135-141):

```ts
      const socials = {
        ...(socialX && { x: socialX }),
        ...(socialLinkedin && { linkedin: socialLinkedin }),
        ...(socialGithub && { github: socialGithub }),
        ...(socialTelegram && { telegram: socialTelegram }),
        ...(websites.length > 0 && { websites: websites.filter((w) => w) }),
      };
```

With:

```ts
      const socialsPayload = socials.filter(s => s.value.trim() !== '');
```

And in the `authService.updateProfile` call, replace `socials: Object.keys(socials).length > 0 ? socials : undefined` with `socials: socialsPayload.length > 0 ? socialsPayload : undefined`.

- [ ] **Step 4: Update input bindings in the JSX**

Replace the individual social input bindings. For X/Twitter:

```tsx
value={getSocial('twitter')}
onChange={(e) => setSocial('twitter', e.target.value)}
```

For LinkedIn:

```tsx
value={getSocial('linkedin')}
onChange={(e) => setSocial('linkedin', e.target.value)}
```

For GitHub:

```tsx
value={getSocial('github')}
onChange={(e) => setSocial('github', e.target.value)}
```

For Telegram:

```tsx
value={getSocial('telegram')}
onChange={(e) => setSocial('telegram', e.target.value)}
```

- [ ] **Step 5: Update custom websites section**

Replace the websites map/add/remove logic with custom socials:

```tsx
{customSocials.map((social, index) => (
  <div key={index} className="flex items-center border border-gray-200 rounded-sm hover:border-gray-400 focus-within:border-gray-900 transition-colors duration-150">
    <Input
      value={social.value}
      onChange={(e) => {
        setSocials(prev => {
          const updated = [...prev];
          const customIdx = prev.findIndex((s, i) => s === social);
          if (customIdx >= 0) updated[customIdx] = { label: detectSocialLabel(e.target.value), value: e.target.value };
          return updated;
        });
        mark();
      }}
      placeholder="https://example.com"
      className="flex-1 border-0 hover:border-0 focus:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
    />
    <button
      type="button"
      onClick={() => {
        setSocials(prev => prev.filter(s => s !== social));
        mark();
      }}
      className="px-3 py-2 text-gray-400 hover:text-red-500 transition-colors border-l border-gray-200"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  </div>
))}

{customSocials.length < 3 && (
  <button
    type="button"
    onClick={() => { setSocials(prev => [...prev, { label: 'custom', value: '' }]); mark(); }}
    className="w-full flex items-center justify-center px-3 py-2 border border-gray-200 rounded-sm text-gray-500 hover:border-gray-400 hover:bg-gray-50 transition-colors duration-150 font-ibm-plex-mono text-sm"
  >
    +
  </button>
)}
```

Add the `detectSocialLabel` import. Since this is a frontend file, create a small inline version or import from a shared location. The simplest approach is to duplicate the function in a frontend util:

Create or inline:

```ts
function detectSocialLabel(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('x.com') || lower.includes('twitter.com')) return 'twitter';
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('t.me') || lower.includes('telegram.me')) return 'telegram';
  return 'custom';
}
```

When auto-detection returns a known label, route the value into the known social's input field instead of keeping it as a custom entry.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/settings/page.tsx
git commit -m "feat: update settings page for user_socials array shape"
```

---

### Task 9: Frontend �� Profile Settings Modal

**Files:**
- Modify: `frontend/src/components/modals/ProfileSettingsModal.tsx:69-75,134-151,163-177`

- [ ] **Step 1: Apply the same pattern as Task 8**

Replace individual social state variables (lines 69-75) with a single `socials` array state. Apply the same `getSocial`/`setSocial`/`customSocials` pattern.

Replace `resetForm` (lines 163-177) to use `setSocials(...)`.

Replace `handleSubmit` socials construction (lines 134-151) to send the array.

Replace JSX input bindings for twitter, linkedin, github, telegram to use `getSocial`/`setSocial`.

Replace websites section with custom socials (same as Task 8 step 5).

Add the `detectSocialLabel` inline function (same as Task 8).

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/modals/ProfileSettingsModal.tsx
git commit -m "feat: update profile settings modal for user_socials array shape"
```

---

### Task 10: Frontend — User Profile Page and Member Type

**Files:**
- Modify: `frontend/src/app/u/[id]/page.tsx:139-164`
- Modify: `frontend/src/services/networks.ts:22-28`

- [ ] **Step 1: Update `Member.socials` type**

In `frontend/src/services/networks.ts`, replace lines 22-28:

```ts
  socials?: {
    x?: string;
    linkedin?: string;
    github?: string;
    websites?: string[];
  } | null;
```

With:

```ts
  socials?: Array<{ id: string; userId: string; label: string; value: string }>;
```

- [ ] **Step 2: Update user profile page socials rendering**

Replace the socials rendering block (lines 139-164) in `frontend/src/app/u/[id]/page.tsx`:

```tsx
<div className="flex items-center gap-3">
  {profileData.socials?.filter(s => s.label === 'twitter').map(s => (
    <a key={s.id} href={`https://x.com/${s.value.replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-black transition-colors">
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
    </a>
  ))}
  {profileData.socials?.filter(s => s.label === 'linkedin').map(s => (
    <a key={s.id} href={`https://linkedin.com/in/${s.value}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-black transition-colors">
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
    </a>
  ))}
  {profileData.socials?.filter(s => s.label === 'github').map(s => (
    <a key={s.id} href={`https://github.com/${s.value}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-black transition-colors">
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
    </a>
  ))}
  {profileData.socials?.filter(s => s.label === 'telegram').map(s => (
    <a key={s.id} href={`https://t.me/${s.value}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-black transition-colors">
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
    </a>
  ))}
  {profileData.socials?.filter(s => s.label === 'custom').map(s => (
    <a key={s.id} href={s.value.startsWith('http') ? s.value : `https://${s.value}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-black transition-colors">
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
    </a>
  ))}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/u/[id]/page.tsx frontend/src/services/networks.ts
git commit -m "feat: update user profile page and member type for user_socials array"
```

---

### Task 11: Run Migration and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run the migration**

```bash
cd backend && bun run db:migrate
```

Expected: migration applies cleanly.

- [ ] **Step 2: Verify no pending schema changes**

```bash
cd backend && bun run db:generate
```

Expected: "No schema changes" (or only the snapshot file is generated, no new SQL).

- [ ] **Step 3: Verify the `socials` column is gone**

```bash
cd backend && bun run db:studio
```

Check the `users` table — `socials` column should not exist. Check the `user_socials` table — should have rows migrated from existing data.

- [ ] **Step 4: Run backend tests**

```bash
cd backend && bun test
```

Fix any compilation errors caused by the type changes. The main failures will be test files that reference the old `socials` JSON shape.

- [ ] **Step 5: Start frontend and backend dev servers**

```bash
cd backend && bun run dev
cd frontend && bun run dev
```

Verify:
- Settings page loads, shows existing socials in the correct input fields
- Can add/edit/remove socials
- Save works
- User profile page (`/u/:id`) renders social icons correctly
- Profile settings modal works

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address compilation and test issues from socials migration"
```
