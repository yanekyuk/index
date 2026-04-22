# openclaw-plugin Domain-Driven Architecture Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `packages/openclaw-plugin/src/` into domain-driven folders — `lib/`, `setup/`, and `polling/{negotiator,daily-digest,ambient-discovery,test-message}/` — with each domain owning its poller, scheduler, and prompts.

**Architecture:** `index.ts` becomes pure wiring (config, HTTP routes, scheduler startup, CLI registration). Each of the four polling domains is a self-contained folder with a `.poller.ts`, a `.scheduler.ts`, and its prompt files. Shared infrastructure lives in `lib/`. This is a structural refactor only — no logic or prompt content changes.

**Tech Stack:** TypeScript, Bun, OpenClaw plugin SDK (local type shims in `lib/openclaw/`)

**Spec:** `docs/superpowers/specs/2026-04-22-openclaw-plugin-ddd-refactor-design.md`

---

## File Map

### Created
| New path | Source |
|---|---|
| `src/lib/openclaw/plugin-api.ts` | moved from `src/plugin-api.ts` |
| `src/lib/delivery/delivery.dispatcher.ts` | moved from `src/delivery.dispatcher.ts` |
| `src/lib/delivery/delivery.prompt.ts` | moved from `src/prompts/delivery.prompt.ts` |
| `src/lib/utils/sanitize.ts` | moved from `src/prompts/sanitize.ts` |
| `src/setup/setup.cli.ts` | moved from `src/setup.cli.ts` |
| `src/polling/negotiator/negotiator.poller.ts` | extracted from `src/index.ts` (`handleNegotiationPickup`) |
| `src/polling/negotiator/negotiator.scheduler.ts` | extracted from `src/index.ts` (`scheduleNext`, backoff) |
| `src/polling/negotiator/negotiation-turn.prompt.ts` | moved+renamed from `src/prompts/turn.prompt.ts` |
| `src/polling/negotiator/negotiation-accepted.prompt.ts` | moved+renamed from `src/prompts/accepted.prompt.ts` |
| `src/polling/daily-digest/daily-digest.poller.ts` | extracted from `src/index.ts` (`handleDailyDigest`) |
| `src/polling/daily-digest/daily-digest.scheduler.ts` | merged from `src/digest.scheduler.ts` + scheduling logic in `index.ts` |
| `src/polling/daily-digest/digest-evaluator.prompt.ts` | moved from `src/prompts/digest-evaluator.prompt.ts` |
| `src/polling/ambient-discovery/ambient-discovery.poller.ts` | extracted from `src/index.ts` (`handleOpportunityBatch`) |
| `src/polling/ambient-discovery/ambient-discovery.scheduler.ts` | extracted from `src/index.ts` |
| `src/polling/ambient-discovery/opportunity-evaluator.prompt.ts` | moved from `src/prompts/opportunity-evaluator.prompt.ts` |
| `src/polling/test-message/test-message.poller.ts` | extracted from `src/index.ts` (`handleTestMessagePickup`) |
| `src/polling/test-message/test-message.scheduler.ts` | extracted from `src/index.ts` |

### Deleted
`src/plugin-api.ts`, `src/delivery.dispatcher.ts`, `src/setup.cli.ts`, `src/digest.scheduler.ts`, `src/prompts/turn.prompt.ts`, `src/prompts/accepted.prompt.ts`, `src/prompts/delivery.prompt.ts`, `src/prompts/digest-evaluator.prompt.ts`, `src/prompts/opportunity-evaluator.prompt.ts`, `src/prompts/sanitize.ts`

### Modified
`src/index.ts` — stripped to pure wiring; registers four HTTP routes (one per interval poller), starts all four schedulers  
`src/tests/index.spec.ts` — update import of `plugin-api`  
`src/tests/delivery.dispatcher.spec.ts` — update imports of `delivery.dispatcher` and `plugin-api`  
`src/tests/turn.prompt.spec.ts` — update import path  
`src/tests/accepted.prompt.spec.ts` — update import path  
`src/tests/digest.scheduler.test.ts` — update import path and function name  
`src/tests/digest-evaluator.prompt.test.ts` — update import path  
`src/tests/setup-entry.spec.ts` — update import path  
`src/tests/opportunity-batch.spec.ts` — update imports from `index.js` → `ambient-discovery.poller.js` and `plugin-api`  
`src/tests/test-message-pickup.spec.ts` — update imports from `index.js` → `test-message.poller.js` and `plugin-api`  
`src/tests/daily-digest.test.ts` — update imports from `index.js` → `daily-digest.poller.js` and `plugin-api`  

---

## Task 1: Create lib/ — shared infrastructure

**Files:**
- Create: `src/lib/openclaw/plugin-api.ts`
- Create: `src/lib/delivery/delivery.prompt.ts`
- Create: `src/lib/delivery/delivery.dispatcher.ts`
- Create: `src/lib/utils/sanitize.ts`
- Delete: `src/plugin-api.ts`, `src/delivery.dispatcher.ts`, `src/prompts/delivery.prompt.ts`, `src/prompts/sanitize.ts`
- Modify: `src/index.ts` (update imports)
- Modify: `src/tests/index.spec.ts`, `src/tests/delivery.dispatcher.spec.ts`

- [ ] **Step 1: Create `src/lib/openclaw/plugin-api.ts`**

Content is identical to the current `src/plugin-api.ts` — no changes to the file body.

```bash
mkdir -p packages/openclaw-plugin/src/lib/openclaw
cp packages/openclaw-plugin/src/plugin-api.ts packages/openclaw-plugin/src/lib/openclaw/plugin-api.ts
```

