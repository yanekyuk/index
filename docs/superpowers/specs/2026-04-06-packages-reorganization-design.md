# Packages Reorganization Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move `cli/` and `plugin/` into the `packages/` directory so all publishable/distributable units live under one consistent location.

**Architecture:** `cli/` is moved with `git mv` (history preserved via rename detection). `plugin/` is re-grafted as a git subtree under `packages/claude-plugin/` using split + add. The root workspace glob `packages/*` already covers both new locations with no change needed.

**Tech Stack:** git subtree, Bun workspaces, GitHub Actions

---

## 1. Target Directory Structure

```
index/
├── packages/
│   ├── protocol/          # @indexnetwork/protocol (existing, unchanged)
│   ├── cli/               # @indexnetwork/cli (moved from cli/)
│   │   ├── src/
│   │   ├── npm/           # platform sub-packages (unchanged)
│   │   ├── scripts/
│   │   ├── bin/
│   │   └── package.json   # unchanged — name, version, bin all stay the same
│   └── claude-plugin/     # git subtree → indexnetwork/claude-plugin (moved from plugin/)
│       ├── skills/
│       ├── README.md
│       └── package.json   # NEW: private: true, not published to NPM
├── protocol/              # backend app (unchanged)
├── frontend/              # (unchanged)
└── ...
```

Root `package.json` workspaces is already `["packages/*"]` — no change needed.

---

## 2. Git Operations

### CLI move
```bash
git mv cli packages/cli
git commit -m "chore: move cli/ to packages/cli"
```
Git rename detection preserves history.

### Plugin re-graft
Three steps, two commits:

```bash
# Step 1: Extract plugin/ subtree into a temporary branch
git subtree split --prefix=plugin -b temp/plugin-split

# Step 2: Remove old plugin/ directory
git rm -r plugin/
git commit -m "chore: remove plugin/ before re-grafting as packages/claude-plugin"

# Step 3: Add subtree back at new prefix
git subtree add --prefix=packages/claude-plugin temp/plugin-split
git branch -d temp/plugin-split
```

After this, `packages/claude-plugin/` is the live subtree. Future manual operations:
```bash
# Push to indexnetwork/claude-plugin (normally automatic via pre-push hook; use dev or main)
git subtree push --prefix=packages/claude-plugin https://github.com/indexnetwork/claude-plugin.git <branch>

# Pull if upstream was edited directly (avoid — always edit via this repo)
git subtree pull --squash --prefix=packages/claude-plugin https://github.com/indexnetwork/claude-plugin.git <branch>
```

---

## 3. New File: `packages/claude-plugin/package.json`

```json
{
  "name": "claude-plugin",
  "version": "1.0.0",
  "private": true
}
```

Not published to NPM. Just identifies the directory as a monorepo workspace member.

---

## 4. Files to Update

### `.github/workflows/publish-cli.yml`
All occurrences of `working-directory: cli` → `working-directory: packages/cli`.

### `scripts/hooks/pre-push`
Two changes:
- Path check: `plugin/` → `packages/claude-plugin/`
- Subtree push prefix: `--prefix=plugin` → `--prefix=packages/claude-plugin`

Current behavior:
- Detect pushes to the canonical `indexnetwork/index` repo by remote URL, not remote name
- Mirror monorepo `dev` → subtree `dev`
- Mirror monorepo `main` → subtree `main`

### `CLAUDE.md`
- Monorepo structure diagram: move `cli/` under `packages/`, rename `plugin/` to `claude-plugin/` under `packages/`
- CLI commands section: update path references from `cd cli` to `cd packages/cli`
- Plugin subtree section: update prefix in all commands and path references

---

## 5. What Does NOT Change

- `packages/cli/package.json` — name (`@indexnetwork/cli`), version, bin, scripts, optionalDependencies all unchanged
- `packages/cli/npm/` — platform sub-packages directory structure unchanged
- The upstream `indexnetwork/claude-plugin` remote and its history
- `scripts/worktree-setup.sh` — cli and claude-plugin don't need env symlinks
- Any published NPM package URLs or install instructions
