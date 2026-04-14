# OpenClaw Opportunity Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable OpenClaw personal agents to proactively surface opportunities to users — both in real time (when an opportunity passes negotiation) and as a batched morning digest — using the user's active OpenClaw gateway (Telegram in the v1 target).

**Architecture:** Server-rendered presenter cards + per-(user, opportunity, channel, status) delivery ledger + plugin-side polling and cron. The plugin stays a thin transport that wraps `api.runtime.subagent.run({ deliver: true, ... })`; OpenClaw's runtime handles gateway routing. Issue 0 extracts the reusable `dispatchDelivery` helper and validates the delivery channel end-to-end before any opportunity-specific machinery is built.

**Tech Stack:** Bun + TypeScript (backend & plugin), Drizzle ORM + PostgreSQL (persistence), LangChain/LangGraph (presenter), `node-cron` (plugin scheduler), Vite + React Router v7 (frontend agents page), `bun test` (tests).

**Spec:** [`docs/superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md`](../specs/2026-04-15-openclaw-opportunity-delivery-design.md)

---

## Execution Order

Six issues, each a separate PR into `dev`. Each runs in its own worktree.

| Issue | Doc | Depends on |
|---|---|---|
| 0 | [`docs/issues/0-openclaw-delivery-primitive.md`](../../issues/0-openclaw-delivery-primitive.md) | — |
| 1 | [`docs/issues/1-opportunity-deliveries-ledger.md`](../../issues/1-opportunity-deliveries-ledger.md) | 0 (pattern precedent) |
| 2 | [`docs/issues/2-presenter-negotiation-context.md`](../../issues/2-presenter-negotiation-context.md) | — |
| 3 | [`docs/issues/3-home-graph-status-filter.md`](../../issues/3-home-graph-status-filter.md) | — |
| 4 | [`docs/issues/4-openclaw-pending-poller.md`](../../issues/4-openclaw-pending-poller.md) | 0, 1, 2 |
| 5 | [`docs/issues/5-morning-home-digest.md`](../../issues/5-morning-home-digest.md) | 0, 1, 2, 3 |

Issues 1, 2, 3 can be implemented in parallel after 0 lands. Issue 4 waits for 1 and 2. Issue 5 waits for 1, 2, 3.

---

## Cross-Cutting Conventions

- **Worktrees:** Each issue in its own worktree. `git worktree add .worktrees/issue-<N>-<slug> dev` then `bun run worktree:setup issue-<N>-<slug>`.
- **Branches:** `feat/issue-<N>-<slug>` (conventional branches; no Linear IDs in branch names).
- **Commits:** Conventional commits. Frequent, after each green test.
- **Tests:** `bun test <path>` — always target specific files; avoid full-suite runs.
- **Type checks:** Run `cd backend && bunx tsc --noEmit` (and analogous in `packages/protocol` and `packages/openclaw-plugin`) before claiming a task complete. `bun test` does not catch type errors.
- **Soft deletes on users:** Always filter `deletedAt IS NULL` when joining on `users`.
- **Migrations:** After `bun run db:generate`, rename the generated file to `{NNNN}_{action}_{target}.sql` and update `drizzle/meta/_journal.json`'s `tag` field to match (without `.sql`).

---

# Issue 0: OpenClaw Delivery Primitive + Test Channel

**Issue doc:** [`docs/issues/0-openclaw-delivery-primitive.md`](../../issues/0-openclaw-delivery-primitive.md)
**Spec section:** [§ Issue 0](../specs/2026-04-15-openclaw-opportunity-delivery-design.md#issue-0--openclaw-delivery-primitive--test-channel)
**Worktree:** `.worktrees/issue-0-delivery-primitive`
**Branch:** `feat/issue-0-delivery-primitive`

## Files Touched

**Create:**
- `backend/src/services/agent-test-message.service.ts`
- `backend/src/controllers/agent-test-message.controller.ts`
- `backend/tests/agent-test-message.test.ts`
- `packages/openclaw-plugin/src/delivery.dispatcher.ts`
- `packages/openclaw-plugin/src/prompts/delivery.prompt.ts`
- `packages/openclaw-plugin/tests/delivery.dispatcher.test.ts`
- `backend/drizzle/<next>_add_agent_test_messages.sql` (via `bun run db:generate` + rename)

**Modify:**
- `backend/src/schemas/database.schema.ts` — add `agentTestMessages` table
- `backend/src/main.ts` — register the new controller
- `packages/openclaw-plugin/src/index.ts` — extend poll loop
- `frontend/src/app/agents/...` — add test-message button (exact path confirmed in Task 0.7)

## Task 0.1: Add `agent_test_messages` table to schema

**Files:**
- Modify: `backend/src/schemas/database.schema.ts`

- [ ] **Step 1: Append table definition to the schema**

Open `backend/src/schemas/database.schema.ts`. Locate the section where other agent-related tables are defined (near `agents`, `agentTransports`, `agentPermissions`). Append:

```ts
export const agentTestMessages = pgTable(
  'agent_test_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    reservationToken: uuid('reservation_token'),
    reservedAt: timestamp('reserved_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byAgent: index('idx_agent_test_messages_agent_pending').on(
      t.agentId,
      t.reservedAt,
    ),
  }),
);
```

- [ ] **Step 2: Generate the migration**

```bash
cd backend && bun run db:generate
```

Expected: `drizzle/NNNN_<random_name>.sql` is created plus an updated `drizzle/meta/_journal.json`.

- [ ] **Step 3: Rename the migration per project convention**

Identify the new file (`ls backend/drizzle/ | tail -n 3` and find the latest SQL + matching snapshot). Rename the SQL to `NNNN_add_agent_test_messages.sql`. Do **not** rename the snapshot file.

Open `backend/drizzle/meta/_journal.json` and change the `tag` of the newest entry to `NNNN_add_agent_test_messages` (without `.sql`).

- [ ] **Step 4: Apply the migration**

```bash
cd backend && bun run db:migrate
```

Expected: migration applies without error; `bun run db:generate` afterward should say "No schema changes".

- [ ] **Step 5: Commit**

```bash
git add backend/src/schemas/database.schema.ts backend/drizzle/
git commit -m "feat(db): add agent_test_messages table for OpenClaw delivery primitive"
```

## Task 0.2: `AgentTestMessageService`

**Files:**
- Create: `backend/src/services/agent-test-message.service.ts`
- Create: `backend/tests/agent-test-message.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/agent-test-message.service.test.ts`:

```ts
import '../src/test-env';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { db } from '../src/lib/drizzle/drizzle';
import { agents, agentTestMessages, users } from '../src/schemas/database.schema';
import { AgentTestMessageService } from '../src/services/agent-test-message.service';

describe('AgentTestMessageService', () => {
  const service = new AgentTestMessageService();
  let userId: string;
  let agentId: string;

  beforeEach(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `test-${randomUUID()}@example.com` })
      .returning();
    userId = user.id;
    const [agent] = await db
      .insert(agents)
      .values({ ownerUserId: userId, name: 'test-agent', kind: 'personal' })
      .returning();
    agentId = agent.id;
  });

  afterAll(async () => {
    await db.delete(agentTestMessages);
  });

  test('enqueue stores content for the agent', async () => {
    const { id } = await service.enqueue(agentId, userId, 'hello');
    expect(id).toBeTruthy();
  });

  test('pickup returns nothing when none queued', async () => {
    const result = await service.pickup(agentId);
    expect(result).toBeNull();
  });

  test('pickup returns enqueued message + reservation token', async () => {
    await service.enqueue(agentId, userId, 'hello');
    const result = await service.pickup(agentId);
    expect(result?.content).toBe('hello');
    expect(result?.reservationToken).toBeTruthy();
  });

  test('pickup after confirm excludes already-delivered message', async () => {
    const { id } = await service.enqueue(agentId, userId, 'hello');
    const picked = await service.pickup(agentId);
    await service.confirmDelivered(id, picked!.reservationToken);
    const next = await service.pickup(agentId);
    expect(next).toBeNull();
  });

  test('reservation expires after TTL', async () => {
    await service.enqueue(agentId, userId, 'hello');
    await service.pickup(agentId);
    // Manually backdate reservation beyond TTL
    await db.execute(
      `UPDATE agent_test_messages SET reserved_at = now() - interval '2 minutes'`,
    );
    const next = await service.pickup(agentId);
    expect(next?.content).toBe('hello');
  });

  test('confirmDelivered with wrong token throws', async () => {
    const { id } = await service.enqueue(agentId, userId, 'hello');
    await service.pickup(agentId);
    await expect(
      service.confirmDelivered(id, randomUUID()),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && bun test tests/agent-test-message.service.test.ts
```

Expected: FAIL — `AgentTestMessageService` not found.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/agent-test-message.service.ts`:

```ts
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db } from '../lib/drizzle/drizzle';
import { agentTestMessages } from '../schemas/database.schema';

const RESERVATION_TTL_SECONDS = 60;

export interface PickupResult {
  id: string;
  content: string;
  reservationToken: string;
  reservationExpiresAt: Date;
}

export class AgentTestMessageService {
  async enqueue(
    agentId: string,
    requestedByUserId: string,
    content: string,
  ): Promise<{ id: string }> {
    const [row] = await db
      .insert(agentTestMessages)
      .values({ agentId, requestedByUserId, content })
      .returning({ id: agentTestMessages.id });
    return { id: row.id };
  }