- [ ] **Step 2: Create `src/lib/delivery/delivery.prompt.ts`**

```bash
mkdir -p packages/openclaw-plugin/src/lib/delivery
cp packages/openclaw-plugin/src/prompts/delivery.prompt.ts packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts
```

- [ ] **Step 3: Create `src/lib/delivery/delivery.dispatcher.ts`**

Content is the same as current `src/delivery.dispatcher.ts` with one import updated:

```typescript
import type { OpenClawPluginApi, SubagentRunResult } from '../openclaw/plugin-api.js';
import { readModel } from '../openclaw/plugin-api.js';
import { deliveryPrompt } from './delivery.prompt.js';

export interface DeliveryRequest {
  rendered: { headline: string; body: string };
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
 * Dispatches a rendered card to the user's configured OpenClaw channel.
 *
 * Returns `null` when delivery routing is not configured — the caller should
 * NOT proceed to confirm delivery in that case.
 */
export async function dispatchDelivery(
  api: OpenClawPluginApi,
  request: DeliveryRequest,
): Promise<SubagentRunResult | null> {
  const sessionKey = buildDeliverySessionKey(api);

  if (!sessionKey) {
    api.logger.warn(
      'Index Network delivery routing not configured — skipping subagent dispatch. ' +
        'Set pluginConfig.deliveryChannel (e.g. "telegram") and pluginConfig.deliveryTarget ' +
        '(e.g. the channel-specific recipient ID like a Telegram chat ID).',
    );
    return null;
  }

  const model = await readModel(api);

  return api.runtime.subagent.run({
    sessionKey,
    idempotencyKey: request.idempotencyKey,
    message: deliveryPrompt(request.rendered),
    deliver: true,
    model,
  });
}

function readConfigString(api: OpenClawPluginApi, key: string): string {
  const val = api.pluginConfig[key];
  return typeof val === 'string' ? val : '';
}
```

- [ ] **Step 4: Create `src/lib/utils/sanitize.ts`**

```bash
mkdir -p packages/openclaw-plugin/src/lib/utils
cp packages/openclaw-plugin/src/prompts/sanitize.ts packages/openclaw-plugin/src/lib/utils/sanitize.ts
```

- [ ] **Step 5: Update `src/index.ts` imports**

Replace the old import lines at the top of `src/index.ts`:

```typescript
// OLD:
import type { OpenClawPluginApi } from './plugin-api.js';
import { readModel } from './plugin-api.js';
import { buildDeliverySessionKey, dispatchDelivery } from './delivery.dispatcher.js';

// NEW:
import type { OpenClawPluginApi } from './lib/openclaw/plugin-api.js';
import { readModel } from './lib/openclaw/plugin-api.js';
import { buildDeliverySessionKey, dispatchDelivery } from './lib/delivery/delivery.dispatcher.js';
```

- [ ] **Step 6: Update `src/tests/index.spec.ts` import**

```typescript
// OLD:
import type { OpenClawPluginApi, SubagentRunOptions } from '../plugin-api.js';

// NEW:
import type { OpenClawPluginApi, SubagentRunOptions } from '../lib/openclaw/plugin-api.js';
```

- [ ] **Step 7: Update `src/tests/delivery.dispatcher.spec.ts` imports**

```typescript
// OLD:
import { dispatchDelivery } from '../delivery.dispatcher.js';
import type { OpenClawPluginApi, SubagentRunResult } from '../plugin-api.js';

// NEW:
import { dispatchDelivery } from '../lib/delivery/delivery.dispatcher.js';
import type { OpenClawPluginApi, SubagentRunResult } from '../lib/openclaw/plugin-api.js';
```

- [ ] **Step 8: Update `src/tests/opportunity-batch.spec.ts` plugin-api import**

```typescript
// OLD:
import type { OpenClawPluginApi, SubagentRunOptions } from '../plugin-api.js';

// NEW:
import type { OpenClawPluginApi, SubagentRunOptions } from '../lib/openclaw/plugin-api.js';
```

- [ ] **Step 9: Update `src/tests/test-message-pickup.spec.ts` plugin-api import**

```typescript
// OLD:
import type { OpenClawPluginApi, SubagentRunOptions } from '../plugin-api.js';

// NEW:
import type { OpenClawPluginApi, SubagentRunOptions } from '../lib/openclaw/plugin-api.js';
```

- [ ] **Step 10: Update `src/tests/daily-digest.test.ts` plugin-api import**

```typescript
// OLD:
import type { OpenClawPluginApi } from '../plugin-api.js';

// NEW:
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';
```

- [ ] **Step 11: Delete old files**

```bash
rm packages/openclaw-plugin/src/plugin-api.ts
rm packages/openclaw-plugin/src/delivery.dispatcher.ts
rm packages/openclaw-plugin/src/prompts/delivery.prompt.ts
rm packages/openclaw-plugin/src/prompts/sanitize.ts
```

- [ ] **Step 12: Run tests**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests pass.

- [ ] **Step 13: Commit**

```bash
git add packages/openclaw-plugin/src/
git commit -m "refactor(openclaw-plugin): extract lib/openclaw, lib/delivery, lib/utils"
```

---

## Task 2: Create setup/

**Files:**
- Create: `src/setup/setup.cli.ts`
- Delete: `src/setup.cli.ts`
- Modify: `src/index.ts`, `src/tests/setup-entry.spec.ts`

- [ ] **Step 1: Move `setup.cli.ts`**

```bash
mkdir -p packages/openclaw-plugin/src/setup
cp packages/openclaw-plugin/src/setup.cli.ts packages/openclaw-plugin/src/setup/setup.cli.ts
```

