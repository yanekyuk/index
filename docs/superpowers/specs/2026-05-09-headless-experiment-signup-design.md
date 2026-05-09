# Headless experiment-network signup — design

**Status:** approved (brainstorm) — ready for implementation plan
**Date:** 2026-05-09
**Branch:** `feat-edgeclaw`

## Context

EdgeClaw (the Edge Esmeralda 2026 agent-village experience) needs two onboarding paths for attendees:

1. **InstaClaw-hosted** — non-technical attendee picks "set one up for me." InstaClaw provisions a hosted OpenClaw runtime, installs EdgeClaw, and binds it to the attendee's Index Network identity. InstaClaw holds the Edge Esmeralda experiment network's master key and has rich profile data from EdgeOS (name, bio, location, socials). Telegram is captured in a follow-up step that InstaClaw owns.
2. **BYO agent** — technical attendee plugs Index into their own runtime (Hermes, Claude Code, custom Anthropic SDK setup). EdgeOS holds the master key and calls Index on the attendee's behalf, then displays the returned MCP server config snippet for the attendee to paste into their agent.

Both paths are server-to-server, master-key-authenticated, and need the API key returned in the response. **Neither sends email** — the partner integrator is the delivery channel.

The two paths share a backend call. They differ only in what the integrator does *after* receiving the response.

## Existing surface

- `POST /networks/:id/signup` exists today, master-key-authenticated via `ExperimentMasterKeyGuard`. Body: `{ email }` only. Response includes a `connectCommand` (`openclaw index connect …`) which is the openclaw-plugin install path — **not** how EdgeClaw is installed and irrelevant to these flows.
- The endpoint always emails the user via `networkInvitationService.invite()` → `dispatchInvitationEmail()` on first agent provision.
- Re-signups with the same email currently call `provisionScopedAgent` again, which **creates a second agent record** for the same user+network rather than rotating tokens on the existing agent. This stacks orphan agents on retry.
- `experimentService.applyProfilePatch` already handles writing name/bio/location/socials for CSV import; reusable here.

## Goals

- One headless endpoint serves both InstaClaw and EdgeOS partner flows.
- Endpoint accepts an optional richer payload (name, bio, location, socials).
- Endpoint returns an MCP server config snippet alongside the API key.
- Endpoint sends no email.
- Re-signup is idempotent at user/agent identity (no orphan agents) but rotates the API key.

## Non-goals

- Frontend signup page (the signup flow is server-to-server only).
- Telegram transport binding (InstaClaw owns this in a follow-up step).
- Changing how owner-facing UI invite flows work — `/members/invite` and `/members/import` continue to email and continue to use `buildConnectCommand`. Migrating those to EdgeClaw-shaped delivery is a separate concern.
- Per-call email opt-in flag (single endpoint, single behavior — see decisions).

## Endpoint contract

```
POST /networks/:id/signup
Headers:
  x-api-key: <masterKey>           ; network's experiment master key
  Content-Type: application/json
```

### Request body

```json
{
  "email": "alice@example.com",
  "name": "Alice Example",
  "bio": "Independent researcher on coordination problems.",
  "location": "Healdsburg, CA",
  "socials": [
    { "label": "telegram", "value": "@alice" },
    { "label": "twitter",  "value": "alice_eg" }
  ]
}
```

| Field | Required | Cap | Notes |
|---|---|---|---|
| `email` | yes | RFC-shape | Matched against existing `EMAIL_REGEX`. Lowercased + trimmed before persistence. |
| `name` | no | 200 chars | Trim and slice. When present, overwrites the user's stored name (matches CSV-import semantics). |
| `bio` | no | 2000 chars | Trim. |
| `location` | no | 200 chars | Trim. |
| `socials` | no | ≤ 32 entries | Open vocabulary (`label` is any string). Matches today's CSV import behavior. |

Omitted fields never clobber existing user data. The `applyProfilePatch` helper only writes the keys present in the payload; absent keys are left untouched.
| `socials[].label` | yes (per entry) | 64 chars | |
| `socials[].value` | yes (per entry) | 256 chars | Upserted by `(userId, label)`; duplicate labels → last wins. |