  async pickup(agentId: string): Promise<PickupResult | null> {
    const reservationToken = randomUUID();
    const reservedAt = new Date();
    const ttlCutoff = new Date(
      Date.now() - RESERVATION_TTL_SECONDS * 1000,
    );

    const rows = await db
      .update(agentTestMessages)
      .set({ reservationToken, reservedAt })
      .where(
        and(
          eq(agentTestMessages.agentId, agentId),
          isNull(agentTestMessages.deliveredAt),
          or(
            isNull(agentTestMessages.reservedAt),
            lt(agentTestMessages.reservedAt, ttlCutoff),
          ),
          sql`${agentTestMessages.id} = (
            SELECT id FROM ${agentTestMessages}
            WHERE agent_id = ${agentId}
              AND delivered_at IS NULL
              AND (reserved_at IS NULL OR reserved_at < ${ttlCutoff.toISOString()})
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )`,
        ),
      )
      .returning();

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      content: row.content,
      reservationToken,
      reservationExpiresAt: new Date(
        reservedAt.getTime() + RESERVATION_TTL_SECONDS * 1000,
      ),
    };
  }

  async confirmDelivered(
    id: string,
    reservationToken: string,
  ): Promise<void> {
    const rows = await db
      .update(agentTestMessages)
      .set({ deliveredAt: new Date() })
      .where(
        and(
          eq(agentTestMessages.id, id),
          eq(agentTestMessages.reservationToken, reservationToken),
          isNull(agentTestMessages.deliveredAt),
        ),
      )
      .returning({ id: agentTestMessages.id });
    if (rows.length === 0) {
      throw new Error('invalid_reservation_token_or_already_delivered');
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && bun test tests/agent-test-message.service.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Type-check and commit**

```bash
cd backend && bunx tsc --noEmit
git add backend/src/services/agent-test-message.service.ts backend/tests/agent-test-message.service.test.ts
git commit -m "feat(backend): add AgentTestMessageService for OpenClaw delivery primitive"
```

## Task 0.3: `AgentTestMessageController`

**Files:**
- Create: `backend/src/controllers/agent-test-message.controller.ts`
- Modify: `backend/src/main.ts`
- Create: `backend/tests/agent-test-message.controller.test.ts`

- [ ] **Step 1: Check the pattern by reading an existing controller**

Open `backend/src/controllers/agents.controller.ts` (or another existing controller) to confirm:
- Decorator imports and syntax (`@Controller`, `@Get`, `@Post`)
- Auth guards used for session-authed vs API-key-authed routes
- Response return shape

- [ ] **Step 2: Write the failing controller test**

Create `backend/tests/agent-test-message.controller.test.ts`. Follow the pattern of an existing controller test (e.g. `backend/tests/agents.test.ts` or similar). The test must cover:

```ts
// Skeleton — fill per existing test harness patterns
describe('AgentTestMessageController', () => {
  test('POST /agents/:id/test-messages requires session auth + agent ownership', async () => { /* ... */ });
  test('POST /agents/:id/test-messages inserts a row and returns 201', async () => { /* ... */ });
  test('POST /agents/:id/test-messages/pickup returns 204 when empty', async () => { /* ... */ });
  test('POST /agents/:id/test-messages/pickup returns queued message (api-key auth)', async () => { /* ... */ });
  test('POST /agents/:id/test-messages/:id/delivered commits delivery', async () => { /* ... */ });
  test('POST .../delivered with wrong token returns 404', async () => { /* ... */ });
});
```

The exact test scaffolding (request helper, API-key fixture, session fixture) must match whatever other controller tests in `backend/tests/` use.

- [ ] **Step 3: Verify the test fails**

```bash
cd backend && bun test tests/agent-test-message.controller.test.ts
```

Expected: FAIL — controller/routes do not exist.

- [ ] **Step 4: Implement the controller**

Create `backend/src/controllers/agent-test-message.controller.ts`:

```ts
import { Body, Controller, Param, Post } from '../lib/routing/decorators';
import { SessionAuth, ApiKeyAgentAuth } from '../guards';
import { AgentTestMessageService } from '../services/agent-test-message.service';

@Controller('/agents/:agentId')
export class AgentTestMessageController {
  private readonly service = new AgentTestMessageService();

  @Post('/test-messages')
  @SessionAuth({ agentOwnership: true })
  async enqueue(
    @Param('agentId') agentId: string,
    @Body() body: { content: string },
    session: { userId: string },
  ) {
    const { id } = await this.service.enqueue(
      agentId,
      session.userId,
      body.content,
    );
    return { id };
  }

  @Post('/test-messages/pickup')
  @ApiKeyAgentAuth()
  async pickup(@Param('agentId') agentId: string) {
    const result = await this.service.pickup(agentId);
    if (!result) return { status: 204 };
    return result;
  }

  @Post('/test-messages/:messageId/delivered')
  @ApiKeyAgentAuth()
  async delivered(
    @Param('messageId') messageId: string,
    @Body() body: { reservationToken: string },
  ) {
    await this.service.confirmDelivered(messageId, body.reservationToken);
    return { ok: true };
  }
}
```

Exact decorator names and guard names must match the project's existing patterns — confirm by opening `backend/src/controllers/agents.controller.ts` and `backend/src/guards/` before writing. If `ApiKeyAgentAuth` doesn't yet exist, reuse whatever the existing `/agents/:id/negotiations/pickup` route uses.

- [ ] **Step 5: Register the controller in `main.ts`**

Open `backend/src/main.ts`. Locate the section where controllers are registered via `RouteRegistry` (search for existing controller imports). Add:

```ts
import { AgentTestMessageController } from './controllers/agent-test-message.controller';
// ...
RouteRegistry.register(AgentTestMessageController);
```

- [ ] **Step 6: Run tests**

```bash
cd backend && bun test tests/agent-test-message.controller.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Type-check and commit**

```bash
cd backend && bunx tsc --noEmit
git add backend/src/controllers/agent-test-message.controller.ts backend/src/main.ts backend/tests/agent-test-message.controller.test.ts
git commit -m "feat(backend): add AgentTestMessageController with session + api-key routes"
```

## Task 0.4: Plugin `dispatchDelivery` helper + delivery prompt

**Files:**
- Create: `packages/openclaw-plugin/src/prompts/delivery.prompt.ts`
- Create: `packages/openclaw-plugin/src/delivery.dispatcher.ts`
- Create: `packages/openclaw-plugin/tests/delivery.dispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/openclaw-plugin/tests/delivery.dispatcher.test.ts`:

```ts
import { describe, expect, mock, test } from 'bun:test';

import { dispatchDelivery } from '../src/delivery.dispatcher';
import type { OpenClawPluginApi } from '../src/plugin-api';

function makeApi(): OpenClawPluginApi {
  return {
    id: 'test',
    name: 'test',
    pluginConfig: {},
    runtime: {
      subagent: {
        run: mock(async () => ({ runId: 'run-1' })),
      },
    },
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    registerHttpRoute: () => {},
  } as unknown as OpenClawPluginApi;
}

describe('dispatchDelivery', () => {
  test('calls subagent.run with deliver: true', async () => {
    const api = makeApi();
    await dispatchDelivery(api, {
      rendered: { headline: 'hi', body: 'hello world' },
      sessionKey: 'index:delivery:test:1',
      idempotencyKey: 'index:delivery:test:1:token',
    });
    const run = api.runtime.subagent.run as ReturnType<typeof mock>;
    expect(run).toHaveBeenCalledTimes(1);
    const call = run.mock.calls[0][0];
    expect(call.deliver).toBe(true);
    expect(call.sessionKey).toBe('index:delivery:test:1');
    expect(call.idempotencyKey).toBe('index:delivery:test:1:token');
    expect(call.message).toContain('hello world');
  });

  test('includes headline and body in the prompt', async () => {
    const api = makeApi();
    await dispatchDelivery(api, {
      rendered: { headline: 'HEADLINE', body: 'BODY' },
      sessionKey: 's',
      idempotencyKey: 'i',
    });
    const run = api.runtime.subagent.run as ReturnType<typeof mock>;
    const call = run.mock.calls[0][0];
    expect(call.message).toContain('HEADLINE');
    expect(call.message).toContain('BODY');
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
cd packages/openclaw-plugin && bun test tests/delivery.dispatcher.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the delivery prompt**

Create `packages/openclaw-plugin/src/prompts/delivery.prompt.ts`:

```ts
export function deliveryPrompt(rendered: {
  headline: string;
  body: string;
}): string {
  return [
    'You are delivering a message to the user via their active OpenClaw gateway.',
    'The content below was prepared by Index Network. Relay it faithfully — preserve substance, format for the gateway (concise, chat-friendly).',
    'Do not summarize, rewrite, or add your own commentary. Do not ask the user for input.',
    '',
    `# ${rendered.headline}`,
    '',
    rendered.body,
  ].join('\n');
}
```

- [ ] **Step 4: Implement the dispatcher**

Create `packages/openclaw-plugin/src/delivery.dispatcher.ts`:

```ts
import type {
  OpenClawPluginApi,
  SubagentRunResult,
} from './plugin-api';
import { deliveryPrompt } from './prompts/delivery.prompt';

export interface DeliveryRequest {
  rendered: { headline: string; body: string };
  sessionKey: string;
  idempotencyKey: string;
}

export async function dispatchDelivery(
  api: OpenClawPluginApi,
  request: DeliveryRequest,
): Promise<SubagentRunResult> {
  return api.runtime.subagent.run({
    sessionKey: request.sessionKey,
    idempotencyKey: request.idempotencyKey,
    message: deliveryPrompt(request.rendered),
    deliver: true,
  });
}
```

- [ ] **Step 5: Run tests**

```bash
cd packages/openclaw-plugin && bun test tests/delivery.dispatcher.test.ts
```

Expected: both tests pass.

- [ ] **Step 6: Type-check and commit**

```bash
cd packages/openclaw-plugin && bunx tsc --noEmit
git add packages/openclaw-plugin/src/delivery.dispatcher.ts packages/openclaw-plugin/src/prompts/delivery.prompt.ts packages/openclaw-plugin/tests/delivery.dispatcher.test.ts
git commit -m "feat(openclaw): add dispatchDelivery helper + delivery prompt"
```

## Task 0.5: Extend plugin poll loop with test-message pickup

**Files:**
- Modify: `packages/openclaw-plugin/src/index.ts`

- [ ] **Step 1: Read the existing poll loop**

Open `packages/openclaw-plugin/src/index.ts`. Locate the `poll()` function (or equivalent) that currently calls `POST /api/agents/:agentId/negotiations/pickup`. Note:
- How `baseUrl`, `agentId`, `apiKey` are read.
- How HTTP calls are made (fetch wrapper).
- How backoff state is maintained.

- [ ] **Step 2: Factor out a pickup helper if not already factored**

If the existing code inlines the negotiation pickup, refactor it into a helper like `pickupAndHandle(endpoint: string, handler: (payload: T) => Promise<void>)` before adding the second endpoint. Keep the refactor commit separate if you prefer.

- [ ] **Step 3: Add the test-message pickup call**

In the poll cycle, after the negotiation pickup completes, add:

```ts
async function handleTestMessage(
  api: OpenClawPluginApi,
  baseUrl: string,
  agentId: string,
  apiKey: string,
): Promise<boolean> {
  const res = await fetch(
    `${baseUrl}/api/agents/${agentId}/test-messages/pickup`,
    {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
    },
  );
  if (res.status === 204) return false;
  if (!res.ok) {
    api.logger.warn('test-message pickup failed', { status: res.status });
    return false;
  }
  const body = (await res.json()) as {
    id: string;
    content: string;
    reservationToken: string;
  };
  await dispatchDelivery(api, {
    rendered: { headline: 'Test message', body: body.content },
    sessionKey: `index:delivery:test:${body.id}`,
    idempotencyKey: `index:delivery:test:${body.id}:${body.reservationToken}`,
  });
  const confirm = await fetch(
    `${baseUrl}/api/agents/${agentId}/test-messages/${body.id}/delivered`,
    {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reservationToken: body.reservationToken }),
    },
  );
  if (!confirm.ok) {
    api.logger.warn('test-message confirm failed', { status: confirm.status });
  }
  return true;
}
```

Wire this call into the poll cycle **after** the negotiation pickup. Return values feed into the existing backoff heuristic (if negotiations or test-messages did work, reset backoff; if both returned nothing, consider idle).

Import the dispatcher:

```ts
import { dispatchDelivery } from './delivery.dispatcher';
```

- [ ] **Step 4: Manual verification**

Add a temporary row via psql or a quick curl, run the plugin locally (`cd packages/openclaw-plugin && bun run build && ...` per the plugin's usual run flow), and verify the subagent dispatches. This is a manual smoke check; the automated integration test lands in Task 0.7.

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/index.ts
git commit -m "feat(openclaw): extend poll loop with test-message pickup"
```

## Task 0.6: Frontend "Send test message" button

**Files:**
- Modify: the existing agents detail page (path to confirm by inspection)
- Create: a small dialog component if no existing pattern matches

- [ ] **Step 1: Locate the agents page**

```bash
rg -l 'agent' frontend/src/app | head -20
```

Inspect the returned files to find the route file that renders a single agent's detail view. Record the exact path before editing.

- [ ] **Step 2: Confirm the existing API client pattern**

Open `frontend/src/services/` (or wherever typed fetch wrappers live) and find an existing agent-related client. Match its style when adding the new method.

- [ ] **Step 3: Add the API client method**

In the appropriate service file (likely `frontend/src/services/agents.service.ts` or similar), add:

```ts
export async function sendAgentTestMessage(
  agentId: string,
  content: string,
): Promise<{ id: string }> {
  const res = await fetch(`/api/agents/${agentId}/test-messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`failed_${res.status}`);
  return res.json();
}
```

- [ ] **Step 4: Add the button UI**

In the agent detail page, near the section that shows agent metadata (or near existing action buttons), add a button + confirmation dialog. Use the project's existing Radix UI primitives and Tailwind classes. Skeleton:

```tsx
const [dialogOpen, setDialogOpen] = useState(false);
const [content, setContent] = useState(
  'Hello from Index Network — this is a test delivery.',
);
const [sending, setSending] = useState(false);

