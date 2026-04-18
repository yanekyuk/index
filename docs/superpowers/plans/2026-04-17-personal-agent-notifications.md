# Personal Agent Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trim default personal-agent permissions, add three owner-toggleable notification preferences (`notify_on_opportunity`, `daily_summary_enabled`, `handle_negotiations` ALPHA), widen opportunity pickup to include `draft` opps for the counterparty only, and remove the unused agent webhook transport.

**Architecture:** Four new columns on `agents`. One migration narrows `transport_channel` enum and revokes `manage:negotiations` from existing personal agents. `AgentService.update` becomes the single writer that keeps the `handle_negotiations` column synchronized with the owner's permission row via a transaction. `OpportunityDeliveryService.pickupPending` widens its predicate to include `draft` status and excludes the initiator via `detection.createdBy`. Agent webhook transport code and docs are deleted; the Telegram inbound `webhooks.controller.ts` is unrelated and preserved.

**Tech Stack:** Bun, TypeScript, Drizzle ORM (PostgreSQL), Express-style controllers, Vite/React 19 frontend, BullMQ (for the deferred daily-summary worker only).

**Related spec:** [docs/superpowers/specs/2026-04-17-personal-agent-notifications-design.md](../specs/2026-04-17-personal-agent-notifications-design.md)

---

## Pre-flight: worktree setup

- [ ] **Create worktree from `dev`**

```bash
git worktree add .worktrees/feat-personal-agent-notifications dev
bun run worktree:setup feat-personal-agent-notifications
```

- [ ] **Switch the worktree branch to a proper feature branch**

```bash
cd .worktrees/feat-personal-agent-notifications
git checkout -b feat/personal-agent-notifications
```

All subsequent commands run from `.worktrees/feat-personal-agent-notifications`.

---

## Phase A — Agent webhook transport removal

This phase ships first because it simplifies the schema and agent-service surface that later phases modify. No behavioral change for users who weren't using the webhook transport, which (per the spec) is everyone — webhook-attached personal agents were the only path to `manage:negotiations` and that path is being replaced by the `handle_negotiations` toggle in Phase D.

### Task A1: Delete the `add_webhook_transport` tool and its test

**Files:**
- Delete: `packages/protocol/src/agent/tests/add-webhook-transport.spec.ts`
- Modify: `packages/protocol/src/agent/agent.tools.ts`

- [ ] **Step 1: Delete the test file**

```bash
rm packages/protocol/src/agent/tests/add-webhook-transport.spec.ts
```

- [ ] **Step 2: Remove the tool definition and its helpers**

Open `packages/protocol/src/agent/agent.tools.ts`. Delete:

1. The `WEBHOOK_EVENTS` constant (around line 19–22).
2. `isValidWebhookEvent` (around line 24–26).
3. `normalizeWebhookEvents` (around line 64–66).
4. The `webhook` branch in `sanitizeAgentForOutput` (around line 52–62) — replace the whole function with:

```ts
function sanitizeAgentForOutput<T extends { transports?: Array<{ channel: string; config: Record<string, unknown> }> }>(agent: T): T {
  return {
    ...agent,
    transports: agent.transports,
  };
}
```

5. The entire `add_webhook_transport` tool entry inside `createAgentTools` (the `defineTool(...)` block starting with that name — includes its Zod schema and handler).
6. Any remaining imports only used by the removed code (e.g. if `z` is still needed by other tools, leave it; otherwise remove).

- [ ] **Step 3: Run tsc against the protocol package to confirm no stragglers**

Run: `cd packages/protocol && bun x tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/agent/agent.tools.ts
git rm packages/protocol/src/agent/tests/add-webhook-transport.spec.ts
git commit -m "refactor(protocol): remove add_webhook_transport tool and test"
```

### Task A2: Remove webhook-shaped types and helpers from shared interfaces

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/agent.interface.ts`
- Modify: `packages/protocol/src/shared/agent/tool.helpers.ts`
- Modify: `packages/protocol/src/shared/agent/tests/tool.helpers.spec.ts`
- Modify: `packages/protocol/src/agent/tests/fakes.ts`

- [ ] **Step 1: Inspect each file for webhook references**

Run: `grep -n -i webhook packages/protocol/src/shared/interfaces/agent.interface.ts packages/protocol/src/shared/agent/tool.helpers.ts packages/protocol/src/shared/agent/tests/tool.helpers.spec.ts packages/protocol/src/agent/tests/fakes.ts`

For each hit, determine whether it's:
- A type member (e.g. `'webhook' | 'mcp'` in a union) → remove the `'webhook'` member.
- A fixture/factory function that builds a webhook transport → delete the function; delete any test using it.
- Commentary that assumes webhooks exist → rewrite to reflect polling-only.

- [ ] **Step 2: Apply edits, then run tsc on the protocol package**

Run: `cd packages/protocol && bun x tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Run the protocol tests still present**

Run: `cd packages/protocol && bun test src/shared/agent/tests/tool.helpers.spec.ts`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/shared packages/protocol/src/agent/tests/fakes.ts
git commit -m "refactor(protocol): drop webhook transport types and fixtures"
```

### Task A3: Narrow `transport_channel` enum in the schema

**Files:**
- Modify: `backend/src/schemas/database.schema.ts` — line 14

- [ ] **Step 1: Replace the enum definition**

Open `backend/src/schemas/database.schema.ts`. Find:

```ts
export const transportChannelEnum = pgEnum('transport_channel', ['webhook', 'mcp']);
```

Replace with:

```ts
export const transportChannelEnum = pgEnum('transport_channel', ['mcp']);
```

- [ ] **Step 2: Do not run `db:generate` yet**

The migration is built in Task A4, which combines schema + backfill in a single ordered SQL file to guarantee webhook rows are deleted before the enum label is dropped.

- [ ] **Step 3: Commit (schema edit only)**

```bash
git add backend/src/schemas/database.schema.ts
git commit -m "chore(schema): narrow transport_channel enum to mcp only"
```

### Task A4: Migration — delete webhook transport rows, drop `'webhook'` enum label

**Files:**
- Create: `backend/drizzle/0052_drop_webhook_transport.sql`
- Modify: `backend/drizzle/meta/_journal.json` (add entry for 0052)

- [ ] **Step 1: Write the migration file**

Create `backend/drizzle/0052_drop_webhook_transport.sql` with:

```sql
-- Delete any existing webhook transport rows. No personal agent currently
-- depends on this transport; see spec 2026-04-17-personal-agent-notifications-design.md.
DELETE FROM agent_transports WHERE channel = 'webhook';

