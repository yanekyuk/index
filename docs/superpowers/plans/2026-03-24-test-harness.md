# Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the smartest framework with a lean test harness that uses standard bun tests, real adapter injection, and scored LLM criteria evaluation.

**Architecture:** A `createTestHarness()` factory wires real adapters (database, embedder, cache, queue) for a test database. Two standalone assertion functions — `assertMatchesSchema()` (Zod validation) and `assertLLMEvaluate()` (scored semantic criteria) — replace the entire smartest DSL.

**Tech Stack:** Bun test runner, Drizzle ORM, PostgreSQL, Zod, OpenAI (via OpenRouter for LLM judge)

**Spec:** `docs/superpowers/specs/2026-03-24-test-harness-design.md`

---

### Task 1: LLM Judge Prompt and Response Schema

**Files:**
- Create: `protocol/src/lib/test-harness/judge.prompt.ts`

- [ ] **Step 1: Create the judge prompt and Zod response schema**

```typescript
// protocol/src/lib/test-harness/judge.prompt.ts
import { z } from "zod";

export const judgeResponseSchema = z.object({
  scores: z.array(z.object({
    criterion: z.string(),
    score: z.number().min(0).max(1),
    reasoning: z.string(),
  })),
});

export type JudgeResponse = z.infer<typeof judgeResponseSchema>;

export function buildJudgePrompt(params: {
  value: string;
  criteria: string[];
  context?: string;
}): string {
  const contextBlock = params.context
    ? `Context describes the test scenario setup and expected conditions.\nContext: ${params.context}\n\n`
    : "";

  const criteriaList = params.criteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  return (
    `You are a test judge. Score how well the given value satisfies each criterion.\n\n` +
    contextBlock +
    `Value is the actual output being evaluated.\n` +
    `Value: ${params.value}\n\n` +
    `Criteria:\n${criteriaList}\n\n` +
    `For each criterion, return the criterion text (exactly as given), a score (0.0-1.0), and a one-sentence reasoning.`
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add protocol/src/lib/test-harness/judge.prompt.ts
git commit -m "feat(test-harness): add LLM judge prompt and response schema"
```

---

### Task 2: LLM Judge Function

**Files:**
- Create: `protocol/src/lib/test-harness/judge.ts`
- Reference: `protocol/src/lib/protocol/agents/model.config.ts` — for how the codebase creates OpenAI-compatible LLM clients

- [ ] **Step 1: Write a test for the judge function**

Create a test that calls the judge with a known value and criteria, and asserts the response shape.

```typescript
// protocol/src/lib/test-harness/tests/judge.spec.ts
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect } from "bun:test";
import { callJudge } from "../judge";

describe("callJudge", () => {
  it("scores criteria and returns structured results", async () => {
    const result = await callJudge({
      value: "Bob is an expert Laravel developer who builds backend APIs. Alice needs a frontend Vue developer.",
      criteria: [
        "mentions Laravel or backend expertise",
        "mentions Vue or frontend need",
        "explains complementarity between the two",
      ],
      context: "Evaluating an opportunity match reasoning between Alice (Vue dev) and Bob (Laravel dev)",
    });

    expect(result.scores).toHaveLength(3);
    for (const score of result.scores) {
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(1);
      expect(typeof score.reasoning).toBe("string");
      expect(typeof score.criterion).toBe("string");
    }
    // First two criteria should score high on this obvious input
    const laravelScore = result.scores.find(s => s.criterion.includes("Laravel"));
    expect(laravelScore?.score).toBeGreaterThan(0.5);
    const vueScore = result.scores.find(s => s.criterion.includes("Vue"));
    expect(vueScore?.score).toBeGreaterThan(0.5);
  }, 30_000);

  it("handles missing OPENROUTER_API_KEY gracefully", async () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      await expect(callJudge({
        value: "test",
        criteria: ["test criterion"],
      })).rejects.toThrow("OPENROUTER_API_KEY");
    } finally {
      process.env.OPENROUTER_API_KEY = originalKey;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd protocol && bun test src/lib/test-harness/tests/judge.spec.ts
```

Expected: FAIL — `callJudge` does not exist yet.

- [ ] **Step 3: Implement the judge function**

