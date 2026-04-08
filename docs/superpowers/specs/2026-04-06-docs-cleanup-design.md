# Docs Cleanup & Audit Design

**Date:** 2026-04-06  
**Status:** Approved

## Problem

Documentation is scattered across multiple locations outside the canonical `docs/` directory, creating confusion about what's authoritative. Many files are stale AI planning artifacts that were never cleaned up.

## Scope

### Phase 1 — Delete stale scattered files

Remove all docs living outside `docs/` and `packages/protocol/src/docs/` (which is research reference material co-located with the package):

| Path | Reason |
|------|--------|
| `docs/.archive/` | Historical artifacts already captured in code or canonical docs |
| `plans/` (root) | AI brainstorming artifacts from early development, never canonical |
| `protocol/docs/` | Old analysis/design notes, superseded by `docs/design/` |
| `protocol/plans/` | Old enhancement/todo notes, never maintained |
| `protocol/ARCHITECTURE.md` | Superseded by `docs/design/architecture-overview.md` |
| `.cursor/plans/` | Old Cursor IDE AI plans, not project documentation |

**Keep in place:** `packages/protocol/src/docs/` (research reference), all READMEs, all templates (`*.template.md`), `frontend/content/blog/`, `docs/` canonical structure.

### Phase 2 — Audit and update `docs/` contents

Four parallel agents, one per subdirectory, each auditing their docs against the current codebase and updating stale content.

**Agent 1: `docs/design/`**
- `architecture-overview.md` — verify monorepo structure, tech stack, agent topology
- `protocol-deep-dive.md` — verify controller/service listings, graph names, data flow

**Agent 2: `docs/domain/`**
- `intents.md`, `indexes.md`, `opportunities.md`, `profiles.md` — verify schema fields, relationships
- `feed-and-maintenance.md`, `negotiation.md`, `hyde.md` — verify feature status

**Agent 3: `docs/guides/`**
- `getting-started.md` — verify env vars, commands, setup steps against current config

**Agent 4: `docs/specs/`**
- `api-reference.md` — verify endpoints against current controllers
- `cli-*.md` (6 files) — verify CLI commands against current implementation
- `user-index-keys.md`, `webhooks.md`, `introducer-discovery.md`, `feed-maintenance-reintegration.md` — verify feature status and accuracy

## Outcome

A single authoritative documentation tree under `docs/`, with `packages/protocol/src/docs/` as co-located research reference. No stale files outside these locations.
