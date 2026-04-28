# Agent-Driven Delivery Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user's main OpenClaw agent the sole decision-maker for which opportunities get delivered; tie ledger writes to the agent's per-opportunity confirm calls instead of the plugin's batch dispatch.

**Architecture:** Backend MCP tool gains a `trigger` parameter (`'ambient' | 'digest'`) recorded in the `opportunity_deliveries` ledger. A new `GET /agents/:id/opportunities/delivery-stats?since=…` endpoint counts ambient-vs-digest deliveries since a cutoff. The plugin stops calling `/confirm-batch`, fetches today's ambient count before each ambient cycle, and embeds it in the dispatch prompt; the agent calls `confirm_opportunity_delivery(id, trigger)` for each opportunity it surfaces. The legacy `/confirm-batch` controller route and the plugin's `post-delivery-confirm.ts` module are deleted.

**Tech Stack:** Bun runtime + bun:test, Drizzle ORM, PostgreSQL, Zod, TypeScript strict mode.

**Spec:** `docs/superpowers/specs/2026-04-27-agent-driven-delivery-design.md`

---

## File Map

### Modify
- `backend/src/services/opportunity-delivery.service.ts` — add `trigger` param to `commitDelivery`; add `countDeliveriesSince`.
- `backend/src/services/tests/opportunity-delivery.spec.ts` — extend with trigger + count tests.
- `backend/src/protocol-init.ts:78-81` — forward `trigger` from MCP tool through `deliveryLedger.confirmOpportunityDelivery`.
- `backend/src/controllers/agent.controller.ts` — add `getDeliveryStats` route; delete `confirmBatchDelivered` route + `batchConfirmDeliveredSchema`.
- `packages/protocol/src/shared/interfaces/delivery-ledger.interface.ts` — add `trigger` to params.
- `packages/protocol/src/opportunity/opportunity.tools.ts:1148-1183` — add `trigger` to MCP tool schema; forward.
- `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts` — rewrite ambient + digest instruction blocks; replace `maxToSurface` with `ambientDeliveredToday` on ambient payload; update `toolUseClause`.
- `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts` — add stats fetch; remove `confirmDeliveredBatch` call; advance dedup hash on dispatch (not confirm).
- `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts` — remove `confirmDeliveredBatch` call; drop `digestMaxCount` / `maxCount`.
- `packages/openclaw-plugin/src/index.ts:220-232` — drop `digestMaxCount` config read; drop `maxCount` from poll handler args.
- `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts` — update assertions for stats fetch + no confirm.
- `packages/openclaw-plugin/src/tests/daily-digest.test.ts` — update for no confirm + no maxCount.
- `packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts` — update for new payload + instruction wording.
- `packages/protocol/package.json` — version bump.
- `packages/openclaw-plugin/package.json` — version bump.
- `packages/openclaw-plugin/openclaw.plugin.json` — version bump (must match `package.json`).

### Delete
- `packages/openclaw-plugin/src/lib/delivery/post-delivery-confirm.ts` — no remaining callers.

---

## Task 1: Add `trigger` to `DeliveryLedger` interface and MCP tool

**Context:** This change starts in the protocol package because everything else depends on the new interface shape. The `confirm_opportunity_delivery` MCP tool gains a required `trigger` enum argument; the agent supplies `'ambient'` or `'digest'` based on which dispatch context it's responding to. Protocol package is self-contained — its build does not include `backend/`, so this task lands a clean type change without breaking compile inside `packages/protocol/`. The backend's protocol-init wiring is updated in Task 2.

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/delivery-ledger.interface.ts`
- Modify: `packages/protocol/src/opportunity/opportunity.tools.ts:1148-1183`

- [ ] **Step 1: Update `DeliveryLedger` interface**

Replace the file `packages/protocol/src/shared/interfaces/delivery-ledger.interface.ts`:

```typescript
/**
 * Delivery ledger interface for committing opportunity delivery rows.
 * Implementations live in src/adapters (e.g. database adapter).
 */

export interface DeliveryLedger {
  /**
   * Write a committed delivery row for an opportunity.
   * Returns 'confirmed' on first delivery, 'already_delivered' if previously committed.
   *
   * @param trigger - Which dispatch path produced this delivery: 'ambient' for
   *                  real-time critical alerts (≤3/day target), 'digest' for the
   *                  daily sweep of everything ambient passed on.
   */
  confirmOpportunityDelivery(params: {
    opportunityId: string;
    userId: string;
    agentId: string | null;
    trigger: 'ambient' | 'digest';
  }): Promise<'confirmed' | 'already_delivered'>;
}
```

- [ ] **Step 2: Update MCP tool schema and handler**

Replace `packages/protocol/src/opportunity/opportunity.tools.ts:1148-1183`:

```typescript
const confirmOpportunityDelivery = defineTool({
  name: "confirm_opportunity_delivery",
  description:
    "Marks an opportunity as delivered to the user via the OpenClaw channel. " +
    "Call this for each opportunity you decide to surface, BEFORE including it in your delivery message. " +
    "The 'trigger' argument records which dispatch path produced this delivery: " +
    "'ambient' for real-time critical alerts (target ≤3/day), 'digest' for the daily sweep. " +
    "Idempotent — safe to call even if the opportunity was already confirmed.",
  querySchema: z.object({
    opportunityId: z
      .string()
      .describe("The UUID of the opportunity to mark as delivered."),
    trigger: z
      .enum(['ambient', 'digest'])
      .describe(
        "Which dispatch path produced this delivery. Use 'ambient' if the dispatch prompt says you are in the ambient pass; use 'digest' if it says you are in the daily digest.",
      ),
  }),
  handler: async ({ context, query }) => {
    if (!context.isMcp || !context.agentId) {
      return error(
        "confirm_opportunity_delivery is only available to authenticated agent MCP contexts.",
      );
    }
    if (!deps.deliveryLedger) {
      return error("Delivery ledger not available in this context.");
    }
    if (!UUID_REGEX.test(query.opportunityId)) {
      return error("Invalid opportunity ID format.");
    }
    try {
      const result = await deps.deliveryLedger.confirmOpportunityDelivery({
        opportunityId: query.opportunityId,
        userId: context.userId,
        agentId: context.agentId,
        trigger: query.trigger,
      });
      return success({ status: result });
    } catch (err) {
      logger.error('Failed to confirm opportunity delivery', { err });
      return error('Failed to confirm opportunity delivery. Please try again.');
    }
  },
});
```

- [ ] **Step 3: Build protocol package**

```bash
cd packages/protocol && bun run build && cd -
```
Expected: PASS, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/shared/interfaces/delivery-ledger.interface.ts \
        packages/protocol/src/opportunity/opportunity.tools.ts
git commit -m "feat(protocol): add trigger to confirm_opportunity_delivery MCP tool"
```

