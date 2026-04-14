# OpenClaw Opportunity Delivery — Design Spec

**Date:** 2026-04-15
**Status:** Draft (pending implementation plan)
**Decomposes into:** 6 GitHub issues (numbered 0–5 below)

## Goal

Extend the OpenClaw plugin so that personal agents proactively notify users about opportunities that pass negotiation (status `pending`) and deliver a daily morning digest of all actionable opportunities (`latent`, `stalled`, `pending`). Build the underlying delivery primitive once, validate it with a manual test channel, then layer the opportunity-specific surfaces on top.

The design also lifts the opportunity presenter so post-negotiation cards explain *why* an opportunity surfaced, using the full negotiation transcript as grounding.

## Non-Goals

- Configuring which OpenClaw gateway (Telegram/WhatsApp/default) carries the message. OpenClaw's runtime routes `subagent.run({deliver: true})` output through the user's active gateway. The plugin stays gateway-agnostic.
- Per-user timezone tracking on the backend. The morning digest cron runs inside the plugin via `node-cron`, which uses the host machine's local time naturally.
- Multi-channel delivery (our own Telegram bot, email, web push). The schema's `channel` column is forward-compatible, but only `'openclaw'` is implemented in v1.
- Per-user "history" view of accepted/rejected opportunities. The home graph default filter narrows to actionable statuses; an explicit history surface is a follow-up.
- Reviving the existing negotiation poller as a v1 feature. It stays available but is documented as **alpha** — per-user negotiation agents are not the primary use case for this release.

## Design Decisions Locked In

| Decision | Choice | Rationale |
|---|---|---|
| Decomposition | One spec → six issues (0–5) | Features share heavy context but split cleanly along layer/responsibility boundaries |
| Gateway routing | Plugin uses `subagent.run({deliver: true})`; OpenClaw routes | Plugin has no gateway API; matches OpenClaw philosophy |
| Delivery ledger | New `opportunity_deliveries` join table (per-user, per-opportunity) | One opportunity has N actors; a column on `opportunities` is wrong-shaped |
| Cron home | Plugin-side `node-cron` | OpenClaw-only feature; local time is natural; centralized scheduling not needed |
| Pending vs digest interaction | (ii) Real-time pending-pickup wins; digest dedupes via the ledger | Clear semantics; one delivery per (opportunity, user, channel, status) |
| Negotiation context depth | Full transcript (option C) | 12-turn cap bounds prompt size; presenter has maximum grounding |
| Payload shape | Server pre-renders presenter cards; plugin relays | Single source of truth; subagent stays a transport |
| Pickup mechanics | Two-phase reservation + confirm (60s TTL) | Mirrors negotiation pattern; safe under plugin restart |
| Home graph default | `['latent', 'stalled', 'pending']` | These are the actionable lifecycle stages |
| Validation strategy | Issue 0 ships a delivery primitive + test button before opportunity wiring | De-risks the entire design; extracts reusable primitive |
| Poll interval | 30s (inherits from negotiation poller) | Snappy enough; consistent with existing cadence |

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Protocol (backend)                           │
│                                                                      │
│  OpportunityPresenter ──(loads)──> NegotiationContext (full          │
│       │                             transcript when status ≠         │
│       │                             negotiating; chip otherwise)     │
│       ↓                                                              │
│  OpportunityDeliveryService ──(reads/writes)──> opportunity_         │
│       ↑              ↑                          deliveries (ledger)  │
│       │              │                                               │
│  ┌────┴───────┐ ┌────┴───────────┐ ┌────────────────────────────┐    │
│  │ /agents/:id│ │ /agents/:id    │ │ /agents/:id/test-messages  │    │
│  │ /opps      │ │ /home-digest   │ │ pickup, confirm            │    │
│  │ pickup,    │ │ pickup, confirm│ │                            │    │
│  │ confirm    │ │                │ │                            │    │
│  └─────┬──────┘ └────────┬───────┘ └──────────────┬─────────────┘    │
└────────┼─────────────────┼────────────────────────┼──────────────────┘
         │                 │                        │
         │ HTTPS (x-api-key + agent_id)             │
         ↓                 ↓                        ↓
┌──────────────────────────────────────────────────────────────────────┐
│                  OpenClaw Plugin (per-machine)                       │
│                                                                      │
│  Poll loop (30s): negotiations → opportunities → test-messages       │
│       │                                                              │
│       ↓                                                              │
│  dispatchDelivery({ rendered, sessionKey, idempotencyKey })          │
│       │                                                              │
│       ↓                                                              │
│  api.runtime.subagent.run({ deliver: true, ... })                    │
│       │                                                              │
│  node-cron ('0 8 * * *') → POST /home-digest → batch dispatch        │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ↓
                      OpenClaw runtime
                              │
                              ↓
                User's active gateway (Telegram in v1 target)