async function handleSend() {
  setSending(true);
  try {
    await sendAgentTestMessage(agent.id, content);
    toast.success('Sent — should arrive in your OpenClaw gateway within ~30s');
    setDialogOpen(false);
  } catch (err) {
    toast.error('Failed to send test message');
  } finally {
    setSending(false);
  }
}

// ... inside JSX ...
<Button onClick={() => setDialogOpen(true)}>Send test message</Button>
<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
  {/* textarea for content; Send + Cancel buttons */}
</Dialog>
```

Only render the button when the agent has an OpenClaw transport configured — check the existing agent object for the relevant transport flag.

- [ ] **Step 5: Smoke test in dev**

```bash
cd frontend && bun run dev
```

Navigate to the agent page, click the button, confirm:
- POST to `/api/agents/<id>/test-messages` succeeds (network tab).
- Toast appears.
- If the plugin is also running, the test message arrives in the gateway within ~30s.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): add test-message button to agent detail page"
```

## Task 0.7: End-to-end integration test

**Files:**
- Create: `backend/tests/e2e.agent-test-message.test.ts` (or the project's standard e2e location)

- [ ] **Step 1: Write the end-to-end test**

The test simulates the plugin flow against a real backend (no actual plugin process). It:

1. Creates user + agent + api key.
2. Calls `enqueue` via HTTP (session auth).
3. Polls `pickup` via HTTP (api-key auth) — expects the row.
4. Calls `delivered` via HTTP with the reservation token.
5. Polls `pickup` again — expects `204`.

Follow the existing e2e scaffolding in `backend/tests/e2e.test.ts`:

```ts
test('agent test message: enqueue → pickup → confirm → empty', async () => {
  const { userId, agentId, apiKey, sessionCookie } = await setupAgentUser();

  const enqueueRes = await fetch(`${baseUrl}/api/agents/${agentId}/test-messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ content: 'ping' }),
  });
  expect(enqueueRes.status).toBe(201);
  const { id: messageId } = await enqueueRes.json();

  const pickupRes = await fetch(`${baseUrl}/api/agents/${agentId}/test-messages/pickup`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
  });
  expect(pickupRes.status).toBe(200);
  const pickup = await pickupRes.json();
  expect(pickup.content).toBe('ping');

  const confirmRes = await fetch(
    `${baseUrl}/api/agents/${agentId}/test-messages/${messageId}/delivered`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ reservationToken: pickup.reservationToken }),
    },
  );
  expect(confirmRes.status).toBe(200);

  const empty = await fetch(`${baseUrl}/api/agents/${agentId}/test-messages/pickup`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
  });
  expect(empty.status).toBe(204);
});
```

Match the exact `setupAgentUser` / `baseUrl` conventions of existing e2e tests.

- [ ] **Step 2: Run the test**

```bash
cd backend && bun test tests/e2e.agent-test-message.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/e2e.agent-test-message.test.ts
git commit -m "test(e2e): cover agent test-message delivery end-to-end"
```

## Task 0.8: PR for Issue 0

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat/issue-0-delivery-primitive
gh pr create --base dev --title "feat(openclaw): delivery primitive + test channel (Issue 0)" --body "$(cat <<'EOF'
## Summary
- Adds `agent_test_messages` table and reservation-based pickup/confirm endpoints.
- Extracts reusable `dispatchDelivery` helper in the OpenClaw plugin; adds delivery prompt.
- Extends plugin poll loop to pick up and deliver test messages.
- Adds "Send test message" button on the agents detail page.

## Test plan
- [ ] `bun test backend/tests/agent-test-message.service.test.ts`
- [ ] `bun test backend/tests/agent-test-message.controller.test.ts`
- [ ] `bun test packages/openclaw-plugin/tests/delivery.dispatcher.test.ts`
- [ ] `bun test backend/tests/e2e.agent-test-message.test.ts`
- [ ] Manual: click the button in dev, confirm a message reaches the connected OpenClaw gateway within ~30s.

## Issue
Closes the validation step from [Issue 0 doc](docs/issues/0-openclaw-delivery-primitive.md).
EOF
)"
```

---

# Issue 1: `opportunity_deliveries` Ledger + Pending-Pickup Endpoints