-- Drop the 'webhook' label from transport_channel by rebuilding the enum.
-- PostgreSQL doesn't support DROP VALUE on a type; rename + recreate + swap.
ALTER TYPE transport_channel RENAME TO transport_channel_old;
CREATE TYPE transport_channel AS ENUM ('mcp');
ALTER TABLE agent_transports
  ALTER COLUMN channel TYPE transport_channel
  USING channel::text::transport_channel;
DROP TYPE transport_channel_old;
```

- [ ] **Step 2: Append a journal entry for the new migration**

Open `backend/drizzle/meta/_journal.json`. Inside the `entries` array, append (preserving JSON validity):

```json
{
  "idx": 52,
  "version": "7",
  "when": 1713312000000,
  "tag": "0052_drop_webhook_transport",
  "breakpoints": true
}
```

Use the `idx`, `version`, and `breakpoints` format of the previous entry verbatim. Use any sensible `when` timestamp (present time in ms).

- [ ] **Step 3: Apply the migration**

Run: `cd backend && bun run db:migrate`
Expected output includes: `0052_drop_webhook_transport` applied.

- [ ] **Step 4: Confirm the schema state**

Run: `cd backend && bun run db:generate`
Expected: "No schema changes".

- [ ] **Step 5: Commit**

```bash
git add backend/drizzle/0052_drop_webhook_transport.sql backend/drizzle/meta
git commit -m "feat(db): drop webhook transport rows and enum label (0052)"
```

### Task A5: Remove webhook branches from agent database adapter and service

**Files:**
- Modify: `backend/src/adapters/agent.database.adapter.ts`
- Modify: `backend/src/services/agent.service.ts`
- Modify: `backend/tests/agent.service.test.ts`

- [ ] **Step 1: Find and remove webhook-specific branches in the adapter**

Run: `grep -n -i webhook backend/src/adapters/agent.database.adapter.ts`

For each hit, determine whether it's purely webhook code (delete) or a shared code path gated on `channel === 'webhook'` (remove the branch, keep the rest).

- [ ] **Step 2: Adjust `createTransportRow` test helper**

Open `backend/tests/agent.service.test.ts`. Change `createTransportRow`'s default `channel` from `'webhook'` to `'mcp'` and its `config` to `{}`. Any test that relied on webhook-specific config (`url`, `secret`, `events`) should be re-expressed against MCP or deleted if it was exercising webhook-only behavior.

- [ ] **Step 3: Run agent service tests**

Run: `cd backend && bun test tests/agent.service.test.ts`
Expected: all tests pass. If any test is fundamentally webhook-specific (e.g. "adds manage:negotiations when webhook attached"), delete it — the escalation path is moving to Phase D.

- [ ] **Step 4: Commit**

```bash
git add backend/src/adapters/agent.database.adapter.ts backend/src/services/agent.service.ts backend/tests/agent.service.test.ts
git commit -m "refactor(agent): drop webhook transport branches"
```

### Task A6: Scan remaining code for webhook-transport references

**Files (inspect and clean if webhook-transport is mentioned):**
- `backend/src/main.ts`
- `backend/src/services/negotiation-polling.service.ts`
- `backend/src/cli/db-flush.ts`
- `backend/tests/mcp.test.ts`

- [ ] **Step 1: Grep each file**

Run: `grep -n -i webhook backend/src/main.ts backend/src/services/negotiation-polling.service.ts backend/src/cli/db-flush.ts backend/tests/mcp.test.ts`

- [ ] **Step 2: For each hit, decide:**

- If it's wiring the deleted tool/transport → delete.
- If it's an inbound Telegram reference (routes to `webhooks.controller.ts` or `gateways/telegram.gateway.ts`) → **leave it alone**. This is a different subsystem.
- If unclear, read the file context before deciding.

- [ ] **Step 3: Run the backend type-check**

Run: `cd backend && bun x tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Run the backend tests touched**

Run: `cd backend && bun test tests/mcp.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit (only if edits were made)**

```bash
git add -u
git commit -m "chore: remove residual webhook transport references"
```

### Task A7: Documentation and env cleanup

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/specs/api-reference.md`
- Modify: `docs/design/architecture-overview.md`
- Modify: `packages/protocol/README.md`
- Modify: `packages/openclaw-plugin/README.md`
- Modify: `docs/guides/getting-started.md`
- Modify: `backend/.env.example`

- [ ] **Step 1: Grep each file for webhook transport references**

Run: `grep -n -i webhook CLAUDE.md docs/specs/api-reference.md docs/design/architecture-overview.md packages/protocol/README.md packages/openclaw-plugin/README.md docs/guides/getting-started.md backend/.env.example`

- [ ] **Step 2: For each hit, apply one of these patterns:**

- **CLAUDE.md** (Agent Registry section): replace any "`add_webhook_transport`" or "webhook transport" language with a one-line note that personal agents opt into negotiations via the `handle_negotiations` toggle. Delete any paragraph that talks about webhook attachment as an escalation path.
- **api-reference.md**: delete the `POST /agent/webhook` (or equivalent) endpoint entry and any webhook config fields from agent payload examples. Add a note that transports are MCP-only.
- **architecture-overview.md**: remove "webhook transport" from node/diagram captions; leave "MCP transport" references.
- **protocol/README.md** and **openclaw-plugin/README.md**: delete webhook setup sections. OpenClaw plugin is poll-only.
- **getting-started.md**: delete webhook setup steps.
- **backend/.env.example**: delete any `WEBHOOK_*` env vars that were used by the transport (not Telegram-inbound, which uses `TELEGRAM_WEBHOOK_SECRET` or similar — those stay).

