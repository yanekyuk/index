# Onboarding Guard — OpenClaw Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate all substantive OpenClaw pollers on backend onboarding completion, and dispatch an onboarding prompt to the main agent on startup when onboarding is not yet done.

**Architecture:** A new `onboarding.status.ts` module owns a backend check against `GET /api/agents/me` (extended to include `onboardingCompletedAt`) and caches the result in-process. Four pollers import this module and return early if not onboarded. On `register()` startup, if not onboarded, the plugin dispatches an onboarding prompt via `dispatchToMainAgent` with a day-scoped idempotency key. The onboarding prompt instructs the main agent to walk the user through profile → communities → intent → `complete_onboarding()` via MCP tools, without requiring a browser visit to index.network.

**Tech Stack:** TypeScript, Bun, Express (`backend/`), OpenClaw plugin SDK (`packages/openclaw-plugin/`), `bun:test` for tests.

---

## File Map

| Status | File | Change |
|---|---|---|
| Modify | `backend/src/controllers/agent.controller.ts` | Add `onboardingCompletedAt` to `getMe()` response |
| Create | `packages/openclaw-plugin/src/polling/onboarding/onboarding.status.ts` | New module: onboarding status check + cache |
| Create | `packages/openclaw-plugin/src/polling/onboarding/onboarding.prompt.ts` | New module: onboarding dispatch prompt |
| Modify | `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts` | Add onboarding guard |
| Modify | `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts` | Add onboarding guard |
| Modify | `packages/openclaw-plugin/src/polling/negotiator/negotiator.poller.ts` | Add onboarding guard |
| Modify | `packages/openclaw-plugin/src/polling/accepted-opportunity/accepted-opportunity.poller.ts` | Add onboarding guard |
| Modify | `packages/openclaw-plugin/src/index.ts` | Add onboarding dispatch on startup; reset in `_resetForTesting` |
| Create | `packages/openclaw-plugin/src/tests/onboarding.status.spec.ts` | 6 test cases for `isOnboardingComplete` |
| Create | `packages/openclaw-plugin/src/tests/onboarding.prompt.spec.ts` | 5 test cases for `buildOnboardingPrompt` |
| Modify | `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts` | +1 case: ambient guard |
| Modify | `packages/openclaw-plugin/src/tests/daily-digest.test.ts` | +1 case: digest guard |
| Modify | `packages/openclaw-plugin/src/tests/turn.prompt.spec.ts` | +1 case: negotiator guard |
| Modify | `packages/openclaw-plugin/src/tests/test-message-pickup.spec.ts` | +1 case: accepted-opportunity guard |

---

## Task 1: Extend `GET /api/agents/me` with `onboardingCompletedAt`

**Files:**
- Modify: `backend/src/controllers/agent.controller.ts:179-193`

- [ ] **Step 1: Add `userService` import to agent controller**

Open `backend/src/controllers/agent.controller.ts`. After line 14 (end of existing imports block), add:

```ts
import { userService } from '../services/user.service';
```

- [ ] **Step 2: Update `getMe()` to fetch and return `onboardingCompletedAt`**

Replace the existing `getMe()` handler (lines 179–193):

```ts
@Get('/me')
@UseGuards(AuthOrApiKeyGuard)
async getMe(req: Request, user: AuthenticatedUser) {
  const agentId = await resolveApiKeyAgentId(req);
  if (!agentId) {
    return jsonError('This endpoint requires an agent-bound API key', 400);
  }

  try {
    const [agent, userData] = await Promise.all([
      agentService.getById(agentId, user.id),
      userService.findById(user.id),
    ]);
    const onboardingCompletedAt = userData?.onboarding?.completedAt ?? null;
    return Response.json({ agent, onboardingCompletedAt });
  } catch (err) {
    return jsonError(parseErrorMessage(err), errorStatus(err, 404));
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/agent.controller.ts
git -c commit.gpgsign=false commit -m "feat(backend): add onboardingCompletedAt to GET /api/agents/me response"
```

