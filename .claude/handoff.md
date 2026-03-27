---
trigger: "CLAUDE.md is too large and needs to be shortened/condensed while preserving all essential information"
type: refactor
branch: refactor/condense-claude-md
created: 2026-03-27
version-bump: none
---

## Related Files
- CLAUDE.md (821 lines — the target file)
- docs/design/architecture-overview.md (covers monorepo structure, protocol architecture, agent system, database layer, queue system)
- docs/design/protocol-deep-dive.md (covers LangGraph patterns, agents, graphs, tools, trace events)
- docs/domain/intents.md (covers intent lifecycle, speech acts, confidence, inference tracking)
- docs/domain/indexes.md (covers personal indexes, prompts, auto-assignment, contacts, permissions)
- docs/domain/opportunities.md (covers opportunity evaluation, relevancy scoring)
- docs/domain/profiles.md (covers profile generation, HyDE)
- docs/domain/hyde.md (covers HyDE documents)
- docs/domain/negotiation.md (covers negotiation graph)
- docs/domain/feed-and-maintenance.md (covers feed and maintenance)
- docs/guides/getting-started.md (covers environment setup)
- docs/specs/api-reference.md (covers API routes, controllers)
- protocol/src/controllers/controller.template.md
- protocol/src/services/service.template.md
- protocol/src/queues/queue.template.md
- protocol/src/lib/protocol/agents/agent.template.md

## Relevant Docs
- docs/design/architecture-overview.md
- docs/design/protocol-deep-dive.md
- docs/domain/intents.md
- docs/domain/indexes.md
- docs/domain/opportunities.md
- docs/domain/profiles.md
- docs/guides/getting-started.md
- docs/specs/api-reference.md

## Scope
Condense CLAUDE.md from ~821 lines to ~400 lines by:

1. **Replace detailed architecture sections with pointers to docs/**: The full agent listing, protocol graphs, database tables, trace event instrumentation, and frontend route listing are all covered in docs/design/ and docs/specs/. Replace with brief summaries + "See docs/X for details".

2. **Remove content derivable from code**: Full agent file listings, frontend route enumerations, core table listings, queue type listings — all discoverable via glob/grep. Keep only non-obvious patterns.

3. **Merge redundant sections**: Adapter pattern appears twice, layering rules are restated in Code Style, testing guidance is duplicated.

4. **Keep critical in-context content**: Development commands, naming conventions (files, commits, branches), layering rules (stated once), migration workflow + gotchas, env vars, worktree workflow, template file pointers, non-obvious patterns (polymorphic source tracking, personal indexes/contacts, relevancy scoring).

5. **Condense verbose code examples**: Trace event examples, queue processing examples, event-driven broker examples can be shortened or pointed to template files.

Key constraint: The condensed CLAUDE.md must still give Claude Code enough context to work correctly without needing to read docs/ for every task. The balance is: rules/conventions/commands stay in CLAUDE.md, detailed architecture/domain knowledge lives in docs/.
