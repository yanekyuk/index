# OpenClaw Main-Agent Renders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dispatcher subagent with a handoff to the user's main OpenClaw agent so digests, ambient alerts, and test messages render in the user's own agent voice on their active channel.

**Architecture:** Single-pass — the main agent receives the candidate batch via `runEmbeddedAgent` (with `/hooks/agent` HTTP fallback), ranks/picks/renders in one turn, and may suppress with `NO_REPLY`. The plugin remains the broker for all backend interaction (fetch pending, scrape rendered text for IDs, confirm delivered). No evaluator subagent.

**Tech Stack:** Bun, TypeScript, OpenClaw plugin SDK, Drizzle ORM (Postgres) on the backend, React (frontend mirror).

**Spec:** `docs/superpowers/specs/2026-04-26-openclaw-main-agent-renders-design.md`

---

## File map

### Backend (one small change)
- Modify: `backend/src/services/opportunity-delivery.service.ts:297` — add `limit?: number` arg
- Modify: `backend/src/controllers/agent.controller.ts:543` — parse `?limit` and pass through
- Modify: `backend/src/services/tests/opportunity-delivery.spec.ts` — limit cases

### Plugin
- Modify: `packages/openclaw-plugin/src/lib/openclaw/plugin-api.ts` — add `AgentRuntime`
- Create: `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts`
- Create: `packages/openclaw-plugin/src/lib/delivery/main-agent.dispatcher.ts`
- Modify: `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts`
- Modify: `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts`
- Modify: `packages/openclaw-plugin/src/polling/test-message/test-message.poller.ts`
- Modify: `packages/openclaw-plugin/src/setup/setup.cli.ts`
- Modify: `packages/openclaw-plugin/src/index.ts`
- Modify: `packages/openclaw-plugin/openclaw.plugin.json`
- Modify: `packages/openclaw-plugin/package.json` (version bump)
- Modify: `packages/openclaw-plugin/README.md`
- Delete: `packages/openclaw-plugin/src/lib/delivery/delivery.dispatcher.ts`
- Delete: `packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts`
- Delete: `packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts`
- Delete: `packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts`
- Delete: `packages/openclaw-plugin/src/polling/negotiator/negotiation-accepted.prompt.ts`
- Delete: `packages/openclaw-plugin/src/tests/accepted.prompt.spec.ts`
- Delete: `packages/openclaw-plugin/src/tests/delivery.dispatcher.spec.ts`
- Delete: `packages/openclaw-plugin/src/tests/digest-evaluator.prompt.test.ts`
- Create: `packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts`
- Create: `packages/openclaw-plugin/src/tests/main-agent.dispatcher.spec.ts`
- Modify: `packages/openclaw-plugin/src/tests/daily-digest.test.ts`
- Modify: `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts` (ambient poller test)
- Modify: `packages/openclaw-plugin/src/tests/test-message-pickup.spec.ts`
- Modify: `packages/openclaw-plugin/src/tests/setup-entry.spec.ts`
- Modify: `packages/openclaw-plugin/src/tests/index.spec.ts`

### Frontend mirror (both files have local copies of the wizard)
- Modify: `frontend/src/app/agents/[id]/page.tsx` — `WizardPromptGrid` + `SetupInstructions`
- Modify: `frontend/src/app/agents/page.tsx` — same components, second copy

---

## Conventions used in this plan

- Tests are written first per TDD. Each task has a "write failing test → verify failure → implement → verify pass → commit" cycle.
- Commits use conventional commit prefixes (`feat`, `fix`, `refactor`, `chore`, `docs`, `test`).
- Working directory is the repo root unless noted; `cd` is shown only when running tests in a subdirectory.
- Tests run with `bun test <path>` from the package root.
- Commits are unsigned-friendly: if GPG fails, use `git -c commit.gpgsign=false commit ...`.

---

## Task 1: Backend — `?limit` query param on `GET /opportunities/pending`

**Files:**
- Modify: `backend/src/services/opportunity-delivery.service.ts:297`
- Modify: `backend/src/controllers/agent.controller.ts:543`
- Test: `backend/src/services/tests/opportunity-delivery.spec.ts:190` (existing `describe('fetchPendingCandidates', ...)`)

- [ ] **Step 1: Write failing service-layer test for `limit` param**

Add these tests inside the existing `describe('fetchPendingCandidates', ...)` block in `backend/src/services/tests/opportunity-delivery.spec.ts`. Match the file's existing test style (read a few existing tests in that block first to lift fixtures and helpers).

```ts
it('respects an explicit limit lower than the default cap', async () => {
  // seed 5 pending opportunities (use the same fixture helper used in nearby tests)
  await seedPendingOpportunities(agentId, 5);
  const results = await svc.fetchPendingCandidates(agentId, 3);
  expect(results).toHaveLength(3);
});

it('clamps limit above 20 to the 20-row cap', async () => {
  await seedPendingOpportunities(agentId, 25);
  const results = await svc.fetchPendingCandidates(agentId, 50);
  expect(results.length).toBeLessThanOrEqual(20);
});

it('clamps limit at or below 0 to 1', async () => {
  await seedPendingOpportunities(agentId, 5);
  const results = await svc.fetchPendingCandidates(agentId, 0);
  expect(results).toHaveLength(1);
});

it('uses 20 as default when limit is omitted', async () => {
  await seedPendingOpportunities(agentId, 25);
  const results = await svc.fetchPendingCandidates(agentId);
  expect(results.length).toBeLessThanOrEqual(20);
});
```

If `seedPendingOpportunities` doesn't exist, write a small helper in the same file that inserts opportunities via the existing fixtures used in earlier tests in that block. Reuse, don't reinvent.

- [ ] **Step 2: Run tests to verify failure**

Run: `cd backend && bun test src/services/tests/opportunity-delivery.spec.ts`
Expected: the four new tests fail. The "respects explicit limit" should fail because the service ignores the second arg. The clamp tests should fail similarly.

- [ ] **Step 3: Update service signature and SQL**

Edit `backend/src/services/opportunity-delivery.service.ts:297`. Change the method signature and the SQL `LIMIT` clause:

```ts
/**
 * Fetch all undelivered eligible opportunities for an agent owner without writing
 * to the delivery ledger. Suitable for batch delivery flows where the caller
 * decides which candidates to commit via `commitDelivery`.
 *
 * @param agentId - The agent whose owner's pending opportunities are fetched.
 * @param limit   - Max rows to return. Clamped to [1, 20]. Defaults to 20.
 */
async fetchPendingCandidates(agentId: string, limit?: number): Promise<PendingCandidate[]> {
  const userId = await this.resolveAgentOwner(agentId);
  const effectiveLimit = Math.min(20, Math.max(1, Math.trunc(limit ?? 20)));

  const result = await db.execute(sql`
    SELECT o.id, o.actors, o.status, o.interpretation, o.detection
    FROM opportunities o
    WHERE o.status IN ('pending', 'draft')
      AND o.actors::jsonb @> ${JSON.stringify([{ userId }])}::jsonb
      AND (
        o.status = 'pending'
        OR (
          (o.detection->>'createdBy') IS NOT NULL
          AND (o.detection->>'createdBy') <> ${userId}
        )
      )
      AND EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = ${agentId}
          AND a.notify_on_opportunity = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM opportunity_deliveries d
        WHERE d.opportunity_id = o.id
          AND d.user_id = ${userId}
          AND d.channel = ${CHANNEL}
          AND d.delivered_at_status = o.status::text
          AND d.delivered_at IS NOT NULL
      )
    ORDER BY o.updated_at ASC
    LIMIT ${effectiveLimit}
  `);

  // ... rest of method unchanged
}
```

`Math.trunc` handles non-integer inputs by truncating; combined with the clamp, any non-integer (NaN, Infinity, fractional) lands within [1, 20] or fails to NaN which clamps to 20 because `Math.max(1, NaN) === NaN` → adjust: use `Number.isFinite(limit) ? limit : 20` upstream:

