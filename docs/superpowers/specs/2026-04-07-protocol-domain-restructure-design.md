# Protocol Package Domain Restructure

**Date:** 2026-04-07
**Scope:** `packages/protocol/src/`

## Problem

The current structure organizes files by technical layer (`agents/`, `graphs/`, `states/`, `tools/`, `support/`). Finding anything requires knowing which layer it lives in. Everything related to "opportunity" is scattered across six directories. `support/` is a catch-all with 17 unrelated files. A new contributor cannot tell what the system does by looking at the directory tree.

## Goals

- Domain-first organization: opening `src/` reveals what the system does
- No cross-domain imports (except `chat/` which is the explicit composition root)
- Tests always in a `tests/` subfolder sister to the files they test
- No `index.ts` files except the package entry `src/index.ts`
- File naming follows `{domain}.{purpose}.ts` convention throughout

## Proposed Structure

```
src/
├── shared/
│   ├── interfaces/              # 11 infrastructure contracts (unchanged)
│   ├── hyde/                    # HyDE search strategy subsystem
│   │   ├── hyde.generator.ts
│   │   ├── hyde.strategies.ts
│   │   ├── hyde.graph.ts
│   │   ├── hyde.state.ts
│   │   └── lens.inferrer.ts
│   ├── agent/                   # Model config, tool infrastructure, response streaming
│   │   ├── model.config.ts
│   │   ├── tool.factory.ts          # Was tools/index.ts (createChatTools composition root)
│   │   ├── tool.helpers.ts
│   │   ├── tool.registry.ts
│   │   ├── utility.tools.ts
│   │   └── response.streamer.ts
│   ├── observability/           # Logging, tracing, performance
│   │   ├── protocol.logger.ts
│   │   ├── log.ts
│   │   ├── performance.ts
│   │   ├── request-context.ts
│   │   └── debug-meta.sanitizer.ts
│   └── ui/                      # Display helpers
│       └── lucide.icon-catalog.ts
│
├── intent/
│   ├── intent.inferrer.ts
│   ├── intent.verifier.ts
│   ├── intent.reconciler.ts
│   ├── intent.clarifier.ts
│   ├── intent.indexer.ts
│   ├── intent.graph.ts
│   ├── intent.state.ts
│   ├── intent.tools.ts
│   └── tests/
│
├── opportunity/
│   ├── opportunity.evaluator.ts
│   ├── opportunity.presenter.ts
│   ├── opportunity.graph.ts
│   ├── opportunity.state.ts
│   ├── opportunity.tools.ts
│   ├── opportunity.discover.ts
│   ├── opportunity.enricher.ts
│   ├── opportunity.persist.ts
│   ├── opportunity.presentation.ts  # Absorbs opportunity.card-text.ts + opportunity.sanitize.ts
│   ├── opportunity.labels.ts        # Was opportunity.constants.ts
│   ├── opportunity.utils.ts
│   ├── opportunity.introducer.ts    # Was introducer.discovery.ts
│   ├── feed/
│   │   ├── feed.categorizer.ts      # Was home.categorizer.ts
│   │   ├── feed.graph.ts            # Was home.graph.ts
│   │   ├── feed.state.ts            # Was home.state.ts
│   │   └── feed.health.ts           # Was support/feed.health.ts
│   └── tests/
│
├── profile/
│   ├── profile.generator.ts
│   ├── profile.hyde.generator.ts
│   ├── profile.enricher.ts          # Was profile.enrichment-display-name.ts
│   ├── profile.graph.ts
│   ├── profile.state.ts
│   ├── profile.tools.ts
│   └── tests/
│
├── negotiation/
│   ├── negotiation.proposer.ts
│   ├── negotiation.responder.ts
│   ├── negotiation.insights.generator.ts
│   ├── negotiation.graph.ts
│   ├── negotiation.state.ts
│   └── tests/
│
├── network/
│   ├── network.graph.ts
│   ├── network.state.ts
│   ├── network.tools.ts
│   ├── membership/
│   │   ├── membership.graph.ts      # Was network_membership.graph.ts
│   │   └── membership.state.ts      # Was network_membership.state.ts
│   ├── indexer/
│   │   ├── indexer.graph.ts         # Was intent_network.graph.ts
│   │   └── indexer.state.ts         # Was intent_network.state.ts
│   └── tests/
│
├── contact/
│   ├── contact.tools.ts
│   ├── contact.inviter.ts           # Was invite.generator.ts
│   └── tests/
│
├── integration/
│   ├── integration.tools.ts
│   └── tests/
│
├── maintenance/
│   ├── maintenance.graph.ts
│   ├── maintenance.state.ts
│   └── tests/
│
├── chat/                            # Composition root: web chat UI only
│   ├── chat.agent.ts
│   ├── chat.prompt.ts
│   ├── chat.prompt.modules.ts
│   ├── chat.graph.ts
│   ├── chat.state.ts
│   ├── chat.streamer.ts
│   ├── chat.title.generator.ts
│   ├── chat.utils.ts
│   ├── chat.suggester.ts            # Was suggestion.generator.ts
│   ├── chat-streaming.types.ts      # Was types/chat-streaming.types.ts
│   └── tests/
│
├── mcp/
│   └── mcp.server.ts
│
└── index.ts                         # Only index.ts in the package
```

