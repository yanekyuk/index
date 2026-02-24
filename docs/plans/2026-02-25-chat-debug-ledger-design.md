# Chat Debug Ledger Design

**Status:** Draft — for approval.  
**Goal:** One place to see what called what, with inputs and outputs, for every tool, graph, and agent step in a chat turn (a “ledger” for debugging).

---

## 1. What we have today

- **Per-turn meta:** `graph`, `iterations`, `tools[]` with `name`, `args`, `resultSummary`, `success`.
- **Per-tool steps (optional):** `steps: [{ step, detail? }]` from tools that return `debugSteps` (e.g. `create_opportunities` → resolve_index_scope, select_strategies, opportunity_graph, enrich_profiles, format_cards).
- **Gap:** No standard way to see (1) which tool called which graph/service, (2) what was passed in and what came back, for *all* tools and *all* graphs/agents in the chain.

---

## 2. Ledger model (single shape per turn)

Keep the current top-level shape for Copy debug and extend it so every layer can contribute **ledger entries** that describe calls and I/O.

**Turn-level (unchanged):**

- `messageIndex`, `graph`, `iterations`, `tools[]`.

**Per-tool (extended):**

Each tool entry already has `name`, `args`, `resultSummary`, `success`, and optional `steps`. We generalize subcall visibility with a **ledger** field:

- **`ledger`** (optional): array of **ledger entries** for this tool. Each entry describes one “call” or “step” with inputs and/or outputs.

**Ledger entry (unified):**

```ts
interface DebugLedgerEntry {
  /** e.g. "index_membership.invoke", "runDiscoverFromQuery", "select_strategies" */
  name: string;
  /** Sanitized input (args or summary). Omit for steps that only need a message. */
  input?: Record<string, unknown> | string;
  /** Sanitized output summary or key result (e.g. "3 opportunities", "memberOf: 1 index"). */
  output?: string;
  /** Optional nested entries (e.g. opportunity graph → strategy → match). */
  children?: DebugLedgerEntry[];
}
```

- **Tools** that call graphs or services push one entry per call (e.g. `name: "index_membership.invoke"`, `input: { userId, indexId, operationMode }`, `output: "memberOf: 1 index"`).
- **Tools** that only have linear steps can keep using **steps** (step + detail) for simplicity; the agent can map `steps` into `ledger` as `{ name: step, output: detail }` so the export is uniform, or we keep both: `steps` for short annotations, `ledger` for call-like I/O.
- **Graphs/agents** that return a debug payload (e.g. opportunity graph returning `{ opportunities, debugSteps }`) are already surfaced by the tool that invoked them; the tool turns that into `ledger` entries (and optionally `children` if the graph gives a tree).

So the ledger is **tool-centric**: the call tree is built from what tools report (including the graphs/services they call). We do not require LangGraph to expose node-level I/O in v1.

---

## 3. Where to capture

| Layer | What to capture | How |
|-------|------------------|-----|
| **Chat graph** | Turn: graph name, iteration count | Already in state/streamer. |
| **Agent** | Tool name, args, result summary, success; parse tool result for `debugSteps` / `debugLedger` | Already does; extend to parse `debugLedger` and optional `input`/`output` per step. |
| **Tools** | Every graph/service call: name, sanitized input, output summary | Convention: tools that call `graphs.X.invoke(...)` or helpers (e.g. `runDiscoverFromQuery`) push to a local array and return it as `debugLedger` (or keep `debugSteps` and add a separate `debugLedger` for call-shaped entries). |
| **Graphs** | Optional: node names and I/O summaries | Only where we control the return type (e.g. opportunity graph already returns `debugSteps`; we could add a structured `debugLedger` in the graph result and the calling tool forwards it). |

