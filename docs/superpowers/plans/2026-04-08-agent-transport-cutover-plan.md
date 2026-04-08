# Agent Transport Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move runtime webhook dispatch to prefer agent-registry webhook transports gated by permission plus subscribed event, while preserving current payloads, signatures, job IDs, and legacy fallback behavior.

**Architecture:** Keep the existing layering intact. `AgentDeliveryService` remains the orchestration seam, adapters own data access, and runtime wiring in `main.ts`/`protocol-init.ts` only calls the seam. The cutover happens in two stages: first require `config.events` on webhook transports, then teach the delivery seam to dispatch via authorized agent transports with legacy `webhooks` fallback.

**Tech Stack:** Bun, TypeScript, Drizzle ORM, BullMQ, LangGraph, Zod

---

## File Map

- `backend/src/services/agent.service.ts`
  Validates transport creation and update rules. Must start requiring `config.events` for webhook transports.
- `backend/src/controllers/agent.controller.ts`
  Validates incoming transport payloads. Must reject malformed webhook transport configs before they reach the service layer.
- `packages/protocol/src/agent/agent.tools.ts`
  Agent registration path. Must write `config.events` when creating webhook transports via MCP tools.
- `backend/src/adapters/agent.database.adapter.ts`
  Data-access seam. Must expose a query that can return agents/transports eligible for runtime webhook delivery.
- `backend/src/services/agent-delivery.service.ts`
  Runtime dispatch seam. Must prefer agent transports, preserve queue payloads/job IDs, and fall back to legacy webhooks only when no eligible agent transport exists.
- `backend/src/services/tests/agent-delivery.service.spec.ts`
  Primary cutover regression coverage.
- `backend/tests/agent.service.test.ts`
  Service validation coverage for webhook transport config.
- `backend/src/protocol-init.ts`
  Composition root. Must keep protocol-facing lookup behavior intact while using the new delivery seam behavior.
- `backend/src/main.ts`
  Runtime subscriptions. Should continue emitting the same payloads/job IDs through `AgentDeliveryService`.
- `docs/design/architecture-overview.md`
  Update the runtime-cutover note once implementation is done.
- `docs/specs/webhooks.md`
  Update runtime wording from “legacy source of truth” to “agent transport primary path with legacy fallback” once implementation is done.

---

### Task 1: Require Event Subscriptions On Webhook Transports

**Files:**
- Modify: `backend/tests/agent.service.test.ts`
- Modify: `backend/src/services/agent.service.ts`
- Modify: `backend/src/controllers/agent.controller.ts`
- Modify: `packages/protocol/src/agent/agent.tools.ts`

- [ ] **Step 1: Write the failing service test for missing webhook events**

Add this test to `backend/tests/agent.service.test.ts` near the existing webhook transport validation tests:

```ts
it('requires webhook transports to declare subscribed events', async () => {
  const service = new AgentService(createStore());

  await expect(
    service.addTransport('agent-1', OWNER_ID, 'webhook', {
      url: 'https://example.com/hook',
    }),
  ).rejects.toThrow('Webhook events are required');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && bun test tests/agent.service.test.ts`
Expected: FAIL with `Webhook events are required` not thrown.

- [ ] **Step 3: Write the minimal service validation**

In `backend/src/services/agent.service.ts`, extend the `channel === 'webhook'` branch in `addTransport()` to validate `config.events`:

```ts
const rawEvents = config?.events;
if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
  throw new Error('Webhook events are required');
}

const events = rawEvents
  .filter((value): value is string => typeof value === 'string')
  .map((value) => value.trim())
  .filter(Boolean);

if (events.length === 0) {
  throw new Error('Webhook events are required');
}
```

When calling `createTransport()`, persist the normalized events back into `config`:

```ts
return this.db.createTransport({
  agentId,
  channel,
  config: {
    ...config,
    url: parsedUrl.toString(),
    events,
  },
  priority,
});
```

- [ ] **Step 4: Add controller validation for webhook events**

In `backend/src/controllers/agent.controller.ts`, tighten `addTransportSchema` so webhook payloads are expected to include an event array inside `config`:

```ts
const addTransportSchema = z.object({
  channel: z.enum(['webhook', 'mcp']),
  config: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().optional(),
});
```

Keep the schema generic, but add a route-level guard just before calling the service:

```ts
if (body.channel === 'webhook') {
  const events = body.config?.events;
  if (!Array.isArray(events) || events.length === 0) {
    return jsonError('Webhook events are required', 400);
  }
}
```

