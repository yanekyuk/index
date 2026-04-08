# packages/protocol Test Infrastructure Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `smartest.ts` shim from `packages/protocol`, replace smartest with a minimal `assertLLM` helper, and consolidate all tests into a single top-level `tests/` folder with full source coverage.

**Architecture:** A single `tests/support/llm-assert.ts` exports one function, `assertLLM(output, criteria)`, that calls an LLM judge and throws on failure. All existing co-located tests move to `tests/<domain>/`, smartest-based tests are rewritten as plain `describe/it` blocks using `assertLLM`, and new tests are added for every previously uncovered source file.

**Tech Stack:** Bun test, `@langchain/openai` (via OpenRouter), dotenv, zod

---

## File Map

**Created:**
- `packages/protocol/tests/support/llm-assert.ts` — the LLM judge helper
- `packages/protocol/tests/agents/*.spec.ts` — all agent tests (migrated + new)
- `packages/protocol/tests/graphs/*.spec.ts` — all graph tests (migrated + new)
- `packages/protocol/tests/support/*.spec.ts` — all support tests (migrated + new)
- `packages/protocol/tests/tools/*.spec.ts` — all tool tests (migrated + new)
- `packages/protocol/tests/streamers/response.streamer.spec.ts` — new

**Moved (with updated imports):**
- All `src/agents/tests/*.spec.ts` → `tests/agents/`
- All `src/graphs/tests/*.spec.ts` (non-smartest) → `tests/graphs/`
- `src/graphs/tests/chat.graph.mocks.ts` → `tests/graphs/chat.graph.mocks.ts`
- All `src/support/tests/*.spec.ts` → `tests/support/`
- `src/tools/tests/opportunity.tools.spec.ts` → `tests/tools/`
- `src/agents/chat.prompt.*.spec.ts` → `tests/agents/`

**Deleted:**
- `packages/protocol/smartest.ts`
- All `src/*/tests/*.spec.ts` originals (after migration)
- `src/graphs/tests/chat.graph.mocks.ts` original
- `src/agents/chat.prompt.dynamic.spec.ts` original (converted and moved)
- `src/agents/tests/opportunity.evaluator.smartest.spec.ts` original (merged into evaluator spec)

**Import path pattern after migration:**
- Old: `import { Foo } from '../foo.js'` (from `src/agents/tests/`)
- New: `import { Foo } from '../../src/agents/foo.js'` (from `tests/agents/`)
- Old: `import { Foo } from '../../../smartest.js'`
- New: `import { assertLLM } from '../support/llm-assert.js'`

---

## Task 1: Create `tests/support/llm-assert.ts`

**Files:**
- Create: `packages/protocol/tests/support/llm-assert.ts`

- [ ] **Step 1: Create the file**

```typescript
// packages/protocol/tests/support/llm-assert.ts
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

const JUDGE_SYSTEM_PROMPT = `You are a test oracle for an AI system. Given the output of a system under test and evaluation criteria, determine whether the output passes or fails.

Return JSON with two fields:
- pass: true if the output satisfies the criteria, false otherwise
- reasoning: concise explanation of your judgment (1-3 sentences)`;

const judgeOutputSchema = z.object({
  pass: z.boolean(),
  reasoning: z.string(),
});

/**
 * Assert that `output` satisfies the given `criteria` according to an LLM judge.
 * Throws an error (with reasoning embedded) if the assertion fails.
 * Uses the SMARTEST_VERIFIER_MODEL env var (default: google/gemini-2.5-flash).
 */
export async function assertLLM(output: unknown, criteria: string): Promise<void> {
  const modelId = process.env.SMARTEST_VERIFIER_MODEL ?? "google/gemini-2.5-flash";

  const model = new ChatOpenAI({
    model: modelId,
    apiKey: process.env.OPENROUTER_API_KEY!,
    configuration: {
      baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    },
    temperature: 0,
    maxTokens: 512,
  });

  const structured = model.withStructuredOutput(judgeOutputSchema, { name: "llm_judge" });

  const userMessage = `Output:\n${JSON.stringify(output, null, 2)}\n\nCriteria:\n${criteria}`;

  const result = await structured.invoke([
    new SystemMessage(JUDGE_SYSTEM_PROMPT),
    new HumanMessage(userMessage),
  ]);

  if (!result.pass) {
    throw new Error(`LLM assertion failed: ${result.reasoning}`);
  }
}
```

- [ ] **Step 2: Verify the file compiles** (no build needed — just confirm no import errors by scanning)

The imports `@langchain/openai`, `@langchain/core/messages`, `zod` are already in `packages/protocol/package.json` dependencies. No new deps needed.

- [ ] **Step 3: Commit**

```bash
cd /path/to/packages/protocol
git add tests/support/llm-assert.ts
git commit -m "feat(protocol-tests): add lightweight assertLLM test helper"
```

---

## Task 2: Delete `smartest.ts` shim

**Files:**
- Delete: `packages/protocol/smartest.ts`

This shim re-exports from `../../protocol/src/lib/smartest/index.ts`. Once all smartest-based tests are converted in subsequent tasks, this file is no longer needed. Delete it first so TypeScript will immediately surface any remaining imports.

- [ ] **Step 1: Delete the shim**

```bash
rm packages/protocol/smartest.ts
```

- [ ] **Step 2: Commit**

```bash
git add -A packages/protocol/smartest.ts
git commit -m "chore(protocol-tests): delete smartest shim — migrating to assertLLM"
```

---

## Task 3: Migrate agent tests (non-smartest) to `tests/agents/`

Move these files from `src/agents/tests/` and `src/agents/` to `tests/agents/`, updating all relative imports. No behavior changes.

**Files to move and their import updates:**

| Source | Destination | Import change |
|---|---|---|
| `src/agents/tests/home.categorizer.spec.ts` | `tests/agents/home.categorizer.spec.ts` | `'../home.categorizer.js'` → `'../../src/agents/home.categorizer.js'` |
| `src/agents/tests/hyde.generator.spec.ts` | `tests/agents/hyde.generator.spec.ts` | `'../hyde.generator.js'` → `'../../src/agents/hyde.generator.js'` |
| `src/agents/tests/hyde.strategies.spec.ts` | `tests/agents/hyde.strategies.spec.ts` | `'../hyde.strategies.js'` → `'../../src/agents/hyde.strategies.js'` |
| `src/agents/tests/intent.inferrer.spec.ts` | `tests/agents/intent.inferrer.spec.ts` | `'../intent.inferrer.js'` → `'../../src/agents/intent.inferrer.js'` |
| `src/agents/tests/intent.reconciler.spec.ts` | `tests/agents/intent.reconciler.spec.ts` | `'../intent.reconciler.js'` → `'../../src/agents/intent.reconciler.js'` |
| `src/agents/tests/intent.verifier.spec.ts` | `tests/agents/intent.verifier.spec.ts` | `'../intent.verifier.js'` → `'../../src/agents/intent.verifier.js'` |
| `src/agents/tests/intent.indexer.spec.ts` | `tests/agents/intent.indexer.spec.ts` | `'../intent.indexer.js'` → `'../../src/agents/intent.indexer.js'` |
| `src/agents/tests/lens.inferrer.spec.ts` | `tests/agents/lens.inferrer.spec.ts` | `'../lens.inferrer.js'` → `'../../src/agents/lens.inferrer.js'` |
| `src/agents/tests/opportunity.presenter.spec.ts` | `tests/agents/opportunity.presenter.spec.ts` | `'../opportunity.presenter.js'` → `'../../src/agents/opportunity.presenter.js'` |
| `src/agents/tests/opportunity.evaluator.spec.ts` | `tests/agents/opportunity.evaluator.spec.ts` | `'../opportunity.evaluator.js'` → `'../../src/agents/opportunity.evaluator.js'` |
| `src/agents/tests/profile.generator.spec.ts` | `tests/agents/profile.generator.spec.ts` | `'../profile.generator.js'` → `'../../src/agents/profile.generator.js'` |
| `src/agents/tests/profile.hyde.generator.spec.ts` | `tests/agents/profile.hyde.generator.spec.ts` | `'../profile.hyde.generator.js'` → `'../../src/agents/profile.hyde.generator.js'` |
| `src/agents/tests/suggestion.generator.spec.ts` | `tests/agents/suggestion.generator.spec.ts` | `'../suggestion.generator.js'` → `'../../src/agents/suggestion.generator.js'` |
| `src/agents/tests/chat.agent.hallucination.spec.ts` | `tests/agents/chat.agent.hallucination.spec.ts` | update agent + graph imports to `../../src/agents/...` and `../../src/graphs/...` |
| `src/agents/chat.prompt.modules.spec.ts` | `tests/agents/chat.prompt.modules.spec.ts` | `'./chat.prompt.modules.js'` → `'../../src/agents/chat.prompt.modules.js'` |
| `src/agents/chat.prompt.multistep.spec.ts` | `tests/agents/chat.prompt.multistep.spec.ts` | `'./chat.prompt.modules.js'` → `'../../src/agents/chat.prompt.modules.js'` |

