# list_opportunities — `excludeDelivered` flag

## Problem

EdgeClaw users see the same opportunity surfaced multiple times across the day. The morning digest (08:00) lists an opportunity, the afternoon ambient pass (14:00) repeats it, and the evening ambient pass (20:00) repeats it again. Observed example: Seref's two distinct opportunities (juggling, partnerships) appeared in both the morning digest and the immediately-following ambient update.

Cause: both `prompts/digest.md` and `prompts/ambient.md` call `list_opportunities(status="pending")`. That tool returns whatever is still in status `pending` and does not consult the `opportunity_deliveries` ledger. The ledger is written via `confirm_opportunity_delivery` after each surface, but nothing reads it back when those tools query for fresh candidates.

The OpenClaw-plugin negotiation poller already does the right thing through `OpportunityDeliveryService.fetchPendingCandidates` → `filterAlreadyDelivered`. The chat-tool path (which EdgeClaw uses) does not.

Ambient's `lastAmbientHash` short-circuit only dedupes a pass against the previous ambient pass for the same set — it does not dedupe against the morning digest, so digest-then-ambient duplication is the dominant failure mode.

## Goal

Bring the chat-tool `list_opportunities` onto the same delivery-ledger rails that the polling path already uses, opt-in via a new `excludeDelivered` flag. Wire the EdgeClaw digest and ambient prompts to pass the flag. Leave human-driven chat callers unchanged.

## Non-goals

- Time-windowed resurfacing ("show again after 7 days") — separate feature.
- Changes to `welcome.md` or other non-cron prompts — they're not part of the duplication path.
- Changes to OpenClaw-plugin polling — `fetchPendingCandidates` already filters via the ledger.
- Removing the `lastAmbientHash` short-circuit — it still serves the case where nothing qualifies and no ledger row is written (avoids re-running quality eval on an unchanged set).

## Approach

Add an optional `excludeDelivered: boolean` argument to `list_opportunities`. When `true`, the tool filters its candidate set against `opportunity_deliveries`, dropping any candidate that has a committed (delivered_at IS NOT NULL) row for the same `(opportunity_id, delivered_at_status)` key on channel `openclaw`. This matches the existing semantic in `OpportunityDeliveryService.filterAlreadyDelivered` exactly.

Edgeclaw's `digest.md` and `ambient.md` pass `excludeDelivered=true`. The chat agent path (when a user asks "what opportunities do I have?") leaves the flag unset and continues to see the full pending set.

### Data flow

```
list_opportunities(excludeDelivered=true, status="pending", limit=10)
   │
   ▼  database.getOpportunitiesForUser(userId, { statuses, networkId, limit }) ── unchanged
   │
   ▼  if excludeDelivered:
   │      database.getDeliveredOpportunityIds(userId, candidateIds, channel="openclaw")
   │      drop candidates whose (id, status) appears
   │
   ▼  selectByComposition (existing balance step)
   │
   ▼  render cards (existing)
```

### Semantic

Deliver each `(opportunityId, deliveredAtStatus)` tuple at most once per channel. If a `pending` opportunity transitions to `accepted`, the accepted-state delivery is independent (different `delivered_at_status` key, allowed). If the user never responds and the opportunity stays `pending`, it stays out of digest/ambient until status changes. This is the OpenClaw-plugin polling semantic verbatim.

## Components

### 1. Protocol — tool schema and handler

`packages/protocol/src/opportunity/opportunity.tools.ts`

- Add `excludeDelivered: z.boolean().optional()` to the `list_opportunities` Zod query schema. Document on the schema: "When true, drop opportunities that have already been delivered to this user on this channel. Use from automated cron prompts (digest, ambient) — not from human-driven chat."
- In the handler, after `database.getOpportunitiesForUser(...)` and before `selectByComposition(...)`, add the filter step. The filter uses a new adapter method (see Component 2).
- The filter receives the visible-after-status set; it must run before `selectByComposition` so the compose-balance picks from already-deduplicated candidates.

### 2. Protocol — adapter interface

`packages/protocol/src/shared/interfaces/opportunity-database.interface.ts` (or wherever `getOpportunitiesForUser` is declared today)

