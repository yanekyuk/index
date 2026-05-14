# Per-request surface header for MCP connect-link redirects

**Linear:** [IND-303](https://linear.app/indexnetwork/issue/IND-303/per-request-surface-header-for-mcp-connect-link-redirects-edgeclaw)
**Date:** 2026-05-15
**Status:** Approved — ready for implementation plan

## Goal

Make the `/c/{code}` short-link click handler choose between a `t.me/{handle}` redirect and a web frontend chat URL based on the **receiver's surface**, not only the target's Telegram availability. EdgeClaw — today the only Telegram-rendering surface — must be able to signal "I am Telegram" to the server. Every other caller (Claude Desktop, web, CLI) is treated as web.

## Why

The current click handler in `backend/src/controllers/connect-link.controller.ts:144-168` chooses redirect target purely on whether the **target** user has a Telegram handle (`user_socials.label='telegram'`). It never considers where the receiver is reading the URL. Result: a user on the web app or Claude Desktop clicks a connect link and is bounced into a Telegram deep link they may not want. The Telegram redirect is only useful when the receiver is itself on Telegram, which today means EdgeClaw.

## Why not the alternatives

- **Bake the decision into the URL form returned by MCP** (i.e. MCP returns `t.me/{handle}` directly instead of `/c/{code}` for EdgeClaw callers). Rejected — it forces eager greeting generation and eager opportunity acceptance inside the MCP tool call, both of which today happen lazily at click time on `/c/:code/go` (greeting via `getGreetingForCard`, accept via `startChat`). The interstitial loader exists specifically to absorb the 20s-tail LLM greeting call. We would lose that buffer.
- **Stamp the surface on the agent or API key metadata.** Rejected — API keys are user-minted via the web account and pasted into EdgeClaw; EdgeClaw cannot write server-side metadata without an extra registration call. Per-request is also more correct: the receiving surface follows the call, not the agent identity.
- **Promote surface to `agent_transports.channel='telegram'`.** Rejected — the transports concept models *how the server reaches the agent*; this is *how the user sees URLs the server hands back*, a different axis. Schema migration, enum widening, and a registration call are out of proportion to the use case.

## Wire contract

New per-request header on MCP calls:

```
x-index-surface: telegram | web
```

- Absent → treated as `web`. This is the new default.
- Unknown / malformed value → coerced to `web`, logged once at `warn` level with the offending value so misconfigured clients surface in logs without breaking the call.
- Case-insensitive parse: `TELEGRAM`, `Telegram`, `telegram` all collapse to `'telegram'`.

Only `'telegram'` activates the t.me redirect path. The header is the **only** new wire-level concept; every other change is internal plumbing.

## Behavior change to flag

Non-EdgeClaw callers currently receive a `t.me/...` URL whenever the target has a Telegram handle. After this ships, they receive the web frontend chat URL instead. This is the deliberate strict reading: t.me redirect happens only when the receiver is on Telegram.

Existing `connect_links` rows minted before rollout carry `preferred_surface = NULL`, which the click handler treats as `web` — meaning any old, still-fresh links that previously redirected to `t.me` will now redirect to the web URL. Acceptable trade-off given the 30-day TTL.

## Out of scope

- Additional surface values (`slack`, `discord`, …). The text column will accept them, but the click handler branch is binary for now.
- Any change to the connect-link interstitial UX (`INTERSTITIAL_HTML`).
- Any `agent_transports` schema change.
- Other MCP clients adopting the header. EdgeClaw is the only client wired in this slice; web/CLI/Claude Desktop callers benefit from the default-to-web behavior with zero client change.

## Architecture

```
EdgeClaw MCP call
   headers: x-api-key, x-index-surface=telegram
                │
                ▼
  ┌──────────────────────────────────────┐
  │ backend/src/controllers/             │
  │   mcp.controller.ts                  │
  │   authResolver.resolveIdentity()     │ ← reads x-index-surface,
  │                                      │   normalizes, returns
  │                                      │   clientSurface in identity
  └──────────────────────────────────────┘
                │
                ▼
  ┌──────────────────────────────────────┐
  │ packages/protocol/src/mcp/           │
  │   mcp.server.ts                      │ ← threads clientSurface
  │                                      │   into per-request
  │                                      │   ToolContext
  └──────────────────────────────────────┘
                │
                ▼
  ┌──────────────────────────────────────┐
  │ packages/protocol/src/opportunity/   │
  │   opportunity.tools.ts               │ ← attachActionableLinks
  │                                      │   passes preferredSurface
  │                                      │   into mintConnectLink
  └──────────────────────────────────────┘
                │
                ▼
  ┌──────────────────────────────────────┐
  │ backend/src/services/                │
  │   connect-link.service.ts            │ ← persists preferred_surface
  │                                      │   on insert; re-stamps on
  │                                      │   rotation of expired rows;
  │                                      │   first mint wins on reuse
  └──────────────────────────────────────┘
                │
                ▼
       connect_links row written
       preferred_surface = 'telegram'
                │
                ▼
       /c/{code} returned in MCP response
                │
                ▼   [later, user clicks in Telegram]
                ▼
  ┌──────────────────────────────────────┐
  │ backend/src/controllers/             │
  │   connect-link.controller.ts         │ ← reads preferred_surface
  │   GET /c/:code/go                    │   from resolved row;
  │                                      │   branches redirect target
  └──────────────────────────────────────┘
                │
                ├─ preferred_surface = 'telegram' AND target has TG → https://t.me/{handle}?text=...
                ├─ preferred_surface = 'telegram' AND target no TG → frontend chat URL (silent fallback)
                └─ preferred_surface = 'web' / NULL                → frontend chat URL
```

## Components

### 1. Header read + identity plumbing — backend

**File:** `backend/src/controllers/mcp.controller.ts`

In `authResolver.resolveIdentity` (around line 183), read `x-index-surface` once at the top of the function, normalize, and include it in every successful return tuple alongside `userId`, `agentId`, `networkScopeId`. Treat normalization as a pure function `parseClientSurface(raw: string | null): 'telegram' | 'web'`:
- `null` → `'web'`
- trim + lower-case → match against `'telegram'` and `'web'` → return the match
- anything else → log `warn` (one-shot per process via a `Set<string>` of seen offenders), return `'web'`

### 2. Protocol auth interface — protocol

**File:** `packages/protocol/src/shared/interfaces/auth.interface.ts`

Extend `McpAuthResolver.resolveIdentity` return type:

```ts
resolveIdentity(request: Request): Promise<{
  userId: string;
  agentId?: string;
  isSessionAuth?: boolean;
  networkScopeId?: string | null;
  clientSurface?: 'telegram' | 'web';   // NEW — absent ⇒ web
}>;
```

Document that callers SHOULD always populate; absent is a backward-compat fallback only.

### 3. Per-request ToolContext — protocol

**File:** `packages/protocol/src/shared/agent/tool.helpers.ts`

Add `clientSurface?: 'telegram' | 'web'` to `ToolContext` (the per-request slice, around line 145 alongside `mintConnectLink`). This is the per-call companion to the `mintConnectLink` dep — it carries the *value to pass* rather than the *function that consumes it*.

**File:** `packages/protocol/src/mcp/mcp.server.ts`

Where the MCP server constructs the per-request tool context (using the result of `authResolver.resolveIdentity` around line 247 and following), include `clientSurface` from the identity in the constructed `ToolContext`.

### 4. `MintConnectLink` interface — protocol

**File:** `packages/protocol/src/shared/interfaces/connect-link.interface.ts`

Extend the call args:

```ts
export interface MintConnectLink {
  (args: {
    userId: string;
    opportunityId: string;
    kind: ConnectLinkKind;
    greeting?: string | null;
    preferredSurface?: 'telegram' | 'web';   // NEW — absent ⇒ web
  }): Promise<{ url: string }>;
}
```

### 5. `attachActionableLinks` — protocol

**File:** `packages/protocol/src/opportunity/opportunity.tools.ts`

`attachActionableLinks` (line 92) accepts a new `preferredSurface` in its `opts`, threads it into the `mintConnectLink` call (line 125). Each of the three call sites in the same file (lines 752, 1041, 1330) pulls `clientSurface` from the per-call context and forwards it as `preferredSurface`.

### 6. `connect_links` schema — backend

**File:** `backend/src/schemas/database.schema.ts`

Add a column to the `connectLinks` table:

```ts
preferredSurface: text('preferred_surface'),  // null = web, 'telegram' or 'web' otherwise
```

No enum, no check constraint — values are server-controlled and a text column keeps the migration trivial. Pre-existing rows are `NULL`, which the click handler treats as web.

**Migration file:** `backend/drizzle/0067_add_connect_link_preferred_surface.sql` (renamed from Drizzle's random output, with the matching `tag` update in `drizzle/meta/_journal.json`, per `CLAUDE.md`).

### 7. `mintConnectLink` service — backend

**File:** `backend/src/services/connect-link.service.ts`

Extend `MintArgs` with `preferredSurface?: 'telegram' | 'web' | null` and update the body:

- **Fresh insert** (line 109): include `preferredSurface` in the insert values, defaulting `null` → null in DB.
- **Reuse of a still-fresh row** (line 72): return the existing row's surface as-is. **First mint wins for the link's lifetime** — a subsequent mint from a different surface does not change the row.
- **Rotation of an expired row** (line 78–101): `set({ code, greeting, expiresAt, preferredSurface })` so the rotated row reflects the latest mint's surface. This is symmetric with the existing rotation of `greeting`.

Extend `ResolvedLink` to include `preferredSurface: 'telegram' | 'web' | null` and return it from `resolveConnectLink`.

### 8. `mintConnectLink` adapter — backend

**File:** `backend/src/controllers/mcp.controller.ts` (around line 62)

The inline adapter that the controller injects into protocol deps:

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

### 9. Click-time branch — backend

**File:** `backend/src/controllers/connect-link.controller.ts`

In `GET /c/:code/go` (line 131):

- **`kind === 'connect'`** (line 144): replace the unconditional `getCounterpartTelegramHandle` call with a branch:
  - `link.preferredSurface === 'telegram'`: do today's t.me-first / web-fallback (current logic at lines 148–153) unchanged.
  - Otherwise: skip the Telegram lookup entirely; return `${frontendUrl}/u/{counterpartUserId}/chat?msg=...` directly. This saves a DB roundtrip for the (now-common) non-Telegram path.
- **`kind === 'outreach'`** (line 157): same branch. `link.preferredSurface === 'telegram'` keeps current handle-lookup-and-fall-back-to-conversation logic; otherwise go straight to the conversation URL.
- **`kind === 'approve_introduction'`** (line 170): unchanged. No redirect to t.me ever happens for this kind.

### 10. EdgeClaw client — packages/edgeclaw

**File:** `packages/edgeclaw/install/install_index.ts`

In `writeMcpServerEntry` (line 43–53), add the header to the JSON written to `openclaw config set`:

```ts
function writeMcpServerEntry(apiKey: string): void {
  const mcpEntry = JSON.stringify({
    url: PROTOCOL_MCP_URL,
    transport: "streamable-http",
    headers: {
      "x-api-key": apiKey,
      "x-index-surface": "telegram",   // NEW
    },
  });
  // ...rest unchanged
}
```

That is the entire EdgeClaw change. Existing EdgeClaw installations re-run `install_index.ts` on bootstrap, so the header propagates without any manual user action.

## Error & edge cases

| Case | Behavior |
| --- | --- |
| Header absent | Treated as `web`. New default. |
| Header malformed (e.g. `x-index-surface: foo`) | Coerce to `web`. Warn-log the value once per process. |
| `preferredSurface=telegram` minted, target has no Telegram handle | Click handler returns frontend chat URL (silent fallback — matches today's symmetric fallback). |
| Pre-rollout `connect_links` rows (`preferred_surface = NULL`) | Treated as `web`. Old links that previously redirected to t.me now redirect to web. |
| Same opportunity link reused (still fresh) across two callers on different surfaces | First mint wins. The row's surface is fixed for the link's lifetime. Subsequent mints from a different surface return the same code and surface. |
| Same opportunity link rotated (expired row) by a later caller on a different surface | New surface takes effect — the rotation re-stamps the row. |

## Testing

### Integration — backend

**File:** new `backend/tests/connect-link.surface.test.ts`.

Mint via `mintConnectLinkSvc` with each surface, then `GET /c/{code}/go` and assert the resolved URL shape for the three matrices:

1. `preferredSurface='telegram'` + target has TG handle → `https://t.me/{handle}?text=...`
2. `preferredSurface='telegram'` + target has no TG handle → `${frontendUrl}/u/{id}/chat?msg=...`
3. `preferredSurface=null` (omitted) + target has TG handle → `${frontendUrl}/u/{id}/chat?msg=...` (the behavior change)

### Unit — backend

**File:** new test alongside `mcp.controller.ts` covering `parseClientSurface`:

- `null` → `'web'`
- `''` → `'web'`
- `'telegram'`, `'Telegram'`, `'TELEGRAM'`, `'  telegram  '` → `'telegram'`
- `'web'`, `'WEB'` → `'web'`
- `'slack'`, `'foo'`, `'true'` → `'web'` (plus warn-log assertion if practical)

### Unit — protocol

**File:** existing `packages/protocol/src/shared/agent/tests/tool.factory.spec.ts`. Extend the "invokes deps.mintConnectLink" test (line 2004) with a parametrized run that asserts `preferredSurface` is forwarded from the per-request context into the `mintConnectLink` call args.

### No graph tests

The surface threads through `ToolContext` only into `mintConnectLink`. No agent or graph touches it. Skip graph tests.

## Files in scope (summary)

| Layer | File | Change |
| --- | --- | --- |
| backend / controller | `backend/src/controllers/mcp.controller.ts` | Read & normalize header in `authResolver`; pass surface to `mintConnectLink` adapter. |
| backend / controller | `backend/src/controllers/connect-link.controller.ts` | Branch redirect on `link.preferredSurface`. |
| backend / service | `backend/src/services/connect-link.service.ts` | Persist `preferredSurface` on insert and rotation; return it from `resolveConnectLink`. |
| backend / schema | `backend/src/schemas/database.schema.ts` | Add `preferredSurface` column to `connectLinks`. |
| backend / migration | `backend/drizzle/0067_add_connect_link_preferred_surface.sql` + `_journal.json` | New migration. |
| protocol / interface | `packages/protocol/src/shared/interfaces/auth.interface.ts` | Add `clientSurface` to identity. |
| protocol / interface | `packages/protocol/src/shared/interfaces/connect-link.interface.ts` | Add `preferredSurface` to `MintConnectLink` args. |
| protocol / agent | `packages/protocol/src/shared/agent/tool.helpers.ts` | Add `clientSurface` to per-request `ToolContext`. |
| protocol / mcp | `packages/protocol/src/mcp/mcp.server.ts` | Thread `clientSurface` from identity into per-request `ToolContext`. |
| protocol / opportunity | `packages/protocol/src/opportunity/opportunity.tools.ts` | Forward surface through `attachActionableLinks` into `mintConnectLink`. |
| edgeclaw | `packages/edgeclaw/install/install_index.ts` | Add `"x-index-surface": "telegram"` to the MCP entry. |

## Rollout

- Single PR. No feature flag — the new column defaults to `NULL` and the click handler treats `NULL` as `web`, which is the new desired default for non-EdgeClaw callers.
- Protocol package version bump per `CLAUDE.md` (npm-published subtree). `packages/edgeclaw/package.json` bump as well.
- Existing EdgeClaw installs re-run `install_index.ts` on bootstrap and pick up the header automatically; no manual user step.
