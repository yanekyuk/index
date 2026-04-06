# Rename `protocol/` to `backend/` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `protocol/` workspace directory to `backend/` and update all references throughout the monorepo.

**Architecture:** Pure rename — no code logic changes. The directory is moved with `git mv`, then all path and script-name references are updated in config files, shell scripts, and documentation.

**Tech Stack:** Bun, bash, git

---

## File Map

| File | Change |
|---|---|
| `protocol/` | Renamed to `backend/` |
| `package.json` | Script names + bodies + lint-staged key |
| `scripts/dev.sh` | Script ref + workspace loop |
| `scripts/worktree-dev.sh` | Workspace loop |
| `scripts/worktree-list.sh` | Workspace loop |
| `scripts/worktree-setup.sh` | `WORKSPACES` array |
| `scripts/check-adapter-names.sh` | `ADAPTER_DIR` path |
| `.gitignore` | Two path entries |
| `CLAUDE.md` | Directory path references |
| `docs/design/architecture-overview.md` | Directory path reference |
| `docs/guides/getting-started.md` | Directory path references |

---

### Task 1: Rename the directory

**Files:**
- Rename: `protocol/` → `backend/`

- [ ] **Step 1: Rename with git mv**

```bash
git mv protocol backend
```

- [ ] **Step 2: Verify**

```bash
ls | grep backend
# Expected: backend
ls | grep "^protocol$"
# Expected: no output
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename protocol/ directory to backend/"
```

---

### Task 2: Update root `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update script names and bodies**

Replace the entire `"scripts"` block. Open `package.json` and apply these changes:

| Before | After |
|---|---|
| `"dev:protocol": "cd protocol && bun run dev"` | `"dev:backend": "cd backend && bun run dev"` |
| `"build": "bun run build:protocol && bun run build:frontend"` | `"build": "bun run build:backend && bun run build:frontend"` |
| `"build:protocol": "cd protocol && bun install && bun run build"` | `"build:backend": "cd backend && bun install && bun run build"` |
| `"start": "bun run start:protocol & bun run start:frontend"` | `"start": "bun run start:backend & bun run start:frontend"` |
| `"start:protocol": "cd protocol && bun run start"` | `"start:backend": "cd backend && bun run start"` |
| `"lint": "cd frontend && bun run lint && cd ../protocol && bun run lint"` | `"lint": "cd frontend && bun run lint && cd ../backend && bun run lint"` |
| `"test": "cd protocol && bun test"` | `"test": "cd backend && bun test"` |

- [ ] **Step 2: Update lint-staged key**

In the `"lint-staged"` section, change the key:

```json
"backend/src/**/*.ts": "bash -c 'cd backend && bunx eslint --no-warn-ignored \"$@\"' --"
```

(was `"protocol/src/**/*.ts": "bash -c 'cd protocol && ..."`)

- [ ] **Step 3: Verify**

```bash
grep "protocol" package.json
# Expected: no output (no remaining protocol/ path references)
```

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "refactor: update root package.json scripts for backend/ rename"
```

---

### Task 3: Update shell scripts

**Files:**
- Modify: `scripts/dev.sh`
- Modify: `scripts/worktree-dev.sh`
- Modify: `scripts/worktree-list.sh`
- Modify: `scripts/worktree-setup.sh`
- Modify: `scripts/check-adapter-names.sh`

- [ ] **Step 1: Update `scripts/dev.sh`**

Two changes:

1. `bun run dev:protocol &` → `bun run dev:backend &`
2. `for ws in protocol frontend evaluator` → `for ws in backend frontend evaluator`

- [ ] **Step 2: Update `scripts/worktree-dev.sh`**

Change the `has_node_modules` check loop from:
```bash
for ws in protocol frontend; do
```
to:
```bash
for ws in backend frontend; do
```

- [ ] **Step 3: Update `scripts/worktree-list.sh`**

Change the setup-check loop from:
```bash
for ws in protocol frontend evaluator; do
```
to:
```bash
for ws in backend frontend evaluator; do
```

- [ ] **Step 4: Update `scripts/worktree-setup.sh`**

Change:
```bash
WORKSPACES=("protocol" "frontend")
```
to:
```bash
WORKSPACES=("backend" "frontend")
```

- [ ] **Step 5: Update `scripts/check-adapter-names.sh`**

Change:
```bash
ADAPTER_DIR="protocol/src/adapters"
```
to:
```bash
ADAPTER_DIR="backend/src/adapters"
```

- [ ] **Step 6: Verify**

```bash
grep -r "protocol" scripts/ --include="*.sh"
# Expected: no output
```

- [ ] **Step 7: Commit**

```bash
git add scripts/
git commit -m "refactor: update shell scripts for backend/ rename"
```

---

### Task 4: Update `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Update paths**