- [ ] **Step 3: Re-grep to confirm no agent-transport webhook references remain**

Run: `grep -n -i "webhook transport\|add_webhook_transport\|agent webhook" CLAUDE.md docs/specs/api-reference.md docs/design/architecture-overview.md packages/protocol/README.md packages/openclaw-plugin/README.md docs/guides/getting-started.md backend/.env.example`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add -u CLAUDE.md docs/ packages/protocol/README.md packages/openclaw-plugin/README.md backend/.env.example
git commit -m "docs: remove agent webhook transport references"
```

### Task A8: Rebuild OpenClaw skill from template

**Files:**
- Modify: `packages/protocol/skills/openclaw/SKILL.md.template` (if any webhook guidance is present — as of this plan it says "no public URL or webhook is needed", which is accurate; verify no deletion needed)
- Regenerated: `packages/openclaw-plugin/skills/index-network/SKILL.md`

- [ ] **Step 1: Grep the template**

Run: `grep -n -i webhook packages/protocol/skills/openclaw/SKILL.md.template`
Expected: the only hit is the accurate "no public URL or webhook is needed" sentence. Leave it.

If other webhook language is present (e.g. instructions to register a webhook URL), delete those lines.

- [ ] **Step 2: Run the skills build script**

Run: `bun run scripts/build-skills.ts`
Expected: `packages/openclaw-plugin/skills/index-network/SKILL.md` regenerated.

- [ ] **Step 3: Verify the generated file matches expectations**

Run: `git diff packages/openclaw-plugin/skills/index-network/SKILL.md`
Expected: only the webhook-related language (if any) changed.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/skills/openclaw/SKILL.md.template packages/openclaw-plugin/skills/index-network/SKILL.md
git commit -m "docs(skills): rebuild openclaw skill after webhook cleanup"
```

---

## Phase B — Schema migration for agents columns and ledger enum

### Task B1: Add four columns to `agents` and extend `delivered_at_status` enum

**Files:**
- Modify: `backend/src/schemas/database.schema.ts` (the `agents` table definition and the `deliveredAtStatusEnum` / `opportunityDeliveries` block)

- [ ] **Step 1: Locate the `agents` table definition**

Run: `grep -n "export const agents\b" backend/src/schemas/database.schema.ts`

- [ ] **Step 2: Add the four new columns**

Inside the `agents` table definition (the object literal passed to `pgTable`), add these fields **above** the `(table) => ({ ownerIdIdx: ... })` index block:

```ts
notifyOnOpportunity: boolean('notify_on_opportunity').notNull().default(true),
dailySummaryEnabled: boolean('daily_summary_enabled').notNull().default(true),
handleNegotiations: boolean('handle_negotiations').notNull().default(false),
lastDailySummaryAt: timestamp('last_daily_summary_at', { withTimezone: true }),
```

- [ ] **Step 3: Extend `delivered_at_status` enum**

Locate the enum. It likely reads:

```ts
export const deliveredAtStatusEnum = pgEnum('delivered_at_status', ['pending']);
```

Change to:

```ts
export const deliveredAtStatusEnum = pgEnum('delivered_at_status', ['pending', 'draft']);
```

(If the enum name differs, match the existing name. The value list grows by `'draft'`.)

- [ ] **Step 4: Run `db:generate`**

Run: `cd backend && bun run db:generate`
Expected: a new migration file `0053_<random_name>.sql` appears under `backend/drizzle/`.

- [ ] **Step 5: Rename and patch the generated migration**

Rename `0053_<random_name>.sql` → `0053_agent_notification_columns.sql` and update the corresponding `tag` in `backend/drizzle/meta/_journal.json` entry (match the rename, without `.sql`).

Open the migration file. Its body should resemble:

```sql
ALTER TYPE delivered_at_status ADD VALUE 'draft';--> statement-breakpoint
ALTER TABLE agents ADD COLUMN notify_on_opportunity boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE agents ADD COLUMN daily_summary_enabled boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE agents ADD COLUMN handle_negotiations boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE agents ADD COLUMN last_daily_summary_at timestamp with time zone;
```

If `ALTER TYPE ... ADD VALUE` is emitted inside a transaction Drizzle wraps, PostgreSQL rejects it. If migration fails with `ALTER TYPE ... ADD cannot run inside a transaction block`, split the enum addition into its own migration file `0053a_extend_delivered_at_status_enum.sql`, migrated before 0053.

- [ ] **Step 6: Run the migration**

Run: `cd backend && bun run db:migrate`
Expected: 0053 (and 0053a if split) apply cleanly.

- [ ] **Step 7: Confirm schema is in sync**

Run: `cd backend && bun run db:generate`
Expected: "No schema changes".

- [ ] **Step 8: Commit**

```bash
git add backend/src/schemas/database.schema.ts backend/drizzle/
git commit -m "feat(db): add agent notification columns, extend delivered_at_status"
```

### Task B2: Backfill migration — revoke `manage:negotiations` from personal agents

**Files:**
- Create: `backend/drizzle/0054_revoke_personal_agent_negotiations.sql`
- Modify: `backend/drizzle/meta/_journal.json`

- [ ] **Step 1: Write the migration**

```sql
-- One-time backfill: revoke manage:negotiations from all personal-agent owner
-- permission rows. The handle_negotiations column (default false) already
-- matches the new policy. See spec 2026-04-17-personal-agent-notifications-design.md.
UPDATE agent_permissions p
SET actions = array_remove(actions, 'manage:negotiations')
FROM agents a
WHERE a.id = p.agent_id
  AND a.type = 'personal'
  AND 'manage:negotiations' = ANY(p.actions);
```

- [ ] **Step 2: Journal entry**

Append the 0054 entry to `backend/drizzle/meta/_journal.json` using the same format as prior entries.

- [ ] **Step 3: Run migration**

Run: `cd backend && bun run db:migrate`
Expected: 0054 applied.

- [ ] **Step 4: Commit**

```bash
git add backend/drizzle/0054_revoke_personal_agent_negotiations.sql backend/drizzle/meta
git commit -m "feat(db): revoke manage:negotiations from personal agents (0054)"
```

---

## Phase C — Default personal-agent permission set

