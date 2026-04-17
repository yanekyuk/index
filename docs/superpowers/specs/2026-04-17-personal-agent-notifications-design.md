# Personal Agent Notifications — Design Spec

**Date:** 2026-04-17
**Status:** Draft (pending user review)
**Related spec:** [2026-04-17-ambient-orchestrator-negotiation-flow-design.md](./2026-04-17-ambient-orchestrator-negotiation-flow-design.md)

## Summary

Personal agents today are created with the full `AGENT_ACTIONS` set (including `manage:negotiations`) and unconditionally surface any `pending` opportunity the owner is an actor in via the OpenClaw pickup loop. This spec adjusts the default capability envelope, introduces owner-controlled notification preferences, and removes the now-obsolete agent webhook transport.

1. **Trim default permissions.** New personal agents get the same action set as the chat orchestrator — no `manage:negotiations` by default.
2. **Three toggles on the agent row.** `notify_on_opportunity` gates the existing opportunity pickup; `daily_summary_enabled` gates a new once-per-24h digest delivered through the same OpenClaw channel; `handle_negotiations` (ALPHA, default off) grants/revokes the `manage:negotiations` action on the owner's permission row so personal agents can opt in to receiving negotiation turns via the OpenClaw pickup loop.
3. **Extend pickup to `draft` opportunities, excluding the initiator.** Under the ambient/orchestrator unification, orchestrator-triggered opps land in `draft`. The counterparty should learn about them through their personal agent; the initiator already saw the card streamed into chat.
4. **Drop the agent webhook transport.** All personal-agent delivery is via OpenClaw polling now. The `'webhook'` member of `transportChannelEnum`, the `add_webhook_transport` tool, its test, and the surrounding docs references are removed. This replaces the webhook transport as the opt-in path for negotiations; the new `handle_negotiations` toggle is how owners escalate.

All four pieces ship as a single unit behind an agent-level UI section. The daily-summary **worker job** depends on the in-flight status-flow refactor to stabilize (so "opportunities that surfaced since yesterday" has a precise meaning) and is scoped as a deferred sub-task; the toggle column, UI, and API plumbing ship now.

## Goals

1. Personal agents, by default, cannot respond to negotiations. Owners opt in by flipping the `handle_negotiations` toggle, flagged ALPHA in the UI because the personal-agent negotiation response path is not yet fully exercised end-to-end.
2. Owners can independently silence per-opportunity pings and the daily digest for any personal agent they own.
3. Orchestrator-path (`draft`) opportunities reach the counterparty through their personal agent without leaking back to the initiator who created them in chat.
4. No new columns on `opportunities`; use the `detection` payload that already identifies the chat initiator.
5. Agent delivery is unified on OpenClaw polling. The webhook transport, now unused, is deleted.

## Non-goals

- Delivery surfaces other than OpenClaw. Claude-plugin delivery of opportunity/summary payloads is explicitly out of scope; the toggles apply only to agents polling via the OpenClaw plugin.
- Per-user master notification preferences. Toggles are per-agent; `agents.status = 'inactive'` remains the master kill switch for an individual agent.
- Configurable summary time-of-day, relevance thresholds, or per-network filters. On/off only.
- Changes to the `opportunity_deliveries` ledger beyond extending `delivered_at_status` to cover `'draft'` (see below).

## Deferred sub-task (pending status-flow stabilization)

The daily-summary **worker job** is deferred until the status-flow changes described in IND-233 land, because the current `expired` overload makes "opportunities that surfaced since yesterday" ambiguous. The toggle column, API field, and UI control ship now and simply read false-by-default-no-op until the worker is wired up. Call-site for the worker is left as an explicit TODO in a yet-to-be-created `backend/src/queues/daily-summary.queue.ts` at implementation time.

## Default personal-agent permissions

[`AgentService.create`](backend/src/services/agent.service.ts:55) currently grants `[...AGENT_ACTIONS]` on the owner's permission row. Replace with a new constant:

```ts
const PERSONAL_AGENT_DEFAULT_ACTIONS: readonly AgentAction[] = [
  'manage:profile',
  'manage:intents',
  'manage:networks',
  'manage:contacts',
  'manage:opportunities',
];
```

Mirrors the existing `ORCHESTRATOR_ACTIONS` constant. `manage:negotiations` is deliberately absent.

Also align [`PERSONAL_AGENT_ACTIONS`](backend/src/cli/db-seed.ts:55) so seeded personal agents match runtime-created ones.

The only way a personal agent gains negotiation capability is through the new `handle_negotiations` toggle (see below). Flipping it on grants `manage:negotiations` on the owner's permission row; flipping it off revokes.

### Backfill

All existing personal-agent permission rows holding `manage:negotiations` are revoked in a one-time backfill migration. Owners must explicitly opt back in via the toggle. The migration also sets `handle_negotiations = false` for every personal agent (matching the new default), so the toggle state stays consistent with the permission row.

```
UPDATE agent_permissions p
SET actions = array_remove(actions, 'manage:negotiations')
FROM agents a
WHERE a.id = p.agent_id
  AND a.type = 'personal'
  AND 'manage:negotiations' = ANY(p.actions);
```

This is deliberately unconditional. Under the prior design, a personal agent gained `manage:negotiations` only after attaching a webhook transport — but webhooks are being removed in this same change, so no agent is meaningfully authorized for negotiations anymore. Opt-in starts fresh via the toggle.

## Data model — three booleans and a timestamp on `agents`

Single Drizzle migration adds four columns:

```sql
ALTER TABLE agents
  ADD COLUMN notify_on_opportunity  boolean NOT NULL DEFAULT true,
  ADD COLUMN daily_summary_enabled  boolean NOT NULL DEFAULT true,
  ADD COLUMN handle_negotiations    boolean NOT NULL DEFAULT false,
  ADD COLUMN last_daily_summary_at  timestamp with time zone;
```

- `notify_on_opportunity` — default `true`; gates per-opportunity pickup for this agent.
- `daily_summary_enabled` — default `true`; gates the digest worker once it ships.
- `handle_negotiations` — default `false`; ALPHA. When `true`, the owner's permission row for this agent includes `manage:negotiations`; when `false`, it does not. `AgentService.update` is the single writer that keeps the column and the permission row in sync within a transaction.
- `last_daily_summary_at` — nullable; written by the worker when a summary is delivered (or when an empty-day sweep runs, to keep the next-due cursor moving).

System agents ignore these columns. The service layer enforces that updates only apply when `agent.type = 'personal'`.

### `handle_negotiations` ⇄ permission row sync

The column is authoritative for UI state; the permission row is authoritative for runtime authorization checks. Keeping them consistent is a single service-layer responsibility: `AgentService.update({ handleNegotiations })` opens a transaction, updates the column, and adds or removes `manage:negotiations` from the owner permission row. No other code path writes `manage:negotiations` for personal agents. A unit test asserts the pre/post invariant (column true ⇔ action present).

## Pickup widening: include `draft`, exclude the initiator

[`OpportunityDeliveryService.pickupPending`](backend/src/services/opportunity-delivery.service.ts:76) today pins `o.status = 'pending'` and `d.delivered_at_status = 'pending'`. New predicate:

```sql
WHERE o.status IN ('pending', 'draft')
  AND o.actors::jsonb @> [{ userId }]::jsonb
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
      AND d.delivered_at_status = o.status::text
      AND (
        d.delivered_at IS NOT NULL
        OR (d.reserved_at IS NOT NULL AND d.reserved_at >= ${ttlCutoff.toISOString()})
      )
  )
ORDER BY o.updated_at ASC
LIMIT 20
```

Three changes from today:

1. **Status set**: `IN ('pending', 'draft')` instead of `= 'pending'`.
2. **Initiator exclusion**: `detection.createdBy` is the chat user for orchestrator-path opps (the ambient/orchestrator spec's `persist` node populates this). For `draft` rows, that user is excluded. `pending` rows are unaffected. `IS DISTINCT FROM` is null-safe so ambient opps with absent `createdBy` stay visible to all actors.
3. **Toggle gate**: the `notify_on_opportunity` check filters the whole result when the agent is muted. Empty polls still bump `lastSeenAt` per the ambient/orchestrator spec — a muted agent looks healthy, just never has anything to pick up.

The ledger's `NOT EXISTS` clause keys `delivered_at_status` on the current opp status, so a draft delivered to user B doesn't get re-delivered as `accepted` later (which isn't in the pickup scope anyway).

### Guardrail for the orchestrator-path write

This filter's correctness depends on `persist` populating `detection.createdBy` in the orchestrator branch. Two things protect us:

- A unit test asserting the orchestrator branch of `persist` writes both `detection.source = 'chat'` and `detection.createdBy = <user id>`.
- A runtime assertion in `OpportunityDeliveryService` (or the DB via a check constraint) that rejects a `draft` row with null `detection.createdBy`. Prefer the service-level assertion; cheaper and closer to the writer.

Both are trivial once the ambient/orchestrator spec's `persist` node is in place. This spec takes a dependency on that work and adds the test/assertion as part of its own implementation.

## Ledger enum extension

`delivered_at_status` enum gains `'draft'` alongside `'pending'`. One-line migration; no row rewrites. Existing rows keep `'pending'`. A further `'summary'` value is added as part of the deferred daily-summary worker, not in this spec's migration.

## Daily summary worker — interface only, implementation deferred

Shape of the worker, to be implemented after IND-233:

```
Every ~15 min, scan personal agents where:
  - type = 'personal'
  - daily_summary_enabled = true
  - last_daily_summary_at < now() - 24h (or NULL)

For each due agent:
  1. Count opportunities that surfaced for this owner in the past 24h.
     "Surfaced" is defined by the IND-233 status refinement.
  2. If count > 0: insert an opportunity_deliveries row with
     trigger = 'daily_summary', a new delivered_at_status = 'summary',
     payload = { count, top: [...], windowStart, windowEnd }.
  3. Set last_daily_summary_at = now() regardless of count.
```

### Delivery contract for the summary payload

Reuse the existing `/agents/:id/opportunities/pickup` endpoint as a discriminated response. Today it returns `{ opportunityId, rendered, reservationToken, ... }`. Extend to optionally return:

```ts
| { kind: 'opportunity'; opportunityId: string; rendered: RenderedCard; reservationToken: string; ... }
| { kind: 'daily_summary'; summaryId: string; payload: { count: number; items: [...] }; reservationToken: string; ... }
```

One endpoint, one poller, minimal plugin churn. Rejected alternative: a separate `/agents/:id/digests/pickup` — doubles polling and adds a second response path for negligible typing benefit.

This shape is defined in the spec now so the column, API field, and frontend toggle can ship coherently; the actual enqueue/dispatch job lands post-IND-233.

## API surface

`PATCH /agents/:id` accepts three additional optional fields:

```ts
{
  notifyOnOpportunity?: boolean;
  dailySummaryEnabled?: boolean;
  handleNegotiations?: boolean;
}
```

Only applied when `agent.type === 'personal'`. Attempting to set these on a system agent is a no-op (matches existing `update` behavior for name/description). Writing `handleNegotiations` runs the column + permission-row sync described above.

Agent responses from `GET /agents` and `GET /agents/:id` include all three fields.

## Frontend

Agent detail page ([frontend/src/app/agents/[id]/page.tsx](frontend/src/app/agents/[id]/page.tsx)) gains a **Notifications** section, rendered only when `agent.type === 'personal'`:

- Toggle: "Notify me about new opportunities" — binds to `notifyOnOpportunity`.
- Toggle: "Send a daily summary" — binds to `dailySummaryEnabled`.
- Toggle: "Handle negotiations on my behalf" — binds to `handleNegotiations`. Rendered with an inline **ALPHA** badge next to the label and a one-line caveat ("Experimental — your personal agent will respond to negotiation turns through the OpenClaw pickup loop.").
- Short copy under the first two toggles explaining they only apply to OpenClaw-connected agents.

The ALPHA badge is a reusable component (one Tailwind-styled pill) so we can apply it to future flags without bespoke markup. No other frontend changes.

## OpenClaw plugin

- The existing opportunity pickup loop is unchanged in polling mechanics.
- The bootstrap skill (generated from [`packages/protocol/skills/openclaw/SKILL.md.template`](packages/protocol/skills/openclaw/SKILL.md.template)) gains a short section describing how to render the `daily_summary` payload variant when the worker job ships. Ships as an empty scaffold now with a TODO; no behavior change for current users.
- Any webhook-related guidance in the skill template (if present) is removed — negotiations now flow exclusively through the OpenClaw negotiation pickup endpoint, which the plugin already implements.

## Agent webhook transport removal

The agent webhook transport is dropped. This is strictly separate from the Telegram inbound receiver at [`backend/src/controllers/webhooks.controller.ts`](backend/src/controllers/webhooks.controller.ts), which is a different subsystem and is left intact.

### Scope of removal

**Code:**

- `packages/protocol/src/agent/agent.tools.ts` — delete the `add_webhook_transport` tool entry and any helper branches it uses.
- `packages/protocol/src/agent/tests/add-webhook-transport.spec.ts` — delete.
- `packages/protocol/src/shared/interfaces/agent.interface.ts`, `packages/protocol/src/shared/agent/tool.helpers.ts`, `packages/protocol/src/shared/agent/tests/tool.helpers.spec.ts` — drop webhook-shaped types, helpers, and fixtures.
- `backend/src/schemas/database.schema.ts` — change `transportChannelEnum` from `['webhook', 'mcp']` to `['mcp']`. `agent_transports` and the `'mcp'` channel are retained.
- `backend/src/adapters/agent.database.adapter.ts` — remove any webhook-transport branches; keep the MCP path.
- `backend/src/services/agent.service.ts`, `backend/tests/agent.service.test.ts` — drop webhook code paths and their tests.
- `backend/src/services/negotiation-polling.service.ts` — scan and remove any residual webhook-dispatch references.
- `backend/src/main.ts` — scan for webhook-transport wiring and remove.
- `backend/src/cli/db-flush.ts` — drop webhook-specific flushes if any.
- `packages/protocol/src/agent/tests/fakes.ts` — remove webhook-transport fakes.
- `backend/tests/mcp.test.ts` — scan for webhook references and remove.

**Data:**

- Migration: delete rows from `agent_transports` where `channel = 'webhook'`, then alter the enum. Drop the `'webhook'` label.

**Docs:**

- `CLAUDE.md` — remove the mention of webhook transports in the personal-agent section ("`add_webhook_transport` grants `manage:negotiations`" etc.).
- `docs/specs/api-reference.md` — remove the webhook-transport endpoint and field references.
- `docs/design/architecture-overview.md` — remove the webhook-transport node from the architecture diagrams/tables.
- `packages/protocol/README.md` — remove webhook sections.
- `packages/openclaw-plugin/README.md` — remove webhook sections; the OpenClaw plugin is poll-only.
- `packages/openclaw-plugin/skills/index-network/SKILL.md` — generated file; rebuild from template after template cleanup (handled by `scripts/build-skills.ts`).
- `docs/guides/getting-started.md` — remove webhook setup steps.
- `backend/.env.example` — remove any webhook-related env keys.

**Not touched:**

- `backend/src/controllers/webhooks.controller.ts` and its Telegram consumers (`backend/src/lib/telegram/**`, `backend/src/gateways/telegram.gateway.ts`, the `.github/workflows/notify-pr-to-slack.yml`). These are unrelated inbound webhooks for messaging and CI.
- Migration files under `backend/drizzle/` and snapshots in `backend/drizzle/meta/`. Historical migrations remain; the forward-only migration in this spec is what drops the enum label.

## Files touched

- `backend/src/services/agent.service.ts` — new `PERSONAL_AGENT_DEFAULT_ACTIONS`, wire into `create`, extend `update` to accept the three booleans, implement `handle_negotiations` ↔ permission-row sync in a transaction.
- `backend/src/cli/db-seed.ts` — align seeded actions.
- `backend/src/schemas/database.schema.ts` + migration — four columns on `agents`, extend `delivered_at_status` enum to include `'draft'`, narrow `transport_channel` enum to `['mcp']`.
- Drizzle backfill migration — revoke `manage:negotiations` from all personal-agent permission rows; set `handle_negotiations = false` for all personal agents; delete `agent_transports` rows with `channel = 'webhook'`.
- `backend/src/services/opportunity-delivery.service.ts` — widen `pickupPending` predicate; add the `detection.createdBy` null-guard assertion.
- `backend/src/controllers/agent.controller.ts` — accept the three new fields on `PATCH /agents/:id`.
- `frontend/src/app/agents/[id]/page.tsx` — Notifications section with three toggles; reusable ALPHA badge component.
- `frontend/src/services/agents.ts` — add the three fields to the agent client type; remove webhook references.
- `packages/protocol/skills/openclaw/SKILL.md.template` — scaffold section for summary rendering (TODO stub); remove any webhook guidance.
- Webhook-transport removal files listed in the previous section.
- Tests:
  - `backend/tests/agent.service.test.ts` — new default action set; rejects `manage:negotiations` for fresh agents; `handle_negotiations` toggle ↔ permission-row invariant.
  - `backend/src/services/tests/opportunity-delivery.spec.ts` (new or existing) — initiator exclusion for `draft`, toggle gate, ambient unchanged.

## Risks and reversible decisions

- **Default `true` for `notify_on_opportunity` and `daily_summary_enabled`** — matches current behavior (agents already receive pickups). If we later decide opt-in is correct, it's a single-line default flip plus a backfill.
- **Default `false` for `handle_negotiations`** — deliberate; this is alpha, and today no personal agent is meaningfully authorized for negotiations anyway (webhook-transport escalation is being removed). Opt-in via the UI.
- **Unconditional backfill revoking `manage:negotiations`** — under the prior design, the only path to that action was webhook attachment, which we're deleting in the same change. No agent loses a capability it was actively using.
- **Enum narrowing on `transport_channel`** — once we ship, re-adding webhook is a new migration. Acceptable: the decision here is that OpenClaw polling is the delivery model going forward.
- **Summary pickup shape shipped as an extension before the worker exists** — the contract is defined but never exercised until IND-233 lands. Low risk: the discriminator (`kind`) is cleanly additive and the plugin already handles single-payload responses.
- **`last_daily_summary_at` column unused until the worker ships** — trivial storage cost; avoids a second migration later.
- **`handle_negotiations` column vs permission row** — two sources of truth that must stay synchronized. Mitigated by funneling all writes through `AgentService.update` inside a transaction and asserting the invariant in a unit test. Direct DB edits would drift; that risk is flagged for ops.

## Dependencies

- Ambient/orchestrator unified-graph spec's `persist` node populates `detection.source = 'chat'` and `detection.createdBy = <user id>` for orchestrator-triggered opps. This spec adds a test and a service-level assertion to enforce it.
- Daily-summary worker depends on IND-233 clarifying what "surfaced" means under the refined status vocabulary.