```

## Issue 0 — OpenClaw Delivery Primitive + Test Channel

**Goal:** Prove end-to-end that a backend-originated message reaches the user via OpenClaw's gateway, and extract the reusable `dispatchDelivery` helper that Issues 1, 4, and 5 will all build on.

### Plugin

New file `packages/openclaw-plugin/src/delivery.dispatcher.ts`:

```ts
export interface DeliveryRequest {
  rendered: { headline: string; body: string };
  sessionKey: string;
  idempotencyKey: string;
}

dispatchDelivery(api: OpenClawPluginApi, request: DeliveryRequest): Promise<{ runId: string }>
```

Internally calls `api.runtime.subagent.run({ deliver: true, ... })` with a new prompt `packages/openclaw-plugin/src/prompts/delivery.prompt.ts` instructing the subagent to relay the rendered content naturally for the user's active gateway — preserve substance, format for channel, no rewriting.

### Backend

New table `agent_test_messages` in `backend/src/schemas/database.schema.ts`:

```ts
agent_test_messages (
  id                uuid pk,
  agent_id          uuid not null fk → agents,
  requested_by_user_id uuid not null fk → users,
  content           text not null,
  reservation_token uuid,
  reserved_at       timestamptz,
  delivered_at      timestamptz,
  created_at        timestamptz not null default now(),
)
```

Three endpoints in a new `AgentTestMessageController`:

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `POST` | `/agents/:agentId/test-messages` | Session (must own agent) | Insert row with `content` |
| `POST` | `/agents/:agentId/test-messages/pickup` | API key + agent_id | Return next undelivered + reservation token (60s TTL), or `204` |
| `POST` | `/agents/:agentId/test-messages/:id/delivered` | API key + agent_id | Body `{ reservationToken }`; commit `delivered_at` |

Service layer: `AgentTestMessageService` in `backend/src/services/`.

### Plugin: extend the poll loop

The poller in `packages/openclaw-plugin/src/index.ts` currently calls one endpoint (negotiations). Extend to call **two** per cycle:

1. `negotiations/pickup` — existing path; subagent with `deliver: false`.
2. `test-messages/pickup` — new path; on `200`, build `DeliveryRequest` and call `dispatchDelivery`. On dispatch success, POST the `delivered` confirm.

Sequential within a cycle, both run every 30s, shared exponential backoff on errors.

### Frontend

In the existing agents page (likely under `frontend/src/app/agents/...` — exact path confirmed during planning), add a "Send test message" button visible for agents with an OpenClaw transport configured. Button opens a small dialog with a content textarea (default: *"Hello from Index Network — this is a test delivery."*), POSTs `/agents/:agentId/test-messages`, and shows a "Sent — should arrive in your OpenClaw gateway within ~30s" toast.

### Validates

- `subagent.run({deliver: true})` actually surfaces output in the user's gateway.
- Reservation/confirm pickup pattern works end-to-end.
- Plugin can fan out across multiple pickup endpoints in one poll cycle without races.
- Frontend pattern for agent-page-triggered deliveries exists (reusable for future "re-send last digest" buttons).

## Issue 1 — `opportunity_deliveries` Ledger + Pending-Pickup Endpoints

**Goal:** Persist per-(user, opportunity, status) delivery state and expose backend endpoints for the plugin to pick up freshly-pending opportunities.

### Schema

New table `opportunity_deliveries` in `backend/src/schemas/database.schema.ts`:

```ts
opportunity_deliveries (
  id                   uuid pk,
  opportunity_id       uuid not null fk → opportunities,
  user_id              uuid not null fk → users,
  agent_id             uuid fk → agents,                  -- nullable for non-agent channels
  channel              text not null,                     -- 'openclaw' in v1
  trigger              text not null,                     -- 'pending_pickup' | 'morning_digest'
  delivered_at_status  text not null,                     -- opportunity status at delivery time
  reservation_token    uuid,
  reserved_at          timestamptz,
  delivered_at         timestamptz,                       -- null while reserved
  created_at           timestamptz not null default now(),
)
```

**Indexes:**

- Unique `(user_id, opportunity_id, channel, delivered_at_status) WHERE delivered_at IS NOT NULL` — enforces "one delivery per (user, opportunity, channel, status)".
- `(user_id, channel, reserved_at) WHERE delivered_at IS NULL` — fast lookup of expired reservations.

### Pickup eligibility

For a given `(agentId → userId)`, eligible pending opportunities are:
- Visible to `userId` per existing `canUserSeeOpportunity()`.
- `status = 'pending'`.
- No row exists in `opportunity_deliveries` for `(opportunity_id, user_id, channel='openclaw', delivered_at_status='pending')` with `delivered_at IS NOT NULL`.
- No active (non-expired) reservation exists for the same key.

### Endpoints

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/agents/:agentId/opportunities/pickup` | Resolve agent → user. Find next eligible. If none: `204`. Else: insert reservation row, run presenter (with full negotiation transcript per Issue 2), return `{ opportunityId, reservationToken, reservationExpiresAt, rendered }`. |
| `POST` | `/agents/:agentId/opportunities/:opportunityId/delivered` | Body `{ reservationToken }`. Commit `delivered_at = now()`. `404` if token doesn't match active reservation. `409` if expired. |