- [ ] **Step 5: Update MCP agent registration to write events**

In `packages/protocol/src/agent/agent.tools.ts`, extend `register_agent` so webhook-backed agents persist event subscriptions explicitly:

```ts
querySchema: z.object({
  name: z.string().min(1).describe('Display name for the agent.'),
  description: z.string().optional().describe('What the agent does.'),
  webhook_url: z.string().optional().describe('Optional webhook URL for deliveries.'),
  webhook_secret: z.string().optional().describe('Optional webhook secret stored in transport config.'),
  webhook_events: z.array(z.string()).optional().describe('Subscribed webhook event names.'),
  permissions: z.array(z.string()).optional().describe('Optional initial permission actions to grant.'),
})
```

Persist `events` in the transport config:

```ts
config: {
  url: parsedUrl.toString(),
  events: [...new Set((query.webhook_events ?? []).map((event) => event.trim()).filter(Boolean))],
  ...(query.webhook_secret?.trim() ? { secret: query.webhook_secret.trim() } : {}),
}
```

Reject empty `webhook_events` when `webhook_url` is provided.

- [ ] **Step 6: Run focused verification**

Run:

```bash
cd backend && bun test tests/agent.service.test.ts
cd backend && npx tsc --noEmit
cd packages/protocol && bun run build
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/tests/agent.service.test.ts backend/src/services/agent.service.ts backend/src/controllers/agent.controller.ts packages/protocol/src/agent/agent.tools.ts
git commit -m "fix(agent): require webhook transport event subscriptions"
```

---

### Task 2: Add Agent-Transport Delivery Lookup In The Adapter

**Files:**
- Modify: `backend/src/adapters/agent.database.adapter.ts`
- Test: `backend/tests/agent.service.test.ts`

- [ ] **Step 1: Write the failing adapter-level behavior through the service seam**

Add this service regression test to `backend/tests/agent.service.test.ts`:

```ts
it('delegates authorized-agent lookup using scoped dual gating inputs', async () => {
  const scope = { type: 'global' as const };
  const service = new AgentService(
    createStore({
      findAuthorizedAgents: async (userId, action, receivedScope) => {
        calls.findAuthorizedAgents.push({ userId, action, scope: receivedScope });
        return [
          createAgentWithRelations({
            transports: [
              createTransportRow({
                config: { url: 'https://example.com/hook', events: ['negotiation.turn_received'] },
              }),
            ],
          }),
        ];
      },
    }),
  );

  await service.findAuthorizedAgents(OWNER_ID, 'manage:negotiations', scope);

  expect(calls.findAuthorizedAgents).toEqual([
    { userId: OWNER_ID, action: 'manage:negotiations', scope },
  ]);
});
```

This locks in the contract that the delivery seam will rely on.

- [ ] **Step 2: Run the test to verify it passes before adapter changes**

Run: `cd backend && bun test tests/agent.service.test.ts`
Expected: PASS. This confirms the service contract already exists and the adapter work can stay behind it.

- [ ] **Step 3: Add a focused adapter helper for delivery lookup**

In `backend/src/adapters/agent.database.adapter.ts`, add a helper used internally by delivery code to filter eligible transports without duplicating raw config parsing in services.

Add a helper like:

```ts
private transportSubscribesToEvent(transport: AgentTransportRow, event: string): boolean {
  if (transport.channel !== 'webhook') {
    return false;
  }

  const events = transport.config.events;
  return Array.isArray(events) && events.includes(event);
}
```

Do not change the public interface yet. Keep this helper private until the delivery seam actually needs it.

- [ ] **Step 4: Add a public adapter method only if the delivery seam needs it**

If Task 3 cannot stay simple using `findAuthorizedAgents()`, extend the adapter and protocol-facing interface with a method like:

```ts
findAuthorizedWebhookTransports(userId: string, action: string, event: string): Promise<AgentWithRelations[]>
```

Prefer not to add this unless Task 3 proves it necessary.

- [ ] **Step 5: Run focused verification**

Run:

```bash
cd backend && bun test tests/agent.service.test.ts
cd backend && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/agent.database.adapter.ts backend/tests/agent.service.test.ts
git commit -m "refactor(agent): prepare transport lookup for delivery cutover"
```

---

### Task 3: Cut Over AgentDeliveryService To Prefer Agent Transports