## File Renames

| Old path | New path | Reason |
|---|---|---|
| `agents/hyde.generator.ts` | `shared/hyde/hyde.generator.ts` | Shared search strategy |
| `agents/hyde.strategies.ts` | `shared/hyde/hyde.strategies.ts` | Shared search strategy |
| `graphs/hyde.graph.ts` | `shared/hyde/hyde.graph.ts` | Shared search strategy |
| `states/hyde.state.ts` | `shared/hyde/hyde.state.ts` | Shared search strategy |
| `agents/lens.inferrer.ts` | `shared/hyde/lens.inferrer.ts` | Part of HyDE subsystem |
| `agents/model.config.ts` | `shared/agent/model.config.ts` | Agent infrastructure |
| `tools/index.ts` | `shared/agent/tool.factory.ts` | Composition root, not chat-specific |
| `tools/profile.tools.ts` | `profile/profile.tools.ts` | Domain move |
| `tools/tool.helpers.ts` | `shared/agent/tool.helpers.ts` | Agent infrastructure |
| `tools/tool.registry.ts` | `shared/agent/tool.registry.ts` | Agent infrastructure |
| `tools/utility.tools.ts` | `shared/agent/utility.tools.ts` | Agent infrastructure |
| `streamers/response.streamer.ts` | `shared/agent/response.streamer.ts` | Agent infrastructure |
| `support/protocol.logger.ts` | `shared/observability/protocol.logger.ts` | Observability |
| `support/log.ts` | `shared/observability/log.ts` | Observability |
| `support/performance.ts` | `shared/observability/performance.ts` | Observability |
| `support/request-context.ts` | `shared/observability/request-context.ts` | Observability |
| `support/debug-meta.sanitizer.ts` | `shared/observability/debug-meta.sanitizer.ts` | Observability |
| `support/lucide.icon-catalog.ts` | `shared/ui/lucide.icon-catalog.ts` | UI helpers |
| `support/opportunity.constants.ts` | `opportunity/opportunity.labels.ts` | Convention rename |
| `support/opportunity.card-text.ts` | _(merged into `opportunity.presentation.ts`)_ | Only used internally |
| `support/opportunity.sanitize.ts` | _(merged into `opportunity.presentation.ts`)_ | Only used internally |
| `support/introducer.discovery.ts` | `opportunity/opportunity.introducer.ts` | Convention rename |
| `agents/opportunity.presenter.ts` | `opportunity/opportunity.presenter.ts` | Domain move |
| `agents/opportunity.evaluator.ts` | `opportunity/opportunity.evaluator.ts` | Domain move |
| `graphs/home.graph.ts` | `opportunity/feed/feed.graph.ts` | Domain + rename |
| `states/home.state.ts` | `opportunity/feed/feed.state.ts` | Domain + rename |
| `agents/home.categorizer.ts` | `opportunity/feed/feed.categorizer.ts` | Domain + rename |
| `support/feed.health.ts` | `opportunity/feed/feed.health.ts` | Domain move |
| `agents/profile.enrichment-display-name.ts` | `profile/profile.enricher.ts` | Convention rename |
| `graphs/network_membership.graph.ts` | `network/membership/membership.graph.ts` | Subfolder |
| `states/network_membership.state.ts` | `network/membership/membership.state.ts` | Subfolder |
| `graphs/intent_network.graph.ts` | `network/indexer/indexer.graph.ts` | Subfolder + rename |
| `states/intent_network.state.ts` | `network/indexer/indexer.state.ts` | Subfolder + rename |
| `tools/contact.tools.ts` | `contact/contact.tools.ts` | Domain move |
| `agents/invite.generator.ts` | `contact/contact.inviter.ts` | Domain move + rename |
| `tools/integration.tools.ts` | `integration/integration.tools.ts` | Domain move |
| `graphs/maintenance.graph.ts` | `maintenance/maintenance.graph.ts` | Domain move |
| `states/maintenance.state.ts` | `maintenance/maintenance.state.ts` | Domain move |
| `agents/suggestion.generator.ts` | `chat/chat.suggester.ts` | Convention rename |
| `streamers/chat.streamer.ts` | `chat/chat.streamer.ts` | Domain move |
| `types/chat-streaming.types.ts` | `chat/chat-streaming.types.ts` | Domain move |

## Cross-Domain Import Rule

- `shared/` may be imported by any domain
- Domain folders (`intent/`, `opportunity/`, etc.) must not import each other
- `chat/` is the only composition root — it may import any domain
- `opportunity/feed/` may import from `opportunity/` (same parent domain)

## Directories Removed

`agents/`, `graphs/`, `states/`, `tools/`, `streamers/`, `support/`, `types/` — all dissolved into domain folders.
