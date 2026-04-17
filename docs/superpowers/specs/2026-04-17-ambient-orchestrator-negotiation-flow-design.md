# Ambient / Orchestrator Negotiation Flow — Design Spec

**Date:** 2026-04-17
**Status:** Draft (pending user review)
**Related Linear issues:** IND-233, IND-234, IND-235, IND-236, IND-237

## Summary

The opportunity-to-negotiation pipeline today has two divergent paths: an **ambient** flow (queue-triggered, negotiates in the background, parks on any registered personal agent for up to 24h) and a **chat/API discovery** flow (synchronous, skips negotiation entirely, returns `pending` rows). They live in the same `OpportunityGraph` but branch inconsistently.

This spec unifies them into one graph parameterized by a `trigger: 'ambient' | 'orchestrator'` input. Both triggers run the same nodes (HyDE → evaluate → rank → dedup → persist → negotiate → finalize); they differ only in a small set of parameters: HyDE seed, initial persist status, dispatch timing, streaming, abort handling, and terminal status on agent-accept.

The spec also introduces heartbeat-aware dispatch: the dispatcher checks an agent's `lastSeenAt` before parking a turn. Stale or missing personal agents → system agent inline; fresh agents → park for a bounded response window (5 min ambient, 60 s orchestrator). This collapses ambient latency from "up to 24h" to "seconds to minutes" for offline-agent users.

## Goals

1. Single source of truth for the opportunity-lifecycle state machine across triggers.
2. Heartbeat-aware dispatch so ambient opportunities materialize fast even when personal agents are down.
3. Orchestrator (chat) path runs bilateral negotiation per candidate and streams per-match results to the chat UI.
4. Bounded, observable behavior: one response-window budget per negotiation turn, not stacked timers.
5. No schema changes except `agents.last_seen_at`.

## Non-goals

Filed separately and referenced where relevant:

- **IND-233** — split the overloaded `expired` status into distinct terminals (merged / dismissed / orphaned / TTL).
- **IND-234** — unify API vs reconciler intent-archival cascade and preserve accepted/rejected opps from the cascade.
- **IND-235** — per-path TTLs and scheduled expiry sweep.
- **IND-236** — orchestrator-path abort cleanup (in-flight negotiations, parked tasks, 24h timers).
- **IND-237** — h2h chat surface renders accepted opps inline with messages.

## Status machine (no schema change)

Existing enum is kept as-is: `latent | draft | negotiating | pending | stalled | accepted | rejected | expired`.

### Path lifecycles

| Phase | Ambient (queue trigger) | Orchestrator (chat trigger) |
|---|---|---|
| Discovered, not yet examined | `latent` | — (skipped) |
| Negotiation in flight | `negotiating` | `negotiating` |
| Agents rejected | `rejected` | `rejected` |
| Turn-capped | `stalled` | `stalled` |
| Agents accepted, awaiting user approval | `pending` (home feed) | `draft` (in chat) |
| User pressed "Start Chat" (terminal) | `accepted` | `accepted` |

### Trigger parameters

| Parameter | Ambient | Orchestrator |
|---|---|---|
| Trigger source | `OpportunityQueue.addJob` (intent/membership/cron events) | `create_opportunities` tool from `ChatAgent` |
| HyDE seed text | intent payload | user's chat search query |
| Initial persist status (non-duplicate candidates) | `latent` | `negotiating` |
| Park-window `timeoutMs` if dispatcher parks | 5 min | 60 s |
| Streaming events to chat writer | none | `opportunity_draft_ready` per resolved draft |
| `AbortSignal` honored | no (durable background work) | yes (see IND-236) |
| Terminal status on agent-accept | `pending` | `draft` |
| Concurrency of per-candidate negotiation fan-out | whatever BullMQ worker concurrency permits | unbounded `Promise.allSettled` (revisit only if rate limits or DB pool become a problem) |

## Unified `OpportunityGraph`

Same graph, same node sequence, parameterized on `trigger`:

```
seed → HyDE → evaluate → rank → dedup → persist → negotiate → finalize
```

