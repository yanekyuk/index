# Test Harness Design

**Date:** 2026-03-24
**Status:** Draft
**Replaces:** `lib/smartest/` (LLM-verified scenario framework)

## Problem

The current `smartest` framework introduces unnecessary abstractions (`defineScenario`, `runScenario`, `expectSmartest`, fixture refs) that obscure what tests actually do. Its LLM-as-judge approach is unreliable and slow. Test files are bloated with semantically irrelevant boilerplate. We need a testing approach that:

- Feels like standard bun tests (`describe`/`it`/`expect`)
- Injects real infrastructure (database, queue, embedder) for integration testing
- Catches schema drift, semantic drift, and behavioral drift
- Uses an LLM judge only for truly semantic checks, with scored criteria instead of binary pass/fail

## Design

### Overview

Two components:

1. **Test Harness** — a `createTestHarness()` factory that wires real adapters for testing
2. **Assertion Functions** — `assertMatchesSchema()` for deterministic checks, `assertLLMEvaluate()` for semantic checks

No framework, no scenario DSL, no fixture system. Just bun tests with infra injection and two assertion functions.

### Test Harness

`createTestHarness()` returns real adapters wired for a test environment.

```typescript
import { createTestHarness } from "../lib/test-harness";

const harness = createTestHarness();
const { db, queue, embedder, graphs } = harness;

beforeAll(async () => {
  await harness.setup();     // connects, runs migrations on test DB
});

afterAll(async () => {
  await harness.teardown();  // cleans up connections
});

afterEach(async () => {
  await harness.reset();     // truncates tables between tests
});
```

**Key decisions:**

- Uses real database, embedder, queue — not mocks
- Database URL from `DATABASE_TEST_URL` env var (or derived from `DATABASE_URL` with `_test` suffix)
- `setup()` creates a dedicated Drizzle client pointed at `DATABASE_TEST_URL` and ensures schema is up to date
- `reset()` truncates all tables using `TRUNCATE ... CASCADE` (handles FK ordering automatically)
- `teardown()` closes connections

### Harness Wiring Details

The harness constructs adapters and graphs explicitly — same wiring as production, different database:

```typescript
function createTestHarness() {
  let sql: postgres.Sql;
  let testDb: DrizzleClient;
  let embedderAdapter: EmbedderAdapter;
  let cacheAdapter: CacheAdapter;
  let queueAdapter: QueueAdapter;
  let compiledGraphs: Record<string, CompiledStateGraph>;

  return {
    get db() { return testDb; },
    get embedder() { return embedderAdapter; },
    get queue() { return queueAdapter; },
    get graphs() { return compiledGraphs; },

    async setup() {
      // 1. Create dedicated postgres connection to test DB
      const testUrl = process.env.DATABASE_TEST_URL
        ?? process.env.DATABASE_URL + "_test";
      sql = postgres(testUrl);
      testDb = drizzle(sql, { schema });

      // 2. Create adapters with test DB
      embedderAdapter = new EmbedderAdapter(testDb);
      cacheAdapter = new CacheAdapter();
      queueAdapter = new QueueAdapter();

      // 3. Construct graph factories with injected adapters
      const opportunityGraph = new OpportunityGraph(testDb, embedderAdapter);
      compiledGraphs = {
        opportunity: opportunityGraph.compile(),
        // ... other graphs as needed
      };
    },

    async reset() {
      // TRUNCATE CASCADE handles FK ordering
      await testDb.execute(
        sql`TRUNCATE TABLE users, intents, opportunities, intent_indexes, index_members CASCADE`
      );
    },

    async teardown() {
      await sql.end();
    }
  };
}
```

Graphs receive adapters via constructor injection (same as production). No module-level singletons are used — the harness creates its own instances.

### Assertion Functions

Standalone async functions, not custom `expect` matchers. This avoids bun `expect.extend()` compatibility issues and keeps the API explicit.

#### `assertMatchesSchema(value, zodSchema)`

Deterministic Zod validation on output shape.

```typescript
assertMatchesSchema(result, z.object({
  status: z.enum(["too_broad", "valid", "unclear"]),
  confidence: z.number().min(0).max(1),
  intents: z.array(z.object({ text: z.string(), type: z.string() }))
}));
```

On failure, throws with Zod error paths: `intents[2].type: expected string, received undefined`.

#### `assertLLMEvaluate(value, config)`

Semantic scoring via LLM judge. Each criterion gets a score (0.0–1.0).

```typescript
await assertLLMEvaluate(result.reasoning, {
  criteria: [
    { text: "identifies Alice's frontend need", required: true },
    { text: "identifies Bob's backend expertise", required: true, min: 0.8 },
    { text: "explains why the match is relevant" },
    { text: "suggests a collaboration angle", min: 0.3 }
  ],
  minScore: 0.7,
  context: "Alice needs a Vue frontend dev, Bob is a Laravel expert"
});
```

**Criterion fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `text` | `string` | — | What to check (required) |
| `required` | `boolean` | `false` | Must pass individually regardless of overall score |
| `min` | `number` | `0.5` | Passing threshold for this criterion |

**Config fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `criteria` | `Criterion[]` | — | List of criteria to evaluate (required) |
| `minScore` | `number` | `0.7` | Overall threshold (average of all criteria scores) |
| `context` | `string` | — | Describes the test scenario and expected conditions for the judge (optional) |
| `timeout` | `number` | `30000` | Timeout in ms for the judge LLM call |

