# Agent-Driven Delivery Confirmation Design

## Goal

Make the user's main OpenClaw agent the single decision-maker for which opportunities get delivered, and tie ledger state to actual delivery (not dispatch). Resolve the current bug where ambient drains the queue regardless of what the agent renders, leaving digest permanently empty.

## Background

Today the plugin runs two pollers — ambient (every 5 min, `limit=10`) and daily digest (once per day, `limit=20`). Both fetch from `GET /agents/:id/opportunities/pending`, dispatch a prompt to the user's main agent via `/hooks/agent`, then call `POST /agents/:id/opportunities/confirm-batch` for **every** fetched ID. The agent is asked in the prompt to be selective ("surface only what's worth interrupting right now"), but the plugin commits the whole batch to the delivery ledger regardless of what the agent rendered. Net effect: ambient drains the queue every 5 minutes, digest finds nothing pending at its scheduled time.

The intended design is asymmetric: ambient is critical (low volume, only what matters now, target ≤3/day), digest is comprehensive (sweeps everything ambient passed on). The plumbing for this already exists in the form of the `confirm_opportunity_delivery` MCP tool — the agent can confirm individual opportunities — but the plugin's auto-confirm bypasses it.

The MCP tool today writes to the same `opportunity_deliveries` ledger as `confirm-batch`, but neither path distinguishes which trigger (ambient vs digest) caused the delivery. The `trigger` column exists on the ledger and is currently always `'pending_pickup'`.

## Architecture

The agent becomes the source of truth for "what was delivered to the user". The plugin's role narrows to fetching candidates, building a prompt that explains the decision context (which pass, today's count so far, the relationship to the other pass), and dispatching. The agent calls `confirm_opportunity_delivery(opportunityId, trigger)` for each opportunity it surfaces, before rendering it. The plugin does not call any confirm endpoint. The `confirm-batch` endpoint and its underlying `commitDelivery` service method are deleted as dead code.

A new lightweight stats endpoint exposes per-trigger delivery counts since a cutoff, so the ambient poller can embed today's ambient-delivery count in its prompt. The cap (~3 ambient deliveries/day) is enforced by the agent based on this count — soft enforcement, consistent with the broader bet that the agent's judgment is load-bearing.

## Components

### Backend protocol (`@indexnetwork/protocol`)

- **`confirm_opportunity_delivery` MCP tool** (`src/opportunity/opportunity.tools.ts`): add a required `trigger: z.enum(['ambient','digest'])` argument. Pass through to `deliveryLedger.confirmOpportunityDelivery`. Update tool description to explain the trigger field and reference the two pass types.
- **`DeliveryLedger.confirmOpportunityDelivery`** (`src/shared/interfaces/delivery-ledger.interface.ts`): add `trigger: 'ambient' | 'digest'` to the params; the implementer (`backend/src/protocol-init.ts:78-81`) forwards it to `commitDelivery`.

### Backend app (`backend/`)

- **`OpportunityDeliveryService.commitDelivery`** (`src/services/opportunity-delivery.service.ts:233`): add `trigger: 'ambient' | 'digest'` parameter, write it to the `trigger` column of the inserted `opportunity_deliveries` row (currently hardcoded to `'pending_pickup'`).
- **`OpportunityDeliveryService.countDeliveriesSince`** (same file): new method `countDeliveriesSince(agentId: string, since: Date): Promise<{ ambient: number; digest: number }>`. SQL counts rows in `opportunity_deliveries` where `agent_id = :id`, `delivered_at IS NOT NULL`, `delivered_at >= since`, grouped by `trigger`. Returns `0` for any trigger value with no rows.
- **`AgentController.getDeliveryStats`** (`src/controllers/agent.controller.ts`): new route `GET /agents/:id/opportunities/delivery-stats?since=<ISO8601>`. Validates `since` parses as a finite ISO date; otherwise 400. Authorizes via `AuthOrApiKeyGuard` and `agentService.getById(agentId, user.id)`, returns `{ ambient, digest }`.
- **Delete `confirmBatchDelivered` controller route** (`src/controllers/agent.controller.ts:578-605`) and its `batchConfirmDeliveredSchema` Zod schema. `commitDelivery` itself stays — it remains the underlying primitive used by `deliveryLedger.confirmOpportunityDelivery` from the MCP tool.