**Recommendation:**  
- **Phase 1:** Every tool that invokes at least one graph or nontrivial helper returns a **ledger** array (or we keep **steps** and add **ledger** only for call-shaped entries). Agent merges both into the tool’s debug payload; Copy debug exports `tools[].steps` and `tools[].ledger`.  
- **Phase 2 (optional):** Key graphs (opportunity, intent, index, index_membership) return a small `debugLedger` or `debugSteps` in their result; the calling tool appends those as `children` or flat entries so the full call chain is visible.

---

## 4. Sanitization and size

- **Ledger `input` / `output`:** Reuse existing `sanitizeForDebugMeta`: blocklist embeddings/large arrays, truncate long strings (e.g. 300 chars for `output`, 500 for `input` values).
- **Depth:** Limit nesting (e.g. `children` at most 2 levels) to keep Copy debug readable and bounded.

---

## 5. Copy debug export shape (target)

```json
{
  "sessionId": "...",
  "exportedAt": "...",
  "messages": [ ... ],
  "turns": [
    {
      "messageIndex": 1,
      "graph": "agent_loop",
      "iterations": 2,
      "tools": [
        {
          "name": "create_opportunities",
          "args": { "indexId": "...", "searchQuery": "visual artist" },
          "resultSummary": "Found 3 potential connection(s).",
          "success": true,
          "steps": [
            { "step": "resolve_index_scope", "detail": "1 index(es)" },
            { "step": "select_strategies", "detail": "visual artist" },
            { "step": "opportunity_graph", "detail": "3 opportunity(ies)" }
          ],
          "ledger": [
            { "name": "resolve_index_scope", "input": { "indexScopeLength": 1 }, "output": "1 index(es)" },
            { "name": "index_membership.invoke", "input": { "userId": "...", "indexId": "...", "operationMode": "read" }, "output": "memberOf: 1 index" },
            { "name": "runDiscoverFromQuery", "input": { "query": "visual artist", "limit": 5 }, "output": "3 opportunities" }
          ]
        }
      ]
    }
  ]
}
```

- **steps:** Short, human-readable annotations (existing).  
- **ledger:** Call-style entries with input/output for “what called what, what went in, what came out.”

---

## 6. Implementation strategy

1. **Types:** Add `DebugLedgerEntry` and optional `ledger?: DebugLedgerEntry[]` to `DebugMetaToolCall` and to the tool result contract (e.g. tools may return `debugLedger` in their JSON).
2. **Agent:** When building `toolsDebug`, parse tool result for `debugLedger`; sanitize and attach to the tool entry. Keep existing `debugSteps` parsing.
3. **Tool helper:** Optional `ledgerEntry(name, input?, output?)` helper or convention so tools can push entries without duplicating sanitization.
4. **Instrument tools:** For each tool that calls graphs or nontrivial helpers:
   - Build a `ledger` array (or `debugLedger` in the returned JSON).
   - For each `graphs.*.invoke(...)` or helper call: push `{ name, input: sanitized(args), output: shortSummary }`.
   - Return it via existing `success({ ... debugLedger })` (or extend success helper to accept `debugLedger`).
5. **Frontend:** Extend `DebugTurnMeta.tools[]` with optional `ledger`; Copy debug already serializes the full object.
6. **Graphs (phase 2):** Where useful, have graphs return `debugSteps` or `debugLedger` in their result; calling tools merge into their ledger (e.g. as `children` or flat entries).

---

## 7. Scope and non-goals

- **In scope:** Chat flow only (stream → Copy debug). All tools and the agent contribute to the same per-turn ledger.
- **Out of scope (v1):** Persisting the ledger in the DB, ledger for non-chat entry points (e.g. background jobs), and automatic instrumentation of LangGraph node-level I/O without graph code changes.

---

## 8. Open choice

- **Unify steps and ledger?** Option A: Keep both — `steps` for quick annotations, `ledger` for call-shaped I/O. Option B: Migrate to ledger-only (every step is a `DebugLedgerEntry` with optional input/output). Recommendation: A for backward compatibility and minimal change; we can later collapse to B if we want a single shape.

If this design looks good, next step is an implementation plan (concrete file changes and order of work).