- Add a new method to the interface:
  ```ts
  getDeliveredOpportunityIds(params: {
    userId: string;
    opportunityIds: string[];
    channel: string;
  }): Promise<Set<string>>;   // returns "opportunityId:deliveredAtStatus" keys
  ```
- The return value is a Set of `${id}:${status}` strings (mirroring `filterAlreadyDelivered`'s existing key format).

### 3. Backend — adapter implementation

`backend/src/adapters/database.adapter.ts` (the `chatDatabaseAdapter` that protocol consumes)

- Implement `getDeliveredOpportunityIds`. Logic mirrors `OpportunityDeliveryService.filterAlreadyDelivered`:
  ```sql
  SELECT opportunity_id, delivered_at_status
  FROM opportunity_deliveries
  WHERE opportunity_id IN (...)
    AND user_id = ?
    AND channel = ?
    AND delivered_at IS NOT NULL
  ```
- Return the `Set` of `${opportunity_id}:${delivered_at_status}` strings.
- Early return `new Set()` when `opportunityIds.length === 0`.

### 4. EdgeClaw — prompt edits

`packages/edgeclaw/workspace/prompts/digest.md`

- Step 1 changes from `list_opportunities(status="pending", limit=10)` to `list_opportunities(status="pending", excludeDelivered=true, limit=10)`.

`packages/edgeclaw/workspace/prompts/ambient.md`

- Step 2 changes from `list_opportunities(status="pending", limit=10)` to `list_opportunities(status="pending", excludeDelivered=true, limit=10)`.

No other prompt steps change. `confirm_opportunity_delivery` calls stay — they're how the ledger gets populated. `lastAmbientHash` short-circuit stays — it covers the "nothing qualified" case where no ledger row is written.

## Testing

### Unit — protocol tool

`packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts`

- New test: `list_opportunities with excludeDelivered=true drops candidates with committed delivery row`
  - Seed three opportunities; mock adapter so opp #2 has a committed row at `delivered_at_status='pending'`. Call with `excludeDelivered=true`. Assert opp #2 is absent from the response.
- New test: `list_opportunities with excludeDelivered=true ignores deliveries at different status`
  - Opp delivered at `'accepted'`, current status is `'pending'`. With `excludeDelivered=true`, opp is still returned (different `(id, status)` key).
- Regression test: `list_opportunities without excludeDelivered returns the full set`
  - Same seed; flag omitted. All three opps returned.

### Unit — backend adapter

`backend/src/adapters/tests/database.adapter.spec.ts` (or matching test file)

- `getDeliveredOpportunityIds returns committed rows only`
- `getDeliveredOpportunityIds filters by channel`
- `getDeliveredOpportunityIds returns empty set for empty input`

### Integration / manual

After deploying:
- Trigger an 08:00 digest pass manually for a test user with pending opportunities. Confirm the digest message is delivered and `opportunity_deliveries` rows are written.
- Trigger an ambient pass immediately after. Confirm the ambient pass either reports "quiet night" / ends silently, or surfaces only opportunities that landed since the digest. The digest's opportunities must not reappear.

## Migration

No schema migration. The `opportunity_deliveries` table and its indexes already exist and are already being written from both surfaces.

## Risk

- **Behavior change for downstream callers.** Default is `false`; existing call sites are unaffected. Confirmed by reviewing call sites: only EdgeClaw prompts and the chat agent invoke this tool, and the chat agent should keep its current behavior.
- **Adapter method placement.** If the `OpportunityDatabase` interface in the protocol package doesn't already expose anything ledger-related, this is the first such method. That's acceptable — the ledger is part of the opportunity lifecycle, and the protocol package already imports types from the deliveries domain via `OpportunityDeliveryService`. The implementation lives in the backend adapter; protocol stays infrastructure-free.
- **Ledger growth.** Each delivery writes a row. No change here — `confirm_opportunity_delivery` already writes them; we're just reading them. Indexed by `(opportunity_id, user_id, channel, delivered_at_status)` per existing schema.

## Rollout

Single deployment. No flag-gating needed — the new tool argument is opt-in, and only the two prompt files exercise it.