### Plugin (`packages/openclaw-plugin/`)

- **Delete `post-delivery-confirm.ts`** and remove all imports (used only by the two pollers).
- **`ambient-discovery.poller.ts`**: before dispatch, fetch `GET /agents/:id/opportunities/delivery-stats?since=<midnightLocal>`; embed `ambientDeliveredToday` in the prompt payload (or `null` if the stats fetch failed). Remove the `confirmDeliveredBatch` call. Keep the dedup hash and the tri-state `'dispatched' | 'empty' | 'error'` outcome. Compute `midnightLocal` as the start of today in the user's local timezone, formatted as ISO 8601 UTC.
- **`daily-digest.poller.ts`**: remove the `confirmDeliveredBatch` call. No stats fetch (digest has no cap). Remove `digestMaxCount` config and the `maxToSurface` selectivity instruction — digest renders everything fetched.
- **`main-agent.prompt.ts`**: rewrite the per-content-type instruction blocks for `ambient_discovery` and `daily_digest`:
  - Ambient: explains this is the real-time pass, includes `ambientDeliveredToday` (the count of ambient deliveries already sent today) and the soft target of ≤3/day, mandates calling `confirm_opportunity_delivery(id, trigger:'ambient')` before mentioning each surfaced opportunity, explicitly states that opportunities not surfaced now will appear in the daily digest.
  - Digest: explains this is the daily sweep of everything ambient passed on, mandates calling `confirm_opportunity_delivery(id, trigger:'digest')` before mentioning each surfaced opportunity, instructs the agent to render all candidates as a list.
  - The `OpportunityCandidate` payload type for ambient gains an `ambientDeliveredToday: number | null` sibling field on the payload (not per-candidate).
- **`mainAgentToolUse` toggle**: keep as-is. The toggle's clause (`toolUseClause`) gates *enrichment* tool use; the prompt's per-type instruction always requires `confirm_opportunity_delivery` regardless of toggle state. Update `toolUseClause` wording to match — when disabled, "do not call enrichment tools" rather than "do not call any tools".

## Data flow

### Ambient cycle

1. Scheduler triggers `POST /index-network/poll/ambient-discovery` (gateway-auth) every 5 min.
2. Plugin computes `midnightLocal` = start of today in the user's local TZ, formatted as ISO 8601 UTC string.
3. `GET /agents/:id/opportunities/delivery-stats?since=<midnightLocal>` → `{ ambient: N, digest: M }`. On failure (network, non-2xx, parse), proceed with `ambientDeliveredToday: null`.
4. `GET /agents/:id/opportunities/pending?limit=10` → candidates. Empty → outcome `'empty'`.
5. Compute batch hash. If matches last successful dispatch hash → outcome `'empty'`.
6. Build prompt: `contentType: 'ambient_discovery'`, payload `{ candidates, ambientDeliveredToday: N | null }`.
7. Dispatch to main agent via `/hooks/agent`. On dispatch failure → outcome `'error'`.
8. Outcome `'dispatched'`. **No confirm call.**
9. Agent (separately, in its own runtime): renders 0..N candidates. For each one mentioned in the reply, calls `confirm_opportunity_delivery(opportunityId, trigger:'ambient')` first.

### Digest cycle

1. Scheduler fires `onTrigger` at `digestTime`.
2. `GET /opportunities/pending?limit=20` → candidates. Empty → log "no pending opportunities", return.
3. Build prompt: `contentType: 'daily_digest'`, payload `{ candidates }`.
4. Dispatch via `/hooks/agent`. **No confirm call.**
5. Agent renders all candidates. For each one, calls `confirm_opportunity_delivery(opportunityId, trigger:'digest')` first.

### Confirmation semantics

