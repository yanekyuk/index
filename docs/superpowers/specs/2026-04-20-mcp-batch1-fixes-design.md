# MCP Batch 1 Fixes — Design Spec

**Date:** 2026-04-20  
**Scope:** Quick-win fixes to the MCP layer. No graph/DB investigation required.  
**Out of scope (Batch 2):** `read_intents` missing fields, `read_intent_indexes` returning `{}`, `isPersonal` in membership tools.

---

## Background

A full MCP test session against `protocol.dev.index.network/mcp` surfaced ten issues. This spec covers the seven that can be fixed without touching the graph or DB query layer:

1. `_graphTimings` internal timing data exposed in all graph-backed responses
2. `isError` never set to `true` in the MCP envelope for business-logic failures
3. `search_intents` / `search_contacts` schema param named `q`, expected `query`
4. `update_intent` schema param named `newDescription`, expected `description`
5. `read_networks` description references `ownerOf` (actual key is `owns`), `publicIndexes` undocumented, `isPersonal` absent from `memberOf` entries
6. `network.graph.ts` drops `isPersonal` when serializing `memberOf` (data is present in DB result)
7. `delete_network` success message says "Index deleted." (internal vocabulary)
8. `update_user_profile` description does not document the verb-instruction interface

---

## Section 1 — MCP Transport Post-Processing (`mcp.server.ts`)

### Problem

- Every graph-backed tool embeds `_graphTimings` (LangGraph execution timing) in its JSON response. External MCP callers receive this internal debug data.
- When a tool returns `{ success: false, error: "..." }`, the MCP envelope has `isError` absent (falsy). The MCP spec intends `isError: true` to signal tool failure. AI clients must check both the envelope and the inner `success` field to detect errors.

### Solution

Add a `sanitizeMcpResult(text: string): { text: string; isError: boolean }` pure function in `mcp.server.ts`, called after each tool handler returns its string result and before it is placed in `content[0].text`.

**Responsibilities:**

1. **Strip internal keys:** Parse the JSON string. If the parsed object has a `data` key, delete any key within `data` whose name starts with `_` (e.g. `_graphTimings`, any future `_debug*` fields). Re-serialize. If parsing fails, pass through unchanged.

2. **Promote `isError`:** If the parsed object has `success: false`, return `isError: true`. Otherwise return `isError: false`.

**Invariants:**
- If JSON parsing throws, the function returns the original text with `isError: false` (fail-open, don't break valid responses).
- Only keys directly inside `data` are stripped. Top-level keys (`success`, `error`) are untouched.
- The function is pure and has no side effects.

**Placement:** Defined as a module-level function near the top of `mcp.server.ts`, called inside the tool registration callback after the handler resolves.

---

## Section 2 — Schema Param Renames (Tool Files)

Three Zod schema field renames. Each requires: (a) renaming the key in the `querySchema` object, (b) updating the single handler reference that reads `query.q` or `query.newDescription`.

| File | Tool | Old param | New param |
|---|---|---|---|
| `intent/intent.tools.ts` | `search_intents` | `q` | `query` |
| `contact/contact.tools.ts` | `search_contacts` | `q` | `query` |
| `intent/intent.tools.ts` | `update_intent` | `newDescription` | `description` |

No logic changes. The `.describe()` strings on each param should also be updated to drop references to the old names.

---

## Section 3 — Graph Serialization, Descriptions, and Vocabulary

### 3a — `network.graph.ts`: add `isPersonal` to `memberOf` serialization

**File:** `packages/protocol/src/network/network.graph.ts`

The `getNetworkMemberships` DB query already selects `isPersonal` from `schema.networks`. It is available on each `m` in `allMemberships` but dropped in the `.map()` at the `readResult` construction.

**Change:** Add `isPersonal: m.isPersonal` to the `memberOf` array `.map()`:

```ts
// Before
memberOf: allMemberships.map((m) => ({
  networkId: m.networkId,
  title: m.networkTitle,
  description: m.indexPrompt,
  autoAssign: m.autoAssign,
  joinedAt: m.joinedAt,
})),

// After
memberOf: allMemberships.map((m) => ({
  networkId: m.networkId,
  title: m.networkTitle,
  description: m.indexPrompt,
  autoAssign: m.autoAssign,
  isPersonal: m.isPersonal,
  joinedAt: m.joinedAt,
})),
```

Also update `network.state.ts` to add `isPersonal: boolean` to the `memberOf` array type annotation.

### 3b — `network.graph.ts`: rename `publicIndexes` → `publicNetworks`

**File:** `packages/protocol/src/network/network.graph.ts`

Rename the key in the `readResult` object and in the `stats` sub-object:
- `publicIndexes` → `publicNetworks`
- `publicIndexesCount` → `publicNetworksCount`

Also update `network.state.ts` to rename the key in the `readResult` type annotation.

### 3c — `read_networks` description update

**File:** `packages/protocol/src/network/network.tools.ts`

Update the `read_networks` description to:
- Replace `ownerOf` with `owns`
- Document `publicNetworks` as a third list: publicly joinable communities the user is not yet a member of
- Document `isPersonal: true` as present on personal-index entries in `memberOf`
- Remove the stale claim that the response contains `memberOf` and `ownerOf` only

### 3d — `delete_network` success message

**File:** `packages/protocol/src/network/network.tools.ts`

Change `"Index deleted."` → `"Network deleted."` in the `deleteNetwork` handler's success return.

### 3e — `update_user_profile` description

**File:** `packages/protocol/src/profile/profile.tools.ts`

Replace the current description with one that accurately documents the verb-instruction interface:

- `action`: a natural-language instruction describing what to change (e.g. `"add interests"`, `"update bio"`, `"remove skill"`, `"set location"`)
- `details`: the content to apply (e.g. `"procedural generation, roguelikes, narrative games"`)

Include 2–3 examples in the description so AI clients understand the pattern without guessing field names.

---

## Files Changed

| File | Change type |
|---|---|
| `packages/protocol/src/network/network.graph.ts` | Add `isPersonal` to `memberOf` map; rename `publicIndexes` → `publicNetworks` |
| `packages/protocol/src/network/network.state.ts` | Type annotation updates for `isPersonal` and `publicNetworks` |
| `packages/protocol/src/network/network.tools.ts` | Update `read_networks` description; fix `delete_network` message |
| `packages/protocol/src/intent/intent.tools.ts` | Rename `q` → `query` in `search_intents`; rename `newDescription` → `description` in `update_intent` |
| `packages/protocol/src/contact/contact.tools.ts` | Rename `q` → `query` in `search_contacts` |
| `packages/protocol/src/profile/profile.tools.ts` | Update `update_user_profile` description |
| `backend/src/controllers/mcp.handler.ts` (or `packages/protocol/src/mcp/mcp.server.ts`) | Add `sanitizeMcpResult()` post-processing |

---

## Testing

- Call `read_networks` → verify `memberOf` entries include `isPersonal`, response has `publicNetworks` not `publicIndexes`
- Call `search_intents` with `query` param → verify it works; with `q` → verify validation error
- Call `update_intent` with `description` param → verify it works; with `newDescription` → verify validation error
- Call `search_contacts` with `query` param → verify it works
- Call `delete_network` → verify success message says "Network deleted."
- Call any graph-backed tool → verify `_graphTimings` absent from response
- Call a tool that fails business logic (e.g. `delete_intent` with wrong user's intent) → verify `isError: true` in MCP envelope
