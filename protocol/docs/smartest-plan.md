# Smartest Plan: Spec-Driven, LLM-Verified Testing for Agents and Graphs

> **Status**: DRAFT — Planning  
> **Date**: 2026-02-03  
> **Scope**: `protocol/src/lib/smartest` + spec files in `lib/protocol`

## 1. Problem Statement

Current tests for agents and graphs in `lib/protocol` are insufficient for validating model behavior:

| Current approach | Limitation |
|------------------|------------|
| **Input/output shape tests** | Assert only structure (e.g. `result.text.length > 0`, `result.intents.length > 0`). They don't verify that the *meaning* of the output is correct. |
| **String containment** | e.g. `expect(action.payload).toContain("React")` — brittle and shallow; doesn't catch semantic drift or prompt regressions. |
| **Heavy mocking** | e.g. `opportunity.graph.spec.ts` mocks the evaluator agent entirely. Flow is tested, but real model behavior is not. |
| **No semantic criteria** | We never ask: "Given this input, is this output *correct* for this agent's purpose?" |

For LLM-based agents and graphs, **correctness is semantic**. We need a way to:

1. **Describe test scenarios** in one place (inputs, how to generate fixtures, and what "correct" means).
2. **Generate data from the spec at test time** so tests are reproducible and self-contained, with no persisted fixture files.
3. **Run the system under test** (agent or graph) with that generated data.
4. **Verify results** using an LLM judge that checks whether the output satisfies the scenario's criteria.

---

## 2. Goals and Non-Goals

### Goals

- **Spec-driven**: A spec file describes the test (how to generate data, SUT, verification criteria). The same spec can be improved over time without rewriting the harness.
- **Generated-at-runtime data**: Specs declare fixtures via inline data or generator descriptions (e.g. "use ProfileGenerator with seed 42"). Data is generated when the test runs, used for the scenario, and **never persisted** — no project-wide `smartest:generate` script, no committed fixture files.
- **Single harness**: `lib/smartest` provides the runner and LLM verifier so each agent/graph spec stays thin and declarative.
- **LLM verification**: A verifier agent receives (input, output, criteria) and returns pass/fail + short reasoning, so we can catch semantic regressions and model drift.
- **Composable with bun test**: Smartest runs inside normal `bun test`; data generation, run, and verify all happen on the go. One `describe` or `it` can run a smartest scenario.

### Non-Goals (for now)

