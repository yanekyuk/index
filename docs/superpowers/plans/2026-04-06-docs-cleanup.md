# Docs Cleanup & Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all stale scattered documentation, delete the archive, and update the remaining canonical docs in `docs/` to reflect the current codebase.

**Architecture:** Two sequential phases — Phase 1 deletes all stale files in one commit; Phase 2 dispatches four independent agents to audit and update each `docs/` subdirectory in parallel.

**Tech Stack:** Git, Markdown, Bun monorepo (TypeScript)

---

## Phase 1: Delete Stale Files

### Task 1: Delete all scattered/stale documentation

**Files to delete:**
- `docs/.archive/` — all contents (historical artifacts superseded by canonical docs)
- `plans/` (root) — 6 AI brainstorming artifacts from early development
- `protocol/docs/` — old analysis/design notes, superseded by `docs/design/`
- `protocol/plans/` — old enhancement/todo notes
- `protocol/ARCHITECTURE.md` — superseded by `docs/design/architecture-overview.md`
- `.cursor/plans/` — old Cursor IDE AI plans

- [ ] **Step 1: Delete all stale files**

```bash
rm -rf docs/.archive
rm -rf plans
rm -rf protocol/docs
rm -rf protocol/plans
rm protocol/ARCHITECTURE.md
rm -rf .cursor/plans
```

- [ ] **Step 2: Verify deletions**

```bash
ls docs/ && ls protocol/ && ls .cursor/
```

Expected: `docs/` shows only `design/ domain/ guides/ plans/ specs/ superpowers/`. `protocol/` no longer has `docs/` or `plans/`. `.cursor/` no longer has `plans/`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: remove stale scattered docs and archive"
```

---

## Phase 2: Audit and Update Canonical Docs

Tasks 2–5 are independent and can run in parallel.

---

### Task 2: Audit and update `docs/design/`

**Files:**
- Modify: `docs/design/architecture-overview.md`
- Modify: `docs/design/protocol-deep-dive.md`

The protocol layer moved from `protocol/src/lib/protocol/` to `packages/protocol/src/` (the `@indexnetwork/protocol` NPM package). Both design docs still reference the old path throughout. Also, the "Further Reading" section in `architecture-overview.md` references files that no longer exist (`protocol/ARCHITECTURE.md`, `protocol/src/lib/protocol/README.md`, `protocol/src/lib/protocol/docs/`).

- [ ] **Step 1: Update all path references in `architecture-overview.md`**

Open `docs/design/architecture-overview.md` and make these changes:

1. In **Section 1 (Monorepo Structure)**, the directory tree is missing `packages/`. Update to:

```
index/
  protocol/          Backend API and Agent Engine (Bun, Express, TypeScript)
  packages/
    protocol/        @indexnetwork/protocol NPM package (graphs, agents, tools, interfaces)
  frontend/          Vite + React Router v7 SPA (React 19, Tailwind CSS 4)
  cli/               CLI client (@indexnetwork/cli, Bun, TypeScript)
  plugin/            Claude plugin — skills-only subtree (indexnetwork/claude-plugin)
```

2. In **Section 2 (Protocol Layering)**, the sentence "The **protocol layer** (`src/lib/protocol/`)…" → update to "The **protocol layer** (`packages/protocol/src/`)…"

3. In **Section 4 (Agent System)**, the directory tree block shows `protocol/src/lib/protocol/` → update to `packages/protocol/src/`:

```
packages/protocol/src/
  graphs/           LangGraph state machines (*.graph.ts)
  states/           Graph state definitions (*.state.ts)
  agents/           AI agents with Zod-validated I/O
  tools/            Chat tool definitions by domain
  streamers/        SSE streaming for chat responses
  support/          Infrastructure utilities
  interfaces/       Adapter contracts
```

4. In **Further Reading** (bottom of file), replace the entire section with:

```markdown
## Further Reading