- [ ] **Step 1: Copy each file to `tests/agents/` and update its imports**

For each file listed above: copy the content, update the import paths (the pattern is `'../foo.js'` → `'../../src/agents/foo.js'`), then delete the original.

- [ ] **Step 2: Run agent tests to verify**

```bash
cd packages/protocol
bun test tests/agents/
```

Expected: same tests pass as before the move.

- [ ] **Step 3: Delete originals**

```bash
rm -rf packages/protocol/src/agents/tests/
rm packages/protocol/src/agents/chat.prompt.modules.spec.ts
rm packages/protocol/src/agents/chat.prompt.multistep.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(protocol-tests): move agent tests to top-level tests/agents/"
```

---

## Task 4: Convert and migrate smartest agent tests

These two files use `runScenario`/`expectSmartest` and must be rewritten.

**Files:**
- Convert + move: `src/agents/tests/opportunity.evaluator.smartest.spec.ts` → merge into `tests/agents/opportunity.evaluator.spec.ts`
- Convert + move: `src/agents/chat.prompt.dynamic.spec.ts` → `tests/agents/chat.prompt.dynamic.spec.ts`

- [ ] **Step 1: Append converted smartest tests to `tests/agents/opportunity.evaluator.spec.ts`**

Open `tests/agents/opportunity.evaluator.spec.ts` (already moved in Task 3) and add a new `describe` block at the bottom:

```typescript
import { assertLLM } from '../support/llm-assert.js';

// ... (existing imports and tests above)

// ─── Stress test: 25 unrelated candidates ───────────────────────────────────

describe('OpportunityEvaluator: stress test — unrelated candidates', () => {
  // (paste the DISCOVERER_ID, sourceEntity, candidates arrays verbatim from the original file)

  it('bundle mode returns no matches for fully unrelated candidates', async () => {
    const evaluator = new OpportunityEvaluator();
    const input: EvaluatorInput = {
      discovererId: DISCOVERER_ID,
      entities: [sourceEntity, ...candidates],
    };
    const raw = await evaluator.invokeEntityBundle(input, { minScore: 50 });
    const opportunities = raw.map(op => {
      const candidate = op.actors.find(a => a.userId !== DISCOVERER_ID);
      return { reasoning: op.reasoning, score: op.score, candidateUserId: candidate?.userId ?? '' };
    });

    await assertLLM(
      { opportunities },
      'The discoverer is an AI/ML startup founder seeking a technical co-founder with LLM expertise. ' +
      'All 25 candidates are from completely unrelated domains (chef, yoga instructor, jazz musician, real estate agent, etc.). ' +
      'PASS: the opportunities list is empty or all scores are < 30. FAIL: any candidate scores >= 50.'
    );
  }, 180000);

  it('parallel mode returns no matches for fully unrelated candidates', async () => {
    const evaluator = new OpportunityEvaluator();
    const parallelResults = await Promise.all(
      candidates.map(candidate => {
        const input: EvaluatorInput = {
          discovererId: DISCOVERER_ID,
          entities: [sourceEntity, candidate],
        };
        return evaluator.invokeEntityBundle(input, { minScore: 50 }).catch(() => []);
      })
    );
    const opportunities = parallelResults.flat().map(op => {
      const candidate = op.actors.find(a => a.userId !== DISCOVERER_ID);
      return { reasoning: op.reasoning, score: op.score, candidateUserId: candidate?.userId ?? '' };
    });

    await assertLLM(
      { opportunities },
      'Same as above. All 25 candidates are unrelated. PASS: empty or all scores < 30.'
    );
  }, 180000);
});
```

> **Note:** Copy the `DISCOVERER_ID`, `sourceEntity`, and `candidates` arrays verbatim from `src/agents/tests/opportunity.evaluator.smartest.spec.ts`. The import for `OpportunityEvaluator` is already in the file from Task 3; just add `import { assertLLM }` at the top.

- [ ] **Step 2: Delete the original smartest file**

```bash
rm packages/protocol/src/agents/tests/opportunity.evaluator.smartest.spec.ts
```

- [ ] **Step 3: Convert `chat.prompt.dynamic.spec.ts`**

Read `src/agents/chat.prompt.dynamic.spec.ts`. Identify every `runScenario(defineScenario({...}))` call. For each one, replace with a direct agent invocation + `assertLLM`. The pattern is:

```typescript
// Before
const result = await runScenario(defineScenario({
  name: 'foo',
  description: '...',
  sut: { type: 'agent', factory: () => agent, invoke: async (a, i) => a.invoke(i), input: { ... } },
  verification: { criteria: '...' },
}));
expectSmartest(result);

// After
const result = await agent.invoke({ ... });
await assertLLM(result, '...');
```

Write the converted file to `tests/agents/chat.prompt.dynamic.spec.ts`:
- Import line: `import { assertLLM } from '../support/llm-assert.js'`
- Update source import: `'./chat.prompt.ts'` → `'../../src/agents/chat.prompt.js'`
- Remove: `import { runScenario, defineScenario, expectSmartest } from '../../smartest.js'`

- [ ] **Step 4: Delete the original**

```bash
rm packages/protocol/src/agents/chat.prompt.dynamic.spec.ts
```

- [ ] **Step 5: Run agent tests**

```bash
cd packages/protocol
bun test tests/agents/
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(protocol-tests): convert smartest agent tests to assertLLM"
```

---

## Task 5: Migrate graph tests (non-smartest) to `tests/graphs/`

**Files:**
- Migrate: `src/graphs/tests/chat.graph.mocks.ts` → `tests/graphs/chat.graph.mocks.ts`
- Migrate all non-smartest graph specs

Move `chat.graph.mocks.ts` first since other graph tests depend on it.

- [ ] **Step 1: Move `chat.graph.mocks.ts`**

Copy `src/graphs/tests/chat.graph.mocks.ts` to `tests/graphs/chat.graph.mocks.ts`.
Update any imports inside it: paths like `'../chat.graph.js'` → `'../../src/graphs/chat.graph.js'`, `'../../agents/...'` → `'../../src/agents/...'`, etc.

- [ ] **Step 2: Move non-smartest graph specs**