### Service layer

New `OpportunityDeliveryService` in `backend/src/services/`. Owns reservation/commit logic and the dedupe query. Wires through to `OpportunityPresenter` for rendering. Lazy-cleans expired reservations on pickup query (no separate cron needed for v1).

### Reservation TTL

60 seconds. A row inserted on pickup with `reserved_at=now()`, `delivered_at=null`, `reservation_token=uuid()`. Confirm transitions `delivered_at=now()`. Expired-unconfirmed rows are eligible for replacement on next pickup.

## Issue 2 — Negotiation Context in Opportunity Presenter

**Goal:** Lift the presenter so post-negotiation opportunities (`pending`, `stalled`, `accepted`, `rejected`) explain *why* they surfaced, and `negotiating` opportunities surface a templated chip.

### Loader

New helper `packages/protocol/src/opportunity/negotiation-context.loader.ts`:

```ts
export interface NegotiationContext {
  status: 'pending' | 'stalled' | 'accepted' | 'rejected' | 'negotiating';
  turnCount: number;
  turnCap: number;
  outcome?: NegotiationOutcome;             // present when status ≠ 'negotiating'
  turns: Array<{                            // full transcript when status ≠ 'negotiating'
    turnNumber: number;
    actorUserId: string;
    action: 'propose' | 'accept' | 'reject' | 'counter' | 'question';
    reasoning: string;
    message: string | null;
    suggestedRoles?: { source: string; candidate: string };
  }>;
}

loadNegotiationContext(db, opportunityId): Promise<NegotiationContext | null>
```

Returns `null` for `draft` and `latent` (no negotiation exists).

### Presenter wiring

`HomeCardPresenterInput` in `packages/protocol/src/opportunity/opportunity.presenter.ts` gains an optional field:

```ts
negotiationContext?: NegotiationContext;
```

`gatherPresenterContext()` in `packages/protocol/src/opportunity/feed/feed.graph.ts` calls the loader when status ∈ `{pending, stalled, accepted, rejected, negotiating}` and attaches the result.

### Presenter prompt branches

**Branch A — `status === 'negotiating'`:** No transcript fed to the LLM. The presenter renders a templated `narratorRemark` (no LLM call for this line):
> *"Currently negotiating · turn N of M"*

The `headline`/`summary`/`suggestedAction` still go through the LLM, describing the candidate match without transcript context.

**Branch B — `status ∈ {pending, stalled, accepted, rejected}`:** Full transcript injected with framing:
> *"This opportunity went through an agent-to-agent negotiation that concluded as `<status>` after `<turnCount>` turns. Below is the complete transcript. Use it to ground your `personalizedSummary` and `suggestedAction` in why this match surfaced and what the agents agreed on. The user has not seen the transcript — explain it in their voice."*

For `stalled`, the prompt also surfaces `outcome.reason` (`turn_cap` vs `timeout`) so the presenter can hedge appropriately.

### Where this lifts

- Pending-pickup payload (Issue 1) inherits the enriched presenter.
- Morning digest cards (Issue 5) inherit the enriched presenter.
- Existing chat-UI home feed renders the same enrichment automatically.

### Tests

- Unit tests for `loadNegotiationContext` covering each status.
- Snapshot tests for presenter prompt assembly across all five branches.
- Integration test: drive an opportunity through `latent → negotiating → pending` and assert the presenter card content shifts as expected.

## Issue 3 — Home Graph Default Status Filter