- **Protocol package README**: `packages/protocol/src/README.md` — graph, agent, and tool documentation
- **Design papers**: `packages/protocol/src/docs/` — deep dives on HyDE strategies, opportunity lifecycle, semantic governance, and more
- **Template files**: `protocol/src/controllers/controller.template.md`, `protocol/src/services/service.template.md`, `protocol/src/queues/queue.template.md`, `packages/protocol/src/agents/agent.template.md`
```

5. Update the `updated` field in the frontmatter to `2026-04-06`.

- [ ] **Step 2: Update all path references in `protocol-deep-dive.md`**

Open `docs/design/protocol-deep-dive.md` and make these changes:

1. In **Section 1 (Overview)**, the description "The protocol layer lives at `protocol/src/lib/protocol/`" → update to "The protocol layer lives at `packages/protocol/src/` (the `@indexnetwork/protocol` package)."

2. In **Section 1**, the ASCII directory tree block shows `protocol/src/lib/protocol/` → update to `packages/protocol/src/`.

3. Search for every other occurrence of `protocol/src/lib/protocol/` in the file and replace with `packages/protocol/src/`.

4. Update the `updated` field in the frontmatter to `2026-04-06`.

- [ ] **Step 3: Verify no old path references remain**

```bash
grep -r "src/lib/protocol" docs/design/
```

Expected: no matches.

- [ ] **Step 4: Update the packages/protocol/src/README.md too**

Open `packages/protocol/src/README.md`. The "Directory Structure" section still shows the old path `protocol/src/lib/protocol/`. Update it to `packages/protocol/src/`.

- [ ] **Step 5: Commit**

```bash
git add docs/design/architecture-overview.md docs/design/protocol-deep-dive.md packages/protocol/src/README.md
git commit -m "docs: update design docs for @indexnetwork/protocol package path"
```

---

### Task 3: Audit and update `docs/domain/`

**Files:**
- Modify (if needed): `docs/domain/intents.md`
- Modify (if needed): `docs/domain/indexes.md`
- Modify (if needed): `docs/domain/opportunities.md`
- Modify (if needed): `docs/domain/profiles.md`
- Modify (if needed): `docs/domain/feed-and-maintenance.md`
- Modify (if needed): `docs/domain/negotiation.md`
- Modify (if needed): `docs/domain/hyde.md`

- [ ] **Step 1: Read the schema to identify any gaps**

Read `protocol/src/schemas/database.schema.ts` — look for fields, tables, or relationships that don't match the domain docs:

```bash
cat protocol/src/schemas/database.schema.ts
```

Cross-check:
- `intents.md`: Look for `intentMode`, `inferenceType`, `confidence`, `isIncognito`, `sourceType`, felicity fields (`clarityScore`, `authorityScore`, `sincerityScore`), `semanticEntropy`, `referentialAnchor` in the schema.
- `indexes.md`: Check for `isPersonal`, `personal_indexes` table, `autoAssign` on members, `prompt` fields.
- `opportunities.md`: Check `status` enum values, actor fields, context fields.
- `profiles.md`: Check embedding dimensions, profile fields.

- [ ] **Step 2: Read each domain doc and compare**

```bash
cat docs/domain/intents.md
cat docs/domain/indexes.md
cat docs/domain/opportunities.md
cat docs/domain/profiles.md
cat docs/domain/feed-and-maintenance.md
cat docs/domain/negotiation.md
cat docs/domain/hyde.md
```

For each doc, check: (a) field names match schema, (b) status/enum values are accurate, (c) no references to deleted files or old paths.

- [ ] **Step 3: Update any docs with inaccurate content**

Fix any discrepancies found in Step 2. Common things to look for:
- References to `protocol/src/lib/protocol/` → `packages/protocol/src/`
- Field names that have been renamed (e.g., `slug` → `key`)
- Status values that no longer exist in the schema
- Feature descriptions for things not yet implemented (mark as aspirational or remove)

Update `updated` frontmatter field to `2026-04-06` on any file changed.

- [ ] **Step 4: Commit (only if changes were made)**

```bash
git add docs/domain/
git commit -m "docs: update domain docs for accuracy"
```

---

### Task 4: Audit and update `docs/guides/`

**Files:**
- Modify (if needed): `docs/guides/getting-started.md`

- [ ] **Step 1: Check env vars against actual example**

```bash
cat protocol/.env.example
cat frontend/.env.example
```

Compare against the env var lists in `getting-started.md`. Update any that are missing or renamed.

- [ ] **Step 2: Check workspace structure**

The guide's workspace structure tree is missing the `packages/` directory. Update:

```
index/
├── protocol/          # Backend API and agent engine (Bun, Express, TypeScript)
├── packages/
│   └── protocol/      # @indexnetwork/protocol NPM package (graphs, agents, tools)
├── frontend/          # Vite + React Router v7 SPA (React 19, Tailwind CSS 4)
├── cli/               # CLI client (@indexnetwork/cli) — Bun, TypeScript
├── scripts/           # Worktree helpers, hooks, dev launcher
├── package.json       # Root workspace config
└── CLAUDE.md          # Comprehensive project reference
```

- [ ] **Step 3: Check dev commands**

Run and compare the listed commands against what actually exists in `package.json` files:

```bash
cat protocol/package.json | grep '"scripts"' -A 30
cat package.json | grep '"scripts"' -A 20
```

Update any commands that have changed or add any new ones that are missing (e.g., `worktree:*` commands).

- [ ] **Step 4: Check troubleshooting section**

Verify the listed fixes are still accurate and relevant.

- [ ] **Step 5: Update frontmatter and commit (if changes made)**

Update `updated` to `2026-04-06`.

```bash
git add docs/guides/getting-started.md
git commit -m "docs: update getting started guide"
```

---

### Task 5: Audit and update `docs/specs/`

**Files:**
- Modify (if needed): `docs/specs/api-reference.md`
- Modify (if needed): `docs/specs/cli-v1.md`
- Modify (if needed): `docs/specs/cli-conversation.md`
- Modify (if needed): `docs/specs/cli-intent-command.md`
- Modify (if needed): `docs/specs/cli-network.md`
- Modify (if needed): `docs/specs/cli-npm-publish.md`
- Modify (if needed): `docs/specs/cli-opportunity.md`
- Modify (if needed): `docs/specs/cli-profile.md`
- Modify (if needed): `docs/specs/user-index-keys.md`
- Modify (if needed): `docs/specs/webhooks.md`
- Modify (if needed): `docs/specs/introducer-discovery.md`
- Modify (if needed): `docs/specs/feed-maintenance-reintegration.md`

- [ ] **Step 1: Audit the API reference against actual controllers**

```bash
ls protocol/src/controllers/
```

Then read `docs/specs/api-reference.md` in full. For each controller section, verify:
- The endpoint paths exist in the actual controller file
- HTTP methods are correct
- Request/response shapes are still accurate

Check that the `AuthGuard` description is accurate — it should use Better Auth sessions, not JWT. Read:

```bash
cat protocol/src/guards/auth.guard.ts
```

Update any endpoints that have been added, removed, or changed. The authentication description must match the actual guard implementation.

- [ ] **Step 2: Audit CLI specs against actual CLI source**

```bash
ls cli/src/
cat cli/src/main.ts
```

Read each `cli-*.md` spec and verify commands, flags, and output shapes against the implementation. Focus on:
- Command names and sub-commands still exist
- Flag names haven't changed
- Output format descriptions are still accurate

- [ ] **Step 3: Audit feature specs**

Read and check each feature spec file against the codebase:

- `user-index-keys.md` — check against `protocol/src/schemas/database.schema.ts` for the `key` field on indexes
- `webhooks.md` — check if webhook infrastructure exists in `protocol/src/`
- `introducer-discovery.md` — check if the described feature is implemented or still aspirational
- `feed-maintenance-reintegration.md` — check against the maintenance graph and feed logic

For specs describing features not yet fully implemented, add a `> **Status:** Draft / Aspirational` note at the top rather than removing them.

- [ ] **Step 4: Update frontmatter and commit**

Update `updated` to `2026-04-06` on every file changed.

```bash
git add docs/specs/
git commit -m "docs: update API and CLI specs for accuracy"
```

---

## Phase 2 wrap-up

### Task 6: Final verification

- [ ] **Step 1: Check for any remaining old path references**

```bash
grep -r "src/lib/protocol" docs/
grep -r "protocol/ARCHITECTURE" docs/
grep -r "protocol/plans" docs/
grep -r "\.archive" docs/
```

Expected: no matches.

- [ ] **Step 2: Verify docs/ structure is clean**

```bash
find docs/ -name "*.md" | sort
```

Expected output (only canonical docs remain):
```
docs/domain/feed-and-maintenance.md
docs/domain/hyde.md
docs/domain/indexes.md
docs/domain/intents.md
docs/domain/negotiation.md
docs/domain/opportunities.md
docs/domain/profiles.md
docs/design/architecture-overview.md
docs/design/protocol-deep-dive.md
docs/guides/getting-started.md
docs/plans/2026-03-31-landing-manifesto-promo-design.md
docs/plans/2026-03-31-landing-manifesto-promo.md
docs/specs/api-reference.md
docs/specs/cli-conversation.md
docs/specs/cli-intent-command.md
docs/specs/cli-network.md
docs/specs/cli-npm-publish.md
docs/specs/cli-opportunity.md
docs/specs/cli-profile.md
docs/specs/cli-v1.md
docs/specs/feed-maintenance-reintegration.md
docs/specs/introducer-discovery.md
docs/specs/user-index-keys.md
docs/specs/webhooks.md
docs/superpowers/plans/2026-04-06-docs-cleanup.md
docs/superpowers/plans/2026-04-06-packages-reorganization.md
docs/superpowers/specs/2026-04-06-docs-cleanup-design.md
docs/superpowers/specs/2026-04-06-packages-reorganization-design.md
```