- Replacing all existing unit tests (e.g. static helpers, strategy config) — those stay as-is.
- End-to-end API or DB tests — smartest focuses on agent/graph behavior with controlled inputs.
- Deterministic, non-LLM verification only — the value is LLM-as-judge for semantic checks; we can still support schema/rule-based checks alongside.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Spec file (e.g. explicit.inferrer.smartest.spec.ts)                            │
│  • Scenario name, description                                                │
│  • Fixtures: inline data or generator descriptions (e.g. generator + seed)   │
│  • SUT: agent or graph + invoke payload                                     │
│  • Verification: criteria text + optional schema assertions                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  lib/smartest                                                              │
│  • runScenario() — generate fixtures from spec, run SUT, verify              │
│  • Fixture resolution — generate from spec at test time (in-memory only)    │
│  • Verifier — run schema checks + optional LLM judge                         │
│  • No persistence — all generated data is discarded after the test          │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
┌──────────────────────────────┐         ┌──────────────────────────────┐
│  Schema / rule assertions    │         │  LLM Verifier Agent          │
│  (Zod, shape, containment)   │         │  Input: scenario + I/O +      │
│  Fast, deterministic         │         │  criteria → pass/fail +       │
│                              │         │  reasoning                    │
└──────────────────────────────┘         └──────────────────────────────┘
```

---

## 4. Spec File Format (Design)

A smartest spec is a **data structure** (TypeScript/JSON) that can live next to existing `.spec.ts` files or in a dedicated `.smartest.spec.ts` file.

### 4.1 Scenario Structure

```ts
// Conceptual shape — to be refined in implementation
interface SmartestScenario {
  name: string;
  description: string;           // Human-readable; can be used in LLM prompt
  fixtures?: Record<string, FixtureDef>;  // Inline values or generator (e.g. { generate: 'profile', seed: 42 })
  sut: {
    type: 'agent' | 'graph';
    factory: () => Agent | CompiledGraph;  // Or a registry key
    invoke: (state: unknown) => Promise<unknown>;
    input: unknown;              // May reference fixtures, e.g. { profile: '@fixtures.profile' }
  };
  verification: {
    schema?: ZodSchema;          // Optional: validate output shape
    criteria: string;            // Natural language: "The intent should be a goal about deploying to Ethereum"
    llmVerify?: boolean;        // Default true for agent/graph tests
  };
}
```

### 4.2 Fixtures (generated at test time, never persisted)

- **Inline**: Spec defines `fixtures: { profile: "User is an experienced engineer..." }` or `{ profile: { identity: { name: "Alice", ... } } }`. The runner uses these as-is in memory.
- **Generator**: Spec describes how to generate data, e.g. `{ profile: { generate: 'profile', params: { seed: 42 } } }` or a function `() => profileGenerator.generate(seed)`. The runner invokes the generator when the scenario runs and passes the result into the SUT. Output is kept only for the duration of the test, then discarded.
- **No files, no script**: There is no `bun run smartest:generate` and no committed fixture files. All data is produced during normal `bun test` and does not persist after the test.

### 4.3 Verification

- **Schema**: If `verification.schema` is provided, run Zod (or equivalent) first; fail fast if output doesn't match.
- **Criteria**: A string that the LLM judge sees: "Given the input and the output, determine: {criteria}".
- **LLM Verifier**: A small agent that takes `(scenarioDescription, input, output, criteria)` and returns `{ pass: boolean, reasoning: string }`. Only run if schema passes (or is absent).

---

## 5. Data Lifecycle (generate on the go, no persistence)

| Step | Description |
|------|-------------|
| **Describe** | Spec file describes what data is needed: inline values and/or generator (e.g. "profile with seed 42", "intent text: deploy Solidity contract"). |
| **Generate** | When the test runs, the runner generates fixtures from the spec: inline data is used as-is; generator entries are run (e.g. call ProfileGenerator with seed). All in memory. |
| **Resolve** | Fixture refs in `sut.input` (e.g. `@fixtures.profile`) are resolved to the generated values. |
| **Run** | SUT is invoked with the resolved input. |
| **Verify** | Output is checked by schema + LLM judge. |
| **Discard** | Generated data and test output are not written to disk. No fixture files, no project-wide generate script. |

**V1**: Inline fixtures only; generator support can be a function in the spec (e.g. `fixtures: { profile: async () => generateProfile(42) }`).  
**V2**: Declarative generator descriptions in the spec (e.g. `{ generate: 'profile', seed: 42 }`) with a small registry of named generators.  
**V3**: Richer verification (rubric, caching) and more generator types as needed.

---

## 6. LLM Verifier Design

- **Single responsibility**: Given (scenario description, input, output, criteria), return pass/fail and reasoning.
- **Structured output**: Use a small Zod schema, e.g. `{ pass: boolean, reasoning: string }`, to avoid free-form parsing.
- **Model**: Use same OpenRouter presets pattern as other agents; consider a dedicated preset `smartest-verifier` (e.g. fast, cheap model) to keep cost and latency low.
- **Prompt structure**:
  - System: "You are a test oracle. Given a scenario, the input to the system, and the actual output, determine if the output satisfies the stated criteria. Reply only with pass/fail and brief reasoning."
  - User: scenario + input (summary if large) + output (summary if large) + criteria.
- **Caching**: Optional: cache (criteria hash + input hash → result) so repeated runs (e.g. same fixture) don't re-call the LLM. Can be a later optimization.

---

## 7. Integration with Bun Test

- **Runner**: `runScenario(scenario)` returns `{ pass: boolean, output?: unknown, verification?: { reasoning } }`. The spec file calls this inside `it('...', async () => { ... })`.
- **Assertion**: `expect(result.pass).toBe(true)` and optionally `expect(result.verification.reasoning).toContain('...')` for debugging.
- **Timeouts**: Scenario runs (agent/graph + optional LLM verify) can be slow; use bun test timeout per test (e.g. 60s–120s) as today.
- **Filtering**: Consider env var or flag to run only smartest scenarios (e.g. `SMARTEST=1 bun test`) so CI can run a subset.

---

## 8. Library Layout (Proposed)

Follow the project convention `{domain}.{purpose}.{extension}` (see `.cursor/rules/file-naming-convention.mdc`). Domain for this library: `smartest`. Barrel file `index.ts` is exempt.

```
protocol/src/lib/smartest/
├── index.ts                      # Barrel: public API (runScenario, defineScenario)
├── smartest.types.ts           # SmartestScenario, FixtureDef, VerificationResult
├── smartest.runner.ts          # Generate fixtures from spec, resolve refs, invoke SUT (no file I/O)
├── smartest.fixtures.ts        # Resolve fixture defs to values (inline or run generator in-memory)
├── smartest.verifier.ts        # Schema check + LLM verifier agent
├── smartest.verifier.prompt.ts # Verifier prompt and schema
└── smartest.spec.ts            # Tests for smartest itself (inline scenarios only)
```

Spec files in `lib/protocol` (e.g. `agents/intent/inferrer/explicit.inferrer.smartest.spec.ts`) import `runScenario` from `@lib/smartest` (or relative path) and define scenarios; they can coexist with existing `explicit.inferrer.spec.ts` unit tests.

---

## 9. Example: Explicit Intent Inferrer

**Current test** (simplified):

```ts
it('should extract a clear explicit goal', async () => {
  const result = await inferrer.invoke("I want to deploy a Solidity contract...", profileContext);
  expect(result.intents.length).toBeGreaterThan(0);
  expect(intent?.description).toContain("Deploy");
  expect(intent?.confidence).toBe("high");
}, 30000);
```

**Smartest version** (conceptual):

```ts
import { runScenario } from '../../../../lib/smartest';