The agent calls `confirm_opportunity_delivery` *before* the chunk of its reply that mentions the opportunity is rendered. The gateway delivers the agent's reply asynchronously to the user's last channel; the plugin sees only the synchronous `{ ok, runId }` response from `/hooks/agent`. If the gateway's outbound delivery to the channel (e.g. Telegram) fails after the agent confirmed, the ledger says delivered but the user never saw it. This is best-effort for v1; closing the gap requires gateway-side delivery callbacks, out of scope for this change.

## Error handling

- **Stats fetch fails** (ambient step 3): proceed with `ambientDeliveredToday: null`. The prompt instructs the agent to lean conservative when count is unknown. Stats are advisory, not load-bearing.
- **Pending fetch fails / non-2xx**: existing tri-state path returns `'error'`; scheduler backs off via `ambientDiscoveryScheduler.increaseBackoff`. Unchanged.
- **Dispatch fails** (`/hooks/agent` non-2xx, network): returns `'error'`; scheduler backs off. Nothing was confirmed (agent didn't run), retry is safe.
- **Agent confirms but skips rendering** (or rendering chunk crashes after confirm): ledger says delivered, user never saw it. Same risk class as the gateway-failure case; accepted as best-effort.
- **Agent renders without confirming**: opportunity stays pending, re-surfaces in next ambient cycle (where the agent re-evaluates) or in tonight's digest (where it's swept). Self-healing.
- **`confirm_opportunity_delivery` MCP call fails** (network/DB): returns error to the agent; agent decides whether to render anyway or skip. Worst case: agent renders without successful confirm → opp re-surfaces → agent reconsiders. Self-correcting.

## Migration

The `confirmBatchDelivered` controller route and the `post-delivery-confirm.ts` plugin module are deleted in the same release as the new agent-driven confirm path lands. The plugin no longer calls the deleted endpoint. `commitDelivery` keeps its name and call shape (with the new `trigger` parameter); only its caller chain narrows from "MCP tool + confirm-batch route" to "MCP tool only".

No data migration is required. The `opportunity_deliveries.trigger` column already exists; new agent-confirmed rows get `'ambient'` or `'digest'`; existing `'pending_pickup'` rows are untouched.

## Testing

### Unit

- **`confirm_opportunity_delivery` tool**: writes correct `trigger` value (`'ambient'` and `'digest'`) to the ledger; rejects invalid trigger values via Zod; idempotent (returns `'already_delivered'` on duplicate same-tuple call).
- **`OpportunityDeliveryService.countDeliveriesSince`**: counts rows correctly per trigger, respects `since` cutoff, returns `0` for triggers with no rows, ignores `delivered_at IS NULL` rows.
- **`GET /agents/:id/opportunities/delivery-stats` endpoint**: returns correct counts; rejects malformed `since` with 400; respects `AuthOrApiKeyGuard`.
- **Ambient poller**: stats fetch failure falls through to dispatch with `ambientDeliveredToday: null`; pending fetch failure returns `'error'`; dispatch success returns `'dispatched'` without calling any confirm endpoint; dedup hash still suppresses unchanged batches.
- **Digest poller**: dispatches without calling confirm; empty pending logs and returns false; no longer references `digestMaxCount`.
- **Prompt builder**: ambient payload type includes `ambientDeliveredToday: number | null`; ambient instruction mentions today's count, the ≤3/day target, the digest fallback, and mandates the confirm call; digest instruction mentions the ambient pass that came before, and mandates the confirm call.

### Integration

- **End-to-end agent-driven flow**: seed N pending opportunities, dispatch ambient with a mocked agent that confirms K-of-N, verify ledger has K rows with `trigger='ambient'` and N-K rows are still pending. Then dispatch digest, verify it sees N-K candidates, mocked agent confirms all of them, verify ledger has K ambient + (N-K) digest rows.
- **Stats reflect cycle**: after the above sequence, `GET /delivery-stats?since=<earlier>` returns `{ ambient: K, digest: N-K }`.
- **Regression**: existing dispatcher tests (session-targeting via `findChatTarget`) and scheduler-backoff tests stay untouched and still pass.
