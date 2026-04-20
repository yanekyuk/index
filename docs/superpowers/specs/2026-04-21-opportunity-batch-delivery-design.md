# Opportunity Batch Delivery — Design Spec

**Date:** 2026-04-21  
**Status:** Approved

## Problem

The OpenClaw plugin currently delivers pending opportunities one-by-one: each poll cycle fetches a single opportunity, immediately dispatches a subagent that sends a message to the user, and writes to the delivery ledger. This produces noisy, repetitive Telegram messages with no quality filter. Users have no way to see all their opportunities in one place or act on them with context.

## Goal

- Deliver opportunities in batches via one message per poll cycle
- Filter for high-value matches before delivery using an LLM evaluator
- Write to the delivery ledger only when an opportunity is actually surfaced to the user
- Poll every 5 minutes instead of every 30 seconds

## Architecture

Four changes across three layers: backend (new read endpoint), MCP (new confirm tool), plugin (new batch handler + interval), prompt (new evaluator+delivery prompt).

### Data Flow

```
Every 5 min:
  GET /api/agents/:id/opportunities/pending
    → returns all undelivered pending/draft cards (no ledger write)

  if empty → done

  subagent.run({ deliver: true, sessionKey: telegram })
    prompt: [all candidates inline]
    ↓
    read_intents + read_user_profiles   (MCP — evaluation context)
    ↓
    LLM picks high-value ones
    ↓
    confirm_opportunity_delivery(id)    (MCP — one call per chosen opp, writes ledger)
    ↓
    produces one delivery message       (→ user's Telegram)
```

If the evaluator finds no opportunity worth surfacing, it produces no output and calls no tools. The gateway does not deliver empty messages.

## Section 1: Backend

### New endpoint: `GET /api/agents/:id/opportunities/pending`

Location: `backend/src/controllers/agent.controller.ts`

- Auth: `AuthOrApiKeyGuard`
- Bumps `agents.last_seen_at` (same as existing pickup endpoints)
- Delegates to `OpportunityDeliveryService.fetchPendingCandidates(agentId)`
- Response: `{ opportunities: PendingCandidate[] }`

```ts
interface PendingCandidate {
  opportunityId: string;
  rendered: {
    headline: string;
    personalizedSummary: string;
    suggestedAction: string;
    narratorRemark: string;
  };
}
```

### New service method: `fetchPendingCandidates(agentId)`

Location: `backend/src/services/opportunity-delivery.service.ts`

Reuses the same SQL eligibility query from `pickupPending`:
- `status IN ('pending', 'draft')`
- User appears in `actors` JSONB array
- Draft visibility: `detection->>'createdBy' <> userId`
- `agents.notify_on_opportunity = true`
- No committed delivery row for `(userId, opportunityId, channel='openclaw', deliveredAtStatus=opp.status)`

Differences from `pickupPending`:
- No `INSERT` into `opportunity_deliveries`
- Returns all eligible rows (up to 20), not just the first one
- Returns `PendingCandidate[]` (opportunityId + rendered card per item)

No schema changes required.

## Section 2: MCP Tool

### New tool: `confirm_opportunity_delivery`

Location: `packages/protocol/src/opportunity/opportunity.tools.ts`

Input schema:
```ts
{ opportunityId: z.string() }
```

Behavior:
1. Verify the opportunity exists and `context.userId` is an actor on it
2. Insert a committed row into `opportunity_deliveries`:
   - `opportunityId`, `userId`, `agentId` (from auth context)
   - `channel = 'openclaw'`
   - `trigger = 'pending_pickup'`
   - `deliveredAtStatus = opp.status`
   - `deliveredAt = now()`
   - `reservedAt = now()` (no separate reservation phase)
3. If a committed row already exists for `(userId, opportunityId, channel, deliveredAtStatus)`: return success silently (idempotent — the existing partial unique index enforces at DB level)

The `agentId` is resolved from the MCP auth context via the existing `McpAuthResolver` (`metadata.agentId`).

## Section 3: Plugin

### Poll interval

`POLL_INTERVAL_MS`: `30_000` → `300_000` (5 minutes)

### Replace `handleOpportunityPickup` with `handleOpportunityBatch`

```
async function handleOpportunityBatch(api, baseUrl, agentId, apiKey):
  res = GET /api/agents/:agentId/opportunities/pending
  if empty → return false

  api.runtime.subagent.run({
    sessionKey: buildDeliverySessionKey(api),   // extracted from dispatchDelivery
    idempotencyKey: `index:delivery:opportunity-batch:${agentId}:${batchHash}`,
    message: opportunityEvaluatorPrompt(candidates),
    deliver: true,
  })

  return true
```

`batchHash` is a deterministic hash of the sorted opportunity IDs in the batch — ensures the same batch isn't re-evaluated if the poll fires twice before any state changes.

`dispatchDelivery` cannot be reused here — it wraps the message in `deliveryPrompt` ("relay faithfully, no user input"), which is the wrong framing for an evaluator that needs to reason and decide. Instead, extract a `buildDeliverySessionKey(api)` helper from `dispatchDelivery` and call `api.runtime.subagent.run` directly. `dispatchDelivery` itself keeps using `deliveryPrompt` for test-message delivery (unchanged).

### Remove

- `handleOpportunityPickup` function
- The `POST .../opportunities/pickup` and `POST .../opportunities/:id/delivered` calls from the plugin
- The per-opportunity confirm step

## Section 4: Prompt

### New file: `packages/openclaw-plugin/src/prompts/opportunity-evaluator.prompt.ts`

The prompt passed to the combined evaluator+delivery subagent. Structure:

1. **Role framing**: You are evaluating pending connection opportunities on behalf of your user. Your job is to surface only the ones that genuinely align with their active goals — not every opportunity, only the signal-rich ones.

2. **Evaluation instructions**:
   - First call `read_intents` and `read_user_profiles` to ground yourself in what the user is actively looking for
   - For each candidate, assess: does the counterpart's situation genuinely complement the user's active intents? Is the reasoning specific and substantive, not generic?
   - Reject weak, generic, or low-specificity matches
   - If none pass the bar: call no tools and produce absolutely no text output — not even a preamble. An empty response means nothing is worth surfacing.

3. **Action instructions**:
   - For each opportunity you choose to surface: call `confirm_opportunity_delivery` with its `opportunityId`
   - Then produce one Telegram-friendly message listing the chosen opportunities, one per line: headline + one-sentence summary + suggested next step
   - Do not ask the user for input. Do not add commentary beyond the opportunity content.

4. **Candidates block** (injected inline, fenced as untrusted data — same pattern as `turn.prompt.ts`):
   - Each candidate: opportunityId, headline, personalizedSummary, suggestedAction, narratorRemark

## Out of Scope

- Changes to `list_opportunities` (already works as the user's inbox for viewing all pending opportunities)
- Changes to `update_opportunity` (already handles accept/reject)
- SKILL.md updates (the user-facing behavior change is minor enough that existing guidance covers it)
- Test-message pickup (unchanged)
- Negotiation pickup (unchanged)