---

## Task 2: Backend — extend `commitDelivery`, forward trigger, delete `confirm-batch` route

**Context:** With the protocol interface now requiring `trigger`, the backend wiring updates in lockstep: `commitDelivery` accepts and writes the trigger; `protocol-init.ts` forwards it; the legacy `confirm-batch` route (its only other caller) is deleted. After this task lands, the codebase compiles cleanly end-to-end.

**Files:**
- Modify: `backend/src/services/opportunity-delivery.service.ts:233-287`
- Modify: `backend/src/services/tests/opportunity-delivery.spec.ts`
- Modify: `backend/src/protocol-init.ts:78-81`
- Modify: `backend/src/controllers/agent.controller.ts` (delete `confirmBatchDelivered`, `batchConfirmDeliveredSchema`)

- [ ] **Step 1: Write failing test for trigger column write**

Add to `backend/src/services/tests/opportunity-delivery.spec.ts` inside the existing `describe('commitDelivery', …)` block:

```typescript
it('writes the supplied trigger value to the ledger', async () => {
  const userId = await seedUser();
  const agentId = await seedAgent(userId);
  const opportunityId = await seedOpportunity([userId], 'pending');

  const result = await svc.commitDelivery(opportunityId, userId, agentId, 'ambient');
  expect(result).toBe('confirmed');

  const [row] = await db
    .select({ trigger: opportunityDeliveries.trigger })
    .from(opportunityDeliveries)
    .where(eq(opportunityDeliveries.opportunityId, opportunityId));
  expect(row.trigger).toBe('ambient');
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
bun test backend/src/services/tests/opportunity-delivery.spec.ts
```
Expected: FAIL — file does not compile because (a) `commitDelivery` takes 3 args, not 4, and (b) `protocol-init.ts:78-81` does not forward the now-required `trigger` to `confirmOpportunityDelivery`. Both errors fixed in next steps.

- [ ] **Step 3: Add `trigger` parameter to `commitDelivery`**

Replace `commitDelivery` in `backend/src/services/opportunity-delivery.service.ts`:

```typescript
async commitDelivery(
  opportunityId: string,
  userId: string,
  agentId: string | null,
  trigger: 'ambient' | 'digest',
): Promise<'confirmed' | 'already_delivered'> {
  const [opp] = await db
    .select({ id: opportunities.id, status: opportunities.status, actors: opportunities.actors })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId));

  if (!opp) throw new Error('opportunity_not_found');

  const actors = opp.actors as Array<{ userId: string; role: string }>;
  if (!actors.some((a) => a.userId === userId)) {
    throw new Error('not_authorized');
  }

  const existing = await db
    .select({ id: opportunityDeliveries.id })
    .from(opportunityDeliveries)
    .where(
      and(
        eq(opportunityDeliveries.opportunityId, opportunityId),
        eq(opportunityDeliveries.userId, userId),
        eq(opportunityDeliveries.channel, CHANNEL),
        eq(opportunityDeliveries.deliveredAtStatus, opp.status),
        isNotNull(opportunityDeliveries.deliveredAt),
      ),
    )
    .limit(1);

  if (existing.length > 0) return 'already_delivered';

  try {
    await db.insert(opportunityDeliveries).values({
      opportunityId,
      userId,
      agentId,
      channel: CHANNEL,
      trigger,
      deliveredAtStatus: opp.status,
      reservationToken: randomUUID(),
      reservedAt: new Date(),
      deliveredAt: new Date(),
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return 'already_delivered';
    }
    throw err;
  }

  return 'confirmed';
}
```

- [ ] **Step 4: Update `protocol-init.ts` adapter to forward `trigger`**

Replace `backend/src/protocol-init.ts:78-81`:

```typescript
deliveryLedger: {
  confirmOpportunityDelivery: ({ opportunityId, userId, agentId, trigger }) =>
    opportunityDeliveryService.commitDelivery(opportunityId, userId, agentId, trigger),
},
```

- [ ] **Step 5: Delete `confirmBatchDelivered` route + schema**

In `backend/src/controllers/agent.controller.ts`:
- Remove the `batchConfirmDeliveredSchema` Zod schema declaration (search for `batchConfirmDeliveredSchema`).
- Remove the entire `@Post('/:id/opportunities/confirm-batch')` route handler (`confirmBatchDelivered` method).

- [ ] **Step 6: Update existing `commitDelivery` test call sites**

Existing tests in `opportunity-delivery.spec.ts` call `svc.commitDelivery(opportunityId, userId, agentId)` — update each call site to add a fourth `'ambient'` argument:

```bash
grep -n 'commitDelivery' backend/src/services/tests/opportunity-delivery.spec.ts
```

