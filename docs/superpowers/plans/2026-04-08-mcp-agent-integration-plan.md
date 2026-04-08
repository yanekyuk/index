# MCP Agent Integration -- Implementation Plan

**Spec:** `docs/superpowers/specs/2026-04-08-mcp-agent-integration-design.md`
**Date:** 2026-04-08

## Phases

Five phases. Phases 1, 2, and 5 are independent and can be parallelized. Phase 3 depends on Phase 2. Phase 4 depends on Phases 2 and 3.

```
Phase 1 (Rich Descriptions) ─────────────────────────────────┐
                                                              ├─→ Done
Phase 2 (Webhooks) ───→ Phase 3 (Negotiation Tools) ─────────┤
                   └──→ Phase 4 (Graph Yield/Resume) ─────────┘

Phase 5 (API Key Frontend) ── independent ───────────────────→ Done
```

---

## Phase 1: Rich Tool Descriptions & Enhanced `read_docs`

**Goal:** Make all MCP tools self-explanatory for external agents.
**Dependencies:** None
**Branch:** `feat/mcp-rich-descriptions`
**Files modified:** 8

### Tasks

#### 1.1 Rewrite intent tool descriptions
**File:** `packages/protocol/src/intent/intent.tools.ts`

Update the `description` field for all 7 tools defined via `defineTool()`. Each description must include:
- Domain explanation (what an intent is, how it fits in the system)
- Parameter guidance (what values are expected)
- Return value documentation
- Workflow context (what happens after)

Tools to update (line numbers from current file):
- `read_intents` (line 40)
- `create_intent` (line 140)
- `update_intent` (line 260)
- `delete_intent` (line 321)
- `create_intent_index` (line 373)
- `read_intent_indexes` (line 423)
- `delete_intent_index` (line 492)

Also update each parameter's `.describe()` string to be more explicit.

#### 1.2 Rewrite profile tool descriptions
**File:** `packages/protocol/src/profile/profile.tools.ts`

Same pattern for 4 tools:
- `read_user_profiles` (line 37)
- `create_user_profile` (line 238)
- `update_user_profile` (line 473)
- `complete_onboarding` (line 529)

#### 1.3 Rewrite network tool descriptions
**File:** `packages/protocol/src/network/network.tools.ts`

Same pattern for 7 tools:
- `read_networks` (line 11)
- `read_network_memberships` (line 56)
- `update_network` (line 263)
- `create_network` (line 302)
- `delete_network` (line 348)
- `create_network_membership` (line 385)
- `delete_network_membership` (line 433)

#### 1.4 Rewrite opportunity tool descriptions
**File:** `packages/protocol/src/opportunity/opportunity.tools.ts`

Same pattern for 3 tools:
- `create_opportunities` (line 139)
- `list_opportunities` (line 739)
- `update_opportunity` (line 958)

#### 1.5 Rewrite contact tool descriptions
**File:** `packages/protocol/src/contact/contact.tools.ts`

Same pattern for 4 tools:
- `import_contacts` (line 12)
- `list_contacts` (line 45)
- `add_contact` (line 78)
- `remove_contact` (line 105)

#### 1.6 Rewrite integration + utility tool descriptions
**Files:** `packages/protocol/src/integration/integration.tools.ts`, `packages/protocol/src/shared/agent/utility.tools.ts`

- `import_gmail_contacts` (integration.tools.ts line 22)
- `scrape_url` (utility.tools.ts line 8)
- `read_docs` (utility.tools.ts line 41)

#### 1.7 Enhance `read_docs` content
**File:** `packages/protocol/src/shared/agent/utility.tools.ts`

Replace the `sections` Record in the `read_docs` handler with comprehensive domain documentation structured for agent consumption. Must cover:

- **Core concepts:** Intents, Indexes, Opportunities, Negotiations, Contacts, Profiles -- what each is and how they relate
- **Entity relationships:** Intents belong to users, link to indexes via intent_networks with relevancy scores, generate opportunities
- **Discovery workflow:** Create intents -> auto-index -> semantic match -> negotiate -> connect
- **Negotiation workflow:** Webhook registration -> turn notifications -> respond via tool -> timeout fallback to AI
- **Authentication:** API key via header, how to get one
- **Tool workflow guidance:** Which tools to call in what order for common tasks