```ts
const raw = Number.isFinite(limit as number) ? Math.trunc(limit as number) : 20;
const effectiveLimit = Math.min(20, Math.max(1, raw));
```

- [ ] **Step 4: Run service tests to verify pass**

Run: `cd backend && bun test src/services/tests/opportunity-delivery.spec.ts`
Expected: all `fetchPendingCandidates` tests pass.

- [ ] **Step 5: Write failing controller test for `?limit` parsing**

Find the existing controller test file for `agent.controller.ts`. If `backend/tests/agent.controller.test.ts` exists, add to it; otherwise add a focused test next to the controller file (`backend/src/controllers/tests/agent.controller.spec.ts`). Match whatever pattern is used by neighboring controller tests.

```ts
it('GET /:id/opportunities/pending parses ?limit and passes it to the service', async () => {
  const fetchSpy = mock.spyOn(opportunityDeliveryService, 'fetchPendingCandidates')
    .mockResolvedValue([]);

  await fetchAgentApi(`/agents/${agentId}/opportunities/pending?limit=7`);

  expect(fetchSpy).toHaveBeenCalledWith(agentId, 7);
  fetchSpy.mockRestore();
});

it('GET /:id/opportunities/pending omits limit arg when query param missing', async () => {
  const fetchSpy = mock.spyOn(opportunityDeliveryService, 'fetchPendingCandidates')
    .mockResolvedValue([]);

  await fetchAgentApi(`/agents/${agentId}/opportunities/pending`);

  expect(fetchSpy).toHaveBeenCalledWith(agentId, undefined);
  fetchSpy.mockRestore();
});

it('GET /:id/opportunities/pending rejects non-integer ?limit with 400', async () => {
  const res = await fetchAgentApi(`/agents/${agentId}/opportunities/pending?limit=abc`);
  expect(res.status).toBe(400);
});

it('GET /:id/opportunities/pending rejects ?limit=0 with 400', async () => {
  const res = await fetchAgentApi(`/agents/${agentId}/opportunities/pending?limit=0`);
  expect(res.status).toBe(400);
});
```

`fetchAgentApi` should use whatever helper sibling tests use. If none exists, use `await app.fetch(new Request(...))` — match conventions.

- [ ] **Step 6: Run controller test to verify failure**

Run: `cd backend && bun test src/controllers/tests/agent.controller.spec.ts` (or wherever you put it).
Expected: all four new tests fail because the controller currently ignores the query string.

- [ ] **Step 7: Update controller to parse `?limit`**

Edit `backend/src/controllers/agent.controller.ts:543`:

```ts
@Get('/:id/opportunities/pending')
@UseGuards(AuthOrApiKeyGuard)
async getPendingOpportunities(req: Request, user: AuthenticatedUser, params?: RouteParams) {
  const agentId = params?.id;
  if (!agentId) {
    return jsonError('Agent ID is required', 400);
  }

  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  let limit: number | undefined;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return jsonError('limit must be a positive integer', 400);
    }
    limit = parsed;
  }

  try {
    await agentService.getById(agentId, user.id);
    await agentService.touchLastSeen(agentId);
    const opportunities = await opportunityDeliveryService.fetchPendingCandidates(agentId, limit);
    return Response.json({ opportunities });
  } catch (err) {
    return jsonError(parseErrorMessage(err), errorStatus(err));
  }
}
```

Note the parameter name change from `_req` to `req`.

- [ ] **Step 8: Run all backend tests touched**

Run:
```
cd backend && bun test src/services/tests/opportunity-delivery.spec.ts
cd backend && bun test src/controllers/tests/agent.controller.spec.ts
```
Both expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/opportunity-delivery.service.ts \
        backend/src/services/tests/opportunity-delivery.spec.ts \
        backend/src/controllers/agent.controller.ts \
        backend/src/controllers/tests/
git commit -m "feat(backend): support ?limit on GET /opportunities/pending"
```

---

## Task 2: Plugin types — declare `runtime.agent.runEmbeddedAgent`

**Files:**
- Modify: `packages/openclaw-plugin/src/lib/openclaw/plugin-api.ts`

The plugin's local type shim doesn't yet expose `api.runtime.agent`. Add the minimal slice we'll consume.

- [ ] **Step 1: Add types**

Edit `packages/openclaw-plugin/src/lib/openclaw/plugin-api.ts`. After the `SubagentRuntime` interface and before `PluginRuntime`, add:

```ts
export interface RunEmbeddedAgentOptions {
  sessionId: string;
  runId: string;
  sessionFile: string;
  workspaceDir: string;
  prompt: string;
  timeoutMs: number;
}

export interface RunEmbeddedAgentResult {
  /** Plain-text reply produced by the agent turn, when available. */
  text?: string;
  /** Structured assistant messages, mirroring `getSessionMessages`. */
  messages?: SessionMessage[];
  /** Whether the host auto-delivered the reply to the agent's last channel. */
  delivered?: boolean;
}

export interface AgentIdentity {
  id?: string;
  sessionId?: string;
  agentDir?: string;
  workspaceDir?: string;
}

export interface AgentRuntime {
  resolveAgentDir(cfg: OpenClawConfigSlice | undefined): string;
  resolveAgentWorkspaceDir(cfg: OpenClawConfigSlice | undefined): string;
  resolveAgentIdentity(cfg: OpenClawConfigSlice | undefined): AgentIdentity;
  resolveAgentTimeoutMs(cfg: OpenClawConfigSlice | undefined): number;
  runEmbeddedAgent(options: RunEmbeddedAgentOptions): Promise<RunEmbeddedAgentResult>;
}
```

Then update `PluginRuntime`:

```ts
export interface PluginRuntime {
  subagent: SubagentRuntime;
  agent?: AgentRuntime;
}
```

`agent?` is optional because older OpenClaw versions may not expose it; the dispatcher's fallback path handles that case.

- [ ] **Step 2: Run typecheck**

Run: `cd packages/openclaw-plugin && bun run --bun tsc --noEmit -p tsconfig.json` (if no tsc script, use `bunx tsc --noEmit`).
Expected: no type errors. The new types don't yet have callers, but the file should still parse.

- [ ] **Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/lib/openclaw/plugin-api.ts
git commit -m "feat(openclaw-plugin): declare AgentRuntime types for runEmbeddedAgent"
```

---

## Task 3: Plugin — `main-agent.prompt.ts`