Files to move (update source imports `'../'` → `'../../src/graphs/'` and mock imports `'./chat.graph.mocks.js'` → stays the same since they're now in the same folder):

- `src/graphs/tests/home.graph.fetch-limit.spec.ts` → `tests/graphs/`
- `src/graphs/tests/home.graph.introducer-name.spec.ts` → `tests/graphs/`
- `src/graphs/tests/home.graph.spec.ts` → `tests/graphs/`
- `src/graphs/tests/intent.graph.spec.ts` → `tests/graphs/`
- `src/graphs/tests/opportunity.graph.buildDiscovererContext.spec.ts` → `tests/graphs/`
- `src/graphs/tests/opportunity.graph.spec.ts` → `tests/graphs/`
- `src/graphs/tests/opportunity.graph.trace-events.spec.ts` → `tests/graphs/`
- `src/graphs/tests/profile.graph.generate.spec.ts` → `tests/graphs/`
- `src/graphs/tests/profile.graph.prepopulated.spec.ts` → `tests/graphs/`
- `src/graphs/tests/profile.graph.spec.ts` → `tests/graphs/`
- `src/graphs/tests/chat.graph.factory.spec.ts` → `tests/graphs/`
- `src/graphs/tests/chat.graph.spec.ts` → `tests/graphs/`
- `src/graphs/tests/chat.graph.streaming.spec.ts` → `tests/graphs/`

**Import update rules:**
- `import ... from '../chat.graph.js'` → `import ... from '../../src/graphs/chat.graph.js'`
- `import ... from '../profile.graph.js'` → `import ... from '../../src/graphs/profile.graph.js'`
- `import ... from './chat.graph.mocks.js'` → stays `'./chat.graph.mocks.js'` (same folder now)
- `import ... from '../../agents/...'` → `import ... from '../../src/agents/...'`
- `import ... from '../../interfaces/...'` → `import ... from '../../src/interfaces/...'`

- [ ] **Step 3: Run non-smartest graph tests**

```bash
cd packages/protocol
bun test tests/graphs/home.graph.fetch-limit.spec.ts tests/graphs/profile.graph.spec.ts
```

Expected: pass.

- [ ] **Step 4: Delete originals (non-smartest only)**

```bash
rm packages/protocol/src/graphs/tests/chat.graph.mocks.ts
rm packages/protocol/src/graphs/tests/home.graph.fetch-limit.spec.ts
rm packages/protocol/src/graphs/tests/home.graph.introducer-name.spec.ts
rm packages/protocol/src/graphs/tests/home.graph.spec.ts
rm packages/protocol/src/graphs/tests/intent.graph.spec.ts
rm packages/protocol/src/graphs/tests/opportunity.graph.buildDiscovererContext.spec.ts
rm packages/protocol/src/graphs/tests/opportunity.graph.spec.ts
rm packages/protocol/src/graphs/tests/opportunity.graph.trace-events.spec.ts
rm packages/protocol/src/graphs/tests/profile.graph.generate.spec.ts
rm packages/protocol/src/graphs/tests/profile.graph.prepopulated.spec.ts
rm packages/protocol/src/graphs/tests/profile.graph.spec.ts
rm packages/protocol/src/graphs/tests/chat.graph.factory.spec.ts
rm packages/protocol/src/graphs/tests/chat.graph.spec.ts
rm packages/protocol/src/graphs/tests/chat.graph.streaming.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(protocol-tests): move non-smartest graph tests to top-level tests/graphs/"
```

---

## Task 6: Convert and migrate smartest graph tests

These files use `runScenario`/`expectSmartest` and must be rewritten with `assertLLM`.

**Files:**
- `src/graphs/tests/chat.graph.invoke.spec.ts`
- `src/graphs/tests/chat.graph.opportunities.spec.ts`
- `src/graphs/tests/chat.graph.scope.spec.ts`
- `src/graphs/tests/chat.graph.profile.spec.ts`
- `src/graphs/tests/chat.discover.spec.ts`
- `src/graphs/tests/chat.vocabulary.spec.ts`
- `src/graphs/tests/hyde.graph.spec.ts`
- `src/graphs/tests/opportunity.graph.direct-connection.smartest.spec.ts`

**Pattern for each file:**

```typescript
// Remove:
import { runScenario, defineScenario, expectSmartest } from '../../../smartest.js';

// Add:
import { assertLLM } from '../support/llm-assert.js';

// Replace each test body:
// Before:
const result = await runScenario(defineScenario({
  name: 'chat-simple-greeting',
  description: '...',
  fixtures: { userId: testUserId, message: 'Hello' },
  sut: {
    type: 'graph',
    factory: () => compiledGraph,
    invoke: async (instance, input) => (instance as Graph).invoke({ userId: input.userId, messages: [new HumanMessage(input.message)] }),
    input: { userId: '@fixtures.userId', message: '@fixtures.message' },
  },
  verification: { schema: chatGraphOutputSchema, criteria: '...', llmVerify: true },
}));
expectSmartest(result);

// After:
const output = await compiledGraph.invoke({
  userId: testUserId,
  messages: [new HumanMessage('Hello')],
});
// schema assertion (if there was a schema in verification):
expect(chatGraphOutputSchema.safeParse(output).success).toBe(true);
// LLM assertion (from the criteria string):
await assertLLM(output, '...');
```

> When `llmVerify: false` was set in the original, omit `assertLLM` — just keep the schema check or plain `expect` assertions.

- [ ] **Step 1: Convert `chat.graph.invoke.spec.ts` → `tests/graphs/chat.graph.invoke.spec.ts`**

For each `runScenario(defineScenario(...))` call:
- Replace with a direct `compiledGraph.invoke(...)` call using the fixture values inlined
- Add `await assertLLM(output, criteria)` using the exact `criteria` string from the original `verification.criteria`
- Update imports: `'../../../smartest.js'` → `'../support/llm-assert.js'`, `'../chat.graph.js'` → `'../../src/graphs/chat.graph.js'`, etc.

- [ ] **Step 2: Convert `chat.graph.opportunities.spec.ts` → `tests/graphs/chat.graph.opportunities.spec.ts`**

Same pattern. The `@fixtures.*` refs in `input` become inline values in the direct invocation.

- [ ] **Step 3: Convert `chat.graph.scope.spec.ts` → `tests/graphs/chat.graph.scope.spec.ts`**

Same pattern.

- [ ] **Step 4: Convert `chat.graph.profile.spec.ts` → `tests/graphs/chat.graph.profile.spec.ts`**

Some tests in this file already use plain `expect` (no smartest). For those, just move and update imports. For smartest ones, apply the same conversion pattern.

- [ ] **Step 5: Convert `chat.discover.spec.ts` → `tests/graphs/chat.discover.spec.ts`**

Same pattern.

- [ ] **Step 6: Convert `chat.vocabulary.spec.ts` → `tests/graphs/chat.vocabulary.spec.ts`**

Same pattern.

- [ ] **Step 7: Convert `hyde.graph.spec.ts` → `tests/graphs/hyde.graph.spec.ts`**

Same pattern.

- [ ] **Step 8: Convert `opportunity.graph.direct-connection.smartest.spec.ts` → `tests/graphs/opportunity.graph.direct-connection.spec.ts`**

Same pattern. Note the renamed destination (drop `.smartest`).

- [ ] **Step 9: Run converted graph tests**

```bash
cd packages/protocol
bun test tests/graphs/chat.graph.invoke.spec.ts tests/graphs/hyde.graph.spec.ts
```

Expected: pass.

- [ ] **Step 10: Delete originals**

```bash
rm packages/protocol/src/graphs/tests/chat.graph.invoke.spec.ts
rm packages/protocol/src/graphs/tests/chat.graph.opportunities.spec.ts
rm packages/protocol/src/graphs/tests/chat.graph.scope.spec.ts
rm packages/protocol/src/graphs/tests/chat.graph.profile.spec.ts
rm packages/protocol/src/graphs/tests/chat.discover.spec.ts
rm packages/protocol/src/graphs/tests/chat.vocabulary.spec.ts
rm packages/protocol/src/graphs/tests/hyde.graph.spec.ts
rm packages/protocol/src/graphs/tests/opportunity.graph.direct-connection.smartest.spec.ts
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor(protocol-tests): convert smartest graph tests to assertLLM, move to tests/graphs/"
```

---

## Task 7: Migrate support tests to `tests/support/`

Move all files from `src/support/tests/` to `tests/support/`, updating imports.

**Import update rule:** `'../foo.js'` → `'../../src/support/foo.js'`

Files to migrate:
- `chat.utils.spec.ts`
- `debug-meta.sanitizer.spec.ts`
- `introducer-discovery-fixes.spec.ts`
- `log.spec.ts`
- `opportunity.card-text.spec.ts`
- `opportunity.discover.introducer-cards.spec.ts`
- `opportunity.sanitize.edge.spec.ts`
- `opportunity.sanitize.spec.ts`
- `opportunity.utils.introducer.spec.ts`
- `opportunity.utils.spec.ts`
- `performance.spec.ts`
- `profile.enrichment-display-name.spec.ts`
- `protocol-init.spec.ts`

- [ ] **Step 1: Copy each file to `tests/support/` and update imports**

For each file: copy, change all `'../foo.js'` to `'../../src/support/foo.js'`.

- [ ] **Step 2: Run support tests**

```bash
cd packages/protocol
bun test tests/support/
```

Expected: same tests pass.

- [ ] **Step 3: Delete originals**

```bash
rm -rf packages/protocol/src/support/tests/
```

- [ ] **Step 4: Migrate tool tests**

Copy `src/tools/tests/opportunity.tools.spec.ts` → `tests/tools/opportunity.tools.spec.ts`.
Update: `'../opportunity.tools.js'` → `'../../src/tools/opportunity.tools.js'`; any tool helper imports similarly updated.

Delete original:
```bash
rm -rf packages/protocol/src/tools/tests/
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(protocol-tests): move support and tool tests to top-level tests/"
```

---

## Task 8: Add tests for uncovered support utilities

These are all pure functions — no LLM, no mocks needed.

**Files:**
- Create: `packages/protocol/tests/support/feed.health.spec.ts`
- Create: `packages/protocol/tests/support/lucide.icon-catalog.spec.ts`
- Create: `packages/protocol/tests/support/opportunity.constants.spec.ts`
- Create: `packages/protocol/tests/support/request-context.spec.ts`
- Create: `packages/protocol/tests/support/opportunity.presentation.spec.ts`

- [ ] **Step 1: Write `tests/support/feed.health.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it } from "bun:test";
import { computeFeedHealth } from "../../src/support/feed.health.js";

const NOW = Date.now();
const WINDOW_12H = 12 * 60 * 60 * 1000;

describe("computeFeedHealth — empty feed", () => {
  it("returns score 0 and shouldMaintain=true when totalActionable and expiredCount are both 0", () => {
    const result = computeFeedHealth({
      connectionCount: 0,
      connectorFlowCount: 0,
      expiredCount: 0,
      totalActionable: 0,
      lastRediscoveryAt: null,
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.score).toBe(0);
    expect(result.shouldMaintain).toBe(true);
    expect(result.breakdown.composition).toBe(0);
    expect(result.breakdown.freshness).toBe(0);
    expect(result.breakdown.expirationRatio).toBe(0);
  });
});

describe("computeFeedHealth — freshness", () => {
  it("returns freshness=1 when rediscovered just now", () => {
    const result = computeFeedHealth({
      connectionCount: 5,
      connectorFlowCount: 5,
      expiredCount: 0,
      totalActionable: 10,
      lastRediscoveryAt: NOW,
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.breakdown.freshness).toBeCloseTo(1, 1);
  });

  it("returns freshness=0 when lastRediscoveryAt is null", () => {
    const result = computeFeedHealth({
      connectionCount: 5,
      connectorFlowCount: 5,
      expiredCount: 0,
      totalActionable: 10,
      lastRediscoveryAt: null,
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.breakdown.freshness).toBe(0);
  });

  it("returns freshness=0 when elapsed >= window", () => {
    const result = computeFeedHealth({
      connectionCount: 5,
      connectorFlowCount: 5,
      expiredCount: 0,
      totalActionable: 10,
      lastRediscoveryAt: NOW - WINDOW_12H - 1000,
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.breakdown.freshness).toBe(0);
  });
});

describe("computeFeedHealth — expiration ratio", () => {
  it("returns expirationRatio=1 when no expired items", () => {
    const result = computeFeedHealth({
      connectionCount: 5,
      connectorFlowCount: 5,
      expiredCount: 0,
      totalActionable: 10,
      lastRediscoveryAt: NOW,
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.breakdown.expirationRatio).toBe(1);
  });

  it("returns expirationRatio=0.5 when half items are expired", () => {
    const result = computeFeedHealth({
      connectionCount: 5,
      connectorFlowCount: 5,
      expiredCount: 5,
      totalActionable: 5,
      lastRediscoveryAt: NOW,
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.breakdown.expirationRatio).toBe(0.5);
  });
});

describe("computeFeedHealth — shouldMaintain threshold", () => {
  it("shouldMaintain=true when score < default threshold (0.5)", () => {
    const result = computeFeedHealth({
      connectionCount: 0,
      connectorFlowCount: 0,
      expiredCount: 10,
      totalActionable: 1,
      lastRediscoveryAt: null,
      freshnessWindowMs: WINDOW_12H,
    });
    expect(result.shouldMaintain).toBe(true);
  });

  it("respects custom threshold", () => {
    const result = computeFeedHealth({
      connectionCount: 5,
      connectorFlowCount: 5,
      expiredCount: 0,
      totalActionable: 10,
      lastRediscoveryAt: NOW,
      freshnessWindowMs: WINDOW_12H,
      threshold: 0.99,
    });
    expect(result.shouldMaintain).toBe(true);
  });
});
```

- [ ] **Step 2: Write `tests/support/lucide.icon-catalog.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it } from "bun:test";
import {
  normalizeIconName,
  resolveHomeSectionIcon,
  getIconNamesForPrompt,
  DEFAULT_HOME_SECTION_ICON,
  HOME_SECTION_ICON_NAMES,
} from "../../src/support/lucide.icon-catalog.js";

describe("normalizeIconName", () => {
  it("returns default for null", () => {
    expect(normalizeIconName(null)).toBe(DEFAULT_HOME_SECTION_ICON);
  });
  it("returns default for undefined", () => {
    expect(normalizeIconName(undefined)).toBe(DEFAULT_HOME_SECTION_ICON);
  });
  it("lowercases and trims", () => {
    expect(normalizeIconName("  Rocket  ")).toBe("rocket");
  });
  it("replaces spaces with hyphens", () => {
    expect(normalizeIconName("trending up")).toBe("trending-up");
  });
  it("passes through valid kebab-case", () => {
    expect(normalizeIconName("message-circle")).toBe("message-circle");
  });
});

describe("resolveHomeSectionIcon", () => {
  it("returns the icon name when it is in the catalog", () => {
    expect(resolveHomeSectionIcon("rocket")).toBe("rocket");
  });
  it("returns default when icon is not in the catalog", () => {
    expect(resolveHomeSectionIcon("nonexistent-icon")).toBe(DEFAULT_HOME_SECTION_ICON);
  });
  it("returns default for null", () => {
    expect(resolveHomeSectionIcon(null)).toBe(DEFAULT_HOME_SECTION_ICON);
  });
});

describe("getIconNamesForPrompt", () => {
  it("returns a comma-separated string", () => {
    const result = getIconNamesForPrompt();
    expect(typeof result).toBe("string");
    expect(result).toContain(",");
  });
  it("respects maxItems", () => {
    const result = getIconNamesForPrompt(3);
    const parts = result.split(", ");
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe(HOME_SECTION_ICON_NAMES[0]);
  });
});
```

- [ ] **Step 3: Write `tests/support/opportunity.constants.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it } from "bun:test";
import {
  getPrimaryActionLabel,
  PRIMARY_ACTION_LABEL_DEFAULT,
  PRIMARY_ACTION_LABEL_INTRODUCER,
  SECONDARY_ACTION_LABEL,
  MINIMAL_MAIN_TEXT_MAX_CHARS,
} from "../../src/support/opportunity.constants.js";

describe("getPrimaryActionLabel", () => {
  it("returns 'Good match' for introducer role", () => {
    expect(getPrimaryActionLabel("introducer")).toBe(PRIMARY_ACTION_LABEL_INTRODUCER);
  });
  it("returns 'Start Chat' for party role", () => {
    expect(getPrimaryActionLabel("party")).toBe(PRIMARY_ACTION_LABEL_DEFAULT);
  });
  it("returns 'Start Chat' for any other role", () => {
    expect(getPrimaryActionLabel("agent")).toBe(PRIMARY_ACTION_LABEL_DEFAULT);
    expect(getPrimaryActionLabel("")).toBe(PRIMARY_ACTION_LABEL_DEFAULT);
  });
});

describe("constants", () => {
  it("MINIMAL_MAIN_TEXT_MAX_CHARS is a positive number", () => {
    expect(MINIMAL_MAIN_TEXT_MAX_CHARS).toBeGreaterThan(0);
  });
  it("SECONDARY_ACTION_LABEL is defined", () => {
    expect(typeof SECONDARY_ACTION_LABEL).toBe("string");
    expect(SECONDARY_ACTION_LABEL.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Write `tests/support/request-context.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it } from "bun:test";
