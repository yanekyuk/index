# Delivery Dispatcher — Unified Channel Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all user-visible output in the openclaw plugin through `dispatchDelivery`, which is the only place that sets `deliver: true`, and inject channel-aware styling so evaluator prompts contain zero formatting language.

**Architecture:** Two-phase pipeline — evaluator subagents run with `deliver: false` in their own session, then `waitForRun` + `getSessionMessages` captures the output, which is passed to `dispatchDelivery`. The dispatcher reads the delivery channel from config, builds a composable prompt (temporal awareness + channel style + content-type context + content), and runs the delivery subagent with `deliver: true`. The delivery session is shared across all content types, giving the dispatcher full history for duplicate suppression.

**Tech Stack:** Bun, TypeScript, bun:test, OpenClaw plugin SDK (`api.runtime.subagent.run / waitForRun / getSessionMessages`)

---

## File Map

| File | Change |
|---|---|
| `packages/openclaw-plugin/src/lib/openclaw/plugin-api.ts` | Add `WaitForRunOptions`, `GetSessionMessagesOptions`, `SessionMessage` types; add `waitForRun` + `getSessionMessages` to `SubagentRuntime` |
| `packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts` | Replace `deliveryPrompt` with `buildDispatcherPrompt(channel, contentType, content)` |
| `packages/openclaw-plugin/src/lib/delivery/delivery.dispatcher.ts` | Replace `DeliveryRequest` shape; `dispatchDelivery` reads channel from config, calls `buildDispatcherPrompt` |
| `packages/openclaw-plugin/src/polling/test-message/test-message.poller.ts` | Call `dispatchDelivery` with new `{ contentType, content, idempotencyKey }` shape |
| `packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts` | Strip all formatting/styling language |
| `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts` | Refactor to two-phase: evaluator (`deliver: false`) → `waitForRun` → `getSessionMessages` → `dispatchDelivery` |
| `packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts` | Strip all formatting/styling language |
| `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts` | Same two-phase refactor |
| `packages/openclaw-plugin/src/tests/delivery.dispatcher.spec.ts` | Rewrite for new `DeliveryRequest` shape |
| `packages/openclaw-plugin/src/tests/test-message-pickup.spec.ts` | Minor update — remove message content assertions based on old headline/body |
| `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts` | Update `buildFakeApi` for two-phase; rewrite affected tests |
| `packages/openclaw-plugin/src/tests/daily-digest.test.ts` | Update mock for two-phase; rewrite affected tests |
| `packages/openclaw-plugin/src/tests/digest-evaluator.prompt.test.ts` | No change expected (doesn't test formatting language) |
| `packages/openclaw-plugin/package.json` | Version bump |
| `packages/openclaw-plugin/openclaw.plugin.json` | Version bump (must match `package.json`) |

---

## Task 1: Extend SubagentRuntime with waitForRun and getSessionMessages

**Files:**
- Modify: `packages/openclaw-plugin/src/lib/openclaw/plugin-api.ts`

No new test needed — this is a pure type extension. Existing tests use `as OpenClawPluginApi` casts so they continue to compile without adding the new methods to their mocks.

- [ ] **Step 1: Add the new types and methods to plugin-api.ts**

Open `packages/openclaw-plugin/src/lib/openclaw/plugin-api.ts` and replace the `SubagentRuntime` interface block (lines 17–36) with:

```ts
export interface SubagentRunOptions {
  sessionKey: string;
  idempotencyKey: string;
  message: string;
  provider?: string;
  model?: string;
  deliver?: boolean;
}

export interface SubagentRunResult {
  runId: string;
}

export interface WaitForRunOptions {
  runId: string;
  timeoutMs: number;
}

export interface GetSessionMessagesOptions {
  sessionKey: string;
  limit?: number;
}

export interface SessionMessage {
  role: string;
  content: string;
}

export interface SubagentRuntime {
  run(options: SubagentRunOptions): Promise<SubagentRunResult>;
  waitForRun(options: WaitForRunOptions): Promise<{ result: unknown }>;
  getSessionMessages(options: GetSessionMessagesOptions): Promise<{ messages: SessionMessage[] }>;
}
```

- [ ] **Step 2: Run existing tests to confirm no regressions**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests pass (the `as OpenClawPluginApi` casts in test mocks mean missing methods don't cause TypeScript errors, and none of the existing tests call the new methods).

- [ ] **Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/lib/openclaw/plugin-api.ts
git commit -m "feat(openclaw-plugin): extend SubagentRuntime with waitForRun and getSessionMessages"
```

---

## Task 2: Refactor delivery.prompt.ts and delivery.dispatcher.ts

**Files:**
- Modify: `packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts`
- Modify: `packages/openclaw-plugin/src/lib/delivery/delivery.dispatcher.ts`
- Modify: `packages/openclaw-plugin/src/tests/delivery.dispatcher.spec.ts`

- [ ] **Step 1: Rewrite delivery.dispatcher.spec.ts with tests for the new interface**

Replace the entire contents of `packages/openclaw-plugin/src/tests/delivery.dispatcher.spec.ts` with:

```ts
import { describe, expect, mock, test } from 'bun:test';

import { dispatchDelivery } from '../lib/delivery/delivery.dispatcher.js';
import type { OpenClawPluginApi, SubagentRunResult } from '../lib/openclaw/plugin-api.js';

function makeApi(
  runResult: SubagentRunResult,
  pluginConfig: Record<string, unknown> = { deliveryChannel: 'telegram', deliveryTarget: '69340471' },
  configGetModel?: unknown,
): OpenClawPluginApi {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    pluginConfig,
    runtime: {
      subagent: {
        run: mock(() => Promise.resolve(runResult)),
        waitForRun: mock(() => Promise.resolve({ result: null })),
        getSessionMessages: mock(() => Promise.resolve({ messages: [] })),
      },
    },
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
    registerHttpRoute: mock(() => {}),
    ...(configGetModel !== undefined && {
      configGet: async () => configGetModel,
    }),
  } as OpenClawPluginApi;
}

describe('dispatchDelivery', () => {
  test('calls subagent.run with deliver:true and correct sessionKey', async () => {
    const api = makeApi({ runId: 'run-abc-123' });

    const result = await dispatchDelivery(api, {
      contentType: 'ambient_discovery',
      content: 'Alice is looking for a TypeScript engineer.',
      idempotencyKey: 'idem-001',
    });

    expect(result).toEqual({ runId: 'run-abc-123' });
    expect(api.runtime.subagent.run).toHaveBeenCalledTimes(1);

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.sessionKey).toBe('agent:main:telegram:direct:69340471');
    expect(call.idempotencyKey).toBe('idem-001');
    expect(call.deliver).toBe(true);
    expect(call.message).toContain('Alice is looking for a TypeScript engineer.');
  });

  test('prompt includes channel style block', async () => {
    const api = makeApi({ runId: 'run-channel' });

    await dispatchDelivery(api, {
      contentType: 'test_message',
      content: 'Hello world',
      idempotencyKey: 'idem-channel',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.message).toContain('Telegram');
    expect(call.message).toContain('Hello world');
  });

  test('prompt includes content-type context for daily_digest', async () => {
    const api = makeApi({ runId: 'run-ct-digest' });

    await dispatchDelivery(api, {
      contentType: 'daily_digest',
      content: 'Three opportunities today.',
      idempotencyKey: 'idem-digest',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.message).toContain('daily digest');
    expect(call.message).toContain('Three opportunities today.');
  });

  test('prompt includes content-type context for ambient_discovery', async () => {
    const api = makeApi({ runId: 'run-ct-ambient' });

    await dispatchDelivery(api, {
      contentType: 'ambient_discovery',
      content: 'New match found.',
      idempotencyKey: 'idem-ambient',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.message).toContain('ambient');
    expect(call.message).toContain('New match found.');
  });

  test('prompt includes temporal awareness instructions', async () => {
    const api = makeApi({ runId: 'run-temporal' });

    await dispatchDelivery(api, {
      contentType: 'ambient_discovery',
      content: 'New match.',
      idempotencyKey: 'idem-temporal',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.message).toContain('conversation history');
  });

  test('passes model string from configGet to subagent', async () => {
    const api = makeApi({ runId: 'run-model-1' }, undefined, 'anthropic/claude-sonnet-4-6');

    await dispatchDelivery(api, {
      contentType: 'test_message',
      content: 'hi',
      idempotencyKey: 'idem-model-1',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.model).toBe('anthropic/claude-sonnet-4-6');
  });

  test('passes primary from configGet object to subagent', async () => {
    const api = makeApi({ runId: 'run-model-2' }, undefined, { primary: 'anthropic/claude-opus-4-6' });

    await dispatchDelivery(api, {
      contentType: 'test_message',
      content: 'hi',
      idempotencyKey: 'idem-model-2',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.model).toBe('anthropic/claude-opus-4-6');
  });

  test('passes undefined model when configGet is absent', async () => {
    const api = makeApi({ runId: 'run-model-3' });

    await dispatchDelivery(api, {
      contentType: 'test_message',
      content: 'hi',
      idempotencyKey: 'idem-model-3',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.model).toBeUndefined();
  });

  test('returns null and skips subagent.run when deliveryChannel is missing', async () => {
    const api = makeApi({ runId: 'unused' }, { deliveryTarget: '123' });

    const result = await dispatchDelivery(api, {
      contentType: 'test_message',
      content: 'hi',
      idempotencyKey: 'idem-003',
    });

    expect(result).toBeNull();
    expect(api.runtime.subagent.run).not.toHaveBeenCalled();
    expect(api.logger.warn).toHaveBeenCalled();
  });

  test('returns null and skips subagent.run when deliveryTarget is missing', async () => {
    const api = makeApi({ runId: 'unused' }, { deliveryChannel: 'telegram' });

    const result = await dispatchDelivery(api, {
      contentType: 'test_message',
      content: 'hi',
      idempotencyKey: 'idem-004',
    });

    expect(result).toBeNull();
    expect(api.runtime.subagent.run).not.toHaveBeenCalled();
    expect(api.logger.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
cd packages/openclaw-plugin && bun test src/tests/delivery.dispatcher.spec.ts
```

Expected: FAIL — `dispatchDelivery` still expects `rendered: { headline, body }` and `buildDispatcherPrompt` does not exist yet.

- [ ] **Step 3: Replace delivery.prompt.ts**

Replace the entire contents of `packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts` with:

```ts
export type DeliveryContentType =
  | 'ambient_discovery'
  | 'daily_digest'
  | 'test_message'
  | 'negotiation_accept';

export function buildDispatcherPrompt(
  channel: string,
  contentType: DeliveryContentType,
  content: string,
): string {
  return [
    'You are delivering a message to the user via their active OpenClaw gateway.',
    'Before delivering, scan your conversation history.',
    'If the same or highly similar content was already sent recently, skip it.',
    'Prioritize novelty — only deliver what adds new value to the user.',
    '',
    channelStyleBlock(channel),
    '',
    contentTypeContextBlock(contentType),
    '',
    '===== CONTENT =====',
    content,
    '===== END CONTENT =====',
  ].join('\n');
}

function channelStyleBlock(channel: string): string {
  if (channel === 'telegram') {
    return [
      'CHANNEL: Telegram',
      'Format: concise and chat-friendly, no markdown tables, use **bold** for headlines where appropriate.',
    ].join('\n');
  }
  return `CHANNEL: ${channel}`;
}

function contentTypeContextBlock(contentType: DeliveryContentType): string {
  switch (contentType) {
    case 'ambient_discovery':
      return 'CONTENT TYPE: Real-time ambient opportunity alert. Surface only signal-rich matches concisely.';
    case 'daily_digest':
      return 'CONTENT TYPE: Scheduled daily digest of ranked opportunities. Present as a structured summary.';
    case 'test_message':
      return 'CONTENT TYPE: Delivery verification message — relay faithfully as-is.';
    case 'negotiation_accept':
      return 'CONTENT TYPE: Negotiation outcome notification — one short natural sentence.';
  }
}
```

- [ ] **Step 4: Replace delivery.dispatcher.ts**

Replace the entire contents of `packages/openclaw-plugin/src/lib/delivery/delivery.dispatcher.ts` with:

```ts
import type { OpenClawPluginApi, SubagentRunResult } from '../openclaw/plugin-api.js';
import { readModel } from '../openclaw/plugin-api.js';
import { type DeliveryContentType, buildDispatcherPrompt } from './delivery.prompt.js';

export type { DeliveryContentType };

export interface DeliveryRequest {
  contentType: DeliveryContentType;
  content: string;
  /** Stable per-message key for OpenClaw idempotency. */
  idempotencyKey: string;
}

/**
 * Builds the OpenClaw session key for the user's configured delivery channel.
 * Returns `null` when `deliveryChannel` or `deliveryTarget` is not configured.
 */
export function buildDeliverySessionKey(api: OpenClawPluginApi): string | null {
  const channel = readConfigString(api, 'deliveryChannel');
  const target = readConfigString(api, 'deliveryTarget');
  if (!channel || !target) return null;
  return `agent:main:${channel}:direct:${target}`;
}

/**
 * Dispatches content to the user's configured OpenClaw channel.
 *
 * Reads `deliveryChannel` and `deliveryTarget` from plugin config to build the
 * session key and select the channel style. Returns `null` when routing is not
 * configured — the caller should NOT confirm delivery in that case.
 *
 * @param api - OpenClaw plugin API.
 * @param request - Content type, content, and idempotency key.
 * @returns The subagent run result, or `null` if delivery routing is missing.
 */
export async function dispatchDelivery(
  api: OpenClawPluginApi,
  request: DeliveryRequest,
): Promise<SubagentRunResult | null> {
  const channel = readConfigString(api, 'deliveryChannel');
  const target = readConfigString(api, 'deliveryTarget');

  if (!channel || !target) {
    api.logger.warn(
      'Index Network delivery routing not configured — skipping subagent dispatch. ' +
        'Set pluginConfig.deliveryChannel (e.g. "telegram") and pluginConfig.deliveryTarget ' +
        '(e.g. the channel-specific recipient ID like a Telegram chat ID).',
    );
    return null;
  }

  const sessionKey = `agent:main:${channel}:direct:${target}`;
  const model = await readModel(api);

  return api.runtime.subagent.run({
    sessionKey,
    idempotencyKey: request.idempotencyKey,
    message: buildDispatcherPrompt(channel, request.contentType, request.content),
    deliver: true,
    model,
  });
}

function readConfigString(api: OpenClawPluginApi, key: string): string {
  const val = api.pluginConfig[key];
  return typeof val === 'string' ? val : '';
}
```

- [ ] **Step 5: Run the new tests to confirm they pass**

```bash
cd packages/openclaw-plugin && bun test src/tests/delivery.dispatcher.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: `test-message-pickup.spec.ts` may fail because `test-message.poller.ts` still calls `dispatchDelivery` with the old `rendered` shape. That's expected — it will be fixed in Task 3. All other tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts \
        packages/openclaw-plugin/src/lib/delivery/delivery.dispatcher.ts \
        packages/openclaw-plugin/src/tests/delivery.dispatcher.spec.ts
git commit -m "feat(openclaw-plugin): refactor delivery dispatcher — composable channel-aware prompt"
```

---

## Task 3: Update test-message.poller.ts to new DeliveryRequest shape

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/test-message/test-message.poller.ts`
- Modify: `packages/openclaw-plugin/src/tests/test-message-pickup.spec.ts`

- [ ] **Step 1: Update test-message-pickup.spec.ts**

In `packages/openclaw-plugin/src/tests/test-message-pickup.spec.ts`, the test `'200 response → dispatches subagent with deliver: true...'` currently does not assert on message content, so it requires no change. However, the `buildFakeApi` needs `waitForRun` and `getSessionMessages` added to prevent TypeScript errors when the interface is fully checked. Replace the `api` object's `runtime.subagent` block:

```ts
runtime: {
  subagent: {
    run: async (opts) => {
      subagentCalls.push(opts);
      return { runId: 'fake-run-id' };
    },
    waitForRun: async () => ({ result: null }),
    getSessionMessages: async () => ({ messages: [] }),
  },
},
```

- [ ] **Step 2: Run test-message tests to confirm they still fail (from Task 2 regression)**

```bash
cd packages/openclaw-plugin && bun test src/tests/test-message-pickup.spec.ts
```

Expected: FAIL — `test-message.poller.ts` still passes `rendered` to `dispatchDelivery`.

- [ ] **Step 3: Update test-message.poller.ts**

Replace the `dispatchDelivery` call in `packages/openclaw-plugin/src/polling/test-message/test-message.poller.ts`:

```ts
const dispatchResult = await dispatchDelivery(api, {
  contentType: 'test_message',
  content: body.content,
  idempotencyKey: `index:delivery:test:${body.id}:${body.reservationToken}`,
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/openclaw-plugin && bun test src/tests/test-message-pickup.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/polling/test-message/test-message.poller.ts \
        packages/openclaw-plugin/src/tests/test-message-pickup.spec.ts
git commit -m "fix(openclaw-plugin): update test-message poller to new DeliveryRequest shape"
```

---

## Task 4: Strip formatting language from opportunity-evaluator.prompt.ts

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts`

No test changes needed — the existing prompt tests don't assert on formatting/styling language.

- [ ] **Step 1: Replace the formatting block in opportunityEvaluatorPrompt**

In `packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts`, find the formatting section near the end of the prompt array and replace:

```ts
    'Format the delivery message as:',
    '  - One paragraph per chosen opportunity',
    '  - **Bold headline**, one-sentence summary, suggested next step',
    '  - Telegram-friendly (concise, no markdown tables)',
    '',
    'If no opportunity passes the bar: produce absolutely no output and call no tools.',
```

with:

```ts
    'For each chosen opportunity output: headline, one-sentence summary, and suggested next step.',
    'If no opportunity passes the bar: produce absolutely no output and call no tools.',
```

Also update STEP 3 instruction line from:
```ts
    '  3. Finally, emit the composed message as your output (this is what the user sees).',
```
to:
```ts
    '  3. Finally, emit the composed content as your output.',
```

- [ ] **Step 2: Run opportunity prompt tests**

```bash
cd packages/openclaw-plugin && bun test src/tests/opportunity-batch.spec.ts
```

Expected: tests that check for `deliver: true` on `subagentCalls[0]` will still pass (those tests check the ambient-discovery poller, which hasn't changed yet). The prompt still contains candidate data.

- [ ] **Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts
git commit -m "refactor(openclaw-plugin): strip channel formatting from opportunity evaluator prompt"
```

---

## Task 5: Refactor ambient-discovery.poller.ts to two-phase pipeline

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts`
- Modify: `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts`

- [ ] **Step 1: Rewrite opportunity-batch.spec.ts for two-phase behavior**

Replace the entire contents of `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { handle as handleOpportunityBatch, _resetForTesting } from '../polling/ambient-discovery/ambient-discovery.poller.js';
import type { OpenClawPluginApi, SubagentRunOptions } from '../lib/openclaw/plugin-api.js';

interface FakeApi {
  api: OpenClawPluginApi;
  subagentCalls: SubagentRunOptions[];
  waitForRunCalls: Array<{ runId: string; timeoutMs: number }>;
  getSessionMessagesCalls: string[];
  logger: {
    warn: ReturnType<typeof mock>;
    error: ReturnType<typeof mock>;
    info: ReturnType<typeof mock>;
    debug: ReturnType<typeof mock>;
  };
}

function buildFakeApi(
  deliveryConfigured = true,
  configGetModel?: unknown,
  evaluatorContent = 'Opportunity: Alice is a TypeScript engineer.',
): FakeApi {
  const subagentCalls: SubagentRunOptions[] = [];
  const waitForRunCalls: Array<{ runId: string; timeoutMs: number }> = [];
  const getSessionMessagesCalls: string[] = [];
  const logger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };

  const api: OpenClawPluginApi = {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: deliveryConfigured
      ? { deliveryChannel: 'telegram', deliveryTarget: '69340471' }
      : {},
    runtime: {
      subagent: {
        run: async (opts) => {
          subagentCalls.push(opts);
          return { runId: `fake-run-id-${subagentCalls.length}` };
        },
        waitForRun: async (opts) => {
          waitForRunCalls.push(opts);
          return { result: null };
        },
        getSessionMessages: async ({ sessionKey }) => {
          getSessionMessagesCalls.push(sessionKey);
          return { messages: [{ role: 'assistant', content: evaluatorContent }] };
        },
      },
    },
    logger,
    registerHttpRoute: mock(() => {}),
    ...(configGetModel !== undefined && {
      configGet: async () => configGetModel,
    }),
  };

  return { api, subagentCalls, waitForRunCalls, getSessionMessagesCalls, logger };
}

const BASE_URL = 'http://localhost:3001';
const AGENT_ID = 'agent-123';
const API_KEY = 'test-api-key';

const SAMPLE_CANDIDATE = {
  opportunityId: 'opp-abc',
  rendered: {
    headline: 'Great match found',
    personalizedSummary: 'Alice is looking for a TypeScript engineer.',
    suggestedAction: 'Send a connection request to Alice.',
    narratorRemark: 'This looks like a perfect fit.',
  },
};

describe('handleOpportunityBatch', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    _resetForTesting();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    _resetForTesting();
  });

  test('returns false and no subagent when /pending returns empty array', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
  });

  test('returns false and logs warn when /pending returns non-2xx', async () => {
    global.fetch = mock(async () =>
      new Response('Internal Server Error', { status: 500 }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    expect(fake.logger.warn).toHaveBeenCalled();
  });

  test('returns false when delivery routing not configured', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi(false);
    const result = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    expect(fake.logger.warn).toHaveBeenCalled();
  });

  test('phase 1: evaluator runs with deliver:false on own session key', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fake.subagentCalls[0].deliver).toBe(false);
    expect(fake.subagentCalls[0].sessionKey).toBe(`index:ambient-discovery:${AGENT_ID}`);
  });

  test('phase 1: evaluator prompt contains candidate data', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    const message = fake.subagentCalls[0].message;
    expect(message).toContain(SAMPLE_CANDIDATE.opportunityId);
    expect(message).toContain(SAMPLE_CANDIDATE.rendered.headline);
    expect(message).toContain(SAMPLE_CANDIDATE.rendered.personalizedSummary);
    expect(message).toContain(SAMPLE_CANDIDATE.rendered.suggestedAction);
  });

  test('waitForRun is called with evaluator runId', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fake.waitForRunCalls).toHaveLength(1);
    expect(fake.waitForRunCalls[0].runId).toBe('fake-run-id-1');
    expect(fake.waitForRunCalls[0].timeoutMs).toBeGreaterThan(0);
  });

  test('getSessionMessages is called with evaluator session key', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fake.getSessionMessagesCalls).toHaveLength(1);
    expect(fake.getSessionMessagesCalls[0]).toBe(`index:ambient-discovery:${AGENT_ID}`);
  });

  test('phase 2: delivery subagent runs with deliver:true on telegram session key', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(true);
    expect(fake.subagentCalls).toHaveLength(2);
    expect(fake.subagentCalls[1].deliver).toBe(true);
    expect(fake.subagentCalls[1].sessionKey).toBe('agent:main:telegram:direct:69340471');
  });

  test('phase 2: delivery message contains evaluator output', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi(true, undefined, 'Evaluated: Alice is a great match.');
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fake.subagentCalls[1].message).toContain('Evaluated: Alice is a great match.');
  });

  test('returns false without dispatching delivery when evaluator produces no output', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi(true, undefined, ''); // empty evaluator output
    const result = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(1); // only evaluator, no delivery
  });

  test('idempotency keys are stable for the same batch regardless of order', async () => {
    const candidates = [SAMPLE_CANDIDATE, { ...SAMPLE_CANDIDATE, opportunityId: 'opp-xyz' }];

    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: candidates }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake1 = buildFakeApi();
    await handleOpportunityBatch(fake1.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    _resetForTesting();

    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [...candidates].reverse() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake2 = buildFakeApi();
    await handleOpportunityBatch(fake2.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fake1.subagentCalls[0].idempotencyKey).toBe(fake2.subagentCalls[0].idempotencyKey);
    expect(fake1.subagentCalls[1].idempotencyKey).toBe(fake2.subagentCalls[1].idempotencyKey);
  });

  test('passes model to both evaluator and delivery subagent', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi(true, 'anthropic/claude-sonnet-4-6');
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fake.subagentCalls[0].model).toBe('anthropic/claude-sonnet-4-6');
    expect(fake.subagentCalls[1].model).toBe('anthropic/claude-sonnet-4-6');
  });

  test('calls /api/agents/:agentId/opportunities/pending with GET', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      return new Response(JSON.stringify({ opportunities: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain(`/agents/${AGENT_ID}/opportunities/pending`);
    expect(fetchCalls[0].init?.method).toBe('GET');
  });

  test('does not re-launch subagents on second call with identical opportunity set', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const first = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });
    const second = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(fake.subagentCalls).toHaveLength(2); // only from first call
  });

  test('re-launches subagents when opportunity set changes', async () => {
    const SECOND_CANDIDATE = {
      opportunityId: 'opp-xyz',
      rendered: {
        headline: 'Another match',
        personalizedSummary: 'Bob is looking for a designer.',
        suggestedAction: 'Connect with Bob.',
        narratorRemark: 'Solid fit.',
      },
    };

    let callCount = 0;
    global.fetch = mock(async () => {
      callCount++;
      const opportunities = callCount === 1
        ? [SAMPLE_CANDIDATE]
        : [SAMPLE_CANDIDATE, SECOND_CANDIDATE];
      return new Response(JSON.stringify({ opportunities }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const first = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });
    const second = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(fake.subagentCalls).toHaveLength(4); // 2 per successful call
  });
});
```

- [ ] **Step 2: Run new tests to confirm they fail**

```bash
cd packages/openclaw-plugin && bun test src/tests/opportunity-batch.spec.ts
```

Expected: multiple failures — the poller still uses a single `deliver: true` subagent call.

- [ ] **Step 3: Rewrite ambient-discovery.poller.ts**

Replace the entire contents of `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts` with:

```ts
import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { readModel } from '../../lib/openclaw/plugin-api.js';
import { buildDeliverySessionKey, dispatchDelivery } from '../../lib/delivery/delivery.dispatcher.js';
import { opportunityEvaluatorPrompt } from './opportunity-evaluator.prompt.js';