**Files:**
- Create: `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts`
- Test: `packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import {
  buildMainAgentPrompt,
  type MainAgentPromptInput,
} from '../lib/delivery/main-agent.prompt.js';

const baseDigest: MainAgentPromptInput = {
  contentType: 'daily_digest',
  mainAgentToolUse: 'disabled',
  allowSuppress: true,
  payload: {
    contentType: 'daily_digest',
    maxToSurface: 5,
    candidates: [
      {
        opportunityId: 'opp-1',
        counterpartUserId: 'user-1',
        headline: 'H1',
        personalizedSummary: 'S1',
        suggestedAction: 'A1',
        narratorRemark: 'N1',
        profileUrl: 'https://example.com/u/user-1',
        acceptUrl: 'https://example.com/o/opp-1/accept',
        skipUrl: 'https://example.com/o/opp-1/skip',
      },
    ],
  },
};

describe('buildMainAgentPrompt', () => {
  it('includes the URL preservation clause', () => {
    const out = buildMainAgentPrompt(baseDigest);
    expect(out).toContain('include its acceptUrl and skipUrl');
  });

  it('forbids tool calls when mainAgentToolUse=disabled', () => {
    const out = buildMainAgentPrompt({ ...baseDigest, mainAgentToolUse: 'disabled' });
    expect(out).toContain('Do not call any tools');
  });

  it('permits tool calls when mainAgentToolUse=enabled', () => {
    const out = buildMainAgentPrompt({ ...baseDigest, mainAgentToolUse: 'enabled' });
    expect(out).toContain('You may call Index Network MCP tools');
    expect(out).not.toContain('Do not call any tools');
  });

  it('includes NO_REPLY clause when allowSuppress=true', () => {
    const out = buildMainAgentPrompt({ ...baseDigest, allowSuppress: true });
    expect(out).toContain('NO_REPLY');
  });

  it('omits NO_REPLY clause when allowSuppress=false', () => {
    const out = buildMainAgentPrompt({ ...baseDigest, allowSuppress: false });
    expect(out).not.toContain('NO_REPLY');
  });

  it('daily_digest instruction mentions ranking and maxToSurface', () => {
    const out = buildMainAgentPrompt(baseDigest);
    expect(out.toLowerCase()).toContain('rank');
    expect(out).toContain('5'); // maxToSurface
  });

  it('ambient_discovery instruction mentions real-time alert', () => {
    const out = buildMainAgentPrompt({
      ...baseDigest,
      contentType: 'ambient_discovery',
      payload: { ...baseDigest.payload, contentType: 'ambient_discovery' },
    });
    expect(out.toLowerCase()).toContain('real-time');
  });

  it('test_message instruction mentions verification and excludes NO_REPLY', () => {
    const out = buildMainAgentPrompt({
      contentType: 'test_message',
      mainAgentToolUse: 'disabled',
      allowSuppress: false,
      payload: { contentType: 'test_message', content: 'hello world' },
    });
    expect(out.toLowerCase()).toContain('verification');
    expect(out).not.toContain('NO_REPLY');
  });

  it('INPUT block contains valid JSON of the payload', () => {
    const out = buildMainAgentPrompt(baseDigest);
    const match = out.match(/===== INPUT =====\n([\s\S]*?)\n===== END INPUT =====/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed.contentType).toBe('daily_digest');
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0].opportunityId).toBe('opp-1');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd packages/openclaw-plugin && bun test src/tests/main-agent.prompt.spec.ts`
Expected: import error (file does not exist).

- [ ] **Step 3: Implement `main-agent.prompt.ts`**

Create `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts`:

```ts
/**
 * Builds the prompt handed to the user's main OpenClaw agent when rendering an
 * Index Network notification. The shared skeleton is composed from clauses,
 * with the per-content-type instruction selected last. The `INPUT` block holds
 * the structured payload as JSON; the agent reads it directly.
 */

export type MainAgentToolUse = 'disabled' | 'enabled';

export type MainAgentContentType =
  | 'daily_digest'
  | 'ambient_discovery'
  | 'test_message';

export interface OpportunityCandidate {
  opportunityId: string;
  counterpartUserId: string;
  headline: string;
  personalizedSummary: string;
  suggestedAction: string;
  narratorRemark: string;
  profileUrl: string;
  acceptUrl: string;
  skipUrl: string;
}

export type MainAgentPayload =
  | {
      contentType: 'daily_digest' | 'ambient_discovery';
      maxToSurface: number;
      candidates: OpportunityCandidate[];
    }
  | {
      contentType: 'test_message';
      content: string;
    };

export interface MainAgentPromptInput {
  contentType: MainAgentContentType;
  mainAgentToolUse: MainAgentToolUse;
  allowSuppress: boolean;
  payload: MainAgentPayload;
}

export function buildMainAgentPrompt(input: MainAgentPromptInput): string {
  const lines: string[] = [
    'INDEX NETWORK NOTIFICATION',
    'You are speaking to the user in your own voice, on their active channel.',
    '',
    toolUseClause(input.mainAgentToolUse),
    '',
    URL_PRESERVATION_CLAUSE,
  ];

  if (input.allowSuppress) {
    lines.push('', NO_REPLY_CLAUSE);
  }

  lines.push('', perTypeInstruction(input));

  lines.push(
    '',
    '===== INPUT =====',
    JSON.stringify(input.payload, null, 2),
    '===== END INPUT =====',
  );

  return lines.join('\n');
}

const URL_PRESERVATION_CLAUSE = [
  'For any opportunity you decide to surface, include its acceptUrl and skipUrl exactly',
  'as given. Link the person\'s name to their profileUrl. Do not reword, shorten, or',
  'omit URLs. If you decide not to mention an opportunity, simply leave it out — do not',
  'output its data without an action link.',
].join('\n');

const NO_REPLY_CLAUSE = [
  'If this is a poor moment — user is mid-conversation on something else, has asked for',
  'quiet, or this feels mistimed — output exactly `NO_REPLY` as your entire reply. The',
  'runtime will suppress delivery; the items will roll over.',
].join('\n');

function toolUseClause(mode: MainAgentToolUse): string {
  if (mode === 'enabled') {
    return 'You may call Index Network MCP tools to enrich. Stay brief — the user is waiting.';
  }
  return 'Do not call any tools. Everything you need is in INPUT below.';
}

function perTypeInstruction(input: MainAgentPromptInput): string {
  switch (input.contentType) {
    case 'daily_digest': {
      const max = (input.payload as { maxToSurface: number }).maxToSurface;
      return [
        `Rank the candidates, pick up to ${max} to surface, render as a numbered digest in`,
        'your voice. The user is scanning at digest time. If none feel worth a digest today,',
        'NO_REPLY.',
      ].join('\n');
    }
    case 'ambient_discovery':
      return [
        'Real-time alert, not a digest. Surface only candidates worth interrupting for *right',
        'now*. If none qualify, NO_REPLY. Otherwise render briefly.',
      ].join('\n');
    case 'test_message':
      return 'Delivery verification. Render the content below in your voice. Do not suppress.';
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/openclaw-plugin && bun test src/tests/main-agent.prompt.spec.ts`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts \
        packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts
git commit -m "feat(openclaw-plugin): add main-agent prompt builder"
```

---

## Task 4: Plugin — `main-agent.dispatcher.ts`

**Files:**
- Create: `packages/openclaw-plugin/src/lib/delivery/main-agent.dispatcher.ts`
- Test: `packages/openclaw-plugin/src/tests/main-agent.dispatcher.spec.ts`

- [ ] **Step 1: Write failing tests for NO_REPLY detection**

Create `packages/openclaw-plugin/src/tests/main-agent.dispatcher.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  detectNoReply,
  dispatchToMainAgent,
  type DispatchContext,
} from '../lib/delivery/main-agent.dispatcher.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

describe('detectNoReply', () => {
  it.each([
    'NO_REPLY',
    'no_reply',
    'NoReply',
    '  NO_REPLY\n',
    'NO_REPLY then more text',
    'noreply',
  ])('detects suppression in %p', (input) => {
    expect(detectNoReply(input)).toBe(true);
  });

  it.each([
    'Hello — here is your digest',
    'I picked NO_REPLY out of curiosity', // not at start
    '',
    '   ',
  ])('does not detect suppression in %p', (input) => {
    expect(detectNoReply(input)).toBe(false);
  });
});

