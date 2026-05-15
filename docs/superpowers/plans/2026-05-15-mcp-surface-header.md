# MCP surface header for connect-link redirects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Linear:** [IND-303](https://linear.app/indexnetwork/issue/IND-303/per-request-surface-header-for-mcp-connect-link-redirects-edgeclaw)
**Spec:** [`docs/superpowers/specs/2026-05-15-mcp-surface-header-design.md`](../specs/2026-05-15-mcp-surface-header-design.md)

**Goal:** Make `/c/{code}` short-link click-time redirects choose between `t.me/{handle}` and the web frontend chat URL based on the receiver's surface (declared by the MCP client via `x-index-surface: telegram | web`), not just the target's Telegram availability. EdgeClaw becomes the only caller that activates the Telegram redirect path.

**Architecture:** Per-request `x-index-surface` header travels through the MCP auth path into a new `clientSurface` field on the per-request `ResolvedToolContext`. Tool handlers thread it into `mintConnectLink`, which persists `preferred_surface` on each `connect_links` row at insert time (and on rotation of expired rows). The click handler reads the column from the resolved row and branches the redirect. Default is `web` — `telegram` is opt-in via the header.

**Tech Stack:** Bun + TypeScript, Drizzle ORM + PostgreSQL, `@indexnetwork/protocol` workspace package (built to `dist/`), MCP SDK with `x-api-key` auth, `bun test` for tests.

---

## File map

**Created:**
- `backend/drizzle/0067_add_connect_link_preferred_surface.sql` — schema migration
- `backend/tests/connect-link.surface.test.ts` — integration tests covering the three click-time branches
- `backend/src/controllers/tests/mcp-surface.test.ts` — unit test for `parseClientSurface`

**Modified — backend:**
- `backend/src/schemas/database.schema.ts` — add `preferredSurface` column on `connectLinks` (line 82-105 region)
- `backend/drizzle/meta/_journal.json` — register migration `0067`
- `backend/src/services/connect-link.service.ts` — `mintConnectLink` accepts/persists/rotates `preferredSurface`; `ResolvedLink` carries it
- `backend/src/controllers/mcp.controller.ts` — `parseClientSurface` helper; `authResolver.resolveIdentity` returns `clientSurface`; adapter forwards `preferredSurface` into `mintConnectLinkSvc`
- `backend/src/controllers/connect-link.controller.ts` — `connect` and `outreach` branch on `link.preferredSurface`

**Modified — protocol (rebuilt on every edit so backend picks up changes):**
- `packages/protocol/src/shared/interfaces/auth.interface.ts` — extend `McpAuthResolver.resolveIdentity` return shape with `clientSurface`
- `packages/protocol/src/shared/interfaces/connect-link.interface.ts` — extend `MintConnectLink` args with `preferredSurface`
- `packages/protocol/src/shared/agent/tool.helpers.ts` — add `clientSurface` to `ResolvedToolContext`
- `packages/protocol/src/mcp/mcp.server.ts` — thread `identity.clientSurface` into `context.clientSurface`
- `packages/protocol/src/opportunity/opportunity.tools.ts` — `attachActionableLinks` accepts/forwards `preferredSurface`; 3 call sites pass `context.clientSurface`
- `packages/protocol/src/shared/agent/tests/tool.factory.spec.ts` — extend existing `mintConnectLink` test to assert forwarding

**Modified — EdgeClaw:**
- `packages/edgeclaw/install/install_index.ts` — write `x-index-surface: telegram` next to `x-api-key`

**Version bumps before merge (per `CLAUDE.md` finishing-a-branch checklist):**
- `packages/protocol/package.json` (npm-published subtree — minor bump because of public interface change)
- `packages/edgeclaw/package.json` (patch bump)

---

## Background notes for the implementing engineer