### Task C1: Introduce `PERSONAL_AGENT_DEFAULT_ACTIONS` and use it in `create`

**Files:**
- Modify: `backend/src/services/agent.service.ts` (around lines 20–82)
- Modify: `backend/tests/agent.service.test.ts`

- [ ] **Step 1: Write a failing test**

Open `backend/tests/agent.service.test.ts`. Add inside the existing top-level `describe('AgentService', ...)`:

```ts
it('creates a personal agent without manage:negotiations by default', async () => {
  let grantedActions: string[] = [];
  const store = createStore({
    createAgent: async (input) => createAgentRow({ ...input }),
    grantPermission: async (input) => {
      grantedActions = [...input.actions];
      return createPermissionRow({ actions: input.actions });
    },
  });
  const service = new AgentService(store, fakeTokenStore());

  await service.create(OWNER_ID, 'Fresh agent');

  expect(grantedActions).not.toContain('manage:negotiations');
  expect(grantedActions).toEqual(
    expect.arrayContaining([
      'manage:profile',
      'manage:intents',
      'manage:networks',
      'manage:contacts',
      'manage:opportunities',
    ]),
  );
});
```

If `fakeTokenStore` is not already defined in the file, use whatever token-store fake pattern the rest of the file uses (check the top of the file). If none exists, inline an object with `list: async () => []` and `revoke: async () => {}`.

- [ ] **Step 2: Run the new test to confirm failure**

Run: `cd backend && bun test tests/agent.service.test.ts --test-name-pattern "without manage:negotiations"`
Expected: FAIL. The current `create()` grants all of `AGENT_ACTIONS` including negotiations.

- [ ] **Step 3: Introduce `PERSONAL_AGENT_DEFAULT_ACTIONS` and use it**

Open `backend/src/services/agent.service.ts`. Below the existing `ORCHESTRATOR_ACTIONS` constant (around line 33–39), add:

```ts
/** Default actions granted to the owner of a newly created personal agent. */
export const PERSONAL_AGENT_DEFAULT_ACTIONS: readonly AgentAction[] = [
  'manage:profile',
  'manage:intents',
  'manage:networks',
  'manage:contacts',
  'manage:opportunities',
];
```

Then change the `grantPermission` call inside `create` (around line 68–73) from:

```ts
actions: [...AGENT_ACTIONS],
```

to:

```ts
actions: [...PERSONAL_AGENT_DEFAULT_ACTIONS],
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `cd backend && bun test tests/agent.service.test.ts --test-name-pattern "without manage:negotiations"`
Expected: PASS.

- [ ] **Step 5: Run the full agent service test file**

Run: `cd backend && bun test tests/agent.service.test.ts`
Expected: all tests pass. If any prior test asserted the full AGENT_ACTIONS set on a fresh agent, update it to assert PERSONAL_AGENT_DEFAULT_ACTIONS instead.

- [ ] **Step 6: Align the seed script**

Open `backend/src/cli/db-seed.ts`. Around line 55, `PERSONAL_AGENT_ACTIONS` is defined. Replace its value to match `PERSONAL_AGENT_DEFAULT_ACTIONS`:

```ts
const PERSONAL_AGENT_ACTIONS = [
  'manage:profile',
  'manage:intents',
  'manage:networks',
  'manage:contacts',
  'manage:opportunities',
] as const;
```

- [ ] **Step 7: Run tsc**

Run: `cd backend && bun x tsc --noEmit`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/agent.service.ts backend/tests/agent.service.test.ts backend/src/cli/db-seed.ts
git commit -m "feat(agent): drop manage:negotiations from personal agent defaults"
```

---

## Phase D — `AgentService.update` accepts three toggles; `handle_negotiations` syncs with permissions

### Task D1: Extend `AgentService.update` with three optional booleans

**Files:**
- Modify: `backend/src/adapters/agent.database.adapter.ts` (the `updateAgent` signature/impl and the row select mapping — exposes the new columns)
- Modify: `backend/src/services/agent.service.ts` (the `update` method signature, parameter validation, writes)
- Modify: `backend/tests/agent.service.test.ts`

- [ ] **Step 1: Expose the three columns in the row shape**

Open `backend/src/adapters/agent.database.adapter.ts`. Find the `AgentRow` type (Drizzle-inferred or manual). The columns are inferred automatically from the schema in Task B1, so no edit is usually needed — but confirm by grepping:

Run: `grep -n "notifyOnOpportunity\|dailySummaryEnabled\|handleNegotiations" backend/src/adapters/agent.database.adapter.ts`

If these names are missing from a manual type definition, add them. If the type is `typeof agents.$inferSelect`, Drizzle handles it automatically.

- [ ] **Step 2: Extend `updateAgent` to accept the three fields**

Open the same file. Find `updateAgent`. Its input shape is built from `Partial<...>` of agent fields. If the function accepts any column via `Partial<NewAgent>` or similar, no edit needed — the schema change propagates. If it accepts a narrower shape, widen it:

```ts
async updateAgent(
  agentId: string,
  updates: Partial<Pick<AgentRow, 'name' | 'description' | 'status' | 'notifyOnOpportunity' | 'dailySummaryEnabled' | 'handleNegotiations'>>,
): Promise<AgentRow | null> { ... }
```

- [ ] **Step 3: Write a failing test for notify/daily toggle update**

Open `backend/tests/agent.service.test.ts`. Add:

```ts
it('updates notifyOnOpportunity and dailySummaryEnabled on a personal agent', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const store = createStore({
    getAgentWithRelations: async () =>
      createAgentWithRelations({
        notifyOnOpportunity: true,
        dailySummaryEnabled: true,
        handleNegotiations: false,
      } as Partial<AgentWithRelations>),
    updateAgent: async (_agentId, patch) => {
      updates.push(patch);
      return createAgentRow({ ...patch });
    },
  });
  const service = new AgentService(store, fakeTokenStore());

  await service.update('agent-1', OWNER_ID, {
    notifyOnOpportunity: false,
    dailySummaryEnabled: false,
  });

  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({
    notifyOnOpportunity: false,
    dailySummaryEnabled: false,
  });
});
```

