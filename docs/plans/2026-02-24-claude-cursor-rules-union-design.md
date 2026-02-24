# CLAUDE.md and .cursor/rules union — design

**Date**: 2026-02-24

## Goal

Unionize rules so **both** sources have the full set: Claude (claude.ai/code) only reads `CLAUDE.md`; Cursor only reads `.cursor/`. Each must be self-contained with equivalent guidance.

## Approach

1. **Add to CLAUDE.md** everything that lived only in `.cursor/rules/` (so Claude has it).
2. **Add to .cursor/rules** everything that lived only in CLAUDE (so Cursor has it).

Duplication is intentional so each tool has a complete rule set.

## Changes made

### Additions to CLAUDE.md

- **Testing**: "Do not run bun test yourself" (from `do-not-run-bun-test.mdc`): do not run `bun test` in the terminal; give the command and ask the user to run and paste output.
- **Testing**: Expanded "Bun Test Standards" with full checklist (env, structure, lifecycle, timeouts, assertions, mocking, coverage) so it matches the rule without "see .cursor/...".
- **File naming**: Added good/bad examples and "Naming new files" steps; removed reference to `.cursor/rules/file-naming-convention.mdc`.
- **LangGraph**: Inlined full patterns (when to use, file org, factory, state, conditional routing, nodes, assembly, anti-patterns, checklist); removed reference to `.cursor/rules/langgraph-patterns.mdc`.
- **Migration naming**: Added "Do not rename snapshot files" and 5-step checklist; aligned with `migration-naming.mdc`.
- **Import ordering**: Added BAD example from `import-ordering.mdc`.

### Additions to .cursor/rules

- **git-workflow.mdc** (new): Worktrees (`worktree:setup`, `worktree:dev`, `worktree:list`), Conventional Commits format and types, Conventional Branches, Pull Request conventions (gh, changelog categories).
- **migration-naming.mdc** (expanded): Making schema changes (full workflow), why migrations get out of sync, making db:migrate single source of truth, fixing ruined migrations, common operations (db:studio, db:flush, db:migrate, db:seed).
- **protocol-architecture.mdc** (expanded): Adapter pattern (interfaces in `lib/protocol/interfaces/`, implementations in `adapters/`, controller injection), Controller and decorator routing (RouteRegistry, main.ts, template and router references).
- **protocol-code-style.mdc** (new): TypeScript (strict, Zod, Id type), Agents (BaseLangChainAgent, no DB), Services (no other services), Controllers (no adapters), API Routes (guards, Zod, errors), Database (schema location, Drizzle, soft deletes).

## Rule inventory after union

| Rule | CLAUDE.md | .cursor/rules |
|------|-----------|----------------|
| Do not run bun test | ✅ In Testing | ✅ do-not-run-bun-test.mdc |
| Bun test standards | ✅ In Testing | ✅ bun-test-standards.mdc |
| File naming | ✅ In Code Style | ✅ file-naming-convention.mdc |
| LangGraph patterns | ✅ In Agent System | ✅ langgraph-patterns.mdc |
| Migration naming + DB workflow | ✅ In Database Workflow | ✅ migration-naming.mdc |
| Import ordering | ✅ In Code Style | ✅ import-ordering.mdc |
| Protocol layering, templates, TSDoc, adapter, routing | ✅ In Patterns & Conventions | ✅ protocol-architecture.mdc |
| Git workflow (worktrees, commits, branches, PRs) | ✅ In Git Workflow | ✅ git-workflow.mdc |
| Protocol code style (TS, agents, services, controllers, API, DB) | ✅ In Code Style & Practices | ✅ protocol-code-style.mdc |

## Maintenance

When updating a rule: change it in **both** CLAUDE.md and the corresponding `.cursor/rules/*.mdc` (or the relevant section in CLAUDE if the rule is inlined) so they stay in sync.
