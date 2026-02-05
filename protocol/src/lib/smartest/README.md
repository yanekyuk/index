# Smartest

**Spec-driven, LLM-verified testing for agents and graphs.**

Smartest lets you describe test scenarios in one place: what data to use, what to run (agent or graph), and how to verify the result. Data is generated at test time and never persisted. Verification can be schema-only, or schema plus an LLM judge that checks whether the output satisfies natural-language criteria.

Smartest is **project-agnostic**: it does not know about profiles, intents, opportunities, or any domain. You define fixtures and generators for your domain when using it.

---

## Concepts

| Concept | Description |
|--------|-------------|
| **Scenario** | A single test: name, description, fixtures, system under test (SUT), and verification. |
| **Fixtures** | Named data used as input. Can be inline values, async functions, or declarative generator refs (`{ generate: 'name', ... }`). |
| **SUT** | The agent or graph: a factory, an invoke function, and an input (which can reference fixtures via `@fixtures.<key>`). |
| **Verification** | Optional Zod schema (shape check) and/or LLM verifier (semantic check against criteria). |

**Flow:** Resolve fixtures → resolve `@fixtures.*` refs in input → create SUT and invoke → run schema check (if any) → run LLM verifier (if enabled) → return pass/fail and optional reasoning.

---

## Quick start

```ts
import { describe, expect, it } from 'bun:test';
import { runScenario, defineScenario, expectSmartest } from '../lib/smartest'; // or your path

describe('My agent', () => {
  it('echoes the message (no LLM verify)', async () => {
    const result = await runScenario(
      defineScenario({
        name: 'echo',
        description: 'Echo back the input.',
        fixtures: { msg: 'Hello' },
        sut: {
          type: 'agent',
          factory: () => new MyAgent(),
          invoke: async (instance, resolvedInput) => {
            const input = resolvedInput as { message: string };
            return await (instance as MyAgent).process(input.message);
          },
          input: { message: '@fixtures.msg' },
        },
        verification: {
          criteria: 'Output should echo the message.',
          llmVerify: false,
        },
      })
    );
    expectSmartest(result);
    expect(result.output).toBeDefined();
  });
});
```

---

## Logging and bun test

Smartest **does not log to console**. It returns a `report` (phase timings, totalMs, verifierModel) and `verification.reasoning` so that **only bun test output** shows Smartest info.

Use **`expectSmartest(result)`** after `runScenario(...)`. On failure it throws an `Error` whose message includes the report and verifier reasoning; bun test then displays that as the failure message, so you get a single, coherent block instead of mixed Smartest + bun logs.

```ts
const result = await runScenario(defineScenario({ ... }));
expectSmartest(result);  // throws with report + reasoning if !result.pass
```

Result shape: `{ pass, output?, verification?: { pass, reasoning }, schemaError?, report?: { scenarioName, phases, totalMs, verifierModel? } }`.

---

## Fixtures

### Inline values

Use plain values; they are passed through as-is.

```ts
fixtures: {
  greeting: 'Hello',
  count: 42,
  config: { timeout: 5000 },
}
```

Reference them in `sut.input` with `@fixtures.<key>`:

```ts
input: { text: '@fixtures.greeting', n: '@fixtures.count' }
```

### Async functions

Use a function that returns a value or a promise. Useful for one-off generation or mocks.

```ts
fixtures: {
  value: async () => {
    const n = await someAsyncComputation();
    return n;
  },
}
```

### Declarative generators

Use a generator name and params. The generator must be in the registry (default or passed to `runScenario`).

```ts
fixtures: {
  content: {
    generate: 'text',
    params: { prompt: 'Write one sentence about testing.' },
  },
}
```

With the built-in **text** generator you can also pass a Zod `responseSchema` for structured output:

```ts
import { z } from 'zod';

const MySchema = z.object({ answer: z.string(), score: z.number() });

fixtures: {
  structured: {
    generate: 'text',
    params: {
      prompt: 'Return an answer and score.',
      responseSchema: MySchema,
    },
  },
}
```

**Custom generators:** Smartest only ships a generic **text** generator. Domain-specific generators (e.g. profile, intent) must be defined by your project and passed in:

```ts
runScenario(scenario, {
  generators: {
    text: defaultGeneratorRegistry.text,
    profile: myProfileGenerator,
    intent: myIntentGenerator,
  },
});
```

---

## Verification

### Schema only

Validate output shape with Zod; skip the LLM.

```ts
verification: {
  schema: z.object({ id: z.string(), value: z.number() }),
  criteria: 'N/A',
  llmVerify: false,
}
```

### LLM verifier

An LLM (default: thinking model, e.g. Gemini 2.5 Pro) judges whether the output satisfies the criteria. Use when correctness is semantic.

```ts
verification: {
  criteria:
    'The result must contain at least one item of type "goal" about deployment. ' +
    'Confidence should be high. No tombstone or phatic intent.',
  llmVerify: true, // default
}
```