const scenario = {
  name: 'extract-explicit-goal-deploy-contract',
  description: 'User states a clear goal about deploying a Solidity contract to Ethereum.',
  fixtures: {
    profile: "User is an experienced software engineer interested in AI and crypto."
  },
  sut: {
    type: 'agent',
    factory: () => new ExplicitIntentInferrer(),
    invoke: (agent, input) => agent.invoke(input.content, input.profile),
    input: { content: "I want to deploy a Solidity contract to Ethereum mainnet by tomorrow.", profile: '@fixtures.profile' }
  },
  verification: {
    criteria: 'The result must contain at least one intent of type "goal" about deploying to Ethereum or mainnet; the intent description should reflect deployment and confidence should be high. No tombstone or phatic intent.'
  }
};

it('extract explicit goal (LLM-verified)', async () => {
  const result = await runScenario(scenario);
  expect(result.pass).toBe(true);
  if (!result.pass) console.log(result.verification?.reasoning);
}, 60000);
```

The LLM verifier sees the actual output (intents array) and the criteria, and returns pass/fail + reasoning so we detect semantic regressions (e.g. model starts returning a tombstone or wrong confidence).

---

## 10. Phased Implementation

| Phase | Deliverable |
|-------|-------------|
| **Phase 1** | `lib/smartest`: types, runner (inline fixtures only; generate/resolve in-memory), schema + LLM verifier, single `runScenario()` API. One spec file (e.g. explicit inferrer) migrated to 1–2 scenarios. All data generated at test time; nothing persisted. |
| **Phase 2** | Generator-from-spec: fixture defs can be `{ generate: fn }` or declarative `{ generate: 'profile', seed: 42 }` with a small registry; runner invokes generators during the test and discards results after. |
| **Phase 3** | Richer verification: optional rubric (multiple criteria), caching for verifier by (criteria hash, input hash). |
| **Phase 4** | More generator types and UX improvements as needed. |

---

## 11. Open Questions

1. **Naming**: `smartest` vs `spec-test` vs `agent-test` — keep `smartest` as the working name?
2. **Generator API**: Fixture as async function `() => value` vs declarative `{ generate: 'profile', seed: 42 }` with a registry — or support both in Phase 1/2?
3. **Verifier model**: Reuse an existing preset or add `smartest-verifier`?
4. **Failure handling**: On LLM verifier failure, should we auto-dump (input, output, criteria) to a file for inspection?
5. **CI**: Run smartest only when `SMARTEST=1` or on a schedule to save cost/latency?

---

## 12. Summary

- **Problem**: Input/output and shape tests don't validate that agent/graph outputs are semantically correct.
- **Idea**: A **spec-driven** harness in `lib/smartest` that (1) **generates data from the spec at test time** (inline or generator), (2) invokes the **SUT** (agent or graph) with that data, and (3) uses **schema + LLM verification** to decide pass/fail. Data is **never persisted**; normal `bun test` runs everything on the go — no `smartest:generate` script or committed fixture files.
- **Outcome**: Spec files are the single place to describe and refine scenarios; the harness stays generic; we gain semantic regression detection without adding a separate generate step or fixture blobs in the repo.

Next step: implement Phase 1 (types, runner with inline fixtures generated in-memory, verifier, one migrated scenario) and then add generator-from-spec in Phase 2.
