# Protocol Domain Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `packages/protocol/src/` from layer-first (`agents/`, `graphs/`, `states/`, `tools/`, `support/`) to domain-first (`intent/`, `opportunity/`, `profile/`, `negotiation/`, `network/`, `contact/`, `integration/`, `maintenance/`, `chat/`, `shared/`).

**Architecture:** Pure file move + rename refactoring — no logic changes. All files move to their domain folder. Tests follow their source files into `tests/` subdirs. Imports update to reflect new relative paths. Two files (`opportunity.card-text.ts`, `opportunity.sanitize.ts`) merge into `opportunity.presentation.ts`.

**Tech Stack:** TypeScript (ESM, NodeNext), Bun, `tsc` for build verification, `bun test` for test verification.

> **Important:** The build will be broken between Task 2 and Task 17 (during file moves). Do not run `bun run build` until Task 17. Track progress with `tsc --noEmit 2>/dev/null | wc -l` (errors should reach ~0 after Task 17).

---

## Path Mapping Reference

Use this table throughout. Every "old import path" → "new path relative to `src/`".

| Old path (relative to `src/`) | New path (relative to `src/`) |
|---|---|
| `agents/chat.agent.ts` | `chat/chat.agent.ts` |
| `agents/chat.prompt.ts` | `chat/chat.prompt.ts` |
| `agents/chat.prompt.modules.ts` | `chat/chat.prompt.modules.ts` |
| `agents/chat.title.generator.ts` | `chat/chat.title.generator.ts` |
| `agents/home.categorizer.ts` | `opportunity/feed/feed.categorizer.ts` |
| `agents/hyde.generator.ts` | `shared/hyde/hyde.generator.ts` |
| `agents/hyde.strategies.ts` | `shared/hyde/hyde.strategies.ts` |
| `agents/intent.clarifier.ts` | `intent/intent.clarifier.ts` |
| `agents/intent.indexer.ts` | `intent/intent.indexer.ts` |
| `agents/intent.inferrer.ts` | `intent/intent.inferrer.ts` |
| `agents/intent.reconciler.ts` | `intent/intent.reconciler.ts` |
| `agents/intent.verifier.ts` | `intent/intent.verifier.ts` |
| `agents/invite.generator.ts` | `contact/contact.inviter.ts` |
| `agents/lens.inferrer.ts` | `shared/hyde/lens.inferrer.ts` |
| `agents/model.config.ts` | `shared/agent/model.config.ts` |
| `agents/negotiation.insights.generator.ts` | `negotiation/negotiation.insights.generator.ts` |
| `agents/negotiation.proposer.ts` | `negotiation/negotiation.proposer.ts` |
| `agents/negotiation.responder.ts` | `negotiation/negotiation.responder.ts` |
| `agents/opportunity.evaluator.ts` | `opportunity/opportunity.evaluator.ts` |
| `agents/opportunity.presenter.ts` | `opportunity/opportunity.presenter.ts` |
| `agents/profile.generator.ts` | `profile/profile.generator.ts` |
| `agents/profile.hyde.generator.ts` | `profile/profile.hyde.generator.ts` |
| `agents/suggestion.generator.ts` | `chat/chat.suggester.ts` |
| `graphs/chat.graph.ts` | `chat/chat.graph.ts` |
| `graphs/home.graph.ts` | `opportunity/feed/feed.graph.ts` |
| `graphs/hyde.graph.ts` | `shared/hyde/hyde.graph.ts` |
| `graphs/intent.graph.ts` | `intent/intent.graph.ts` |
| `graphs/intent_network.graph.ts` | `network/indexer/indexer.graph.ts` |
| `graphs/maintenance.graph.ts` | `maintenance/maintenance.graph.ts` |
| `graphs/negotiation.graph.ts` | `negotiation/negotiation.graph.ts` |
| `graphs/network.graph.ts` | `network/network.graph.ts` |
| `graphs/network_membership.graph.ts` | `network/membership/membership.graph.ts` |
| `graphs/opportunity.graph.ts` | `opportunity/opportunity.graph.ts` |
| `graphs/profile.graph.ts` | `profile/profile.graph.ts` |
| `states/chat.state.ts` | `chat/chat.state.ts` |
| `states/home.state.ts` | `opportunity/feed/feed.state.ts` |
| `states/hyde.state.ts` | `shared/hyde/hyde.state.ts` |
| `states/intent_network.state.ts` | `network/indexer/indexer.state.ts` |
| `states/intent.state.ts` | `intent/intent.state.ts` |
| `states/maintenance.state.ts` | `maintenance/maintenance.state.ts` |
| `states/negotiation.state.ts` | `negotiation/negotiation.state.ts` |
| `states/network.state.ts` | `network/network.state.ts` |
| `states/network_membership.state.ts` | `network/membership/membership.state.ts` |
| `states/opportunity.state.ts` | `opportunity/opportunity.state.ts` |
| `states/profile.state.ts` | `profile/profile.state.ts` |
| `support/chat.utils.ts` | `chat/chat.utils.ts` |
| `support/debug-meta.sanitizer.ts` | `shared/observability/debug-meta.sanitizer.ts` |
| `support/feed.health.ts` | `opportunity/feed/feed.health.ts` |
| `support/introducer.discovery.ts` | `opportunity/opportunity.introducer.ts` |
| `support/log.ts` | `shared/observability/log.ts` |
| `support/lucide.icon-catalog.ts` | `shared/ui/lucide.icon-catalog.ts` |
| `support/opportunity.card-text.ts` | _(merged into `opportunity/opportunity.presentation.ts`)_ |
| `support/opportunity.constants.ts` | `opportunity/opportunity.labels.ts` |
| `support/opportunity.discover.ts` | `opportunity/opportunity.discover.ts` |
| `support/opportunity.enricher.ts` | `opportunity/opportunity.enricher.ts` |
| `support/opportunity.persist.ts` | `opportunity/opportunity.persist.ts` |
| `support/opportunity.presentation.ts` | `opportunity/opportunity.presentation.ts` |
| `support/opportunity.sanitize.ts` | _(merged into `opportunity/opportunity.presentation.ts`)_ |
| `support/opportunity.utils.ts` | `opportunity/opportunity.utils.ts` |
| `support/performance.ts` | `shared/observability/performance.ts` |
| `support/profile.enrichment-display-name.ts` | `profile/profile.enricher.ts` |
| `support/protocol.logger.ts` | `shared/observability/protocol.logger.ts` |
| `support/request-context.ts` | `shared/observability/request-context.ts` |
| `tools/contact.tools.ts` | `contact/contact.tools.ts` |
| `tools/index.ts` | `shared/agent/tool.factory.ts` |
| `tools/integration.tools.ts` | `integration/integration.tools.ts` |
| `tools/intent.tools.ts` | `intent/intent.tools.ts` |
| `tools/network.tools.ts` | `network/network.tools.ts` |
| `tools/opportunity.tools.ts` | `opportunity/opportunity.tools.ts` |
| `tools/profile.tools.ts` | `profile/profile.tools.ts` |
| `tools/tool.helpers.ts` | `shared/agent/tool.helpers.ts` |
| `tools/tool.registry.ts` | `shared/agent/tool.registry.ts` |
| `tools/utility.tools.ts` | `shared/agent/utility.tools.ts` |
| `streamers/chat.streamer.ts` | `chat/chat.streamer.ts` |
| `streamers/response.streamer.ts` | `shared/agent/response.streamer.ts` |
| `types/chat-streaming.types.ts` | `chat/chat-streaming.types.ts` |