Support the existing `topic` parameter for filtering to a specific section.

### Verification

```bash
cd backend
bun test tests/mcp.test.ts          # Tool count still 28
```

Manual: connect via MCP client, call `read_docs`, verify output is comprehensive and actionable.

---

## Phase 2: Webhook Infrastructure (IND-223)

**Goal:** Domain-agnostic webhook delivery system.
**Dependencies:** None
**Branch:** `feat/webhooks`
**Files new:** 7, **Files modified:** 3

### Tasks

#### 2.1 Add webhooks table schema
**File:** `backend/src/schemas/database.schema.ts`

Add after the last table definition (around line 465):

```ts
export const webhooks = pgTable('webhooks', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: text('events').array().notNull(),
  active: boolean('active').notNull().default(true),
  description: text('description'),
  failureCount: integer('failure_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Add index on `userId`. Add type exports.

#### 2.2 Generate and rename migration

```bash
cd backend
bun run db:generate
# Rename generated file to NNNN_add_webhooks_table.sql
# Update tag in drizzle/meta/_journal.json
bun run db:migrate
bun run db:generate  # Verify "No schema changes"
```

#### 2.3 Create event registry
**File (new):** `backend/src/lib/webhook-events.ts`

```ts
export const WEBHOOK_EVENTS = [
  'opportunity.created',
  'opportunity.accepted',
  'opportunity.rejected',
  'negotiation.started',
  'negotiation.turn_received',
  'negotiation.completed',
] as const;