### Caller shapes (documented examples)

**InstaClaw** sends the full payload it has from EdgeOS.
**BYO via EdgeOS** sends the minimum, typically `{ email }` and `name`.

### Response

```json
{
  "user":   { "id": "<uuid>", "email": "alice@example.com" },
  "apiKey": "ix_...",
  "mcpServer": {
    "name":    "index",
    "url":     "https://protocol.index.network/mcp",
    "headers": { "x-api-key": "ix_..." }
  }
}
```

- `mcpServer` is always included. URL is derived from `${BASE_URL}/mcp`, where `BASE_URL` is the existing backend env var (default `https://protocol.index.network`).
- `mcpServer.headers["x-api-key"]` duplicates `apiKey`. The duplication is intentional: EdgeOS pastes the `mcpServer` object into the user's runtime config without further transformation; tooling that wants the raw key reads `apiKey`.
- HTTP status: `201` if user newly created, `200` if user existed.

### Idempotency

- Same email, repeated calls → same user.
- Each call **rotates** the network-scoped API key on the existing scoped agent: previous tokens are revoked, a new token is minted on the same agent record. No orphan agent records.
- Trade-off documented for partners: if the integrator retries after the user has already pasted a previous key, that previous key is now invalid. The integrator is the delivery channel and the source of truth for the latest key. If we ever need stronger semantics, an `Idempotency-Key` header can be added later without breaking this contract.

### Errors

| Code | When |
|---|---|
| 400 | Missing/invalid email; oversized field; malformed `socials` shape. |
| 401 | Missing `x-api-key` header. |
| 403 | Master key invalid; network not in experiment mode; network deleted. |

### Removals from current contract

- `connectCommand` is no longer in the response. The existing OpenClaw-CLI install path (`openclaw index connect`) is unrelated to EdgeClaw's installer and was misleading for these flows.
- The endpoint no longer sends email under any circumstances.

## Backend refactor

The change centers on extracting a shared no-email primitive on `networkInvitationService` so the headless and UI-driven invite paths can diverge cleanly on email and key-rotation behavior.

### New helper: `networkInvitationService.ensureMembership`

```ts
ensureMembership(params: {
  networkId: string;
  email: string;
  name?: string;
  rotateKey?: boolean;       // default false
}): Promise<{
  user: { id: string; email: string };
  agentId: string;
  apiKey: string | null;     // null only when rotateKey=false and agent already existed
  created: boolean;
  alreadyMember: boolean;
  rotated: boolean;
}>
```

Sequence:
1. `findOrCreateUser` (existing private helper, unchanged).
2. `ensurePersonalNetwork` (existing adapter, unchanged).
3. `joinNetwork` (existing private helper, unchanged).
4. Look up the user's network-scoped agent (existing `findScopedAgentId`).
   - **If absent:** create agent + grant permission + mint token. Return key.
   - **If present and `rotateKey=true`:** revoke all tokens for that agent (existing `agentTokenAdapter.revokeAllForAgent`), mint a new token on the same agent. Set `rotated=true`. Return key.
   - **If present and `rotateKey=false`:** return `apiKey: null`. Set `rotated=false`.

`provisionScopedAgent` is now an internal detail of `ensureMembership` — no behavior change for that helper, just no longer called blindly on retry.

### Call-site updates

| Caller | Change |
|---|---|
| `networkInvitationService.invite()` | Body becomes: `const r = await ensureMembership({ ..., rotateKey: false }); if (r.apiKey) await dispatchInvitationEmail(...)`. External shape (`InviteResult`) unchanged. |
| `experimentService.signup(networkId, email)` | Signature → `signup(networkId, payload: SignupPayload)`. Calls `ensureMembership({ ..., rotateKey: true })`, then `applyProfilePatch(user.id, payload)` if any of bio/location/socials present, then builds `mcpServer` via new `buildMcpServerConfig`. Drops `connectCommand`. No email path. |
| `networkController.signup` | Body validation extended to optional name/bio/location/socials with caps. Returns `{ user, apiKey, mcpServer }`. |
| `networkInvitationService.resendInvite()` | **Unchanged.** Owner-facing rotate-and-email flow stays as-is; not in scope to refactor. |