For each match, replace `svc.commitDelivery(opportunityId, userId, agentId)` with `svc.commitDelivery(opportunityId, userId, agentId, 'ambient')`. (Five call sites at the time of writing.)

- [ ] **Step 7: Run tests, verify pass**

```bash
bun test backend/src/services/tests/opportunity-delivery.spec.ts
```
Expected: All PASS, including the new "writes the supplied trigger value" test.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/opportunity-delivery.service.ts \
        backend/src/services/tests/opportunity-delivery.spec.ts \
        backend/src/protocol-init.ts \
        backend/src/controllers/agent.controller.ts
git commit -m "feat(backend): add trigger to commitDelivery, drop confirm-batch route"
```

---

## Task 3: Add `countDeliveriesSince` service method

**Context:** Powers the new stats endpoint. Counts committed `opportunity_deliveries` rows by `trigger` for the given agent since a cutoff timestamp.

**Files:**
- Modify: `backend/src/services/opportunity-delivery.service.ts`
- Modify: `backend/src/services/tests/opportunity-delivery.spec.ts`

- [ ] **Step 1: Write failing test**

Add at the end of `backend/src/services/tests/opportunity-delivery.spec.ts`:

```typescript
describe('countDeliveriesSince', () => {
  const svc = new OpportunityDeliveryService(
    new StubPresenter() as never,
    stubPresenterDb as never,
  );

  beforeEach(async () => {
    await db.delete(opportunityDeliveries);
  });

  it('counts deliveries grouped by trigger since the cutoff', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const opp1 = await seedOpportunity([userId], 'pending');
    const opp2 = await seedOpportunity([userId], 'pending');
    const opp3 = await seedOpportunity([userId], 'pending');

    await svc.commitDelivery(opp1, userId, agentId, 'ambient');
    await svc.commitDelivery(opp2, userId, agentId, 'ambient');
    await svc.commitDelivery(opp3, userId, agentId, 'digest');

    const result = await svc.countDeliveriesSince(agentId, new Date(Date.now() - 60_000));
    expect(result).toEqual({ ambient: 2, digest: 1 });
  });

  it('returns zero counts when nothing matches', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const result = await svc.countDeliveriesSince(agentId, new Date());
    expect(result).toEqual({ ambient: 0, digest: 0 });
  });

  it('excludes rows older than the cutoff', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const opp = await seedOpportunity([userId], 'pending');
    await svc.commitDelivery(opp, userId, agentId, 'ambient');

    const future = new Date(Date.now() + 60_000);
    const result = await svc.countDeliveriesSince(agentId, future);
    expect(result).toEqual({ ambient: 0, digest: 0 });
  });

  it('excludes rows where delivered_at is null (uncommitted reservations)', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const opp = await seedOpportunity([userId], 'pending');
    // Insert a reservation row directly (no delivered_at)
    await db.insert(opportunityDeliveries).values({
      opportunityId: opp,
      userId,
      agentId,
      channel: 'openclaw',
      trigger: 'ambient',
      deliveredAtStatus: 'pending',
      reservationToken: randomUUID(),
      reservedAt: new Date(),
    });

    const result = await svc.countDeliveriesSince(agentId, new Date(Date.now() - 60_000));
    expect(result).toEqual({ ambient: 0, digest: 0 });
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
bun test backend/src/services/tests/opportunity-delivery.spec.ts -t "countDeliveriesSince"
```
Expected: FAIL — `countDeliveriesSince is not a function`.

- [ ] **Step 3: Implement `countDeliveriesSince`**

Add to `OpportunityDeliveryService` in `backend/src/services/opportunity-delivery.service.ts` (right after `fetchPendingCandidates`):

```typescript
/**
 * Count committed deliveries for an agent grouped by trigger since `since`.
 * Rows where `delivered_at IS NULL` (open reservations) are excluded.
 *
 * @param agentId - Agent whose deliveries to count.
 * @param since - Lower bound (inclusive) on `delivered_at`.
 */
async countDeliveriesSince(
  agentId: string,
  since: Date,
): Promise<{ ambient: number; digest: number }> {
  const result = await db.execute(sql`
    SELECT trigger, COUNT(*)::int AS count
    FROM opportunity_deliveries
    WHERE agent_id = ${agentId}
      AND delivered_at IS NOT NULL
      AND delivered_at >= ${since.toISOString()}
      AND trigger IN ('ambient', 'digest')
    GROUP BY trigger
  `);

  const rows = result as unknown as Array<{ trigger: string; count: number }>;
  const counts = { ambient: 0, digest: 0 };
  for (const row of rows) {
    if (row.trigger === 'ambient' || row.trigger === 'digest') {
      counts[row.trigger] = row.count;
    }
  }
  return counts;
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test backend/src/services/tests/opportunity-delivery.spec.ts -t "countDeliveriesSince"
```
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/opportunity-delivery.service.ts \
        backend/src/services/tests/opportunity-delivery.spec.ts
git commit -m "feat(backend): add countDeliveriesSince to OpportunityDeliveryService"
```

---

## Task 4: Add `GET /agents/:id/opportunities/delivery-stats` route

**Context:** HTTP surface for the count. Validates `since` parses as a finite ISO date; rejects malformed input with 400. Auth via existing `AuthOrApiKeyGuard`.

**Files:**
- Modify: `backend/src/controllers/agent.controller.ts`
- Modify: `backend/src/controllers/tests/agent.controller.heartbeat.spec.ts` (add or pair with — see step 1)

- [ ] **Step 1: Locate the controller test pattern and add a new test file**

Existing controller tests live alongside controller in `backend/src/controllers/tests/`. Create `backend/src/controllers/tests/agent.controller.delivery-stats.spec.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const getByIdMock = mock(async (_agentId: string, _userId: string) => ({
  id: _agentId,
  ownerId: _userId,
  name: 'a',
  type: 'personal',
}));
const touchLastSeenMock = mock(async (_agentId: string) => {});
const countDeliveriesSinceMock = mock(async (_agentId: string, _since: Date) => ({
  ambient: 2,
  digest: 1,
}));

mock.module('../../services/agent.service', () => ({
  agentService: {
    getById: getByIdMock,
    touchLastSeen: touchLastSeenMock,
  },
}));

mock.module('../../services/opportunity-delivery.service', () => ({
  opportunityDeliveryService: {
    countDeliveriesSince: countDeliveriesSinceMock,
  },
}));

import { AgentController } from '../agent.controller';

describe('AgentController.getDeliveryStats', () => {
  beforeEach(() => {
    getByIdMock.mockClear();
    countDeliveriesSinceMock.mockClear();
  });

  it('returns counts when since parses', async () => {
    const ctrl = new AgentController();
    const since = '2026-04-27T00:00:00.000Z';
    const req = new Request(
      `http://x/agents/agent-1/opportunities/delivery-stats?since=${encodeURIComponent(since)}`,
    );
    const user = { id: 'user-1' } as never;
    const res = await ctrl.getDeliveryStats(req, user, { id: 'agent-1' } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ambient: number; digest: number };
    expect(body).toEqual({ ambient: 2, digest: 1 });
    expect(countDeliveriesSinceMock).toHaveBeenCalledWith('agent-1', new Date(since));
  });

  it('rejects missing since with 400', async () => {
    const ctrl = new AgentController();
    const req = new Request(`http://x/agents/agent-1/opportunities/delivery-stats`);
    const user = { id: 'user-1' } as never;
    const res = await ctrl.getDeliveryStats(req, user, { id: 'agent-1' } as never);
    expect(res.status).toBe(400);
  });

  it('rejects malformed since with 400', async () => {
    const ctrl = new AgentController();
    const req = new Request(
      `http://x/agents/agent-1/opportunities/delivery-stats?since=not-a-date`,
    );
    const user = { id: 'user-1' } as never;
    const res = await ctrl.getDeliveryStats(req, user, { id: 'agent-1' } as never);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
bun test backend/src/controllers/tests/agent.controller.delivery-stats.spec.ts
```
Expected: FAIL — `getDeliveryStats is not a function`.

- [ ] **Step 3: Add the route**

In `backend/src/controllers/agent.controller.ts`, add the following method inside `AgentController` (right after `getPendingOpportunities` and before `confirmOpportunityDelivered`):

```typescript
@Get('/:id/opportunities/delivery-stats')
@UseGuards(AuthOrApiKeyGuard)
async getDeliveryStats(req: Request, user: AuthenticatedUser, params?: RouteParams) {
  const agentId = params?.id;
  if (!agentId) {
    return jsonError('Agent ID is required', 400);
  }

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get('since');
  if (!sinceParam) {
    return jsonError('since query parameter is required (ISO 8601)', 400);
  }
  const since = new Date(sinceParam);
  if (Number.isNaN(since.getTime())) {
    return jsonError('since must be a valid ISO 8601 timestamp', 400);
  }

  try {
    await agentService.getById(agentId, user.id);
    await agentService.touchLastSeen(agentId);
    const counts = await opportunityDeliveryService.countDeliveriesSince(agentId, since);
    return Response.json(counts);
  } catch (err) {
    return jsonError(parseErrorMessage(err), errorStatus(err));
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test backend/src/controllers/tests/agent.controller.delivery-stats.spec.ts
```
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/agent.controller.ts \
        backend/src/controllers/tests/agent.controller.delivery-stats.spec.ts
git commit -m "feat(backend): add GET /agents/:id/opportunities/delivery-stats"
```

---

## Task 5: Plugin — rewrite ambient/digest prompt builder

**Context:** Update the per-content-type instruction blocks to (a) explain the two-pass relationship to the agent, (b) mandate the confirm call, (c) carry today's ambient count for the agent's self-restraint. Drop `maxToSurface` from both payload variants. Update `toolUseClause` so the toggle gates only enrichment-style tools (the confirm call is always required by the per-type instruction). Update both poller call sites in lockstep so the codebase compiles after this task.

**Files:**
- Modify: `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts`
- Modify: `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts:106-110` (call-site only — the rest of the poller changes in Task 6)
- Modify: `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts:91-98` (call-site + drop `maxToSurface` use; the confirm-removal happens in Task 7)
- Modify: `packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts`

- [ ] **Step 1: Write failing prompt-builder tests**

Replace the body of `packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts` (file-level rewrite — keep the `import` line and `OpportunityCandidate` shape; replace tests):

```typescript
import { describe, expect, it } from 'bun:test';

import {
  buildMainAgentPrompt,
  type OpportunityCandidate,
} from '../lib/delivery/main-agent.prompt.js';

const cand: OpportunityCandidate = {
  opportunityId: 'opp-1',
  counterpartUserId: 'u-1',
  headline: 'h',
  personalizedSummary: 's',
  suggestedAction: 'a',
  narratorRemark: 'n',
  profileUrl: 'https://x/u/u-1',
  acceptUrl: 'https://x/o/opp-1/accept',
  skipUrl: 'https://x/o/opp-1/skip',
};

describe('buildMainAgentPrompt — ambient_discovery', () => {
  it('mentions today\'s ambient count and ≤3/day target when count provided', () => {
    const out = buildMainAgentPrompt({
      contentType: 'ambient_discovery',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'ambient_discovery', ambientDeliveredToday: 2, candidates: [cand] },
    });
    expect(out).toContain('2');
    expect(out).toContain('3');
  });

  it('explicitly tells the agent the digest will sweep what it skips', () => {
    const out = buildMainAgentPrompt({
      contentType: 'ambient_discovery',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'ambient_discovery', ambientDeliveredToday: 0, candidates: [cand] },
    });
    expect(out.toLowerCase()).toContain('digest');
  });

  it('mandates the confirm_opportunity_delivery call with trigger ambient', () => {
    const out = buildMainAgentPrompt({
      contentType: 'ambient_discovery',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'ambient_discovery', ambientDeliveredToday: 0, candidates: [cand] },
    });
    expect(out).toContain('confirm_opportunity_delivery');
    expect(out).toContain("'ambient'");
  });

  it('handles ambientDeliveredToday=null with a "count unknown" hint', () => {
    const out = buildMainAgentPrompt({
      contentType: 'ambient_discovery',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'ambient_discovery', ambientDeliveredToday: null, candidates: [cand] },
    });
    expect(out.toLowerCase()).toContain('unknown');
  });
});

describe('buildMainAgentPrompt — daily_digest', () => {
  it('mentions the ambient pass came earlier', () => {
    const out = buildMainAgentPrompt({
      contentType: 'daily_digest',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'daily_digest', candidates: [cand] },
    });
    expect(out.toLowerCase()).toContain('ambient');
  });

  it('mandates the confirm_opportunity_delivery call with trigger digest', () => {
    const out = buildMainAgentPrompt({
      contentType: 'daily_digest',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'daily_digest', candidates: [cand] },
    });
    expect(out).toContain('confirm_opportunity_delivery');
    expect(out).toContain("'digest'");
  });
});

describe('buildMainAgentPrompt — toolUseClause wording', () => {
  it('forbids enrichment tool calls (not all calls) when disabled', () => {
    const out = buildMainAgentPrompt({
      contentType: 'daily_digest',
      mainAgentToolUse: 'disabled',
      payload: { contentType: 'daily_digest', candidates: [cand] },
    });
    expect(out.toLowerCase()).toContain('enrichment');
    expect(out).not.toContain('Do not call any tools');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
bun test packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts
```
Expected: FAIL — payload type mismatch (no `maxToSurface`, has `ambientDeliveredToday`); instruction strings do not include new wording.

- [ ] **Step 3: Update `MainAgentPayload` type and instruction blocks**

Replace the `MainAgentPayload` type union and `perTypeInstruction` function in `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts`:

```typescript
export type MainAgentPayload =
  | {
      contentType: 'ambient_discovery';
      ambientDeliveredToday: number | null;
      candidates: OpportunityCandidate[];
    }
  | {
      contentType: 'daily_digest';
      candidates: OpportunityCandidate[];
    }
  | {
      contentType: 'test_message';
      content: string;
    };
```

Replace `perTypeInstruction`:

```typescript
function perTypeInstruction(input: MainAgentPromptInput): string {
  const payload = input.payload;
  switch (payload.contentType) {
    case 'daily_digest':
      return [
        'This is the DAILY DIGEST pass. The ambient pass already ran today and surfaced the',
        "few opportunities worth interrupting in real time; you're now sweeping up everything",
        'that was passed on. Render every candidate below as a numbered list, in your voice.',
        '',
        'For each opportunity you mention in your reply, you MUST first call the MCP tool',
        "`confirm_opportunity_delivery` with `trigger: 'digest'` and the opportunity's id.",
        "Do not call confirm for opportunities you don't mention.",
      ].join('\n');
    case 'ambient_discovery': {
      const countLine =
        payload.ambientDeliveredToday === null
          ? "Today's ambient count is unknown — lean toward selective."
          : `You have already sent ${payload.ambientDeliveredToday} ambient message(s) today (target ≤ 3).`;
      return [
        'This is the AMBIENT pass — a real-time check, not a digest. Surface only what is worth',
        'interrupting the user *right now*. Anything you skip will appear in tonight\'s daily digest,',
        'so be selective; this is the critical filter.',
        '',
        countLine,
        '',
        'For each opportunity you mention in your reply, you MUST first call the MCP tool',
        "`confirm_opportunity_delivery` with `trigger: 'ambient'` and the opportunity's id.",
        "Do not call confirm for opportunities you don't mention. If none qualify, send a",
        "one-line note saying so — don't omit the message.",
      ].join('\n');
    }
    case 'test_message':
      return 'Delivery verification. Render the content below in your voice.';
  }
}
```

Replace `toolUseClause`:

```typescript
function toolUseClause(mode: MainAgentToolUse): string {
  if (mode === 'enabled') {
    return 'You may call Index Network MCP tools to enrich. Stay brief — the user is waiting.';
  }
  return 'Do not call enrichment tools. The only tool you may invoke is `confirm_opportunity_delivery` (mandatory — see below).';
}
```

- [ ] **Step 4: Update poller call sites to match new payload shape**

In `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts`, replace the prompt-build block (around line 106):

```typescript
const prompt = buildMainAgentPrompt({
  contentType: 'ambient_discovery',
  mainAgentToolUse,
  payload: { contentType: 'ambient_discovery', ambientDeliveredToday: null, candidates },
});
```

(Stats fetch arrives in Task 6; for now `ambientDeliveredToday: null` so the type checks.)

In `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts`, replace lines 91-98:

```typescript
const dateStr = new Date().toISOString().slice(0, 10);
const batchHash = hashOpportunityBatch(candidates.map((c) => c.opportunityId));
const mainAgentToolUse = readMainAgentToolUse(api);

const prompt = buildMainAgentPrompt({
  contentType: 'daily_digest',
  mainAgentToolUse,
  payload: { contentType: 'daily_digest', candidates },
});
```

- [ ] **Step 5: Run prompt tests**

```bash
bun test packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts
```
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts \
        packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts \
        packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts \
        packages/openclaw-plugin/src/tests/main-agent.prompt.spec.ts
git commit -m "feat(openclaw-plugin): rewrite ambient/digest prompts for agent-driven confirm"
```

---

## Task 6: Plugin — ambient poller stats fetch + drop confirm-batch

**Context:** Add the stats fetch (`GET /delivery-stats`) before dispatch, embed today's ambient count in the prompt payload, drop the `confirmDeliveredBatch` call, advance the dedup hash on dispatch success (instead of confirm success).

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts`
- Modify: `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts`

- [ ] **Step 1: Write failing tests**

Open `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts`. Update `mockBackend` to handle the new `/delivery-stats` URL and expose its calls; replace the function:

```typescript
function mockBackend(
  opportunities: unknown[],
  hookStatus = 200,
  statsBody: { ambient: number; digest: number } | { error: string } = { ambient: 0, digest: 0 },
  statsStatus = 200,
): FetchSink {
  const sink: FetchSink = {
    pendingUrls: [],
    hookCalls: [],
    confirmCalls: [],
    statsUrls: [],
  };
  global.fetch = mock(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/opportunities/delivery-stats')) {
      sink.statsUrls.push(url);
      return new Response(JSON.stringify(statsBody), { status: statsStatus });
    }
    if (url.includes('/opportunities/pending')) {
      sink.pendingUrls.push(url);
      return new Response(JSON.stringify({ opportunities }), { status: 200 });
    }
    if (url.includes('/hooks/agent')) {
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      const headers = init?.headers as Record<string, string> | undefined;
      sink.hookCalls.push({ url, headers, body });
      return new Response(JSON.stringify({ status: 'sent' }), { status: hookStatus });
    }
    if (url.includes('/confirm-batch')) {
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      sink.confirmCalls.push({ url, body });
      return new Response(JSON.stringify({ confirmed: 1, alreadyDelivered: 0 }), { status: 200 });
    }
    return new Response('not-found', { status: 404 });
  }) as unknown as typeof fetch;
  return sink;
}
```

Update the `FetchSink` interface:

```typescript
interface FetchSink {
  pendingUrls: string[];
  hookCalls: Array<{ url: string; headers?: Record<string, string>; body?: unknown }>;
  confirmCalls: Array<{ url: string; body?: unknown }>;
  statsUrls: string[];
}
```

Add new tests inside the `describe('handleAmbientDiscovery (hooks-only path)', …)` block:

```typescript
const opp = (id: string) => ({
  opportunityId: id,
  counterpartUserId: 'cp-1',
  rendered: { headline: 'h', personalizedSummary: 's', suggestedAction: 'a', narratorRemark: 'n' },
});

it('fetches /delivery-stats with a since=midnight cutoff before dispatch', async () => {
  const sink = mockBackend([opp(OPP_1)], 200, { ambient: 1, digest: 0 });
  await handleAmbientDiscovery(mockApi, cfg);
  expect(sink.statsUrls).toHaveLength(1);
  expect(sink.statsUrls[0]).toContain('since=');
  // Sanity: since param is parseable as a date
  const u = new URL(sink.statsUrls[0]);
  const since = u.searchParams.get('since');
  expect(since).not.toBeNull();
  expect(Number.isNaN(new Date(since!).getTime())).toBe(false);
});

it('embeds ambientDeliveredToday from /delivery-stats into the dispatch payload', async () => {
  const sink = mockBackend([opp(OPP_1)], 200, { ambient: 2, digest: 5 });
  await handleAmbientDiscovery(mockApi, cfg);
  expect(sink.hookCalls).toHaveLength(1);
  const body = sink.hookCalls[0].body as { message: string };
  expect(body.message).toContain('ambientDeliveredToday');
  expect(body.message).toContain('"ambientDeliveredToday": 2');
});

it('falls back to ambientDeliveredToday=null when /delivery-stats fails', async () => {
  const sink = mockBackend([opp(OPP_1)], 200, { error: 'boom' }, 500);
  const result = await handleAmbientDiscovery(mockApi, cfg);
  expect(result).toBe('dispatched');
  const body = sink.hookCalls[0].body as { message: string };
  expect(body.message).toContain('"ambientDeliveredToday": null');
});

it('does NOT call /confirm-batch after successful dispatch', async () => {
  const sink = mockBackend([opp(OPP_1)], 200, { ambient: 0, digest: 0 });
  await handleAmbientDiscovery(mockApi, cfg);
  expect(sink.hookCalls).toHaveLength(1);
  expect(sink.confirmCalls).toHaveLength(0);
});

it('advances dedup hash on dispatch success (re-poll with same batch returns "empty")', async () => {
  const sink = mockBackend([opp(OPP_1)], 200, { ambient: 0, digest: 0 });
  const first = await handleAmbientDiscovery(mockApi, cfg);
  expect(first).toBe('dispatched');
  const second = await handleAmbientDiscovery(mockApi, cfg);
  expect(second).toBe('empty');
  expect(sink.hookCalls).toHaveLength(1);
});
```

Existing tests in this file may reference `/confirm-batch` assertions that no longer apply — remove those individual `expect` lines (do not delete the surrounding test) so the rest of the assertions still verify what they tested before.

- [ ] **Step 2: Run, verify fail**

```bash
bun test packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts
```
Expected: FAIL — stats fetch not implemented; payload still has `ambientDeliveredToday: null` hardcoded; `confirmDeliveredBatch` still called.

- [ ] **Step 3: Implement stats fetch + drop confirm in ambient poller**

Replace `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts` body (keep the file header comment block + types):

```typescript
import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt } from '../../lib/delivery/main-agent.prompt.js';
import { readMainAgentToolUse } from '../../lib/delivery/config.js';
import { hashOpportunityBatch } from '../../lib/utils/hash.js';

export interface AmbientDiscoveryConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  frontendUrl: string;
}

const PENDING_LIMIT = 10;

let lastOpportunityBatchHash: string | null = null;

export type AmbientDiscoveryOutcome = 'dispatched' | 'empty' | 'error';

/**
 * Compute start-of-today in the user's local timezone, expressed as a UTC ISO string.
 */
function midnightLocalIso(now: Date = new Date()): string {
  const local = new Date(now);
  local.setHours(0, 0, 0, 0);
  return local.toISOString();
}

/**
 * Fetch today's ambient delivery count. Best-effort: returns null on any failure
 * (the prompt will then tell the agent the count is unknown).
 */
async function fetchAmbientDeliveredToday(
  api: OpenClawPluginApi,
  config: AmbientDiscoveryConfig,
): Promise<number | null> {
  const since = encodeURIComponent(midnightLocalIso());
  const url = `${config.baseUrl}/api/agents/${config.agentId}/opportunities/delivery-stats?since=${since}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': config.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      api.logger.warn(`Ambient stats fetch failed: ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { ambient?: number };
    return typeof body.ambient === 'number' ? body.ambient : null;
  } catch (err) {
    api.logger.warn(
      `Ambient stats fetch errored: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export async function handle(
  api: OpenClawPluginApi,
  config: AmbientDiscoveryConfig,
): Promise<AmbientDiscoveryOutcome> {
  const pendingUrl = `${config.baseUrl}/api/agents/${config.agentId}/opportunities/pending?limit=${PENDING_LIMIT}`;

  let res: Response;
  try {
    res = await fetch(pendingUrl, {
      method: 'GET',
      headers: { 'x-api-key': config.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    api.logger.warn(`Ambient discovery fetch errored: ${err instanceof Error ? err.message : String(err)}`);
    return 'error';
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    api.logger.warn(`Ambient discovery fetch failed: ${res.status} ${text}`);
    return 'error';
  }

  const body = (await res.json()) as {
    opportunities: Array<{
      opportunityId: string;
      counterpartUserId: string | null;
      rendered: { headline: string; personalizedSummary: string; suggestedAction: string; narratorRemark: string };
    }>;
  };

  if (!body.opportunities.length) {
    api.logger.info('Ambient discovery: no pending opportunities');
    return 'empty';
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

  if (!candidates.length) return 'empty';

  const dateStr = new Date().toISOString().slice(0, 10);
  const batchHash = hashOpportunityBatch(candidates.map((c) => c.opportunityId));

  if (batchHash === lastOpportunityBatchHash) {
    api.logger.info('Opportunity batch unchanged since last poll — skipping main-agent dispatch.');
    return 'empty';
  }

  const ambientDeliveredToday = await fetchAmbientDeliveredToday(api, config);
  const mainAgentToolUse = readMainAgentToolUse(api);

  const prompt = buildMainAgentPrompt({
    contentType: 'ambient_discovery',
    mainAgentToolUse,
    payload: { contentType: 'ambient_discovery', ambientDeliveredToday, candidates },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}`,
  });

  if (!dispatch.delivered) {
    return 'error';
  }

  lastOpportunityBatchHash = batchHash;

  api.logger.info(
    `Ambient discovery dispatched: ${candidates.length} candidate(s); agent will confirm individually`,
    { agentId: config.agentId, ambientDeliveredToday },
  );

  return 'dispatched';
}

export function _resetForTesting(): void {
  lastOpportunityBatchHash = null;
}
```

- [ ] **Step 4: Run, verify pass**

```bash
bun test packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts
```
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts \
        packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts
git commit -m "feat(openclaw-plugin): ambient poller fetches stats, drops confirm-batch"
```

---

## Task 7: Plugin — digest poller drops confirm-batch and `digestMaxCount`

**Context:** Mirror Task 6 for the digest poller (without the stats fetch, since digest has no cap). Drop `digestMaxCount` config + `maxCount` poller arg + `maxCount` from `DailyDigestConfig`.

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts`
- Modify: `packages/openclaw-plugin/src/index.ts:220-232`
- Modify: `packages/openclaw-plugin/src/tests/daily-digest.test.ts`

- [ ] **Step 1: Write failing tests**

Open `packages/openclaw-plugin/src/tests/daily-digest.test.ts`. Locate any test that asserts `/confirm-batch` was called for the digest path; replace those assertions with negative assertions (`expect(sink.confirmCalls).toHaveLength(0)`). Add this test (or amend the appropriate existing test):

```typescript
it('does NOT call /confirm-batch after successful dispatch', async () => {
  // existing setup that mocks pending + hook fetches
  // ...
  expect(sink.confirmCalls).toHaveLength(0);
});
```

If `daily-digest.test.ts` does not exist (or is the only digest spec), add the assertion to whichever file currently exercises the digest poller (search: `grep -rn "daily-digest.poller" packages/openclaw-plugin/src/tests`).

- [ ] **Step 2: Run, verify fail**

```bash
bun test packages/openclaw-plugin/src/tests/daily-digest.test.ts
```
Expected: FAIL — `confirmDeliveredBatch` still called.

- [ ] **Step 3: Update digest poller**

Replace `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts`:

```typescript
import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt } from '../../lib/delivery/main-agent.prompt.js';
import { readMainAgentToolUse } from '../../lib/delivery/config.js';
import { hashOpportunityBatch } from '../../lib/utils/hash.js';

export interface DailyDigestConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  frontendUrl: string;
}