On failure, `result.verification.reasoning` contains the judge’s explanation.

### Schema then LLM

Provide both: schema runs first; if it passes, the LLM verifier runs.

```ts
verification: {
  schema: MyOutputSchema,
  criteria: 'The summary must reflect the main intent and be under 100 chars.',
}
```

---

## Example scenarios

### 1. Inline fixtures, no LLM

```ts
const result = await runScenario({
  name: 'simple',
  description: 'Process fixed input.',
  fixtures: { msg: 'Hello' },
  sut: {
    type: 'agent',
    factory: () => new MyAgent(),
    invoke: async (_instance, resolvedInput) => {
      const input = resolvedInput as { msg: string };
      return { echoed: input.msg };
    },
    input: { msg: '@fixtures.msg' },
  },
  verification: { criteria: 'N/A', llmVerify: false },
});
expect(result.pass).toBe(true);
```

### 2. Async fixture generator

```ts
fixtures: {
  value: async () => fetchSomeData(),
},
sut: {
  ...
  input: { data: '@fixtures.value' },
},
```

### 3. Built-in text generator

```ts
fixtures: {
  blurb: {
    generate: 'text',
    params: { prompt: 'One sentence about APIs.' },
  },
},
input: { content: '@fixtures.blurb' },
```

### 4. Custom generators (project-defined)

```ts
import { runScenario, defaultGeneratorRegistry } from '../lib/smartest';
import { myProfileGenerator } from '../fixtures/generators';

const result = await runScenario(
  {
    name: 'with-profile',
    description: 'Run with generated profile.',
    fixtures: {
      profile: {
        generate: 'profile',
        params: { hint: 'backend engineer' },
        responseSchema: ProfileSchema,
      },
    },
    sut: { ... },
    verification: { ... },
  },
  {
    generators: {
      ...defaultGeneratorRegistry,
      profile: myProfileGenerator,
    },
  }
);
```

### 5. LLM-verified semantic check

```ts
const result = await runScenario({
  name: 'extract-goal',
  description: 'User states a clear deployment goal.',
  fixtures: {
    context: 'User is a software engineer.',
  },
  sut: {
    type: 'agent',
    factory: () => new IntentInferrer(),
    invoke: async (instance, resolvedInput) => {
      const input = resolvedInput as { content: string; context: string };
      return await (instance as IntentInferrer).invoke(input.content, input.context);
    },
    input: {
      content: 'I want to deploy to production by Friday.',
      context: '@fixtures.context',
    },
  },
  verification: {
    criteria:
      'The result must contain at least one intent of type "goal" about deployment or production. ' +
      'Confidence should be high. No tombstone or phatic intent.',
  },
}, 60000);

expectSmartest(result);  // failure message includes report + reasoning
```

---

## Configuration

| Env var | Default | Description |
|--------|---------|-------------|
| `OPENROUTER_API_KEY` | (required for LLM) | API key for OpenRouter. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter base URL. |
| `SMARTEST_VERIFIER_MODEL` | `google/gemini-2.5-pro` | Model used for the LLM verifier (judge). |
| `SMARTEST_GENERATOR_MODEL` | `google/gemini-2.5-flash` | Model used for built-in/custom LLM-based generators. |

Verification uses a thinking-style model by default; data generation uses a faster model. Override via env or by wrapping `runScenario` and configuring the client yourself in custom generators.

---

## API summary

- **`runScenario(scenario, options?)`** – Run one scenario. Returns `{ pass, output?, verification?, schemaError?, report? }`. No console logging; use `report` and `verification.reasoning` in tests.
- **`expectSmartest(result)`** – Asserts `result.pass`. On failure, throws with a message that includes `report` (timings) and verifier reasoning so bun test shows one clear failure block.
- **`defineScenario(scenario)`** – Type-check a scenario (no runtime effect).
- **`defaultGeneratorRegistry`** – `{ text: textGenerator }`. Merge with your generators when calling `runScenario`.
- **`mergeGeneratorRegistry(custom?)`** – Returns default registry merged with `custom` (custom wins on key clash).
- **`textGenerator`** – Generic generator: `params.prompt` (required), optional `params.maxTokens`, optional `params.responseSchema` (Zod) for structured output.

---

## File layout

```
smartest/
├── index.ts                 # Public API (runScenario, expectSmartest)
├── smartest.types.ts        # Scenario, fixtures, verification, report types
├── smartest.expect.ts       # expectSmartest(result) for bun-test-friendly failures
├── smartest.config.ts       # Model env vars
├── smartest.fixtures.ts     # Fixture resolution, @fixtures refs
├── smartest.generators.ts   # Default registry, text generator
├── smartest.runner.ts       # runScenario (no console logging)
├── smartest.verifier.ts     # Schema check + LLM verifier
├── smartest.verifier.prompt.ts
├── smartest.spec.ts         # Tests
└── README.md                # This file
```
