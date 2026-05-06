# Onboarding Guard — OpenClaw Plugin

**Date:** 2026-05-06  
**Issue:** IND-248  
**Status:** Ready for implementation

---

## Problem

The OpenClaw plugin starts dispatching ambient discovery, daily digest, negotiation, and accepted-opportunity notifications immediately after `openclaw index setup` completes. Users who haven't finished onboarding (no profile, no intents) receive discovery messages before the system has anything meaningful to surface for them.

Onboarding must be completable entirely within OpenClaw (Telegram, WhatsApp, Discord, etc.) — users should not need to visit index.network in a browser. The OpenClaw main agent has access to all required MCP tools.

---

## Solution

1. Gate all substantive pollers on `users.onboarding.completedAt` from the backend.
2. On startup, if onboarding is not complete, dispatch an onboarding prompt to the main agent so it can guide the user through setup on their chat channel.
3. A new shared module (`onboarding.status.ts`) owns the backend check and caches the result.
4. Test-message remains ungated (delivery probe, not real content).

---

## Backend Change

**File:** `backend/src/controllers/agent.controller.ts` — `getMe()` handler

Add `onboardingCompletedAt: string | null` to the `GET /api/agents/me` response by fetching the user's onboarding state alongside the agent. The `users.onboarding` JSON column already contains `completedAt`.

Response shape (addition only — no existing fields removed):
```json
{
  "agent": { "id": "...", "name": "...", "...": "..." },
  "onboardingCompletedAt": "2026-05-05T10:00:00.000Z"
}
```

`onboardingCompletedAt` is `null` when the user has not called `complete_onboarding()` yet.

No schema change. No migration. Pure read from the existing column.

---

## New Module — `onboarding.status.ts`

**File:** `packages/openclaw-plugin/src/polling/onboarding/onboarding.status.ts`

Exports one public function and a test-only reset:

```ts
export async function isOnboardingComplete(
  api: OpenClawPluginApi,
  config: { baseUrl: string; agentId: string; apiKey: string },
): Promise<boolean>

export function _resetForTesting(): void
```

### Caching behaviour

| State | Cached? | Re-queries? |
|---|---|---|
| `true` (complete) + same API key | Yes — returns immediately | No |
| `true` (complete) + different API key | No — stale | Yes |
| `false` or error | No | Yes on next call |

`true` is a one-way transition: once confirmed, the module never hits the backend again (for the same API key). If the API key changes — e.g. after `openclaw index connect` — the cache is considered stale and a fresh check is made.

### Error handling

Network errors and non-2xx responses return `false` (conservative — keep gating). This prevents a flaky connection from accidentally unblocking dispatches.

### Module-level state

```ts
let cachedComplete: boolean | undefined = undefined;
let cachedForApiKey: string | undefined = undefined;
```

`cachedForApiKey` is only written on a successful backend response. A key rotation that returns 401 keeps re-querying on every cycle until a valid key is in place.

---

## Onboarding Dispatch

**When:** On `register()` startup, after a short delay (same pattern as the existing reachability check), `isOnboardingComplete` is called. If `false`, dispatch an onboarding prompt to the main agent via `dispatchToMainAgent`.

**Rate limiting:** Idempotency key `index:onboarding:dispatch:${agentId}:${dateStr}` — fires at most once per calendar day while onboarding is pending. Prevents spam on frequent gateway restarts while still re-prompting the next day if the user dismissed without completing.

**New file:** `packages/openclaw-plugin/src/polling/onboarding/onboarding.prompt.ts`

Builds the prompt the main agent receives, instructing it to walk the user through the full onboarding flow using MCP tools:

1. **Greet + create profile** — `create_user_profile()`, present summary, `create_user_profile(confirm=true)` on approval
2. **Community discovery** — `read_networks()`, present as plain text list, `create_network_membership()` for any joins *(no `networks_panel` block — web UI only)*
3. **Intent capture** — `create_intent(description=...)`
4. **Initial match** — `create_opportunities(searchQuery=...)`
5. **Complete** — `complete_onboarding()` (required final step)

**Gmail import (`import_gmail_contacts`) is explicitly excluded** — the OAuth flow requires a browser and is not appropriate for the OpenClaw channel.

**`index.ts` change:** One async block alongside the existing reachability check. Checks onboarding status and dispatches the prompt if needed.

---

## Poller Changes

### Gated pollers (onboarding required)

Each of the following gets a two-line guard at the top of `handle()`:

- `src/polling/ambient-discovery/ambient-discovery.poller.ts` → returns `'empty'`
- `src/polling/daily-digest/daily-digest.poller.ts` → returns its existing skip value
- `src/polling/negotiator/negotiator.poller.ts` → returns its existing skip value
- `src/polling/accepted-opportunity/accepted-opportunity.poller.ts` → returns its existing skip value

Pattern:
```ts
if (!await isOnboardingComplete(api, config)) {
  api.logger.debug('<poller-name>: onboarding not complete, skipping.');
  return '<skip-value>';
}
```

All four pollers already receive a `config` object containing `baseUrl`, `agentId`, and `apiKey` — no signature changes needed.

### Ungated pollers

- `src/polling/test-message/test-message.poller.ts` — unchanged. Delivery verification probe; must work regardless of onboarding status.

---

## Tests

### `src/tests/onboarding.status.spec.ts` (new)

| # | Case |
|---|---|
| 1 | Returns `false` when `onboardingCompletedAt` is `null` |
| 2 | Returns `true` when `onboardingCompletedAt` is a non-null ISO string |
| 3 | Caches `true` — second call with same API key never hits backend |
| 4 | Re-queries when API key changes, even if previously cached `true` |
| 5 | Returns `false` on network error (conservative) |
| 6 | Returns `false` on non-2xx response (conservative) |

### `src/tests/onboarding.prompt.spec.ts` (new)

| # | Case |
|---|---|
| 1 | Rendered prompt contains profile creation instructions |
| 2 | Rendered prompt contains community discovery instructions |
| 3 | Rendered prompt contains intent capture instructions |
| 4 | Rendered prompt contains `complete_onboarding` instruction |
| 5 | Rendered prompt does NOT mention `import_gmail_contacts` |

### Existing poller tests (additions)

Each of the four gated pollers gets one new test case: when `isOnboardingComplete` returns `false`, `handle()` returns the skip value without making any backend requests.

---

## What is NOT changed

- `test-message.poller.ts` — ungated
- `setup.cli.ts` / `runSetup` / `runHeadlessSetup` — no changes
- Plugin config keys — no new config fields written
- IND-249 (welcome message after onboarding) — out of scope for this issue