export type WebhookEvent = typeof WEBHOOK_EVENTS[number];
```

#### 2.4 Create WebhookService
**File (new):** `backend/src/services/webhook.service.ts`

Follow `backend/src/services/service.template.md`. Methods:

- `create(userId, url, events, description?)` -- validate events against `WEBHOOK_EVENTS`, validate URL (HTTPS in prod), generate HMAC secret via `crypto.randomBytes(32).toString('hex')`, insert row, return `{ id, secret }`
- `list(userId)` -- return webhooks with `secret` masked to last 4 chars
- `delete(userId, webhookId)` -- verify owner, delete
- `getById(webhookId)` -- for queue worker
- `findByUserAndEvent(userId, event)` -- lookup active webhooks where `events` array contains the event
- `recordSuccess(webhookId)` -- set `failureCount = 0`, update `updatedAt`
- `recordFailure(webhookId)` -- increment `failureCount`, if >= 10 set `active = false`
- `test(userId, webhookId)` -- lookup, build test envelope, enqueue delivery

Import database adapter. No cross-service imports.

#### 2.5 Create WebhookQueue
**File (new):** `backend/src/queues/webhook.queue.ts`

Follow `backend/src/queues/queue.template.md`. Queue name: `webhook-delivery`.

Job data:
```ts
{ webhookId: string; url: string; secret: string; event: string; payload: Record<string, unknown>; timestamp: string }
```

Worker logic:
1. Serialize payload as JSON string (stable for signing)
2. Compute HMAC-SHA256 of the body using `secret`
3. POST to `url` with body, headers: `Content-Type: application/json`, `X-Index-Signature: sha256=<hex>`
4. Timeout: 5 seconds
5. On 2xx: call `webhookService.recordSuccess(webhookId)`
6. On non-2xx or timeout: throw (BullMQ retries with exponential backoff)

BullMQ config: 3 retries, exponential backoff, completed jobs removed after 1h.

Add `recordFailure` call in the BullMQ `failed` event handler (after all retries exhausted).

#### 2.6 Create WebhookController
**File (new):** `backend/src/controllers/webhook.controller.ts`

Follow `backend/src/controllers/controller.template.md`. Routes under `@Controller('/webhooks')`:

- `GET /events` -- return `WEBHOOK_EVENTS` array
- `POST /` -- `@UseGuards(AuthGuard)`, validate body `{ url, events, description? }`, call `webhookService.create()`, return `{ id, secret }` (201)
- `GET /` -- `@UseGuards(AuthGuard)`, call `webhookService.list(userId)`, return array
- `DELETE /:id` -- `@UseGuards(AuthGuard)`, call `webhookService.delete(userId, id)`, return 204
- `POST /:id/test` -- `@UseGuards(AuthGuard)`, call `webhookService.test(userId, id)`, return result

#### 2.7 Create webhook MCP tools
**File (new):** `packages/protocol/src/webhook/webhook.tools.ts`

Create `createWebhookTools(defineTool, deps)` factory with 5 tools:

- `register_webhook` -- calls webhook service via a new `WebhookAdapter` interface in protocol deps
- `list_webhooks` -- same
- `delete_webhook` -- same
- `test_webhook` -- same
- `list_webhook_events` -- returns the event registry (can be hardcoded or via adapter)

Rich descriptions following Phase 1 patterns.

**Interface (new):** Add `WebhookAdapter` to `packages/protocol/src/shared/interfaces/`:
```ts
interface WebhookAdapter {
  create(userId, url, events, description?): Promise<{ id: string; secret: string }>;
  list(userId): Promise<WebhookInfo[]>;
  delete(userId, webhookId): Promise<void>;
  test(userId, webhookId): Promise<{ success: boolean }>;
  listEvents(): string[];
}
```

**Register tools:** Add `createWebhookTools(dt, deps)` call in both `tool.registry.ts` (line ~71) and `tool.factory.ts` (line ~179).

**Wire adapter:** In `backend/src/protocol-init.ts`, add `webhook: webhookService` to `ProtocolDeps`.

#### 2.8 Wire webhook delivery to opportunity events
**File modified:** `backend/src/main.ts`

- Import and start `WebhookQueue` worker
- Register `WebhookController`
- Subscribe to `OpportunityServiceEvents.on('created')`:
  - For each actor userId on the opportunity, call `webhookService.findByUserAndEvent(userId, 'opportunity.created')`
  - For each matching webhook, enqueue delivery job in `WebhookQueue`

### Verification

```bash
cd backend
bun run db:generate                     # "No schema changes"
bun test tests/webhook.test.ts          # New test file
bun test tests/mcp.test.ts              # Tool count now 33 (28 + 5 webhook tools)
```

---

## Phase 3: Negotiation MCP Tools

**Goal:** Expose negotiation state to external agents via MCP tools.
**Dependencies:** Phase 2 (webhook infrastructure needed for event wiring)
**Branch:** `feat/mcp-negotiation-tools`
**Files new:** 2, **Files modified:** 4

### Tasks

#### 3.1 Create negotiation tools
**File (new):** `packages/protocol/src/negotiation/negotiation.tools.ts`

Create `createNegotiationTools(defineTool, deps)` factory with 3 tools:

**`list_negotiations`:**
- Schema: `{ status?: 'active' | 'waiting_for_external' | 'completed' | 'all' }`
- Handler: query negotiations via `NegotiationDatabase` where user is source or candidate. Return: id, counterparty name, turn count, current status, whose turn, latest message preview, deadline if waiting.
- Rich description explaining what negotiations are, when they happen, and what the statuses mean.

**`get_negotiation`:**
- Schema: `{ negotiationId: string }`
- Handler: load full negotiation -- all turns with messages and actions, counterparty profile summary, shared indexes, intent context, current state, whether it's the user's turn.
- Access control: user must be a party to the negotiation.

**`respond_to_negotiation`:**
- Schema: `{ negotiationId: string, action: 'accept' | 'reject' | 'counter', message?: string }`
- Handler: validate negotiation is `waiting_for_external`, validate it's the user's turn, validate `counter` has a message. Append response as a turn. This tool only persists the response -- the resume logic (Phase 4) handles continuing the graph.
- Rich description explaining the turn-based model, valid actions, and what happens after.

#### 3.2 Create NegotiationEvents emitter
**File (new):** `backend/src/events/negotiation.event.ts`

Follow pattern from `intent.event.ts`:

```ts
export const NegotiationEvents = {
  onStarted: null as ((data: { negotiationId, counterpartyId, ... }) => void) | null,
  onTurnReceived: null as ((data: { negotiationId, turnNumber, ... }) => void) | null,
  onCompleted: null as ((data: { negotiationId, outcome, ... }) => void) | null,
};
```

#### 3.3 Add `waiting_for_external` status
**File modified:** `packages/protocol/src/negotiation/negotiation.state.ts`

Add `waiting_for_external` to the negotiation state. This may be a new field on the LangGraph state annotation or an extension of the existing state tracking. The status indicates the graph has yielded and is waiting for an external response or timeout.

#### 3.4 Register negotiation tools
**Files modified:** `packages/protocol/src/shared/agent/tool.factory.ts`, `packages/protocol/src/shared/agent/tool.registry.ts`

Add `createNegotiationTools(dt, deps)` call in both files alongside the other domain tool registrations.

#### 3.5 Wire negotiation events to webhooks
**File modified:** `backend/src/main.ts`

Subscribe to `NegotiationEvents`:
- `onStarted` -> find webhooks for `negotiation.started`, enqueue delivery
- `onTurnReceived` -> find webhooks for `negotiation.turn_received`, enqueue delivery
- `onCompleted` -> find webhooks for `negotiation.completed`, enqueue delivery

### Verification

```bash
cd backend
bun test tests/mcp.test.ts              # Tool count now 36 (33 + 3 negotiation tools)
```

Write `packages/protocol/src/negotiation/tests/negotiation.tools.test.ts`:
- Test list/get/respond operations
- Test access control (user must be party)
- Test turn order validation
- Test `counter` requires message

---

## Phase 4: Negotiation Graph Yield/Resume

**Goal:** Allow the negotiation graph to pause for external agents and resume on response or timeout.
**Dependencies:** Phases 2 and 3
**Branch:** `feat/mcp-negotiation-yield`
**Files new:** 1, **Files modified:** 3

### Tasks

#### 4.1 Add WebhookLookup to negotiation deps

The negotiation graph needs to check if a user has webhooks. Add a `WebhookLookup` interface:

```ts
interface WebhookLookup {
  hasWebhookForEvent(userId: string, event: string): Promise<boolean>;
}
```

Add to `NegotiationGraphFactory` constructor deps. Wire in `protocol-init.ts` using `webhookService.findByUserAndEvent`.

#### 4.2 Modify turn node to yield for external agents
**File modified:** `packages/protocol/src/negotiation/negotiation.graph.ts`

In the `turnNode` (line 58), before invoking the AI agent:

```
1. Determine active party userId (source or candidate based on currentSpeaker)
2. Check webhookLookup.hasWebhookForEvent(activePartyUserId, 'negotiation.turn_received')
3. If YES:
   a. Set state to waiting_for_external
   b. Persist current state via database
   c. Emit NegotiationEvents.onTurnReceived (which triggers webhook delivery via main.ts wiring)
   d. Return state without continuing (graph yields)
