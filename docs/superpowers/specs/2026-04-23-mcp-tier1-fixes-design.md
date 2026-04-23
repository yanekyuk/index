# MCP Tool Layer Fixes — Tier 1

**Date:** 2026-04-23  
**Scope:** `packages/protocol/src/*/tools.ts` only — no graph, service, or DB changes.

---

## Background

A full MCP test session surfaced 22 issues across the Index Network MCP surface. This spec covers the **Tier 1** subset: fixes that live entirely in the tool handler layer (response shape, tool descriptions, pagination). Tier 2 (backend service behavior) and Tier 3 (data quality) are separate efforts.

---

## Changes by File

### 1. `negotiation/negotiation.tools.ts` — `list_negotiations`

**Problem A — stale `isUsersTurn` on completed negotiations.**  
The current implementation always computes `isUsersTurn` from message count parity (`turnCount % 2`). Once a negotiation is completed, this produces a meaningless and misleading value (many completed negotiations show `isUsersTurn: true`).

**Fix:** Gate on status. When the mapped `status === 'completed'`, return `isUsersTurn: false` unconditionally. Apply the same gate in `get_negotiation` for consistency.

**Problem B — `latestMessagePreview` leaks internal LLM reasoning.**  
The field is sourced from `lastTurnData?.assessment?.reasoning` — the agent's internal chain-of-thought prompt language. This should never reach the user.

**Fix:** Source from `lastTurnData?.message` instead. If `message` is null or empty, return `null` for the preview. Do not fall back to `reasoning`.

**Problem C — no pagination.**  
The handler fetches all tasks for the user and returns them in one shot (currently 33 for the test account with no upper bound).

**Fix:** Add `limit: z.number().int().min(1).max(100).optional()` (default 25) and `page: z.number().int().min(1).optional()` (default 1) to the query schema. Apply pagination after filtering, before returning. Include `totalCount` and `totalPages` in the response when pagination params are supplied.

---

### 2. `contact/contact.tools.ts` — `search_contacts`

**Problem — field name inconsistency.**  
`ContactService.searchContacts()` returns rows with field `contactId`. The tool passes rows through raw, exposing `contactId`. But `list_contacts` exposes `userId` for the same entity. Any agent chaining `search_contacts` → `read_user_profiles` must handle a rename.

**Fix:** In the `search_contacts` handler, remap the response:
```ts
contacts: rows.map(r => ({
  userId: r.contactId,
  name: r.name,
  email: r.email,
  avatar: r.avatar,
  isGhost: r.isGhost,
}))
```
Update the tool description to say `userId` not `contactId`.

---

### 3. `agent/agent.tools.ts` — `register_agent`

**Problem — unhelpful error message when called from an agent context.**  
`register_agent` is blocked when `context.agentId` is present (i.e., when the caller is already an agent). The current error `"This agent can only manage its own registration."` doesn't tell the caller what to do instead.

**Fix:** Replace the error message with:
> `"Agent registration must be done from a user session (web UI or personal API key), not from within an existing agent context. To register a new agent, visit the Index web app."`

The guard logic (`if (context.agentId)`) stays unchanged.

---

### 4. `intent/intent.tools.ts` — three changes

**4a. `create_intent` description — remove web-UI-centric text.**  
The description contains a "Proposal card contract" section (the `VERBATIM` / `intent_proposal` block) that is web-UI-only behavior. It contradicts the MCP guide (which correctly says to use `autoApprove: true`) and confuses MCP agents.

**Fix:** Remove the "Proposal card contract." paragraph from the description (lines 173–175 of current file). The `autoApprove` param description is already accurate and sufficient. The remaining description text stays.

**4b. `update_intent` response — return affected intent data.**  
Currently returns only `{ message: "Intent updated." }`. The caller must issue a follow-up `read_intents` call to verify what changed.

**Fix:** Include `intentId` and `description` (the new description that was applied) in the success response:
```ts
return success({
  message: "Intent updated.",
  intentId,
  description: query.description,
  ...
});
```

**4c. `delete_intent` — vocabulary consistency.**  
The tool name is `delete_intent`, the description says "Archives (soft-deletes)", and the success message says `"Intent archived."` — three distinct framings. The description is already correct (soft-delete is the right framing). Fix the success message to match: change `"Intent archived."` to `"Intent archived successfully."` (no other changes).

---

## Out of Scope (Tier 2)

The following require changes below the tool layer and are deferred:

| Issue | Location | Reason |
|-------|----------|---------|
| `read_intents` missing `confidence`/`inferenceType` | `intent.graph.ts` read node | DB map doesn't include these fields |
| `read_intent_indexes` missing `relevancyScore` | `indexer.graph.ts` read node | Not in the graph's DB query |
| `summary` always null | Intent generation pipeline | Not a tools-layer issue |
| `create_network` `prompt`/`description` naming | Network graph output | Field renamed inside the graph |
| `grant_agent_permission` creates new rows per call | `agent.service.ts` | DB upsert behavior |
| `isUsersTurn` stale on completed (`get_negotiation`) | Same fix as `list_negotiations` | Included in change 1 above |

---

## Files Changed

```
packages/protocol/src/negotiation/negotiation.tools.ts
packages/protocol/src/contact/contact.tools.ts
packages/protocol/src/agent/agent.tools.ts
packages/protocol/src/intent/intent.tools.ts
```

No schema changes, no DB migrations, no graph changes.

---

## Testing

- After changes, run `bun run tsc --noEmit` in `packages/protocol/` to confirm no type errors.
- Manually verify with MCP:
  - `list_negotiations` with status=`completed` → all have `isUsersTurn: false`
  - `list_negotiations` with `limit=5&page=1` → returns 5 results with `totalCount`
  - `list_negotiations` preview fields contain user-facing messages, not reasoning
  - `search_contacts` returns `userId` not `contactId`
  - `register_agent` from agent context → helpful error message
  - `update_intent` response includes `intentId` and `description`