**Files:**
- Modify: `backend/src/services/agent-delivery.service.ts`
- Modify: `backend/src/protocol-init.ts`
- Modify: `backend/src/main.ts`
- Modify: `backend/src/services/tests/agent-delivery.service.spec.ts`

- [ ] **Step 1: Write the failing delivery-seam test for agent transport preference**

Add this test to `backend/src/services/tests/agent-delivery.service.spec.ts`:

```ts
it('prefers authorized agent webhook transports before legacy fallback', async () => {
  const addJob = mock(() => Promise.resolve(undefined));
  const service = new AgentDeliveryService(
    { findByUserAndEvent: mock(() => Promise.resolve([{ id: 'legacy-hook', url: 'https://legacy.example.com', secret: 'legacy' }])) },
    { addJob },
    () => new Date('2026-04-08T12:00:00.000Z'),
  );

  await service.enqueueDeliveries({
    userId: 'user-1',
    event: 'negotiation.turn_received',
    payload: { negotiationId: 'neg-1' },
    getJobId: (target) => `job-${target.id}`,
    authorizedAgents: [
      {
        id: 'agent-1',
        ownerId: 'user-1',
        name: 'Agent',
        description: null,
        type: 'personal',
        status: 'active',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        permissions: [],
        transports: [
          {
            id: 'transport-1',
            agentId: 'agent-1',
            channel: 'webhook',
            config: { url: 'https://agent.example.com', secret: 'agent-secret', events: ['negotiation.turn_received'] },
            priority: 1,
            active: true,
            failureCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    ],
  });

  expect(addJob).toHaveBeenCalledTimes(1);
  expect(addJob).toHaveBeenCalledWith(
    'deliver_webhook',
    expect.objectContaining({
      webhookId: 'transport-1',
      url: 'https://agent.example.com',
      secret: 'agent-secret',
      event: 'negotiation.turn_received',
    }),
    { jobId: 'job-transport-1' },
  );
});
```

- [ ] **Step 2: Write the failing fallback test**

Add a second test:

```ts
it('falls back to legacy webhooks when no eligible agent transport exists', async () => {
  const addJob = mock(() => Promise.resolve(undefined));
  const service = new AgentDeliveryService(
    { findByUserAndEvent: mock(() => Promise.resolve([{ id: 'legacy-hook', url: 'https://legacy.example.com', secret: 'legacy' }])) },
    { addJob },
    () => new Date('2026-04-08T12:00:00.000Z'),
  );

  await service.enqueueDeliveries({
    userId: 'user-1',
    event: 'negotiation.turn_received',
    payload: { negotiationId: 'neg-1' },
    getJobId: (target) => `job-${target.id}`,
    authorizedAgents: [],
  });

  expect(addJob).toHaveBeenCalledTimes(1);
  expect(addJob).toHaveBeenCalledWith(
    'deliver_webhook',
    expect.objectContaining({ webhookId: 'legacy-hook' }),
    { jobId: 'job-legacy-hook' },
  );
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && bun test src/services/tests/agent-delivery.service.spec.ts`
Expected: FAIL because `enqueueDeliveries()` and agent transport preference do not exist yet.

- [ ] **Step 4: Implement the minimal delivery cutover**

In `backend/src/services/agent-delivery.service.ts`, keep the existing legacy helper but add a new method that prefers agent transports.

Add types:

```ts
type DeliveryTransport = {
  id: string;
  agentId: string;
  channel: 'webhook' | 'mcp';
  config: Record<string, unknown>;
  active: boolean;
  priority: number;
};

type DeliveryAgent = {
  id: string;
  transports: DeliveryTransport[];
};
```

Add method:

```ts
async enqueueDeliveries({ userId, event, payload, getJobId, authorizedAgents }: {
  userId: string;
  event: string;
  payload: Record<string, unknown>;
  getJobId?: (target: { id: string }) => string;
  authorizedAgents: DeliveryAgent[];
}): Promise<void> {
  const eligibleTransports = authorizedAgents
    .flatMap((agent) => agent.transports)
    .filter((transport) => {
      if (transport.channel !== 'webhook' || !transport.active) return false;
      const events = transport.config.events;
      return Array.isArray(events) && events.includes(event);
    })
    .sort((a, b) => b.priority - a.priority);

  if (eligibleTransports.length > 0) {
    for (const transport of eligibleTransports) {
      await this.queue!.addJob(
        'deliver_webhook',
        {
          webhookId: transport.id,
          url: String(transport.config.url),
          secret: typeof transport.config.secret === 'string' ? transport.config.secret : '',
          event,
          payload,
          timestamp: this.now().toISOString(),
        },
        getJobId ? { jobId: getJobId(transport) } : undefined,
      );
    }
    return;
  }

  await this.enqueueLegacyWebhookFanout({ userId, event, payload, getJobId });
}
```

