# Design: Extract `@indexnetwork/protocol` as an NPM Package

**Date:** 2026-04-06
**Branch:** `feat/protocol-npm-package`
**Related:** IND-224 (interface categorization, follow-up)

## Overview

Extract `protocol/src/lib/protocol/` into a standalone, publicly published NPM package `@indexnetwork/protocol`. The package enables both internal consumers (CLI, future packages) and external third parties to run Index Network's agent graphs against their own infrastructure adapters.

The protocol lib is already architecturally self-contained — zero imports outside its own directory, all infrastructure injected via `ToolContext`. This extraction makes that boundary formal and enforced by the module system.

---

## 1. Monorepo Layout

A new `packages/` directory is added at the repo root. The source moves from `protocol/src/lib/protocol/` to `packages/protocol/src/`.

```
index/
├── packages/
│   └── protocol/               ← new workspace (@indexnetwork/protocol)
│       ├── src/                ← moved from protocol/src/lib/protocol/
│       │   ├── agents/
│       │   ├── graphs/
│       │   ├── interfaces/
│       │   ├── states/
│       │   ├── streamers/
│       │   ├── support/
│       │   ├── tools/
│       │   ├── types/
│       │   └── index.ts        ← new barrel export
│       ├── package.json
│       └── tsconfig.json
├── protocol/                   ← unchanged app; imports @indexnetwork/protocol from NPM
├── frontend/
├── cli/
└── package.json                ← adds "packages/*" to workspaces
```

`protocol/src/lib/protocol/` is deleted. All imports within `protocol/src/` that previously referenced `../lib/protocol/...` are updated to `@indexnetwork/protocol`.

`packages/protocol/` is **not** a workspace dependency of `protocol/` — it is consumed as a regular published NPM package. The two have independent release cycles.

---

## 2. Exports Surface

`packages/protocol/src/index.ts` exports a minimal public surface:

**Entry point:**
```ts
export { createChatTools } from "./tools";
export type { ChatTools } from "./tools";
```

**Context and dependency types:**
```ts
export type { ToolContext, ResolvedToolContext, ToolDeps, ProtocolDeps } from "./tools/tool.helpers";
```

**All adapter interfaces** (all 11, consumers implement what they need):
```ts
export type { ... } from "./interfaces/auth.interface";
export type { ... } from "./interfaces/cache.interface";
export type { ... } from "./interfaces/chat-session.interface";
export type { ... } from "./interfaces/contact.interface";
export type { ... } from "./interfaces/database.interface";
export type { ... } from "./interfaces/embedder.interface";
export type { ... } from "./interfaces/enrichment.interface";
export type { ... } from "./interfaces/integration.interface";
export type { ... } from "./interfaces/queue.interface";
export type { ... } from "./interfaces/scraper.interface";
export type { ... } from "./interfaces/storage.interface";
```

**Model config:**
```ts
export type { ModelConfig } from "./agents/model.config";
```

Everything else (graph factories, agents, states, streamers) is internal. The `package.json` `exports` field maps only `"."` — no subpath imports.

---

## 3. `model.config.ts` Refactor

`MODEL_CONFIG` becomes a function instead of a top-level const, so `chatModel` and `chatReasoningEffort` can be injected at call time rather than read at import time.

```ts
export interface ModelConfig {
  apiKey?: string;
  baseURL?: string;
  chatModel?: string;
  chatReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

function getModelConfig(config?: ModelConfig) {
  return {
    // all other agents remain static:
    intentInferrer: { model: "google/gemini-2.5-flash" },
    // ...
    chat: {
      model: config?.chatModel ?? process.env.CHAT_MODEL ?? "google/gemini-3-pro-preview",
      maxTokens: 8192,
      reasoning: {
        effort: (config?.chatReasoningEffort ?? process.env.CHAT_REASONING_EFFORT ?? "low") as NonNullable<ModelSettings["reasoning"]>["effort"],
        exclude: true,
      },
    },
  } as const;
}

export function createModel(agent: keyof ReturnType<typeof getModelConfig>, config?: ModelConfig): ChatOpenAI {
  const apiKey = config?.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error(`createModel(${agent}): OPENROUTER_API_KEY is required.`);
  }
  const cfg = getModelConfig(config)[agent];
  return new ChatOpenAI({
    model: cfg.model,
    configuration: {
      baseURL: config?.baseURL ?? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      apiKey,
    },
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    ...(cfg.reasoning && { modelKwargs: { reasoning: cfg.reasoning } }),
  });
}
```

`ModelConfig` is threaded through `ToolContext` so `createChatTools()` can pass it down to agents. The internal `protocol/` app continues to work with zero changes — it never passes `ModelConfig`, so everything falls through to `process.env` as today.

---

## 4. Build Pipeline

### `packages/protocol/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.spec.ts", "**/*.test.ts"]
}
```

### `packages/protocol/package.json`
```json
{
  "name": "@indexnetwork/protocol",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  }
}
```

### Root `package.json`
`"packages/*"` is added to the `workspaces` array. The root `worktree:build` script includes `packages/protocol` in its build sequence.

### CI order
CI builds and publishes `packages/protocol` before building `protocol/`. Publishing is triggered by a git tag on commits that touch `packages/protocol/`.

---

## 5. Versioning

- Starts at **`0.1.0`** — signals pre-stable public API
- Versioned independently of the `protocol/` app (currently `0.7.0`)
- Breaking changes to the exported surface bump the minor until `1.0.0`
- `protocol/`'s `package.json` pins an exact version: `"@indexnetwork/protocol": "0.1.0"` — not a range — so upgrades are explicit
- Git tag format: `protocol-vX.Y.Z` (distinct from CLI's `vX.Y.Z` tags)

---

## 6. Migration Steps (Implementation Order)

1. Create `packages/protocol/` with `package.json`, `tsconfig.json`
2. Move source from `protocol/src/lib/protocol/` to `packages/protocol/src/`
3. Create `packages/protocol/src/index.ts` barrel
4. Refactor `model.config.ts` (`getModelConfig()` function, `ModelConfig` type, thread through `ToolContext`)
5. Update all imports in `protocol/src/` from `../lib/protocol/...` to `@indexnetwork/protocol`
6. Add `"packages/*"` to root `package.json` workspaces
7. Build `packages/protocol` and verify type output
8. Publish `@indexnetwork/protocol@0.1.0` to NPM
9. Add `"@indexnetwork/protocol": "0.1.0"` to `protocol/package.json` and install
10. Verify `protocol/` builds and tests pass end-to-end

---

## Out of Scope

- **IND-224**: Interface categorization by infrastructure type — tracked separately, to be done after extraction
- Subpath exports (`/graphs`, `/interfaces`) — can be added later without breaking changes
- Making optional deps truly optional with no-op defaults — deferred; all `ToolContext` fields remain required for now
