# Plan A — Heartbeat-Aware Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop parking ambient negotiation turns on offline personal agents. Ambient negotiations for users with stale or missing personal agents fall back to the system agent immediately instead of waiting up to 24 hours.

**Architecture:** Add a `last_seen_at` column to `agents`, bump it on every personal-agent pickup poll (three endpoints), and rewrite the dispatcher to consult heartbeat freshness (`< 90s`) before parking. Park-window duration becomes the caller-supplied `timeoutMs` instead of a hardcoded 24h. The `waiting_for_agent` and `claimed` timers share one budget instead of stacking: the pickup handler arms the claim timer with the remaining park-window.

**Tech Stack:** Bun, Drizzle ORM, PostgreSQL, BullMQ, TypeScript.

**Design spec:** [2026-04-17-ambient-orchestrator-negotiation-flow-design.md](../specs/2026-04-17-ambient-orchestrator-negotiation-flow-design.md) (sections "Heartbeat on `agents`", "Dispatcher rewrite", "Timer reconciliation").

**Worktree:** Create an isolated worktree before executing: `git worktree add .worktrees/feat-heartbeat-dispatch dev` and run `bun run worktree:setup feat-heartbeat-dispatch`.

---

## File Structure

All changes are edits to existing files plus one new migration:

**Schema & migration:**
- `backend/src/schemas/database.schema.ts` — add `lastSeenAt` to the `agents` table.
- `backend/drizzle/NNNN_add_agents_last_seen_at.sql` — generated migration (renamed per repo convention).

**Adapter:**
- `backend/src/adapters/agent.database.adapter.ts` — extend `AgentRow` with `lastSeenAt`, update the row mapper, add `touchLastSeen(agentId)` method and an interface entry for it.

**Pickup sites (bump heartbeat):**
- `backend/src/controllers/agent.controller.ts` — three pickup handlers at lines ~372, 445, 490. Each calls `agentService.touchLastSeen(agentId)` before the existing logic.

**Dispatcher:**
- `backend/src/services/agent-dispatcher.service.ts` — rewrite `dispatch()` with heartbeat check.

**Timer single-budget plumbing:**
- `backend/src/services/negotiation-polling.service.ts` — at pickup time, compute remaining budget and pass it to the claim-timer enqueue call.
- `backend/src/queues/negotiation-claim-timeout.queue.ts` — no changes needed (already accepts `delayMs`; just verify).

**Caller timeout change:**
- `packages/protocol/src/negotiation/negotiation.tools.ts:421` — change hardcoded `24 * 60 * 60 * 1000` to a named `AMBIENT_PARK_WINDOW_MS = 5 * 60 * 1000`.

**Tests:**
- `backend/src/adapters/tests/agent.database.spec.ts` — `touchLastSeen` behavior.
- `backend/src/services/tests/agent-dispatcher.spec.ts` (new) — heartbeat matrix.
- `backend/src/services/tests/negotiation-polling.remaining-budget.spec.ts` (new) — remaining-budget arithmetic.

---

## Task 1 — Schema change: add `agents.last_seen_at`

**Files:**
- Modify: `backend/src/schemas/database.schema.ts:424-435`
- Create: `backend/drizzle/NNNN_add_agents_last_seen_at.sql`

- [ ] **Step 1: Modify schema**

In [backend/src/schemas/database.schema.ts](backend/src/schemas/database.schema.ts), add a nullable `lastSeenAt` column to the `agents` table. Find the existing `agents = pgTable('agents', { ... })` block (currently starts at line 424) and add:

```ts
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
```

Insert the new column after `updatedAt` and before `deletedAt`. Keep it nullable (no `.notNull()`, no default) — existing rows will legitimately have never been seen.

- [ ] **Step 2: Generate migration**

Run: `cd backend && bun run db:generate`
Expected: a new SQL file appears under `backend/drizzle/` with a random name.

- [ ] **Step 3: Rename migration per repo convention**

Rename the generated file to `NNNN_add_agents_last_seen_at.sql` where NNNN is the next sequential number. Update the corresponding `tag` entry in `backend/drizzle/meta/_journal.json` to match (without the `.sql` suffix). Do not touch snapshot files.