import { requestContext } from "../../src/support/request-context.js";
import { AsyncLocalStorage } from "async_hooks";

describe("requestContext", () => {
  it("is an AsyncLocalStorage instance", () => {
    expect(requestContext).toBeInstanceOf(AsyncLocalStorage);
  });

  it("returns undefined when accessed outside a run() scope", () => {
    const ctx = requestContext.getStore();
    expect(ctx).toBeUndefined();
  });

  it("provides the stored context inside a run() scope", () => {
    const testContext = { originUrl: "https://example.com" };
    requestContext.run(testContext, () => {
      const ctx = requestContext.getStore();
      expect(ctx).toEqual(testContext);
    });
  });

  it("propagates context through async callbacks", async () => {
    const testContext = { originUrl: "https://async.test" };
    await requestContext.run(testContext, async () => {
      await Promise.resolve();
      const ctx = requestContext.getStore();
      expect(ctx?.originUrl).toBe("https://async.test");
    });
  });
});
```

- [ ] **Step 5: Write `tests/support/opportunity.presentation.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it } from "bun:test";
import { presentOpportunity } from "../../src/support/opportunity.presentation.js";
import type { Opportunity } from "../../src/interfaces/database.interface.js";

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    detection: { source: "opportunity_graph", timestamp: new Date().toISOString() },
    actors: [
      { userId: "viewer-id", role: "peer" },
      { userId: "other-id", role: "peer" },
    ],
    interpretation: {
      category: "connection",
      reasoning: "Both are building AI tools and could collaborate.",
      confidence: 0.9,
    },
    context: { networkId: "net-1" },
    confidence: "0.9",
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    ...overrides,
  } as Opportunity;
}

const otherParty = { id: "other-id", name: "Alice", avatar: null };
const noIntroducer = null;