Change:
```
protocol/temp-uploads/
protocol/.xmtp/
```
to:
```
backend/temp-uploads/
backend/.xmtp/
```

- [ ] **Step 2: Verify**

```bash
grep "protocol" .gitignore
# Expected: no output (only packages/protocol subtree refs are absent from .gitignore)
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "refactor: update .gitignore paths for backend/ rename"
```

---

### Task 5: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace all `protocol/` path references**

Apply these replacements (directory paths only — do NOT change section headings like "Protocol (Backend)" or references to `packages/protocol/` or `@indexnetwork/protocol`):

| Before | After |
|---|---|
| `cd protocol` | `cd backend` |
| `protocol/src/` | `backend/src/` |
| `protocol/tests/` | `backend/tests/` |
| `protocol/drizzle/` | `backend/drizzle/` |
| `protocol/env.example` | `backend/env.example` |
| `protocol/.env` | `backend/.env` |
| `├── protocol/` | `├── backend/` |

- [ ] **Step 2: Verify no stray references remain**

```bash
grep -n "protocol/" CLAUDE.md | grep -v "packages/protocol" | grep -v "@indexnetwork/protocol"
# Expected: no output
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md directory paths for backend/ rename"
```

---

### Task 6: Update docs

**Files:**
- Modify: `docs/design/architecture-overview.md`
- Modify: `docs/guides/getting-started.md`

- [ ] **Step 1: Update `docs/design/architecture-overview.md`**

Change line 23:
```
  protocol/          Backend API and Agent Engine (Bun, Express, TypeScript)
```
to:
```
  backend/           Backend API and Agent Engine (Bun, Express, TypeScript)
```

Change line 435:
```
The canonical schema lives in `protocol/src/schemas/database.schema.ts`.
```
to:
```
The canonical schema lives in `backend/src/schemas/database.schema.ts`.
```

- [ ] **Step 2: Update `docs/guides/getting-started.md`**

Apply these replacements throughout the file:

| Before | After |
|---|---|
| `├── protocol/` | `├── backend/` |
| `cp protocol/.env.example protocol/.env` | `cp backend/.env.example backend/.env` |
| `protocol/.env` | `backend/.env` |
| `protocol/drizzle/` | `backend/drizzle/` |

- [ ] **Step 3: Verify**

```bash
grep -n "protocol/" docs/design/architecture-overview.md docs/guides/getting-started.md | grep -v "packages/protocol" | grep -v "@indexnetwork/protocol"
# Expected: no output
```

- [ ] **Step 4: Commit**

```bash
git add docs/design/architecture-overview.md docs/guides/getting-started.md
git commit -m "docs: update directory paths in docs for backend/ rename"
```

---

### Task 7: Final verification

- [ ] **Step 1: Check for any remaining stray references**

```bash
grep -rn "\"cd protocol\"\|'cd protocol'\| cd protocol\b" . \
  --include="*.json" --include="*.sh" --include="*.md" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  | grep -v "packages/protocol" | grep -v "@indexnetwork/protocol"
# Expected: no output
```

- [ ] **Step 2: Verify backend directory is intact**

```bash
ls backend/src/
# Expected: controllers/, services/, adapters/, schemas/, etc.
```

- [ ] **Step 3: Verify bun install still works**

```bash
bun install
# Expected: no errors
```

- [ ] **Step 4: Verify backend dev server starts**

```bash
cd backend && bun run dev
# Expected: server starts on port 3001, no module-not-found errors
# Ctrl+C to stop after confirming startup
```