describe('dispatchToMainAgent', () => {
  let mockApi: OpenClawPluginApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockApi = {
      id: 'test-plugin',
      name: 'Test Plugin',
      pluginConfig: {},
      config: {
        gateway: { port: 18789, auth: { token: 'tok' } },
      },
      runtime: {
        subagent: {
          run: mock(async () => ({ runId: 'unused' })),
          waitForRun: mock(async () => ({ result: null })),
          getSessionMessages: mock(async () => ({ messages: [] })),
        },
        agent: {
          resolveAgentDir: () => '/tmp/agent',
          resolveAgentWorkspaceDir: () => '/tmp/workspace',
          resolveAgentIdentity: () => ({ id: 'main', sessionId: 'main:session' }),
          resolveAgentTimeoutMs: () => 60_000,
          runEmbeddedAgent: mock(async () => ({ text: 'Hello user' })),
        },
      },
      logger: {
        debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}),
      },
      registerHttpRoute: mock(() => {}),
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const ctx: DispatchContext = {
    prompt: 'PROMPT',
    idempotencyKey: 'k1',
    allowSuppress: true,
  };

  it('SDK happy path returns deliveredText', async () => {
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.suppressedByNoReply).toBe(false);
    expect(out.deliveredText).toBe('Hello user');
  });

  it('SDK NO_REPLY sets suppressedByNoReply', async () => {
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockResolvedValueOnce({
      text: 'NO_REPLY',
    });
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.suppressedByNoReply).toBe(true);
  });

  it('empty SDK reply is treated as suppression', async () => {
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockResolvedValueOnce({
      text: '   ',
    });
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.suppressedByNoReply).toBe(true);
  });

  it('SDK throws → falls back to /hooks/agent', async () => {
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('not supported'),
    );
    let capturedReq: { url: string; init?: RequestInit } | null = null;
    global.fetch = mock(async (input: RequestInfo, init?: RequestInit) => {
      capturedReq = { url: String(input), init };
      return new Response(JSON.stringify({ status: 'ok', text: 'Hello via hooks' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.deliveredText).toBe('Hello via hooks');
    expect(out.suppressedByNoReply).toBe(false);
    expect(capturedReq?.url).toContain('/hooks/agent');
  });

  it('SDK missing entirely → falls back to /hooks/agent', async () => {
    delete mockApi.runtime.agent;
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ status: 'ok', text: 'Hi' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.deliveredText).toBe('Hi');
  });

  it('both SDK and hooks fail → returns null deliveredText', async () => {
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('boom'),
    );
    global.fetch = mock(async () =>
      new Response('server error', { status: 500 }),
    ) as unknown as typeof fetch;
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.deliveredText).toBeNull();
    expect(out.error).toBe('network_error');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd packages/openclaw-plugin && bun test src/tests/main-agent.dispatcher.spec.ts`
Expected: all tests fail (file does not exist).

- [ ] **Step 3: Implement `main-agent.dispatcher.ts`**

Create `packages/openclaw-plugin/src/lib/delivery/main-agent.dispatcher.ts`:

```ts
/**
 * Drives the user's main OpenClaw agent to render a notification, returning
 * the rendered text and whether the agent suppressed delivery via NO_REPLY.
 *
 * Tries the in-process SDK first (`api.runtime.agent.runEmbeddedAgent`) and
 * falls back to the gateway HTTP hook (`POST /hooks/agent`) when the SDK
 * isn't available or the call rejects. Both paths produce the same return
 * shape so callers can stay primitive-agnostic.
 */

import type { OpenClawPluginApi } from '../openclaw/plugin-api.js';

export interface DispatchContext {
  prompt: string;
  idempotencyKey: string;
  /**
   * When true the prompt's caller has included a NO_REPLY clause; the helper
   * still inspects every reply for the token. When false the caller should
   * not have included the clause (used for test-message verification).
   */
  allowSuppress: boolean;
  /** Optional override for the embedded-agent timeout (ms). */
  timeoutMs?: number;
}

export interface DispatchResult {
  /** Rendered reply, or `null` when both paths failed. */
  deliveredText: string | null;
  /**
   * True when the agent's reply began with a NO_REPLY token, or was empty.
   * The caller MUST skip Phase 3 confirms when this is true.
   */
  suppressedByNoReply: boolean;
  /**
   * `'network_error'` when both SDK and hooks failed, used by callers to
   * signal scheduler backoff. Undefined on success or suppression.
   */
  error?: 'network_error';
}

const NO_REPLY_PATTERN = /^\s*no[\s_-]?reply\b/i;

export function detectNoReply(text: string | null | undefined): boolean {
  if (!text) return false;
  return NO_REPLY_PATTERN.test(text);
}

export async function dispatchToMainAgent(
  api: OpenClawPluginApi,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  const sdkResult = await trySdk(api, ctx);
  if (sdkResult.outcome === 'ok') return sdkResult.value;

  const hooksResult = await tryHooks(api, ctx);
  if (hooksResult.outcome === 'ok') return hooksResult.value;

  api.logger.warn('Main-agent dispatch failed via both SDK and hooks.');
  return { deliveredText: null, suppressedByNoReply: false, error: 'network_error' };
}

type Outcome<T> = { outcome: 'ok'; value: T } | { outcome: 'unavailable' | 'error' };

async function trySdk(
  api: OpenClawPluginApi,
  ctx: DispatchContext,
): Promise<Outcome<DispatchResult>> {
  const agent = api.runtime.agent;
  if (!agent || typeof agent.runEmbeddedAgent !== 'function') {
    return { outcome: 'unavailable' };
  }
  try {
    const identity = agent.resolveAgentIdentity(api.config);
    const sessionId = identity.sessionId ?? identity.id ?? 'main';
    const sessionFile = `${agent.resolveAgentDir(api.config).replace(/\/$/, '')}/sessions/${sessionId}.jsonl`;
    const workspaceDir = agent.resolveAgentWorkspaceDir(api.config);
    const timeoutMs = ctx.timeoutMs ?? agent.resolveAgentTimeoutMs(api.config);

    const result = await agent.runEmbeddedAgent({
      sessionId,
      runId: ctx.idempotencyKey,
      sessionFile,
      workspaceDir,
      prompt: ctx.prompt,
      timeoutMs,
    });

    const text = extractReplyText(result);
    return { outcome: 'ok', value: shapeResult(text) };
  } catch (err) {
    api.logger.info(
      `runEmbeddedAgent unavailable or threw: ${err instanceof Error ? err.message : String(err)} — falling back to /hooks/agent.`,
    );
    return { outcome: 'error' };
  }
}

async function tryHooks(
  api: OpenClawPluginApi,
  ctx: DispatchContext,
): Promise<Outcome<DispatchResult>> {
  const port = api.config?.gateway?.port;
  const token = api.config?.gateway?.auth?.token;
  if (!port) {
    api.logger.warn('Cannot fall back to /hooks/agent: gateway port not in config.');
    return { outcome: 'unavailable' };
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'idempotency-key': ctx.idempotencyKey,
      },
      body: JSON.stringify({
        message: ctx.prompt,
        agentId: 'main',
        wakeMode: 'now',
        deliver: true,
        channel: 'last',
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120_000),
    });

    if (!res.ok) {
      api.logger.warn(`/hooks/agent returned ${res.status}.`);
      return { outcome: 'error' };
    }

    // The hooks endpoint may or may not return the reply text; if it doesn't,
    // delivery still happened via the channel. Treat empty body as "delivered,
    // text unknown" — caller cannot scrape IDs from it, so confirms will be
    // skipped, but no NO_REPLY suppression is signaled.
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    const text = typeof body?.text === 'string' ? body.text : '';
    return { outcome: 'ok', value: shapeResult(text) };
  } catch (err) {
    api.logger.warn(
      `/hooks/agent threw: ${err instanceof Error ? err.message : String(err)}.`,
    );
    return { outcome: 'error' };
  }
}

function extractReplyText(result: { text?: string; messages?: Array<{ role: string; content: unknown }> }): string {
  if (typeof result.text === 'string') return result.text;
  const last = result.messages?.filter((m) => m.role === 'assistant').at(-1);
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) {
    return (last.content as Array<{ type?: string; text?: string }>)
      .filter((b) => b?.type === 'text')
      .map((b) => b?.text ?? '')
      .join('\n')
      .trim();
  }
  return '';
}

function shapeResult(rawText: string): DispatchResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { deliveredText: '', suppressedByNoReply: true };
  }
  if (detectNoReply(trimmed)) {
    return { deliveredText: trimmed, suppressedByNoReply: true };
  }
  return { deliveredText: trimmed, suppressedByNoReply: false };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/openclaw-plugin && bun test src/tests/main-agent.dispatcher.spec.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/lib/delivery/main-agent.dispatcher.ts \
        packages/openclaw-plugin/src/tests/main-agent.dispatcher.spec.ts