No import changes needed — `setup.cli.ts` has no local imports.

- [ ] **Step 2: Update `src/index.ts` import**

```typescript
// OLD:
import { registerSetupCli } from './setup.cli.js';

// NEW:
import { registerSetupCli } from './setup/setup.cli.js';
```

- [ ] **Step 3: Update `src/tests/setup-entry.spec.ts` import**

```typescript
// OLD:
import { runSetup as setup } from '../setup.cli.js';

// NEW:
import { runSetup as setup } from '../setup/setup.cli.js';
```

- [ ] **Step 4: Delete old file**

```bash
rm packages/openclaw-plugin/src/setup.cli.ts
```

- [ ] **Step 5: Run tests**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/openclaw-plugin/src/
git commit -m "refactor(openclaw-plugin): move setup.cli into setup/"
```

---

## Task 3: Extract polling/negotiator/

**Files:**
- Create: `src/polling/negotiator/negotiation-turn.prompt.ts`
- Create: `src/polling/negotiator/negotiation-accepted.prompt.ts`
- Create: `src/polling/negotiator/negotiator.poller.ts`
- Create: `src/polling/negotiator/negotiator.scheduler.ts`
- Delete: `src/prompts/turn.prompt.ts`, `src/prompts/accepted.prompt.ts`
- Modify: `src/index.ts`, `src/tests/turn.prompt.spec.ts`, `src/tests/accepted.prompt.spec.ts`

- [ ] **Step 1: Create `src/polling/negotiator/negotiation-turn.prompt.ts`**

```bash
mkdir -p packages/openclaw-plugin/src/polling/negotiator
cp packages/openclaw-plugin/src/prompts/turn.prompt.ts \
   packages/openclaw-plugin/src/polling/negotiator/negotiation-turn.prompt.ts
```

No import changes needed — `turn.prompt.ts` has no local imports.

- [ ] **Step 2: Create `src/polling/negotiator/negotiation-accepted.prompt.ts`**

```bash
cp packages/openclaw-plugin/src/prompts/accepted.prompt.ts \
   packages/openclaw-plugin/src/polling/negotiator/negotiation-accepted.prompt.ts
```

No import changes needed — `accepted.prompt.ts` has no local imports.

- [ ] **Step 3: Create `src/polling/negotiator/negotiator.poller.ts`**

Extract `handleNegotiationPickup` from `index.ts`. The logic is identical; only imports and the export signature change. The `inflight` set and the function move here; `increaseBackoff` is replaced by returning a result the caller acts on.

```typescript
import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { readModel } from '../../lib/openclaw/plugin-api.js';
import { turnPrompt } from './negotiation-turn.prompt.js';

export type NegotiatorPollResult = 'handled' | 'idle' | 'network_error';

export interface NegotiatorConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

/** Tracks in-flight turns so we don't re-launch subagents for already-claimed work. */
const inflight = new Set<string>();

/**
 * Handles one negotiation pickup cycle.
 *
 * @returns `'handled'` if a turn was dispatched, `'idle'` if nothing was pending,
 *   or `'network_error'` if the request failed.
 */