4. If NO:
   a. Run AI agent as today (existing code)
```

The graph topology stays the same. The `turnNode` just returns early in the yield case.

#### 4.3 Implement resume logic in respond_to_negotiation handler
**File modified:** `packages/protocol/src/negotiation/negotiation.tools.ts`

Enhance the `respond_to_negotiation` handler (from Phase 3):

1. Load negotiation, verify `waiting_for_external` status
2. Validate turn order and action
3. Build a `NegotiationTurn` from the response
4. Persist as a message via `NegotiationDatabase.createMessage`
5. Cancel the timeout job (via a new `TimeoutAdapter` or direct BullMQ job removal)
6. Run the evaluate logic inline:
   - If `accept` or `reject`: finalize, emit `NegotiationEvents.onCompleted`
   - If `counter` and under max turns: check if counterparty has webhook, yield or run AI
   - If max turns reached: finalize with timeout outcome
7. Return updated negotiation state

#### 4.4 Create negotiation timeout queue
**File (new):** `backend/src/queues/negotiation-timeout.queue.ts`

BullMQ queue named `negotiation-timeout`. Jobs are **delayed** (default 24h).

Job data: `{ negotiationId: string, turnNumber: number }`

Worker logic:
1. Load negotiation state
2. If status is still `waiting_for_external` and turnNumber matches current:
   - Run AI agent for that turn (same logic as current turn node)
   - Continue graph (evaluate -> next turn or finalize)
3. If status changed (already responded): no-op

Wire in `main.ts`: start worker, and in the yield path (via event or direct call), enqueue a delayed job.

#### 4.5 Wire timeout cancellation

When `respond_to_negotiation` is called successfully, cancel the pending delayed job. This requires storing the BullMQ job ID in the negotiation state or a lookup table.

Options:
- Store `timeoutJobId` on the negotiation record
- Use a Redis key `negotiation-timeout:{negotiationId}` with the job ID

### Verification

Write integration tests in `backend/tests/negotiation-mcp.test.ts`:

1. **External responder:** Create negotiation, verify it yields, call `respond_to_negotiation`, verify it continues
2. **Timeout fallback:** Create negotiation, verify it yields, wait for timeout (use short timeout in test), verify AI handles turn
3. **Mixed mode:** One party with webhook (yields), other without (AI), verify full negotiation completes
4. **Both external:** Both parties have webhooks, verify alternating yield/respond flow
5. **Existing fully-AI mode:** No webhooks, verify negotiation runs as before with no regressions

```bash
cd backend
bun test tests/negotiation-mcp.test.ts
```

---

## Phase 5: API Key Management Frontend

**Goal:** Let users create and manage API keys from the web UI.
**Dependencies:** None (Better Auth backend already exists)
**Branch:** `feat/api-key-management`
**Files new:** 3, **Files modified:** 1

### Tasks

#### 5.1 Create API key service
**File (new):** `frontend/src/services/api-key.service.ts`

Typed fetch wrappers calling Better Auth endpoints:

```ts
export async function createApiKey(name: string): Promise<{ key: string; id: string }>;
export async function listApiKeys(): Promise<ApiKeyInfo[]>;
export async function deleteApiKey(id: string): Promise<void>;
```

Follow existing patterns in `frontend/src/services/`.

#### 5.2 Create API Keys UI component
**File (new):** `frontend/src/app/settings/api-keys.tsx`

Note: `frontend/src/app/settings/` does not exist yet -- create the directory.

Component renders:
- **Key list:** Table with columns: Name, Created, Last Used, Key (masked, e.g. `idx_...a1b2`), Actions (delete button)
- **Create flow:** Button opens dialog/inline form with name input. On submit, show the full key once with copy-to-clipboard button and warning that it won't be shown again.
- **Delete flow:** Confirmation dialog before revoking.
- **Setup instructions:** Collapsible section with MCP config snippets:

```json
// Claude Code / OpenCode
{
  "index-network": {
    "type": "http",
    "url": "https://protocol.index.network/mcp",
    "headers": { "Authorization": "Bearer <your-api-key>" }
  }
}
```

```yaml
# Hermes Agent (cli-config.yaml)
mcp_servers:
  - name: index-network
    url: https://protocol.index.network/mcp
    headers:
      Authorization: "Bearer <your-api-key>"