git commit -m "feat(openclaw-plugin): add main-agent dispatcher with hooks fallback"
```

---

## Task 5: Plugin — refactor `daily-digest.poller.ts`

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts`
- Test: `packages/openclaw-plugin/src/tests/daily-digest.test.ts`

The poller drops Phase 1 (evaluator) entirely. The candidate batch goes straight into a main-agent prompt. Confirm step uses the existing `extractSelectedIds` helper to scrape the rendered text.

- [ ] **Step 1: Update test fixtures and assertions**

Replace the body of `packages/openclaw-plugin/src/tests/daily-digest.test.ts`. Match existing test style (Bun's `mock`, `beforeEach`, `afterEach`). New behaviors to assert:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handle as handleDailyDigest } from '../polling/daily-digest/daily-digest.poller.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

describe('handleDailyDigest (main-agent path)', () => {
  let mockApi: OpenClawPluginApi;
  let runEmbeddedCalls: Array<{ prompt: string }>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    runEmbeddedCalls = [];
    originalFetch = global.fetch;

    mockApi = {
      id: 'test-plugin',
      name: 'Test',
      pluginConfig: { mainAgentToolUse: 'disabled' },
      config: { gateway: { port: 18789 } },
      runtime: {
        subagent: {
          run: mock(async () => ({ runId: 'unused' })),
          waitForRun: mock(async () => ({ result: null })),
          getSessionMessages: mock(async () => ({ messages: [] })),
        },
        agent: {
          resolveAgentDir: () => '/tmp/agent',
          resolveAgentWorkspaceDir: () => '/tmp/ws',
          resolveAgentIdentity: () => ({ id: 'main', sessionId: 'main' }),
          resolveAgentTimeoutMs: () => 60_000,
          runEmbeddedAgent: mock(async (opts) => {
            runEmbeddedCalls.push({ prompt: opts.prompt });
            return {
              text: '1. [Bryan](https://test.index.network/u/user-1) - good match (https://test.index.network/opportunities/opp-1/accept) (https://test.index.network/opportunities/opp-1/skip)',
            };
          }),
        },
      },
      logger: { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },
      registerHttpRoute: mock(() => {}),
    };
  });

  afterEach(() => { global.fetch = originalFetch; });

  function mockPending(opportunities: unknown[]) {
    const pendingUrls: string[] = [];
    const confirmCalls: string[] = [];
    global.fetch = mock(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/opportunities/pending')) {
        pendingUrls.push(url);
        return new Response(JSON.stringify({ opportunities }), { status: 200 });
      }
      if (url.includes('/delivered') || url.includes('/confirm-batch')) {
        confirmCalls.push(url);
        return new Response('{}', { status: 200 });
      }
      return new Response('not-found', { status: 404 });
    }) as unknown as typeof fetch;
    return { pendingUrls, confirmCalls };
  }

  it('fetches /pending with ?limit=20 (digest cap)', async () => {
    const sink = mockPending([]);
    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com', agentId: 'agent-123', apiKey: 'k',
      frontendUrl: 'https://test.index.network', maxCount: 20,
    });
    expect(sink.pendingUrls).toHaveLength(1);
    expect(sink.pendingUrls[0]).toContain('limit=20');
  });

  it('drives main agent with the daily-digest prompt', async () => {
    mockPending([
      { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com', agentId: 'agent-123', apiKey: 'k',
      frontendUrl: 'https://test.index.network', maxCount: 5,
    });
    expect(runEmbeddedCalls).toHaveLength(1);
    expect(runEmbeddedCalls[0].prompt).toContain('INDEX NETWORK NOTIFICATION');
    expect(runEmbeddedCalls[0].prompt).toContain('Rank the candidates');
  });

  it('confirms only IDs that appear in the rendered text', async () => {
    let confirmCalls: string[] = [];
    global.fetch = mock(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/opportunities/pending')) {
        return new Response(JSON.stringify({
          opportunities: [
            { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
            { opportunityId: 'opp-2', counterpartUserId: 'user-2', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
          ],
        }), { status: 200 });
      }
      if (url.includes('/confirm-batch')) {
        confirmCalls.push(url);
      }
      if (url.includes('/delivered') || url.includes('/confirm-batch')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('not-found', { status: 404 });
    }) as unknown as typeof fetch;
    // runEmbeddedAgent stub above returns text with opp-1 only.
    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com', agentId: 'agent-123', apiKey: 'k',
      frontendUrl: 'https://test.index.network', maxCount: 5,
    });
    expect(confirmCalls).toHaveLength(1); // only opp-1 confirmed; not opp-2
  });

  it('skips confirms when the agent emits NO_REPLY', async () => {
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockResolvedValueOnce({
      text: 'NO_REPLY',
    });
    let confirmCalls = 0;
    global.fetch = mock(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/opportunities/pending')) {
        return new Response(JSON.stringify({
          opportunities: [
            { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
          ],
        }), { status: 200 });
      }
      if (url.includes('/delivered') || url.includes('/confirm-batch')) {
        confirmCalls++;
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com', agentId: 'agent-123', apiKey: 'k',
      frontendUrl: 'https://test.index.network', maxCount: 5,
    });
    expect(confirmCalls).toBe(0);
  });

  it('returns false when /pending is empty', async () => {
    mockPending([]);
    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com', agentId: 'agent-123', apiKey: 'k',
      frontendUrl: 'https://test.index.network', maxCount: 5,
    });
    expect(result).toBe(false);
    expect(runEmbeddedCalls).toHaveLength(0);
  });
});
```

The first test (`fetches /pending with ?limit=20`) needs the URL captured by the fetch spy. Adjust the `mockPending` helper to capture URLs into an array, then assert that one of them matches `/opportunities/pending?limit=20`. Spell it out fully when implementing.

- [ ] **Step 2: Run tests to verify failure**

Run: `cd packages/openclaw-plugin && bun test src/tests/daily-digest.test.ts`
Expected: tests fail because the poller still uses the old evaluator + dispatcher path.

- [ ] **Step 3: Rewrite the poller**

Replace the body of `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts`:

```ts
import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt, type MainAgentToolUse } from '../../lib/delivery/main-agent.prompt.js';
import { extractSelectedIds, confirmDeliveredBatch } from '../../lib/delivery/post-delivery-confirm.js';
import { hashOpportunityBatch } from '../../lib/utils/hash.js';

export interface DailyDigestConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  frontendUrl: string;
  maxCount: number;
}

const PENDING_LIMIT = 20;