export async function handle(
  api: OpenClawPluginApi,
  config: NegotiatorConfig,
): Promise<NegotiatorPollResult> {
  const pickupUrl = `${config.baseUrl}/api/agents/${config.agentId}/negotiations/pickup`;

  const res = await fetch(pickupUrl, {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 204) {
    return 'idle';
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    api.logger.warn(`Pickup request failed: ${res.status} ${body}`);
    return 'network_error';
  }

  const turn = (await res.json()) as {
    negotiationId: string;
    taskId: string;
    opportunity: { id: string; reasoning: string } | null;
    turn: {
      number: number;
      deadline: string;
      history: Array<{ turnNumber: number; agent: string; action: string; message?: string | null }>;
      counterpartyAction: string;
    };
    context: import('./negotiation-turn.prompt.js').TurnContext | null;
  };

  const inflightKey = `${turn.taskId}:${turn.turn.number}`;
  if (inflight.has(inflightKey)) {
    api.logger.debug(`Turn ${inflightKey} already in-flight, skipping.`);
    return 'idle';
  }
  inflight.add(inflightKey);

  api.logger.info(`Negotiation turn picked up: ${turn.taskId} turn ${turn.turn.number}`);

  const lastEntry = turn.turn.history.length > 0
    ? turn.turn.history[turn.turn.history.length - 1]
    : null;

  const model = await readModel(api);

  try {
    await api.runtime.subagent.run({
      sessionKey: `index:negotiation:${turn.negotiationId}`,
      idempotencyKey: `index:turn:${turn.taskId}:${turn.turn.number}`,
      message: turnPrompt({
        negotiationId: turn.taskId,
        turnNumber: turn.turn.number,
        counterpartyAction: turn.turn.counterpartyAction,
        counterpartyMessage: lastEntry?.message ?? null,
        deadline: turn.turn.deadline,
        context: turn.context,
      }),
      deliver: false,
      model,
    });
    api.logger.info(`Subagent launched for negotiation ${turn.taskId}`);
  } catch (err) {
    inflight.delete(inflightKey);
    throw err;
  }

  return 'handled';
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  inflight.clear();
}
```

- [ ] **Step 4: Create `src/polling/negotiator/negotiator.scheduler.ts`**

Extracts the `scheduleNext` + backoff pattern from `index.ts` for the negotiator domain. Triggers `POST /index-network/poll/negotiator`.

```typescript
import type { PluginLogger } from '../../lib/openclaw/plugin-api.js';

const BASE_INTERVAL_MS = 300_000;
const MAX_BACKOFF_MULTIPLIER = 16;

let timer: ReturnType<typeof setTimeout> | null = null;
let backoffMultiplier = 1;

export interface NegotiatorSchedulerConfig {
  gatewayPort: number;
  gatewayToken: string;
  logger: PluginLogger;
}

export function start(config: NegotiatorSchedulerConfig): void {
  const trigger = () => {
    fetch(`http://127.0.0.1:${config.gatewayPort}/index-network/poll/negotiator`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.gatewayToken}` },
      signal: AbortSignal.timeout(30_000),
    }).catch((err) => {
      config.logger.error(
        `Negotiator poll trigger failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  const scheduleNext = () => {
    timer = setTimeout(() => { trigger(); scheduleNext(); }, BASE_INTERVAL_MS * backoffMultiplier);
    timer.unref();
  };

  scheduleNext();
  setTimeout(trigger, 5_000).unref();
}

export function increaseBackoff(logger: PluginLogger): void {
  if (backoffMultiplier < MAX_BACKOFF_MULTIPLIER) {
    backoffMultiplier = Math.min(backoffMultiplier * 2, MAX_BACKOFF_MULTIPLIER);
    logger.info(
      `Negotiator backing off — next poll in ${(BASE_INTERVAL_MS * backoffMultiplier / 1000).toFixed(0)}s`,
    );
  }
}

export function resetBackoff(): void {
  backoffMultiplier = 1;
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  backoffMultiplier = 1;
}
```

- [ ] **Step 5: Update `src/tests/turn.prompt.spec.ts` import**

```typescript
// OLD:
import { turnPrompt } from '../prompts/turn.prompt.js';

// NEW:
import { turnPrompt } from '../polling/negotiator/negotiation-turn.prompt.js';
```

- [ ] **Step 6: Update `src/tests/accepted.prompt.spec.ts` import**

```typescript
// OLD:
import { acceptedPrompt } from '../prompts/accepted.prompt.js';

// NEW:
import { acceptedPrompt } from '../polling/negotiator/negotiation-accepted.prompt.js';
```

- [ ] **Step 7: Delete old prompt files**

```bash
rm packages/openclaw-plugin/src/prompts/turn.prompt.ts
rm packages/openclaw-plugin/src/prompts/accepted.prompt.ts
```

- [ ] **Step 8: Wire negotiator into `src/index.ts`**

Add these imports at the top of `index.ts`:

```typescript
import * as negotiatorPoller from './polling/negotiator/negotiator.poller.js';
import * as negotiatorScheduler from './polling/negotiator/negotiator.scheduler.js';
```

Replace the `handleNegotiationPickup` call inside the HTTP route handler (`poll` function) and the `scheduleNext` + backoff logic for the negotiator. Specifically:

In the `register` function, replace the block that creates `scheduleNext`/`triggerPoll`/`pollTimer` and the inline negotiation pickup call inside `poll()` with:

```typescript
// Register negotiator route
api.registerHttpRoute({
  path: '/index-network/poll/negotiator',
  auth: 'gateway',
  match: 'exact',
  handler: async (_req, res) => {
    try {
      const result = await negotiatorPoller.handle(api, { baseUrl, agentId, apiKey });
      if (result === 'network_error') {
        negotiatorScheduler.increaseBackoff(api.logger);
      } else {
        negotiatorScheduler.resetBackoff();
      }
      res.statusCode = 200;
      res.end('ok');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      api.logger.error(`Negotiator poll handler error: ${msg}`);
      res.statusCode = 500;
      res.end(msg);
    }
    return true;
  },
});

// Start negotiator scheduler
negotiatorScheduler.start({ gatewayPort, gatewayToken, logger: api.logger });
```

- [ ] **Step 9: Update `_resetForTesting` in `index.ts`**

Add a call to `negotiatorPoller._resetForTesting()` and `negotiatorScheduler._resetForTesting()`:

```typescript
export function _resetForTesting(): void {
  registered = false;
  // existing resets for remaining global state...
  negotiatorPoller._resetForTesting();
  negotiatorScheduler._resetForTesting();
}
```

- [ ] **Step 10: Run tests**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/openclaw-plugin/src/
git commit -m "refactor(openclaw-plugin): extract polling/negotiator domain"
```

---

## Task 4: Extract polling/daily-digest/

**Files:**
- Create: `src/polling/daily-digest/daily-digest.scheduler.ts`
- Create: `src/polling/daily-digest/digest-evaluator.prompt.ts`
- Create: `src/polling/daily-digest/daily-digest.poller.ts`
- Delete: `src/digest.scheduler.ts`, `src/prompts/digest-evaluator.prompt.ts`
- Modify: `src/index.ts`, `src/tests/digest.scheduler.test.ts`, `src/tests/digest-evaluator.prompt.test.ts`, `src/tests/daily-digest.test.ts`

- [ ] **Step 1: Create `src/polling/daily-digest/daily-digest.scheduler.ts`**

Merges `digest.scheduler.ts` (the `msUntilNextDigest` pure function) with the scheduling loop that was inside `index.ts`'s `scheduleDigest`. The daily digest calls the poller directly via the `onTrigger` callback — no HTTP route needed (matching current behavior).

```typescript
import type { PluginLogger } from '../../lib/openclaw/plugin-api.js';

let timer: ReturnType<typeof setTimeout> | null = null;

export interface DigestSchedulerConfig {
  digestTime: string;
  logger: PluginLogger;
  onTrigger: () => Promise<void>;
}

/**
 * Calculates milliseconds until the next occurrence of the given digest time.
 *
 * @param digestTime - Time in "HH:MM" format (24-hour, local timezone)
 * @param now - Current date/time (defaults to new Date())
 */
export function msUntilNextDigest(digestTime: string, now: Date = new Date()): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(digestTime);
  if (!match) {
    throw new Error(`Invalid digestTime "${digestTime}" — expected HH:MM format`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid digestTime "${digestTime}" — hours must be 0-23, minutes 0-59`);
  }

  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}