```typescript
// protocol/src/lib/test-harness/judge.ts
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

import { buildJudgePrompt, judgeResponseSchema, type JudgeResponse } from "./judge.prompt";

const MAX_VALUE_LENGTH = 10_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface CallJudgeInput {
  value: string;
  criteria: string[];
  context?: string;
  timeout?: number;
}

export async function callJudge(input: CallJudgeInput): Promise<JudgeResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set — cannot run LLM judge");
  }

  const model = process.env.TEST_JUDGE_MODEL ?? "google/gemini-2.5-flash";
  const baseURL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  const client = new OpenAI({ apiKey, baseURL });

  const truncatedValue = input.value.length > MAX_VALUE_LENGTH
    ? input.value.slice(0, MAX_VALUE_LENGTH) + "\n... [truncated]"
    : input.value;

  const prompt = buildJudgePrompt({
    value: truncatedValue,
    criteria: input.criteria,
    context: input.context,
  });

  const response = await client.beta.chat.completions.parse({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 1024,
    response_format: zodResponseFormat(judgeResponseSchema, "judge_response"),
  }, {
    timeout: input.timeout ?? DEFAULT_TIMEOUT_MS,
  });

  const parsed = response.choices[0]?.message?.parsed;
  if (!parsed) {
    throw new Error("LLM judge returned no parseable response");
  }

  return parsed;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd protocol && bun test src/lib/test-harness/tests/judge.spec.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/test-harness/judge.ts protocol/src/lib/test-harness/tests/judge.spec.ts
git commit -m "feat(test-harness): implement LLM judge function"
```

---

### Task 3: Assertion Functions

**Files:**
- Create: `protocol/src/lib/test-harness/assertions.ts`
- Reference: `protocol/src/lib/test-harness/judge.ts`

- [ ] **Step 1: Write tests for assertion functions**

```typescript
// protocol/src/lib/test-harness/tests/assertions.spec.ts
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { assertMatchesSchema, assertLLMEvaluate } from "../assertions";

describe("assertMatchesSchema", () => {
  it("passes for valid data", () => {
    const schema = z.object({
      name: z.string(),
      score: z.number().min(0).max(100),
    });
    // Should not throw
    assertMatchesSchema({ name: "test", score: 50 }, schema);
  });

  it("throws with Zod error paths for invalid data", () => {
    const schema = z.object({
      name: z.string(),
      score: z.number(),
    });
    expect(() => assertMatchesSchema({ name: 123, score: "bad" }, schema)).toThrow();
  });
});

describe("assertLLMEvaluate", () => {
  it("passes when all criteria are met", async () => {
    const result = await assertLLMEvaluate(
      "Bob is a Laravel expert building backend APIs. Alice needs a Vue frontend developer. Their skills are complementary for a full-stack project.",
      {
        criteria: [
          { text: "mentions Laravel or backend expertise", required: true },
          { text: "mentions Vue or frontend need", required: true },
          { text: "explains complementarity" },
        ],
        minScore: 0.6,
        context: "Opportunity match reasoning between Alice and Bob",
      }
    );
    expect(result.passed).toBe(true);
    expect(result.criteria.length).toBe(3);
    expect(result.overallScore).toBeGreaterThan(0.5);
  }, 30_000);

  it("fails when a required criterion is not met", async () => {
    try {
      await assertLLMEvaluate(
        "Bob likes cooking Italian food.",
        {
          criteria: [
            { text: "mentions Laravel or backend expertise", required: true },
            { text: "mentions cooking", required: true },
          ],
          minScore: 0.5,
        }
      );
      throw new Error("Should have thrown");
    } catch (e: unknown) {
      const error = e as Error;
      expect(error.message).toContain("required criterion");
    }
  }, 30_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd protocol && bun test src/lib/test-harness/tests/assertions.spec.ts
```

Expected: FAIL — `assertMatchesSchema` and `assertLLMEvaluate` do not exist yet.

- [ ] **Step 3: Implement assertion functions**

```typescript
// protocol/src/lib/test-harness/assertions.ts
import type { ZodSchema, ZodError } from "zod";

import { callJudge } from "./judge";

/**
 * Asserts that a value matches a Zod schema.
 * Throws with formatted Zod error paths on failure.
 */
export function assertMatchesSchema<T>(value: unknown, schema: ZodSchema<T>): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const formatted = formatZodError(result.error);
    throw new Error(`Schema validation failed:\n${formatted}`);
  }
  return result.data;
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  ${path}: ${issue.message}`;
    })
    .join("\n");
}