---

## Task 2: Create `onboarding.status.ts`

**Files:**
- Create: `packages/openclaw-plugin/src/polling/onboarding/onboarding.status.ts`
- Create: `packages/openclaw-plugin/src/tests/onboarding.status.spec.ts`

- [ ] **Step 1: Write the failing tests first**

Create `packages/openclaw-plugin/src/tests/onboarding.status.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  isOnboardingComplete,
  _resetForTesting,
} from '../polling/onboarding/onboarding.status.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

function makeApi(): OpenClawPluginApi {
  return {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: {},
    config: {},
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
    registerHttpRoute: mock(() => {}),
  };
}

const cfg = { baseUrl: 'https://test.example.com', agentId: 'agent-1', apiKey: 'key-abc' };

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  _resetForTesting();
});

afterEach(() => {
  global.fetch = originalFetch;
  _resetForTesting();
});

describe('isOnboardingComplete', () => {
  it('returns false when onboardingCompletedAt is null', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ agent: {}, onboardingCompletedAt: null }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await isOnboardingComplete(makeApi(), cfg);
    expect(result).toBe(false);
  });

  it('returns true when onboardingCompletedAt is a non-null ISO string', async () => {
    global.fetch = mock(async () =>
      new Response(
        JSON.stringify({ agent: {}, onboardingCompletedAt: '2026-05-05T10:00:00.000Z' }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const result = await isOnboardingComplete(makeApi(), cfg);
    expect(result).toBe(true);
  });

  it('caches true — second call with same API key never hits backend', async () => {
    let callCount = 0;
    global.fetch = mock(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ agent: {}, onboardingCompletedAt: '2026-05-05T10:00:00.000Z' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await isOnboardingComplete(makeApi(), cfg);
    await isOnboardingComplete(makeApi(), cfg);
    expect(callCount).toBe(1);
  });

  it('re-queries when API key changes even if previously cached true', async () => {
    let callCount = 0;
    global.fetch = mock(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ agent: {}, onboardingCompletedAt: '2026-05-05T10:00:00.000Z' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await isOnboardingComplete(makeApi(), { ...cfg, apiKey: 'key-abc' });
    await isOnboardingComplete(makeApi(), { ...cfg, apiKey: 'key-xyz' });
    expect(callCount).toBe(2);
  });

  it('returns false conservatively on network error', async () => {
    global.fetch = mock(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const result = await isOnboardingComplete(makeApi(), cfg);
    expect(result).toBe(false);
  });

  it('returns false conservatively on non-2xx response', async () => {
    global.fetch = mock(async () =>
      new Response('Unauthorized', { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await isOnboardingComplete(makeApi(), cfg);
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/openclaw-plugin && bun test src/tests/onboarding.status.spec.ts
```

