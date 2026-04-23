# MCP Tool Layer Fixes — Tier 2

**Date:** 2026-04-23  
**Scope:** Graph layer (`packages/protocol/src/*/`) + DB adapter (`backend/src/adapters/database.adapter.ts`) + agent service (`backend/src/services/agent.service.ts`). No schema migrations, no frontend changes, no plugin changes.

---

## Background

Tier 1 fixed issues that lived entirely in the tool handler layer (response shape, field naming, pagination). Tier 2 fixes issues that require changes one layer deeper: the graph read nodes and the DB query layer that feeds them.

Four fixes are in scope. `summary` always null (Tier 2 candidate) is deferred — it requires investigation into the intent generation pipeline and is tracked separately.

---

## Changes

### 1. `read_intents` — add `confidence` and `inferenceType`

**Problem:** The `getActiveIntents`, `getIntentsInIndexForMember`, and `getNetworkIntentsForMember` DB queries only select `id`, `payload`, `summary`, `createdAt`. The `confidence` and `inferenceType` columns exist in the `intents` table and are populated at creation time, but are never fetched. The intent graph maps only what the DB returns, so agents calling `read_intents` never see these fields.

**Fix:**

`backend/src/adapters/database.adapter.ts`:
- Add `confidence` and `inferenceType` to the `ActiveIntentRow` interface
- Add both columns to the `select({})` call in `getActiveIntents`, `getIntentsInIndexForMember`, and `getNetworkIntentsForMember`

`packages/protocol/src/intent/intent.graph.ts`:
- Add `confidence` and `inferenceType` to every `readResult.intents` map: global read (no index scope), index-scoped read (all members), and user-filtered read (specific member in index)

---

### 2. `read_intent_indexes` — add `relevancyScore`

**Problem:** The indexer graph builds `links` arrays in `intents_in_network` mode from `getNetworkIntentsForMember` and `getIntentsInIndexForMember`, but neither query joins `intent_networks.relevancy_score`. The score is stored and accessible (used by the opportunity discovery pipeline via `getIntentIndexScores`), but never surfaced to MCP callers. The tool description already says it returns "relevancy scores (0-1)" — the data just isn't wired through.

**Fix:**

`backend/src/adapters/database.adapter.ts`:
- Extend `getNetworkIntentsForMember` to join `intent_networks.relevancyScore` and include it in the returned row type
- Extend `getIntentsInIndexForMember` to join `intent_networks.relevancyScore` and include it in the returned row type

`packages/protocol/src/network/indexer/indexer.graph.ts`:
- Add `relevancyScore` to each `links` entry in `intents_in_network` mode (both the all-members and the user-filtered branches)

The `check_link` and `networks_for_intent` read modes are not changed — they don't have a meaningful per-network relevancy score to surface.

---

### 3. `read_networks` — rename `description` → `prompt` in graph output

**Problem:** The network graph read node renames the DB column `prompt` to `description` when building all readResult objects. The DB schema, frontend types, and MCP tool input all use `prompt`. Agents calling `read_networks` get back `description`; everything else in the system uses `prompt`. This means `create_network({ prompt: "..." })` followed by `read_networks()` returns a different field name for the same data.

**Fix:**

`packages/protocol/src/network/network.state.ts`:
- Rename the `description` field to `prompt` in the readResult type definition (~3 occurrences)

`packages/protocol/src/network/network.graph.ts`:
- Change `description: *.prompt` → `prompt: *.prompt` in all readResult object literals (~6 occurrences: lines 63, 70, 81, 91, 96)

No frontend changes — frontend already expects `prompt`. No DB changes — DB column is already named `prompt`.

---

### 4. `grant_agent_permission` — upsert on conflict

**Problem:** `AgentService.grantPermission` calls `this.db.grantPermission(...)` which performs a plain `INSERT` with no conflict handling. Calling it twice for the same `(agentId, userId, scope, scopeId)` combination creates duplicate permission rows. MCP agents calling `grant_agent_permission` repeatedly (e.g. to ensure a permission exists) accumulate rows silently.

There is already an `upsertGlobalPermission` method used for the specific manage-negotiations toggle case; the fix generalizes upsert behavior to the main `grantPermission` DB method.

**Fix:**

`backend/src/adapters/database.adapter.ts`:
- Change the `grantPermission` DB method to use `onConflictDoUpdate` keyed on the unique partial index for `(agentId, userId, scope, scopeId)`, merging the `actions` array on conflict (use `sql` to union the arrays, or replace with the new value — replacing is simpler and safe since callers pass the full desired action set)

No changes to `agent.service.ts` — the service passes the right fields already.

---

## Files Changed

```
backend/src/adapters/database.adapter.ts
packages/protocol/src/intent/intent.graph.ts
packages/protocol/src/network/indexer/indexer.graph.ts
packages/protocol/src/network/network.graph.ts
packages/protocol/src/network/network.state.ts
```

No schema migrations. No frontend changes. No openclaw-plugin or claude-plugin changes (verified: none of these fields are referenced by consumers).

---

## Testing

- `backend/src/adapters/database.adapter.ts` changes: integration tests in `backend/tests/` following the existing adapter test pattern
- Graph changes: unit tests using the tool-layer mock pattern from Tier 1 (mock `deps`, invoke handler, assert response shape)
- Run `bun run tsc --noEmit` in `packages/protocol/` and `backend/` to confirm no type errors after changes

---

## Out of Scope

| Issue | Reason |
|-------|--------|
| `summary` always null | Requires intent generation pipeline investigation — deferred |
| `read_intents` missing `speechActType` | Not confirmed as a populated column; audit needed before adding |