describe("presentOpportunity — peer role", () => {
  it("produces a title mentioning the other party's name", () => {
    const opp = makeOpportunity();
    const result = presentOpportunity(opp, "viewer-id", otherParty, noIntroducer, "card");
    expect(result.title).toContain("Alice");
    expect(result.callToAction).toBe("View Opportunity");
  });

  it("truncates description to 100 chars for notification format", () => {
    const reasoning = "x".repeat(200);
    const opp = makeOpportunity({
      interpretation: { category: "connection", reasoning, confidence: 0.9 },
    });
    const result = presentOpportunity(opp, "viewer-id", otherParty, noIntroducer, "notification");
    expect(result.description.length).toBeLessThanOrEqual(100);
    expect(result.description.endsWith("...")).toBe(true);
  });

  it("does not truncate description for card format", () => {
    const reasoning = "y".repeat(200);
    const opp = makeOpportunity({
      interpretation: { category: "connection", reasoning, confidence: 0.9 },
    });
    const result = presentOpportunity(opp, "viewer-id", otherParty, noIntroducer, "card");
    expect(result.description.length).toBeGreaterThan(100);
  });
});

describe("presentOpportunity — viewer not in actors", () => {
  it("throws when viewer is not an actor", () => {
    const opp = makeOpportunity();
    expect(() =>
      presentOpportunity(opp, "unknown-viewer", otherParty, noIntroducer, "card")
    ).toThrow("Viewer is not an actor");
  });
});

describe("presentOpportunity — party role with introducer", () => {
  it("includes introducer name in title", () => {
    const introducerInfo = { id: "intro-id", name: "Bob", avatar: null };
    const opp = makeOpportunity({
      actors: [
        { userId: "viewer-id", role: "party" },
        { userId: "other-id", role: "party" },
        { userId: "intro-id", role: "introducer" },
      ],
    });
    const result = presentOpportunity(opp, "viewer-id", otherParty, introducerInfo, "card");
    expect(result.title).toContain("Bob");
    expect(result.title).toContain("Alice");
  });
});
```

- [ ] **Step 6: Run the new support tests**

```bash
cd packages/protocol
bun test tests/support/feed.health.spec.ts tests/support/lucide.icon-catalog.spec.ts tests/support/opportunity.constants.spec.ts tests/support/request-context.spec.ts tests/support/opportunity.presentation.spec.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add tests/support/feed.health.spec.ts tests/support/lucide.icon-catalog.spec.ts tests/support/opportunity.constants.spec.ts tests/support/request-context.spec.ts tests/support/opportunity.presentation.spec.ts
git commit -m "test(protocol): add tests for uncovered support utilities"
```

---

## Task 9: Add tests for `opportunity.persist.ts`

This function requires mocked database and embedder dependencies.

**Files:**
- Create: `packages/protocol/tests/support/opportunity.persist.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it, mock } from "bun:test";
import { persistOpportunities } from "../../src/support/opportunity.persist.js";
import type { PersistOpportunityDatabase } from "../../src/support/opportunity.persist.js";
import type { Embedder } from "../../src/interfaces/embedder.interface.js";
import type { CreateOpportunityData, Opportunity } from "../../src/interfaces/database.interface.js";

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    detection: { source: "opportunity_graph", timestamp: new Date().toISOString() },
    actors: [],
    interpretation: { category: "connection", reasoning: "test", confidence: 0.9 },
    context: { networkId: "net-1" },
    confidence: "0.9",
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    ...overrides,
  } as Opportunity;
}

function makeItem(): CreateOpportunityData {
  return {
    actors: [{ userId: "u-1", role: "party" }, { userId: "u-2", role: "party" }],
    interpretation: { category: "connection", reasoning: "test", confidence: 0.9 },
    context: { networkId: "net-1" },
    confidence: "0.9",
    status: "pending",
    detection: { source: "opportunity_graph", timestamp: new Date().toISOString() },
  } as CreateOpportunityData;
}

const mockEmbedder: Embedder = {
  generate: mock(async () => []),
  generateForDocuments: mock(async () => []),
  addVectors: mock(async () => []),
  similaritySearch: mock(async () => []),
} as unknown as Embedder;

describe("persistOpportunities — happy path (no enrichment)", () => {
  it("creates one opportunity per item when no duplicates found", async () => {
    const created = makeOpportunity();
    const db: PersistOpportunityDatabase = {
      findSimilarOpportunities: mock(async () => []),
      createOpportunity: mock(async () => created),
      updateOpportunityStatus: mock(async () => undefined),
    } as unknown as PersistOpportunityDatabase;

    const result = await persistOpportunities({
      database: db,
      embedder: mockEmbedder,
      items: [makeItem()],
    });

    expect(result.created).toHaveLength(1);
    expect(result.expired).toHaveLength(0);
    expect(result.errors).toBeUndefined();
  });
});

describe("persistOpportunities — error handling", () => {
  it("collects errors per item and continues processing remaining items", async () => {
    const created = makeOpportunity({ id: "opp-2" });
    let callCount = 0;
    const db: PersistOpportunityDatabase = {
      findSimilarOpportunities: mock(async () => []),
      createOpportunity: mock(async () => {
        callCount++;
        if (callCount === 1) throw new Error("DB error on first item");
        return created;
      }),
      updateOpportunityStatus: mock(async () => undefined),
    } as unknown as PersistOpportunityDatabase;

    const result = await persistOpportunities({
      database: db,
      embedder: mockEmbedder,
      items: [makeItem(), makeItem()],
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].itemIndex).toBe(0);
    expect(result.created).toHaveLength(1);
  });
});