**Goal:** Narrow the home feed to actionable statuses (`latent`, `stalled`, `pending`) by default, parameterizable for callers that need different behavior.

### Input shape

`HomeGraphInvokeInput` in `packages/protocol/src/opportunity/feed/feed.graph.ts` gains:

```ts
statuses?: OpportunityStatus[];
```

Default when omitted: `['latent', 'stalled', 'pending']`. Exported as `DEFAULT_HOME_STATUSES` from the same file.

### Filter location

Three orthogonal predicates applied independently (do **not** fold into existing helpers):

- `canUserSeeOpportunity` — visibility (auth)
- `isActionableForViewer` — actor role (am I a participant?)
- `statuses` filter — lifecycle stage (worth surfacing today?)

### DB push-down

Extend the database call `getOpportunitiesForUser(userId, { limit, networkId, statuses? })` to push the filter into SQL `WHERE` rather than fetching all and filtering in memory. Same default applied at the call site.

### Callers

- Existing chat-UI home feed: behavior shifts to actionable-only set. **Intentional** (the home feed is a to-do list, not a history log) — note explicitly in the issue so it's tested deliberately.
- Morning digest endpoint (Issue 5): calls with default.
- Admin/debug callers wanting all statuses: pass `statuses: ALL_OPPORTUNITY_STATUSES` (also exported).

### Out of scope (flagged for follow-up)

A separate "history" surface for `accepted`/`rejected` opportunities. Not bundled in this issue.

## Issue 4 — OpenClaw Plugin: Pending-Opportunity Poller

**Goal:** Plug the plugin's poll loop into the new `opportunities/pickup` endpoint and route deliveries through `dispatchDelivery` from Issue 0.

### Plugin changes

Extend the poll loop (already extended in Issue 0) with a **third** endpoint per cycle: `POST /agents/:agentId/opportunities/pickup`.

Order within a cycle: `negotiations/pickup` → `opportunities/pickup` → `test-messages/pickup`. Negotiations stay first (24h server-side fallback timer); test messages last (lowest stakes).

On `200` from opportunities pickup:

1. Build a `DeliveryRequest` from the response's `rendered` block.
2. Call `dispatchDelivery(api, …)` from Issue 0.
   - Session key: `index:delivery:opportunity:<opportunityId>`
   - Idempotency key: `index:delivery:opportunity:<opportunityId>:<reservationToken>`
3. After `dispatchDelivery` resolves, POST `/agents/:agentId/opportunities/:opportunityId/delivered` with the reservation token.
4. On non-2xx confirm, log and let the reservation expire — next poll cycle retries naturally.

### Subagent prompt

New `packages/openclaw-plugin/src/prompts/opportunity-delivery.prompt.ts`. Variant of the test-delivery prompt: *"Relay this opportunity card to the user. The headline / summary / suggested action / narrator remark were generated by Index Network's presenter — preserve their substance, format for the user's gateway."*

### Backend changes

None beyond Issues 1+2 (endpoints already exist; presenter already enriched).

### README / install instructions

In the OpenClaw plugin's README, **tag the negotiation poller as alpha** and document the pending-opportunity poller as the v1 supported feature. Mention the test button on the agents page as the recommended first-run validation step.

### Multi-machine safety

If a user runs the plugin on two machines, both poll the same agent. The reservation row is the race winner — first machine's pickup gets it, second's pickup query excludes it. 60s reservation TTL means a crashed first machine releases its reservation back into the pool naturally.

## Issue 5 — Morning Home-Digest Endpoint + Plugin Cron

**Goal:** Run the home graph daily, render all actionable opportunities into one batched delivery, send via `dispatchDelivery` once per morning.