export async function handle(
  api: OpenClawPluginApi,
  config: DailyDigestConfig,
): Promise<boolean> {
  const pendingUrl = `${config.baseUrl}/api/agents/${config.agentId}/opportunities/pending?limit=${PENDING_LIMIT}`;

  let res: Response;
  try {
    res = await fetch(pendingUrl, {
      method: 'GET',
      headers: { 'x-api-key': config.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    api.logger.warn(`Daily digest fetch errored: ${err instanceof Error ? err.message : String(err)}`);
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
      counterpartUserId: string | null;
      rendered: { headline: string; personalizedSummary: string; suggestedAction: string; narratorRemark: string };
    }>;
  };

  if (!body.opportunities.length) {
    api.logger.info('Daily digest: no pending opportunities');
    return false;
  }

  const candidates = body.opportunities
    .filter((o): o is typeof o & { counterpartUserId: string } => o.counterpartUserId !== null)
    .map((o) => ({
      opportunityId: o.opportunityId,
      counterpartUserId: o.counterpartUserId,
      headline: o.rendered.headline,
      personalizedSummary: o.rendered.personalizedSummary,
      suggestedAction: o.rendered.suggestedAction,
      narratorRemark: o.rendered.narratorRemark,
      profileUrl: `${config.frontendUrl}/u/${o.counterpartUserId}`,
      acceptUrl: `${config.frontendUrl}/opportunities/${o.opportunityId}/accept`,
      skipUrl: `${config.frontendUrl}/opportunities/${o.opportunityId}/skip`,
    }));

  if (!candidates.length) return false;

  const dateStr = new Date().toISOString().slice(0, 10);
  const batchHash = hashOpportunityBatch(candidates.map((c) => c.opportunityId));
  const maxToSurface = Math.max(1, Math.min(config.maxCount, candidates.length));
  const mainAgentToolUse = readToolUseConfig(api);

  const prompt = buildMainAgentPrompt({
    contentType: 'daily_digest',
    mainAgentToolUse,
    allowSuppress: true,
    payload: { contentType: 'daily_digest', maxToSurface, candidates },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:daily-digest:${config.agentId}:${dateStr}:${batchHash}`,
    allowSuppress: true,
  });

  if (dispatch.error === 'network_error') {
    return false;
  }

  if (dispatch.suppressedByNoReply) {
    api.logger.info('Daily digest: agent suppressed via NO_REPLY.');
    return true;
  }

  if (!dispatch.deliveredText) {
    api.logger.debug('Daily digest: empty rendered text.');
    return true;
  }

  const batchIds = candidates.map((c) => c.opportunityId);
  const selectedIds = extractSelectedIds(dispatch.deliveredText, batchIds);

  if (selectedIds.length === 0) {
    api.logger.debug('Daily digest: rendered text has no recognizable IDs.');
    return true;
  }

  await confirmDeliveredBatch({
    baseUrl: config.baseUrl,
    agentId: config.agentId,
    apiKey: config.apiKey,
    opportunityIds: selectedIds,
    logger: api.logger,
  });

  api.logger.info(
    `Daily digest dispatched: ${candidates.length} candidate(s); ${selectedIds.length} confirmed`,
    { agentId: config.agentId },
  );

  return true;
}

function readToolUseConfig(api: OpenClawPluginApi): MainAgentToolUse {
  const v = api.pluginConfig['mainAgentToolUse'];
  return v === 'enabled' ? 'enabled' : 'disabled';
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/openclaw-plugin && bun test src/tests/daily-digest.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts \
        packages/openclaw-plugin/src/tests/daily-digest.test.ts
git commit -m "refactor(openclaw-plugin): drive daily digest through main agent"
```

---

## Task 6: Plugin — refactor `ambient-discovery.poller.ts`

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts`
- Test: `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts`

Same shape as Task 5, with three differences: `?limit=10`, content type `ambient_discovery`, and the existing `lastOpportunityBatchHash` dedup is preserved.

- [ ] **Step 1: Update tests**

Edit `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts`. Mirror the daily-digest test patterns from Task 5 but assert:
- `?limit=10` appears in the pending URL
- Prompt contains `'Real-time alert'`
- Same NO_REPLY-suppresses-confirm behavior
- Batch hash dedup: a second poll with identical opportunities does not re-call `runEmbeddedAgent` (read the existing test for this case to mirror its structure; it asserts on `subagentRunCalls.length` today — change to assert on `runEmbeddedCalls.length`).

- [ ] **Step 2: Run tests to verify failure**

Run: `cd packages/openclaw-plugin && bun test src/tests/opportunity-batch.spec.ts`
Expected: failure (poller still uses old path).

- [ ] **Step 3: Rewrite the poller**

Replace `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts`. Same shape as Task 5's daily-digest with these differences:

```ts
const PENDING_LIMIT = 10;

let lastOpportunityBatchHash: string | null = null;

// after computing batchHash:
if (batchHash === lastOpportunityBatchHash) {
  api.logger.info('Opportunity batch unchanged since last poll — skipping main-agent dispatch.');
  return false;
}

// in the prompt builder call:
buildMainAgentPrompt({
  contentType: 'ambient_discovery',
  mainAgentToolUse,
  allowSuppress: true,
  payload: { contentType: 'ambient_discovery', maxToSurface: candidates.length, candidates },
});

// idempotency key:
`index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`

// after every successful dispatch (including NO_REPLY and empty), update:
lastOpportunityBatchHash = batchHash;

// preserve _resetForTesting that resets lastOpportunityBatchHash
export function _resetForTesting(): void {
  lastOpportunityBatchHash = null;
}
```

Otherwise identical to Task 5. Reuse `readToolUseConfig` (export from one file or duplicate — for two callers, duplicating is fine; for three+, share via a `lib/delivery/config.ts` helper).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/openclaw-plugin && bun test src/tests/opportunity-batch.spec.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts \
        packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts
git commit -m "refactor(openclaw-plugin): drive ambient discovery through main agent"
```

---

## Task 7: Plugin — refactor `test-message.poller.ts`

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/test-message/test-message.poller.ts`
- Test: `packages/openclaw-plugin/src/tests/test-message-pickup.spec.ts`

The test message uses pickup-based reservation (60s TTL). It must NOT include the NO_REPLY clause; the prompt builder enforces this when `allowSuppress: false` is passed.

- [ ] **Step 1: Update tests**

Read the existing `test-message-pickup.spec.ts`, then update assertions:
- The dispatch call passes `allowSuppress: false`
- The prompt does not contain `'NO_REPLY'`
- If the agent emits `NO_REPLY` anyway, an `error` log is produced and no confirmation request is made
- Happy path: confirm is called with the test-message ID

- [ ] **Step 2: Run tests to verify failure**

Run: `cd packages/openclaw-plugin && bun test src/tests/test-message-pickup.spec.ts`
Expected: tests fail.

- [ ] **Step 3: Rewrite the poller**

The current poller picks up the test message, dispatches via `dispatchDelivery` with `contentType: 'test_message'`, then confirms. New version:

```ts
import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent, detectNoReply } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt, type MainAgentToolUse } from '../../lib/delivery/main-agent.prompt.js';

export interface TestMessageConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

export async function handle(
  api: OpenClawPluginApi,
  config: TestMessageConfig,
): Promise<void> {
  // 1. pickup
  const pickupUrl = `${config.baseUrl}/api/agents/${config.agentId}/test-messages/pickup`;
  const pickupRes = await fetch(pickupUrl, {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (pickupRes.status === 204) return;
  if (!pickupRes.ok) {
    api.logger.warn(`Test-message pickup failed: ${pickupRes.status}`);
    return;
  }
  const reservation = (await pickupRes.json()) as { testMessageId: string; content: string; reservationToken: string };

  // 2. dispatch via main agent (no NO_REPLY)
  const mainAgentToolUse = readToolUseConfig(api);
  const prompt = buildMainAgentPrompt({
    contentType: 'test_message',
    mainAgentToolUse,
    allowSuppress: false,
    payload: { contentType: 'test_message', content: reservation.content },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:test-message:${reservation.testMessageId}`,
    allowSuppress: false,
  });

  if (dispatch.error) {
    api.logger.warn('Test-message dispatch failed; reservation will expire.');
    return;
  }

  // 3. detect agent ignoring the no-suppress instruction
  if (dispatch.suppressedByNoReply || detectNoReply(dispatch.deliveredText ?? '')) {
    api.logger.error(
      'Test-message: agent emitted NO_REPLY despite prompt forbidding suppression. ' +
        'Reservation will expire and backend will retry.',
    );
    return;
  }

  // 4. confirm
  const confirmUrl = `${config.baseUrl}/api/agents/${config.agentId}/test-messages/${reservation.testMessageId}/delivered`;
  await fetch(confirmUrl, {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ reservationToken: reservation.reservationToken }),
    signal: AbortSignal.timeout(10_000),
  });
}

function readToolUseConfig(api: OpenClawPluginApi): MainAgentToolUse {
  const v = api.pluginConfig['mainAgentToolUse'];
  return v === 'enabled' ? 'enabled' : 'disabled';
}
```

(Verify the actual reservation/confirm endpoints by reading the existing test-message poller before replacing — if the response shape or confirm path differs, lift it from there.)

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/openclaw-plugin && bun test src/tests/test-message-pickup.spec.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/polling/test-message/test-message.poller.ts \
        packages/openclaw-plugin/src/tests/test-message-pickup.spec.ts
git commit -m "refactor(openclaw-plugin): drive test message through main agent"
```

---

## Task 8: Plugin — `setup.cli.ts` (drop delivery channel; add mainAgentToolUse)

**Files:**
- Modify: `packages/openclaw-plugin/src/setup/setup.cli.ts`
- Test: `packages/openclaw-plugin/src/tests/setup-entry.spec.ts`

- [ ] **Step 1: Update tests**

Open `setup-entry.spec.ts`. Remove any test that asserts on the delivery channel/target prompts. Add:

```ts
it('does not prompt for delivery channel', async () => {
  // run through runSetup with a SetupContext fake; assert select was never called
  // with 'Delivery channel'
});

it('prompts for main agent tool use after digest config', async () => {
  // assert select was called with 'Main agent tool use during Index Network renders'
  // and the configured value lands at plugins.entries.<id>.config.mainAgentToolUse
});

it('writes mainAgentToolUse=disabled by default selection', async () => {
  // ctx.select returns the first option; assert disabled is written
});

it('uses 20 as the default for digestMaxCount', async () => {
  // assert prompt was called with default '20'
});

it('does not error when stale deliveryChannel is in input config', async () => {
  // pre-populate cfg with deliveryChannel/deliveryTarget; run setup; assert no throw
  // and those keys are unchanged
});
```

Match the existing test scaffolding (the file already builds a `SetupContext` fake — extend it).

- [ ] **Step 2: Run tests to verify failure**

Run: `cd packages/openclaw-plugin && bun test src/tests/setup-entry.spec.ts`
Expected: failure.

- [ ] **Step 3: Update `setup.cli.ts`**

Edit `packages/openclaw-plugin/src/setup/setup.cli.ts`:

1. Remove the `CHANNEL_LABELS` and `TARGET_PROMPTS` constants near the top.
2. Remove the entire delivery-channel block (lines around 119-150 — the `if (configuredChannels.length > 0)` branch).
3. After the digest-config block, before the MCP server registration, add:

```ts
// --- Main agent tool use ---
const mainAgentToolUse = await ctx.select('Main agent tool use during Index Network renders', [
  { label: 'Disabled — agent renders from provided content only (default)', value: 'disabled' },
  { label: 'Enabled — agent may call MCP tools to enrich', value: 'enabled' },
]);
await ctx.configSet(`${configPrefix}.mainAgentToolUse`, mainAgentToolUse || 'disabled');
```

4. Update the digestMaxCount prompt default from `'10'` to `'20'`:
```ts
const digestMaxCount = await ctx.prompt('Max opportunities per digest', {
  default: existing('digestMaxCount') || '20',
});
```

5. Update the file's MIRROR comment block to reflect the new flow (Main Agent tool use prompt added; delivery channel block removed).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/openclaw-plugin && bun test src/tests/setup-entry.spec.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/setup/setup.cli.ts \
        packages/openclaw-plugin/src/tests/setup-entry.spec.ts
git commit -m "feat(openclaw-plugin): drop delivery channel; prompt for mainAgentToolUse"
```

---

## Task 9: Plugin — `openclaw.plugin.json` schema update

**Files:**
- Modify: `packages/openclaw-plugin/openclaw.plugin.json`

- [ ] **Step 1: Update configSchema**

Replace the `properties` block in `openclaw.plugin.json`:

```json
{
  "agentId": { "type": "string", "description": "Resolved automatically from the API key." },
  "apiKey": { "type": "string", "description": "Index Network agent API key." },
  "url": {
    "type": "string", "format": "uri", "default": "https://index.network",
    "description": "Index Network URL. Protocol and frontend URLs are derived automatically."
  },
  "protocolUrl": {
    "type": "string",
    "description": "Deprecated — migrated to 'url' on next setup run."
  },
  "mainAgentToolUse": {
    "type": "string",
    "enum": ["disabled", "enabled"],
    "default": "disabled",
    "description": "If 'enabled', the main agent may call MCP tools while rendering Index Network notifications."
  },
  "negotiationMode": {
    "type": "string", "enum": ["enabled", "disabled"], "default": "enabled",
    "description": "When set to \"disabled\", pending turns are skipped — Index Network falls back to its system negotiator."
  },
  "digestEnabled": {
    "type": "string", "enum": ["true", "false"], "default": "true",
    "description": "Set to \"false\" to disable daily digest."
  },
  "digestTime": {
    "type": "string", "pattern": "^([01]?[0-9]|2[0-3]):[0-5][0-9]$", "default": "08:00",
    "description": "Time to send digest in HH:MM format (24-hour, local timezone)."
  },
  "digestMaxCount": {
    "type": "string", "pattern": "^[0-9]+$", "default": "20",
    "description": "Maximum opportunities to include in daily digest."
  }
}
```

Compared to current: removed `deliveryChannel` and `deliveryTarget`; added `mainAgentToolUse`; changed `digestMaxCount` default from `"10"` to `"20"`.

- [ ] **Step 2: Validate JSON**

Run: `node --input-type=module -e 'JSON.parse(await import("node:fs").then(f => f.promises.readFile("packages/openclaw-plugin/openclaw.plugin.json", "utf-8")))'`
Or: `bun -e 'JSON.parse(require("fs").readFileSync("packages/openclaw-plugin/openclaw.plugin.json", "utf-8"))'`
Expected: no errors.

- [ ] **Step 3: Run plugin tests that cover the manifest**

Run: `cd packages/openclaw-plugin && bun test src/tests/skill-manifest.spec.ts src/tests/index.spec.ts`
Expected: pass (manifest spec doesn't typically assert on the dropped keys; if it does, update it).

- [ ] **Step 4: Commit**

```bash
git add packages/openclaw-plugin/openclaw.plugin.json
git commit -m "feat(openclaw-plugin): drop delivery routing config; add mainAgentToolUse"
```

---

## Task 10: Plugin — `index.ts` reads new config

**Files:**
- Modify: `packages/openclaw-plugin/src/index.ts`
- Test: `packages/openclaw-plugin/src/tests/index.spec.ts`

- [ ] **Step 1: Update tests**

In `index.spec.ts`, remove any expectations that hinge on `deliveryChannel`/`deliveryTarget` being read or used. Add a test that the plugin reads `mainAgentToolUse` and that pollers are invoked (or registered) regardless of whether `deliveryChannel` is set.

- [ ] **Step 2: Update `src/index.ts`**

The current `index.ts` does not read `mainAgentToolUse` (the pollers read it from `pluginConfig` directly). The change here is mostly removing comments / code paths that referenced delivery channel as a precondition. Specifically:

- Verify nothing in `index.ts` short-circuits on missing `deliveryChannel` (read it; if it does, remove that gate).
- Remove the `gatewayPort`/`gatewayToken` reads at lines ~127-128 IF nothing else uses them. (Note: the dispatcher's hooks fallback uses `api.config.gateway.port` directly via the helper; the plugin itself doesn't need to read it.) **Keep them** if they're still used by a scheduler or HTTP route.
- Confirm that the existing route registrations and scheduler starts still pass through correctly without `deliveryChannel`.

- [ ] **Step 3: Run tests**

Run: `cd packages/openclaw-plugin && bun test src/tests/index.spec.ts`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/openclaw-plugin/src/index.ts \
        packages/openclaw-plugin/src/tests/index.spec.ts
git commit -m "chore(openclaw-plugin): drop dead delivery-channel plumbing from entry"
```

---

## Task 11: Cleanup — delete dead files and update README

**Files:**
- Delete: `packages/openclaw-plugin/src/lib/delivery/delivery.dispatcher.ts`
- Delete: `packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts`
- Delete: `packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts`
- Delete: `packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts`
- Delete: `packages/openclaw-plugin/src/polling/negotiator/negotiation-accepted.prompt.ts`
- Delete: `packages/openclaw-plugin/src/tests/accepted.prompt.spec.ts`
- Delete: `packages/openclaw-plugin/src/tests/delivery.dispatcher.spec.ts`
- Delete: `packages/openclaw-plugin/src/tests/digest-evaluator.prompt.test.ts`
- Modify: `packages/openclaw-plugin/README.md`

- [ ] **Step 1: Delete files**

```bash
rm packages/openclaw-plugin/src/lib/delivery/delivery.dispatcher.ts
rm packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts
rm packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts
rm packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts
rm packages/openclaw-plugin/src/polling/negotiator/negotiation-accepted.prompt.ts
rm packages/openclaw-plugin/src/tests/accepted.prompt.spec.ts
rm packages/openclaw-plugin/src/tests/delivery.dispatcher.spec.ts
rm packages/openclaw-plugin/src/tests/digest-evaluator.prompt.test.ts
```

- [ ] **Step 2: Run the full plugin test suite to surface stale imports**

Run: `cd packages/openclaw-plugin && bun test`
Expected: pass. If a test or source file still imports a deleted module, fix it. Likely candidates:
- The negotiator poller may have an unused import of `acceptedPrompt`. Remove it.
- Any test file with a leftover import of `delivery.dispatcher`. Remove or update.

- [ ] **Step 3: Update README**

Open `packages/openclaw-plugin/README.md`. Replace:

- The "Automatic opportunity delivery (v1)" section. New content:

```markdown
## Automatic opportunity delivery

Once the plugin is configured with an `apiKey` (which resolves your `agentId`), the plugin polls the Index Network backend every 5 minutes for pending opportunities. When candidates are found, the plugin hands them to your **main OpenClaw agent** via an embedded turn. Your agent ranks them, picks what's worth surfacing, and renders the message in its own voice on whichever channel you currently chat with it. The plugin then confirms the opportunities the agent actually surfaced.

If the agent decides the moment is wrong, it can output `NO_REPLY` and the plugin skips delivery — the items roll over to the next cycle or the next daily digest.
```

- The Configuration table — remove `deliveryChannel` / `deliveryTarget` rows; add:

```markdown
- `mainAgentToolUse` (`"disabled"` | `"enabled"`, default `"disabled"`) — whether your main agent may call MCP tools while rendering Index Network notifications.
```

- The Daily Digest section — change the default for `digestMaxCount` to `20`.

- The "Pinning the subagent model" subsection — replace with a short note that the rendering happens inside your main agent's session, so the model used is your main agent's configured model.

- Any Telegram-specific examples (e.g. `openclaw config set ... deliveryChannel telegram`) — delete.

- Update the "Troubleshooting" entries that reference `deliveryChannel` / `deliveryTarget`.

- [ ] **Step 4: Commit**

```bash
git add -A packages/openclaw-plugin/
git commit -m "chore(openclaw-plugin): remove dispatcher + evaluator code; refresh README"
```

---

## Task 12: Frontend mirror — `WizardPromptGrid` + `SetupInstructions`

**Files:**
- Modify: `frontend/src/app/agents/[id]/page.tsx`
- Modify: `frontend/src/app/agents/page.tsx`

Both files have local copies of `WizardPromptGrid` and `SetupInstructions`. Update both.

- [ ] **Step 1: Read both files to find the exact prompt rows**

```bash
sed -n '140,260p' frontend/src/app/agents/page.tsx
sed -n '575,720p' frontend/src/app/agents/[id]/page.tsx
```

The structure should mirror `runSetup` order: URL → API key → Daily digest → digest time → digest max count → main agent tool use.

- [ ] **Step 2: Update both `WizardPromptGrid` and `SetupInstructions`**

In each file:

- Remove the rows for `Delivery channel` and the channel-specific recipient ID prompt.
- Add a row for `Main agent tool use during Index Network renders` with the same two options and copy as the CLI:
  - "Disabled — agent renders from provided content only (default)"
  - "Enabled — agent may call MCP tools to enrich"
- Update the displayed default for `Max opportunities per digest` from `10` to `20`.

If the components emit a numbered prompt list (the CLI session is recreated as a series of "Step N: …" rows), renumber accordingly so the steps are contiguous.

- [ ] **Step 3: Verify the dev server renders without errors**

Run: `cd frontend && bun run dev` (lets it boot to first compile). Look for TypeScript errors in the console.
Expected: no errors. Quit with Ctrl-C.

If a `lint` script exists for frontend, run it:
Run: `cd frontend && bun run lint`
Expected: pass (warnings about pre-existing unused vars are fine; no errors introduced by these edits).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/agents/page.tsx frontend/src/app/agents/\[id\]/page.tsx
git commit -m "feat(frontend): mirror plugin wizard — drop delivery channel; add mainAgentToolUse"
```

---

## Task 13: Version bumps + final test sweep

**Files:**
- Modify: `packages/openclaw-plugin/package.json`
- Modify: `packages/openclaw-plugin/openclaw.plugin.json`

- [ ] **Step 1: Decide the next version**

Read the current version (currently `0.15.4` per the spec exploration). This change is a feature with backwards-compatible config (stale keys are inert). Bump to **`0.16.0`** (minor).

- [ ] **Step 2: Bump both files**

Edit `packages/openclaw-plugin/package.json` — change `"version": "0.15.4"` → `"version": "0.16.0"`.
Edit `packages/openclaw-plugin/openclaw.plugin.json` — change `"version": "0.15.4"` → `"version": "0.16.0"`.

(Per CLAUDE.md, mismatched versions silently look like a no-op install. Always bump both.)

- [ ] **Step 3: Run full plugin tests**

Run: `cd packages/openclaw-plugin && bun test`
Expected: pass.

- [ ] **Step 4: Run backend tests touched**

Run: `cd backend && bun test src/services/tests/opportunity-delivery.spec.ts src/controllers/tests/agent.controller.spec.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/package.json packages/openclaw-plugin/openclaw.plugin.json
git commit -m "chore(openclaw-plugin): bump to 0.16.0"
```

---

## Task 14: Manual verification (E2E)

This is not a code task. Run these checks against a real OpenClaw + dev backend before requesting review. Tick each as you complete it.

- [ ] **Voice carry-through.** Configure a personalized OpenClaw agent (the flirty test agent or any custom voice). Trigger a daily digest manually. Verify the digest reaches Telegram in *that* agent's voice — opening line, formatting, asides — not the neutral template.

- [ ] **Test-message round-trip.** From the backend, send a test message to your agent. Verify the rendered text appears on the channel and the backend ledger marks it delivered.

- [ ] **NO_REPLY suppression.** Temporarily wedge `NO_REPLY` into the agent's reply (system-prompt one-off). Trigger a digest. Verify nothing reaches the user, no opportunities are confirmed, and the same opportunities remain pending in the backend afterwards.

- [ ] **Hooks fallback (optional).** If feasible, simulate a missing `runtime.agent` (e.g. older OpenClaw build). Verify the plugin still delivers via `/hooks/agent` and confirms work the same way.

- [ ] **Stale config tolerance.** With an existing user config that still has `deliveryChannel`/`deliveryTarget` set, verify the plugin starts cleanly with a single info log and no errors.

---

## Self-review checklist (run before handing off)

- [ ] Spec coverage: every section of the spec maps to at least one task above. (Architecture, Components, Data flow, Setup wizard, Prompts, Error handling, Testing — all addressed.)
- [ ] No `TBD`, `TODO`, or "implement later" placeholders.
- [ ] Type names consistent across tasks (`MainAgentToolUse`, `DispatchContext`, `DispatchResult`, `MainAgentPayload`, `OpportunityCandidate`).
- [ ] Spec's "out of scope" item (`negotiation_accept` wiring) is correctly skipped — no task wires it up.
- [ ] Frontend mirror covers BOTH `agents/page.tsx` AND `agents/[id]/page.tsx`.
- [ ] Version bump is exactly one task, both files together.