Expected: all 6 tests fail with import errors (file doesn't exist yet).

- [ ] **Step 3: Implement `onboarding.status.ts`**

Create `packages/openclaw-plugin/src/polling/onboarding/onboarding.status.ts`:

```ts
import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';

export interface OnboardingStatusConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

let cachedComplete: boolean | undefined = undefined;
let cachedForApiKey: string | undefined = undefined;

/**
 * Returns true when the user has completed onboarding (`onboardingCompletedAt`
 * is set on the backend). Caches `true` forever for the same API key — onboarding
 * completion is a one-way transition. Re-queries when the API key changes.
 * Returns `false` conservatively on network errors or non-2xx responses so
 * dispatches remain gated on a flaky connection.
 */
export async function isOnboardingComplete(
  api: OpenClawPluginApi,
  config: OnboardingStatusConfig,
): Promise<boolean> {
  if (cachedComplete === true && cachedForApiKey === config.apiKey) return true;

  try {
    const res = await fetch(`${config.baseUrl}/api/agents/me`, {
      headers: { 'x-api-key': config.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      api.logger.warn('Onboarding status check failed', { status: res.status });
      return false;
    }
    const body = (await res.json()) as { onboardingCompletedAt?: string | null };
    const complete = body.onboardingCompletedAt != null;
    if (complete) {
      cachedComplete = true;
      cachedForApiKey = config.apiKey;
    }
    return complete;
  } catch (err) {
    api.logger.warn('Onboarding status check errored', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  cachedComplete = undefined;
  cachedForApiKey = undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/openclaw-plugin && bun test src/tests/onboarding.status.spec.ts
```

Expected: 6 pass / 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/polling/onboarding/onboarding.status.ts \
        packages/openclaw-plugin/src/tests/onboarding.status.spec.ts
git -c commit.gpgsign=false commit -m "feat(openclaw-plugin): add onboarding.status module with caching"
```

---

## Task 3: Create `onboarding.prompt.ts`

**Files:**
- Create: `packages/openclaw-plugin/src/polling/onboarding/onboarding.prompt.ts`
- Create: `packages/openclaw-plugin/src/tests/onboarding.prompt.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/openclaw-plugin/src/tests/onboarding.prompt.spec.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { buildOnboardingPrompt } from '../polling/onboarding/onboarding.prompt.js';

describe('buildOnboardingPrompt', () => {
  it('contains profile creation instructions', () => {
    const prompt = buildOnboardingPrompt();
    expect(prompt).toContain('create_user_profile');
  });

  it('contains community discovery instructions', () => {
    const prompt = buildOnboardingPrompt();
    expect(prompt).toContain('read_networks');
    expect(prompt).toContain('create_network_membership');
  });

  it('contains intent capture instructions', () => {
    const prompt = buildOnboardingPrompt();
    expect(prompt).toContain('create_intent');
  });

  it('contains complete_onboarding instruction', () => {
    const prompt = buildOnboardingPrompt();
    expect(prompt).toContain('complete_onboarding');
  });

  it('does NOT mention import_gmail_contacts', () => {
    const prompt = buildOnboardingPrompt();
    expect(prompt).not.toContain('import_gmail_contacts');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/openclaw-plugin && bun test src/tests/onboarding.prompt.spec.ts
```

Expected: all 5 tests fail with import errors.

- [ ] **Step 3: Implement `onboarding.prompt.ts`**

Create `packages/openclaw-plugin/src/polling/onboarding/onboarding.prompt.ts`:

```ts
/**
 * Builds the onboarding prompt dispatched to the user's main OpenClaw agent
 * after initial plugin setup, when onboarding has not yet been completed.
 *
 * The agent has access to Index Network MCP tools and can drive the full
 * onboarding flow on the user's chat channel (Telegram, WhatsApp, etc.)
 * without the user visiting index.network.
 *
 * Gmail import (`import_gmail_contacts`) is intentionally excluded — it
 * requires OAuth in a browser and is not appropriate for chat-channel delivery.
 */
export function buildOnboardingPrompt(): string {
  return `You are the Index agent. The user has just connected to Index Network via OpenClaw and needs to complete their onboarding. Walk them through the following steps in order. Do not skip steps.

## Onboarding Flow

### Step 1 — Greet and create profile
- Greet the user warmly: "Hey, I'm Index. I help the right people find you — and help you find them."
- Briefly explain what Index does: learn about them, find relevant people, surface connections in the background.
- Call \`create_user_profile()\` with no arguments to look up their public profile from their name and email.
- While processing, narrate: "> Looking you up…"
- Present the profile summary naturally: "Here's what I found: [summary]. Does that sound right?"
- Wait for their confirmation:
  - If yes → call \`create_user_profile(confirm=true)\` to save and proceed to Step 2.
  - If no / wants edits → call \`create_user_profile(bioOrDescription="[their correction]", confirm=true)\` with their corrections, then proceed to Step 2.
  - If nothing found → ask them to describe themselves in a sentence, then call \`create_user_profile(bioOrDescription="[their text]", confirm=true)\`.

### Step 2 — Community discovery
- Call \`read_networks()\` to fetch available public communities.
- Present the communities as a plain text list — do NOT use any code fences or special blocks.
- Write: "Here are some communities you might find relevant — let me know which ones you'd like to join, or say skip to continue."
- For each community the user wants to join, call \`create_network_membership(networkId="...")\`.
- After handling their response (joins processed, or user skips), proceed to Step 3.

### Step 3 — Intent capture
- Ask: "Now tell me — what are you open to right now? Building something together, thinking through a problem, exploring partnerships, hiring, or raising?"
- When they respond, call \`create_intent(description="[their response]")\`.
- Briefly acknowledge the intent was saved: "Got it — I'll keep an eye out for relevant people."

### Step 4 — Initial match
- Call \`create_opportunities(searchQuery="[the intent description from Step 3]")\` to surface initial matches.
- If matches found, present them naturally: "I already found some relevant people based on what you're looking for."
- If no matches: "No matches yet, but I'll keep looking in the background."

### Step 5 — Complete onboarding
- Call \`complete_onboarding()\`. This is required — do not skip it.
- Close with: "You're all set. I'll keep an eye out for more relevant people — you'll hear from me when something comes up."

## Rules
- Do not skip steps or reorder them.
- Do not mention Gmail, email import, or \`import_gmail_contacts\` — it is not available in this flow.
- If the user tries to do something else mid-onboarding, gently redirect: "Let's finish setting you up first, then we can dive into that."
- Keep your tone warm, direct, and concise.
- Only call \`complete_onboarding()\` at Step 5 — never earlier.
`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/openclaw-plugin && bun test src/tests/onboarding.prompt.spec.ts
```

Expected: 5 pass / 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/polling/onboarding/onboarding.prompt.ts \
        packages/openclaw-plugin/src/tests/onboarding.prompt.spec.ts
git -c commit.gpgsign=false commit -m "feat(openclaw-plugin): add onboarding prompt for main agent dispatch"
```

---

## Task 4: Gate the ambient-discovery poller

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts`
- Modify: `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts`. In the `describe('handleAmbientDiscovery ...')` block, add this test (after the existing tests):

```ts
it('returns "empty" without any fetch when onboarding is not complete', async () => {
  // Mock /api/agents/me to return null completedAt
  global.fetch = mock(async (input: RequestInfo) => {
    const url = String(input);
    if (url.includes('/api/agents/me')) {
      return new Response(JSON.stringify({ agent: {}, onboardingCompletedAt: null }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;

  const result = await handleAmbientDiscovery(mockApi, cfg);
  expect(result).toBe('empty');
});
```

Also add `_resetForTesting as _resetOnboardingStatus` to the imports at the top of the file:

```ts
import { _resetForTesting as _resetOnboardingStatus } from '../polling/onboarding/onboarding.status.js';
```

And add `_resetOnboardingStatus()` to both `beforeEach` and `afterEach`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/openclaw-plugin && bun test src/tests/opportunity-batch.spec.ts --test-name-pattern "onboarding"
```

Expected: FAIL — ambient discovery currently has no guard.

- [ ] **Step 3: Add the guard to `ambient-discovery.poller.ts`**

Add the import at the top of `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts` (after existing imports):

```ts
import { isOnboardingComplete } from '../../polling/onboarding/onboarding.status.js';
```

Add the guard as the first two lines inside `handle()`, before the `pendingUrl` line:

```ts
export async function handle(
  api: OpenClawPluginApi,
  config: AmbientDiscoveryConfig,
): Promise<AmbientDiscoveryOutcome> {
  if (!await isOnboardingComplete(api, config)) {
    api.logger.debug('Ambient discovery: onboarding not complete, skipping.');
    return 'empty';
  }
  // ... existing code unchanged
```

- [ ] **Step 4: Run full ambient-discovery test suite to verify all pass**

```bash
cd packages/openclaw-plugin && bun test src/tests/opportunity-batch.spec.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts \
        packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts
git -c commit.gpgsign=false commit -m "feat(openclaw-plugin): gate ambient discovery on onboarding completion"
```

---

## Task 5: Gate the daily-digest poller

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts`
- Modify: `packages/openclaw-plugin/src/tests/daily-digest.test.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/openclaw-plugin/src/tests/daily-digest.test.ts`. Add the onboarding status reset import and hook, and add this test:

```ts
import { _resetForTesting as _resetOnboardingStatus } from '../polling/onboarding/onboarding.status.js';
```

Add `_resetOnboardingStatus()` to `beforeEach` and `afterEach`, then add:

```ts
it('returns false without any fetch when onboarding is not complete', async () => {
  global.fetch = mock(async (input: RequestInfo) => {
    const url = String(input);
    if (url.includes('/api/agents/me')) {
      return new Response(JSON.stringify({ agent: {}, onboardingCompletedAt: null }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;

  const result = await handle(mockApi, cfg);
  expect(result).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/openclaw-plugin && bun test src/tests/daily-digest.test.ts --test-name-pattern "onboarding"
```

Expected: FAIL.

- [ ] **Step 3: Add the guard to `daily-digest.poller.ts`**

Add import at the top of `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts`:

```ts
import { isOnboardingComplete } from '../../polling/onboarding/onboarding.status.js';
```

Add guard as the first two lines inside `handle()`:

```ts
export async function handle(
  api: OpenClawPluginApi,
  config: DailyDigestConfig,
): Promise<boolean> {
  if (!await isOnboardingComplete(api, config)) {
    api.logger.debug('Daily digest: onboarding not complete, skipping.');
    return false;
  }
  // ... existing code unchanged
```

- [ ] **Step 4: Run full daily-digest test suite**

```bash
cd packages/openclaw-plugin && bun test src/tests/daily-digest.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts \
        packages/openclaw-plugin/src/tests/daily-digest.test.ts
git -c commit.gpgsign=false commit -m "feat(openclaw-plugin): gate daily digest on onboarding completion"
```

---

## Task 6: Gate the negotiator poller

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/negotiator/negotiator.poller.ts`
- Modify: `packages/openclaw-plugin/src/tests/turn.prompt.spec.ts`

> Note: `turn.prompt.spec.ts` tests the prompt builder, not the poller. The negotiator poller tests are in `index.spec.ts`. Check which file has poller-level tests before adding — add to whichever file tests `negotiator.poller.ts` `handle()` directly. If none exists, add a new minimal file `src/tests/negotiator.poller.spec.ts`.

- [ ] **Step 1: Check where negotiator poller handle() is tested**

```bash
grep -rn "negotiator.poller\|negotiatorPoller\|handle.*Negotiat" packages/openclaw-plugin/src/tests/ --include="*.ts" -l
```

- [ ] **Step 2: Write the failing test**

In the file found above (or create `packages/openclaw-plugin/src/tests/negotiator.poller.spec.ts` if none exists):

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handle } from '../polling/negotiator/negotiator.poller.js';
import { _resetForTesting as _resetOnboardingStatus } from '../polling/onboarding/onboarding.status.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

function makeApi(): OpenClawPluginApi {
  return {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: {},
    config: {},
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
    registerHttpRoute: mock(() => {}),
  };
}

const cfg = { baseUrl: 'https://test.example.com', agentId: 'agent-1', apiKey: 'key-abc' };

let originalFetch: typeof global.fetch;

beforeEach(() => { originalFetch = global.fetch; _resetOnboardingStatus(); });
afterEach(() => { global.fetch = originalFetch; _resetOnboardingStatus(); });

describe('negotiator poller onboarding guard', () => {
  it('returns "idle" without hitting pickup endpoint when onboarding is not complete', async () => {
    global.fetch = mock(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/api/agents/me')) {
        return new Response(JSON.stringify({ agent: {}, onboardingCompletedAt: null }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const result = await handle(makeApi(), cfg);
    expect(result).toBe('idle');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/openclaw-plugin && bun test src/tests/negotiator.poller.spec.ts
```

Expected: FAIL.

- [ ] **Step 4: Add the guard to `negotiator.poller.ts`**

Add import at the top of `packages/openclaw-plugin/src/polling/negotiator/negotiator.poller.ts`:

```ts
import { isOnboardingComplete } from '../onboarding/onboarding.status.js';
```

Add guard as the first two lines inside `handle()`:

```ts
export async function handle(
  api: OpenClawPluginApi,
  config: NegotiatorConfig,
): Promise<NegotiatorPollResult> {
  if (!await isOnboardingComplete(api, config)) {
    api.logger.debug('Negotiator: onboarding not complete, skipping.');
    return 'idle';
  }
  // ... existing code unchanged
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/openclaw-plugin && bun test src/tests/negotiator.poller.spec.ts
```

Expected: 1 pass / 0 fail.

- [ ] **Step 6: Commit**

```bash
git add packages/openclaw-plugin/src/polling/negotiator/negotiator.poller.ts \
        packages/openclaw-plugin/src/tests/negotiator.poller.spec.ts
git -c commit.gpgsign=false commit -m "feat(openclaw-plugin): gate negotiator on onboarding completion"
```

---

## Task 7: Gate the accepted-opportunity poller

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/accepted-opportunity/accepted-opportunity.poller.ts`
- Create or modify accepted-opportunity poller test file

- [ ] **Step 1: Check where accepted-opportunity poller handle() is tested**

```bash
grep -rn "accepted-opportunity.poller\|acceptedOpportunity\|AcceptedOpportunity" packages/openclaw-plugin/src/tests/ --include="*.ts" -l
```

- [ ] **Step 2: Write the failing test**

In the file found above (or create `packages/openclaw-plugin/src/tests/accepted-opportunity.poller.spec.ts`):

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handle, _resetForTesting } from '../polling/accepted-opportunity/accepted-opportunity.poller.js';
import { _resetForTesting as _resetOnboardingStatus } from '../polling/onboarding/onboarding.status.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

function makeApi(): OpenClawPluginApi {
  return {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: {},
    config: {
      gateway: { port: 18789 },
      hooks: { enabled: true, token: 'hooks-tok', path: '/hooks' },
    },
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
    registerHttpRoute: mock(() => {}),
  };
}

const cfg = { baseUrl: 'https://test.example.com', agentId: 'agent-1', apiKey: 'key-abc' };

let originalFetch: typeof global.fetch;

beforeEach(() => { originalFetch = global.fetch; _resetForTesting(); _resetOnboardingStatus(); });
afterEach(() => { global.fetch = originalFetch; _resetForTesting(); _resetOnboardingStatus(); });

describe('accepted-opportunity poller onboarding guard', () => {
  it('returns "empty" without hitting backend when onboarding is not complete', async () => {
    global.fetch = mock(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/api/agents/me')) {
        return new Response(JSON.stringify({ agent: {}, onboardingCompletedAt: null }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const result = await handle(makeApi(), cfg);
    expect(result).toBe('empty');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/openclaw-plugin && bun test src/tests/accepted-opportunity.poller.spec.ts
```

Expected: FAIL.

- [ ] **Step 4: Add the guard to `accepted-opportunity.poller.ts`**

Add import at the top of `packages/openclaw-plugin/src/polling/accepted-opportunity/accepted-opportunity.poller.ts`:

```ts
import { isOnboardingComplete } from '../onboarding/onboarding.status.js';
```

Add guard as the first two lines inside `handle()`:

```ts
export async function handle(
  api: OpenClawPluginApi,
  config: AcceptedOpportunityConfig,
): Promise<AcceptedOpportunityOutcome> {
  if (!await isOnboardingComplete(api, config)) {
    api.logger.debug('Accepted opportunity: onboarding not complete, skipping.');
    return 'empty';
  }
  // ... existing code unchanged
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/openclaw-plugin && bun test src/tests/accepted-opportunity.poller.spec.ts
```

Expected: 1 pass / 0 fail.

- [ ] **Step 6: Commit**

```bash
git add packages/openclaw-plugin/src/polling/accepted-opportunity/accepted-opportunity.poller.ts \
        packages/openclaw-plugin/src/tests/accepted-opportunity.poller.spec.ts
git -c commit.gpgsign=false commit -m "feat(openclaw-plugin): gate accepted-opportunity on onboarding completion"
```

---

## Task 8: Dispatch onboarding prompt on startup

**Files:**
- Modify: `packages/openclaw-plugin/src/index.ts`

- [ ] **Step 1: Add imports to `index.ts`**

At the top of `packages/openclaw-plugin/src/index.ts`, add after existing imports:

```ts
import { isOnboardingComplete, _resetForTesting as _resetOnboardingStatus } from './polling/onboarding/onboarding.status.js';
import { buildOnboardingPrompt } from './polling/onboarding/onboarding.prompt.js';
```

- [ ] **Step 2: Add the startup onboarding dispatch**

Inside the `register()` function, find the existing `setTimeout` block for `checkBackendReachability` near the bottom. Add a second `setTimeout` block immediately after it:

```ts
// Onboarding prompt dispatch — fires once per day while onboarding is pending.
setTimeout(() => {
  dispatchOnboardingIfNeeded(api, { baseUrl, agentId, apiKey });
}, 5_000).unref();
```

- [ ] **Step 3: Add the `dispatchOnboardingIfNeeded` function**

Add this function to `index.ts` alongside the existing `checkBackendReachability` function:

```ts
async function dispatchOnboardingIfNeeded(
  api: OpenClawPluginApi,
  config: { baseUrl: string; agentId: string; apiKey: string },
): Promise<void> {
  const complete = await isOnboardingComplete(api, config);
  if (complete) return;

  const dateStr = new Date().toISOString().slice(0, 10);
  const result = await dispatchToMainAgent(api, {
    prompt: buildOnboardingPrompt(),
    idempotencyKey: `index:onboarding:dispatch:${config.agentId}:${dateStr}`,
  });

  if (result.delivered) {
    api.logger.info('Onboarding prompt dispatched to main agent.', { agentId: config.agentId });
  } else {
    api.logger.warn('Onboarding prompt dispatch failed — will retry on next gateway restart.', {
      agentId: config.agentId,
      error: result.error,
    });
  }
}
```

- [ ] **Step 4: Update `_resetForTesting` to include onboarding status reset**

Find the existing `_resetForTesting` export at the bottom of `index.ts` and add `_resetOnboardingStatus()`:

```ts
export function _resetForTesting(): void {
  registered = false;
  _resetOnboardingStatus();
  negotiatorPoller._resetForTesting();
  negotiatorScheduler._resetForTesting();
  dailyDigestScheduler._resetForTesting();
  ambientDiscoveryPoller._resetForTesting();
  ambientDiscoveryScheduler._resetForTesting();
  testMessageScheduler._resetForTesting();
  acceptedOpportunityPoller._resetForTesting();
  acceptedOpportunityScheduler._resetForTesting();
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd packages/openclaw-plugin && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run full plugin test suite**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all existing tests pass (the new setTimeout fires after a 5s delay, so it won't interfere with synchronous tests).

- [ ] **Step 7: Commit**

```bash
git add packages/openclaw-plugin/src/index.ts
git -c commit.gpgsign=false commit -m "feat(openclaw-plugin): dispatch onboarding prompt on startup when onboarding not complete"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run full backend typecheck**

```bash
cd backend && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run full plugin test suite**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests pass.

- [ ] **Step 3: Run plugin typecheck**

```bash
cd packages/openclaw-plugin && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Update the Linear issue IND-248 to In Progress → Done once merged**

Mark IND-248 as Done in Linear after the PR merges.