### Backend endpoints

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/agents/:agentId/home-digest` | Resolve agent → user. Run home.graph with the default filter (Issue 3). Filter out items already delivered for `(user, opportunity, channel='openclaw', status)`. Render each via the presenter. Return `{ digestId, reservationExpiresAt, items: [{ opportunityId, reservationToken, rendered }, ...] }`. Empty items → `204`. Inserts one reservation row per item, all sharing the same `digestId`, `trigger='morning_digest'`. |
| `POST` | `/agents/:agentId/home-digest/:digestId/confirm` | Body `{ deliveredTokens: [uuid, ...] }`. Commit each reservation in the list. Tokens not in the list left to expire. Returns `{ committed: N }`. |

### Plugin changes

- Add `node-cron` dependency.
- New module `packages/openclaw-plugin/src/digest.scheduler.ts` registering a cron schedule on `register()`.
  - Schedule string read from `pluginConfig.digestCron`; default `'0 8 * * *'` (8am host-local time).
- On fire: POST `/agents/:agentId/home-digest`.
  - On `204`: log "no actionable opportunities today" and exit cleanly. No subagent dispatched.
  - On `200`: build a single `DeliveryRequest` whose `rendered.body` concatenates the items' rendered cards under a digest-framing template (e.g. *"Good morning. Here are N opportunities worth your attention today: …"*).
    - Session key: `index:delivery:digest:<digestId>`
    - Idempotency key: `index:delivery:digest:<digestId>` (digest is naturally unique per cron firing)
    - Call `dispatchDelivery` once with the batch.
    - On success, POST `/agents/:agentId/home-digest/:digestId/confirm` with all `reservationToken`s from the response.

### Why one batched dispatch instead of N

Users want one morning message, not N notifications in 30 seconds. The user's gateway treats each `deliver: true` as a separate message. Confirmation is per-item (reservation tokens) so dedupe granularity isn't lost.

### Offline behavior

If the cron fires while the plugin is offline, that morning's digest is missed by design. Next morning's digest naturally picks up everything still actionable, including yesterday's missed items, because dedupe is by `(opportunity, user, channel, status)` and undelivered items still qualify.

## Cross-Cutting Decisions

### Poll interval

30 seconds, inherited from the existing negotiation poller (`POLL_INTERVAL_MS = 30_000` in `packages/openclaw-plugin/src/index.ts:27`). Worst-case pending-opportunity latency: ~30s between negotiation completing and user notification. Configurability via `pluginConfig.pollIntervalMs` flagged as a follow-up if any user reports the cadence wrong.

### Auth

All `/agents/:agentId/...` pickup and confirm endpoints use the existing API key + agent-id auth used by the negotiation pickup. The session-authed `POST /agents/:agentId/test-messages` requires the requester to own the agent.

### Multi-machine plugins

Reservation pattern in `opportunity_deliveries` (and `agent_test_messages`) handles the race naturally. No additional coordination needed.

### Forward compatibility

The `channel` column on `opportunity_deliveries` is `'openclaw'` in v1. Future channels (own Telegram bot, email, web push) add new values without schema change. The nullable `agent_id` accommodates non-agent channels.

## Dependency Order

```
0 (delivery primitive + test channel)
  ↓
1 (ledger + pending-pickup endpoints)     2 (presenter)     3 (home graph filter)
  ↓                                       ↑                 ↓
  └─────────────────┬─────────────────────┘                 │
                    ↓                                       │
                    4 (plugin pending poller)               │
                                          └────────────────→5 (digest)
```

- Issue 0 ships first; nothing else can be validated without it.
- Issues 1, 2, 3 can develop in parallel after 0.
- Issue 4 depends on 1 (endpoints) and 2 (enriched presenter).
- Issue 5 depends on 1 (ledger), 2 (presenter), 3 (filter).

## Testing Strategy

| Issue | Tests |
|---|---|
| 0 | Unit: `dispatchDelivery` builds correct subagent payload. Integration: end-to-end test message dispatched via real plugin → real OpenClaw gateway → message visible. Frontend: button POSTs correct payload. |
| 1 | Unit: pickup eligibility query, reservation insert, confirm commit, expired reservation cleanup. Integration: pickup → confirm cycle, pickup contention from two callers. |
| 2 | Unit: `loadNegotiationContext` per status. Snapshot: presenter prompt across all five branches. Integration: opportunity drive `latent → negotiating → pending`, presenter card content shifts. |
| 3 | Unit: filter applied at default and override. Integration: home feed regression — confirm UX shift to actionable-only is intentional. |
| 4 | Integration: backend creates pending opportunity → plugin polls → dispatchDelivery called → confirm POSTed → ledger row committed. Multi-machine race: two plugin instances, one wins. |
| 5 | Integration: cron fire → digest endpoint returns N items → single batch dispatch → confirm with all tokens → ledger has N committed rows. Empty-digest case (`204`). Offline-overnight case (next morning's digest includes yesterday's missed items). |

## Open Questions (to resolve during implementation)

- Exact frontend agents-page path (`frontend/src/app/agents/...` likely; confirm during planning).
- Whether the test button in Issue 0 should poll for `delivered_at` to flip the toast from "Sent" to "Delivered" (skip if it complicates anything for v1).
- Whether `digestCron` should accept a timezone override (default leaves it implicit via host local time; explicit override via `pluginConfig.digestTimezone` is a small forward-compat addition worth considering).