Do not remove `enqueueLegacyWebhookFanout()`.

- [ ] **Step 5: Wire main.ts through the new method without changing payloads**

In `backend/src/main.ts`, for each runtime event subscription, replace direct calls to `enqueueLegacyWebhookFanout()` with the new `enqueueDeliveries()` call and pass the existing payload and job ID logic unchanged.

Use this pattern:

```ts
const authorizedAgents = await agentService.findAuthorizedAgents(userId, 'manage:negotiations', { type: 'global' });

await agentDeliveryService.enqueueDeliveries({
  userId,
  event: 'negotiation.turn_received',
  payload: { ...existingPayload },
  getJobId: (target) => `webhook-neg-turn-${target.id}-${data.negotiationId}-${data.turnNumber}`,
  authorizedAgents,
});
```

Keep the string formats exactly as they are today.

- [ ] **Step 6: Keep protocol lookup behavior unchanged**

In `backend/src/protocol-init.ts`, keep `webhookLookup.hasWebhookForEvent()` wired through the lookup-only delivery seam. Do not add queue or transport dispatch behavior there.

- [ ] **Step 7: Run focused verification**

Run:

```bash
cd backend && bun test src/services/tests/agent-delivery.service.spec.ts tests/agent.service.test.ts tests/mcp.test.ts
cd backend && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/agent-delivery.service.ts backend/src/services/tests/agent-delivery.service.spec.ts backend/src/main.ts backend/src/protocol-init.ts
git commit -m "feat(agent): prefer registry transports for webhook delivery"
```

---

### Task 4: Update Runtime Documentation For The New Primary Path

**Files:**
- Modify: `docs/design/architecture-overview.md`
- Modify: `docs/specs/webhooks.md`

- [ ] **Step 1: Write the failing doc checklist**

Before editing, make this checklist and verify the current docs fail it:

```md
- architecture-overview says runtime delivery still reads legacy webhooks only
- webhooks spec says legacy webhooks are the runtime source of truth
- neither doc explains agent-transport primary dispatch with legacy fallback
```

- [ ] **Step 2: Update architecture overview**

Change the agent-registry/runtime note in `docs/design/architecture-overview.md` to say:

```md
Runtime webhook delivery now prefers authorized webhook transports from the agent registry. Legacy `webhooks` remain as a temporary compatibility fallback during cutover, routed through `AgentDeliveryService`.
```

- [ ] **Step 3: Update webhook spec**

In `docs/specs/webhooks.md`, change the transitional status wording so it says:

```md
legacy webhook storage and routes still exist, but runtime fanout now prefers eligible agent-registry webhook transports and falls back to legacy `webhooks` only when no eligible transport exists.
```

Also update the delivery and wiring sections to describe:

- dual gate: permission + subscribed event
- `AgentDeliveryService` as primary fanout seam
- legacy fallback retained during cutover

- [ ] **Step 4: Verify docs read cleanly**

Run:

```bash
git diff -- docs/design/architecture-overview.md docs/specs/webhooks.md
```

Expected: wording matches the implemented runtime state without claiming full cleanup.

- [ ] **Step 5: Commit**

```bash
git add docs/design/architecture-overview.md docs/specs/webhooks.md
git commit -m "docs: describe agent transport delivery cutover"
```

---

## Self-Review

### Spec coverage

- Dual-gate dispatch model: covered in Tasks 1 and 3
- Event-to-action mapping: covered in Task 3
- Transport config contract with `events`: covered in Task 1
- Legacy fallback behavior: covered in Task 3
- Architecture boundary preservation: covered in Tasks 2 and 3
- Documentation updates: covered in Task 4

No spec gaps found.

### Placeholder scan

- No `TODO` / `TBD` placeholders
- All code-changing steps include concrete code or exact code shape
- All verification steps include exact commands

### Type consistency

- `config.events` is used consistently across service, controller, tool, and delivery tasks
- Runtime seam naming uses `enqueueDeliveries()` consistently in the cutover task
- Required permission mapping remains `manage:negotiations` consistently for current emitted events