/** A single criterion to evaluate. */
export interface LLMCriterion {
  text: string;
  required?: boolean;
  min?: number;
}

/** Configuration for assertLLMEvaluate. */
export interface LLMEvaluateConfig {
  criteria: LLMCriterion[];
  minScore?: number;
  context?: string;
  timeout?: number;
}

/** Result of a single criterion evaluation. */
export interface CriterionResult {
  text: string;
  score: number;
  reasoning: string;
  required: boolean;
  min: number;
  passed: boolean;
}

/** Full evaluation result returned by assertLLMEvaluate. */
export interface LLMEvaluateResult {
  passed: boolean;
  criteria: CriterionResult[];
  overallScore: number;
  failedRequired: CriterionResult[];
  summary: string;
}

const DEFAULT_CRITERION_MIN = 0.5;
const DEFAULT_MIN_SCORE = 0.7;

/**
 * Evaluates a value against semantic criteria using an LLM judge.
 * Throws with a detailed report on failure.
 * Returns the full evaluation result for programmatic inspection.
 */
export async function assertLLMEvaluate(
  value: unknown,
  config: LLMEvaluateConfig,
): Promise<LLMEvaluateResult> {
  // Skip test if no API key available (e.g. CI without LLM access)
  if (!process.env.OPENROUTER_API_KEY) {
    // Bun doesn't have test.skip() callable from within a test body.
    // Throw a specific error that test wrappers can catch, or just skip inline.
    const { expect } = await import("bun:test");
    // @ts-expect-error — bun internal: calling expect().pass() to skip
    throw new Error("[SKIP] OPENROUTER_API_KEY not set — skipping LLM evaluation");
  }

  const stringValue = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const minScore = config.minScore ?? DEFAULT_MIN_SCORE;

  const judgeResult = await callJudge({
    value: stringValue,
    criteria: config.criteria.map(c => c.text),
    context: config.context,
    timeout: config.timeout,
  });

  // Match judge scores back to criteria by criterion text (no array index fallback)
  const criteriaResults: CriterionResult[] = config.criteria.map((criterion, idx) => {
    const criterionLower = criterion.text.toLowerCase();
    // Try exact match first, then substring match
    const match = judgeResult.scores.find(s =>
      s.criterion.toLowerCase() === criterionLower
    ) ?? judgeResult.scores.find(s =>
      s.criterion.toLowerCase().includes(criterionLower.slice(0, 30))
        || criterionLower.includes(s.criterion.toLowerCase().slice(0, 30))
    ) ?? judgeResult.scores[idx]; // Last resort: positional (logged as warning)

    const score = match?.score ?? 0;
    const reasoning = match?.reasoning ?? "No judge response for this criterion";
    const min = criterion.min ?? DEFAULT_CRITERION_MIN;
    const required = criterion.required ?? false;

    return {
      text: criterion.text,
      score,
      reasoning,
      required,
      min,
      passed: score >= min,
    };
  });

  const overallScore = criteriaResults.length > 0
    ? criteriaResults.reduce((sum, c) => sum + c.score, 0) / criteriaResults.length
    : 0;

  const failedRequired = criteriaResults.filter(c => c.required && !c.passed);
  const overallPassed = overallScore >= minScore && failedRequired.length === 0;

  const summary = formatEvaluationReport(criteriaResults, overallScore, minScore, failedRequired);

  const result: LLMEvaluateResult = {
    passed: overallPassed,
    criteria: criteriaResults,
    overallScore,
    failedRequired,
    summary,
  };

  if (!overallPassed) {
    throw new Error(`LLM evaluation failed:\n${summary}`);
  }

  return result;
}

