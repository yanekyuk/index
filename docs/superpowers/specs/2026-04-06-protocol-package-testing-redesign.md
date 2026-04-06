# packages/protocol — Test Infrastructure Redesign

**Date:** 2026-04-06
**Scope:** `packages/protocol/` only — no changes to `protocol/src/`

---

## Problem

`packages/protocol` is a standalone NPM package but its tests depend on `protocol/src/lib/smartest` (the backend app's test framework) via a shim at `packages/protocol/smartest.ts`. This creates an unacceptable coupling: the package cannot be tested in isolation and the smartest abstraction (scenarios, fixtures, `@fixtures.*` refs, SUT config, runners) is difficult to understand and maintain.

Additionally:
- Tests are scattered across co-located `tests/` subdirectories (`agents/tests/`, `graphs/tests/`, etc.) with no single entry point
- Several source files have no test coverage

---

## Goals

1. Remove the `smartest.ts` shim and the dependency on `protocol/src/lib/smartest`
2. Replace smartest with a minimal, self-contained LLM judge helper
3. Move all tests into a single top-level `tests/` folder
4. Add tests for every uncovered source file

---

## Design

### 1. Lightweight LLM Tester

A single file: `packages/protocol/tests/support/llm-assert.ts`

```ts
export async function assertLLM(output: unknown, criteria: string): Promise<void>
```

**How it works:**
- Serializes `output` to JSON
- Sends `output` + `criteria` to an LLM via OpenRouter with a judge system prompt
- Model: `google/gemini-2.5-flash` by default; overridable via `SMARTEST_VERIFIER_MODEL` env var
- Expects structured output: `{ pass: boolean, reasoning: string }`
- If `pass` is false: throws an `Error` with `reasoning` in the message so bun:test prints it in the failure output
- If the LLM call fails: throws with a clear message

**Usage in tests:**
```ts
const result = await agent.invoke(input);
await assertLLM(result, "Should extract at least one goal-type intent grounded in the query, not the user profile");
```

This is the entire API. No scenarios, no fixture generation, no ref resolution, no runners.

**Not exported in `dist/`** — test-only file, never imported by source files.

---

### 2. Test Folder Reorganization

**Delete:** `packages/protocol/smartest.ts`

**New structure:**
```
packages/protocol/
  tests/
    support/
      llm-assert.ts              ← LLM judge helper
    agents/
      chat.agent.spec.ts
      chat.prompt.dynamic.spec.ts
      chat.prompt.modules.spec.ts
      chat.prompt.multistep.spec.ts
      chat.title.generator.spec.ts    ← new
      home.categorizer.spec.ts
      hyde.generator.spec.ts
      hyde.strategies.spec.ts
      intent.clarifier.spec.ts        ← new
      intent.indexer.spec.ts
      intent.inferrer.spec.ts
      intent.reconciler.spec.ts
      intent.verifier.spec.ts
      invite.generator.spec.ts        ← new
      lens.inferrer.spec.ts
      negotiation.insights.generator.spec.ts  ← new
      negotiation.proposer.spec.ts    ← new
      negotiation.responder.spec.ts   ← new
      opportunity.evaluator.spec.ts   ← merges .smartest.spec.ts
      opportunity.presenter.spec.ts
      profile.generator.spec.ts
      profile.hyde.generator.spec.ts
      suggestion.generator.spec.ts
    graphs/
      chat.discover.spec.ts
      chat.graph.factory.spec.ts
      chat.graph.invoke.spec.ts
      chat.graph.opportunities.spec.ts
      chat.graph.profile.spec.ts
      chat.graph.scope.spec.ts
      chat.vocabulary.spec.ts
      home.graph.fetch-limit.spec.ts
      home.graph.introducer-name.spec.ts
      hyde.graph.spec.ts
      maintenance.graph.spec.ts       ← new
      opportunity.graph.buildDiscovererContext.spec.ts
      opportunity.graph.direct-connection.spec.ts  ← replaces .smartest.spec.ts
      profile.graph.generate.spec.ts
      profile.graph.prepopulated.spec.ts
      profile.graph.spec.ts
    support/
      chat.utils.spec.ts
      debug-meta.sanitizer.spec.ts
      feed.health.spec.ts             ← new
      introducer-discovery-fixes.spec.ts
      log.spec.ts
      lucide.icon-catalog.spec.ts     ← new
      opportunity.card-text.spec.ts
      opportunity.constants.spec.ts   ← new
      opportunity.discover.introducer-cards.spec.ts
      opportunity.persist.spec.ts     ← new
      opportunity.presentation.spec.ts  ← new
      opportunity.sanitize.edge.spec.ts
      opportunity.sanitize.spec.ts
      opportunity.utils.introducer.spec.ts
      opportunity.utils.spec.ts
      performance.spec.ts
      profile.enrichment-display-name.spec.ts
      protocol-init.spec.ts
      request-context.spec.ts         ← new
    tools/
      contact.tools.spec.ts           ← new
      integration.tools.spec.ts       ← new
      opportunity.tools.spec.ts
    streamers/
      response.streamer.spec.ts       ← new
```

---

### 3. Rewriting Smartest-Based Tests

Files currently using `runScenario`/`expectSmartest`:

| Old file | New file | Change |
|---|---|---|
| `opportunity.evaluator.smartest.spec.ts` | `agents/opportunity.evaluator.spec.ts` | Merge with existing spec; replace `runScenario` with direct call + `assertLLM` |
| `opportunity.graph.direct-connection.smartest.spec.ts` | `graphs/opportunity.graph.direct-connection.spec.ts` | Same pattern |
| `chat.graph.invoke.spec.ts` | `graphs/chat.graph.invoke.spec.ts` | Remove `runScenario` wrapper; call graph directly + `assertLLM` |
| `chat.graph.opportunities.spec.ts` | Same | Same |
| `chat.graph.scope.spec.ts` | Same | Same |
| `chat.graph.profile.spec.ts` | Same | Some tests already plain; only LLM-checked ones get `assertLLM` |
| `chat.discover.spec.ts` | Same | Same |
| `chat.vocabulary.spec.ts` | Same | Same |
| `hyde.graph.spec.ts` | Same | Same |

Pattern for rewriting:
```ts
// Before (smartest)
const result = await runScenario(defineScenario({
  name: '...',
  description: '...',
  sut: { type: 'agent', factory: () => agent, invoke: (a, i) => a.invoke(i), input: { ... } },
  verification: { criteria: '...' },
}));
expectSmartest(result);

// After (plain)
const result = await agent.invoke(input);
await assertLLM(result, "...");
```

---

### 4. Coverage for Uncovered Files

**Strategy per category:**

- **LLM-calling agents** (`chat.title.generator`, `intent.clarifier`, `invite.generator`, `negotiation.*.ts`): call `invoke()` with representative input; use `assertLLM` to verify output quality
- **Pure utilities** (`lucide.icon-catalog`, `opportunity.constants`, `request-context`, `feed.health`): deterministic assertions only
- **Side-effectful utilities** (`opportunity.persist`, `contact.tools`, `integration.tools`, `response.streamer`): mock external dependencies (DB adapter, queue, HTTP) at the boundary; test the logic around them
- **Graphs** (`maintenance.graph`): invoke with mocked adapters; assert state transitions

---

## Out of Scope

- `protocol/src/lib/smartest` — not touched; backend continues using it
- `packages/protocol/dist/` — no changes to build output or exports
- Backend tests in `protocol/tests/` — not in scope

---

## Success Criteria

1. `packages/protocol/smartest.ts` is deleted
2. No file in `packages/protocol` imports from `../../protocol/src/lib/smartest`
3. All test files live under `packages/protocol/tests/`
4. Every source file in `src/` has a corresponding spec in `tests/`
5. All existing passing tests continue to pass after the move