(If `AgentWithRelations` / `AgentRow` types don't yet include the new fields, add them to the factory helpers at the top of the test file.)

- [ ] **Step 4: Run test — expect fail**

Run: `cd backend && bun test tests/agent.service.test.ts --test-name-pattern "updates notifyOnOpportunity"`
Expected: FAIL (the update method doesn't accept those fields yet).

- [ ] **Step 5: Extend the update method**

Open `backend/src/services/agent.service.ts`. Find `async update(...)` (around line 102). Widen its `updates` param type:

```ts
async update(
  agentId: string,
  userId: string,
  updates: {
    name?: string;
    description?: string | null;
    status?: 'active' | 'inactive';
    notifyOnOpportunity?: boolean;
    dailySummaryEnabled?: boolean;
    handleNegotiations?: boolean;
  },
): Promise<AgentWithRelations> { ... }
```

Inside the body, after the existing `status` branch and before the "no changes" guard, add:

```ts
if (updates.notifyOnOpportunity !== undefined) {
  cleanUpdates.notifyOnOpportunity = updates.notifyOnOpportunity;
}
if (updates.dailySummaryEnabled !== undefined) {
  cleanUpdates.dailySummaryEnabled = updates.dailySummaryEnabled;
}
// handleNegotiations is handled in its own transactional path (Task D2).
```

Also ensure `Parameters<AgentServiceStore['updateAgent']>[1]` includes the new keys (it should, via the adapter change in Step 2).

- [ ] **Step 6: Run test — expect pass**

Run: `cd backend && bun test tests/agent.service.test.ts --test-name-pattern "updates notifyOnOpportunity"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/adapters/agent.database.adapter.ts backend/src/services/agent.service.ts backend/tests/agent.service.test.ts
git commit -m "feat(agent): accept notify/daily toggles on update"
```

### Task D2: Transactional `handle_negotiations` ↔ permission row sync

**Files:**
- Modify: `backend/src/adapters/agent.database.adapter.ts` (introduce `setHandleNegotiations` transactional helper, or expose `db` for the service to run a transaction)
- Modify: `backend/src/services/agent.service.ts`
- Modify: `backend/tests/agent.service.test.ts`

- [ ] **Step 1: Write a failing invariant test**

Add to `agent.service.test.ts`:

```ts
describe('handle_negotiations toggle', () => {
  it('adds manage:negotiations to owner permission row when flipped on', async () => {
    const grants: Array<{ actions: string[] }> = [];
    const revocations: string[] = [];
    const columnWrites: Array<Record<string, unknown>> = [];

    const store = createStore({
      getAgentWithRelations: async () =>
        createAgentWithRelations({
          ownerId: OWNER_ID,
          handleNegotiations: false,
          permissions: [
            createPermissionRow({
              actions: ['manage:intents', 'manage:opportunities'],
            }),
          ],
        } as Partial<AgentWithRelations>),
      updateAgent: async (_agentId, patch) => {
        columnWrites.push(patch);
        return createAgentRow({ ...patch });
      },
      grantPermission: async (input) => {
        grants.push({ actions: [...input.actions] });
        return createPermissionRow({ actions: input.actions });
      },
      revokePermission: async (id) => {
        revocations.push(id);
      },
    });
    const service = new AgentService(store, fakeTokenStore());

    await service.update('agent-1', OWNER_ID, { handleNegotiations: true });

    expect(columnWrites).toEqual([expect.objectContaining({ handleNegotiations: true })]);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.actions).toContain('manage:negotiations');
  });

  it('removes manage:negotiations when flipped off', async () => {
    const revocations: string[] = [];

    const store = createStore({
      getAgentWithRelations: async () =>
        createAgentWithRelations({
          ownerId: OWNER_ID,
          handleNegotiations: true,
          permissions: [
            createPermissionRow({
              id: 'perm-owner',
              actions: ['manage:intents', 'manage:negotiations'],
            }),
          ],
        } as Partial<AgentWithRelations>),
      revokePermission: async (id) => {
        revocations.push(id);
      },
    });
    const service = new AgentService(store, fakeTokenStore());

    await service.update('agent-1', OWNER_ID, { handleNegotiations: false });

    expect(revocations).toContain('perm-owner');
  });
});
```

The revoke branch requires the service to either (a) revoke the whole permission row and re-grant without the action, or (b) update the row to remove a single action. Pick (a) if `revokePermission` is the only adapter method; if an `updatePermissionActions` method exists, use it and adjust the test accordingly (assert updated actions instead of revocation).

- [ ] **Step 2: Run tests — expect fail**

Run: `cd backend && bun test tests/agent.service.test.ts --test-name-pattern "handle_negotiations"`
Expected: both FAIL.

- [ ] **Step 3: Implement the sync in the service**

In `backend/src/services/agent.service.ts`, inside `update`, after the `cleanUpdates.dailySummaryEnabled` branch and before the "no changes" guard, add:

```ts
if (updates.handleNegotiations !== undefined) {
  cleanUpdates.handleNegotiations = updates.handleNegotiations;
}

// Apply column updates first...
// (existing code continues)

// After the existing updateAgent + refresh steps, if handleNegotiations
// changed, synchronize the owner permission row.
```

This changes the method's shape: apply the column update, fetch the refreshed agent, then reconcile the permission row. Below is the complete replacement body starting from the cleanUpdates diff check:

```ts
if (Object.keys(cleanUpdates).length === 0 && updates.handleNegotiations === undefined) {
  const current = await this.db.getAgentWithRelations(agentId);
  if (!current) throw new Error('Agent not found');
  return this.sanitizeAgent(current);
}

if (Object.keys(cleanUpdates).length > 0) {
  const updated = await this.db.updateAgent(agentId, cleanUpdates);
  if (!updated) throw new Error('Agent not found');
}

if (updates.handleNegotiations !== undefined) {
  await this.reconcileNegotiationsPermission(agent, updates.handleNegotiations);
}

const refreshed = await this.db.getAgentWithRelations(agentId);
if (!refreshed) throw new Error('Agent not found');
return this.sanitizeAgent(refreshed);
```

Then add the private helper on the same class:

```ts
private async reconcileNegotiationsPermission(
  agent: AgentWithRelations,
  enabled: boolean,
): Promise<void> {
  const ownerPerm = agent.permissions.find(
    (p) => p.userId === agent.ownerId && p.scope === 'global',
  );

  if (enabled) {
    if (ownerPerm?.actions.includes('manage:negotiations')) return;
    const nextActions = [
      ...(ownerPerm?.actions ?? []),
      'manage:negotiations',
    ];
    if (ownerPerm) {
      await this.db.revokePermission(ownerPerm.id);
    }
    await this.db.grantPermission({
      agentId: agent.id,
      userId: agent.ownerId,
      scope: 'global',
      actions: nextActions,
    });
  } else {
    if (!ownerPerm?.actions.includes('manage:negotiations')) return;
    await this.db.revokePermission(ownerPerm.id);
    const remaining = ownerPerm.actions.filter((a) => a !== 'manage:negotiations');
    if (remaining.length > 0) {
      await this.db.grantPermission({
        agentId: agent.id,
        userId: agent.ownerId,
        scope: 'global',
        actions: remaining,
      });
    }
  }
}
```

(If the `grantPermission` adapter tolerates merging with existing rows rather than overwriting, use that instead — but the two-step revoke-then-grant is safe regardless of adapter semantics.)

Note: the helper receives `agent` (with relations) before the column update. Fetch it at the top of `update` if not already in scope. If the method doesn't have the full relations loaded before `updateAgent`, add `const agent = await this.requireOwnedAgent(agentId, userId);` — `requireOwnedAgent` should return the relations shape; if it returns only `AgentRow`, replace it with the existing `requireOwnedAgentWithRelations` used by `removeTransport`.

- [ ] **Step 4: Ideally make the reconcile transactional**

If the `AgentServiceStore` adapter exposes a `withTransaction(cb)` method, wrap the `updateAgent` + `reconcileNegotiationsPermission` pair in it. If it doesn't, accept the two-step write and note it in code:

```ts
// NOTE: column + permission-row writes are not atomic in this adapter.
// On partial failure, a follow-up update flips both again and converges.
```

This is a pragmatic trade-off — atomicity is nice, but the column is advisory UI state; the permission row is authoritative. A stuck "column says true, row says no action" state is self-healing when the user toggles again.

- [ ] **Step 5: Run tests — expect pass**

Run: `cd backend && bun test tests/agent.service.test.ts --test-name-pattern "handle_negotiations"`
Expected: both PASS.

- [ ] **Step 6: Run the full agent service test file**

Run: `cd backend && bun test tests/agent.service.test.ts`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/agent.service.ts backend/tests/agent.service.test.ts backend/src/adapters/agent.database.adapter.ts
git commit -m "feat(agent): sync handle_negotiations column with permission row"
```

---

## Phase E — API controller accepts the three fields

### Task E1: `PATCH /agents/:id` accepts `notifyOnOpportunity`, `dailySummaryEnabled`, `handleNegotiations`

**Files:**
- Modify: `backend/src/controllers/agent.controller.ts`
- Modify: `backend/tests/agent.service.test.ts` (or a new `agent.controller.test.ts` — check if one exists)

- [ ] **Step 1: Find the PATCH route handler**

Run: `grep -n "@Patch\|updateAgent\|this.agentService.update" backend/src/controllers/agent.controller.ts`

- [ ] **Step 2: Inspect the request-body Zod schema**

The handler validates `req.body` through a Zod schema. Extend it to include:

```ts
const updateAgentBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  notifyOnOpportunity: z.boolean().optional(),
  dailySummaryEnabled: z.boolean().optional(),
  handleNegotiations: z.boolean().optional(),
});
```

(Merge into the existing schema — match the file's actual variable name.)

- [ ] **Step 3: Pass through to the service**

Confirm the handler already spreads the validated body into `service.update(agentId, userId, body)`. If it whitelists fields individually, add the three new ones.

- [ ] **Step 4: Ensure `sanitizeAgent` returns the new fields**

Open `backend/src/services/agent.service.ts`. Find `sanitizeAgent`. It likely destructures the agent and re-assembles a response shape. Add the three new fields to the return object (they're safe to expose). Example:

```ts
private sanitizeAgent(agent: AgentWithRelations, viewerId?: string): AgentWithRelations {
  return {
    ...agent,
    notifyOnOpportunity: agent.notifyOnOpportunity,
    dailySummaryEnabled: agent.dailySummaryEnabled,
    handleNegotiations: agent.handleNegotiations,
    // (existing transports/permissions filtering stays)
  };
}
```

If `...agent` already spreads everything, Drizzle will include the new columns automatically — in that case no change is needed. Just verify with a test.

- [ ] **Step 5: Write a controller-level test**

If `backend/tests/agent.controller.test.ts` doesn't exist, add this test to `agent.service.test.ts` as a service-level assertion that `GET` / `update` returns include the new fields:

```ts
it('sanitizeAgent exposes the three notification toggle fields', async () => {
  const store = createStore({
    getAgentWithRelations: async () =>
      createAgentWithRelations({
        notifyOnOpportunity: false,
        dailySummaryEnabled: false,
        handleNegotiations: true,
      } as Partial<AgentWithRelations>),
  });
  const service = new AgentService(store, fakeTokenStore());

  const result = await service.getById('agent-1', OWNER_ID);

  expect(result.notifyOnOpportunity).toBe(false);
  expect(result.dailySummaryEnabled).toBe(false);
  expect(result.handleNegotiations).toBe(true);
});
```

- [ ] **Step 6: Run test — expect pass**

Run: `cd backend && bun test tests/agent.service.test.ts --test-name-pattern "sanitizeAgent exposes"`
Expected: PASS. If it fails, explicitly add the fields to the return object as shown above.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/agent.controller.ts backend/src/services/agent.service.ts backend/tests/agent.service.test.ts
git commit -m "feat(api): accept notification toggles on PATCH /agents/:id"
```