| Node | Trigger-agnostic behavior | Trigger-specific branches |
|---|---|---|
| seed | Normalize input into HyDE seed text | Ambient: from intent payload. Orchestrator: from user query. |
| HyDE | Generate hypothetical documents, embed | Identical. |
| evaluate | LLM scores candidates | Identical. |
| rank | Order candidates by score + recency | Identical. |
| dedup | For each candidate, run `opportunity.enricher` semantic-relatedness against existing opps between same actors (all statuses except `negotiating` and `accepted`; see below) | Identical. |
| persist | Insert non-duplicate candidates | Ambient writes `latent`. Orchestrator writes `negotiating`. |
| negotiate | For each persisted candidate, invoke `NegotiationGraph` | Ambient: runs to completion, ignores `AbortSignal`. Orchestrator: unbounded fan-out, emits `opportunity_draft_ready` events as each resolves, honors `AbortSignal` (IND-236). |
| finalize | Map per-candidate negotiation outcomes → terminal opp status | Ambient: accept → `pending`. Orchestrator: accept → `draft`. Both: reject → `rejected`, stall → `stalled`. |

Under the old code the chat/API discovery path skipped the `negotiate` node. Under this design, orchestrator runs `negotiate` like ambient does — the difference is concurrency + streaming + abort, not presence.

## Heartbeat on `agents`

The one schema change in this design:

```sql
ALTER TABLE agents ADD COLUMN last_seen_at timestamp with time zone;
CREATE INDEX agents_last_seen_at_idx ON agents (last_seen_at);
```

**Update sites** — every personal-agent-facing pickup endpoint writes `lastSeenAt = now()` before any other work:

- `POST /agents/:id/negotiations/pickup`
- `POST /agents/:id/opportunities/pickup`
- `POST /agents/:id/test-messages/pickup`

Empty polls ("nothing pending") must also bump `lastSeenAt` — otherwise an idle but healthy agent would look stale.

**Freshness predicate:** `lastSeenAt > now() - interval '90 seconds'`. Justification: the openclaw plugin polls every 30s ([POLL_INTERVAL_MS](packages/openclaw-plugin/src/index.ts:28)); 90 s is three poll cycles of tolerance.

## Dispatcher rewrite

Replaces the current `isLongTimeout = timeoutMs > 60_000` park/inline gate ([agent-dispatcher.service.ts:68](backend/src/services/agent-dispatcher.service.ts:68)). New logic:

```
dispatch(userId, scope, payload, { timeoutMs }):
  agents = findAuthorizedAgents(userId, scope)
  personal = agents.filter(type === 'personal')

  if personal is empty:
    return { handled: false, reason: 'no_agent' }      // system inline

  fresh = personal.some(a => a.lastSeenAt > now() - 90s)
  if not fresh:
    return { handled: false, reason: 'timeout' }       // system inline
                                                        // (reusing existing 'timeout' reason;
                                                        //  the graph already falls back to
                                                        //  system agent on this return)

  await timeoutQueue.enqueueTimeout(negotiationId, history.length, timeoutMs)
  return { handled: false, reason: 'waiting', resumeToken: negotiationId }
```

`timeoutMs` now means "park-window budget," not "is this call long or short." Callers pass 5 min (ambient) or 60 s (orchestrator). No new `AgentDispatchResult.reason` values are introduced — the stale-heartbeat case reuses the existing `timeout` branch.

### Dispatch matrix (per negotiation turn)

| Trigger | Personal agent registered? | Heartbeat | Outcome |
|---|---|---|---|
| Ambient | No | — | System `IndexNegotiator` inline |
| Ambient | Yes | Fresh (`< 90 s`) | Park, 5 min response window |
| Ambient | Yes | Stale (`≥ 90 s`) or never | System inline |
| Orchestrator | No | — | System inline |
| Orchestrator | Yes | Fresh | Park, 60 s response window |
| Orchestrator | Yes | Stale | System inline |

### Dead / defensive code after this change

- **Short-timeout branch** in the dispatcher (lines 101–108 today): removed. The new path is a single branch; "system inline" is expressed by returning `no_agent` or `stale_agent`.
- **24h timer queue** (`negotiation-timeout.queue`): kept as a defensive backstop. Under the new dispatch rule, parked turns have a 5 min (or 60 s) response-window timer; the 24h queue should almost never fire. It remains intact for pathological cases (clock drift, missed cancellations).

## Timer reconciliation — one budget, not two

The current two-queue architecture stays intact structurally (`negotiation-timeout.queue` for `waiting_for_agent`; `negotiation-claim-timeout.queue` for `claimed`), but the timers now share a single budget instead of stacking.