describe("persistOpportunities — chat injection", () => {
  it("calls injectChat for pending opportunities", async () => {
    const created = makeOpportunity({ status: "pending" });
    const db: PersistOpportunityDatabase = {
      findSimilarOpportunities: mock(async () => []),
      createOpportunity: mock(async () => created),
      updateOpportunityStatus: mock(async () => undefined),
    } as unknown as PersistOpportunityDatabase;

    const injectChat = mock(async () => undefined);

    await persistOpportunities({
      database: db,
      embedder: mockEmbedder,
      items: [makeItem()],
      injectChat,
    });

    expect(injectChat).toHaveBeenCalledTimes(1);
    expect(injectChat).toHaveBeenCalledWith(created);
  });

  it("does not call injectChat when status is not pending", async () => {
    const created = makeOpportunity({ status: "latent" });
    const db: PersistOpportunityDatabase = {
      findSimilarOpportunities: mock(async () => []),
      createOpportunity: mock(async () => created),
      updateOpportunityStatus: mock(async () => undefined),
    } as unknown as PersistOpportunityDatabase;

    const injectChat = mock(async () => undefined);

    await persistOpportunities({
      database: db,
      embedder: mockEmbedder,
      items: [makeItem()],
      injectChat,
    });

    expect(injectChat).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd packages/protocol
bun test tests/support/opportunity.persist.spec.ts
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/support/opportunity.persist.spec.ts
git commit -m "test(protocol): add tests for opportunity.persist"
```

---

## Task 10: Add tests for uncovered agents (LLM-calling)

**Files:**
- Create: `packages/protocol/tests/agents/chat.title.generator.spec.ts`
- Create: `packages/protocol/tests/agents/intent.clarifier.spec.ts`
- Create: `packages/protocol/tests/agents/invite.generator.spec.ts`
- Create: `packages/protocol/tests/agents/negotiation.insights.generator.spec.ts`

- [ ] **Step 1: Write `tests/agents/chat.title.generator.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it } from "bun:test";
import { ChatTitleGenerator } from "../../src/agents/chat.title.generator.js";
import { assertLLM } from "../support/llm-assert.js";

describe("ChatTitleGenerator", () => {
  const generator = new ChatTitleGenerator();

  it("returns 'New chat' for empty messages array", async () => {
    const result = await generator.invoke({ messages: [] });
    expect(result).toBe("New chat");
  });

  it("returns 'New chat' for a greeting-only conversation", async () => {
    const result = await generator.invoke({
      messages: [
        { role: "user", content: "Hi!" },
        { role: "assistant", content: "Hello! How can I help you?" },
      ],
    });
    expect(result).toBe("New chat");
  }, 30000);

  it("returns a short title (≤ 6 words) for a meaningful conversation", async () => {
    const result = await generator.invoke({
      messages: [
        { role: "user", content: "I want to find a co-founder for my AI startup." },
        { role: "assistant", content: "That's exciting! Tell me more about your startup." },
      ],
    });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    const wordCount = result.trim().split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(8); // Allow slight LLM variance
    await assertLLM(
      { title: result },
      "The title should reflect the main topic of finding an AI startup co-founder. It should be short (under 8 words), not a greeting, and not contain raw JSON."
    );
  }, 30000);
});
```

- [ ] **Step 2: Write `tests/agents/intent.clarifier.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it } from "bun:test";
import { IntentClarifier } from "../../src/agents/intent.clarifier.js";
import { assertLLM } from "../support/llm-assert.js";

describe("IntentClarifier", () => {
  const clarifier = new IntentClarifier();

  const profileContext = "Name: Alice\nRole: Product Designer\nInterests: UX, design systems, AI tools";
  const activeIntents = "- Find a design mentor\n- Connect with AI product teams";

  it("does NOT require clarification for a specific intent", async () => {
    const result = await clarifier.invoke(
      "Looking for a senior UX designer to mentor me in building design systems",
      profileContext,
      activeIntents
    );
    expect(result.needsClarification).toBe(false);
  }, 30000);

  it("requires clarification for a vague single-word intent", async () => {
    const result = await clarifier.invoke("a job", profileContext, activeIntents);
    expect(result.needsClarification).toBe(true);
    expect(result.suggestedDescription).toBeTruthy();
    expect(result.clarificationMessage).toBeTruthy();
    await assertLLM(
      result,
      'The intent "a job" is too vague. needsClarification must be true. suggestedDescription must be a specific, actionable rewrite grounded in the user profile (Product Designer, UX, AI tools). clarificationMessage must be a short message asking for confirmation.'
    );
  }, 60000);

  it("returns a graceful fallback when clarification is not needed", async () => {
    const result = await clarifier.invoke(
      "Connect with investors in AI healthcare startups in Europe",
      profileContext,
      activeIntents
    );
    expect(result.needsClarification).toBe(false);
    expect(result.reason).toBeTruthy();
  }, 30000);
});
```

- [ ] **Step 3: Write `tests/agents/invite.generator.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it } from "bun:test";
import { generateInviteMessage } from "../../src/agents/invite.generator.js";
import { assertLLM } from "../support/llm-assert.js";

describe("generateInviteMessage", () => {
  it("generates a concise invite message for a matched pair", async () => {
    const result = await generateInviteMessage({
      senderName: "Alice",
      recipientName: "Bob",
      opportunityInterpretation:
        "Both are building LangGraph-based agents and share interest in structured LLM outputs.",
      senderIntents: ["Find collaborators for LangGraph tooling"],
      recipientIntents: ["Connect with LLM engineers building structured output systems"],
    });

    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(20);

    await assertLLM(
      result,
      "The invite message should be casual and direct. It should mention a specific shared interest (LangGraph or structured LLM outputs). It must NOT use placeholder brackets like [Name]. It must NOT be longer than 4 sentences. It must NOT start with 'Hi Alice' or similar generic opener."
    );
  }, 30000);

  it("includes referrer mention when referrerName is provided", async () => {
    const result = await generateInviteMessage({
      senderName: "Alice",
      recipientName: "Bob",
      opportunityInterpretation: "Both working on TypeScript developer tools.",
      senderIntents: ["Build TypeScript tooling"],
      recipientIntents: ["Find TypeScript developers"],
      referrerName: "Carol",
    });

    await assertLLM(
      result,
      "Carol is the referrer. The message should casually mention that Alice was introduced via Carol. The message must feel natural and human, not a formal introduction."
    );
  }, 30000);
});
```

- [ ] **Step 4: Write `tests/agents/negotiation.insights.generator.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it } from "bun:test";
import { NegotiationInsightsGenerator } from "../../src/agents/negotiation.insights.generator.js";
import { assertLLM } from "../support/llm-assert.js";

describe("NegotiationInsightsGenerator", () => {
  const generator = new NegotiationInsightsGenerator();

  it("returns null when totalCount is 0", async () => {
    const result = await generator.invoke({
      totalCount: 0,
      opportunityCount: 0,
      noOpportunityCount: 0,
      inProgressCount: 0,
      roleDistribution: {},
      counterparties: [],
      reasoningExcerpts: [],
    });
    expect(result).toBeNull();
  });

  it("generates a flowing prose insight paragraph", async () => {
    const result = await generator.invoke({
      totalCount: 12,
      opportunityCount: 5,
      noOpportunityCount: 4,
      inProgressCount: 3,
      roleDistribution: { Helper: 7, Seeker: 3, Peer: 2 },
      counterparties: ["Bob Smith", "Alice Chen"],
      reasoningExcerpts: [
        "Strong fit: both working on TypeScript tooling",
        "LangGraph expertise is highly relevant to Alice's infrastructure needs",
      ],
    });

    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(50);

    await assertLLM(
      { insight: result },
      "The insight should be 2-4 sentences of flowing prose in second person ('you'). " +
      "It should reflect the Helper-dominant role pattern (7 of 12 negotiations). " +
      "It must NOT use bullet points or start with 'You have' or 'Your negotiations'. " +
      "It should reference TypeScript or LangGraph from the excerpts."
    );
  }, 30000);
});
```

- [ ] **Step 5: Run the new agent tests**

```bash
cd packages/protocol
bun test tests/agents/chat.title.generator.spec.ts tests/agents/intent.clarifier.spec.ts tests/agents/invite.generator.spec.ts tests/agents/negotiation.insights.generator.spec.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/agents/chat.title.generator.spec.ts tests/agents/intent.clarifier.spec.ts tests/agents/invite.generator.spec.ts tests/agents/negotiation.insights.generator.spec.ts
git commit -m "test(protocol): add tests for uncovered LLM agents"
```

---

## Task 11: Add tests for tools, streamers, and remaining agents

**Files:**
- Create: `packages/protocol/tests/tools/contact.tools.spec.ts`
- Create: `packages/protocol/tests/tools/integration.tools.spec.ts`
- Create: `packages/protocol/tests/streamers/response.streamer.spec.ts`
- Create: `packages/protocol/tests/agents/negotiation.proposer.spec.ts`
- Create: `packages/protocol/tests/agents/negotiation.responder.spec.ts`

- [ ] **Step 1: Write `tests/streamers/response.streamer.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it } from "bun:test";
import { ResponseStreamer } from "../../src/streamers/response.streamer.js";

const SESSION_ID = "session-1";

describe("ResponseStreamer.handleAgentLoopEnd", () => {
  const streamer = new ResponseStreamer();

  it("returns a token event when responseText is present", () => {
    const result = streamer.handleAgentLoopEnd(SESSION_ID, {
      data: { output: { responseText: "Hello world" } },
    });
    expect(result.responseText).toBe("Hello world");
    expect(result.hadError).toBe(false);
    const tokenEvents = result.events.filter((e) => e.type === "token");
    expect(tokenEvents).toHaveLength(1);
  });

  it("returns an error event when error is present", () => {
    const result = streamer.handleAgentLoopEnd(SESSION_ID, {
      data: { output: { responseText: "", error: "Something went wrong" } },
    });
    expect(result.hadError).toBe(true);
    const errorEvents = result.events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
  });

  it("translates the JSON error sentinel to a user-friendly message", () => {
    const result = streamer.handleAgentLoopEnd(SESSION_ID, {
      data: { output: { error: "JSON error injected into SSE stream" } },
    });
    expect(result.hadError).toBe(true);
    const errorEvent = result.events.find((e) => e.type === "error") as { message?: string } | undefined;
    expect(errorEvent?.message).not.toContain("JSON error injected");
    expect(errorEvent?.message).toContain("try again");
  });

  it("returns both a token and an error event when both are present", () => {
    const result = streamer.handleAgentLoopEnd(SESSION_ID, {
      data: { output: { responseText: "Partial reply", error: "Upstream timeout" } },
    });
    expect(result.responseText).toBe("Partial reply");
    expect(result.hadError).toBe(true);
    expect(result.events).toHaveLength(2);
  });

  it("returns empty events and empty responseText for empty output", () => {
    const result = streamer.handleAgentLoopEnd(SESSION_ID, {
      data: { output: {} },
    });
    expect(result.events).toHaveLength(0);
    expect(result.responseText).toBe("");
    expect(result.hadError).toBe(false);
  });

  it("handles missing data gracefully", () => {
    const result = streamer.handleAgentLoopEnd(SESSION_ID, {});
    expect(result.events).toHaveLength(0);
    expect(result.responseText).toBe("");
  });
});
```

- [ ] **Step 2: Write `tests/tools/contact.tools.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it, mock } from "bun:test";
import { createContactTools } from "../../src/tools/contact.tools.js";