/** Milliseconds to wait for the evaluator subagent to complete. */
const EVALUATOR_TIMEOUT_MS = 120_000;

/** Hash of the last opportunity batch dispatched. Used to skip unchanged batches. */
let lastOpportunityBatchHash: string | null = null;

export interface AmbientDiscoveryConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

/**
 * Handles one ambient discovery poll cycle using a two-phase pipeline:
 *
 * Phase 1 — Evaluator subagent (deliver: false, own session):
 *   Evaluates candidates, calls confirm_opportunity_delivery for selected ones,
 *   outputs plain content with no formatting instructions.
 *
 * Phase 2 — Delivery (via dispatchDelivery):
 *   Captures evaluator output via waitForRun + getSessionMessages, then
 *   dispatches it through the delivery dispatcher which applies channel styling.
 *
 * @param api - The OpenClaw plugin API instance.
 * @param config - Configuration for the ambient discovery poller.
 * @returns `true` if delivery was dispatched, `false` otherwise.
 */
export async function handle(
  api: OpenClawPluginApi,
  config: AmbientDiscoveryConfig,
): Promise<boolean> {
  const pendingUrl = `${config.baseUrl}/api/agents/${config.agentId}/opportunities/pending`;

  let res: Response;
  try {
    res = await fetch(pendingUrl, {
      method: 'GET',
      headers: { 'x-api-key': config.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    api.logger.warn(
      `Opportunity pending fetch errored: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    api.logger.warn(`Opportunity pending fetch failed: ${res.status} ${text}`);
    return false;
  }

  const body = (await res.json()) as {
    opportunities: Array<{
      opportunityId: string;
      rendered: {
        headline: string;
        personalizedSummary: string;
        suggestedAction: string;
        narratorRemark: string;
      };
    }>;
  };

  if (!body.opportunities.length) {
    return false;
  }

  // Fail fast before running the evaluator if delivery is not configured.
  if (!buildDeliverySessionKey(api)) {
    api.logger.warn(
      'Index Network delivery routing not configured — skipping opportunity batch. ' +
        'Set pluginConfig.deliveryChannel and pluginConfig.deliveryTarget.',
    );
    return false;
  }

  const batchHash = hashOpportunityBatch(body.opportunities.map((o) => o.opportunityId));

  if (batchHash === lastOpportunityBatchHash) {
    api.logger.debug('Opportunity batch unchanged since last poll — skipping subagent.');
    return false;
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const model = await readModel(api);
  const evaluatorSessionKey = `index:ambient-discovery:${config.agentId}`;

  // Phase 1: run evaluator silently in its own session.
  let runId: string;
  try {
    const evalResult = await api.runtime.subagent.run({
      sessionKey: evaluatorSessionKey,
      idempotencyKey: `index:eval:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
      message: opportunityEvaluatorPrompt(
        body.opportunities.map((o) => ({
          opportunityId: o.opportunityId,
          headline: o.rendered.headline,
          personalizedSummary: o.rendered.personalizedSummary,
          suggestedAction: o.rendered.suggestedAction,
          narratorRemark: o.rendered.narratorRemark,
        })),
      ),
      deliver: false,
      model,
    });
    runId = evalResult.runId;
  } catch (err) {
    api.logger.warn(
      `Opportunity evaluator dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  // Wait for the evaluator to finish.
  try {
    await api.runtime.subagent.waitForRun({ runId, timeoutMs: EVALUATOR_TIMEOUT_MS });
  } catch (err) {
    api.logger.warn(
      `Opportunity evaluator timed out or failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  // Capture evaluator output — the last assistant message in the session.
  const { messages } = await api.runtime.subagent.getSessionMessages({
    sessionKey: evaluatorSessionKey,
    limit: 10,
  });
  const content = messages.filter((m) => m.role === 'assistant').at(-1)?.content ?? '';

  if (!content) {
    api.logger.debug('Opportunity evaluator produced no output — skipping delivery.');
    lastOpportunityBatchHash = batchHash;
    return false;
  }

  // Phase 2: dispatch to user via delivery dispatcher.
  const dispatchResult = await dispatchDelivery(api, {
    contentType: 'ambient_discovery',
    content,
    idempotencyKey: `index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
  });

  if (dispatchResult === null) {
    return false;
  }

  lastOpportunityBatchHash = batchHash;

  api.logger.info(
    `Opportunity batch dispatched: ${body.opportunities.length} candidate(s) evaluated`,
    { agentId: config.agentId },
  );

  return true;
}

function hashOpportunityBatch(ids: string[]): string {
  const str = [...ids].sort().join(',');
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  lastOpportunityBatchHash = null;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/openclaw-plugin && bun test src/tests/opportunity-batch.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts \
        packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts \
        packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts
git commit -m "feat(openclaw-plugin): refactor ambient-discovery poller to two-phase eval+dispatch pipeline"
```

---

## Task 6: Strip formatting language from digest-evaluator.prompt.ts

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts`

- [ ] **Step 1: Remove the formatting block from digestEvaluatorPrompt**

In `packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts`, find the format block near the end of the prompt array and replace:

```ts
    'Format the digest message as:',
    '  - Start with "📬 **Daily Digest**" header',
    '  - One numbered entry per opportunity',
    '  - **Bold headline**, one-sentence summary, suggested next step',
    '  - Telegram-friendly (concise, no markdown tables)',
    '',
    'If there are no candidates: produce absolutely no output and call no tools.',
```

with:

```ts
    'For each chosen opportunity output: headline, one-sentence summary, and suggested next step.',
    'If there are no candidates: produce absolutely no output and call no tools.',
```

Also update STEP 3 instruction from:
```ts
    `  3. Finally, emit the composed message as your output (this is what the user sees).`,
```
to:
```ts
    `  3. Finally, emit the composed content as your output.`,
```

- [ ] **Step 2: Run digest prompt tests to confirm no regressions**

```bash
cd packages/openclaw-plugin && bun test src/tests/digest-evaluator.prompt.test.ts
```

Expected: all tests PASS — they only check for `rank`, `top N`, `opportunityId`, and `allowed IDs`, none of which were removed.

- [ ] **Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts
git commit -m "refactor(openclaw-plugin): strip channel formatting from daily digest evaluator prompt"
```

---

## Task 7: Refactor daily-digest.poller.ts to two-phase pipeline

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts`
- Modify: `packages/openclaw-plugin/src/tests/daily-digest.test.ts`

- [ ] **Step 1: Rewrite daily-digest.test.ts for two-phase behavior**

Replace the entire contents of `packages/openclaw-plugin/src/tests/daily-digest.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handle as handleDailyDigest } from '../polling/daily-digest/daily-digest.poller.js';
import type { OpenClawPluginApi, SubagentRunOptions } from '../lib/openclaw/plugin-api.js';

describe('handleDailyDigest', () => {
  let mockApi: OpenClawPluginApi;
  let subagentRunCalls: SubagentRunOptions[];
  let originalFetch: typeof global.fetch;

  const EVALUATOR_CONTENT = 'Digest: opp-1 matches your goals. opp-2 is also relevant.';

  beforeEach(() => {
    subagentRunCalls = [];
    originalFetch = global.fetch;

    mockApi = {
      id: 'test-plugin',
      name: 'Test Plugin',
      pluginConfig: {
        deliveryChannel: 'telegram',
        deliveryTarget: '12345',
      },
      runtime: {
        subagent: {
          run: mock(async (opts) => {
            subagentRunCalls.push(opts);
            return { runId: `run-${subagentRunCalls.length}` };
          }),
          waitForRun: mock(async () => ({ result: null })),
          getSessionMessages: mock(async () => ({
            messages: [{ role: 'assistant', content: EVALUATOR_CONTENT }],
          })),
        },
      },
      logger: {
        debug: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
      },
      registerHttpRoute: mock(() => {}),
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('phase 1: evaluator runs with deliver:false on daily-digest session key', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', rendered: { headline: 'H1', personalizedSummary: 'S1', suggestedAction: 'A1', narratorRemark: '' } },
          { opportunityId: 'opp-2', rendered: { headline: 'H2', personalizedSummary: 'S2', suggestedAction: 'A2', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      maxCount: 5,
    });

    expect(subagentRunCalls[0].deliver).toBe(false);
    expect(subagentRunCalls[0].sessionKey).toMatch(/^index:daily-digest:agent-123:\d{4}-\d{2}-\d{2}$/);
  });

  it('phase 1: evaluator prompt contains top-N instruction and candidate data', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', rendered: { headline: 'H1', personalizedSummary: 'S1', suggestedAction: 'A1', narratorRemark: '' } },
          { opportunityId: 'opp-2', rendered: { headline: 'H2', personalizedSummary: 'S2', suggestedAction: 'A2', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      maxCount: 5,
    });

    expect(subagentRunCalls[0].message).toContain('daily digest');
    expect(subagentRunCalls[0].message).toContain('top 2'); // min(5, 2 available)
    expect(subagentRunCalls[0].message).toContain('opp-1');
    expect(subagentRunCalls[0].message).toContain('opp-2');
  });

  it('phase 2: delivery subagent runs with deliver:true on telegram session key', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', rendered: { headline: 'H1', personalizedSummary: 'S1', suggestedAction: 'A1', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      maxCount: 5,
    });

    expect(result).toBe(true);
    expect(subagentRunCalls).toHaveLength(2);
    expect(subagentRunCalls[1].deliver).toBe(true);
    expect(subagentRunCalls[1].sessionKey).toBe('agent:main:telegram:direct:12345');
  });

  it('delivery idempotency key contains daily-digest and a date', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', rendered: { headline: 'H1', personalizedSummary: 'S1', suggestedAction: 'A1', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      maxCount: 5,
    });

    expect(subagentRunCalls[1].idempotencyKey).toContain('daily-digest');
    expect(subagentRunCalls[1].idempotencyKey).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('phase 2: delivery message contains evaluator output', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', rendered: { headline: 'H1', personalizedSummary: 'S1', suggestedAction: 'A1', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      maxCount: 5,
    });

    expect(subagentRunCalls[1].message).toContain(EVALUATOR_CONTENT);
  });

  it('returns false when no opportunities pending', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      maxCount: 10,
    });

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(0);
  });

  it('returns false when delivery routing not configured', async () => {
    mockApi.pluginConfig = {};

    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      maxCount: 10,
    });

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(0);
  });

  it('returns false on fetch network error', async () => {
    global.fetch = mock(async () => { throw new Error('Network error'); }) as unknown as typeof fetch;

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      maxCount: 10,
    });

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(0);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });

  it('returns false on non-200 response', async () => {
    global.fetch = mock(async () =>
      new Response('Internal Server Error', { status: 500 }),
    ) as unknown as typeof fetch;

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      maxCount: 10,
    });

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(0);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });

  it('returns false when evaluator subagent dispatch throws', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    mockApi.runtime.subagent.run = mock(async () => { throw new Error('Subagent runtime error'); });

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      maxCount: 10,
    });

    expect(result).toBe(false);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run new tests to confirm they fail**