- [ ] **Step 4: Apply migration**

Run: `cd backend && bun run db:migrate`
Expected: migration applies without error.

- [ ] **Step 5: Verify no schema drift**

Run: `cd backend && bun run db:generate`
Expected output contains: "No schema changes detected" (or equivalent). If it tries to generate a new migration, the schema and DB are out of sync — fix before proceeding.

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/schemas/database.schema.ts drizzle/
git commit -m "feat(schema): add agents.last_seen_at for heartbeat tracking"
```

---

## Task 2 — Adapter plumbing: read and write `lastSeenAt`

**Files:**
- Modify: `backend/src/adapters/agent.database.adapter.ts:19-29, 89+` (add to `AgentRow`, interface, class)
- Test: `backend/src/adapters/tests/agent.database.spec.ts` (likely new file or extend existing)

- [ ] **Step 1: Add field to `AgentRow` interface**

In [backend/src/adapters/agent.database.adapter.ts:19-29](backend/src/adapters/agent.database.adapter.ts:19), extend the interface:

```ts
export interface AgentRow {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  type: AgentType;
  status: AgentStatus;
  metadata: Record<string, unknown>;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 2: Add `touchLastSeen` to the `AgentRegistryStore` interface**

In the same file, around line 89 where `AgentRegistryStore` is defined, add:

```ts
  touchLastSeen(agentId: string): Promise<void>;
```

- [ ] **Step 3: Update the row mapper**

Find the private method that maps DB rows to `AgentRow` (there will be one that reads `schema.agents` selects; likely named `mapAgentRow` or inlined in `getAgent`/`listAgentsForUser`). Ensure every place that constructs an `AgentRow` includes `lastSeenAt: row.lastSeenAt ?? null`.

If the mapper is inlined across several methods, extract a private helper:

```ts
  private toAgentRow(row: typeof schema.agents.$inferSelect): AgentRow {
    return {
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      description: row.description,
      type: row.type as AgentType,
      status: row.status as AgentStatus,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
```

and replace inline constructions with `this.toAgentRow(row)`.

- [ ] **Step 4: Write failing test for `touchLastSeen`**

Create or extend `backend/src/adapters/tests/agent.database.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { AgentDatabaseAdapter } from '../agent.database.adapter';
import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';

describe('AgentDatabaseAdapter.touchLastSeen', () => {
  const adapter = new AgentDatabaseAdapter();
  let testAgentId: string;
  let testUserId: string;

  beforeAll(async () => {
    // Insert a user and a personal agent for testing
    const [user] = await db.insert(schema.users).values({
      email: `heartbeat-test-${Date.now()}@test.local`,
      name: 'Heartbeat Test',
    }).returning({ id: schema.users.id });
    testUserId = user.id;

    const agent = await adapter.createAgent({
      ownerId: testUserId,
      name: 'Heartbeat Test Agent',
      type: 'personal',
    });
    testAgentId = agent.id;
  });

  afterAll(async () => {
    await db.delete(schema.agents).where(eq(schema.agents.id, testAgentId));
    await db.delete(schema.users).where(eq(schema.users.id, testUserId));
  });

  it('sets lastSeenAt to now() when called', async () => {
    const before = new Date();
    await adapter.touchLastSeen(testAgentId);
    const after = new Date();

    const agent = await adapter.getAgent(testAgentId);
    expect(agent).not.toBeNull();
    expect(agent!.lastSeenAt).not.toBeNull();
    expect(agent!.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(agent!.lastSeenAt!.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('updates lastSeenAt on repeated calls', async () => {
    await adapter.touchLastSeen(testAgentId);
    const first = (await adapter.getAgent(testAgentId))!.lastSeenAt!;
    await new Promise((r) => setTimeout(r, 50));
    await adapter.touchLastSeen(testAgentId);
    const second = (await adapter.getAgent(testAgentId))!.lastSeenAt!;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
  });

  it('is a no-op on unknown agent ids (does not throw)', async () => {
    await expect(adapter.touchLastSeen('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd backend && bun test src/adapters/tests/agent.database.spec.ts`
Expected: FAIL with TypeError or missing method error, since `touchLastSeen` isn't implemented yet.

- [ ] **Step 6: Implement `touchLastSeen`**

In [backend/src/adapters/agent.database.adapter.ts](backend/src/adapters/agent.database.adapter.ts), add to the `AgentDatabaseAdapter` class:

```ts
  /**
   * Update the agent's lastSeenAt timestamp. Called on every personal-agent pickup
   * poll so the dispatcher can tell whether the agent is actively running.
   *
   * Silently no-ops when the agent doesn't exist — callers invoke this from pickup
   * endpoints that already validated the agent, and we don't want to leak 404s
   * from a heartbeat update.
   */
  async touchLastSeen(agentId: string): Promise<void> {
    try {
      await db
        .update(schema.agents)
        .set({ lastSeenAt: new Date() })
        .where(and(eq(schema.agents.id, agentId), isNull(schema.agents.deletedAt)));
    } catch (err: unknown) {
      logger.warn('touchLastSeen failed', {
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd backend && bun test src/adapters/tests/agent.database.spec.ts`
Expected: all three tests pass.

- [ ] **Step 8: Commit**

```bash
cd backend
git add src/adapters/agent.database.adapter.ts src/adapters/tests/agent.database.spec.ts
git commit -m "feat(agents): add touchLastSeen adapter method and lastSeenAt field"
```

---

## Task 3 — Wire `touchLastSeen` into the agent service and controller

**Files:**
- Modify: `backend/src/services/agent.service.ts` (add passthrough method if using service-layer indirection; otherwise skip)
- Modify: `backend/src/controllers/agent.controller.ts:~372, ~445, ~490` (the three pickup handlers)
- Test: `backend/src/controllers/tests/agent.controller.heartbeat.spec.ts` (new)

- [ ] **Step 1: Expose `touchLastSeen` on agent service**

In `backend/src/services/agent.service.ts`, add a method that delegates to the adapter:

```ts
  /**
   * Bump the agent's lastSeenAt timestamp. Called by pickup endpoints.
   */
  async touchLastSeen(agentId: string): Promise<void> {
    return this.agentAdapter.touchLastSeen(agentId);
  }
```

(If the service file already uses a different adapter field name, match it. Do not rename the adapter instance variable.)

- [ ] **Step 2: Write failing controller test**

Create `backend/src/controllers/tests/agent.controller.heartbeat.spec.ts`:

```ts
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { AgentController } from '../agent.controller';

describe('AgentController pickup endpoints heartbeat', () => {
  let touchLastSeen: ReturnType<typeof mock>;
  let controller: AgentController;
  // ... wire up mock agentService with touchLastSeen spy + the minimum
  //     other methods each pickup handler uses, plus mocks for
  //     NegotiationPollingService, OpportunityService.pickupForAgent,
  //     AgentTestMessageService. Each handler should bump the heartbeat
  //     regardless of whether the underlying pickup finds work.

  it('pickupNegotiation bumps lastSeenAt before querying pending turns', async () => {
    // ... call controller.pickupNegotiation with a valid agentId
    expect(touchLastSeen).toHaveBeenCalledWith(agentId);
  });

  it('pickupOpportunity bumps lastSeenAt before querying pending deliveries', async () => {
    // same shape
  });

  it('pickupTestMessage bumps lastSeenAt before querying pending test messages', async () => {
    // same shape
  });

  it('bumps lastSeenAt even when nothing pending (empty poll)', async () => {
    // set underlying pickup to return null/empty; heartbeat still bumps
    expect(touchLastSeen).toHaveBeenCalledWith(agentId);
  });
});
```

Expand the `...` scaffolding to wire up the actual mock shape — the controller's constructor takes specific services; instantiate them as mocks that return empty/null for their pickup calls.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && bun test src/controllers/tests/agent.controller.heartbeat.spec.ts`
Expected: FAIL — `touchLastSeen` is never called because the handlers don't invoke it yet.

- [ ] **Step 4: Add heartbeat bumps to the three pickup handlers**

In [backend/src/controllers/agent.controller.ts](backend/src/controllers/agent.controller.ts), modify each pickup handler. The pattern is the same:

```ts
  @Post('/:id/negotiations/pickup')
  @UseGuards(AuthOrApiKeyGuard)
  async pickupNegotiation(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) throw new BadRequestError('agent id required');
    // ... existing ownership / permission validation ...

    // Heartbeat: record that this personal agent is actively polling
    await this.agentService.touchLastSeen(agentId);

    // ... existing pickup logic ...
  }
```

Apply the same `await this.agentService.touchLastSeen(agentId);` insertion in `pickupOpportunity` (line ~490) and `pickupTestMessage` (line ~445), placed immediately after the validation guards and before the call into the underlying pickup service.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && bun test src/controllers/tests/agent.controller.heartbeat.spec.ts`
Expected: all four tests pass.

- [ ] **Step 6: Run related integration tests to catch regressions**

Run: `cd backend && bun test src/controllers/tests/agent.controller.spec.ts` (if it exists) and any pickup-flow test files (`negotiation-polling.spec.ts`, `agent-test-message.spec.ts`, `opportunity.pickup.spec.ts` or similar).
Expected: no regressions. If any existing test broke because a mock didn't provide `touchLastSeen`, extend the mock — the heartbeat bump must not be conditional.

- [ ] **Step 7: Commit**

```bash
cd backend
git add src/services/agent.service.ts src/controllers/agent.controller.ts src/controllers/tests/agent.controller.heartbeat.spec.ts
git commit -m "feat(agents): bump lastSeenAt on every personal-agent pickup poll"
```

---

## Task 4 — Heartbeat-aware dispatcher

**Files:**
- Modify: `backend/src/services/agent-dispatcher.service.ts` (full rewrite of `dispatch()`)
- Test: `backend/src/services/tests/agent-dispatcher.spec.ts` (new)

- [ ] **Step 1: Write failing dispatcher test**

Create `backend/src/services/tests/agent-dispatcher.spec.ts`:

```ts
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { AgentDispatcherImpl } from '../agent-dispatcher.service';
import type { AgentWithRelations } from '../../adapters/agent.database.adapter';

function makeAgent(overrides: Partial<AgentWithRelations> = {}): AgentWithRelations {
  return {
    id: overrides.id ?? 'agent-1',
    ownerId: overrides.ownerId ?? 'user-1',
    name: 'Test Agent',
    description: null,
    type: overrides.type ?? 'personal',
    status: 'active',
    metadata: {},
    lastSeenAt: overrides.lastSeenAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    transports: [],
    permissions: [],
  };
}

const FRESH = new Date(Date.now() - 10_000); // 10s ago — well within 90s
const STALE = new Date(Date.now() - 120_000); // 2m ago — beyond 90s

describe('AgentDispatcherImpl.dispatch', () => {
  let enqueueTimeout: ReturnType<typeof mock>;
  let findAuthorizedAgents: ReturnType<typeof mock>;
  let dispatcher: AgentDispatcherImpl;

  beforeEach(() => {
    enqueueTimeout = mock(async () => 'job-id');
    findAuthorizedAgents = mock(async () => []);
    dispatcher = new AgentDispatcherImpl(
      { findAuthorizedAgents },
      { enqueueTimeout } as unknown as ConstructorParameters<typeof AgentDispatcherImpl>[1],
    );
  });

  const scope = { action: 'negotiation.respond', scopeType: 'network', scopeId: 'net-1' };
  const payload = { negotiationId: 'neg-1', history: [] } as Parameters<AgentDispatcherImpl['dispatch']>[2];

  it('returns no_agent when no personal agent is registered', async () => {
    findAuthorizedAgents.mockResolvedValue([]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result).toEqual({ handled: false, reason: 'no_agent' });
    expect(enqueueTimeout).not.toHaveBeenCalled();
  });

  it('returns timeout when all personal agents are stale', async () => {
    findAuthorizedAgents.mockResolvedValue([makeAgent({ lastSeenAt: STALE })]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('timeout');
    expect(enqueueTimeout).not.toHaveBeenCalled();
  });

  it('returns timeout when the personal agent has never been seen', async () => {
    findAuthorizedAgents.mockResolvedValue([makeAgent({ lastSeenAt: null })]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.reason).toBe('timeout');
    expect(enqueueTimeout).not.toHaveBeenCalled();
  });

  it('parks with the provided timeoutMs when a fresh personal agent exists', async () => {
    findAuthorizedAgents.mockResolvedValue([makeAgent({ lastSeenAt: FRESH })]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result).toEqual({ handled: false, reason: 'waiting', resumeToken: 'neg-1' });
    expect(enqueueTimeout).toHaveBeenCalledWith('neg-1', 0, 300_000);
  });

  it('parks when at least one of multiple agents is fresh', async () => {
    findAuthorizedAgents.mockResolvedValue([
      makeAgent({ id: 'a-stale', lastSeenAt: STALE }),
      makeAgent({ id: 'a-fresh', lastSeenAt: FRESH }),
    ]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.reason).toBe('waiting');
    expect(enqueueTimeout).toHaveBeenCalledTimes(1);
  });

  it('ignores system agents when checking freshness', async () => {
    findAuthorizedAgents.mockResolvedValue([
      makeAgent({ type: 'system', lastSeenAt: FRESH }),
      makeAgent({ type: 'personal', lastSeenAt: STALE }),
    ]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.reason).toBe('timeout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test src/services/tests/agent-dispatcher.spec.ts`
Expected: some assertions pass accidentally (current dispatcher returns `no_agent` when no personal agents exist), but the freshness-based tests will fail — current code parks regardless of heartbeat.

- [ ] **Step 3: Rewrite `dispatch()`**

Replace the body of [backend/src/services/agent-dispatcher.service.ts:46-109](backend/src/services/agent-dispatcher.service.ts:46) with:

```ts
  /**
   * Attempt to dispatch a negotiation turn to a personal agent.
   *
   * Heartbeat-aware: checks `lastSeenAt` on each personal agent. If none is fresh
   * (within 90 seconds), returns `timeout` so the graph falls back to the system
   * agent inline. Otherwise parks the turn in `waiting_for_agent` and arms the
   * response-window timer with the caller-supplied `timeoutMs`.
   *
   * `timeoutMs` is now the park-window budget (5 min ambient / 60 s orchestrator),
   * not a long-vs-short gate as in the previous implementation.
   */
  async dispatch(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
    payload: NegotiationTurnPayload,
    options: { timeoutMs: number },
  ): Promise<AgentDispatchResult> {
    const resolvedScopeType = scope.scopeType === 'negotiation' ? 'network' : scope.scopeType;

    const authorizedAgents = await this.agentService.findAuthorizedAgents(
      userId,
      scope.action,
      { type: resolvedScopeType as 'global' | 'node' | 'network', id: scope.scopeId },
    );

    const personalAgents = authorizedAgents.filter((a) => a.type === 'personal');

    if (personalAgents.length === 0) {
      return { handled: false, reason: 'no_agent' };
    }

    const freshnessThresholdMs = 90_000;
    const cutoff = Date.now() - freshnessThresholdMs;
    const freshAgents = personalAgents.filter(
      (a) => a.lastSeenAt != null && a.lastSeenAt.getTime() > cutoff,
    );

    if (freshAgents.length === 0) {
      logger.info('Personal agent registered but stale — falling back to system agent', {
        userId,
        agentCount: personalAgents.length,
        freshnessThresholdMs,
      });
      return { handled: false, reason: 'timeout' };
    }

    try {
      if (this.timeoutQueue) {
        await this.timeoutQueue
          .enqueueTimeout(payload.negotiationId, payload.history.length, options.timeoutMs)
          .catch((err: unknown) =>
            logger.error('Failed to enqueue negotiation timeout', {
              negotiationId: payload.negotiationId,
              error: err,
            }),
          );
      }

      logger.info('Turn parked for polling pickup', {
        userId,
        negotiationId: payload.negotiationId,
        freshAgentCount: freshAgents.length,
        parkWindowMs: options.timeoutMs,
      });

      return { handled: false, reason: 'waiting', resumeToken: payload.negotiationId };
    } catch (err) {
      logger.error('Failed to park turn for polling', {
        userId,
        negotiationId: payload.negotiationId,
        error: err,
      });
      return { handled: false, reason: 'timeout' };
    }
  }
```

Remove the previous `isLongTimeout` branching and the short-timeout fall-through — this single flow replaces both.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && bun test src/services/tests/agent-dispatcher.spec.ts`
Expected: all six tests pass.

- [ ] **Step 5: Run the broader test suite to catch regressions**

Run: `cd backend && bun test src/services/tests/ src/queues/tests/ tests/e2e.test.ts`
Expected: no regressions. Negotiation flows that previously expected `reason: 'timeout'` from short-timeout dispatches now get that via the stale-heartbeat path — the downstream graph should not care about the differentiation (it always falls back to system agent on `timeout`).

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/services/agent-dispatcher.service.ts src/services/tests/agent-dispatcher.spec.ts
git commit -m "feat(dispatcher): heartbeat-aware dispatch (stale agents skip park)"
```

---

## Task 5 — Single-budget timer reconciliation at pickup time

**Files:**
- Modify: `backend/src/services/negotiation-polling.service.ts:219-225` (pickup path)
- Test: `backend/src/services/tests/negotiation-polling.remaining-budget.spec.ts` (new)

- [ ] **Step 1: Read the current pickup logic**

Read [backend/src/services/negotiation-polling.service.ts:190-235](backend/src/services/negotiation-polling.service.ts:190). The relevant block cancels the 24h timer (`negotiationTimeoutQueue.cancelTimeout`) and arms the claim timer (`negotiationClaimTimeoutQueue.enqueueTimeout`) using the queue's default. You'll want to thread the original `timeoutMs` (park-window) and `parkStartTime` through so the claim timer gets the remaining budget instead of a fresh 6h.

- [ ] **Step 2: Identify where park-start time is available**

The task row has `createdAt` (when it was inserted) and `state` transitions. When a task enters `waiting_for_agent`, its `updatedAt` marks the park start. Confirm this by grepping:

Run: `grep -n "updateTaskState(.*'waiting_for_agent'" backend/src/services/`
Expected: shows the `updateTaskState` calls that transition to `waiting_for_agent` — each of these is a park-start point. The `updatedAt` timestamp on the task is the source of truth.

If multiple park-start timestamps are possible (e.g. a task can go `waiting_for_agent → claimed → waiting_for_agent` across turns), the remaining budget should be computed from the *current* `updatedAt` — the most recent park-start.

- [ ] **Step 3: Write failing test for remaining-budget arithmetic**

Create `backend/src/services/tests/negotiation-polling.remaining-budget.spec.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { computeRemainingBudgetMs } from '../negotiation-polling.service';

describe('computeRemainingBudgetMs', () => {
  it('returns full budget when task just started', () => {
    const parkStart = new Date();
    const result = computeRemainingBudgetMs(parkStart, 300_000);
    expect(result).toBeGreaterThan(299_000);
    expect(result).toBeLessThanOrEqual(300_000);
  });

  it('returns reduced budget after time has passed', () => {
    const parkStart = new Date(Date.now() - 60_000);
    const result = computeRemainingBudgetMs(parkStart, 300_000);
    expect(result).toBeGreaterThan(239_000);
    expect(result).toBeLessThanOrEqual(240_000);
  });

  it('clamps to a floor (never returns <= 0) so BullMQ delay is always positive', () => {
    const parkStart = new Date(Date.now() - 400_000);
    const result = computeRemainingBudgetMs(parkStart, 300_000);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(5_000); // small floor, e.g. 1s
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && bun test src/services/tests/negotiation-polling.remaining-budget.spec.ts`
Expected: FAIL — the function doesn't exist yet.

- [ ] **Step 5: Implement `computeRemainingBudgetMs`**

In [backend/src/services/negotiation-polling.service.ts](backend/src/services/negotiation-polling.service.ts), add (export it at module scope so tests can import):

```ts
/**
 * Compute the time remaining in a single park-window budget.
 *
 * The response-window timer, whether armed as the `waiting_for_agent` timeout or
 * as the `claimed` timeout, shares one budget rather than stacking. When an agent
 * picks up a parked turn, the claim timer is armed with whatever time is left
 * since park start, not a fresh full budget.
 *
 * Clamped to a 1-second floor so BullMQ delay is always positive.
 */
export function computeRemainingBudgetMs(
  parkStartTime: Date,
  totalBudgetMs: number,
): number {
  const elapsedMs = Date.now() - parkStartTime.getTime();
  const remainingMs = totalBudgetMs - elapsedMs;
  return Math.max(1_000, remainingMs);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && bun test src/services/tests/negotiation-polling.remaining-budget.spec.ts`
Expected: all three tests pass.

- [ ] **Step 7: Use `computeRemainingBudgetMs` at the pickup call site**

In [backend/src/services/negotiation-polling.service.ts:219-225](backend/src/services/negotiation-polling.service.ts:219), change the claim-timer arming to compute remaining budget. The block currently reads:

```ts
    // 4. Cancel 24h timeout (no longer waiting unclaimed)
    await negotiationTimeoutQueue.cancelTimeout(claimed.id);

    // ...

    await negotiationClaimTimeoutQueue.enqueueTimeout(claimed.id, turnNumber, agentId);
```

Replace with:

```ts
    // 4. Cancel park-window timer (no longer unpicked)
    await negotiationTimeoutQueue.cancelTimeout(claimed.id);

    // ...

    // Arm claim-timer with the remaining park-window budget, not a fresh 6h.
    // The task's `updatedAt` before this pickup was its park-start time.
    const totalBudgetMs = 5 * 60 * 1000; // matches AMBIENT_PARK_WINDOW_MS in negotiation.tools.ts
    const remainingMs = computeRemainingBudgetMs(claimed.updatedAt, totalBudgetMs);
    await negotiationClaimTimeoutQueue.enqueueTimeout(claimed.id, turnNumber, agentId, remainingMs);
```

Note: the task's `updatedAt` at the point of read (inside the CAS) is the value before the claim transition, because Postgres `RETURNING` returns the pre-update row view when using `UPDATE ... RETURNING` — verify this is the case in the existing implementation. If the existing code returns the post-update row (with `updatedAt = now()`), the remaining-budget calculation will be essentially `totalBudgetMs` minus a few ms, which is wrong.

If `updatedAt` is post-update, capture the pre-claim `updatedAt` explicitly: before the CAS, do a `SELECT updatedAt FROM tasks WHERE id = ? AND state = 'waiting_for_agent'` and use that value.

- [ ] **Step 8: Run the full polling-service test suite**

Run: `cd backend && bun test src/services/tests/negotiation-polling*.spec.ts`
Expected: all polling tests pass including the new budget tests.

- [ ] **Step 9: Commit**

```bash
cd backend
git add src/services/negotiation-polling.service.ts src/services/tests/negotiation-polling.remaining-budget.spec.ts
git commit -m "feat(negotiation): single park-window budget across pickup timers"
```

---

## Task 6 — Change ambient park-window default from 24h to 5 min

**Files:**
- Modify: `packages/protocol/src/negotiation/negotiation.tools.ts:421`
- Test: likely existing negotiation test files — run to confirm no breaks

- [ ] **Step 1: Define a named constant for the ambient park window**

In [packages/protocol/src/negotiation/negotiation.tools.ts](packages/protocol/src/negotiation/negotiation.tools.ts), add near the top of the file (after imports):

```ts
/**
 * Default park-window budget for ambient (background) negotiations. When a personal
 * agent is fresh, the dispatcher parks the turn and this is how long we wait before
 * the system agent takes over as a fallback.
 *
 * Short enough that ambient opportunities materialize in minutes (not hours),
 * long enough to cover two full polling cycles (30s * 2 = 60s) plus an agent
 * subagent turn. 5 minutes gives generous headroom.
 */
const AMBIENT_PARK_WINDOW_MS = 5 * 60 * 1000;
```

- [ ] **Step 2: Replace the inline 24h value**

At line 421 (the one currently reading `const timeoutMs = 24 * 60 * 60 * 1000;`), change to:

```ts
const timeoutMs = AMBIENT_PARK_WINDOW_MS;
```

- [ ] **Step 3: Search for other hardcoded 24h values in the negotiation path**

Run: `grep -rn "24 \* 60 \* 60 \* 1000\|24\*60\*60\*1000\|86400000" packages/protocol/src/negotiation backend/src/services/negotiation* backend/src/queues/negotiation*`
Expected: any other occurrences of the 24h default in the dispatch or negotiation paths should be reviewed and reconciled. The `negotiation-timeout.queue` BullMQ job age TTLs (e.g. `removeOnComplete: { age: 24 * 3600 }`) are NOT the same concept — leave those alone.

If any actually park-window-relevant 24h literal is found outside `negotiation.state.ts` default, replace it with `AMBIENT_PARK_WINDOW_MS`.

- [ ] **Step 4: Run negotiation test suite**

Run: `cd backend && bun test src/services/tests/negotiation*.spec.ts tests/negotiation*.spec.ts` and `cd .. && cd packages/protocol && bun test src/negotiation/tests/`
Expected: tests that compared against 24h timeout may need to be updated to 5 min. Find any `24 * 60 * 60 * 1000` assertion and change to `5 * 60 * 1000`. These are test expectations catching up to the new default, not real failures.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/negotiation/negotiation.tools.ts
# plus any test files you updated
git commit -m "feat(negotiation): default ambient park-window to 5min (was 24h)"
```

---

## Task 7 — Type-check and integration smoke

**Files:**
- None modified; verification only.

- [ ] **Step 1: Protocol type-check**

Run: `cd packages/protocol && bun run build`
Expected: builds without type errors. If a consumer of `AgentRow` in protocol-level interfaces is missing `lastSeenAt`, update the interface alignment. Protocol adapters define their own aligned types — if the protocol's `AgentRow`-equivalent diverges, the backend's adapter still compiles because they're deliberately decoupled (per the protocol layering rules). No changes required in protocol unless a type error surfaces.

- [ ] **Step 2: Backend type-check**

Run: `cd backend && bun run build` (or `bunx tsc --noEmit` if `build` doesn't type-check)
Expected: builds without type errors.

- [ ] **Step 3: Backend lint**

Run: `cd backend && bun run lint`
Expected: no new lint errors introduced by this plan.

- [ ] **Step 4: Run the full affected test suites**

Run the targeted suites (slower but comprehensive):

```bash
cd backend
bun test src/adapters/tests/
bun test src/services/tests/agent-dispatcher.spec.ts
bun test src/services/tests/negotiation-polling*
bun test src/controllers/tests/agent.controller.heartbeat.spec.ts
bun test src/queues/tests/
```

Expected: all pass.

- [ ] **Step 5: Manual end-to-end verification (dev env)**

Start the dev server (`bun run dev`), register a personal agent via the onboarding flow, start the openclaw plugin so it begins polling (~30s interval), and exercise the flow:

1. Verify `lastSeenAt` is updated on each poll: `select last_seen_at from agents where id = ?`.
2. Stop the plugin, wait 2 minutes, trigger an ambient opportunity discovery for the user (e.g. create a new intent). Confirm that the opportunity reaches a terminal state (`pending` / `rejected` / `stalled`) within ~30 seconds of the negotiation starting — no 24h wait.
3. Restart the plugin. Trigger another ambient discovery. Confirm the plugin picks up the turn (via the existing pickup path) and the response arrives; the opportunity reaches terminal state shortly after.

These are manual checks, not scripted — record observed timings in the commit message or PR description.

- [ ] **Step 6: Final commit and push**

```bash
git push origin <your-branch>  # or the worktree branch name
```

Open a PR to `dev` with a description covering: heartbeat column, dispatcher rewrite, single-budget timer model, and the default park-window change. Reference the design spec and IND numbers where applicable.

---

## Self-Review Checklist

Before handing off to execution:

- [ ] Every task has concrete file paths and complete code.
- [ ] No "TBD" / "TODO" / "implement later" placeholders.
- [ ] `touchLastSeen` signature matches between adapter, interface, and service.
- [ ] `computeRemainingBudgetMs` is consistent across test, implementation, and call site.
- [ ] Task 5 depends on Task 3's `lastSeenAt` column, Task 2's adapter method, and the existing pickup logic — sequence is preserved.
- [ ] Task 6 depends on Task 5 (so tests of the 5-min default land after the budget math is in).
- [ ] `AMBIENT_PARK_WINDOW_MS` (5 min) is used consistently in Task 5's call site and Task 6's named constant.