---

## Task 1: Baseline verification

**Files:** none

- [ ] **Step 1: Confirm tests pass before any changes**

```bash
cd packages/protocol
bun test 2>&1 | tail -5
```
Expected: all test suites pass (or note any pre-existing failures so you don't confuse them with regressions).

- [ ] **Step 2: Confirm build passes**

```bash
cd packages/protocol
bun run build 2>&1 | tail -5
```
Expected: exit 0, no errors.

---

## Task 2: Create new directory structure

**Files:** Create all new directories under `packages/protocol/src/`

- [ ] **Step 1: Create all domain and subfolder directories**

```bash
cd packages/protocol/src
mkdir -p \
  shared/interfaces \
  shared/hyde \
  shared/agent \
  shared/observability \
  shared/ui \
  intent/tests \
  opportunity/feed \
  opportunity/tests \
  profile/tests \
  negotiation/tests \
  network/membership \
  network/indexer \
  network/tests \
  contact/tests \
  integration/tests \
  maintenance/tests \
  chat/tests \
  shared/hyde/tests \
  shared/agent/tests \
  shared/observability/tests \
  shared/ui/tests
```

- [ ] **Step 2: Verify directories were created**

```bash
ls packages/protocol/src/shared/
```
Expected output includes: `interfaces/  hyde/  agent/  observability/  ui/`

---

## Task 3: Move `shared/interfaces`

**Files:** Move `src/interfaces/` → `src/shared/interfaces/`

- [ ] **Step 1: Move all interface files**

```bash
cd packages/protocol/src
git mv interfaces/auth.interface.ts shared/interfaces/auth.interface.ts
git mv interfaces/cache.interface.ts shared/interfaces/cache.interface.ts
git mv interfaces/chat-session.interface.ts shared/interfaces/chat-session.interface.ts
git mv interfaces/contact.interface.ts shared/interfaces/contact.interface.ts
git mv interfaces/database.interface.ts shared/interfaces/database.interface.ts
git mv interfaces/embedder.interface.ts shared/interfaces/embedder.interface.ts
git mv interfaces/enrichment.interface.ts shared/interfaces/enrichment.interface.ts
git mv interfaces/integration.interface.ts shared/interfaces/integration.interface.ts
git mv interfaces/queue.interface.ts shared/interfaces/queue.interface.ts
git mv interfaces/scraper.interface.ts shared/interfaces/scraper.interface.ts
git mv interfaces/storage.interface.ts shared/interfaces/storage.interface.ts
rmdir interfaces
```

---

## Task 4: Move `shared/hyde`

**Files:** Move hyde-related agents, graphs, and states to `src/shared/hyde/`

- [ ] **Step 1: Move source files**

```bash
cd packages/protocol/src
git mv agents/hyde.generator.ts shared/hyde/hyde.generator.ts
git mv agents/hyde.strategies.ts shared/hyde/hyde.strategies.ts
git mv agents/lens.inferrer.ts shared/hyde/lens.inferrer.ts
git mv graphs/hyde.graph.ts shared/hyde/hyde.graph.ts
git mv states/hyde.state.ts shared/hyde/hyde.state.ts
```

- [ ] **Step 2: Move tests**

```bash
cd packages/protocol/src
git mv agents/tests/hyde.generator.spec.ts shared/hyde/tests/hyde.generator.spec.ts
git mv agents/tests/hyde.strategies.spec.ts shared/hyde/tests/hyde.strategies.spec.ts
git mv agents/tests/lens.inferrer.spec.ts shared/hyde/tests/lens.inferrer.spec.ts
git mv graphs/tests/tsconfig.json shared/hyde/tests/tsconfig.json
```

> Note: no existing spec for `hyde.graph.ts` — no test file to move.

- [ ] **Step 3: Create tsconfig for tests (4 levels deep)**

```bash
cat > packages/protocol/src/shared/hyde/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

---

## Task 5: Move `shared/agent`

**Files:** Move tool infrastructure and model config to `src/shared/agent/`

- [ ] **Step 1: Move source files**

```bash
cd packages/protocol/src
git mv agents/model.config.ts shared/agent/model.config.ts
git mv tools/tool.helpers.ts shared/agent/tool.helpers.ts
git mv tools/tool.registry.ts shared/agent/tool.registry.ts
git mv tools/utility.tools.ts shared/agent/utility.tools.ts
git mv streamers/response.streamer.ts shared/agent/response.streamer.ts
git mv tools/index.ts shared/agent/tool.factory.ts
```

- [ ] **Step 2: Move tests**

```bash
cd packages/protocol/src
git mv tools/tests/tool.helpers.spec.ts shared/agent/tests/tool.helpers.spec.ts
git mv tools/tests/index.spec.ts shared/agent/tests/tool.factory.spec.ts
git mv streamers/tests/response.streamer.spec.ts shared/agent/tests/response.streamer.spec.ts
# protocol-init tests the createChatTools composition root
git mv support/tests/protocol-init.spec.ts shared/agent/tests/protocol-init.spec.ts
# shared LLM assertion helper used across agent tests
git mv support/tests/llm-assert.ts shared/agent/tests/llm-assert.ts
```

- [ ] **Step 3: Create tsconfig for tests**

```bash
cat > packages/protocol/src/shared/agent/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

---

## Task 6: Move `shared/observability`

**Files:** Move logging and instrumentation files to `src/shared/observability/`

- [ ] **Step 1: Move source files**

```bash
cd packages/protocol/src
git mv support/protocol.logger.ts shared/observability/protocol.logger.ts
git mv support/log.ts shared/observability/log.ts
git mv support/performance.ts shared/observability/performance.ts
git mv support/request-context.ts shared/observability/request-context.ts
git mv support/debug-meta.sanitizer.ts shared/observability/debug-meta.sanitizer.ts
```

- [ ] **Step 2: Move tests**

```bash
cd packages/protocol/src
git mv support/tests/log.spec.ts shared/observability/tests/log.spec.ts
git mv support/tests/performance.spec.ts shared/observability/tests/performance.spec.ts
git mv support/tests/request-context.spec.ts shared/observability/tests/request-context.spec.ts
git mv support/tests/debug-meta.sanitizer.spec.ts shared/observability/tests/debug-meta.sanitizer.spec.ts
```

- [ ] **Step 3: Create tsconfig for tests**

```bash
cat > packages/protocol/src/shared/observability/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

---

## Task 7: Move `shared/ui`

**Files:** Move UI helpers to `src/shared/ui/`

- [ ] **Step 1: Move source files**

```bash
cd packages/protocol/src
git mv support/lucide.icon-catalog.ts shared/ui/lucide.icon-catalog.ts
```

- [ ] **Step 2: Move tests**

```bash
cd packages/protocol/src
git mv support/tests/lucide.icon-catalog.spec.ts shared/ui/tests/lucide.icon-catalog.spec.ts
```

- [ ] **Step 3: Create tsconfig for tests**

```bash
cat > packages/protocol/src/shared/ui/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

---

## Task 8: Move `intent` domain

**Files:** Move intent agents, graph, state, and tools to `src/intent/`

- [ ] **Step 1: Move source files**

```bash
cd packages/protocol/src
git mv agents/intent.inferrer.ts intent/intent.inferrer.ts
git mv agents/intent.verifier.ts intent/intent.verifier.ts
git mv agents/intent.reconciler.ts intent/intent.reconciler.ts
git mv agents/intent.clarifier.ts intent/intent.clarifier.ts
git mv agents/intent.indexer.ts intent/intent.indexer.ts
git mv graphs/intent.graph.ts intent/intent.graph.ts
git mv states/intent.state.ts intent/intent.state.ts
git mv tools/intent.tools.ts intent/intent.tools.ts
```

- [ ] **Step 2: Move tests**

```bash
cd packages/protocol/src
git mv agents/tests/intent.inferrer.spec.ts intent/tests/intent.inferrer.spec.ts
git mv agents/tests/intent.verifier.spec.ts intent/tests/intent.verifier.spec.ts
git mv agents/tests/intent.reconciler.spec.ts intent/tests/intent.reconciler.spec.ts
git mv agents/tests/intent.clarifier.spec.ts intent/tests/intent.clarifier.spec.ts
git mv agents/tests/intent.indexer.spec.ts intent/tests/intent.indexer.spec.ts
git mv graphs/tests/intent.graph.spec.ts intent/tests/intent.graph.spec.ts
```

- [ ] **Step 3: Create tsconfig for tests**

```bash
cat > packages/protocol/src/intent/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

---

## Task 9: Move `opportunity` domain

**Files:** Move opportunity agents, graph, state, tools, and support utilities to `src/opportunity/`. Create `feed/` subfolder for home feed files.

- [ ] **Step 1: Move core opportunity source files**

```bash
cd packages/protocol/src
git mv agents/opportunity.evaluator.ts opportunity/opportunity.evaluator.ts
git mv agents/opportunity.presenter.ts opportunity/opportunity.presenter.ts
git mv graphs/opportunity.graph.ts opportunity/opportunity.graph.ts
git mv states/opportunity.state.ts opportunity/opportunity.state.ts
git mv tools/opportunity.tools.ts opportunity/opportunity.tools.ts
git mv support/opportunity.discover.ts opportunity/opportunity.discover.ts
git mv support/opportunity.enricher.ts opportunity/opportunity.enricher.ts
git mv support/opportunity.persist.ts opportunity/opportunity.persist.ts
git mv support/opportunity.presentation.ts opportunity/opportunity.presentation.ts
git mv support/opportunity.utils.ts opportunity/opportunity.utils.ts
git mv support/opportunity.constants.ts opportunity/opportunity.labels.ts
git mv support/introducer.discovery.ts opportunity/opportunity.introducer.ts
```

- [ ] **Step 2: Move feed subfolder files**

```bash
cd packages/protocol/src
git mv agents/home.categorizer.ts opportunity/feed/feed.categorizer.ts
git mv graphs/home.graph.ts opportunity/feed/feed.graph.ts
git mv states/home.state.ts opportunity/feed/feed.state.ts
git mv support/feed.health.ts opportunity/feed/feed.health.ts
```

- [ ] **Step 3: Move tests**

```bash
cd packages/protocol/src
git mv agents/tests/opportunity.evaluator.spec.ts opportunity/tests/opportunity.evaluator.spec.ts
git mv agents/tests/opportunity.presenter.spec.ts opportunity/tests/opportunity.presenter.spec.ts
git mv graphs/tests/opportunity.graph.spec.ts opportunity/tests/opportunity.graph.spec.ts
git mv graphs/tests/home.graph.spec.ts opportunity/tests/feed.graph.spec.ts
git mv tools/tests/opportunity.tools.spec.ts opportunity/tests/opportunity.tools.spec.ts
git mv support/tests/opportunity.discover.spec.ts opportunity/tests/opportunity.discover.spec.ts
git mv support/tests/opportunity.enricher.spec.ts opportunity/tests/opportunity.enricher.spec.ts
git mv support/tests/opportunity.persist.spec.ts opportunity/tests/opportunity.persist.spec.ts
git mv support/tests/opportunity.presentation.spec.ts opportunity/tests/opportunity.presentation.spec.ts
git mv support/tests/opportunity.utils.spec.ts opportunity/tests/opportunity.utils.spec.ts
git mv support/tests/opportunity.constants.spec.ts opportunity/tests/opportunity.labels.spec.ts
git mv support/tests/opportunity.card-text.spec.ts opportunity/tests/opportunity.card-text.spec.ts
git mv support/tests/opportunity.sanitize.spec.ts opportunity/tests/opportunity.sanitize.spec.ts
git mv support/tests/introducer.discovery.spec.ts opportunity/tests/opportunity.introducer.spec.ts
git mv support/tests/feed.health.spec.ts opportunity/tests/feed.health.spec.ts
```

- [ ] **Step 4: Create tsconfig for tests**

```bash
cat > packages/protocol/src/opportunity/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

---

## Task 10: Move `profile` domain

**Files:** Move profile agents, graph, state, and tools to `src/profile/`

- [ ] **Step 1: Move source files**

```bash
cd packages/protocol/src
git mv agents/profile.generator.ts profile/profile.generator.ts
git mv agents/profile.hyde.generator.ts profile/profile.hyde.generator.ts
git mv support/profile.enrichment-display-name.ts profile/profile.enricher.ts
git mv graphs/profile.graph.ts profile/profile.graph.ts
git mv states/profile.state.ts profile/profile.state.ts
git mv tools/profile.tools.ts profile/profile.tools.ts
```

- [ ] **Step 2: Move tests**

```bash
cd packages/protocol/src
git mv agents/tests/profile.generator.spec.ts profile/tests/profile.generator.spec.ts
git mv agents/tests/profile.hyde.generator.spec.ts profile/tests/profile.hyde.generator.spec.ts
git mv support/tests/profile.enrichment-display-name.spec.ts profile/tests/profile.enricher.spec.ts
git mv graphs/tests/profile.graph.spec.ts profile/tests/profile.graph.spec.ts
```

- [ ] **Step 3: Create tsconfig for tests**

```bash
cat > packages/protocol/src/profile/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

---

## Task 11: Move `negotiation` domain

**Files:** Move negotiation agents, graph, and state to `src/negotiation/`

- [ ] **Step 1: Move source files**

```bash
cd packages/protocol/src
git mv agents/negotiation.proposer.ts negotiation/negotiation.proposer.ts
git mv agents/negotiation.responder.ts negotiation/negotiation.responder.ts
git mv agents/negotiation.insights.generator.ts negotiation/negotiation.insights.generator.ts
git mv graphs/negotiation.graph.ts negotiation/negotiation.graph.ts
git mv states/negotiation.state.ts negotiation/negotiation.state.ts
```

- [ ] **Step 2: Move tests**

```bash
cd packages/protocol/src
git mv agents/tests/negotiation.proposer.spec.ts negotiation/tests/negotiation.proposer.spec.ts
git mv agents/tests/negotiation.responder.spec.ts negotiation/tests/negotiation.responder.spec.ts
git mv agents/tests/negotiation.insights.generator.spec.ts negotiation/tests/negotiation.insights.generator.spec.ts
```

- [ ] **Step 3: Create tsconfig for tests**

```bash
cat > packages/protocol/src/negotiation/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

---

## Task 12: Move `network` domain

**Files:** Move network graph, state, and tools to `src/network/`. Create `membership/` and `indexer/` subfolders.

- [ ] **Step 1: Move core network files**

```bash
cd packages/protocol/src
git mv graphs/network.graph.ts network/network.graph.ts
git mv states/network.state.ts network/network.state.ts
git mv tools/network.tools.ts network/network.tools.ts
```

- [ ] **Step 2: Move membership subfolder**

```bash
cd packages/protocol/src
git mv graphs/network_membership.graph.ts network/membership/membership.graph.ts
git mv states/network_membership.state.ts network/membership/membership.state.ts
```

- [ ] **Step 3: Move indexer subfolder**

```bash
cd packages/protocol/src
git mv graphs/intent_network.graph.ts network/indexer/indexer.graph.ts
git mv states/intent_network.state.ts network/indexer/indexer.state.ts
```

- [ ] **Step 4: Create tsconfig for tests**

```bash
cat > packages/protocol/src/network/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

> Note: no existing test files for these network graphs — no tests to move.

---

## Task 13: Move `contact` domain

**Files:** Move contact tools and invite generator to `src/contact/`

- [ ] **Step 1: Move source files**

```bash
cd packages/protocol/src
git mv tools/contact.tools.ts contact/contact.tools.ts
git mv agents/invite.generator.ts contact/contact.inviter.ts
```

- [ ] **Step 2: Move tests**

```bash
cd packages/protocol/src
git mv tools/tests/contact.tools.spec.ts contact/tests/contact.tools.spec.ts
git mv agents/tests/invite.generator.spec.ts contact/tests/contact.inviter.spec.ts
```

- [ ] **Step 3: Create tsconfig for tests**

```bash
cat > packages/protocol/src/contact/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

---

## Task 14: Move `integration` domain

**Files:** Move integration tools to `src/integration/`

- [ ] **Step 1: Move source files**

```bash
cd packages/protocol/src
git mv tools/integration.tools.ts integration/integration.tools.ts
```

- [ ] **Step 2: Move tests**

```bash
cd packages/protocol/src
git mv tools/tests/integration.tools.spec.ts integration/tests/integration.tools.spec.ts
```

- [ ] **Step 3: Create tsconfig for tests**

```bash
cat > packages/protocol/src/integration/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

---

## Task 15: Move `maintenance` domain

**Files:** Move maintenance graph and state to `src/maintenance/`

- [ ] **Step 1: Move source files**

```bash
cd packages/protocol/src
git mv graphs/maintenance.graph.ts maintenance/maintenance.graph.ts
git mv states/maintenance.state.ts maintenance/maintenance.state.ts
```

- [ ] **Step 2: Move tests**

```bash
cd packages/protocol/src
git mv graphs/tests/maintenance.graph.spec.ts maintenance/tests/maintenance.graph.spec.ts
```

- [ ] **Step 3: Create tsconfig for tests**

```bash
cat > packages/protocol/src/maintenance/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

---

## Task 16: Move `chat` domain

**Files:** Move chat agent, graph, state, prompts, streaming, and utilities to `src/chat/`

- [ ] **Step 1: Move source files**

```bash
cd packages/protocol/src
git mv agents/chat.agent.ts chat/chat.agent.ts
git mv agents/chat.prompt.ts chat/chat.prompt.ts
git mv agents/chat.prompt.modules.ts chat/chat.prompt.modules.ts
git mv agents/chat.title.generator.ts chat/chat.title.generator.ts
git mv agents/suggestion.generator.ts chat/chat.suggester.ts
git mv support/chat.utils.ts chat/chat.utils.ts
git mv graphs/chat.graph.ts chat/chat.graph.ts
git mv states/chat.state.ts chat/chat.state.ts
git mv streamers/chat.streamer.ts chat/chat.streamer.ts
git mv types/chat-streaming.types.ts chat/chat-streaming.types.ts
```

- [ ] **Step 2: Move tests**

```bash
cd packages/protocol/src
git mv agents/tests/chat.agent.spec.ts chat/tests/chat.agent.spec.ts
git mv agents/tests/chat.prompt.spec.ts chat/tests/chat.prompt.spec.ts
git mv agents/tests/chat.prompt.modules.spec.ts chat/tests/chat.prompt.modules.spec.ts
git mv agents/tests/chat.title.generator.spec.ts chat/tests/chat.title.generator.spec.ts
git mv agents/tests/suggestion.generator.spec.ts chat/tests/chat.suggester.spec.ts
git mv support/tests/chat.utils.spec.ts chat/tests/chat.utils.spec.ts
git mv graphs/tests/chat.graph.spec.ts chat/tests/chat.graph.spec.ts
git mv graphs/tests/chat.graph.mocks.ts chat/tests/chat.graph.mocks.ts
```

- [ ] **Step 3: Create tsconfig for tests**

```bash
cat > packages/protocol/src/chat/tests/tsconfig.json << 'EOF'
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false
  },
  "include": ["**/*.spec.ts", "**/*.test.ts", "**/*.ts", "../**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
```

---

## Task 17: Merge `opportunity.card-text.ts` and `opportunity.sanitize.ts` into `opportunity.presentation.ts`

**Files:**
- Modify: `src/opportunity/opportunity.presentation.ts`
- Delete: `src/opportunity` does NOT contain `opportunity.card-text.ts` or `opportunity.sanitize.ts` yet — they were not moved (they will be merged)

> These two files were intentionally NOT moved in Task 9 because their content merges into `opportunity.presentation.ts`. Do them now.

- [ ] **Step 1: Append sanitize.ts content to presentation.ts**

Read `packages/protocol/src/support/opportunity.sanitize.ts` in full, then append all its exports (everything after any imports it has) to the bottom of `packages/protocol/src/opportunity/opportunity.presentation.ts`.

`opportunity.sanitize.ts` has no imports — paste the entire file contents verbatim at the bottom of `opportunity.presentation.ts`.

- [ ] **Step 2: Append card-text.ts content to presentation.ts**

Read `packages/protocol/src/support/opportunity.card-text.ts` in full.

It currently imports:
```typescript
import { MINIMAL_MAIN_TEXT_MAX_CHARS } from "./opportunity.constants.js";
import { stripUuids, stripIntroducerMentions } from "./opportunity.sanitize.js";
```

When appending to `opportunity.presentation.ts`:
- Remove those two import lines (the constants will come from `opportunity.labels.ts` via a relative import; the sanitize functions are now in the same file)
- Add an import for `MINIMAL_MAIN_TEXT_MAX_CHARS` at the top of `opportunity.presentation.ts`:
  ```typescript
  import { MINIMAL_MAIN_TEXT_MAX_CHARS } from "./opportunity.labels.js";
  ```
- Paste the rest of the file (all functions and exports) at the bottom of `opportunity.presentation.ts`

- [ ] **Step 3: Delete the now-redundant source files**

```bash
cd packages/protocol/src
git rm support/opportunity.card-text.ts
git rm support/opportunity.sanitize.ts
```

- [ ] **Step 4: Update the merged test files**

The test files `opportunity/tests/opportunity.card-text.spec.ts` and `opportunity/tests/opportunity.sanitize.spec.ts` still exist from Task 9. Their imports now point to `opportunity.presentation.ts`. Update both:

In `opportunity/tests/opportunity.card-text.spec.ts`, change:
```typescript
// old
import { viewerCentricCardSummary, narratorRemarkFromReasoning } from "../opportunity.card-text.js";
```
to:
```typescript
import { viewerCentricCardSummary, narratorRemarkFromReasoning } from "../opportunity.presentation.js";
```

In `opportunity/tests/opportunity.sanitize.spec.ts`, change:
```typescript
// old
import { stripIntroducerMentions } from "../opportunity.sanitize.js";
```
to:
```typescript
import { stripIntroducerMentions } from "../opportunity.presentation.js";
```

---

## Task 18: Update all internal import paths

This is the critical task — fix every broken import across the entire `src/` tree. The build is currently broken; this task brings it back to zero errors.

**Strategy:** Run `tsc --noEmit 2>&1 | grep "Cannot find module"` to get the list of broken imports, then fix each one using the Path Mapping Reference table at the top of this plan.

- [ ] **Step 1: Check the scope of broken imports**

```bash
cd packages/protocol
tsc --noEmit 2>&1 | grep "Cannot find module" | wc -l
```

Note the count. You will run this after each batch of fixes to verify progress.

- [ ] **Step 2: Fix imports in every moved file**

For each file you moved, its own internal imports (relative `../`) now point to wrong locations. Open each file and update its imports using the mapping table.

**Example — `opportunity/opportunity.graph.ts` before:**
```typescript
import type { DebugMetaAgent } from '../types/chat-streaming.types.js';
import { OpportunityGraphState } from '../states/opportunity.state.js';
import { OpportunityEvaluator } from '../agents/opportunity.evaluator.js';
import { HydeGraphFactory } from '../graphs/hyde.graph.js';
import { protocolLogger } from '../support/protocol.logger.js';
```

**After (all paths adjusted for new location `src/opportunity/`):**
```typescript
import type { DebugMetaAgent } from '../chat/chat-streaming.types.js';
import { OpportunityGraphState } from './opportunity.state.js';
import { OpportunityEvaluator } from './opportunity.evaluator.js';
import { HydeGraphFactory } from '../shared/hyde/hyde.graph.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';
```

**General rules for computing new relative paths:**
- Files within the same domain: `./filename.js`
- Files in another domain: `../otherdomain/filename.js`
- Files in `shared/`: `../shared/subfolder/filename.js`
- Files in nested subfolders (e.g. `network/membership/`): `../../otherdomain/filename.js` for cross-domain, `../filename.js` for parent domain

- [ ] **Step 3: Fix imports in files that were NOT moved but reference moved files**

Some files (like `mcp/mcp.server.ts`) were not moved but import from the old paths. Check them:

```bash
cd packages/protocol
tsc --noEmit 2>&1 | grep "Cannot find module" | grep -v "node_modules"
```

Fix each broken import using the path mapping table.

- [ ] **Step 4: Verify import error count reaches zero**

```bash
cd packages/protocol
tsc --noEmit 2>&1 | grep "Cannot find module" | wc -l
```
Expected: `0`

- [ ] **Step 5: Check for other TypeScript errors**

```bash
cd packages/protocol
tsc --noEmit 2>&1 | grep -v "Cannot find module" | head -30
```

Fix any remaining type errors introduced by the move (e.g., re-exported types that now have wrong paths). These typically appear as "Module X has no exported member Y" — correct the import path.

---

## Task 19: Update `src/index.ts`

**Files:**
- Modify: `packages/protocol/src/index.ts`

Update every export path in `src/index.ts` to use the new locations. Replace the entire file contents:

- [ ] **Step 1: Rewrite `src/index.ts` with updated paths**

```typescript
// ─── Public API (recommended for external consumers) ──────────────────────────

export { createChatTools } from "./shared/agent/tool.factory.js";
export { configureProtocol } from "./shared/agent/model.config.js";
export type { ChatTools } from "./shared/agent/tool.factory.js";
export type { ModelConfig, ModelSettings } from "./shared/agent/model.config.js";
export type {
  ToolContext,
  ResolvedToolContext,
  ToolDeps,
  ProtocolDeps,
  DefineTool,
  RawToolDefinition,
  ToolRegistry,
} from "./shared/agent/tool.helpers.js";
export { ChatContextAccessError, resolveChatContext } from "./shared/agent/tool.helpers.js";

// ─── Interfaces (implement these to wire up your infrastructure) ───────────────

export type * from "./shared/interfaces/auth.interface.js";
export type * from "./shared/interfaces/cache.interface.js";
export type * from "./shared/interfaces/chat-session.interface.js";
export type * from "./shared/interfaces/contact.interface.js";
export type * from "./shared/interfaces/database.interface.js";
export type * from "./shared/interfaces/embedder.interface.js";
export type * from "./shared/interfaces/enrichment.interface.js";
export type * from "./shared/interfaces/integration.interface.js";
export type * from "./shared/interfaces/queue.interface.js";
export type * from "./shared/interfaces/scraper.interface.js";
export type * from "./shared/interfaces/storage.interface.js";

// ─── Graph factories ──────────────────────────────────────────────────────────

export { ChatGraphFactory } from "./chat/chat.graph.js";
export { HomeGraphFactory } from "./opportunity/feed/feed.graph.js";
export { HydeGraphFactory } from "./shared/hyde/hyde.graph.js";
export { NetworkGraphFactory } from "./network/network.graph.js";
export { NetworkMembershipGraphFactory } from "./network/membership/membership.graph.js";
export { IntentGraphFactory } from "./intent/intent.graph.js";
export { IntentNetworkGraphFactory } from "./network/indexer/indexer.graph.js";
export { MaintenanceGraphFactory } from "./maintenance/maintenance.graph.js";
export type {
  MaintenanceGraphDatabase,
  MaintenanceGraphCache,
  MaintenanceGraphQueue,
} from "./maintenance/maintenance.graph.js";
export { NegotiationGraphFactory, createDefaultNegotiationGraph, negotiateCandidates } from "./negotiation/negotiation.graph.js";
export { OpportunityGraphFactory } from "./opportunity/opportunity.graph.js";
export { ProfileGraphFactory } from "./profile/profile.graph.js";

// ─── Agents ───────────────────────────────────────────────────────────────────

export { ChatTitleGenerator } from "./chat/chat.title.generator.js";
export { HydeGenerator } from "./shared/hyde/hyde.generator.js";
export { SuggestionGenerator } from "./chat/chat.suggester.js";
export type { SuggestionGeneratorInput } from "./chat/chat.suggester.js";
export { generateInviteMessage } from "./contact/contact.inviter.js";
export type { InviteInput, InviteOutput } from "./contact/contact.inviter.js";
export { IntentIndexer } from "./intent/intent.indexer.js";
export { LensInferrer } from "./shared/hyde/lens.inferrer.js";
export { NegotiationInsightsGenerator } from "./negotiation/negotiation.insights.generator.js";
export type { NegotiationDigest } from "./negotiation/negotiation.insights.generator.js";
export { NegotiationProposer } from "./negotiation/negotiation.proposer.js";
export { NegotiationResponder } from "./negotiation/negotiation.responder.js";
export { OpportunityEvaluator } from "./opportunity/opportunity.evaluator.js";
export type {
  EvaluatorInput,
  OpportunityEvaluatorOptionsConstructor,
} from "./opportunity/opportunity.evaluator.js";
export { OpportunityPresenter, gatherPresenterContext } from "./opportunity/opportunity.presenter.js";
export type { PresenterDatabase } from "./opportunity/opportunity.presenter.js";

// ─── Support utilities ────────────────────────────────────────────────────────

export {
  canUserSeeOpportunity,
  isActionableForViewer,
  validateOpportunityActors,
  classifyOpportunity,
  selectByComposition,
  FEED_SOFT_TARGETS,
} from "./opportunity/opportunity.utils.js";
export { getPrimaryActionLabel } from "./opportunity/opportunity.labels.js";
export { computeFeedHealth } from "./opportunity/feed/feed.health.js";
export type { FeedHealthInput, FeedHealthResult } from "./opportunity/feed/feed.health.js";
export {
  selectContactsForDiscovery,
  shouldRunIntroducerDiscovery,
  runIntroducerDiscovery,
  MAX_CONTACTS_PER_CYCLE,
  MAX_CANDIDATES_PER_CONTACT,
  INTRODUCER_DISCOVERY_SOURCE,
} from "./opportunity/opportunity.introducer.js";
export type {
  IntroducerDiscoveryDatabase,
  IntroducerDiscoveryQueue,
  ContactWithIntents,
} from "./opportunity/opportunity.introducer.js";
export { persistOpportunities } from "./opportunity/opportunity.persist.js";
export { presentOpportunity } from "./opportunity/opportunity.presentation.js";
export type { UserInfo } from "./opportunity/opportunity.presentation.js";
export { stripUuids, stripIntroducerMentions } from "./opportunity/opportunity.presentation.js";

// ─── Tools ────────────────────────────────────────────────────────────────────

export { createToolRegistry } from "./shared/agent/tool.registry.js";

// ─── MCP ──────────────────────────────────────────────────────────────────────

export { createMcpServer } from "./mcp/mcp.server.js";
export type { ScopedDepsFactory } from "./mcp/mcp.server.js";

// ─── States (for advanced graph consumers) ────────────────────────────────────

export type {
  UserNegotiationContext,
  NegotiationTurn,
  SeedAssessment,
  NegotiationGraphLike,
} from "./negotiation/negotiation.state.js";

// ─── Streamers ────────────────────────────────────────────────────────────────

export { ChatStreamer } from "./chat/chat.streamer.js";
export { ResponseStreamer } from "./shared/agent/response.streamer.js";
```

- [ ] **Step 2: Verify `index.ts` compiles cleanly**

```bash
cd packages/protocol
tsc --noEmit 2>&1 | grep "index.ts" | head -20
```
Expected: no errors referencing `index.ts`.

---

## Task 20: Remove empty old directories

**Files:** Remove all now-empty directories

- [ ] **Step 1: Remove old layer directories and stranded files**

```bash
cd packages/protocol/src

# Remove stranded files (local re-exports / old tsconfigs replaced by domain-level ones)
git rm streamers/index.ts 2>/dev/null || true
git rm tools/tests/tsconfig.json 2>/dev/null || true

# Remove empty directories
rmdir agents/tests 2>/dev/null || true
rmdir agents 2>/dev/null || true
rmdir graphs/tests 2>/dev/null || true
rmdir graphs 2>/dev/null || true
rmdir states 2>/dev/null || true
rmdir support/tests 2>/dev/null || true
rmdir support 2>/dev/null || true
rmdir tools/tests 2>/dev/null || true
rmdir tools 2>/dev/null || true
rmdir streamers/tests 2>/dev/null || true
rmdir streamers 2>/dev/null || true
rmdir types 2>/dev/null || true
```

- [ ] **Step 2: Verify old directories are gone**

```bash
ls packages/protocol/src/
```
Expected: only `shared/  intent/  opportunity/  profile/  negotiation/  network/  contact/  integration/  maintenance/  chat/  mcp/  docs/  README.md  index.ts`

---

## Task 21: Final verification and commit

- [ ] **Step 1: Full TypeScript build**

```bash
cd packages/protocol
bun run build 2>&1
```
Expected: exit 0, no errors, `dist/` populated.

- [ ] **Step 2: Run all tests**

```bash
cd packages/protocol
bun test 2>&1 | tail -20
```
Expected: same pass/fail ratio as baseline (Task 1). No new failures.

- [ ] **Step 3: Verify public API unchanged**

```bash
cd packages/protocol
# Check that the compiled output exports the same symbols as before
node -e "const m = require('./dist/index.js'); console.log(Object.keys(m).sort().join('\n'))"
```
Compare against the symbol list from before the refactor. No symbols should be added or removed.

- [ ] **Step 4: Commit**

```bash
cd packages/protocol
git add -A
git commit -m "$(cat <<'EOF'
refactor(protocol): reorganize src/ from layer-first to domain-first

Replace agents/, graphs/, states/, tools/, support/ with domain folders:
intent/, opportunity/, profile/, negotiation/, network/, contact/,
integration/, maintenance/, chat/, shared/

shared/ groups HyDE search strategy, agent infrastructure, observability,
and UI helpers into semantic subfolders.

No logic changes — pure file moves, renames, and two merges:
- opportunity.card-text + opportunity.sanitize → opportunity.presentation
- tools/index.ts (createChatTools) → shared/agent/tool.factory.ts
EOF
)"
```