---

## Phase F — Opportunity pickup widening and draft filter

### Task F1: Rewrite `OpportunityDeliveryService.pickupPending` predicate

**Files:**
- Modify: `backend/src/services/opportunity-delivery.service.ts`
- Modify or create: `backend/src/services/tests/opportunity-delivery.spec.ts`

- [ ] **Step 1: Write a failing test for pending behavior unchanged**

Check if a test file exists:

Run: `ls backend/src/services/tests/opportunity-delivery.spec.ts 2>/dev/null`

If not, create one. Reuse the harness patterns from `backend/src/services/tests/*.spec.ts`. The test requires a live PostgreSQL connection via the integration test setup — if the rest of the suite uses an in-memory DB, write these as integration tests.

Minimum test cases:

```ts
describe('OpportunityDeliveryService.pickupPending', () => {
  it('returns a pending opportunity when the agent owner is an actor and toggle is on', async () => {
    // Arrange: insert a pending opp with the user as actor; agent.notify_on_opportunity = true.
    // Act: pickupPending(agentId).
    // Assert: returns opportunityId matching inserted row.
  });

  it('returns null when agent.notify_on_opportunity = false', async () => {
    // Same setup, agent.notify_on_opportunity = false.
    // Act + assert: returns null.
  });

  it('returns a draft opportunity to an actor who is NOT the initiator', async () => {
    // Insert orchestrator-path draft opp with detection.createdBy = userA, actors include userA and userB.
    // Act: pickup for userB's agent → returns the opp.
    // Act: pickup for userA's agent → returns null.
  });

  it('ignores draft opportunities with null detection.createdBy by throwing', async () => {
    // Insert a draft opp with actors but detection missing createdBy.
    // Act: pickupPending for any actor's agent.
    // Assert: throws 'orchestrator_opp_missing_creator'.
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `cd backend && bun test src/services/tests/opportunity-delivery.spec.ts`
Expected: all new tests FAIL.

- [ ] **Step 3: Rewrite the SQL in `pickupPending`**

Open `backend/src/services/opportunity-delivery.service.ts`. The `pickupPending` method runs a raw SQL query (lines ~86–104). Replace it with:

```ts
const result = await db.execute(sql`
  SELECT o.id, o.actors, o.status, o.interpretation, o.detection
  FROM opportunities o
  WHERE o.status IN ('pending', 'draft')
    AND o.actors::jsonb @> ${JSON.stringify([{ userId }])}::jsonb
    AND (
      o.status = 'pending'
      OR (o.detection->>'createdBy') IS DISTINCT FROM ${userId}
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
        AND d.delivered_at_status::text = o.status::text
        AND (
          d.delivered_at IS NOT NULL
          OR (d.reserved_at IS NOT NULL AND d.reserved_at >= ${ttlCutoff.toISOString()})
        )
    )
  ORDER BY o.updated_at ASC
  LIMIT 20
`);
```

- [ ] **Step 4: Update the reservation `deliveredAtStatus`**

In the same method, the reservation insert currently hardcodes `deliveredAtStatus: 'pending'`. Change to `deliveredAtStatus: chosen.status`:

```ts
await db.insert(opportunityDeliveries).values({
  opportunityId: chosen.id,
  userId,
  agentId,
  channel: CHANNEL,
  trigger: TRIGGER_PENDING,
  deliveredAtStatus: chosen.status as 'pending' | 'draft',
  reservationToken,
  reservedAt,
});
```

- [ ] **Step 5: Add the `detection.createdBy` null-guard assertion**

In the JS filter loop (the `.filter(...)` after `result`), add — before the `canUserSeeOpportunity` check:

```ts
if (row.status === 'draft') {
  const detection = (row as { detection?: { createdBy?: string } }).detection;
  if (!detection?.createdBy) {
    throw new Error('orchestrator_opp_missing_creator');
  }
}
```

This also requires selecting `detection` in the query (already done in Step 3).

- [ ] **Step 6: Run tests — expect pass**

Run: `cd backend && bun test src/services/tests/opportunity-delivery.spec.ts`
Expected: all new tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/opportunity-delivery.service.ts backend/src/services/tests/opportunity-delivery.spec.ts
git commit -m "feat(opportunity): include draft opps in pickup, exclude initiator"
```