**Failure output:**

```
✓ identifies Alice's frontend need (0.9) [required]
✗ identifies Bob's backend expertise (0.2) [required] ← FAILED
✓ explains why the match is relevant (0.8)
✗ suggests a collaboration angle (0.2) — below 0.3
Overall: 0.55 — below threshold 0.7
FAILED: 1 required criterion not met
```

**Returns** the full evaluation result for programmatic inspection:

```typescript
const evaluation = await assertLLMEvaluate(result.reasoning, config);
// evaluation.criteria[0].score === 0.9
// evaluation.criteria[0].passed === true
// evaluation.overallScore === 0.55
```

**Test fails when:**
- Any required criterion scores below its `min` threshold
- Overall average score is below `minScore`

**When `OPENROUTER_API_KEY` is not set:** the function throws a skip signal (`test.skip`) instead of failing, so tests that use the LLM judge are skipped in environments without API access.

### LLM Judge

A single function that scores all criteria in one LLM call.

**Model:** `google/gemini-2.5-flash` (configurable via `TEST_JUDGE_MODEL` env var)

**Prompt structure:**

```
You are a test judge. Score how well the given value satisfies each criterion.

Context describes the test scenario setup and expected conditions.
Value is the actual output being evaluated.

Context: {context}
Value: {value}

Criteria:
1. identifies Alice's frontend need
2. identifies Bob's backend expertise
3. explains why the match is relevant

For each criterion, return a score (0.0-1.0) and a one-sentence reasoning.
```

**Response schema:**

```typescript
z.object({
  scores: z.array(z.object({
    criterion: z.string(),    // echoes back the criterion text for reliable matching
    score: z.number().min(0).max(1),
    reasoning: z.string()
  }))
})
```

Criteria are matched back by `criterion` string echo rather than by array index, avoiding off-by-one issues with LLM responses.

**Key decisions:**
- Temperature 0 for consistency across runs
- Single LLM call per `assertLLMEvaluate` — all criteria scored together
- Value truncated to ~10000 chars if large (flash models handle large contexts cheaply; 4000 was too aggressive for rich test outputs)
- No retry on judge failure — test fails with "judge unavailable" error
- Structured output via Zod ensures predictable responses
- Per-evaluation timeout (default 30s) prevents a hanging judge call from blocking the suite

### Full Test Example

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { createTestHarness, assertMatchesSchema, assertLLMEvaluate } from "../../lib/test-harness";
import { alice, bob, aliceIntents, bobIntents } from "./fixtures/users";
import { opportunitySchema } from "./fixtures/schemas";

const harness = createTestHarness();
const { db, graphs } = harness;

beforeAll(async () => {
  await harness.setup();
});

afterAll(async () => {
  await harness.teardown();
});

afterEach(async () => {
  await harness.reset();
});

describe("opportunity graph", () => {
  it("should match complementary intents", async () => {
    // Seed
    await db.insert(users).values([alice, bob]);
    await db.insert(intents).values([...aliceIntents, ...bobIntents]);

    // Act
    const result = await graphs.opportunity.invoke({
      triggerIntentId: aliceIntents[0].id
    });

    // Deterministic assertions
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].actorId).toBe(bob.id);
    expect(result.opportunities[0].score).toBeGreaterThan(50);
    assertMatchesSchema(result.opportunities[0], opportunitySchema);

    // Semantic assertion
    await assertLLMEvaluate(result.opportunities[0].reasoning, {
      criteria: [
        { text: "identifies Alice's frontend need", required: true },
        { text: "identifies Bob's backend expertise", required: true },
        { text: "explains why the match is relevant" }
      ],
      minScore: 0.7,
      context: "Alice needs a Vue frontend dev, Bob is a Laravel expert"
    });
  }, 60_000);

  it("should return zero matches for unrelated intents", async () => {
    await db.insert(users).values([alice, chef]);
    await db.insert(intents).values([...aliceIntents, ...chefIntents]);

    const result = await graphs.opportunity.invoke({
      triggerIntentId: aliceIntents[0].id
    });

    expect(result.opportunities).toHaveLength(0);
  }, 60_000);
});
```

### File Structure

```
protocol/src/lib/test-harness/
├── index.ts                    # exports createTestHarness, assertMatchesSchema, assertLLMEvaluate
├── harness.ts                  # setup/teardown/reset, adapter wiring
├── assertions.ts               # assertMatchesSchema, assertLLMEvaluate
├── judge.ts                    # LLM judge function
└── judge.prompt.ts             # judge system prompt + response schema
```

### Migration from Smartest

- Delete `protocol/src/lib/smartest/` entirely
- Rewrite these test files as standard bun tests using the harness:
  - `protocol/src/lib/protocol/agents/tests/opportunity.evaluator.smartest.spec.ts`
  - `protocol/src/lib/protocol/graphs/tests/opportunity.graph.direct-connection.smartest.spec.ts`
- Remove smartest-related env vars (`SMARTEST_VERIFIER_MODEL`, `SMARTEST_GENERATOR_MODEL`)
- Add `TEST_JUDGE_MODEL` and `DATABASE_TEST_URL` env vars

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_TEST_URL` | No | `{DATABASE_URL}_test` | Test database connection |
| `TEST_JUDGE_MODEL` | No | `google/gemini-2.5-flash` | LLM model for semantic scoring |
| `OPENROUTER_API_KEY` | Yes (for LLM tests) | — | Required for LLM judge calls; tests skip if missing |