**Issue doc:** [`docs/issues/1-opportunity-deliveries-ledger.md`](../../issues/1-opportunity-deliveries-ledger.md)
**Spec section:** [§ Issue 1](../specs/2026-04-15-openclaw-opportunity-delivery-design.md#issue-1--opportunity_deliveries-ledger--pending-pickup-endpoints)
**Worktree:** `.worktrees/issue-1-deliveries-ledger`
**Branch:** `feat/issue-1-deliveries-ledger`

## Files Touched

**Create:**
- `backend/src/services/opportunity-delivery.service.ts`
- `backend/src/controllers/opportunity-delivery.controller.ts`
- `backend/tests/opportunity-delivery.service.test.ts`
- `backend/tests/opportunity-delivery.controller.test.ts`
- `backend/drizzle/<next>_add_opportunity_deliveries.sql`

**Modify:**
- `backend/src/schemas/database.schema.ts`
- `backend/src/main.ts`

## Task 1.1: Add `opportunity_deliveries` table

**Files:**
- Modify: `backend/src/schemas/database.schema.ts`

- [ ] **Step 1: Add the table definition**

Append to the schema file (near opportunity-related tables):

```ts
export const opportunityDeliveries = pgTable(
  'opportunity_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    channel: text('channel').notNull(),
    trigger: text('trigger').notNull(),
    deliveredAtStatus: text('delivered_at_status').notNull(),
    reservationToken: uuid('reservation_token'),
    reservedAt: timestamp('reserved_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueCommitted: uniqueIndex('uniq_opp_deliveries_committed')
      .on(t.userId, t.opportunityId, t.channel, t.deliveredAtStatus)
      .where(sql`${t.deliveredAt} IS NOT NULL`),
    reservationLookup: index('idx_opp_deliveries_open_reservations')
      .on(t.userId, t.channel, t.reservedAt)
      .where(sql`${t.deliveredAt} IS NULL`),
  }),
);
```

- [ ] **Step 2: Generate + rename + apply migration**

```bash
cd backend && bun run db:generate
```

Rename the new SQL file to `NNNN_add_opportunity_deliveries.sql` and update `drizzle/meta/_journal.json`'s tag.

```bash
cd backend && bun run db:migrate
cd backend && bun run db:generate   # should say: no schema changes
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/schemas/database.schema.ts backend/drizzle/
git commit -m "feat(db): add opportunity_deliveries ledger table"
```

## Task 1.2: `OpportunityDeliveryService`

**Files:**
- Create: `backend/src/services/opportunity-delivery.service.ts`
- Create: `backend/tests/opportunity-delivery.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/opportunity-delivery.service.test.ts`:

```ts
import '../src/test-env';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { db } from '../src/lib/drizzle/drizzle';
import {
  agents,
  opportunities,
  opportunityDeliveries,
  users,
} from '../src/schemas/database.schema';
import { OpportunityDeliveryService } from '../src/services/opportunity-delivery.service';

async function seedPendingOpportunity(userId: string): Promise<string> {
  // Insert a minimal opportunity in `pending` status with actors including userId.
  // Match whatever existing test helpers seed opportunities (see backend/tests/helpers/).
  // Returns the opportunityId.
}

describe('OpportunityDeliveryService', () => {
  const service = new OpportunityDeliveryService();
  let userId: string;
  let agentId: string;

  beforeEach(async () => {
    const [u] = await db.insert(users).values({ email: `t-${randomUUID()}@e.com` }).returning();
    userId = u.id;
    const [a] = await db
      .insert(agents)
      .values({ ownerUserId: userId, name: 'a', kind: 'personal' })
      .returning();
    agentId = a.id;
  });

  afterAll(async () => {
    await db.delete(opportunityDeliveries);
    await db.delete(opportunities);
  });

  test('pickupPending returns null when no pending opportunities', async () => {
    const result = await service.pickupPending(agentId);
    expect(result).toBeNull();
  });

  test('pickupPending returns opportunity + reservation token', async () => {
    await seedPendingOpportunity(userId);
    const result = await service.pickupPending(agentId);
    expect(result?.opportunityId).toBeTruthy();
    expect(result?.reservationToken).toBeTruthy();
  });

  test('two concurrent pickups return different rows or one null', async () => {
    await seedPendingOpportunity(userId);
    const [a, b] = await Promise.all([
      service.pickupPending(agentId),
      service.pickupPending(agentId),
    ]);
    const gotOne = [a, b].filter(Boolean).length;
    expect(gotOne).toBe(1); // only one opp, only one pickup wins
  });

  test('confirmDelivered commits and dedupes subsequent pickups', async () => {
    await seedPendingOpportunity(userId);
    const pickup = await service.pickupPending(agentId);
    await service.confirmDelivered(
      pickup!.opportunityId,
      userId,
      pickup!.reservationToken,
    );
    const next = await service.pickupPending(agentId);
    expect(next).toBeNull();
  });

  test('expired reservation is re-pickable', async () => {
    await seedPendingOpportunity(userId);
    await service.pickupPending(agentId);
    await db.execute(
      `UPDATE opportunity_deliveries SET reserved_at = now() - interval '2 minutes' WHERE delivered_at IS NULL`,
    );
    const next = await service.pickupPending(agentId);
    expect(next).not.toBeNull();
  });

  test('confirm with wrong reservation token throws', async () => {
    await seedPendingOpportunity(userId);
    const pickup = await service.pickupPending(agentId);
    await expect(
      service.confirmDelivered(pickup!.opportunityId, userId, randomUUID()),
    ).rejects.toThrow();
  });
});
```

Fill in `seedPendingOpportunity` using existing test helpers — inspect `backend/tests/helpers/` or existing tests that seed opportunities.

- [ ] **Step 2: Verify test fails**

```bash
cd backend && bun test tests/opportunity-delivery.service.test.ts
```

Expected: FAIL — service not found.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/opportunity-delivery.service.ts`:

```ts
import { and, eq, isNull, not, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db } from '../lib/drizzle/drizzle';
import {
  agents,
  opportunities,
  opportunityDeliveries,
} from '../schemas/database.schema';
import { OpportunityPresenter } from '@indexnetwork/protocol';

const RESERVATION_TTL_SECONDS = 60;
const CHANNEL = 'openclaw';
const TRIGGER_PENDING = 'pending_pickup';

export interface PickupPendingResult {
  opportunityId: string;
  reservationToken: string;
  reservationExpiresAt: Date;
  rendered: {
    headline: string;
    personalizedSummary: string;
    suggestedAction: string;
    narratorRemark: string;
  };
}

export class OpportunityDeliveryService {
  constructor(private readonly presenter = new OpportunityPresenter()) {}

  async pickupPending(agentId: string): Promise<PickupPendingResult | null> {
    const agent = await this.resolveAgentOwner(agentId);
    const userId = agent.ownerUserId;
    const reservationToken = randomUUID();
    const reservedAt = new Date();
    const ttlCutoff = new Date(Date.now() - RESERVATION_TTL_SECONDS * 1000);

    // Find next eligible pending opportunity for the user.
    // Eligibility: visible to user, status = 'pending', no committed delivery for
    // (user, opp, channel, status='pending'), no active reservation for the same key.
    const eligible = await db.execute<{ opportunity_id: string }>(sql`
      SELECT o.id AS opportunity_id
      FROM opportunities o
      WHERE o.status = 'pending'
        AND opportunity_visible_to_user(o.id, ${userId})   -- existing SQL function or inline predicate
        AND NOT EXISTS (
          SELECT 1 FROM opportunity_deliveries d
          WHERE d.opportunity_id = o.id
            AND d.user_id = ${userId}
            AND d.channel = ${CHANNEL}
            AND d.delivered_at_status = 'pending'
            AND (d.delivered_at IS NOT NULL
              OR (d.reserved_at IS NOT NULL AND d.reserved_at >= ${ttlCutoff.toISOString()}))
        )
      ORDER BY o.updated_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    const opportunityId = eligible.rows[0]?.opportunity_id;
    if (!opportunityId) return null;

    // Insert reservation row (transactional with the select above ideally).
    await db.insert(opportunityDeliveries).values({
      opportunityId,
      userId,
      agentId,
      channel: CHANNEL,
      trigger: TRIGGER_PENDING,
      deliveredAtStatus: 'pending',
      reservationToken,
      reservedAt,
    });

    // Render the presenter card.
    const rendered = await this.renderOpportunityCard(opportunityId, userId);

    return {
      opportunityId,
      reservationToken,
      reservationExpiresAt: new Date(reservedAt.getTime() + RESERVATION_TTL_SECONDS * 1000),
      rendered,
    };
  }

  async confirmDelivered(
    opportunityId: string,
    userId: string,
    reservationToken: string,
  ): Promise<void> {
    const rows = await db
      .update(opportunityDeliveries)
      .set({ deliveredAt: new Date() })
      .where(
        and(
          eq(opportunityDeliveries.opportunityId, opportunityId),
          eq(opportunityDeliveries.userId, userId),
          eq(opportunityDeliveries.reservationToken, reservationToken),
          isNull(opportunityDeliveries.deliveredAt),
        ),
      )
      .returning({ id: opportunityDeliveries.id });
    if (rows.length === 0) {
      throw new Error('invalid_reservation_token_or_already_delivered');
    }
  }

  private async resolveAgentOwner(agentId: string) {
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId));
    if (!agent) throw new Error('agent_not_found');
    return agent;
  }

  private async renderOpportunityCard(
    opportunityId: string,
    userId: string,
  ) {
    // Calls the presenter. Exact wiring depends on how gatherPresenterContext
    // is currently exposed. If it's only called from feed.graph, this
    // service will need to reuse that helper or replicate its logic.
    // Minimum: return an object shaped like { headline, personalizedSummary, suggestedAction, narratorRemark }.
    // Details filled per existing presenter integration patterns.
    throw new Error('stub — wire presenter in implementation');
  }
}
```

**Note:** the `renderOpportunityCard` method is the integration point with Issue 2. If Issue 2 has already landed, wire to the enriched presenter. If not, call the presenter with `negotiationContext: undefined` and accept the leaner card. Either way, the return shape stays the same.

For the `opportunity_visible_to_user` predicate — inline the visibility logic from `canUserSeeOpportunity()` in SQL, or join through actors. See how existing `getOpportunitiesForUser` expresses visibility and follow the same approach.

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test tests/opportunity-delivery.service.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Type-check and commit**

```bash
cd backend && bunx tsc --noEmit
git add backend/src/services/opportunity-delivery.service.ts backend/tests/opportunity-delivery.service.test.ts
git commit -m "feat(backend): add OpportunityDeliveryService with reservation/confirm pattern"
```

## Task 1.3: `OpportunityDeliveryController`

**Files:**
- Create: `backend/src/controllers/opportunity-delivery.controller.ts`
- Create: `backend/tests/opportunity-delivery.controller.test.ts`
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Write the failing controller test**

Create `backend/tests/opportunity-delivery.controller.test.ts` following the same pattern as the Issue-0 controller test. Cover:

```ts
describe('OpportunityDeliveryController', () => {
  test('POST /agents/:id/opportunities/pickup returns 204 when empty', ...);
  test('POST /agents/:id/opportunities/pickup returns rendered payload when available', ...);
  test('POST /agents/:id/opportunities/:oid/delivered commits', ...);
  test('POST .../delivered with wrong token returns 404', ...);
  test('auth: missing api key returns 401', ...);
});
```

- [ ] **Step 2: Verify it fails**

```bash
cd backend && bun test tests/opportunity-delivery.controller.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the controller**

Create `backend/src/controllers/opportunity-delivery.controller.ts`:

```ts
import { Body, Controller, Param, Post } from '../lib/routing/decorators';
import { ApiKeyAgentAuth } from '../guards';
import { OpportunityDeliveryService } from '../services/opportunity-delivery.service';

@Controller('/agents/:agentId/opportunities')
export class OpportunityDeliveryController {
  private readonly service = new OpportunityDeliveryService();

  @Post('/pickup')
  @ApiKeyAgentAuth()
  async pickup(@Param('agentId') agentId: string) {
    const result = await this.service.pickupPending(agentId);
    if (!result) return { status: 204 };
    return result;
  }

  @Post('/:opportunityId/delivered')
  @ApiKeyAgentAuth()
  async delivered(
    @Param('agentId') agentId: string,
    @Param('opportunityId') opportunityId: string,
    @Body() body: { reservationToken: string },
    context: { userId: string },
  ) {
    await this.service.confirmDelivered(
      opportunityId,
      context.userId,
      body.reservationToken,
    );
    return { ok: true };
  }
}
```

Decorator/guard names must match the project — consult Task 0.3 notes.

- [ ] **Step 4: Register in main.ts**

```ts
import { OpportunityDeliveryController } from './controllers/opportunity-delivery.controller';
RouteRegistry.register(OpportunityDeliveryController);
```

- [ ] **Step 5: Run tests**

```bash
cd backend && bun test tests/opportunity-delivery.controller.test.ts
```

Expected: PASS.

- [ ] **Step 6: Type-check and commit**

```bash
cd backend && bunx tsc --noEmit
git add backend/src/controllers/opportunity-delivery.controller.ts backend/src/main.ts backend/tests/opportunity-delivery.controller.test.ts
git commit -m "feat(backend): add OpportunityDeliveryController pickup + confirm routes"
```

## Task 1.4: PR for Issue 1

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat/issue-1-deliveries-ledger
gh pr create --base dev --title "feat(backend): opportunity_deliveries ledger + pending-pickup endpoints (Issue 1)" --body "$(cat <<'EOF'
## Summary
- Adds `opportunity_deliveries` ledger with reservation + committed delivery tracking.
- `OpportunityDeliveryService` exposes `pickupPending` and `confirmDelivered`.
- `OpportunityDeliveryController` exposes the two endpoints with api-key + agent-id auth.

## Test plan
- [ ] `bun test backend/tests/opportunity-delivery.service.test.ts`
- [ ] `bun test backend/tests/opportunity-delivery.controller.test.ts`
- [ ] Concurrent pickup smoke test (two curls in parallel against a seeded pending opp, only one wins).

## Issue
Closes [Issue 1 doc](docs/issues/1-opportunity-deliveries-ledger.md).
EOF
)"
```

---

# Issue 2: Negotiation Context in Opportunity Presenter

**Issue doc:** [`docs/issues/2-presenter-negotiation-context.md`](../../issues/2-presenter-negotiation-context.md)
**Spec section:** [§ Issue 2](../specs/2026-04-15-openclaw-opportunity-delivery-design.md#issue-2--negotiation-context-in-opportunity-presenter)
**Worktree:** `.worktrees/issue-2-presenter-negotiation`
**Branch:** `feat/issue-2-presenter-negotiation`

## Files Touched

**Create:**
- `packages/protocol/src/opportunity/negotiation-context.loader.ts`
- `packages/protocol/tests/negotiation-context.loader.test.ts`
- `packages/protocol/tests/opportunity-presenter.snapshot.test.ts`

**Modify:**
- `packages/protocol/src/opportunity/opportunity.presenter.ts`
- `packages/protocol/src/opportunity/feed/feed.graph.ts`

## Task 2.1: `loadNegotiationContext` loader

**Files:**
- Create: `packages/protocol/src/opportunity/negotiation-context.loader.ts`
- Create: `packages/protocol/tests/negotiation-context.loader.test.ts`

- [ ] **Step 1: Define the type**

In `packages/protocol/src/opportunity/negotiation-context.loader.ts`:

```ts
import type { NegotiationDatabase } from '../shared/interfaces/database.interface';

export interface NegotiationContextTurn {
  turnNumber: number;
  actorUserId: string;
  action: 'propose' | 'accept' | 'reject' | 'counter' | 'question';
  reasoning: string;
  message: string | null;
  suggestedRoles?: { source: string; candidate: string };
}

export interface NegotiationContext {
  status: 'pending' | 'stalled' | 'accepted' | 'rejected' | 'negotiating';
  turnCount: number;
  turnCap: number;
  outcome?: {
    hasOpportunity: boolean;
    agreedRoles: Array<{ userId: string; role: string }>;
    reasoning: string;
    reason?: 'turn_cap' | 'timeout';
  };
  turns: NegotiationContextTurn[];
}

export async function loadNegotiationContext(
  db: NegotiationDatabase,
  opportunityId: string,
): Promise<NegotiationContext | null> {
  // Implementation in step 3.
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/protocol/tests/negotiation-context.loader.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { loadNegotiationContext } from '../src/opportunity/negotiation-context.loader';
import { makeFakeNegotiationDb } from './helpers/fake-negotiation-db';

describe('loadNegotiationContext', () => {
  test('returns null for opportunities in draft status', async () => {
    const db = makeFakeNegotiationDb({ opportunityStatus: 'draft' });
    const result = await loadNegotiationContext(db, 'opp-1');
    expect(result).toBeNull();
  });

  test('returns null for opportunities in latent status', async () => {
    const db = makeFakeNegotiationDb({ opportunityStatus: 'latent' });
    const result = await loadNegotiationContext(db, 'opp-1');
    expect(result).toBeNull();
  });

  test('returns context with transcript for pending', async () => {
    const db = makeFakeNegotiationDb({
      opportunityStatus: 'pending',
      turns: [
        { turnNumber: 1, action: 'propose', reasoning: 'r1', message: null, actorUserId: 'u1' },
        { turnNumber: 2, action: 'accept', reasoning: 'r2', message: null, actorUserId: 'u2' },
      ],
      outcome: { hasOpportunity: true, agreedRoles: [], reasoning: 'done', turnCount: 2 },
    });
    const result = await loadNegotiationContext(db, 'opp-1');
    expect(result?.status).toBe('pending');
    expect(result?.turns.length).toBe(2);
    expect(result?.outcome?.reasoning).toBe('done');
  });

  test('returns context without transcript for negotiating (chip-only mode)', async () => {
    const db = makeFakeNegotiationDb({
      opportunityStatus: 'negotiating',
      turns: [
        { turnNumber: 1, action: 'propose', reasoning: 'r1', message: null, actorUserId: 'u1' },
      ],
      turnCap: 12,
    });
    const result = await loadNegotiationContext(db, 'opp-1');
    expect(result?.status).toBe('negotiating');
    expect(result?.turnCount).toBe(1);
    expect(result?.turnCap).toBe(12);
    expect(result?.turns).toEqual([]);
    expect(result?.outcome).toBeUndefined();
  });

  test('returns context with outcome.reason for stalled', async () => {
    const db = makeFakeNegotiationDb({
      opportunityStatus: 'stalled',
      turns: [
        /* 12 turns */
      ],
      outcome: { hasOpportunity: false, agreedRoles: [], reasoning: 'capped', turnCount: 12, reason: 'turn_cap' },
    });
    const result = await loadNegotiationContext(db, 'opp-1');
    expect(result?.outcome?.reason).toBe('turn_cap');
  });
});
```

Create the `makeFakeNegotiationDb` helper in `packages/protocol/tests/helpers/fake-negotiation-db.ts`. Shape it to match the fields `NegotiationDatabase` exposes for `getNegotiationByOpportunityId` (or equivalent lookup) — read the interface file to confirm.

- [ ] **Step 3: Verify it fails**

```bash
cd packages/protocol && bun test tests/negotiation-context.loader.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement the loader**

Replace the stub in `packages/protocol/src/opportunity/negotiation-context.loader.ts`:

```ts
export async function loadNegotiationContext(
  db: NegotiationDatabase,
  opportunityId: string,
): Promise<NegotiationContext | null> {
  const opp = await db.getOpportunity(opportunityId);
  if (!opp) return null;
  if (opp.status === 'draft' || opp.status === 'latent') return null;

  const negotiation = await db.getNegotiationByOpportunityId(opportunityId);
  if (!negotiation) return null;

  const turnsRaw = await db.listNegotiationTurns(negotiation.taskId);
  const turnCap = negotiation.turnCap ?? 12;

  if (opp.status === 'negotiating') {
    return {
      status: 'negotiating',
      turnCount: turnsRaw.length,
      turnCap,
      turns: [],
    };
  }

  return {
    status: opp.status as NegotiationContext['status'],
    turnCount: turnsRaw.length,
    turnCap,
    outcome: negotiation.outcome
      ? {
          hasOpportunity: negotiation.outcome.hasOpportunity,
          agreedRoles: negotiation.outcome.agreedRoles,
          reasoning: negotiation.outcome.reasoning,
          reason: negotiation.outcome.reason,
        }
      : undefined,
    turns: turnsRaw.map((t) => ({
      turnNumber: t.turnNumber,
      actorUserId: t.actorUserId,
      action: t.action,
      reasoning: t.assessment?.reasoning ?? '',
      message: t.message ?? null,
      suggestedRoles: t.assessment?.suggestedRoles,
    })),
  };
}
```

Exact method names (`getOpportunity`, `getNegotiationByOpportunityId`, `listNegotiationTurns`) may differ — consult `packages/protocol/src/shared/interfaces/database.interface.ts` and match. If the interface lacks a method, add it and its adapter implementation in `backend/src/adapters/database.adapter.ts`.

- [ ] **Step 5: Run tests**

```bash
cd packages/protocol && bun test tests/negotiation-context.loader.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Type-check and commit**

```bash
cd packages/protocol && bunx tsc --noEmit
cd ../../backend && bunx tsc --noEmit
git add packages/protocol/src/opportunity/negotiation-context.loader.ts packages/protocol/tests/
git commit -m "feat(protocol): add loadNegotiationContext for presenter enrichment"
```

## Task 2.2: Wire loader into `gatherPresenterContext`

**Files:**
- Modify: `packages/protocol/src/opportunity/feed/feed.graph.ts`
- Modify: `packages/protocol/src/opportunity/opportunity.presenter.ts`

- [ ] **Step 1: Add `negotiationContext` to presenter input**

In `opportunity.presenter.ts`, find `HomeCardPresenterInput` and add:

```ts
import type { NegotiationContext } from './negotiation-context.loader';

export interface HomeCardPresenterInput extends PresenterInput {
  mutualIntentCount?: number;
  negotiationContext?: NegotiationContext;
}
```

- [ ] **Step 2: Call the loader in `gatherPresenterContext`**

In `feed.graph.ts`, find `gatherPresenterContext`. Add:

```ts
import { loadNegotiationContext } from '../negotiation-context.loader';

// inside gatherPresenterContext(...)
const negotiationContext =
  ['pending', 'stalled', 'accepted', 'rejected', 'negotiating'].includes(
    opportunity.status,
  )
    ? await loadNegotiationContext(db, opportunity.id)
    : undefined;

// return { ...existingContext, negotiationContext };
```

- [ ] **Step 3: Type-check**

```bash
cd packages/protocol && bunx tsc --noEmit
cd ../../backend && bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.presenter.ts packages/protocol/src/opportunity/feed/feed.graph.ts
git commit -m "feat(protocol): wire negotiation context into presenter input"
```

## Task 2.3: Update presenter prompt (Branch A + Branch B)

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.presenter.ts` (or wherever the prompt template is assembled)

- [ ] **Step 1: Locate prompt assembly**

Search for the current prompt template:

```bash
rg -n 'personalizedSummary' packages/protocol/src/opportunity/
```

Identify where the prompt string is built. The rest of this task edits that file.

- [ ] **Step 2: Add Branch A (negotiating) handling**

Before the LLM call, check for `negotiationContext?.status === 'negotiating'`. Synthesize the narrator chip without LLM:

```ts
let narratorRemarkOverride: string | undefined;
if (input.negotiationContext?.status === 'negotiating') {
  const { turnCount, turnCap } = input.negotiationContext;
  narratorRemarkOverride = `Currently negotiating · turn ${turnCount} of ${turnCap}`;
}
```

After the LLM call, substitute `narratorRemarkOverride` into the returned card's `narratorRemark` if set:

```ts
return {
  ...llmOutput,
  narratorRemark: narratorRemarkOverride ?? llmOutput.narratorRemark,
};
```

- [ ] **Step 3: Add Branch B (post-negotiation) transcript injection**

Build a transcript block when `negotiationContext` exists and status is not `negotiating`:

```ts
function buildNegotiationSection(ctx: NegotiationContext | undefined): string {
  if (!ctx || ctx.status === 'negotiating') return '';
  const reasonLine =
    ctx.status === 'stalled' && ctx.outcome?.reason
      ? `\nThe negotiation was **stalled** because of \`${ctx.outcome.reason}\`.`
      : '';
  const outcomeLine = ctx.outcome
    ? `\n\nOutcome reasoning: ${ctx.outcome.reasoning}\nAgreed roles: ${JSON.stringify(ctx.outcome.agreedRoles)}`
    : '';
  const transcript = ctx.turns
    .map(
      (t) =>
        `  Turn ${t.turnNumber} — ${t.actorUserId} [${t.action}]\n    Reasoning: ${t.reasoning}${t.message ? `\n    Message: ${t.message}` : ''}`,
    )
    .join('\n');
  return [
    '',
    `## Negotiation (${ctx.status}, ${ctx.turnCount} turns)${reasonLine}`,
    '',
    'This opportunity went through an agent-to-agent negotiation. Below is the complete transcript.',
    'Use it to ground your personalizedSummary and suggestedAction in why this match surfaced and what the agents agreed on.',
    'The user has not seen the transcript — explain it in their voice.',
    '',
    transcript,
    outcomeLine,
  ].join('\n');
}
```

Include `buildNegotiationSection(input.negotiationContext)` in the prompt string.

- [ ] **Step 4: Type-check**

```bash
cd packages/protocol && bunx tsc --noEmit
cd ../../backend && bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.presenter.ts
git commit -m "feat(protocol): inject negotiation context into presenter prompt (Branches A + B)"
```

## Task 2.4: Snapshot tests for prompt assembly

**Files:**
- Create: `packages/protocol/tests/opportunity-presenter.snapshot.test.ts`

- [ ] **Step 1: Write snapshot tests**

Create `packages/protocol/tests/opportunity-presenter.snapshot.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { buildOpportunityPrompt } from '../src/opportunity/opportunity.presenter'; // export a pure prompt builder
import type { NegotiationContext } from '../src/opportunity/negotiation-context.loader';

const baseInput = {
  opportunity: { id: 'opp-1', status: 'pending' },
  actors: [],
  userProfiles: [],
  intents: [],
  networkContext: {},
} as any;

function ctx(status: NegotiationContext['status'], overrides: Partial<NegotiationContext> = {}): NegotiationContext {
  return {
    status,
    turnCount: 3,
    turnCap: 12,
    outcome:
      status === 'negotiating'
        ? undefined
        : { hasOpportunity: status !== 'rejected', agreedRoles: [], reasoning: 'r' },
    turns:
      status === 'negotiating'
        ? []
        : [
            { turnNumber: 1, actorUserId: 'u1', action: 'propose', reasoning: 'p', message: null },
            { turnNumber: 2, actorUserId: 'u2', action: 'counter', reasoning: 'c', message: null },
            { turnNumber: 3, actorUserId: 'u1', action: 'accept', reasoning: 'a', message: null },
          ],
    ...overrides,
  };
}

describe('presenter prompt snapshots', () => {
  test('pending includes transcript', () => {
    const prompt = buildOpportunityPrompt({ ...baseInput, negotiationContext: ctx('pending') });
    expect(prompt).toContain('Turn 1');
    expect(prompt).toContain('Turn 3');
    expect(prompt).toContain('Negotiation (pending');
  });

  test('stalled includes reason', () => {
    const prompt = buildOpportunityPrompt({
      ...baseInput,
      negotiationContext: ctx('stalled', { outcome: { hasOpportunity: false, agreedRoles: [], reasoning: 'r', reason: 'turn_cap' } }),
    });
    expect(prompt).toContain('turn_cap');
  });

  test('accepted includes transcript', () => {
    const prompt = buildOpportunityPrompt({ ...baseInput, negotiationContext: ctx('accepted') });
    expect(prompt).toContain('Negotiation (accepted');
  });

  test('rejected includes transcript', () => {
    const prompt = buildOpportunityPrompt({ ...baseInput, negotiationContext: ctx('rejected') });
    expect(prompt).toContain('Negotiation (rejected');
  });

  test('negotiating omits transcript', () => {
    const prompt = buildOpportunityPrompt({ ...baseInput, negotiationContext: ctx('negotiating') });
    expect(prompt).not.toContain('Turn 1');
    expect(prompt).not.toContain('Negotiation (');
  });
});
```

This requires exporting a pure `buildOpportunityPrompt(input)` function from `opportunity.presenter.ts` — if not currently exported, factor it out in a small refactor within this task. The LLM call remains encapsulated elsewhere.

- [ ] **Step 2: Run tests**

```bash
cd packages/protocol && bun test tests/opportunity-presenter.snapshot.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 3: Type-check and commit**

```bash
cd packages/protocol && bunx tsc --noEmit
git add packages/protocol/
git commit -m "test(protocol): snapshot prompt assembly across 5 presenter branches"
```

## Task 2.5: PR for Issue 2

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat/issue-2-presenter-negotiation
gh pr create --base dev --title "feat(protocol): negotiation context in opportunity presenter (Issue 2)" --body "$(cat <<'EOF'
## Summary
- `loadNegotiationContext` loader returns full transcript + outcome for post-negotiation statuses; chip-only data for negotiating; null for draft/latent.
- Presenter input gains optional `negotiationContext`; `gatherPresenterContext` loads it when relevant.
- Prompt assembly injects transcript for post-negotiation, stalled reason when applicable, and templated narrator chip (no LLM call) for negotiating.

## Test plan
- [ ] `bun test packages/protocol/tests/negotiation-context.loader.test.ts`
- [ ] `bun test packages/protocol/tests/opportunity-presenter.snapshot.test.ts`
- [ ] Manual: open an opportunity in each status in the chat UI and confirm the card text reflects the branch.

## Issue
Closes [Issue 2 doc](docs/issues/2-presenter-negotiation-context.md).
EOF
)"
```

---

# Issue 3: Home Graph Default Status Filter

**Issue doc:** [`docs/issues/3-home-graph-status-filter.md`](../../issues/3-home-graph-status-filter.md)
**Spec section:** [§ Issue 3](../specs/2026-04-15-openclaw-opportunity-delivery-design.md#issue-3--home-graph-default-status-filter)
**Worktree:** `.worktrees/issue-3-home-graph-filter`
**Branch:** `feat/issue-3-home-graph-filter`

## Files Touched

**Modify:**
- `packages/protocol/src/opportunity/feed/feed.graph.ts`
- `packages/protocol/src/shared/interfaces/database.interface.ts` (add `statuses` to `getOpportunitiesForUser`)
- `backend/src/adapters/database.adapter.ts` (push filter into SQL)

**Create:**
- `packages/protocol/tests/feed-graph.status-filter.test.ts`

## Task 3.1: Add `statuses` to input + exported constants

**Files:**
- Modify: `packages/protocol/src/opportunity/feed/feed.graph.ts`

- [ ] **Step 1: Add constants and extend input**

In `feed.graph.ts` (top of file near existing exports):

```ts
import type { OpportunityStatus } from '../../shared/interfaces/database.interface';

export const DEFAULT_HOME_STATUSES: OpportunityStatus[] = [
  'latent',
  'stalled',
  'pending',
];

export const ALL_OPPORTUNITY_STATUSES: OpportunityStatus[] = [
  'latent',
  'draft',
  'negotiating',
  'pending',
  'stalled',
  'accepted',
  'rejected',
  'expired',
];

export interface HomeGraphInvokeInput {
  userId: string;
  networkId?: string;
  limit?: number;
  noCache?: boolean;
  statuses?: OpportunityStatus[];
}
```

- [ ] **Step 2: Type-check**

```bash
cd packages/protocol && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/feed/feed.graph.ts
git commit -m "feat(protocol): add statuses parameter + DEFAULT_HOME_STATUSES to home graph input"
```

## Task 3.2: Push `statuses` filter into the database call

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts`
- Modify: `backend/src/adapters/database.adapter.ts`

- [ ] **Step 1: Extend the interface**

In `database.interface.ts`, find `OpportunityDatabase.getOpportunitiesForUser`. Extend the options shape:

```ts
getOpportunitiesForUser(
  userId: string,
  options: {
    limit?: number;
    networkId?: string;
    conversationId?: string;
    statuses?: OpportunityStatus[];
  },
): Promise<Opportunity[]>;
```

- [ ] **Step 2: Push the filter into the adapter**

In `backend/src/adapters/database.adapter.ts`, find the `getOpportunitiesForUser` implementation. Add the status clause:

```ts
const statusClause = options.statuses?.length
  ? sql`AND o.status = ANY(${options.statuses})`
  : sql``;
```

Insert `${statusClause}` in the existing WHERE assembly. Confirm the existing query builder allows this composition — if it's using Drizzle's query builder, use `inArray(opportunities.status, options.statuses)` within an `and(...)` instead of raw SQL.

- [ ] **Step 3: Type-check**

```bash
cd backend && bunx tsc --noEmit
cd ../packages/protocol && bunx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/shared/interfaces/database.interface.ts backend/src/adapters/database.adapter.ts
git commit -m "feat(backend): push status filter into getOpportunitiesForUser SQL"
```

## Task 3.3: Apply filter in feed graph

**Files:**
- Modify: `packages/protocol/src/opportunity/feed/feed.graph.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/tests/feed-graph.status-filter.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { DEFAULT_HOME_STATUSES, ALL_OPPORTUNITY_STATUSES } from '../src/opportunity/feed/feed.graph';
import { HomeGraphFactory } from '../src/opportunity/feed/feed.graph';

describe('home graph status filter', () => {
  test('default filter includes only latent, stalled, pending', () => {
    expect(DEFAULT_HOME_STATUSES).toEqual(['latent', 'stalled', 'pending']);
  });

  test('ALL includes accepted and rejected', () => {
    expect(ALL_OPPORTUNITY_STATUSES).toContain('accepted');
    expect(ALL_OPPORTUNITY_STATUSES).toContain('rejected');
  });

  test('factory passes statuses through to getOpportunitiesForUser', async () => {
    let capturedStatuses: string[] | undefined;
    const fakeDb = {
      getOpportunitiesForUser: (userId: string, opts: { statuses?: string[] }) => {
        capturedStatuses = opts.statuses;
        return Promise.resolve([]);
      },
      // other methods as stubs
    } as any;
    const factory = new HomeGraphFactory({ db: fakeDb } as any);
    await factory.invoke({ userId: 'u1' });
    expect(capturedStatuses).toEqual(DEFAULT_HOME_STATUSES);
  });

  test('explicit statuses override default', async () => {
    let capturedStatuses: string[] | undefined;
    const fakeDb = {
      getOpportunitiesForUser: (_: string, opts: { statuses?: string[] }) => {
        capturedStatuses = opts.statuses;
        return Promise.resolve([]);
      },
    } as any;
    const factory = new HomeGraphFactory({ db: fakeDb } as any);
    await factory.invoke({ userId: 'u1', statuses: ALL_OPPORTUNITY_STATUSES });
    expect(capturedStatuses).toEqual(ALL_OPPORTUNITY_STATUSES);
  });
});
```

The `HomeGraphFactory` mocks may need more dependencies stubbed — fill per the factory's constructor signature.

- [ ] **Step 2: Verify it fails**

```bash
cd packages/protocol && bun test tests/feed-graph.status-filter.test.ts
```

Expected: FAIL — statuses not passed through.

- [ ] **Step 3: Wire the filter in feed graph**

In `feed.graph.ts`, find the node that fetches opportunities. Pass through statuses:

```ts
const statuses = state.statuses ?? DEFAULT_HOME_STATUSES;
const raw = await db.getOpportunitiesForUser(state.userId, {
  limit: fetchLimit,
  networkId: state.networkId,
  statuses,
});
```

Also update the state machine's input-to-state mapping to carry `statuses`.

- [ ] **Step 4: Run tests**

```bash
cd packages/protocol && bun test tests/feed-graph.status-filter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Type-check and commit**

```bash
cd packages/protocol && bunx tsc --noEmit
cd ../../backend && bunx tsc --noEmit
git add packages/protocol/
git commit -m "feat(protocol): apply DEFAULT_HOME_STATUSES filter in home graph"
```

## Task 3.4: Regression check for home feed UX

- [ ] **Step 1: Manual UX verification**

Run dev:

```bash
cd frontend && bun run dev
```

Sign in as a seeded user with mixed-status opportunities. Confirm:
- `accepted` and `rejected` opportunities no longer appear in the home feed.
- `latent`, `stalled`, `pending` do appear.
- `negotiating` is correctly excluded (not in default; optional: toggle explicitly to verify).

- [ ] **Step 2: If a regression test helper exists, add an assertion**

Search for existing home-feed integration tests:

```bash
rg -l 'home.*feed|HomeGraph' backend/tests packages/protocol/tests
```

If found, add an assertion that the returned set contains no `accepted`/`rejected` opportunities by default.

## Task 3.5: PR for Issue 3

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat/issue-3-home-graph-filter
gh pr create --base dev --title "feat(protocol): home graph default status filter (Issue 3)" --body "$(cat <<'EOF'
## Summary
- `HomeGraphInvokeInput.statuses` defaults to `['latent', 'stalled', 'pending']`.
- Exports `DEFAULT_HOME_STATUSES` and `ALL_OPPORTUNITY_STATUSES` for composition.
- `getOpportunitiesForUser` now accepts `statuses` and pushes the filter into SQL.

## UX impact
Accepted/rejected opportunities are no longer surfaced in the home feed by default. This is intentional — flagged in the spec as the desired behavior. A history surface for past decisions is a follow-up.

## Test plan
- [ ] `bun test packages/protocol/tests/feed-graph.status-filter.test.ts`
- [ ] Manual home-feed verification with mixed-status seed data.

## Issue
Closes [Issue 3 doc](docs/issues/3-home-graph-status-filter.md).
EOF
)"
```

---

# Issue 4: OpenClaw Plugin — Pending-Opportunity Poller

**Issue doc:** [`docs/issues/4-openclaw-pending-poller.md`](../../issues/4-openclaw-pending-poller.md)
**Spec section:** [§ Issue 4](../specs/2026-04-15-openclaw-opportunity-delivery-design.md#issue-4--openclaw-plugin-pending-opportunity-poller)
**Worktree:** `.worktrees/issue-4-pending-poller`
**Branch:** `feat/issue-4-pending-poller`
**Depends on:** Issues 0, 1, 2 merged to dev.

## Files Touched

**Create:**
- `packages/openclaw-plugin/src/prompts/opportunity-delivery.prompt.ts`
- `packages/openclaw-plugin/tests/opportunity-pickup.test.ts`

**Modify:**
- `packages/openclaw-plugin/src/index.ts`
- `packages/openclaw-plugin/README.md` (or the generated SKILL.md template)

## Task 4.1: Opportunity-delivery prompt

**Files:**
- Create: `packages/openclaw-plugin/src/prompts/opportunity-delivery.prompt.ts`

- [ ] **Step 1: Add the prompt**

```ts
export function opportunityDeliveryPrompt(rendered: {
  headline: string;
  personalizedSummary: string;
  suggestedAction: string;
  narratorRemark: string;
}): string {
  return [
    'You are delivering an opportunity card from Index Network to the user.',
    'The text below was prepared by the Index presenter — preserve substance, format for the user\'s gateway.',
    'Do not summarize or rewrite. Lead with the headline; include the narrator remark if meaningful; show the summary and the suggested action clearly.',
    '',
    `# ${rendered.headline}`,
    '',
    rendered.narratorRemark ? `_${rendered.narratorRemark}_\n` : '',
    rendered.personalizedSummary,
    '',
    `**Suggested next step:** ${rendered.suggestedAction}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/openclaw-plugin/src/prompts/opportunity-delivery.prompt.ts
git commit -m "feat(openclaw): add opportunity-delivery prompt template"
```

## Task 4.2: Extend poll loop with opportunities/pickup

**Files:**
- Modify: `packages/openclaw-plugin/src/index.ts`

- [ ] **Step 1: Read current state after Issue 0**

The poll loop now handles two endpoints (negotiations, test-messages). Add a third between them.

- [ ] **Step 2: Add the opportunity handler**

```ts
async function handleOpportunityPickup(
  api: OpenClawPluginApi,
  baseUrl: string,
  agentId: string,
  apiKey: string,
): Promise<boolean> {
  const res = await fetch(
    `${baseUrl}/api/agents/${agentId}/opportunities/pickup`,
    { method: 'POST', headers: { 'x-api-key': apiKey } },
  );
  if (res.status === 204) return false;
  if (!res.ok) {
    api.logger.warn('opportunity pickup failed', { status: res.status });
    return false;
  }
  const payload = (await res.json()) as {
    opportunityId: string;
    reservationToken: string;
    rendered: {
      headline: string;
      personalizedSummary: string;
      suggestedAction: string;
      narratorRemark: string;
    };
  };
  await dispatchDelivery(api, {
    rendered: {
      headline: payload.rendered.headline,
      body: opportunityDeliveryPrompt(payload.rendered),
    },
    sessionKey: `index:delivery:opportunity:${payload.opportunityId}`,
    idempotencyKey: `index:delivery:opportunity:${payload.opportunityId}:${payload.reservationToken}`,
  });
  const confirm = await fetch(
    `${baseUrl}/api/agents/${agentId}/opportunities/${payload.opportunityId}/delivered`,
    {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ reservationToken: payload.reservationToken }),
    },
  );
  if (!confirm.ok) {
    api.logger.warn('opportunity confirm failed', { status: confirm.status });
  }
  return true;
}
```

Note: `dispatchDelivery`'s `body` already pipes through `deliveryPrompt`. We have two layers of prompt here:

- `opportunityDeliveryPrompt` structures the card.
- `deliveryPrompt` (inside `dispatchDelivery`) wraps it in the "you are delivering to the gateway" framing.

Prefer **one** framing layer. Refactor `dispatchDelivery` to accept a pre-framed string or restructure so `opportunityDeliveryPrompt` produces the card body that `deliveryPrompt` wraps. The cleaner split is: `deliveryPrompt(rendered: { headline, body })` where `body` is whatever the caller has already assembled. Adjust `handleOpportunityPickup` to pass:

```ts
await dispatchDelivery(api, {
  rendered: {
    headline: payload.rendered.headline,
    body: opportunityCardBody(payload.rendered),
  },
  ...
});
```

with `opportunityCardBody` returning just the body portion (narrator, summary, suggested action — not the headline, which `deliveryPrompt` renders).

- [ ] **Step 3: Wire into poll cycle**

In the poll function, call handlers in order: negotiations → opportunities → test-messages.

- [ ] **Step 4: Commit**

```bash
git add packages/openclaw-plugin/src/index.ts
git commit -m "feat(openclaw): extend poll loop with opportunity pickup"
```

## Task 4.3: Unit test for opportunity handler

**Files:**
- Create: `packages/openclaw-plugin/tests/opportunity-pickup.test.ts`

- [ ] **Step 1: Write test with mocked fetch + mocked subagent**

```ts
import { describe, expect, mock, test } from 'bun:test';

import { handleOpportunityPickup } from '../src/index'; // export the handler for testability

describe('handleOpportunityPickup', () => {
  test('returns false on 204', async () => {
    const fetchMock = mock(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as any;
    const api = makeFakeApi();
    const result = await handleOpportunityPickup(api, 'http://x', 'agent', 'key');
    expect(result).toBe(false);
  });

  test('dispatches delivery and confirms on 200', async () => {
    const pickupResponse = new Response(
      JSON.stringify({
        opportunityId: 'opp-1',
        reservationToken: 'tok-1',
        rendered: {
          headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: 'N',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const confirmResponse = new Response(null, { status: 200 });
    const fetchMock = mock(async (url: string) =>
      url.includes('/delivered') ? confirmResponse.clone() : pickupResponse.clone(),
    );
    globalThis.fetch = fetchMock as any;
    const api = makeFakeApi();
    const result = await handleOpportunityPickup(api, 'http://x', 'agent', 'key');
    expect(result).toBe(true);
    expect(api.runtime.subagent.run).toHaveBeenCalled();
    // confirm was called
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('/delivered')),
    ).toBe(true);
  });

  test('skips confirm when dispatch fails', async () => {
    // ... subagent throws; confirm not called
  });
});
```

`handleOpportunityPickup` must be exported from the plugin's entry module. If the file only exposes `register()`, export the handler as a named export or factor it into a separate file to make it testable.

- [ ] **Step 2: Run tests**

```bash
cd packages/openclaw-plugin && bun test tests/opportunity-pickup.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/openclaw-plugin/
git commit -m "test(openclaw): cover opportunity pickup handler"
```

## Task 4.4: README / install-instructions update

**Files:**
- Modify: `packages/openclaw-plugin/README.md` (or the SKILL.md template in `packages/protocol/skills/openclaw/SKILL.md.template` — whichever is source of truth)

- [ ] **Step 1: Update the docs**

Add sections describing:
- **v1 (supported):** The pending-opportunity poller. Runs every 30s. When an opportunity passes negotiation and becomes pending, the plugin picks it up and delivers a presenter-rendered card to the user via their active gateway.
- **alpha:** The negotiation poller. Per-user negotiation agents are experimental; use only if you understand the implications (including that a paused plugin parks negotiations in `waiting_for_agent` state until the 24h server-side fallback engages).

Include a quick start:
> On install, click "Send test message" on your agent's page in the Index Network dashboard to verify delivery. You should see the message in your active OpenClaw gateway within ~30 seconds.

If the source of truth is the template, re-run the skill builder per CLAUDE.md's guidance:

```bash
cd <repo-root> && bun scripts/build-skills.ts
```

Commit both the template change and the materialized output.

- [ ] **Step 2: Commit**

```bash
git add packages/openclaw-plugin/ packages/protocol/skills/
git commit -m "docs(openclaw): tag negotiation poller alpha, document pending-opportunity v1"
```

## Task 4.5: Integration smoke test

- [ ] **Step 1: Manual end-to-end**

1. Start the protocol backend.
2. Start a connected OpenClaw plugin instance (configured with a valid agent + API key).
3. Drive a negotiation to `pending` via a test fixture or the seed script.
4. Observe within ~30s: a message arrives in the plugin's active gateway with the rendered opportunity card.
5. Check the database: `opportunity_deliveries` has one row with `trigger='pending_pickup'`, `channel='openclaw'`, and `delivered_at IS NOT NULL`.

- [ ] **Step 2: Document any follow-ups**

If the manual test surfaces issues (e.g. malformed card, timing), file follow-up tasks before merging.

## Task 4.6: PR for Issue 4

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat/issue-4-pending-poller
gh pr create --base dev --title "feat(openclaw): pending-opportunity poller (Issue 4)" --body "$(cat <<'EOF'
## Summary
- Plugin poll loop now calls `/opportunities/pickup` between negotiations and test-messages each cycle.
- New opportunity-delivery prompt structures the card for gateway rendering.
- README tags the negotiation poller as alpha; pending-opportunity poller is v1.

## Test plan
- [ ] `bun test packages/openclaw-plugin/tests/opportunity-pickup.test.ts`
- [ ] Manual end-to-end: drive negotiation to pending; card arrives in gateway; ledger committed.

## Issue
Closes [Issue 4 doc](docs/issues/4-openclaw-pending-poller.md).
EOF
)"
```

---

# Issue 5: Morning Home-Digest Endpoint + Plugin Cron

**Issue doc:** [`docs/issues/5-morning-home-digest.md`](../../issues/5-morning-home-digest.md)
**Spec section:** [§ Issue 5](../specs/2026-04-15-openclaw-opportunity-delivery-design.md#issue-5--morning-home-digest-endpoint--plugin-cron)
**Worktree:** `.worktrees/issue-5-home-digest`
**Branch:** `feat/issue-5-home-digest`
**Depends on:** Issues 0, 1, 2, 3 merged to dev.

## Files Touched

**Create:**
- `packages/openclaw-plugin/src/digest.scheduler.ts`
- `packages/openclaw-plugin/tests/digest.scheduler.test.ts`
- `backend/tests/home-digest.controller.test.ts`

**Modify:**
- `backend/src/services/opportunity-delivery.service.ts` (add `buildDigest`)
- `backend/src/controllers/opportunity-delivery.controller.ts` (add digest routes)
- `packages/openclaw-plugin/src/index.ts` (register the scheduler)
- `packages/openclaw-plugin/package.json` (add `node-cron`)

## Task 5.1: Extend service with `buildDigest`

**Files:**
- Modify: `backend/src/services/opportunity-delivery.service.ts`

- [ ] **Step 1: Write the failing test**

In `backend/tests/opportunity-delivery.service.test.ts` (extend the existing file from Issue 1), add:

```ts
test('buildDigest returns empty when no actionable opportunities', async () => {
  const digest = await service.buildDigest(agentId);
  expect(digest.items.length).toBe(0);
});

test('buildDigest returns rendered items for actionable opps (not yet delivered)', async () => {
  await seedPendingOpportunity(userId);
  await seedLatentOpportunity(userId);
  const digest = await service.buildDigest(agentId);
  expect(digest.items.length).toBe(2);
  expect(digest.digestId).toBeTruthy();
});

test('buildDigest excludes opportunities already delivered at the same status', async () => {
  await seedPendingOpportunity(userId);
  // Simulate real-time pending-pickup committed delivery:
  const pickup = await service.pickupPending(agentId);
  await service.confirmDelivered(pickup!.opportunityId, userId, pickup!.reservationToken);
  const digest = await service.buildDigest(agentId);
  expect(digest.items.length).toBe(0);
});

test('confirmDigest commits listed tokens; others expire', async () => {
  await seedPendingOpportunity(userId);
  await seedLatentOpportunity(userId);
  const digest = await service.buildDigest(agentId);
  await service.confirmDigest(
    digest.digestId,
    [digest.items[0].reservationToken], // confirm only one
  );
  // The unconfirmed one should still be in reserved state; backdate + re-pickup
  await db.execute(
    `UPDATE opportunity_deliveries SET reserved_at = now() - interval '2 minutes' WHERE delivered_at IS NULL`,
  );
  const nextDigest = await service.buildDigest(agentId);
  expect(nextDigest.items.length).toBe(1); // the unconfirmed one re-appears
});
```

- [ ] **Step 2: Verify it fails**

```bash
cd backend && bun test tests/opportunity-delivery.service.test.ts
```

Expected: FAIL — methods don't exist.

- [ ] **Step 3: Implement `buildDigest` and `confirmDigest`**

Add to `OpportunityDeliveryService`:

```ts
import { DEFAULT_HOME_STATUSES, HomeGraphFactory } from '@indexnetwork/protocol';
import { randomUUID } from 'node:crypto';

const TRIGGER_DIGEST = 'morning_digest';

export interface DigestItem {
  opportunityId: string;
  reservationToken: string;
  rendered: PickupPendingResult['rendered'];
}

export interface DigestResult {
  digestId: string;
  reservationExpiresAt: Date;
  items: DigestItem[];
}

async buildDigest(agentId: string): Promise<DigestResult> {
  const agent = await this.resolveAgentOwner(agentId);
  const userId = agent.ownerUserId;
  const digestId = randomUUID();
  const reservedAt = new Date();
  const reservationExpiresAt = new Date(
    reservedAt.getTime() + RESERVATION_TTL_SECONDS * 1000,
  );

  // Run home graph with default filter.
  const homeGraph = new HomeGraphFactory(this.protocolDeps);
  const graphResult = await homeGraph.invoke({ userId });
  // graphResult should expose the list of opportunity IDs that would feed the feed.
  const candidates: Array<{ id: string; status: string }> = graphResult.opportunities ?? [];

  // Filter out already-delivered at the same status.
  const eligible: Array<{ id: string; status: string }> = [];
  for (const c of candidates) {
    const alreadyDelivered = await db
      .select({ id: opportunityDeliveries.id })
      .from(opportunityDeliveries)
      .where(
        and(
          eq(opportunityDeliveries.opportunityId, c.id),
          eq(opportunityDeliveries.userId, userId),
          eq(opportunityDeliveries.channel, CHANNEL),
          eq(opportunityDeliveries.deliveredAtStatus, c.status),
          not(isNull(opportunityDeliveries.deliveredAt)),
        ),
      )
      .limit(1);
    if (alreadyDelivered.length === 0) eligible.push(c);
  }

  if (eligible.length === 0) {
    return { digestId, reservationExpiresAt, items: [] };
  }

  // Build reservation rows (batch insert).
  const rows = eligible.map((c) => ({
    opportunityId: c.id,
    userId,
    agentId,
    channel: CHANNEL,
    trigger: TRIGGER_DIGEST,
    deliveredAtStatus: c.status,
    reservationToken: randomUUID(),
    reservedAt,
    // Store digestId in a column if one exists, or encode into a separate side-table.
    // Minimum: include digestId in the reservation token's metadata via a separate key
    // Option A (simplest): add `digest_id` column to opportunity_deliveries in Issue 5's migration.
  }));
  await db.insert(opportunityDeliveries).values(rows);

  // Render each item.
  const items: DigestItem[] = [];
  for (let i = 0; i < eligible.length; i++) {
    const rendered = await this.renderOpportunityCard(eligible[i].id, userId);
    items.push({
      opportunityId: eligible[i].id,
      reservationToken: rows[i].reservationToken,
      rendered,
    });
  }

  return { digestId, reservationExpiresAt, items };
}

async confirmDigest(
  digestId: string,
  deliveredTokens: string[],
): Promise<{ committed: number }> {
  if (deliveredTokens.length === 0) return { committed: 0 };
  const rows = await db
    .update(opportunityDeliveries)
    .set({ deliveredAt: new Date() })
    .where(
      and(
        eq(opportunityDeliveries.digestId, digestId),
        inArray(opportunityDeliveries.reservationToken, deliveredTokens),
        isNull(opportunityDeliveries.deliveredAt),
      ),
    )
    .returning({ id: opportunityDeliveries.id });
  return { committed: rows.length };
}
```

**Schema addendum:** add a `digest_id uuid` column on `opportunity_deliveries` via a follow-up migration in this issue:

Update `backend/src/schemas/database.schema.ts` — add `digestId: uuid('digest_id')` to the table definition. Run `bun run db:generate`, rename the new migration `NNNN_add_digest_id_to_opportunity_deliveries.sql`, update the journal tag, apply.

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test tests/opportunity-delivery.service.test.ts
```

Expected: all tests (Issue 1's + Issue 5's) pass.

- [ ] **Step 5: Commit**

```bash
cd backend && bunx tsc --noEmit
git add backend/
git commit -m "feat(backend): add buildDigest and confirmDigest to OpportunityDeliveryService"
```

## Task 5.2: Digest endpoints on controller

**Files:**
- Modify: `backend/src/controllers/opportunity-delivery.controller.ts`
- Create: `backend/tests/home-digest.controller.test.ts`

- [ ] **Step 1: Write the failing controller test**

Mirror the structure of the Issue 1 controller test. Cover:
- `POST /agents/:id/home-digest` returns 204 when empty.
- `POST /agents/:id/home-digest` returns `{ digestId, items }` when populated.
- `POST /agents/:id/home-digest/:digestId/confirm` commits listed tokens.

- [ ] **Step 2: Verify it fails**

```bash
cd backend && bun test tests/home-digest.controller.test.ts
```

- [ ] **Step 3: Add routes**

In `opportunity-delivery.controller.ts`:

```ts
@Post('/home-digest')
@ApiKeyAgentAuth()
async homeDigest(@Param('agentId') agentId: string) {
  const digest = await this.service.buildDigest(agentId);
  if (digest.items.length === 0) return { status: 204 };
  return digest;
}

@Post('/home-digest/:digestId/confirm')
@ApiKeyAgentAuth()
async confirmHomeDigest(
  @Param('digestId') digestId: string,
  @Body() body: { deliveredTokens: string[] },
) {
  const { committed } = await this.service.confirmDigest(digestId, body.deliveredTokens);
  return { committed };
}
```

Note: these new routes share the `/agents/:agentId/opportunities` controller but their paths start with `/home-digest` — verify the controller's base path composition allows that. If not, create a separate controller `HomeDigestController` at `/agents/:agentId/home-digest` and register it in `main.ts`.

- [ ] **Step 4: Run tests, type-check, commit**

```bash
cd backend && bun test tests/home-digest.controller.test.ts
cd backend && bunx tsc --noEmit
git add backend/src/controllers/ backend/tests/home-digest.controller.test.ts
git commit -m "feat(backend): add home-digest pickup + confirm routes"
```

## Task 5.3: Plugin cron + digest scheduler

**Files:**
- Modify: `packages/openclaw-plugin/package.json` (add `node-cron` dep)
- Create: `packages/openclaw-plugin/src/digest.scheduler.ts`
- Create: `packages/openclaw-plugin/tests/digest.scheduler.test.ts`

- [ ] **Step 1: Add the dependency**

```bash
cd packages/openclaw-plugin && bun add node-cron
cd packages/openclaw-plugin && bun add -d @types/node-cron
```

- [ ] **Step 2: Write the failing test**

Create `packages/openclaw-plugin/tests/digest.scheduler.test.ts`:

```ts
import { describe, expect, mock, test } from 'bun:test';

import { runDigest } from '../src/digest.scheduler';

describe('runDigest', () => {
  test('returns early on 204', async () => {
    const fetchMock = mock(async (url: string) =>
      url.endsWith('/home-digest') ? new Response(null, { status: 204 }) : new Response(null, { status: 500 }),
    );
    globalThis.fetch = fetchMock as any;
    const api = makeFakeApi();
    await runDigest(api, 'http://x', 'agent', 'key');
    expect(api.runtime.subagent.run).not.toHaveBeenCalled();
  });

  test('dispatches single subagent for N items, confirms all tokens', async () => {
    const digestResponse = new Response(
      JSON.stringify({
        digestId: 'd-1',
        reservationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        items: [
          { opportunityId: 'o1', reservationToken: 't1', rendered: makeRendered() },
          { opportunityId: 'o2', reservationToken: 't2', rendered: makeRendered() },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const confirmResponse = new Response(JSON.stringify({ committed: 2 }), { status: 200, headers: { 'content-type': 'application/json' } });
    const fetchMock = mock(async (url: string) =>
      url.includes('/confirm') ? confirmResponse.clone() : digestResponse.clone(),
    );
    globalThis.fetch = fetchMock as any;
    const api = makeFakeApi();
    await runDigest(api, 'http://x', 'agent', 'key');
    expect(api.runtime.subagent.run).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('/confirm')),
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Verify it fails**

```bash
cd packages/openclaw-plugin && bun test tests/digest.scheduler.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement the scheduler**

Create `packages/openclaw-plugin/src/digest.scheduler.ts`:

```ts
import cron from 'node-cron';

import { dispatchDelivery } from './delivery.dispatcher';
import type { OpenClawPluginApi } from './plugin-api';

const DEFAULT_CRON = '0 8 * * *';

export function registerDigestCron(
  api: OpenClawPluginApi,
  baseUrl: string,
  agentId: string,
  apiKey: string,
): () => void {
  const schedule = (api.pluginConfig.digestCron as string) ?? DEFAULT_CRON;
  const task = cron.schedule(schedule, async () => {
    try {
      await runDigest(api, baseUrl, agentId, apiKey);
    } catch (err) {
      api.logger.error('digest run failed', { err: String(err) });
    }
  });
  return () => task.stop();
}

export async function runDigest(
  api: OpenClawPluginApi,
  baseUrl: string,
  agentId: string,
  apiKey: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/agents/${agentId}/home-digest`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
  });
  if (res.status === 204) {
    api.logger.info('digest: no actionable opportunities today');
    return;
  }
  if (!res.ok) {
    api.logger.warn('digest fetch failed', { status: res.status });
    return;
  }
  const digest = (await res.json()) as {
    digestId: string;
    items: Array<{
      opportunityId: string;
      reservationToken: string;
      rendered: {
        headline: string;
        personalizedSummary: string;
        suggestedAction: string;
        narratorRemark: string;
      };
    }>;
  };

  const body = [
    `Good morning. Here are ${digest.items.length} opportunities worth your attention today.`,
    '',
    ...digest.items.map((item, i) =>
      [
        `---`,
        `## ${i + 1}. ${item.rendered.headline}`,
        item.rendered.narratorRemark ? `_${item.rendered.narratorRemark}_` : '',
        item.rendered.personalizedSummary,
        '',
        `**Suggested next step:** ${item.rendered.suggestedAction}`,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n');

  await dispatchDelivery(api, {
    rendered: {
      headline: 'Your morning brief from Index Network',
      body,
    },
    sessionKey: `index:delivery:digest:${digest.digestId}`,
    idempotencyKey: `index:delivery:digest:${digest.digestId}`,
  });

  const tokens = digest.items.map((i) => i.reservationToken);
  const confirm = await fetch(
    `${baseUrl}/api/agents/${agentId}/home-digest/${digest.digestId}/confirm`,
    {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ deliveredTokens: tokens }),
    },
  );
  if (!confirm.ok) {
    api.logger.warn('digest confirm failed', { status: confirm.status });
  }
}
```

- [ ] **Step 5: Register in `index.ts`**

In `register()`, after the poll loop is set up, call:

```ts
import { registerDigestCron } from './digest.scheduler';
// ...
registerDigestCron(api, baseUrl, agentId, apiKey);
```

- [ ] **Step 6: Run tests**

```bash
cd packages/openclaw-plugin && bun test tests/digest.scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 7: Type-check and commit**

```bash
cd packages/openclaw-plugin && bunx tsc --noEmit
git add packages/openclaw-plugin/
git commit -m "feat(openclaw): add morning digest scheduler (node-cron)"
```

## Task 5.4: End-to-end smoke

- [ ] **Step 1: Manual verification**

1. Seed the database with 2 actionable opportunities for a test user (one latent, one pending).
2. Start the backend and the plugin (configured to the test agent).
3. Override the cron schedule via `pluginConfig.digestCron='* * * * *'` (every minute) for testing.
4. Within 60–90s, observe: one subagent dispatch containing both items under the morning-brief framing; `opportunity_deliveries` has two rows with `trigger='morning_digest'`, same `digestId`, both `delivered_at` set.
5. Reset the schedule to `'0 8 * * *'` after validation.

- [ ] **Step 2: Document any follow-ups**

## Task 5.5: PR for Issue 5

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat/issue-5-home-digest
gh pr create --base dev --title "feat(openclaw): morning home-digest endpoint + plugin cron (Issue 5)" --body "$(cat <<'EOF'
## Summary
- `OpportunityDeliveryService.buildDigest` runs the home graph, filters out already-delivered, renders cards, writes one digest-batch of reservations.
- `OpportunityDeliveryService.confirmDigest` commits a list of tokens under a single digestId.
- New endpoints: `POST /agents/:id/home-digest` and `.../confirm`.
- Plugin registers a `node-cron` at `'0 8 * * *'` (configurable via `pluginConfig.digestCron`) that runs the digest and dispatches a single batched delivery subagent.
- Schema: add `digest_id` to `opportunity_deliveries` via migration.

## Test plan
- [ ] `bun test backend/tests/opportunity-delivery.service.test.ts` (covers buildDigest/confirmDigest)
- [ ] `bun test backend/tests/home-digest.controller.test.ts`
- [ ] `bun test packages/openclaw-plugin/tests/digest.scheduler.test.ts`
- [ ] Manual: seed actionable opps, override cron to every-minute, confirm single subagent dispatch + all-tokens confirm.
- [ ] Offline-overnight simulation: stop plugin, wait past cron, restart next day, confirm yesterday's missed items land in today's digest.

## Issue
Closes [Issue 5 doc](docs/issues/5-morning-home-digest.md).
EOF
)"
```

---

# Wrap-up

Once all six PRs have merged into `dev`:

- [ ] Update `CLAUDE.md` if any structural or architectural claim has drifted (unlikely for this feature, but verify).
- [ ] Bump versions on affected packages (`packages/protocol`, `packages/openclaw-plugin`) per SemVer — breaking changes are unlikely here; this is likely a minor bump.
- [ ] Delete the worktrees: `git worktree remove .worktrees/issue-<N>-<slug>` for each.
- [ ] Delete the branches: `git branch -d feat/issue-<N>-<slug>` for each.
- [ ] Delete the issue docs in `docs/issues/` only if the user confirms they should go (issue docs are often retained as GitHub-issue provenance — leave by default).
- [ ] Consider filing a follow-up for the spec's three open questions: frontend path confirmation (already resolved during Issue 0 implementation), test-button delivery polling, and `pluginConfig.digestTimezone` override.

---

# Self-Review Notes

**Spec coverage check:** All six spec issues map to a plan section. Cross-cutting decisions (gateway routing, reservation TTL, 30s poll, single subagent dispatch for batch, multi-machine safety) are either realized in specific tasks or are invariants enforced by the shape of the endpoints.

**Placeholder scan:** No "TBD"/"TODO"/"fill in later". Task 1.2 flags the presenter wiring as an integration point with Issue 2 (handles both before-Issue-2 and after-Issue-2 states). Task 4.2 calls out a prompt-layering overlap and prescribes a concrete refactor before proceeding.

**Type consistency:**
- `PickupPendingResult`, `DigestItem`, `DigestResult`, `NegotiationContext` used consistently across tasks.
- `dispatchDelivery`'s `DeliveryRequest.rendered = { headline, body }` — callers in Task 0.5, 4.2, 5.3 all pass this shape.
- Table and column names match across schema, service, and SQL predicates.

**Known simplifications that the implementer should verify:**
- The SQL in `pickupPending` (Task 1.2) uses a placeholder `opportunity_visible_to_user(...)` function — replace with the actual visibility predicate from `canUserSeeOpportunity()` during implementation.
- The prompt-layering concern flagged in Task 4.2 must be resolved before merging Issue 4.