- At dispatch time: arm `negotiation-timeout.queue` with `timeoutMs` (5 min ambient / 60 s orchestrator).
- At pickup time ([negotiation-polling.service.ts:220-225](backend/src/services/negotiation-polling.service.ts:220)): cancel the `waiting_for_agent` timer; arm the claim timer with the **remaining** budget — `timeoutMs - (now - parkStartTime)` — not a fresh 5 min.
- On response: cancel all timers, graph continues.
- On timeout firing (either queue): system-agent fallback runs (existing logic in both queue files).

Concretely, `negotiation-claim-timeout.queue.enqueueTimeout(...)` gains a `delayMs` parameter instead of the hardcoded 6 h; the pickup handler computes the remaining budget before calling it.

## Streaming: domain events

Extend `AgentStreamEvent` ([chat.agent.ts:55-74](packages/protocol/src/chat/chat.agent.ts:55)) with a single orchestrator-specific event:

```ts
| { type: "opportunity_draft_ready"; opportunityId: string; rendered: RenderedOpportunityCard }
```

This is the only UI-facing stream event. `rejected` / `stalled` / `waiting_for_agent` / aborted states do **not** emit events. A card appears in the chat only when there's a real `draft` to act on. The tool's final summary string narrates misses ("2 matches ready, 1 didn't work out").

`RenderedOpportunityCard` is the existing shape already used for opportunity cards in chat.

Events flow via the existing `requestContext.traceEmitter → writer` chain ([chat.agent.ts:850-854](packages/protocol/src/chat/chat.agent.ts:850)). The `negotiate` node's orchestrator branch calls `traceEmitter` as each candidate resolves. No new infrastructure.

## Dedup + enrichment

The `dedup` node has two concerns:

1. **Enrichment** — query non-terminal and non-`accepted` opps between the candidate's actors, run them through `opportunity.enricher.ts`'s two-phase semantic-relatedness check, decide whether to merge.
2. **Accepted-pair linking** (orchestrator only) — separately query `accepted` opps between the same actor pair; any hit surfaces in the tool's `alreadyAccepted` result for the LLM to link to the existing conversation. This is a read-only lookup; accepted opps are never fed to the enricher and never modified here.

Result determines behavior:

| Existing related opp | Behavior |
|---|---|
| `negotiating` | Skip — don't interrupt in-flight. Surfaced silently (not in summary). |
| `accepted` | Not enriched, not expired. Surface in orchestrator's `alreadyAccepted` summary with linked chat URL. In-chat rendering of accepted opps is IND-237. |
| `latent` / `pending` / `draft` / `rejected` / `stalled` / `expired` | Standard enricher. If enrichment produces a new opp: old rows expire with "merged" reason (pending IND-233), new opp enters persist → negotiate pipeline. If enricher returns `enriched: false` (no material addition), orchestrator returns the existing row as-is → `existingDrafts`. |

The `accepted` exclusion is deliberate: accepted opps are historical records preserved for the h2h chat timeline (IND-237). They feed the **conversation-linking** logic in the orchestrator's summary but do not feed enrichment.

## `create_opportunities` tool output

Structured result returned to the LLM (chat ReAct loop):

```ts
{
  newDrafts:        Array<{ opportunityId, rendered }>,
  existingDrafts:   Array<{ opportunityId, rendered, source: 'ambient' | 'prior_chat' }>,
  alreadyAccepted:  Array<{ opportunityId, conversationId, conversationUrl, counterpartyName }>,
  summary: string,  // e.g. "2 new drafts ready, 1 existing, 1 active chat linked"
}
```

Silently dropped from the result (no keys for them): `rejected`, `stalled`, `expired`, aborted candidates.

Stream events fire for `newDrafts` and `existingDrafts`; `alreadyAccepted` items are narrated inline by the LLM using `conversationUrl`.

## Start Chat flow

Atomic handler invoked from the home feed (pending) or chat (draft):

```
startChat(opportunityId, userId):
  BEGIN TRANSACTION
    load opp; assert status ∈ {pending, draft}; assert user ∈ opp.actors
    update opp.status = 'accepted'
    lookup or insert conversations row by dmPair (existing dmPair uniqueness enforces 1-per-pair)
    upsert conversationParticipants for each actor
  COMMIT
  return { conversationId }
```

