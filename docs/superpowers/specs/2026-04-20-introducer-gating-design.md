# Introducer Gating: Block Negotiation Until Introducer Approves

**Date:** 2026-04-20
**Status:** Approved

---

## Problem

When ambient discovery creates an opportunity with an introducer actor, the negotiate node runs immediately — bypassing the introducer entirely. The two parties end up in a `pending` opportunity before the introducer has had any chance to review the match. The intended flow is that the introducer sees the opportunity first (as `latent`), explicitly approves it, and only then do the parties negotiate.

---

## Root Cause

`opportunity.graph.ts:3025` — the conditional edge after `persist` routes to `negotiate` unconditionally for all non-empty opportunity sets. There is no check for whether any of the opportunities has an unapproved introducer.

---

## Design

### 1. Data model: `OpportunityActor.approved`

Add an optional boolean field to `OpportunityActor`:

```typescript
export interface OpportunityActor {
  networkId: Id<'networks'>;
  userId: Id<'users'>;
  intent?: Id<'intents'>;
  role: string;
  approved?: boolean;   // NEW — only meaningful on role === 'introducer'
}
```

`actors` is JSONB so this is a type-only change — no DB migration needed.

When the persist node creates an introducer-pattern opportunity, the introducer actor is written with `approved: false` (explicit) so the gate has a clear signal.

### 2. Negotiate node: per-opportunity gate

Inside `negotiateNode` when building `candidateEntries` (~line 1673 of `opportunity.graph.ts`), skip any opportunity whose introducer has not yet approved:

```typescript
const introducerActor = (opp.actors as OpportunityActor[])
  .find(a => a.role === 'introducer');
if (introducerActor && introducerActor.approved !== true) return null;
```

This is per-opportunity. A batch that mixes direct-match and introducer opportunities negotiates the former and skips the latter.

### 3. New operation mode: `negotiate_existing`

A new `operationMode: 'negotiate_existing'` on the opportunity graph that:

1. Receives `opportunityId` in graph state
2. Loads the opportunity from DB
3. Derives `sourceUser` and `candidates` from the opportunity's actors: the `patient` actor becomes `sourceUser` (they are the seeking party, equivalent to `discoveryUserId` in the direct-match flow); the remaining non-introducer actor becomes the single candidate. If no `patient` exists (peer-only), either non-introducer actor can be `sourceUser`.
4. Routes directly to the existing `negotiateNode`

This reuses the complete negotiate node — park window logic, personal agent detection, index context, trace instrumentation, status transitions — without duplication.

### 4. Introducer approval action: `approve_introduction`

A new `operationMode: 'approve_introduction'` on the opportunity graph that:

1. Receives `opportunityId` and `userId` (the approving introducer)
2. Verifies `userId` is the introducer actor on the opportunity
3. Sets `approved: true` on the introducer actor in the DB (status stays `latent`)
4. Enqueues an opportunity queue job with `operationMode: 'negotiate_existing'` and `opportunityId`

The opportunity then goes through the exact same negotiation flow as a newly-created direct-match latent opportunity. On negotiation resolution, the finalize node sets status to `pending`, `rejected`, or `stalled` as normal.

---

## Status Flow

**Before this change (broken):**
```
latent → [negotiate runs immediately] → pending
                                         ↑ parties see it, introducer never reviewed
```

**After this change:**
```
latent → [introducer reviews]
       → approve_introduction → enqueue negotiate_existing job
       → [negotiate between parties] → pending / rejected / stalled
```

---

## Visibility

No change to the visibility matrix. The `latent` status remains invisible to parties (patient, agent) and visible to the introducer per the existing "Introducer: Always" rule. Parties only see the opportunity once it reaches `pending` or `stalled`.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/protocol/src/shared/interfaces/database.interface.ts` | Add `approved?: boolean` to `OpportunityActor` |
| `packages/protocol/src/opportunity/opportunity.graph.ts` | (1) Per-opportunity introducer gate in `negotiateNode`; (2) New `negotiate_existing` operation mode; (3) New `approve_introduction` operation mode; (4) Update `routeByMode` to handle new modes; (5) Set `approved: false` on introducer actor at persist time |
| `backend/src/queues/opportunity.queue.ts` | Handle `negotiate_existing` job type |

---

## Out of Scope

- Frontend UI for the introducer approval action (surfaces the `approve_introduction` operation via MCP tool or API endpoint — separate work)
- Introducer rejection (blocking the connection entirely before negotiation) — can be added as a follow-on
- Notifications to the introducer when a `latent` introducer opportunity is created — separate work