---

## Phase G — Frontend: ALPHA badge + Notifications section

### Task G1: ALPHA badge component

**Files:**
- Create: `frontend/src/components/AlphaBadge.tsx`

- [ ] **Step 1: Write the component**

```tsx
export function AlphaBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
      ALPHA
    </span>
  );
}
```

(If the project uses a shared Tailwind theme or Radix UI styling primitives elsewhere, match that file's style conventions. Check one existing small component — e.g. a badge in `frontend/src/components/` — for the canonical pattern.)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/AlphaBadge.tsx
git commit -m "feat(frontend): add AlphaBadge component"
```

### Task G2: Extend the frontend agents client type

**Files:**
- Modify: `frontend/src/services/agents.ts`

- [ ] **Step 1: Locate the `Agent` type**

Run: `grep -n "export type Agent\|export interface Agent" frontend/src/services/agents.ts`

- [ ] **Step 2: Add the three fields**

Inside the `Agent` shape, add:

```ts
notifyOnOpportunity: boolean;
dailySummaryEnabled: boolean;
handleNegotiations: boolean;
```

- [ ] **Step 3: Add (or extend) the `updateAgent` client method's request shape**

If the function is typed like `updateAgent(id: string, body: Partial<Pick<Agent, 'name' | 'description' | 'status'>>)`, widen the pick:

```ts
Partial<Pick<Agent, 'name' | 'description' | 'status' | 'notifyOnOpportunity' | 'dailySummaryEnabled' | 'handleNegotiations'>>
```

- [ ] **Step 4: Remove webhook references from this file**

Run: `grep -n -i webhook frontend/src/services/agents.ts`
For each hit, delete or rewrite (this is the agent client, not Telegram).

- [ ] **Step 5: Run frontend tsc**

Run: `cd frontend && bun x tsc --noEmit`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/agents.ts
git commit -m "feat(frontend): expose notification toggle fields on Agent"
```

### Task G3: Add Notifications section to agent detail page

**Files:**
- Modify: `frontend/src/app/agents/[id]/page.tsx`

- [ ] **Step 1: Locate the page component and existing layout**

Run: `grep -n "type === 'personal'\|AgentDetail\|function.*Page" frontend/src/app/agents/[id]/page.tsx`

Read the component top-down to find a natural insertion point (usually below the "name/description" and "transports" sections).

- [ ] **Step 2: Add a `<NotificationsSection />` local component**

Paste inside the file (above the default export or as a sibling component):

```tsx
import { AlphaBadge } from '../../../components/AlphaBadge';

function NotificationsSection({
  agent,
  onChange,
  disabled,
}: {
  agent: Agent;
  onChange: (patch: Partial<Pick<Agent, 'notifyOnOpportunity' | 'dailySummaryEnabled' | 'handleNegotiations'>>) => void;
  disabled: boolean;
}) {
  if (agent.type !== 'personal') return null;

  return (
    <section className="mt-6 space-y-4">
      <h2 className="text-sm font-semibold">Notifications</h2>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={agent.notifyOnOpportunity}
          disabled={disabled}
          onChange={(e) => onChange({ notifyOnOpportunity: e.target.checked })}
        />
        <span>
          <span className="block font-medium">Notify me about new opportunities</span>
          <span className="block text-xs text-neutral-500">
            Only applies when your agent is polling via OpenClaw.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={agent.dailySummaryEnabled}
          disabled={disabled}
          onChange={(e) => onChange({ dailySummaryEnabled: e.target.checked })}
        />
        <span>
          <span className="block font-medium">Send a daily summary</span>
          <span className="block text-xs text-neutral-500">
            Once per 24 hours, through the same OpenClaw channel.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={agent.handleNegotiations}
          disabled={disabled}
          onChange={(e) => onChange({ handleNegotiations: e.target.checked })}
        />
        <span>
          <span className="flex items-center gap-2 font-medium">
            Handle negotiations on my behalf
            <AlphaBadge />
          </span>
          <span className="block text-xs text-neutral-500">
            Experimental — your personal agent will respond to negotiation turns through the OpenClaw pickup loop.
          </span>
        </span>
      </label>
    </section>
  );
}
```

- [ ] **Step 3: Wire it into the page**

Find where the page renders the agent's transports/permissions and render `<NotificationsSection agent={agent} onChange={handlePatch} disabled={isSaving} />` after that block. `handlePatch` should call the existing `updateAgent(agentId, patch)` client method and refresh local state.

If the page doesn't already have a save-on-change pattern, the simplest shape is:

```tsx
async function handlePatch(
  patch: Partial<Pick<Agent, 'notifyOnOpportunity' | 'dailySummaryEnabled' | 'handleNegotiations'>>,
) {
  setIsSaving(true);
  try {
    const updated = await updateAgent(agent.id, patch);
    setAgent(updated);
  } finally {
    setIsSaving(false);
  }
}
```

- [ ] **Step 4: Verify in the browser**

Run: `cd frontend && bun run dev` (ensure the backend is also running).
Navigate to `/agents/<id>` for a personal agent. Verify:
- Three toggles render, reflecting the current DB state.
- Toggling any sends `PATCH /api/agents/:id` and the new state persists on refresh.
- The ALPHA badge renders next to "Handle negotiations on my behalf".
- The section does **not** render for system agents (open one to confirm).

Take a screenshot and attach to the PR later.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/agents/[id]/page.tsx
git commit -m "feat(frontend): add Notifications section with three toggles"
```

---

## Phase H — OpenClaw skill template scaffold

### Task H1: Add a TODO stub for `daily_summary` rendering

**Files:**
- Modify: `packages/protocol/skills/openclaw/SKILL.md.template`

- [ ] **Step 1: Add a new section before Handoff**

Open the template. Just above the `## Handoff` section, insert:

```markdown
## Daily summary payloads (deferred)

<!-- TODO(#IND-daily-summary): When the daily-summary worker ships, the
opportunity pickup endpoint may return `{ kind: 'daily_summary', payload: { count, items, windowStart, windowEnd } }`.
Render it to the user as "Since yesterday, N opportunities surfaced for you:" followed by the items.
No behavior change until the worker lands. -->
```

- [ ] **Step 2: Rebuild skills**

Run: `bun run scripts/build-skills.ts`
Expected: `packages/openclaw-plugin/skills/index-network/SKILL.md` regenerated with the new section.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/skills/openclaw/SKILL.md.template packages/openclaw-plugin/skills/index-network/SKILL.md
git commit -m "docs(skills): add daily_summary render scaffold"
```

---

## Phase I — Final verification

### Task I1: Full backend type-check and focused test pass

- [ ] **Step 1: Backend tsc**

Run: `cd backend && bun x tsc --noEmit`
Expected: exits 0.

- [ ] **Step 2: Protocol tsc**

Run: `cd packages/protocol && bun x tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Frontend tsc**

Run: `cd frontend && bun x tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Targeted test runs**

Run:
```bash
cd backend
bun test tests/agent.service.test.ts
bun test src/services/tests/opportunity-delivery.spec.ts
```
Expected: all pass.

- [ ] **Step 5: Lint**

Run: `cd backend && bun run lint`
Run: `cd frontend && bun run lint`
Expected: both exit 0.

### Task I2: Delete the consumed spec and plan after merge

Per CLAUDE.md `Finishing a Branch` step 2 ("Delete any related superpowers plans/specs"), defer this until the PR is approved and merged.

---

## Execution notes

- **Do not batch migrations.** Each migration in its own commit keeps `bun run db:migrate` recoverable mid-sequence.
- **Do not delete the Telegram inbound controller.** Confirm any file you're about to delete is under `agent_transports` / `add_webhook_transport` surface area, not `backend/src/controllers/webhooks.controller.ts` or `backend/src/gateways/telegram.gateway.ts`.
- **Daily summary worker is out of scope for this plan.** The column and toggle ship; the BullMQ job does not. A follow-up plan will land after IND-233 clarifies status semantics.
- **Always run `bun x tsc --noEmit`** after any `bun test` pass, per the memory note about type errors slipping through `bun test`.