Notes:

- **Conversation reuse:** the `conversations.dmPair` unique index already enforces one conversation per participant pair. Subsequent "Start Chat" presses on opps between the same pair find the existing conversation rather than creating duplicates.
- **No seed message.** The grounding context the user needs to see comes from the accepted opportunity itself, which IND-237 will render inline in the chat timeline alongside messages. Inserting a separate system message would duplicate that content.
- **No FK from conversations to opportunities.** The accepted opp lives independently of the conversation; the link is resolved at read time by joining participant pair + accepted status. This is the current schema.
- **Bilateral agent-accept is sufficient consent.** Both users see the conversation live immediately; no separate per-user opt-in step.

## Abort handling

Scoped to IND-236. This design depends on that ticket delivering:

- `AbortSignal` propagation from `ChatAgent.streamRun` through `create_opportunities` → `OpportunityGraph.invoke` → per-candidate `NegotiationGraph.invoke`.
- Transition of `waiting_for_agent` tasks created by the aborted run to `canceled`, with their park-window timers cancelled.
- Flip opp rows still at `status='negotiating'` to `expired` (with "canceled" reason, pending IND-233).
- No `opportunity_draft_ready` events emitted after abort.

## Out of scope

Explicitly deferred to the referenced Linear issues:

- Splitting `expired` into reason-bearing terminal statuses (**IND-233**). This spec writes `expired` with current semantics; IND-233 refines it.
- Unifying intent-archival cascade across API vs reconciler (**IND-234**). Unrelated to flow redesign but shares the "preserve terminal statuses" principle.
- Per-path TTLs and scheduling the expiry sweep (**IND-235**). TTL-based expiry is orthogonal to this spec.
- Orchestrator-path abort cleanup (**IND-236**). This spec assumes the abort semantics IND-236 defines.
- Rendering accepted opps inline in h2h chat timeline (**IND-237**). The dedup rule here preserves accepted opps specifically so IND-237 has stable inputs.

## Files touched (high-level; sizing belongs to the implementation plan)

- `packages/protocol/src/opportunity/opportunity.graph.ts` — add `trigger` parameter, orchestrator branch in `negotiate` node.
- `packages/protocol/src/opportunity/opportunity.persist.ts` — initial status based on trigger.
- `packages/protocol/src/opportunity/opportunity.enricher.ts` — exclude `accepted` and `negotiating` from merge candidate pool. (Already semantically aligned; the exclusion is a filter on `excludeStatuses`.)
- `packages/protocol/src/chat/chat.agent.ts` — extend `AgentStreamEvent` union with `opportunity_draft_ready`.
- `packages/protocol/src/opportunity/opportunity.tools.ts` (or wherever `create_opportunities` lives) — orchestrator branch, structured result shape, abort threading.
- `backend/src/schemas/database.schema.ts` + migration — add `agents.last_seen_at`.
- `backend/src/services/agent-dispatcher.service.ts` — rewrite per the new policy.
- `backend/src/services/negotiation-polling.service.ts` — bump `lastSeenAt`; compute remaining budget on pickup.
- `backend/src/controllers/agent.controller.ts` — other pickup endpoints also bump `lastSeenAt`.
- `backend/src/queues/negotiation-claim-timeout.queue.ts` — accept `delayMs` parameter.
- A new endpoint (or augmentation to existing `PATCH /opportunities/:id/status`) for the atomic Start Chat transition.
- Frontend: subscribe to `opportunity_draft_ready` events; wire the existing "Start Chat" UI to the atomic handler.

## Risks and reversible decisions

- **Unbounded negotiation fan-out** — may trip OpenRouter rate limits under heavy orchestrator use. Mitigation: add a `p-limit` cap if 429s materialize. Reversible in one line.
- **90 s heartbeat threshold** — if agents' network latency jitter exceeds expectations, fresh agents may be misclassified as stale. Tunable via a single constant; revisit with production telemetry.
- **5 min ambient window** — aggressive vs current 24 h. If too tight (e.g. agents under high poll load), widen. Tunable per trigger.
- **Empty-poll `lastSeenAt` bump** creates write traffic proportional to personal-agent count × polls/minute. At 30 s polling that's 2 writes/min per agent; cheap, but flagged if user scale grows significantly.
