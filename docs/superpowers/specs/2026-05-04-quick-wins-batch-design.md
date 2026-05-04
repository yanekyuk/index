# Quick Wins Batch: IND-241, IND-238, IND-239

Three independent, low-risk fixes shipped as one branch (`fix/quick-wins-batch`) with one commit per fix.

## Fix 1: IND-241 — Introducer discovery detection.source

**Problem:** Introducer-discovered opportunities are persisted with `detection.source: 'manual'` instead of `'introducer_discovery'`. The constant `INTRODUCER_DISCOVERY_SOURCE` exists but is unused in the persist path.

**Changes:**

| File | Change |
|---|---|
| `packages/protocol/src/opportunity/opportunity.graph.ts` ~L2439 | Replace `source: 'manual'` with `source: INTRODUCER_DISCOVERY_SOURCE` (import from `opportunity.introducer.ts`) |
| Same file ~L2452 | Update `curator_judgment` detail string to `"Introducer discovery for ... via background maintenance"` |
| `backend/tests/introducer-discovery.spec.ts` | Add assertion that persisted opportunities have `detection.source === 'introducer_discovery'` |

## Fix 2: IND-238 — Persist felicityClarity to database

**Problem:** The clarity felicity score is computed by `intent.verifier.ts` and used at runtime, but never stored. Only `felicityAuthority` and `felicitySincerity` are persisted.

**Changes:**

| File | Change |
|---|---|
| `backend/src/schemas/database.schema.ts` ~L321 | Add `felicityClarity: integer('felicity_clarity')` after `felicitySincerity` |
| Migration | `bun run db:generate`, rename to `NNNN_add_intent_felicity_clarity.sql`, update `_journal.json` tag |
| `packages/protocol/src/shared/interfaces/database.interface.ts` | Add `felicityClarity?: number \| null` to `CreateIntentData` (~L133) and `UpdateIntentData` (~L162) |
| `backend/src/adapters/database.adapter.ts` — local interfaces | Add `felicityClarity?: number \| null` to `CreateIntentInput` (~L110) and `UpdateIntentInput` (~L122) |
| `backend/src/adapters/database.adapter.ts` — `IntentDatabaseAdapter.createIntent` | Add `felicityClarity: data.felicityClarity ?? undefined` to insert values (~L263) |
| `backend/src/adapters/database.adapter.ts` — `IntentDatabaseAdapter.updateIntent` | Add `if (data.felicityClarity !== undefined) updateData.felicityClarity = data.felicityClarity` (~L294) |
| `backend/src/adapters/database.adapter.ts` — `ChatDatabaseAdapter.createIntent` | Same as IntentDatabaseAdapter.createIntent (~L1051) |
| `backend/src/adapters/database.adapter.ts` — `ChatDatabaseAdapter.updateIntent` | Same as IntentDatabaseAdapter.updateIntent (~L1081) |
| `packages/protocol/src/intent/intent.graph.ts` — create path ~L553 | Add `felicityClarity: matchedVerifiedIntent?.verification?.felicity_scores.clarity ?? null` |
| `packages/protocol/src/intent/intent.graph.ts` — update path ~L600 | Same |

## Fix 3: IND-239 — respond_to_negotiation schema alignment

**Problem:** The `respond_to_negotiation` MCP tool's Zod schema only accepts `negotiationId`, `action`, and optional `message`. The domain doc specifies `reasoning` and `suggestedRoles` as required fields, but the handler hardcodes stubs (`'peer'/'peer'`, message fallback).

**Changes:**

| File | Change |
|---|---|
| `packages/protocol/src/negotiation/negotiation.tools.ts` — querySchema ~L304 | Add `reasoning: z.string()` (required) |
| Same | Add `suggestedRoles: z.object({ ownUser: z.enum(['agent', 'patient', 'peer']), otherUser: z.enum(['agent', 'patient', 'peer']) })` (required) |
| Same — action enum | Add `'propose'` to align with `NegotiationTurnSchema` and domain doc |
| Same — handler ~L355-358 | Replace `reasoning: query.message ?? ...` with `reasoning: query.reasoning` |
| Same — handler ~L357 | Replace `suggestedRoles: { ownUser: 'peer', otherUser: 'peer' }` with `suggestedRoles: query.suggestedRoles` |

## Branch strategy

- Branch: `fix/quick-wins-batch` off `dev`
- Three atomic commits, one per fix
- Single PR into `upstream/dev`