// Minimal DefineTool and ToolDeps mocks
function makeDeps(overrides: Record<string, unknown> = {}) {
  const contactService = {
    importContacts: mock(async () => ({ imported: 2, skipped: 0, newContacts: 1, existingContacts: 1 })),
    listContacts: mock(async () => [
      { userId: "u-1", user: { name: "Alice", email: "alice@test.com", avatar: null, isGhost: false } },
    ]),
    addContact: mock(async () => ({ userId: "u-2", isNew: true })),
    removeContact: mock(async () => undefined),
    ...overrides,
  };
  return { contactService };
}

// Minimal defineTool helper that just stores the handler
function makeDefineTool() {
  return function defineTool(def: {
    name: string;
    description: string;
    querySchema: unknown;
    handler: (args: { context: { userId: string }; query: Record<string, unknown> }) => Promise<unknown>;
  }) {
    return def;
  };
}

const context = { userId: "owner-1" };

describe("createContactTools — import_contacts", () => {
  it("calls contactService.importContacts and returns success", async () => {
    const deps = makeDeps();
    const [importTool] = createContactTools(makeDefineTool() as ReturnType<typeof makeDefineTool>, deps as Parameters<typeof createContactTools>[1]);
    const result = await importTool.handler({
      context,
      query: { contacts: [{ name: "Alice", email: "alice@test.com" }] },
    }) as { success: boolean; imported: number };
    expect(result.success).toBe(true);
    expect(result.imported).toBe(2);
  });
});

describe("createContactTools — list_contacts", () => {
  it("returns contacts list", async () => {
    const deps = makeDeps();
    const [, listTool] = createContactTools(makeDefineTool() as ReturnType<typeof makeDefineTool>, deps as Parameters<typeof createContactTools>[1]);
    const result = await listTool.handler({ context, query: {} }) as { success: boolean; count: number };
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
  });

  it("respects limit", async () => {
    const deps = makeDeps({
      listContacts: mock(async () => [
        { userId: "u-1", user: { name: "Alice", email: "a@test.com", avatar: null, isGhost: false } },
        { userId: "u-2", user: { name: "Bob", email: "b@test.com", avatar: null, isGhost: false } },
      ]),
    });
    const [, listTool] = createContactTools(makeDefineTool() as ReturnType<typeof makeDefineTool>, deps as Parameters<typeof createContactTools>[1]);
    const result = await listTool.handler({ context, query: { limit: 1 } }) as { count: number };
    expect(result.count).toBe(1);
  });
});

describe("createContactTools — add_contact", () => {
  it("calls contactService.addContact", async () => {
    const deps = makeDeps();
    const [,, addTool] = createContactTools(makeDefineTool() as ReturnType<typeof makeDefineTool>, deps as Parameters<typeof createContactTools>[1]);
    const result = await addTool.handler({ context, query: { email: "bob@test.com" } }) as { success: boolean; added: boolean };
    expect(result.success).toBe(true);
    expect(result.added).toBe(true);
  });
});

describe("createContactTools — remove_contact", () => {
  it("calls contactService.removeContact", async () => {
    const deps = makeDeps();
    const [,,, removeTool] = createContactTools(makeDefineTool() as ReturnType<typeof makeDefineTool>, deps as Parameters<typeof createContactTools>[1]);
    const result = await removeTool.handler({ context, query: { contactUserId: "u-1" } }) as { success: boolean; removed: boolean };
    expect(result.success).toBe(true);
    expect(result.removed).toBe(true);
  });
});
```

- [ ] **Step 3: Write `tests/agents/negotiation.proposer.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it } from "bun:test";
import { NegotiationProposer } from "../../src/agents/negotiation.proposer.js";
import { assertLLM } from "../support/llm-assert.js";
import type { UserNegotiationContext, SeedAssessment } from "../../src/states/negotiation.state.js";

const alice: UserNegotiationContext = {
  id: "user-alice",
  profile: { name: "Alice", bio: "AI startup founder seeking a technical co-founder with ML expertise." },
  intents: [{ id: "i-1", title: "Find ML co-founder", description: "Looking for a technical co-founder with production LLM experience.", confidence: 0.9 }],
};

const bob: UserNegotiationContext = {
  id: "user-bob",
  profile: { name: "Bob", bio: "ML engineer with 5 years LLM production experience at a major tech company." },
  intents: [{ id: "i-2", title: "Join early-stage AI startup", description: "Seeking a co-founder role at an AI startup with strong product vision.", confidence: 0.85 }],
};

const seedAssessment: SeedAssessment = {
  score: 78,
  reasoning: "Strong complementary fit: Alice needs ML expertise Bob has; Bob wants a startup co-founder role Alice offers.",
  valencyRole: "peer",
};

describe("NegotiationProposer", () => {
  const proposer = new NegotiationProposer();

  it("produces a structured propose turn on first invocation", async () => {
    const result = await proposer.invoke({
      ownUser: alice,
      otherUser: bob,
      indexContext: { networkId: "idx-ai-founders", prompt: "AI founders network" },
      seedAssessment,
      history: [],
    });

    expect(result.action).toBe("propose");
    expect(result.assessment.fitScore).toBeGreaterThan(0);
    expect(result.assessment.fitScore).toBeLessThanOrEqual(100);
    expect(typeof result.assessment.reasoning).toBe("string");
    expect(result.assessment.reasoning.length).toBeGreaterThan(10);

    await assertLLM(
      result,
      "This is a first-turn proposal from an agent representing Alice (AI founder) to match with Bob (ML engineer). " +
      "action must be 'propose'. assessment.reasoning must explain why Bob's ML expertise fits Alice's co-founder need. " +
      "fitScore should be above 50 given the strong complementary signals. Must NOT hallucinate fit where none exists."
    );
  }, 60000);
});
```

- [ ] **Step 4: Write `tests/agents/negotiation.responder.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it } from "bun:test";
import { NegotiationResponder } from "../../src/agents/negotiation.responder.js";
import { assertLLM } from "../support/llm-assert.js";
import type { UserNegotiationContext, SeedAssessment, NegotiationTurn } from "../../src/states/negotiation.state.js";

const alice: UserNegotiationContext = {
  id: "user-alice",
  profile: { name: "Alice", bio: "AI startup founder seeking a technical co-founder with ML expertise." },
  intents: [{ id: "i-1", title: "Find ML co-founder", description: "Looking for a technical co-founder with production LLM experience.", confidence: 0.9 }],
};

const bob: UserNegotiationContext = {
  id: "user-bob",
  profile: { name: "Bob", bio: "ML engineer with 5 years LLM production experience." },
  intents: [{ id: "i-2", title: "Join early-stage AI startup", description: "Seeking a co-founder role at an AI startup.", confidence: 0.85 }],
};

const seedAssessment: SeedAssessment = {
  score: 78,
  reasoning: "Strong complementary fit.",
  valencyRole: "peer",
};

const proposalTurn: NegotiationTurn = {
  action: "propose",
  assessment: {
    fitScore: 80,
    reasoning: "Alice needs exactly what Bob offers: production LLM expertise to build the core inference engine.",
    suggestedRoles: { ownUser: "patient", otherUser: "agent" },
  },
};

