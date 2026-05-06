# Onboarding Guard — OpenClaw Plugin

**Date:** 2026-05-06  
**Issue:** IND-248  
**Status:** Ready for implementation

---

## Problem

The OpenClaw plugin starts dispatching ambient discovery, daily digest, negotiation, and accepted-opportunity notifications immediately after `openclaw index setup` completes. Users who haven't finished onboarding (no profile, no intents) receive discovery messages before the system has anything meaningful to surface for them. The chat agent already handles onboarding guidance when users interact directly — the plugin just needs to stay silent until that process is complete.

---

## Solution

Gate all substantive pollers on `users.onboarding.completedAt` from the backend. A new shared module (`onboarding.status.ts`) owns the check and caches the result. Test-message remains ungated (it's a delivery probe, not real content).

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

- `src/polling/test-message/test-message.poller.ts` — unchanged. Test messages are delivery verification probes and must work regardless of onboarding status.

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

### Existing poller tests (additions)

Each of the four gated pollers gets one new test case: when `isOnboardingComplete` returns `false`, `handle()` returns the skip value without making any backend requests.

---

## What is NOT changed

- `test-message.poller.ts` — ungated
- `setup.cli.ts` / `runSetup` / `runHeadlessSetup` — no changes
- `index.ts` register() — no changes
- Plugin config keys — no new config fields written
- IND-249 (welcome message after onboarding) — out of scope for this issue