- **Workspace resolution.** Backend depends on `@indexnetwork/protocol` as `workspace:*` (`backend/package.json:43`). The protocol package exports from `dist/index.js`, not `src/`. **After every edit under `packages/protocol/src/`, you must run `bun run build` in `packages/protocol/` before backend tests will see the change.** Most tasks below include the build step explicitly.
- **`ResolvedToolContext` vs `ToolContext`.** The spec mentions "ToolContext"; the actual runtime per-request context object the tool handlers receive is the type `ResolvedToolContext` in `packages/protocol/src/shared/agent/tool.helpers.ts:47` — that's where `isMcp` and `agentId` already live, and that's the right home for `clientSurface`. The `ToolContext` type (same file, line 86) is the deps shape (carries the `mintConnectLink` function itself, not per-call values).
- **Migration naming.** Drizzle generates random names. After `bun run db:generate`, rename the generated `.sql` file to `0067_add_connect_link_preferred_surface.sql` AND update the matching `tag` field in `drizzle/meta/_journal.json`. Verify by running `bun run db:generate` again — it should report "No schema changes".
- **Test isolation.** `bun test path/to/file.ts` runs a single test file; the full suite is slow. Always target the specific file you are working on.
- **Worktree.** Per `CLAUDE.md`, use a worktree off `dev`. Suggested folder name: `.worktrees/ind-303-mcp-surface-header`; suggested branch: `yanki/ind-303-mcp-surface-header` (matches Linear's auto-suggestion).

---

## Setup: create worktree

- [ ] **Step 1: Create worktree from `dev`**

```bash
cd /Users/aposto/Projects/index
git worktree add .worktrees/ind-303-mcp-surface-header -b yanki/ind-303-mcp-surface-header dev
bun run worktree:setup ind-303-mcp-surface-header
```

Expected: worktree created, `.env` symlinks in place, `bun install` completes.

- [ ] **Step 2: Verify build from clean state**

```bash
cd /Users/aposto/Projects/index/.worktrees/ind-303-mcp-surface-header
cd packages/protocol && bun run build && cd ../..
cd backend && bun run lint && cd ..
```

Expected: protocol builds without errors; lint passes.

All subsequent task steps assume the working directory is the worktree root (`.worktrees/ind-303-mcp-surface-header`) unless otherwise stated.

---

## Task 1: `parseClientSurface` helper + unit test

Pure function with a small surface area. TDD it first because it anchors the rest of the auth-path change.

**Files:**
- Create: `backend/src/controllers/tests/mcp-surface.test.ts`
- Modify: `backend/src/controllers/mcp.controller.ts` (add `parseClientSurface` near the existing `parseApiKeyMetadata` helper around line 169)

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/tests/mcp-surface.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { parseClientSurface } from '../mcp.controller';

describe('parseClientSurface', () => {
  test('returns "web" when header is null', () => {
    expect(parseClientSurface(null)).toBe('web');
  });

  test('returns "web" when header is empty string', () => {
    expect(parseClientSurface('')).toBe('web');
  });

  test('returns "telegram" for canonical lowercase value', () => {
    expect(parseClientSurface('telegram')).toBe('telegram');
  });

  test('returns "telegram" regardless of case', () => {
    expect(parseClientSurface('Telegram')).toBe('telegram');
    expect(parseClientSurface('TELEGRAM')).toBe('telegram');
  });

  test('trims whitespace before matching', () => {
    expect(parseClientSurface('  telegram  ')).toBe('telegram');
    expect(parseClientSurface('\ttelegram\n')).toBe('telegram');
  });

  test('returns "web" for explicit web value', () => {
    expect(parseClientSurface('web')).toBe('web');
    expect(parseClientSurface('WEB')).toBe('web');
  });

  test('coerces unknown values to "web"', () => {
    expect(parseClientSurface('slack')).toBe('web');
    expect(parseClientSurface('foo')).toBe('web');
    expect(parseClientSurface('true')).toBe('web');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd backend
bun test src/controllers/tests/mcp-surface.test.ts
```

Expected: failure with module-not-found / `parseClientSurface is not exported` error.

- [ ] **Step 3: Implement `parseClientSurface` in `mcp.controller.ts`**

Open `backend/src/controllers/mcp.controller.ts`. After the existing `parseApiKeyMetadata` function (around line 169-180), add:

```ts
const seenInvalidSurfaces = new Set<string>();

/**
 * Normalize the `x-index-surface` request header to one of the two values the
 * connect-link click handler understands.
 *
 * Absent or unrecognized values collapse to `'web'` — the new default. Only
 * `'telegram'` activates the t.me redirect path at click time.
 *
 * @param raw - The raw header value (case-insensitive; whitespace-trimmed).
 * @returns `'telegram'` if and only if the trimmed lower-case value is exactly
 *   `'telegram'`; `'web'` otherwise (including for `null`, `''`, and unknowns).
 */
export function parseClientSurface(raw: string | null): 'telegram' | 'web' {
  if (raw === null) return 'web';
  const normalized = raw.trim().toLowerCase();
  if (normalized === '') return 'web';
  if (normalized === 'telegram') return 'telegram';
  if (normalized === 'web') return 'web';
  if (!seenInvalidSurfaces.has(normalized)) {
    seenInvalidSurfaces.add(normalized);
    console.warn(`[mcp] unknown x-index-surface value "${normalized}" — coercing to "web"`);
  }
  return 'web';
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
bun test src/controllers/tests/mcp-surface.test.ts
```

Expected: all 8 cases pass.

- [ ] **Step 5: Type-check the whole controller**

```bash
bunx tsc --noEmit -p .
```

Expected: no errors. (If you see errors unrelated to this change, note them but do not fix here.)

- [ ] **Step 6: Commit**

```bash
git add src/controllers/mcp.controller.ts src/controllers/tests/mcp-surface.test.ts
git commit -m "feat(mcp): parseClientSurface header normalizer + unit tests"
```

---

## Task 2: Schema column + migration

`connect_links.preferred_surface` is the persistence layer for the per-call surface signal.

**Files:**
- Modify: `backend/src/schemas/database.schema.ts` (line 82-105 — `connectLinks` table)
- Create: `backend/drizzle/0067_add_connect_link_preferred_surface.sql`
- Modify: `backend/drizzle/meta/_journal.json`
- Modify: `backend/drizzle/meta/0067_snapshot.json` (auto-generated; keep as-is)

- [ ] **Step 1: Add the column to the schema**

Open `backend/src/schemas/database.schema.ts`. In the `connectLinks` table definition (around line 82), insert `preferredSurface` between `greeting` and `expiresAt`:

```ts
export const connectLinks = pgTable(
  'connect_links',
  {
    code: text('code').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    opportunityId: text('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    greeting: text('greeting'),
    preferredSurface: text('preferred_surface'),  // null = web; 'telegram' activates t.me redirect
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqKindPerRecipient: uniqueIndex('connect_links_kind_recipient_uq').on(
      t.opportunityId,
      t.userId,
      t.kind,
    ),
    idxExpires: index('connect_links_expires_at_idx').on(t.expiresAt),
  }),
);
```

- [ ] **Step 2: Generate the migration**

```bash
cd backend
bun run db:generate
```

Expected: drizzle-kit emits a new file under `backend/drizzle/` with a random name (e.g. `0067_funky_lockjaw.sql`) and updates `drizzle/meta/_journal.json` + `drizzle/meta/0067_snapshot.json`.

Inspect the new `.sql` file — it should be a single `ALTER TABLE "connect_links" ADD COLUMN "preferred_surface" text;` statement.

- [ ] **Step 3: Rename the migration to the canonical name**

```bash
ls drizzle/0067_*.sql
# note the filename, e.g. 0067_funky_lockjaw.sql
mv drizzle/0067_funky_lockjaw.sql drizzle/0067_add_connect_link_preferred_surface.sql
```

Then open `backend/drizzle/meta/_journal.json` and update the entry whose `idx` is 67. Change `"tag": "0067_funky_lockjaw"` to `"tag": "0067_add_connect_link_preferred_surface"`. Do NOT rename `0067_snapshot.json`.

- [ ] **Step 4: Verify the migration is idempotent and the schema is fully captured**

```bash
bun run db:generate
```

Expected: `No schema changes, nothing to migrate`.

- [ ] **Step 5: Apply the migration locally**

```bash
bun run db:migrate
```

Expected: migration applies cleanly. If you have a fresh dev DB, this should succeed without rollback.

- [ ] **Step 6: Smoke-check the column exists**

```bash
bun --print "
import db from './src/lib/drizzle/drizzle';
import { sql } from 'drizzle-orm';
const r = await db.execute(sql\`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'connect_links' AND column_name = 'preferred_surface'\`);
console.log(r.rows);
"
```

Expected: prints `[ { column_name: 'preferred_surface', data_type: 'text' } ]`.

- [ ] **Step 7: Commit**

```bash
git add src/schemas/database.schema.ts drizzle/0067_add_connect_link_preferred_surface.sql drizzle/meta/_journal.json drizzle/meta/0067_snapshot.json
git commit -m "feat(db): add preferred_surface column to connect_links

Nullable text column persists the receiving surface declared at mint time so
the /c/{code} click handler can branch redirects between t.me and the web
frontend. NULL is treated as web."
```

---

## Task 3: `mintConnectLink` service — persist & resolve `preferredSurface`

Extend the service to accept the new arg, persist it on insert, re-stamp it on rotation of expired rows, and return it from `resolveConnectLink`. First-mint-wins for un-expired reuse (matches `greeting` semantics).

**Files:**
- Modify: `backend/src/services/connect-link.service.ts`

- [ ] **Step 1: Extend `MintArgs` and `ResolvedLink` types**

Open `backend/src/services/connect-link.service.ts`. Extend `MintArgs` (line 32) and `ResolvedLink` (line 134):

```ts
export interface MintArgs {
  userId: string;
  opportunityId: string;
  kind: ConnectLinkKind;
  greeting?: string | null;
  preferredSurface?: 'telegram' | 'web' | null;
}
```

```ts
export interface ResolvedLink {
  code: string;
  userId: string;
  opportunityId: string;
  kind: ConnectLinkKind;
  greeting: string | null;
  preferredSurface: 'telegram' | 'web' | null;
}
```

- [ ] **Step 2: Update the function signature and body**

In `mintConnectLink` (line 48), destructure `preferredSurface`:

```ts
export async function mintConnectLink({
  userId,
  opportunityId,
  kind,
  greeting,
  preferredSurface,
}: MintArgs): Promise<{ code: string; greeting: string | null }> {
```

In the **fresh insert** path (line 104-130), add `preferredSurface` to the insert values:

```ts
  // No prior row — fresh insert.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    try {
      const [row] = await db
        .insert(connectLinks)
        .values({
          code,
          userId,
          opportunityId,
          kind,
          greeting: greeting ?? null,
          preferredSurface: preferredSurface ?? null,
          expiresAt,
        })
        .returning();
      return { code: row.code, greeting: row.greeting };
    } catch (err) {
      // ...racing-row recovery unchanged
```

In the **expired-row rotation** path (line 78-101), add `preferredSurface` to the `.set()` payload:

```ts
  if (existing) {
    // Expired row — rotate code + greeting + preferredSurface + expiresAt in place.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateCode();
      try {
        const [row] = await db
          .update(connectLinks)
          .set({
            code,
            greeting: greeting ?? null,
            preferredSurface: preferredSurface ?? null,
            expiresAt,
          })
          .where(
            and(
              eq(connectLinks.opportunityId, opportunityId),
              eq(connectLinks.userId, userId),
              eq(connectLinks.kind, kind),
            ),
          )
          .returning();
        return { code: row.code, greeting: row.greeting };
```

The **idempotent reuse** path (line 72-74) stays unchanged — a still-fresh row returns its existing `code` and `greeting`. First mint wins for surface too; we intentionally do not update an un-expired row's surface.

- [ ] **Step 3: Update `resolveConnectLink` to return `preferredSurface`**

In `resolveConnectLink` (line 148), include the new field in the returned object:

```ts
export async function resolveConnectLink(code: string): Promise<ResolvedLink | null> {
  const [row] = await db
    .select()
    .from(connectLinks)
    .where(and(eq(connectLinks.code, code), gt(connectLinks.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  return {
    code: row.code,
    userId: row.userId,
    opportunityId: row.opportunityId,
    kind: row.kind as ConnectLinkKind,
    greeting: row.greeting,
    preferredSurface: row.preferredSurface as 'telegram' | 'web' | null,
  };
}
```

- [ ] **Step 4: Type-check**

```bash
cd backend
bunx tsc --noEmit -p .
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/connect-link.service.ts
git commit -m "feat(connect-link): persist preferredSurface at mint time

mintConnectLink accepts an optional preferredSurface, writes it on fresh
insert, and re-stamps it on rotation of expired rows. Idempotent reuse of a
still-fresh row preserves the existing surface — first mint wins for the
link's lifetime. resolveConnectLink surfaces the column to callers."
```

---

## Task 4: Click-time branch in `connect-link.controller.ts`

`GET /c/:code/go` reads `link.preferredSurface` and branches the redirect.

**Files:**
- Modify: `backend/src/controllers/connect-link.controller.ts` (line 131-178)

- [ ] **Step 1: Update the `connect` branch (line 144-155)**

Open `backend/src/controllers/connect-link.controller.ts`. Replace the body of the `if (link.kind === 'connect')` block with:

```ts
    if (link.kind === 'connect') {
      const result = await opportunityService.startChat(link.opportunityId, link.userId);
      if ('error' in result) return jsonError(result.error, result.status);

      // Receiver surface determines redirect target. preferredSurface = 'telegram'
      // means the click came from a Telegram-rendering MCP client (EdgeClaw) and
      // we should attempt the t.me deep link. Anything else (including NULL on
      // pre-rollout rows) goes to the web frontend.
      if (link.preferredSurface === 'telegram') {
        const handle = await opportunityService.getCounterpartTelegramHandle(result.counterpartUserId);
        const target = handle
          ? (greeting ? `https://t.me/${handle}?text=${encodeURIComponent(greeting)}` : `https://t.me/${handle}`)
          : (greeting
              ? `${frontendUrl}/u/${result.counterpartUserId}/chat?msg=${encodeURIComponent(greeting)}`
              : `${frontendUrl}/u/${result.counterpartUserId}/chat`);
        return Response.json({ url: target });
      }

      const target = greeting
        ? `${frontendUrl}/u/${result.counterpartUserId}/chat?msg=${encodeURIComponent(greeting)}`
        : `${frontendUrl}/u/${result.counterpartUserId}/chat`;
      return Response.json({ url: target });
    }
```

- [ ] **Step 2: Update the `outreach` branch (line 157-168)**

Replace the body of the `if (link.kind === 'outreach')` block with:

```ts
    if (link.kind === 'outreach') {
      if (link.preferredSurface === 'telegram') {
        const handle = await opportunityService.getCounterpartTelegramHandleForOpp(link.opportunityId, link.userId);
        if (handle) {
          const target = greeting ? `https://t.me/${handle}?text=${encodeURIComponent(greeting)}` : `https://t.me/${handle}`;
          return Response.json({ url: target });
        }
      }
      const conversationId = await opportunityService.getConversationIdForOpp(link.opportunityId, link.userId);
      const target = conversationId
        ? `${frontendUrl}/conversations/${conversationId}${greeting ? `?msg=${encodeURIComponent(greeting)}` : ''}`
        : frontendUrl;
      return Response.json({ url: target });
    }
```

The `approve_introduction` branch (line 170-174) is unchanged.

- [ ] **Step 3: Type-check**

```bash
cd backend
bunx tsc --noEmit -p .
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/controllers/connect-link.controller.ts
git commit -m "feat(connect-link): branch click redirect on link.preferredSurface

Telegram redirect path is gated on the mint-time surface declared by the
calling MCP client. Anything other than preferredSurface='telegram' (the
new default for non-EdgeClaw callers) routes to the web frontend chat URL."
```

---

## Task 5: Integration test for `/c/{code}/go` branching

Three matrices: telegram-surface + target-has-TG → t.me; telegram-surface + no TG → web fallback; web-surface (NULL) + target-has-TG → web (the behavior change).

**Files:**
- Create: `backend/tests/connect-link.surface.test.ts`

- [ ] **Step 1: Inspect existing integration tests to match conventions**

```bash
ls backend/tests/
head -60 backend/tests/$(ls backend/tests/ | head -1)
```

Look at how an existing test bootstraps DB, creates a user, and hits an HTTP route. Mirror that pattern — load `.env` at top, import from `bun:test`, use the live `db` adapter, and either call the controller directly or use the live Bun server.

- [ ] **Step 2: Write the failing integration test**

Create `backend/tests/connect-link.surface.test.ts`. Adapt the bootstrap pieces (DB connection, test user fixture, fixture cleanup) from a nearby integration test; the test logic itself is:

```ts
// Load env before importing app code.
import './setup-env';   // or whatever pattern the other tests use

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import db from '../src/lib/drizzle/drizzle';
import { connectLinks, opportunities, userSocials, users } from '../src/schemas/database.schema';
import { eq } from 'drizzle-orm';
import { mintConnectLink } from '../src/services/connect-link.service';
import { ConnectLinkController } from '../src/controllers/connect-link.controller';

const FRONTEND_URL = process.env.FRONTEND_URL || process.env.APP_URL || 'https://index.network';

describe('GET /c/:code/go — surface-aware redirect', () => {
  const ids: { userId: string; counterpartId: string; opportunityId: string } = {
    userId: '',
    counterpartId: '',
    opportunityId: '',
  };

  beforeAll(async () => {
    // create caller, counterpart, opportunity — adapt to local fixture helpers
    // record IDs on `ids`
  });

  afterAll(async () => {
    // delete fixtures created above
    await db.delete(connectLinks).where(eq(connectLinks.userId, ids.userId));
    await db.delete(opportunities).where(eq(opportunities.id, ids.opportunityId));
    await db.delete(userSocials).where(eq(userSocials.userId, ids.counterpartId));
    await db.delete(users).where(eq(users.id, ids.userId));
    await db.delete(users).where(eq(users.id, ids.counterpartId));
  });

  test('preferredSurface=telegram + target has TG → t.me URL', async () => {
    // Ensure counterpart has a telegram social row
    await db.insert(userSocials).values({
      userId: ids.counterpartId,
      label: 'telegram',
      value: 'counterpart_handle',
    }).onConflictDoNothing();

    const { code } = await mintConnectLink({
      userId: ids.userId,
      opportunityId: ids.opportunityId,
      kind: 'connect',
      preferredSurface: 'telegram',
    });

    const controller = new ConnectLinkController();
    const res = await controller.go(new Request(`http://test/c/${code}/go`), null, { code });
    const body = await (res as Response).json() as { url: string };

    expect(body.url).toMatch(/^https:\/\/t\.me\/counterpart_handle/);
  });

  test('preferredSurface=telegram + target has no TG → web fallback', async () => {
    await db.delete(userSocials).where(eq(userSocials.userId, ids.counterpartId));

    const { code } = await mintConnectLink({
      userId: ids.userId,
      opportunityId: ids.opportunityId,
      kind: 'connect',
      preferredSurface: 'telegram',
    });

    const controller = new ConnectLinkController();
    const res = await controller.go(new Request(`http://test/c/${code}/go`), null, { code });
    const body = await (res as Response).json() as { url: string };

    expect(body.url).toContain(`${FRONTEND_URL}/u/${ids.counterpartId}/chat`);
  });

  test('preferredSurface=null + target has TG → web URL (behavior change)', async () => {
    await db.insert(userSocials).values({
      userId: ids.counterpartId,
      label: 'telegram',
      value: 'counterpart_handle',
    }).onConflictDoNothing();

    const { code } = await mintConnectLink({
      userId: ids.userId,
      opportunityId: ids.opportunityId,
      kind: 'connect',
      // preferredSurface omitted — should persist as NULL
    });

    const controller = new ConnectLinkController();
    const res = await controller.go(new Request(`http://test/c/${code}/go`), null, { code });
    const body = await (res as Response).json() as { url: string };

    expect(body.url).not.toMatch(/^https:\/\/t\.me/);
    expect(body.url).toContain(`${FRONTEND_URL}/u/${ids.counterpartId}/chat`);
  });
});
```

> Notes: between tests the `mintConnectLink` is idempotent for `(opportunityId, userId, kind)` — to mint a *fresh* row with a different surface for the same opportunity you must either delete the prior row or use a different `kind` per test. The cleanest approach is to delete the row by user+opportunity+kind in each test's setup. Adapt the fixtures accordingly.

- [ ] **Step 3: Run the test and verify the failing cases fail for the right reason**

```bash
cd backend
bun test tests/connect-link.surface.test.ts
```

Expected: tests pass if Tasks 2-4 were implemented correctly. If they fail, fix the implementation — do not weaken the test.

- [ ] **Step 4: Commit**

```bash
git add tests/connect-link.surface.test.ts
git commit -m "test(connect-link): integration tests for surface-aware redirect"
```

---

## Task 6: Protocol — extend `McpAuthResolver` return type

The protocol-layer interface for the auth resolver needs to carry `clientSurface` so the MCP server can read it from the identity.

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/auth.interface.ts`

- [ ] **Step 1: Extend the return type**

Open `packages/protocol/src/shared/interfaces/auth.interface.ts`. Replace the `resolveIdentity` declaration with:

```ts
  /**
   * Extracts and validates the authenticated identity from the request.
   *
   * @param request - The incoming HTTP request
   * @returns The authenticated user's UUID, optional agent UUID, auth method,
   *   `networkScopeId` if the caller's API key is bound to a network-scoped
   *   agent, and `clientSurface` declaring which kind of UI is rendering the
   *   MCP response (drives connect-link redirect choice at click time).
   *
   *   When `networkScopeId` is set, the MCP server clamps `indexScope` to that
   *   single network plus the user's personal index — every downstream tool
   *   then operates against that clamped scope.
   *
   *   `isSessionAuth` is true for OAuth/JWT bearer sessions — the agent-
   *   registration gate in the MCP server is skipped for these callers.
   *
   *   `clientSurface` is read from the `x-index-surface` request header by the
   *   backend implementation. Absent or unknown values collapse to `'web'`.
   *   Only `'telegram'` activates the t.me redirect path on `/c/{code}` clicks.
   *
   * @throws Error if authentication fails (no token, invalid token, etc.)
   */
  resolveIdentity(request: Request): Promise<{
    userId: string;
    agentId?: string;
    isSessionAuth?: boolean;
    networkScopeId?: string | null;
    clientSurface?: 'telegram' | 'web';
  }>;
```

- [ ] **Step 2: Rebuild the protocol package**

```bash
cd packages/protocol
bun run build
```

Expected: no errors. (Errors at this point would be unrelated downstream type issues — fix them only if directly caused by this change.)

- [ ] **Step 3: Commit**

```bash
cd ../..
git add packages/protocol/src/shared/interfaces/auth.interface.ts
git commit -m "feat(protocol): add clientSurface to McpAuthResolver identity

Optional 'telegram' | 'web' field declares the receiver's rendering surface.
Backend reads it from the x-index-surface request header. Absent in legacy
implementations — treated as 'web' downstream."
```

---

## Task 7: Protocol — extend `MintConnectLink` interface

The interface that protocol tools call to mint connect links.

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/connect-link.interface.ts`

- [ ] **Step 1: Extend the call signature**

Open `packages/protocol/src/shared/interfaces/connect-link.interface.ts`. Replace the interface with:

```ts
/**
 * Kind of connect link being minted. Determines the action endpoint the short
 * URL eventually redirects to (per-status: pending+introducer ->
 * approve_introduction, accepted -> outreach, otherwise -> connect).
 */
export type ConnectLinkKind = 'connect' | 'approve_introduction' | 'outreach';

/**
 * Mints (or reuses) a short link for the given recipient and kind, snapshotting
 * the greeting and the caller's preferred surface onto the link record. Returns
 * the full public URL.
 *
 * `preferredSurface` is stamped onto the row at insert time and drives the
 * click-time redirect on `/c/{code}/go`: only `'telegram'` activates the t.me
 * deep-link path; everything else (including `undefined`, persisted as NULL)
 * routes to the web frontend chat URL.
 */
export interface MintConnectLink {
  (args: {
    userId: string;
    opportunityId: string;
    kind: ConnectLinkKind;
    greeting?: string | null;
    preferredSurface?: 'telegram' | 'web';
  }): Promise<{ url: string }>;
}
```

- [ ] **Step 2: Rebuild the protocol package**

```bash
cd packages/protocol
bun run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ../..
git add packages/protocol/src/shared/interfaces/connect-link.interface.ts
git commit -m "feat(protocol): add preferredSurface to MintConnectLink args"
```

---

## Task 8: Protocol — add `clientSurface` to `ResolvedToolContext`

The per-request context object that tool handlers receive needs to carry the surface so call sites can forward it.

**Files:**
- Modify: `packages/protocol/src/shared/agent/tool.helpers.ts` (around line 73-76)

- [ ] **Step 1: Extend `ResolvedToolContext`**

Open `packages/protocol/src/shared/agent/tool.helpers.ts`. In the `ResolvedToolContext` interface (line 47-77), after the `agentId?: string;` line, add:

```ts
  /** Agent ID when the request originates from an API key linked to an agent. */
  agentId?: string;
  /**
   * Receiver's rendering surface declared by the MCP client via the
   * `x-index-surface` request header. `'telegram'` means the MCP response is
   * being rendered inside a Telegram chat (today, only EdgeClaw); anything
   * else (including `undefined`) is treated as web. Forwarded into
   * `mintConnectLink` so the click-time redirect can branch.
   */
  clientSurface?: 'telegram' | 'web';
}
```

- [ ] **Step 2: Rebuild the protocol package**

```bash
cd packages/protocol
bun run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ../..
git add packages/protocol/src/shared/agent/tool.helpers.ts
git commit -m "feat(protocol): add clientSurface to ResolvedToolContext"
```

---

## Task 9: Protocol — thread `clientSurface` from identity into context in `mcp.server.ts`

**Files:**
- Modify: `packages/protocol/src/mcp/mcp.server.ts` (around line 284-298)

- [ ] **Step 1: Destructure `clientSurface` from the identity and stamp it on the context**

Open `packages/protocol/src/mcp/mcp.server.ts`. Find the block around line 284:

```ts
          const { userId, agentId, isSessionAuth, networkScopeId } = await authResolver.resolveIdentity(httpReq);

          // Resolve chat context for the user (mark as MCP — no interactive UI available)
          const context = await resolveChatContext({ database: deps.database, userId });
          context.isMcp = true;
          if (agentId) {
            context.agentId = agentId;
          }
```

Replace with:

```ts
          const { userId, agentId, isSessionAuth, networkScopeId, clientSurface } = await authResolver.resolveIdentity(httpReq);

          // Resolve chat context for the user (mark as MCP — no interactive UI available)
          const context = await resolveChatContext({ database: deps.database, userId });
          context.isMcp = true;
          if (agentId) {
            context.agentId = agentId;
          }
          if (clientSurface) {
            context.clientSurface = clientSurface;
          }
```

- [ ] **Step 2: Rebuild the protocol package**

```bash
cd packages/protocol
bun run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ../..
git add packages/protocol/src/mcp/mcp.server.ts
git commit -m "feat(protocol): thread clientSurface from identity into ToolContext"
```

---

## Task 10: Protocol — `attachActionableLinks` forwards `preferredSurface`

Three call sites pass `context.clientSurface` through.

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.tools.ts` (line 92-145, 751-764, 1037-1054, 1326-1341)

- [ ] **Step 1: Update `attachActionableLinks` to accept and forward `preferredSurface`**

Open `packages/protocol/src/opportunity/opportunity.tools.ts`. In `attachActionableLinks` (line 92), extend `opts`:

```ts
export async function attachActionableLinks(
  card: Record<string, unknown> & {
    opportunityId: string;
    viewerRole: string;
    status: string;
  },
  opts: {
    viewerId: string;
    viewerApproved?: boolean;
    counterpartUser:
      | { socials?: Array<{ label?: string | null; value?: string | null }> | null }
      | null
      | undefined;
    counterpartUserId: string;
    mintConnectLink: NonNullable<ToolDeps["mintConnectLink"]>;
    frontendUrl: string | undefined;
    preferredSurface?: 'telegram' | 'web';
  },
): Promise<void> {
```

Forward it in the `mintConnectLink` call (line 125):

```ts
  try {
    const { url } = await opts.mintConnectLink({
      userId: opts.viewerId,
      opportunityId: card.opportunityId,
      kind,
      greeting: null,
      preferredSurface: opts.preferredSurface,
    });
```

- [ ] **Step 2: Update the three call sites to pass `context.clientSurface`**

**Call site 1 — line 751-764.** Change:

```ts
        if (context.isMcp && deps.mintConnectLink) {
          await attachActionableLinks(cardData as Record<string, unknown> & {
            opportunityId: string;
            viewerRole: string;
            status: string;
          }, {
            viewerId: context.userId,
            viewerApproved: false,
            counterpartUser,
            counterpartUserId: firstPartyId,
            mintConnectLink: deps.mintConnectLink,
            frontendUrl: deps.frontendUrl,
            preferredSurface: context.clientSurface,
          });
        }
```

**Call site 2 — line 1037-1052.** Find the block and add `preferredSurface: context.clientSurface,` inside the `opts` object passed to `attachActionableLinks`. (The block iterates per-card via `Promise.all`; preserve the `mintConnectLink = deps.mintConnectLink;` capture line so closure semantics are unchanged.)

**Call site 3 — line 1326-1341.** Same — add `preferredSurface: context.clientSurface,` to the `opts` object.

Read each call site fully before editing — the `await attachActionableLinks(...)` call structure should be obvious; the only change is the new prop.

- [ ] **Step 3: Rebuild the protocol package**

```bash
cd packages/protocol
bun run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add packages/protocol/src/opportunity/opportunity.tools.ts
git commit -m "feat(protocol): forward clientSurface into mintConnectLink calls"
```

---

## Task 11: Protocol — extend `tool.factory.spec.ts` to assert surface forwarding

The existing test at `tool.factory.spec.ts:2004` (`"invokes deps.mintConnectLink and surfaces the returned URL as acceptUrl"`) confirms the mint function is called. Extend it to also assert `preferredSurface` is forwarded when set on the context.

**Files:**
- Modify: `packages/protocol/src/shared/agent/tests/tool.factory.spec.ts`

- [ ] **Step 1: Read the existing test to understand the fixture shape**

```bash
sed -n '2000,2050p' packages/protocol/src/shared/agent/tests/tool.factory.spec.ts
```

The test invokes `mintConnectLink` via the tool registry. Note how the captured call args are shaped — you will assert the new field on the same captured args.

- [ ] **Step 2: Add a new test below the existing one**

In `tool.factory.spec.ts` immediately after the existing `"invokes deps.mintConnectLink..."` test (around line 2040), add:

```ts
  test("forwards preferredSurface from context.clientSurface into mintConnectLink", async () => {
    let captured: { preferredSurface?: 'telegram' | 'web' } | null = null;
    const mintConnectLink = async (args: {
      userId: string;
      opportunityId: string;
      kind: string;
      greeting?: string | null;
      preferredSurface?: 'telegram' | 'web';
    }) => {
      captured = args;
      return { url: 'https://test/c/ABC1234567' };
    };

    // Reuse the same fixture shape as the test directly above this one,
    // but set context.clientSurface = 'telegram' before invoking the tool.
    // ... (adapt fixture setup from the existing test)

    expect(captured).not.toBeNull();
    expect(captured!.preferredSurface).toBe('telegram');
  });
```

Adapt the fixture setup to match the existing test's invocation pattern — the key delta is setting `context.clientSurface = 'telegram'` on the resolved context before invoking the tool.

- [ ] **Step 3: Run the test**

```bash
cd packages/protocol
bun test src/shared/agent/tests/tool.factory.spec.ts
```

Expected: existing tests still pass; the new test passes.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add packages/protocol/src/shared/agent/tests/tool.factory.spec.ts
git commit -m "test(protocol): assert clientSurface flows into mintConnectLink args"
```

---

## Task 12: Backend — wire `parseClientSurface` into `authResolver` and forward to `mintConnectLinkSvc`

This is the integration point: backend reads the header, returns `clientSurface` from `resolveIdentity`, and the inline `mintConnectLink` adapter passes `preferredSurface` to the service from Task 3.

**Files:**
- Modify: `backend/src/controllers/mcp.controller.ts`

- [ ] **Step 1: Update the inline `mintConnectLink` adapter (line 62-72)**

Open `backend/src/controllers/mcp.controller.ts`. Find the inline adapter:

```ts
const mintConnectLink = async ({ userId, opportunityId, kind, greeting }: {
  userId: string;
  opportunityId: string;
  kind: ConnectLinkKind;
  greeting?: string | null;
}): Promise<{ url: string }> => {
  const { code } = await mintConnectLinkSvc({ userId, opportunityId, kind, greeting });
  return { url: buildConnectShortUrl(BASE_URL, code) };
};
```

Replace with:

```ts
const mintConnectLink = async ({ userId, opportunityId, kind, greeting, preferredSurface }: {
  userId: string;
  opportunityId: string;
  kind: ConnectLinkKind;
  greeting?: string | null;
  preferredSurface?: 'telegram' | 'web';
}): Promise<{ url: string }> => {
  const { code } = await mintConnectLinkSvc({ userId, opportunityId, kind, greeting, preferredSurface });
  return { url: buildConnectShortUrl(BASE_URL, code) };
};
```

- [ ] **Step 2: Read the header at the top of `authResolver.resolveIdentity` and return `clientSurface` on every success path**

In `authResolver.resolveIdentity` (around line 183), capture the header value at the top of the function:

```ts
  async resolveIdentity(request: Request): Promise<{ userId: string; agentId?: string; isSessionAuth?: boolean; networkScopeId?: string | null; clientSurface?: 'telegram' | 'web' }> {
    const clientSurface = parseClientSurface(request.headers.get('x-index-surface'));

    // ...existing bearer-token branch...
```

Then in **every** `return { ... }` that yields a successful identity — there are four of them — add `clientSurface` to the returned object:

- Line ~197 (JWT bearer with `payload.id`):
  ```ts
  if (typeof payload.id === 'string') return { userId: payload.id, isSessionAuth: true, networkScopeId: null, clientSurface };
  ```
- Line ~198 (JWT bearer with `payload.sub`):
  ```ts
  if (typeof payload.sub === 'string') return { userId: payload.sub, isSessionAuth: true, networkScopeId: null, clientSurface };
  ```
- Line ~217 (session lookup success):
  ```ts
  if (data?.userId) return { userId: data.userId, isSessionAuth: true, networkScopeId: null, clientSurface };
  ```
- Line ~279-283 (API-key path with valid row):
  ```ts
  return {
    userId,
    ...(metadata.agentId ? { agentId: metadata.agentId } : {}),
    networkScopeId,
    clientSurface,
  };
  ```
- Line ~288 (fallback to `sessionUserId` after API-key DB miss):
  ```ts
  return { userId: sessionUserId, networkScopeId: null, clientSurface };
  ```

- [ ] **Step 3: Update the `resolveIdentity` return type at the protocol interface implementation site**

The interface from Task 6 now requires `clientSurface?`. Confirm `authResolver` still satisfies `McpAuthResolver` by running tsc:

```bash
cd backend
bunx tsc --noEmit -p .
```

Expected: no errors. Common failure mode is a missing `clientSurface` on one of the success paths — fix any that you missed.

- [ ] **Step 4: Smoke-test the wire path end to end**

Start the backend dev server in one terminal:

```bash
cd backend
bun run dev
```

In another terminal, with a valid API key in `$API_KEY` (e.g. one from your local dev DB):

```bash
curl -s -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "x-index-surface: telegram" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -50
```

Expected: response includes a list of tools (no auth error). The header is non-load-bearing for `tools/list`, but this confirms the request is accepted with the new header present.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/mcp.controller.ts
git commit -m "feat(mcp): plumb x-index-surface header through auth identity

authResolver.resolveIdentity reads x-index-surface, normalizes via
parseClientSurface, and returns clientSurface on every success path. The
inline mintConnectLink adapter forwards preferredSurface to
mintConnectLinkSvc so the connect_links row is stamped at mint time."
```

---

## Task 13: EdgeClaw — declare the surface header at install time

The entire EdgeClaw change is one extra header entry.

**Files:**
- Modify: `packages/edgeclaw/install/install_index.ts` (line 43-53)

- [ ] **Step 1: Update `writeMcpServerEntry`**

Open `packages/edgeclaw/install/install_index.ts`. Replace `writeMcpServerEntry`:

```ts
function writeMcpServerEntry(apiKey: string): void {
  const mcpEntry = JSON.stringify({
    url: PROTOCOL_MCP_URL,
    transport: "streamable-http",
    headers: {
      "x-api-key": apiKey,
      "x-index-surface": "telegram",
    },
  });
  console.log("→ writing mcp.servers.index");
  execSync(`openclaw config set mcp.servers.index '${mcpEntry}' --strict-json`, {
    stdio: ["ignore", "ignore", "inherit"],
  });
}
```

- [ ] **Step 2: Type-check the package**

```bash
cd packages/edgeclaw
bunx tsc --noEmit -p . 2>/dev/null || true
```

Expected: no errors (or this package has no tsconfig — skip with no concern).

- [ ] **Step 3: Commit**

```bash
cd ../..
git add packages/edgeclaw/install/install_index.ts
git commit -m "feat(edgeclaw): declare x-index-surface: telegram in MCP entry"
```

---

## Task 14: Version bumps + finishing checks

Per `CLAUDE.md` finishing-a-branch checklist.

- [ ] **Step 1: Bump `@indexnetwork/protocol` version**

Public-interface changes (`McpAuthResolver`, `MintConnectLink`, `ResolvedToolContext`) are additive and optional — minor bump.

```bash
cd packages/protocol
# current: 0.30.8 → 0.31.0
bun --print "
import { readFileSync, writeFileSync } from 'fs';
const p = JSON.parse(readFileSync('package.json', 'utf8'));
const [maj, min] = p.version.split('.').map(Number);
p.version = \`\${maj}.\${min + 1}.0\`;
writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
console.log('Bumped protocol →', p.version);
"
```

- [ ] **Step 2: Bump `packages/edgeclaw/package.json`**

Patch bump (consumer change only, no public-interface change).

```bash
cd ../edgeclaw
bun --print "
import { readFileSync, writeFileSync } from 'fs';
const p = JSON.parse(readFileSync('package.json', 'utf8'));
const [maj, min, patch] = p.version.split('.').map(Number);
p.version = \`\${maj}.\${min}.\${patch + 1}\`;
writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
console.log('Bumped edgeclaw →', p.version);
"
cd ../..
```

- [ ] **Step 3: Run protocol tests + lint**

```bash
cd packages/protocol
bun test src/shared/agent/tests/tool.factory.spec.ts
cd ../..
```

Expected: all pass (including the new test from Task 11).

- [ ] **Step 4: Run backend tests for the affected files**

```bash
cd backend
bun test src/controllers/tests/mcp-surface.test.ts
bun test tests/connect-link.surface.test.ts
bun run lint
cd ..
```

Expected: all pass; lint clean.

- [ ] **Step 5: Final type-check both packages**

```bash
cd backend && bunx tsc --noEmit -p . && cd ..
cd packages/protocol && bunx tsc --noEmit -p . && cd ../..
```

Expected: no errors.

- [ ] **Step 6: Commit version bumps**

```bash
git add packages/protocol/package.json packages/edgeclaw/package.json
git commit -m "chore(release): bump protocol→0.31.0, edgeclaw patch"
```

- [ ] **Step 7: Push branch and open PR**

```bash
git push -u origin yanki/ind-303-mcp-surface-header
gh pr create --title "feat(mcp): per-request surface header for connect-link redirects (IND-303)" --body "$(cat <<'EOF'
## Summary

- New per-request `x-index-surface: telegram | web` MCP header. Absent or unknown → `web` (the new default).
- `connect_links.preferred_surface` persisted at mint time; rotated on expired-row rotation; first mint wins for un-expired reuse.
- `/c/{code}/go` click handler branches `connect` and `outreach` kinds on the persisted surface.
- EdgeClaw declares `x-index-surface: telegram` in `install_index.ts`. No other client wired in this slice.

## Behavior change

Non-EdgeClaw callers currently receive a `t.me/...` URL whenever the target has a Telegram handle. After this ships, they receive the web frontend chat URL instead. This is the deliberate strict reading of "Telegram redirect happens only when the receiver is on Telegram."

Pre-rollout `connect_links` rows have `preferred_surface = NULL` and now redirect to web. Acceptable trade-off given the 30-day TTL.

## Test plan

- [ ] `cd backend && bun test src/controllers/tests/mcp-surface.test.ts` — parseClientSurface unit tests
- [ ] `cd backend && bun test tests/connect-link.surface.test.ts` — three click-time matrices
- [ ] `cd packages/protocol && bun test src/shared/agent/tests/tool.factory.spec.ts` — surface forwarding through tool factory
- [ ] Local smoke: start dev server, hit MCP with `x-index-surface: telegram` and confirm a minted link's `connect_links.preferred_surface = 'telegram'` in the DB

## Linear

Closes IND-303.

## Files

Spec: `docs/superpowers/specs/2026-05-15-mcp-surface-header-design.md`
EOF
)"
```

- [ ] **Step 8: Request a Copilot review**

```bash
gh pr edit $(gh pr view --json number -q .number) --add-reviewer @copilot
```

---

## Cleanup after merge

(Per `CLAUDE.md` finishing-a-branch step 7.) After PR merge into `dev`:

- [ ] Delete the Linear-suggested branch locally and remotely: `git branch -D yanki/ind-303-mcp-surface-header && git push origin --delete yanki/ind-303-mcp-surface-header`
- [ ] Remove the worktree: `git worktree remove .worktrees/ind-303-mcp-surface-header`
- [ ] Delete `docs/superpowers/plans/2026-05-15-mcp-surface-header.md` and `docs/superpowers/specs/2026-05-15-mcp-surface-header-design.md` (per the finishing-a-branch checklist: delete superpowers plans/specs after the branch ships).