export function start(config: DigestSchedulerConfig): void {
  const schedule = () => {
    const delay = msUntilNextDigest(config.digestTime);
    config.logger.info(
      `Daily digest scheduled for ${config.digestTime} (in ${Math.round(delay / 60000)} minutes)`,
    );

    timer = setTimeout(async () => {
      config.logger.info('Daily digest triggered');
      try {
        await config.onTrigger();
      } catch (err) {
        config.logger.error(
          `Daily digest error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      schedule();
    }, delay);
    timer.unref();
  };

  schedule();
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  if (timer) { clearTimeout(timer); timer = null; }
}
```

- [ ] **Step 2: Create `src/polling/daily-digest/digest-evaluator.prompt.ts`**

```bash
mkdir -p packages/openclaw-plugin/src/polling/daily-digest
cp packages/openclaw-plugin/src/prompts/digest-evaluator.prompt.ts \
   packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts
```

Then update the import inside the copied file:

```typescript
// OLD:
import type { OpportunityCandidate } from './opportunity-evaluator.prompt.js';
import { sanitizeField } from './sanitize.js';

// NEW:
import type { OpportunityCandidate } from '../ambient-discovery/opportunity-evaluator.prompt.js';
import { sanitizeField } from '../../lib/utils/sanitize.js';
```

- [ ] **Step 3: Create `src/polling/daily-digest/daily-digest.poller.ts`**

Extract `handleDailyDigest` from `index.ts`. Logic is identical; imports updated.

```typescript
import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { readModel } from '../../lib/openclaw/plugin-api.js';
import { buildDeliverySessionKey } from '../../lib/delivery/delivery.dispatcher.js';
import { digestEvaluatorPrompt } from './digest-evaluator.prompt.js';

export interface DailyDigestConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  maxCount: number;
}

/**
 * Fetches all undelivered pending opportunities and delivers a daily digest
 * of the top N ranked by value.
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

  const sessionKey = buildDeliverySessionKey(api);
  if (!sessionKey) {
    api.logger.warn(
      'Daily digest: delivery routing not configured — skipping. ' +
        'Set pluginConfig.deliveryChannel and pluginConfig.deliveryTarget.',
    );
    return false;
  }

  const batchHash = hashOpportunityBatch(body.opportunities.map((o) => o.opportunityId));
  const effectiveMax = Math.min(config.maxCount, body.opportunities.length);
  const dateStr = new Date().toISOString().slice(0, 10);
  const model = await readModel(api);

  try {
    await api.runtime.subagent.run({
      sessionKey,
      idempotencyKey: `index:delivery:daily-digest:${config.agentId}:${dateStr}:${batchHash}`,
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
      deliver: true,
      model,
    });
  } catch (err) {
    api.logger.warn(
      `Daily digest subagent dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  api.logger.info(
    `Daily digest dispatched: ${body.opportunities.length} candidate(s), max ${effectiveMax} to deliver`,
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

- [ ] **Step 4: Update `src/tests/digest.scheduler.test.ts` import**

```typescript
// OLD:
import { msUntilNextDigest } from '../digest.scheduler.js';

// NEW:
import { msUntilNextDigest } from '../polling/daily-digest/daily-digest.scheduler.js';
```

- [ ] **Step 5: Update `src/tests/digest-evaluator.prompt.test.ts` import**

```typescript
// OLD:
import { digestEvaluatorPrompt } from '../prompts/digest-evaluator.prompt.js';

// NEW:
import { digestEvaluatorPrompt } from '../polling/daily-digest/digest-evaluator.prompt.js';
```

- [ ] **Step 6: Update `src/tests/daily-digest.test.ts` imports**

```typescript
// OLD:
import { handleDailyDigest, _resetForTesting } from '../index.js';
import type { OpenClawPluginApi } from '../plugin-api.js';

// NEW:
import { handle as handleDailyDigest } from '../polling/daily-digest/daily-digest.poller.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';
```

Note: the test calls `_resetForTesting` — remove that import and the `beforeEach`/`afterEach` calls to it if the poller has no module-level state to reset (it doesn't — `hashOpportunityBatch` is pure). If the test still uses `_resetForTesting`, remove it from the import and any `beforeEach`/`afterEach` that calls it.

- [ ] **Step 7: Wire daily-digest into `src/index.ts`**

Add imports:

```typescript
import * as dailyDigestPoller from './polling/daily-digest/daily-digest.poller.js';
import * as dailyDigestScheduler from './polling/daily-digest/daily-digest.scheduler.js';
```

Replace the `digestEnabled` block + `scheduleDigest` inline function with:

```typescript
const digestEnabled = readConfig(api, 'digestEnabled') !== 'false';
if (digestEnabled) {
  const digestTime = readConfig(api, 'digestTime') || '08:00';
  const _parsedMax = parseInt(readConfig(api, 'digestMaxCount') || '10', 10);
  const digestMaxCount = Math.max(1, Number.isNaN(_parsedMax) ? 10 : _parsedMax);

  dailyDigestScheduler.start({
    digestTime,
    logger: api.logger,
    onTrigger: () => dailyDigestPoller.handle(api, { baseUrl, agentId, apiKey, maxCount: digestMaxCount }),
  });
}
```

- [ ] **Step 8: Update `_resetForTesting` in `index.ts`**

Add a call to `dailyDigestScheduler._resetForTesting()`:

```typescript
export function _resetForTesting(): void {
  registered = false;
  // ... existing resets ...
  negotiatorPoller._resetForTesting();
  negotiatorScheduler._resetForTesting();
  dailyDigestScheduler._resetForTesting();
}
```

- [ ] **Step 9: Delete old files**

```bash
rm packages/openclaw-plugin/src/digest.scheduler.ts
rm packages/openclaw-plugin/src/prompts/digest-evaluator.prompt.ts
```

- [ ] **Step 10: Run tests**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/openclaw-plugin/src/
git commit -m "refactor(openclaw-plugin): extract polling/daily-digest domain"
```

---

## Task 5: Extract polling/ambient-discovery/

**Files:**
- Create: `src/polling/ambient-discovery/opportunity-evaluator.prompt.ts`
- Create: `src/polling/ambient-discovery/ambient-discovery.poller.ts`
- Create: `src/polling/ambient-discovery/ambient-discovery.scheduler.ts`
- Delete: `src/prompts/opportunity-evaluator.prompt.ts`
- Modify: `src/index.ts`, `src/tests/opportunity-batch.spec.ts`

- [ ] **Step 1: Create `src/polling/ambient-discovery/opportunity-evaluator.prompt.ts`**

```bash
mkdir -p packages/openclaw-plugin/src/polling/ambient-discovery
cp packages/openclaw-plugin/src/prompts/opportunity-evaluator.prompt.ts \
   packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts
```

Update the import inside the copied file:

```typescript
// OLD:
import { sanitizeField } from './sanitize.js';

// NEW:
import { sanitizeField } from '../../lib/utils/sanitize.js';
```

- [ ] **Step 2: Create `src/polling/ambient-discovery/ambient-discovery.poller.ts`**

Extract `handleOpportunityBatch` from `index.ts`. The `lastOpportunityBatchHash` module-level state and the `hashOpportunityBatch` helper move here.

```typescript
import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { readModel } from '../../lib/openclaw/plugin-api.js';
import { buildDeliverySessionKey } from '../../lib/delivery/delivery.dispatcher.js';
import { opportunityEvaluatorPrompt } from './opportunity-evaluator.prompt.js';

/** Hash of the last opportunity batch dispatched. Used to skip unchanged batches. */
let lastOpportunityBatchHash: string | null = null;

export interface AmbientDiscoveryConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

/**
 * Fetches all undelivered pending opportunities in one request, then launches
 * a single evaluator+delivery subagent that scores them and delivers one message.
 *
 * @returns `true` if a subagent was launched, `false` if no candidates or no routing.
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

  const sessionKey = buildDeliverySessionKey(api);
  if (!sessionKey) {
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

  try {
    await api.runtime.subagent.run({
      sessionKey,
      idempotencyKey: `index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
      message: opportunityEvaluatorPrompt(
        body.opportunities.map((o) => ({
          opportunityId: o.opportunityId,
          headline: o.rendered.headline,
          personalizedSummary: o.rendered.personalizedSummary,
          suggestedAction: o.rendered.suggestedAction,
          narratorRemark: o.rendered.narratorRemark,
        })),
      ),
      deliver: true,
      model,
    });
    lastOpportunityBatchHash = batchHash;
  } catch (err) {
    api.logger.warn(
      `Opportunity batch subagent dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  api.logger.info(
    `Opportunity batch dispatched: ${body.opportunities.length} candidate(s) for evaluation`,
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

- [ ] **Step 3: Create `src/polling/ambient-discovery/ambient-discovery.scheduler.ts`**

Same pattern as `negotiator.scheduler.ts` but triggers `/index-network/poll/ambient-discovery`.

```typescript
import type { PluginLogger } from '../../lib/openclaw/plugin-api.js';

const BASE_INTERVAL_MS = 300_000;
const MAX_BACKOFF_MULTIPLIER = 16;

let timer: ReturnType<typeof setTimeout> | null = null;
let backoffMultiplier = 1;

export interface AmbientDiscoverySchedulerConfig {
  gatewayPort: number;
  gatewayToken: string;
  logger: PluginLogger;
}

export function start(config: AmbientDiscoverySchedulerConfig): void {
  const trigger = () => {
    fetch(`http://127.0.0.1:${config.gatewayPort}/index-network/poll/ambient-discovery`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.gatewayToken}` },
      signal: AbortSignal.timeout(30_000),
    }).catch((err) => {
      config.logger.error(
        `Ambient discovery poll trigger failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  const scheduleNext = () => {
    timer = setTimeout(() => { trigger(); scheduleNext(); }, BASE_INTERVAL_MS * backoffMultiplier);
    timer.unref();
  };

  scheduleNext();
  setTimeout(trigger, 5_000).unref();
}

export function increaseBackoff(logger: PluginLogger): void {
  if (backoffMultiplier < MAX_BACKOFF_MULTIPLIER) {
    backoffMultiplier = Math.min(backoffMultiplier * 2, MAX_BACKOFF_MULTIPLIER);
    logger.info(
      `Ambient discovery backing off — next poll in ${(BASE_INTERVAL_MS * backoffMultiplier / 1000).toFixed(0)}s`,
    );
  }
}

export function resetBackoff(): void {
  backoffMultiplier = 1;
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  backoffMultiplier = 1;
}
```

- [ ] **Step 4: Update `src/tests/opportunity-batch.spec.ts` imports**

```typescript
// OLD:
import { _resetForTesting, handleOpportunityBatch } from '../index.js';
import type { OpenClawPluginApi, SubagentRunOptions } from '../plugin-api.js';

// NEW:
import { handle as handleOpportunityBatch, _resetForTesting } from '../polling/ambient-discovery/ambient-discovery.poller.js';
import type { OpenClawPluginApi, SubagentRunOptions } from '../lib/openclaw/plugin-api.js';
```

- [ ] **Step 5: Wire ambient-discovery into `src/index.ts`**

Add imports:

```typescript
import * as ambientDiscoveryPoller from './polling/ambient-discovery/ambient-discovery.poller.js';
import * as ambientDiscoveryScheduler from './polling/ambient-discovery/ambient-discovery.scheduler.js';
```

Register route and start scheduler (in the `register` function, alongside the negotiator route):

```typescript
api.registerHttpRoute({
  path: '/index-network/poll/ambient-discovery',
  auth: 'gateway',
  match: 'exact',
  handler: async (_req, res) => {
    try {
      const result = await ambientDiscoveryPoller.handle(api, { baseUrl, agentId, apiKey });
      if (!result) {
        ambientDiscoveryScheduler.increaseBackoff(api.logger);
      } else {
        ambientDiscoveryScheduler.resetBackoff();
      }
      res.statusCode = 200;
      res.end('ok');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      api.logger.error(`Ambient discovery poll handler error: ${msg}`);
      res.statusCode = 500;
      res.end(msg);
    }
    return true;
  },
});

ambientDiscoveryScheduler.start({ gatewayPort, gatewayToken, logger: api.logger });
```

- [ ] **Step 6: Update `_resetForTesting` in `index.ts`**

```typescript
export function _resetForTesting(): void {
  registered = false;
  // ...
  negotiatorPoller._resetForTesting();
  negotiatorScheduler._resetForTesting();
  dailyDigestScheduler._resetForTesting();
  ambientDiscoveryPoller._resetForTesting();
  ambientDiscoveryScheduler._resetForTesting();
}
```

- [ ] **Step 7: Delete old prompt file**

```bash
rm packages/openclaw-plugin/src/prompts/opportunity-evaluator.prompt.ts
```

- [ ] **Step 8: Run tests**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/openclaw-plugin/src/
git commit -m "refactor(openclaw-plugin): extract polling/ambient-discovery domain"
```

---

## Task 6: Extract polling/test-message/

**Files:**
- Create: `src/polling/test-message/test-message.poller.ts`
- Create: `src/polling/test-message/test-message.scheduler.ts`
- Modify: `src/index.ts`, `src/tests/test-message-pickup.spec.ts`

- [ ] **Step 1: Create `src/polling/test-message/test-message.poller.ts`**

Extract `handleTestMessagePickup` from `index.ts`.

```typescript
import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchDelivery } from '../../lib/delivery/delivery.dispatcher.js';

export interface TestMessageConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

/**
 * Handles one test-message pickup cycle. Picks up a pending test message,
 * dispatches it via `dispatchDelivery`, then confirms delivery.
 *
 * @returns `true` if a test message was dispatched, `false` otherwise.
 */
export async function handle(
  api: OpenClawPluginApi,
  config: TestMessageConfig,
): Promise<boolean> {
  const pickupUrl = `${config.baseUrl}/api/agents/${config.agentId}/test-messages/pickup`;

  const res = await fetch(pickupUrl, {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 204) {
    return false;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    api.logger.warn(`Test-message pickup failed: ${res.status} ${text}`);
    return false;
  }

  const body = (await res.json()) as {
    id: string;
    content: string;
    reservationToken: string;
  };

  const dispatchResult = await dispatchDelivery(api, {
    rendered: { headline: 'Test message', body: body.content },
    idempotencyKey: `index:delivery:test:${body.id}:${body.reservationToken}`,
  });

  if (dispatchResult === null) {
    return false;
  }

  const confirmUrl = `${config.baseUrl}/api/agents/${config.agentId}/test-messages/${body.id}/delivered`;
  await fetch(confirmUrl, {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ reservationToken: body.reservationToken }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    api.logger.warn(
      `Test-message confirm failed for ${body.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  return true;
}
```

- [ ] **Step 2: Create `src/polling/test-message/test-message.scheduler.ts`**

Same pattern as the other interval schedulers, triggers `/index-network/poll/test-message`.

```typescript
import type { PluginLogger } from '../../lib/openclaw/plugin-api.js';

const BASE_INTERVAL_MS = 300_000;
const MAX_BACKOFF_MULTIPLIER = 16;

let timer: ReturnType<typeof setTimeout> | null = null;
let backoffMultiplier = 1;

export interface TestMessageSchedulerConfig {
  gatewayPort: number;
  gatewayToken: string;
  logger: PluginLogger;
}

export function start(config: TestMessageSchedulerConfig): void {
  const trigger = () => {
    fetch(`http://127.0.0.1:${config.gatewayPort}/index-network/poll/test-message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.gatewayToken}` },
      signal: AbortSignal.timeout(30_000),
    }).catch((err) => {
      config.logger.error(
        `Test-message poll trigger failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  const scheduleNext = () => {
    timer = setTimeout(() => { trigger(); scheduleNext(); }, BASE_INTERVAL_MS * backoffMultiplier);
    timer.unref();
  };

  scheduleNext();
  setTimeout(trigger, 5_000).unref();
}

export function increaseBackoff(logger: PluginLogger): void {
  if (backoffMultiplier < MAX_BACKOFF_MULTIPLIER) {
    backoffMultiplier = Math.min(backoffMultiplier * 2, MAX_BACKOFF_MULTIPLIER);
    logger.info(
      `Test-message backing off — next poll in ${(BASE_INTERVAL_MS * backoffMultiplier / 1000).toFixed(0)}s`,
    );
  }
}

export function resetBackoff(): void {
  backoffMultiplier = 1;
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  backoffMultiplier = 1;
}
```

- [ ] **Step 3: Update `src/tests/test-message-pickup.spec.ts` imports**

```typescript
// OLD:
import { _resetForTesting, handleTestMessagePickup } from '../index.js';
import type { OpenClawPluginApi, SubagentRunOptions } from '../plugin-api.js';

// NEW:
import { handle as handleTestMessagePickup } from '../polling/test-message/test-message.poller.js';
import type { OpenClawPluginApi, SubagentRunOptions } from '../lib/openclaw/plugin-api.js';
```

Also remove `_resetForTesting` from the import and any `beforeEach`/`afterEach` calls to it — `test-message.poller.ts` has no module-level state.

- [ ] **Step 4: Wire test-message into `src/index.ts`**

Add imports:

```typescript
import * as testMessagePoller from './polling/test-message/test-message.poller.js';
import * as testMessageScheduler from './polling/test-message/test-message.scheduler.js';
```

Register route and start scheduler:

```typescript
api.registerHttpRoute({
  path: '/index-network/poll/test-message',
  auth: 'gateway',
  match: 'exact',
  handler: async (_req, res) => {
    try {
      await testMessagePoller.handle(api, { baseUrl, agentId, apiKey });
      res.statusCode = 200;
      res.end('ok');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      api.logger.error(`Test-message poll handler error: ${msg}`);
      res.statusCode = 500;
      res.end(msg);
    }
    return true;
  },
});

testMessageScheduler.start({ gatewayPort, gatewayToken, logger: api.logger });
```

- [ ] **Step 5: Update `_resetForTesting` in `index.ts`**

```typescript
export function _resetForTesting(): void {
  registered = false;
  negotiatorPoller._resetForTesting();
  negotiatorScheduler._resetForTesting();
  dailyDigestScheduler._resetForTesting();
  ambientDiscoveryPoller._resetForTesting();
  ambientDiscoveryScheduler._resetForTesting();
  testMessageScheduler._resetForTesting();
}
```

- [ ] **Step 6: Run tests**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/openclaw-plugin/src/
git commit -m "refactor(openclaw-plugin): extract polling/test-message domain"
```

---

## Task 7: Finalize index.ts as pure wiring + cleanup

**Files:**
- Modify: `src/index.ts` (remove all remaining extracted logic, dead imports, old `poll()` function)
- Delete: remaining files in `src/prompts/` (should be empty by now)

- [ ] **Step 1: Remove the old `poll()` function and all extracted handlers from `index.ts`**

At this point `index.ts` should only contain:
- Imports (domain module imports + lib imports)
- Module-level guard: `let registered = false`
- `registerSetupCommand(api)` helper
- `ensureMcpServer(api, baseUrl, apiKey)` helper
- `register(api)` — reads config, calls `ensureMcpServer`, registers four HTTP routes, starts four schedulers, registers CLI
- `export default { id, name, description, register }`
- `_resetForTesting()` — resets `registered` and calls sub-module resets
- `readConfig(api, key)` helper
- `checkBackendReachability(api, baseUrl)` helper

Remove:
- `handleNegotiationPickup` (moved to negotiator.poller.ts)
- `handleOpportunityBatch` (moved to ambient-discovery.poller.ts)
- `handleDailyDigest` (moved to daily-digest.poller.ts)
- `handleTestMessagePickup` (moved to test-message.poller.ts)
- `poll()` function
- `backoffMultiplier`, `MAX_BACKOFF_MULTIPLIER`, `inflight`, `lastOpportunityBatchHash` globals
- `pollTimer`, `digestTimer` globals
- `increaseBackoff()` local helper
- Old `scheduleNext`, `triggerPoll`, `scheduleDigest` logic
- `hashOpportunityBatch()` helper

- [ ] **Step 2: Remove the `src/prompts/` directory if empty**

```bash
rmdir packages/openclaw-plugin/src/prompts 2>/dev/null || true
```

- [ ] **Step 3: Type-check**

```bash
cd packages/openclaw-plugin && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/
git commit -m "refactor(openclaw-plugin): slim index.ts to pure plugin wiring"
```

---

## Task 8: Version bump

**Files:**
- Modify: `packages/openclaw-plugin/package.json`
- Modify: `packages/openclaw-plugin/openclaw.plugin.json`

- [ ] **Step 1: Bump version in both files**

This is a non-breaking refactor (no API or behavior changes), so increment the patch version. If current version is `0.11.5`, bump to `0.11.6`. Check the current version first:

```bash
cat packages/openclaw-plugin/package.json | grep '"version"'
cat packages/openclaw-plugin/openclaw.plugin.json | grep '"version"'
```

Both files must have the same version number. Edit `package.json`:

```json
"version": "0.11.6"
```

Edit `openclaw.plugin.json`:

```json
"version": "0.11.6"
```

- [ ] **Step 2: Run tests one final time**

```bash
cd packages/openclaw-plugin && bun test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/openclaw-plugin/package.json packages/openclaw-plugin/openclaw.plugin.json
git commit -m "chore(openclaw-plugin): bump version to 0.11.6"
```