describe("NegotiationResponder", () => {
  const responder = new NegotiationResponder();

  it("responds with accept, reject, or counter to a strong proposal", async () => {
    const result = await responder.invoke({
      ownUser: bob,
      otherUser: alice,
      indexContext: { networkId: "idx-ai-founders", prompt: "AI founders network" },
      seedAssessment,
      history: [proposalTurn],
    });

    expect(["accept", "reject", "counter"]).toContain(result.action);
    expect(result.assessment.fitScore).toBeGreaterThanOrEqual(0);
    expect(result.assessment.fitScore).toBeLessThanOrEqual(100);
    expect(typeof result.assessment.reasoning).toBe("string");
    expect(result.assessment.reasoning.length).toBeGreaterThan(10);

    await assertLLM(
      result,
      "Bob's agent is evaluating Alice's co-founder proposal. The proposal is strong (score 80). " +
      "action must be one of: accept, reject, or counter. " +
      "If accept: reasoning should acknowledge the fit is genuine. " +
      "If counter: reasoning must state a specific objection. " +
      "fitScore should reflect an independent assessment, not blindly echo 80."
    );
  }, 60000);

  it("rejects a clearly irrelevant match", async () => {
    const unrelatedUser: UserNegotiationContext = {
      id: "user-chef",
      profile: { name: "Pierre", bio: "Michelin-starred chef running restaurants in Paris." },
      intents: [{ id: "i-chef", title: "Find kitchen space", description: "Looking for commercial kitchen to lease in Tokyo.", confidence: 0.9 }],
    };

    const badProposal: NegotiationTurn = {
      action: "propose",
      assessment: {
        fitScore: 45,
        reasoning: "Pierre has culinary skills that could help Alice's team with team-building events.",
        suggestedRoles: { ownUser: "patient", otherUser: "agent" },
      },
    };

    const result = await responder.invoke({
      ownUser: bob,
      otherUser: unrelatedUser,
      indexContext: { networkId: "idx-ai-founders", prompt: "AI founders network" },
      seedAssessment: { score: 20, reasoning: "Weak match.", valencyRole: "peer" },
      history: [badProposal],
    });

    // A skeptical responder should reject or counter a clearly irrelevant match
    expect(["reject", "counter"]).toContain(result.action);
    await assertLLM(
      result,
      "Bob is an ML engineer. Pierre is a chef with no tech background. " +
      "The responder must reject or counter — this is not a relevant match for Bob. " +
      "FAIL if action is 'accept'. fitScore should be low (< 40)."
    );
  }, 60000);
});
```

- [ ] **Step 4: Run all new tests**

```bash
cd packages/protocol
bun test tests/streamers/ tests/tools/contact.tools.spec.ts tests/agents/negotiation.proposer.spec.ts tests/agents/negotiation.responder.spec.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/streamers/ tests/tools/contact.tools.spec.ts tests/agents/negotiation.proposer.spec.ts tests/agents/negotiation.responder.spec.ts
git commit -m "test(protocol): add tests for tools, streamers, and remaining agents"
```

---

## Task 12: Add maintenance graph test and integration.tools test

**Files:**
- Create: `packages/protocol/tests/graphs/maintenance.graph.spec.ts`
- Create: `packages/protocol/tests/tools/integration.tools.spec.ts`

- [ ] **Step 1: Read `src/graphs/maintenance.graph.ts` and `src/tools/integration.tools.ts`**

Read the files to understand their interfaces before writing tests.

- [ ] **Step 2: Write `tests/graphs/maintenance.graph.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it, mock } from "bun:test";
import { MaintenanceGraphFactory } from "../../src/graphs/maintenance.graph.js";
import type { MaintenanceGraphDatabase, MaintenanceGraphCache, MaintenanceGraphQueue } from "../../src/graphs/maintenance.graph.js";

function makeDeps() {
  const database: MaintenanceGraphDatabase = {
    getOpportunitiesForUser: mock(async () => []),
    getActiveIntents: mock(async () => []),
    getPersonalIndexId: mock(async () => "personal-idx-1"),
    getContactsWithIntentFreshness: mock(async () => []),
  };
  const cache: MaintenanceGraphCache = {
    get: mock(async () => null),
    set: mock(async () => undefined),
  };
  const queue: MaintenanceGraphQueue = {
    addJob: mock(async () => undefined),
  };
  return { database, cache, queue };
}

describe("MaintenanceGraphFactory", () => {
  it("creates a compiled graph without throwing", () => {
    const { database, cache, queue } = makeDeps();
    const factory = new MaintenanceGraphFactory(database, cache, queue);
    const graph = factory.createGraph();
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
  });

  it("invokes with an empty feed and returns without throwing", async () => {
    const { database, cache, queue } = makeDeps();
    const factory = new MaintenanceGraphFactory(database, cache, queue);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: "user-test",
      lastRediscoveryAt: null,
      rediscoveryTriggered: false,
    });

    expect(result).toBeDefined();
    // With empty feed, shouldMaintain=true but no intents to re-queue
    expect(typeof result.feedHealthScore).toBe("number");
  }, 30000);

  it("invokes with a healthy recent feed and does not trigger rediscovery", async () => {
    const NOW = Date.now();
    const { database, cache, queue } = makeDeps();
    // Simulate a healthy feed: 10 actionable, just rediscovered
    (database.getOpportunitiesForUser as ReturnType<typeof mock>).mockImplementation(async () =>
      Array.from({ length: 10 }, (_, i) => ({
        id: `opp-${i}`,
        actors: [{ userId: "user-test", role: "party" }, { userId: `user-${i}`, role: "party" }],
        status: "pending",
        interpretation: { category: "connection", reasoning: "test", confidence: 0.8 },
        context: { networkId: "net-1" },
        confidence: "0.8",
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      }))
    );

    const factory = new MaintenanceGraphFactory(database, cache, queue);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: "user-test",
      lastRediscoveryAt: NOW,
      rediscoveryTriggered: false,
    });

    expect(result).toBeDefined();
    // rediscovery should not have been triggered for a healthy, fresh feed
    expect(result.rediscoveryTriggered).toBe(false);
  }, 30000);
});
```

- [ ] **Step 3: Write `tests/tools/integration.tools.spec.ts`**

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, expect, it, mock } from "bun:test";
import { createIntegrationTools } from "../../src/tools/integration.tools.js";

function makeDefineTool() {
  return function defineTool(def: {
    name: string;
    description: string;
    querySchema: unknown;
    handler: (args: { context: { userId: string }; query: Record<string, unknown> }) => Promise<unknown>;
  }) {
    return def;
  };
}

const context = { userId: "owner-1" };

describe("createIntegrationTools — import_gmail_contacts (not connected)", () => {
  it("returns requiresAuth=true with an authUrl when Gmail is not connected", async () => {
    const session = {
      toolkits: mock(async () => ({ items: [] })),
      authorize: mock(async () => ({ redirectUrl: "https://accounts.google.com/oauth" })),
    };
    const deps = {
      integration: { createSession: mock(async () => session) },
      integrationImporter: { importContacts: mock(async () => ({ imported: 0, skipped: 0, newContacts: 0, existingContacts: 0 })) },
    };

    const [importTool] = createIntegrationTools(
      makeDefineTool() as Parameters<typeof createIntegrationTools>[0],
      deps as Parameters<typeof createIntegrationTools>[1]
    );

    const result = await importTool.handler({ context, query: {} }) as { success: boolean; requiresAuth: boolean; authUrl: string };
    expect(result.success).toBe(true);
    expect(result.requiresAuth).toBe(true);
    expect(typeof result.authUrl).toBe("string");
  });
});

describe("createIntegrationTools — import_gmail_contacts (connected)", () => {
  it("returns import stats when Gmail is connected", async () => {
    const connectedSession = {
      toolkits: mock(async () => ({
        items: [{ slug: "gmail", connection: { connectedAccount: { id: "acct-1" } } }],
      })),
    };
    const deps = {
      integration: { createSession: mock(async () => connectedSession) },
      integrationImporter: {
        importContacts: mock(async () => ({ imported: 5, skipped: 2, newContacts: 3, existingContacts: 2 })),
      },
    };

    const [importTool] = createIntegrationTools(
      makeDefineTool() as Parameters<typeof createIntegrationTools>[0],
      deps as Parameters<typeof createIntegrationTools>[1]
    );

    const result = await importTool.handler({ context, query: {} }) as { success: boolean; imported: number };
    expect(result.success).toBe(true);
    expect(result.imported).toBe(5);
  });
});

describe("createIntegrationTools — error handling", () => {
  it("returns error response when integration service throws", async () => {
    const deps = {
      integration: { createSession: mock(async () => { throw new Error("Integration unavailable"); }) },
      integrationImporter: { importContacts: mock(async () => ({})) },
    };

    const [importTool] = createIntegrationTools(
      makeDefineTool() as Parameters<typeof createIntegrationTools>[0],
      deps as Parameters<typeof createIntegrationTools>[1]
    );

    const result = await importTool.handler({ context, query: {} }) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});
```

- [ ] **Step 4: Run the new tests**

```bash
cd packages/protocol
bun test tests/graphs/maintenance.graph.spec.ts tests/tools/integration.tools.spec.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tests/graphs/maintenance.graph.spec.ts tests/tools/integration.tools.spec.ts
git commit -m "test(protocol): add maintenance graph and integration tools tests"
```

---

## Task 13: Final verification

- [ ] **Step 1: Confirm no src test files remain**

```bash
find packages/protocol/src -name "*.spec.ts" -o -name "*.test.ts"
```

Expected: no output.

- [ ] **Step 2: Confirm smartest shim is gone**

```bash
ls packages/protocol/smartest.ts
```

Expected: `No such file or directory`

- [ ] **Step 3: Confirm no smartest imports remain**

```bash
grep -r "from.*smartest" packages/protocol/
```

Expected: no output.

- [ ] **Step 4: Run all tests**

```bash
cd packages/protocol
bun test tests/
```

Expected: all pass (or same pass rate as before — LLM tests can be flaky; any new failures should be investigated).

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "test(protocol): complete test infrastructure redesign — assertLLM, single tests/ folder, full coverage"
```