```bash
cd packages/openclaw-plugin && bun test src/tests/daily-digest.test.ts
```

Expected: multiple failures — the poller still uses a single `deliver: true` subagent call.

- [ ] **Step 3: Rewrite daily-digest.poller.ts**

Replace the entire contents of `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts` with:

```ts
import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { readModel } from '../../lib/openclaw/plugin-api.js';
import { buildDeliverySessionKey, dispatchDelivery } from '../../lib/delivery/delivery.dispatcher.js';
import { digestEvaluatorPrompt } from './digest-evaluator.prompt.js';

/** Milliseconds to wait for the evaluator subagent to complete. */
const EVALUATOR_TIMEOUT_MS = 120_000;

export interface DailyDigestConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  maxCount: number;
}

/**
 * Handles one daily digest cycle using a two-phase pipeline:
 *
 * Phase 1 — Evaluator subagent (deliver: false, date-scoped session):
 *   Ranks candidates by value, calls confirm_opportunity_delivery for top N,
 *   outputs plain content. Session key includes date so each day starts fresh.
 *
 * Phase 2 — Delivery (via dispatchDelivery):
 *   Captures evaluator output via waitForRun + getSessionMessages, then
 *   dispatches it through the delivery dispatcher which applies channel styling.
 *
 * @returns `true` if a digest was dispatched, `false` otherwise.
 */
export async function handle(
  api: OpenClawPluginApi,
  config: DailyDigestConfig,
): Promise<boolean> {
  const pendingUrl = `${config.baseUrl}/api/agents/${config.agentId}/opportunities/pending`;

  let res: Response;
  try {
    res = await fetch(pendingUrl, {
      method: 'GET',
      headers: { 'x-api-key': config.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    api.logger.warn(
      `Daily digest fetch errored: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    api.logger.warn(`Daily digest fetch failed: ${res.status} ${text}`);
    return false;
  }

  const body = (await res.json()) as {
    opportunities: Array<{
      opportunityId: string;
      rendered: {
        headline: string;
        personalizedSummary: string;
        suggestedAction: string;
        narratorRemark: string;
      };
    }>;
  };

  if (!body.opportunities.length) {
    api.logger.info('Daily digest: no pending opportunities');
    return false;
  }

  // Fail fast before running the evaluator if delivery is not configured.
  if (!buildDeliverySessionKey(api)) {
    api.logger.warn(
      'Daily digest: delivery routing not configured — skipping. ' +
        'Set pluginConfig.deliveryChannel and pluginConfig.deliveryTarget.',
    );
    return false;
  }

  const effectiveMax = Math.min(config.maxCount, body.opportunities.length);
  const batchHash = hashOpportunityBatch(body.opportunities.map((o) => o.opportunityId));
  const dateStr = new Date().toISOString().slice(0, 10);
  const model = await readModel(api);

  // Date-scoped session key — each day starts a fresh session with no carryover.
  const evaluatorSessionKey = `index:daily-digest:${config.agentId}:${dateStr}`;

  // Phase 1: run evaluator silently.
  let runId: string;
  try {
    const evalResult = await api.runtime.subagent.run({
      sessionKey: evaluatorSessionKey,
      idempotencyKey: `index:eval:daily-digest:${config.agentId}:${dateStr}:${batchHash}`,
      message: digestEvaluatorPrompt(
        body.opportunities.map((o) => ({
          opportunityId: o.opportunityId,
          headline: o.rendered.headline,
          personalizedSummary: o.rendered.personalizedSummary,
          suggestedAction: o.rendered.suggestedAction,
          narratorRemark: o.rendered.narratorRemark,
        })),
        effectiveMax,
      ),
      deliver: false,
      model,
    });
    runId = evalResult.runId;
  } catch (err) {
    api.logger.warn(
      `Daily digest evaluator dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  // Wait for the evaluator to finish.
  try {
    await api.runtime.subagent.waitForRun({ runId, timeoutMs: EVALUATOR_TIMEOUT_MS });
  } catch (err) {
    api.logger.warn(
      `Daily digest evaluator timed out or failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  // Capture evaluator output — the last assistant message in the session.
  const { messages } = await api.runtime.subagent.getSessionMessages({
    sessionKey: evaluatorSessionKey,
    limit: 10,
  });
  const content = messages.filter((m) => m.role === 'assistant').at(-1)?.content ?? '';

  if (!content) {
    api.logger.debug('Daily digest evaluator produced no output — skipping delivery.');
    return false;
  }

  // Phase 2: dispatch to user via delivery dispatcher.
  const dispatchResult = await dispatchDelivery(api, {
    contentType: 'daily_digest',
    content,
    idempotencyKey: `index:delivery:daily-digest:${config.agentId}:${dateStr}:${batchHash}`,
  });

  if (dispatchResult === null) {
    return false;
  }

  api.logger.info(
    `Daily digest dispatched: ${body.opportunities.length} candidate(s), max ${effectiveMax} delivered`,
    { agentId: config.agentId },
  );

  return true;
}

function hashOpportunityBatch(ids: string[]): string {
  const str = [...ids].sort().join(',');
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return (h >>> 0).toString(36);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/openclaw-plugin && bun test src/tests/daily-digest.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts \
        packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts \
        packages/openclaw-plugin/src/tests/daily-digest.test.ts
git commit -m "feat(openclaw-plugin): refactor daily-digest poller to two-phase eval+dispatch pipeline"
```

---

## Task 8: Full verification and version bump

**Files:**
- Modify: `packages/openclaw-plugin/package.json`
- Modify: `packages/openclaw-plugin/openclaw.plugin.json`

- [ ] **Step 1: Run the complete test suite**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run TypeScript type check**

```bash
cd packages/openclaw-plugin && npx tsc --noEmit
```

Expected: zero type errors.

- [ ] **Step 3: Bump version in package.json**

Open `packages/openclaw-plugin/package.json` and increment the `version` field by a minor version (e.g., `0.4.0` → `0.5.0`). The exact current version is in the file — increment the minor component.

- [ ] **Step 4: Bump version in openclaw.plugin.json to match**

Open `packages/openclaw-plugin/openclaw.plugin.json` and set `version` to the same value as `package.json`. These must match exactly — the OpenClaw CLI reads from `openclaw.plugin.json` and a mismatch makes installs look like no-ops.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/package.json packages/openclaw-plugin/openclaw.plugin.json
git commit -m "chore(openclaw-plugin): bump version for delivery dispatcher refactor"
```