```

Use existing UI component library (Radix UI, Tailwind).

#### 5.3 Add settings page/route
**File (new):** `frontend/src/app/settings/page.tsx`

Create a Settings page with the API Keys section. Add route in the app's routing configuration. Add navigation link to settings (likely in profile menu or sidebar).

### Verification

Manual testing:
1. Navigate to Settings > API Keys
2. Create a key, copy it
3. Verify it appears in the list (masked)
4. Use the key in an MCP client config, verify auth works
5. Delete the key, verify MCP auth fails
6. Verify existing pages are unaffected

---

## Review Checkpoints

| After | Verify |
|---|---|
| Phase 1 | Descriptions read well, `read_docs` is comprehensive, no tool behavior changes, MCP test passes with 28 tools |
| Phase 2 | Webhook CRUD works, delivery + signing works, auto-disable works, MCP test passes with 33 tools |
| Phase 3 | Negotiation tools work in isolation, access control correct, MCP test passes with 36 tools |
| Phase 4 | Full yield/resume/timeout flow works, mixed mode works, existing AI-only negotiations unchanged |
| Phase 5 | API keys can be created/listed/deleted from UI, keys work for MCP auth |

## Parallel Execution

Recommended subagent assignment:
- **Agent A:** Phase 1 (protocol-only, no backend changes)
- **Agent B:** Phase 2 (backend infrastructure, new files mostly)
- **Agent C:** Phase 5 (frontend-only, independent)
- **Sequential after A+B+C:** Phase 3 then Phase 4