### New helper: `buildMcpServerConfig`

Lives at `backend/src/lib/mcp/mcp-config.ts` — kept out of `lib/openclaw/` because the snippet is runtime-agnostic (Claude Code, OpenClaw, Hermes all consume the same shape).

```ts
export const buildMcpServerConfig = (apiKey: string): {
  name: string;
  url: string;
  headers: Record<string, string>;
} => ({
  name: 'index',
  url: `${(process.env.BASE_URL || 'https://protocol.index.network').replace(/\/+$/, '')}/mcp`,
  headers: { 'x-api-key': apiKey },
});
```

`buildConnectCommand` stays untouched and continues serving the unchanged owner-facing email path.

### `SignupPayload` shape

```ts
interface SignupPayload {
  email: string;
  name?: string;
  bio?: string;
  location?: string;
  socials?: { label: string; value: string }[];
}
```

`applyProfilePatch` already accepts an `ImportRow`-shaped argument with the same fields — reused directly, with the controller-level validation step normalizing `socials: undefined` to `[]` for that helper.

### Validation

Added to `networkController.signup` before service call:
- `email` matches `EMAIL_REGEX` (existing).
- Each optional string field trimmed and length-checked against the cap table above.
- `socials`, if present, must be an array of `{ label: string, value: string }` with caps; reject anything else with 400.

## Documentation deliverables

### `packages/edgeclaw/README.md`

Replace the current "Getting an agent connected" section with a partner-integration section structured as:

- One-paragraph summary of the headless endpoint as the single onboarding primitive.
- HTTP request/response with both InstaClaw rich-payload and EdgeOS minimal-payload examples.
- Validation cap table.
- Idempotency contract + the rotate-on-retry trade-off.
- Error response table.
- Two short post-call narratives:
  - **InstaClaw** runs the EdgeClaw installer with the returned `apiKey`, then captures Telegram in a follow-up step it owns.
  - **EdgeOS** displays the `mcpServer` snippet for the attendee to paste into their agent's MCP config.

### `docs/specs/api-reference.md`

Add/update the `POST /networks/:id/signup` entry with the same endpoint contract. The README is partner-narrative; the API reference is the canonical machine-targeted spec.

## Tests

`backend/tests/` and `backend/src/services/tests/`:

- Headless signup with rich payload writes name/bio/location/socials (assert via DB read on `users`, `userProfiles`, `userSocials`).
- Headless signup never invokes `executeSendEmail` (mock + assert never called).
- Headless signup with minimal `{ email }` payload still works; profile fields untouched if absent; existing fields not overwritten with empty values.
- Re-signup with same email: returns a fresh API key, **does not create a second agent record** (assert single `agents` row for that user+network), and the previously returned key is now rejected by `AuthOrApiKeyGuard`.
- Validation: invalid email → 400; oversized bio/socials → 400; malformed `socials` shape → 400; missing master key → 401; wrong master key → 403; non-experiment network → 403.
- Owner-facing `invite()` and CSV import paths still email — assert via existing `network-invitation-resend.test.ts` patterns to confirm the refactor didn't regress them.

## Decisions log

| Decision | Choice | Reason |
|---|---|---|
| One endpoint vs two for InstaClaw / EdgeOS | One | Same backend call; differs only in caller post-processing. |
| Email behavior on `/signup` | Removed entirely | Partner integrator is the delivery channel; per-call flag would be a footgun. |
| `socials` labels | Open vocabulary | Matches CSV-import behavior; renderers can canonicalize at read time. |
| Re-signup behavior | Rotate key on existing agent | No orphan agents; integrator always gets a usable key. |
| `mcpServer` always returned | Yes | Uniform endpoint shape; InstaClaw ignores it harmlessly. |
| Refactor scope of `resendInvite` | Out | Avoid scope creep; current path is correct already. |