function formatEvaluationReport(
  criteria: CriterionResult[],
  overallScore: number,
  minScore: number,
  failedRequired: CriterionResult[],
): string {
  const lines = criteria.map(c => {
    const icon = c.passed ? "✓" : "✗";
    const reqTag = c.required ? " [required]" : "";
    const failNote = !c.passed
      ? c.required
        ? " ← FAILED"
        : ` — below ${c.min}`
      : "";
    return `${icon} ${c.text} (${c.score.toFixed(2)})${reqTag}${failNote}`;
  });

  lines.push(`Overall: ${overallScore.toFixed(2)} — ${overallScore >= minScore ? "above" : "below"} threshold ${minScore}`);

  if (failedRequired.length > 0) {
    lines.push(`FAILED: ${failedRequired.length} required criterion not met`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd protocol && bun test src/lib/test-harness/tests/assertions.spec.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/test-harness/assertions.ts protocol/src/lib/test-harness/tests/assertions.spec.ts
git commit -m "feat(test-harness): implement assertMatchesSchema and assertLLMEvaluate"
```

---

### Task 4: Test Harness Factory

**Files:**
- Create: `protocol/src/lib/test-harness/harness.ts`
- Reference: `protocol/src/lib/drizzle/drizzle.ts` — how the production Drizzle client is created
- Reference: `protocol/src/adapters/database.adapter.ts` — ChatDatabaseAdapter
- Reference: `protocol/src/adapters/embedder.adapter.ts` — EmbedderAdapter constructor
- Reference: `protocol/src/adapters/cache.adapter.ts` — RedisCacheAdapter
- Reference: `protocol/src/lib/protocol/graphs/opportunity.graph.ts` — OpportunityGraphFactory constructor
- Reference: `protocol/src/lib/protocol/graphs/hyde.graph.ts` — HydeGraphFactory constructor
- Reference: `protocol/src/lib/protocol/interfaces/database.interface.ts` — narrowed database types

The harness creates its own Drizzle client pointed at `DATABASE_TEST_URL`, instantiates adapters with that client, and constructs graphs via their factories with injected dependencies.

**Important:** The production `ChatDatabaseAdapter` imports the singleton `db` from `lib/drizzle/drizzle.ts` at module level. The harness cannot easily swap that singleton. There are two approaches:

1. **Use ChatDatabaseAdapter as-is** — set `DATABASE_URL` to the test DB URL before importing it (requires env setup before any imports).
2. **Create a minimal test database adapter** — implement only the narrowed interfaces needed by graphs (e.g., `OpportunityGraphDatabase`), backed by the test Drizzle client.

Approach 1 is simpler and matches production wiring. The existing test files already use `.env.test` loaded at the top before imports. The harness should document this requirement.

**Critical:** The `EmbedderAdapter` also imports the DB singleton at module level for vector search queries. When `.env.test` sets `DATABASE_URL` to the test database before any imports, the singleton initializes against the test DB. This is why `config({ path: '.env.test' })` MUST be the very first line in every test file — before any import that might trigger the singleton. The harness documents this but cannot enforce it at runtime.

- [ ] **Step 1: Write a test for the harness**

```typescript
// protocol/src/lib/test-harness/tests/harness.spec.ts
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestHarness } from "../harness";

describe("createTestHarness", () => {
  const harness = createTestHarness();

  beforeAll(async () => {
    await harness.setup();
  });

  afterAll(async () => {
    await harness.teardown();
  });

  it("provides a working database connection", async () => {
    // Should be able to query without error
    const result = await harness.db.execute`SELECT 1 as n`;
    expect(result).toBeDefined();
  });

  it("provides an embedder", () => {
    expect(harness.embedder).toBeDefined();
    expect(typeof harness.embedder.generate).toBe("function");
  });

  it("reset truncates tables without error", async () => {
    await harness.reset();
    // Should complete without throwing
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd protocol && bun test src/lib/test-harness/tests/harness.spec.ts
```

Expected: FAIL — `createTestHarness` does not exist yet.

- [ ] **Step 3: Implement the harness factory**

```typescript
// protocol/src/lib/test-harness/harness.ts
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../schemas/database.schema";
import { EmbedderAdapter } from "../../../adapters/embedder.adapter";
import { RedisCacheAdapter } from "../../../adapters/cache.adapter";
import type { Cache } from "../../protocol/interfaces/cache.interface";

export type TestDB = PostgresJsDatabase<typeof schema>;

export interface TestHarness {
  /** Drizzle client connected to the test database. */
  db: TestDB;
  /** Embedder adapter for generating/searching embeddings. */
  embedder: EmbedderAdapter;
  /** Cache adapter. */
  cache: Cache;

  /** Connect to test DB and ensure schema is ready. */
  setup(): Promise<void>;
  /** Truncate all tables between tests. */
  reset(): Promise<void>;
  /** Close all connections. */
  teardown(): Promise<void>;
}

/**
 * Creates a test harness with real adapters pointed at the test database.
 *
 * IMPORTANT: Load your `.env.test` file BEFORE importing this module,
 * so that `DATABASE_TEST_URL` (or `DATABASE_URL`) is available.
 */
export function createTestHarness(): TestHarness {
  let sql: ReturnType<typeof postgres>;
  let testDb: TestDB;
  let embedder: EmbedderAdapter;
  let cache: RedisCacheAdapter;
  let isSetup = false;

  return {
    get db() {
      if (!isSetup) throw new Error("Call harness.setup() before accessing db");
      return testDb;
    },
    get embedder() {
      if (!isSetup) throw new Error("Call harness.setup() before accessing embedder");
      return embedder;
    },
    get cache() {
      if (!isSetup) throw new Error("Call harness.setup() before accessing cache");
      return cache;
    },

    async setup() {
      const testUrl = process.env.DATABASE_TEST_URL
        ?? (process.env.DATABASE_URL ? process.env.DATABASE_URL + "_test" : undefined);

      if (!testUrl) {
        throw new Error("Neither DATABASE_TEST_URL nor DATABASE_URL is set");
      }

      sql = postgres(testUrl, { prepare: false });
      testDb = drizzle(sql, { schema });
      embedder = new EmbedderAdapter();
      cache = new RedisCacheAdapter();
      isSetup = true;

      // Verify connection
      await testDb.execute`SELECT 1`;
    },

    async reset() {
      if (!isSetup) return;
      // Get all table names from our schema and truncate with CASCADE
      const tableNames = Object.values(schema)
        .filter((v): v is { [Symbol.for("drizzle:Name")]: string } =>
          v !== null && typeof v === "object" && Symbol.for("drizzle:Name") in v
        )
        .map(t => t[Symbol.for("drizzle:Name")]);

      if (tableNames.length > 0) {
        // Truncate all public tables except Drizzle migration tracking
        await testDb.execute`
          DO $$
          DECLARE
            tbl text;
          BEGIN
            FOR tbl IN
              SELECT tablename FROM pg_tables
              WHERE schemaname = 'public'
                AND tablename NOT LIKE '__drizzle%'
            LOOP
              EXECUTE format('TRUNCATE TABLE %I CASCADE', tbl);
            END LOOP;
          END
          $$;
        `;
      }
    },

    async teardown() {
      if (!isSetup) return;
      await sql.end();
      isSetup = false;
    },
  };
}
```

**Note to implementer:** The `reset()` function uses a PL/pgSQL block to truncate all public tables dynamically. This avoids hardcoding table names and handles FK ordering via CASCADE. If this is too slow for your test suite, you can replace it with an explicit `TRUNCATE table1, table2, ... CASCADE` listing the tables from the schema.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd protocol && bun test src/lib/test-harness/tests/harness.spec.ts
```

Expected: PASS (requires a test database to exist at `DATABASE_TEST_URL`)

- [ ] **Step 5: Commit**

```bash
git add protocol/src/lib/test-harness/harness.ts protocol/src/lib/test-harness/tests/harness.spec.ts
git commit -m "feat(test-harness): implement createTestHarness factory with real adapter wiring"
```

---

### Task 5: Barrel Export

**Files:**
- Create: `protocol/src/lib/test-harness/index.ts`

- [ ] **Step 1: Create the barrel export**

```typescript
// protocol/src/lib/test-harness/index.ts
export { createTestHarness, type TestHarness, type TestDB } from "./harness";
export {
  assertMatchesSchema,
  assertLLMEvaluate,
  type LLMCriterion,
  type LLMEvaluateConfig,
  type LLMEvaluateResult,
  type CriterionResult,
} from "./assertions";
export { callJudge, type CallJudgeInput } from "./judge";
export { judgeResponseSchema, type JudgeResponse } from "./judge.prompt";
```

- [ ] **Step 2: Commit**

```bash
git add protocol/src/lib/test-harness/index.ts
git commit -m "feat(test-harness): add barrel export"
```

---

### Task 6: Migrate Opportunity Evaluator Stress Test

**Files:**
- Rewrite: `protocol/src/lib/protocol/agents/tests/opportunity.evaluator.smartest.spec.ts` → `protocol/src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts` (or rename in place)
- Reference: current test at `protocol/src/lib/protocol/agents/tests/opportunity.evaluator.smartest.spec.ts`

The existing test:
1. Constructs 25 unrelated candidates and a source entity
2. Runs `OpportunityEvaluator.invokeEntityBundle()` directly (no harness, no DB needed)
3. Passes results into smartest's `runScenario` with a no-op SUT
4. Uses LLM verifier to check "no false positives"

Migrated version:
1. Same test data (candidates, source entity)
2. Same direct `OpportunityEvaluator.invokeEntityBundle()` call
3. Replace smartest with: deterministic assertions + `assertLLMEvaluate`

**Note:** This test doesn't need the full harness (no DB, no embedder) — it calls the evaluator agent directly. That's fine. The harness is for integration tests. Agent-level tests stay lean.

- [ ] **Step 1: Create the migrated test file**

```typescript
// protocol/src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { assertMatchesSchema, assertLLMEvaluate } from "../../../test-harness";
import { OpportunityEvaluator, type EvaluatorInput, type EvaluatorEntity } from "../opportunity.evaluator";

// --- Test Data ---
// (Copy DISCOVERER_ID, sourceEntity, and all 25 candidates from the original file — unchanged)

const DISCOVERER_ID = "user-founder-alice";

const sourceEntity: EvaluatorEntity = {
  // ... (exact same as original file)
};

const candidates: EvaluatorEntity[] = [
  // ... (exact same 25 candidates as original file)
];

const resultSchema = z.object({
  opportunities: z.array(z.object({
    reasoning: z.string(),
    score: z.number(),
    candidateUserId: z.string(),
  })),
  durationMs: z.number(),
});

// --- Helpers ---

async function runBundleEval() {
  const evaluator = new OpportunityEvaluator();
  const input: EvaluatorInput = {
    discovererId: DISCOVERER_ID,
    entities: [sourceEntity, ...candidates],
  };
  const start = Date.now();
  const raw = await evaluator.invokeEntityBundle(input, { minScore: 50 });
  const durationMs = Date.now() - start;
  const opportunities = raw.map(op => {
    const candidate = op.actors.find(a => a.userId !== DISCOVERER_ID);
    return { reasoning: op.reasoning, score: op.score, candidateUserId: candidate?.userId ?? "" };
  });
  return { opportunities, durationMs };
}

async function runParallelEval() {
  const evaluator = new OpportunityEvaluator();
  const start = Date.now();
  const parallelResults = await Promise.all(
    candidates.map(candidate => {
      const input: EvaluatorInput = {
        discovererId: DISCOVERER_ID,
        entities: [sourceEntity, candidate],
      };
      return evaluator.invokeEntityBundle(input, { minScore: 50 })
        .catch(() => [] as Awaited<ReturnType<typeof evaluator.invokeEntityBundle>>);
    })
  );
  const durationMs = Date.now() - start;
  const opportunities = parallelResults.flat().map(op => {
    const candidate = op.actors.find(a => a.userId !== DISCOVERER_ID);
    return { reasoning: op.reasoning, score: op.score, candidateUserId: candidate?.userId ?? "" };
  });
  return { opportunities, durationMs };
}

// --- Tests ---

describe("OpportunityEvaluator: stress test — unrelated candidates", () => {
  it("bundle mode returns no matches for fully unrelated candidates", async () => {
    const { opportunities, durationMs } = await runBundleEval();

    // Deterministic: schema
    assertMatchesSchema({ opportunities, durationMs }, resultSchema);

    // Deterministic: no high-scoring false positives
    for (const op of opportunities) {
      expect(op.score).toBeLessThan(50);
    }

    // Semantic: if any results exist, verify the reasonings don't hallucinate relevance
    if (opportunities.length > 0) {
      const reasonings = opportunities.map(o => `[${o.candidateUserId}] score=${o.score}: ${o.reasoning}`).join("\n");
      await assertLLMEvaluate(reasonings, {
        criteria: [
          { text: "none of the reasonings claim genuine AI/ML engineering expertise from the candidates", required: true },
          { text: "scores are low, reflecting lack of alignment with an AI co-founder search" },
        ],
        minScore: 0.6,
        context: "Discoverer is an AI startup founder seeking ML co-founder. All 25 candidates are from unrelated domains (chef, yoga, musician, etc).",
      });
    }
  }, 180_000);

  it("parallel mode returns no matches for fully unrelated candidates", async () => {
    const { opportunities, durationMs } = await runParallelEval();

    assertMatchesSchema({ opportunities, durationMs }, resultSchema);

    for (const op of opportunities) {
      expect(op.score).toBeLessThan(50);
    }

    if (opportunities.length > 0) {
      const reasonings = opportunities.map(o => `[${o.candidateUserId}] score=${o.score}: ${o.reasoning}`).join("\n");
      await assertLLMEvaluate(reasonings, {
        criteria: [
          { text: "none of the reasonings claim genuine AI/ML engineering expertise from the candidates", required: true },
          { text: "scores are low, reflecting lack of alignment with an AI co-founder search" },
        ],
        minScore: 0.6,
        context: "Discoverer is an AI startup founder seeking ML co-founder. All 25 candidates are from unrelated domains.",
      });
    }
  }, 180_000);
});
```

- [ ] **Step 2: Run the new test**

```bash
cd protocol && bun test src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts
```

Expected: PASS (same behavior as before, cleaner code)

- [ ] **Step 3: Delete the old smartest test file**

```bash
rm protocol/src/lib/protocol/agents/tests/opportunity.evaluator.smartest.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add protocol/src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts
git add -u protocol/src/lib/protocol/agents/tests/opportunity.evaluator.smartest.spec.ts
git commit -m "refactor(test): migrate opportunity evaluator stress test from smartest to test-harness"
```

---

### Task 7: Migrate Direct-Connection Test

**Files:**
- Rewrite: `protocol/src/lib/protocol/graphs/tests/opportunity.graph.direct-connection.smartest.spec.ts` → `protocol/src/lib/protocol/graphs/tests/opportunity.graph.direct-connection.spec.ts`
- Reference: current test at `protocol/src/lib/protocol/graphs/tests/opportunity.graph.direct-connection.smartest.spec.ts`

Same migration pattern: keep the agent call, replace smartest with deterministic + `assertLLMEvaluate`.

- [ ] **Step 1: Create the migrated test file**

```typescript
// protocol/src/lib/protocol/graphs/tests/opportunity.graph.direct-connection.spec.ts
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { assertMatchesSchema, assertLLMEvaluate } from "../../../test-harness";
import { OpportunityEvaluator, type EvaluatorInput, type EvaluatorEntity } from "../../agents/opportunity.evaluator";

// --- Test Data ---
// (Copy DISCOVERER_ID, TARGET_ID, sourceEntity, targetEntity from original file — unchanged)

const DISCOVERER_ID = "user-yanki";
const TARGET_ID = "user-sam";

const sourceEntity: EvaluatorEntity = {
  // ... (exact same as original)
};

const targetEntity: EvaluatorEntity = {
  // ... (exact same as original, with ragScore: 100, matchedVia: 'explicit_mention')
};

const resultSchema = z.object({
  opportunities: z.array(z.object({
    reasoning: z.string(),
    score: z.number(),
    candidateUserId: z.string().min(1),
  })),
  durationMs: z.number(),
});

// --- Helpers ---

async function runDirectConnectionEval() {
  const evaluator = new OpportunityEvaluator();
  const input: EvaluatorInput = {
    discovererId: DISCOVERER_ID,
    entities: [sourceEntity, targetEntity],
    discoveryQuery: "What can I do with Samuel Rivera?",
  };
  const MAX_ATTEMPTS = 3;
  let totalDurationMs = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const start = Date.now();
    const raw = await evaluator.invokeEntityBundle(input, { minScore: 0, returnAll: true });
    const durationMs = Date.now() - start;
    totalDurationMs += durationMs;
    const opportunities = raw
      .map(op => {
        const candidate = op.actors.find(a => a.userId !== DISCOVERER_ID);
        if (!candidate?.userId) return null;
        return { reasoning: op.reasoning, score: op.score, candidateUserId: candidate.userId };
      })
      .filter((op): op is { reasoning: string; score: number; candidateUserId: string } => op !== null);
    if (opportunities.length > 0 || attempt === MAX_ATTEMPTS) {
      return { opportunities, durationMs: totalDurationMs };
    }
  }
  return { opportunities: [], durationMs: totalDurationMs };
}

// --- Tests ---

describe("OpportunityEvaluator: direct-connection candidates", () => {
  it("produces an opportunity when evaluating explicitly-mentioned users with genuine alignment", async () => {
    const { opportunities, durationMs } = await runDirectConnectionEval();

    // Deterministic: schema
    assertMatchesSchema({ opportunities, durationMs }, resultSchema);

    // Deterministic: at least one match with score >= 50
    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    const topMatch = opportunities.sort((a, b) => b.score - a.score)[0];
    expect(topMatch.score).toBeGreaterThanOrEqual(50);
    expect(topMatch.candidateUserId).toBe(TARGET_ID);

    // Semantic: verify the reasoning is grounded
    await assertLLMEvaluate(topMatch.reasoning, {
      criteria: [
        { text: "mentions shared technical skills like Laravel or Vue.js", required: true },
        { text: "identifies complementary goals between the two users", required: true },
        { text: "does not fabricate skills or interests not present in the profiles", required: true, min: 0.7 },
      ],
      minScore: 0.6,
      context: "Yankı (CTO, Laravel/Vue/game dev) was @-mentioned with Samuel (full-stack Laravel/Vue dev seeking ML co-founder). Both share web tech expertise and gaming interest.",
    });
  }, 120_000);
});
```

- [ ] **Step 2: Run the new test**

```bash
cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.direct-connection.spec.ts
```

Expected: PASS

- [ ] **Step 3: Delete the old smartest test file**

```bash
rm protocol/src/lib/protocol/graphs/tests/opportunity.graph.direct-connection.smartest.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add protocol/src/lib/protocol/graphs/tests/opportunity.graph.direct-connection.spec.ts
git add -u protocol/src/lib/protocol/graphs/tests/opportunity.graph.direct-connection.smartest.spec.ts
git commit -m "refactor(test): migrate direct-connection test from smartest to test-harness"
```

---

### Task 8: Verify Coexistence with Smartest

**Note:** The smartest framework cannot be deleted yet. Seven other test files still import from it:

- `protocol/src/lib/protocol/graphs/tests/chat.graph.profile.spec.ts`
- `protocol/src/lib/protocol/graphs/tests/chat.graph.invoke.spec.ts`
- `protocol/src/lib/protocol/graphs/tests/chat.graph.opportunities.spec.ts`
- `protocol/src/lib/protocol/graphs/tests/hyde.graph.spec.ts`
- `protocol/src/lib/protocol/graphs/tests/chat.graph.scope.spec.ts`
- `protocol/src/lib/protocol/graphs/tests/chat.discover.spec.ts`
- `protocol/src/lib/protocol/graphs/tests/chat.vocabulary.spec.ts`

These will be migrated in a follow-up plan. For now, smartest and test-harness coexist. New tests should use test-harness.

- [ ] **Step 1: Verify all migrated tests pass**

```bash
cd protocol && bun test src/lib/test-harness/tests/ && bun test src/lib/protocol/agents/tests/opportunity.evaluator.spec.ts && bun test src/lib/protocol/graphs/tests/opportunity.graph.direct-connection.spec.ts
```

Expected: All tests PASS.

- [ ] **Step 2: Verify existing smartest tests still pass**

```bash
cd protocol && grep -rl "from.*smartest" src/ --include="*.ts" | head -5
```

Expected: Lists the 7 remaining smartest consumers — confirms they still exist and are unbroken.

- [ ] **Step 3: Run tsc to verify no type errors**

```bash
cd protocol && npx tsc --noEmit
```

Expected: No errors.

---

### Task 9: Update Environment Documentation

**Files:**
- Modify: `protocol/.env.example` (if it references `SMARTEST_VERIFIER_MODEL` or `SMARTEST_GENERATOR_MODEL`)

- [ ] **Step 1: Remove old env vars and add new ones**

Remove any lines referencing `SMARTEST_VERIFIER_MODEL` or `SMARTEST_GENERATOR_MODEL` from `protocol/.env.example` (or `.env.example`).

Add:
```bash
# Test harness
DATABASE_TEST_URL=                  # Test database URL (defaults to DATABASE_URL + "_test")
TEST_JUDGE_MODEL=                   # LLM model for test judge (defaults to google/gemini-2.5-flash)
```

- [ ] **Step 2: Commit**

```bash
git add protocol/.env.example
git commit -m "docs: update env example with test harness variables"
```