const PENDING_LIMIT = 20;

/**
 * Daily digest cycle. Fetches everything still pending (i.e. everything the
 * ambient pass passed on), dispatches the prompt, and returns. The agent
 * confirms each opportunity it surfaces via `confirm_opportunity_delivery`
 * (trigger='digest'); the plugin does not call any confirm endpoint.
 *
 * @returns true on successful dispatch, false on empty or error.
 */
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
  const mainAgentToolUse = readMainAgentToolUse(api);

  const prompt = buildMainAgentPrompt({
    contentType: 'daily_digest',
    mainAgentToolUse,
    payload: { contentType: 'daily_digest', candidates },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:daily-digest:${config.agentId}:${dateStr}:${batchHash}`,
  });

  if (!dispatch.delivered) {
    return false;
  }

  api.logger.info(
    `Daily digest dispatched: ${candidates.length} candidate(s); agent will confirm individually`,
    { agentId: config.agentId },
  );

  return true;
}
```

- [ ] **Step 4: Drop `digestMaxCount` from `index.ts`**

In `packages/openclaw-plugin/src/index.ts`, replace lines 220-232 (the `// Schedule daily digest` block):

```typescript
// Schedule daily digest
const digestEnabled = readConfig(api, 'digestEnabled') !== 'false';
if (digestEnabled) {
  const digestTime = readConfig(api, 'digestTime') || '08:00';

  dailyDigestScheduler.start({
    digestTime,
    logger: api.logger,
    onTrigger: async () => { await dailyDigestPoller.handle(api, { baseUrl, agentId, apiKey, frontendUrl }); },
  });
}
```

- [ ] **Step 5: Run, verify pass**

```bash
bun test packages/openclaw-plugin/src/tests/daily-digest.test.ts
bun test packages/openclaw-plugin
```
Expected: digest tests PASS; full plugin suite still passes.

- [ ] **Step 6: Commit**

```bash
git add packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts \
        packages/openclaw-plugin/src/index.ts \
        packages/openclaw-plugin/src/tests/daily-digest.test.ts
git commit -m "feat(openclaw-plugin): digest poller drops confirm-batch and digestMaxCount"
```

---

## Task 8: Plugin — delete `post-delivery-confirm.ts`

**Context:** No remaining importers after Tasks 6 + 7.

**Files:**
- Delete: `packages/openclaw-plugin/src/lib/delivery/post-delivery-confirm.ts`

- [ ] **Step 1: Verify no remaining imports**

```bash
grep -rn "post-delivery-confirm\|confirmDeliveredBatch" packages/openclaw-plugin/src
```
Expected: 0 matches.

- [ ] **Step 2: Delete the file**

```bash
rm packages/openclaw-plugin/src/lib/delivery/post-delivery-confirm.ts
```

- [ ] **Step 3: Run plugin tests**

```bash
bun test packages/openclaw-plugin
```
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/openclaw-plugin/src/lib/delivery/post-delivery-confirm.ts
git commit -m "chore(openclaw-plugin): remove unused post-delivery-confirm module"
```

---

## Task 9: Final integration check + version bumps

**Context:** Verify the whole chain still builds, run full backend + plugin test suites, bump versions per CLAUDE.md "Finishing a Branch" guidance.

**Files:**
- Modify: `packages/protocol/package.json` (bump version)
- Modify: `packages/openclaw-plugin/package.json` (bump version)
- Modify: `packages/openclaw-plugin/openclaw.plugin.json` (bump version — must match `package.json`)

- [ ] **Step 1: Build protocol + run all backend tests touching delivery**

```bash
cd packages/protocol && bun run build && cd ../..
bun test backend/src/services/tests/opportunity-delivery.spec.ts
bun test backend/src/controllers/tests/agent.controller.delivery-stats.spec.ts
```
Expected: All PASS.

- [ ] **Step 2: Run full plugin suite**

```bash
bun test packages/openclaw-plugin
```
Expected: All PASS.

- [ ] **Step 3: Determine new versions**

Read current versions:

```bash
node -e "console.log(require('./packages/protocol/package.json').version)"
node -e "console.log(require('./packages/openclaw-plugin/package.json').version)"
node -e "console.log(require('./packages/openclaw-plugin/openclaw.plugin.json').version)"
```

This change is a minor feature addition (new endpoint, new MCP tool argument that's required — technically breaking for protocol consumers, but the only consumer is the same monorepo, so minor bump is correct). Bump:
- `packages/protocol/package.json`: minor bump (e.g. 0.13.x → 0.14.0)
- `packages/openclaw-plugin/package.json` and `openclaw.plugin.json`: minor bump, **identical**

- [ ] **Step 4: Apply version bumps**

Edit each file's `version` field to the new value. Commands like:

```bash
# Replace 0.A.B with current, 0.X.Y with target
sed -i 's/"version": "0.A.B"/"version": "0.X.Y"/' packages/protocol/package.json
sed -i 's/"version": "0.A.B"/"version": "0.X.Y"/' packages/openclaw-plugin/package.json
sed -i 's/"version": "0.A.B"/"version": "0.X.Y"/' packages/openclaw-plugin/openclaw.plugin.json
```

- [ ] **Step 5: Verify versions match where required**

```bash
diff <(node -e "console.log(require('./packages/openclaw-plugin/package.json').version)") \
     <(node -e "console.log(require('./packages/openclaw-plugin/openclaw.plugin.json').version)")
```
Expected: empty output (versions match).

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/package.json \
        packages/openclaw-plugin/package.json \
        packages/openclaw-plugin/openclaw.plugin.json
git commit -m "chore: bump versions for agent-driven delivery confirmation"
```

- [ ] **Step 7: Final test run from root**

```bash
bun test backend/src/services/tests/opportunity-delivery.spec.ts \
         backend/src/controllers/tests/agent.controller.delivery-stats.spec.ts
bun test packages/openclaw-plugin
```
Expected: All PASS.
