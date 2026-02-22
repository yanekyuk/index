# Worktree Setup Script Design

**Date:** 2026-02-22
**Status:** Approved

## Problem

Git worktrees created under `.worktrees/` are missing gitignored files (`node_modules/`, `.env*`), making them unusable without manual setup.

## Solution

A shell script that symlinks gitignored files from the main repo into a worktree. Two commands exposed via `package.json`:

- `bun run worktree:setup <name>` — symlink node_modules and .env files into a worktree
- `bun run worktree:list` — list available worktrees with setup status

## Design

### `scripts/worktree-setup.sh`

Given a worktree name:

1. Validate `.worktrees/<name>` exists
2. For each workspace (`protocol`, `frontend`, `evaluator`):
   - Symlink `node_modules/` from main repo into worktree
   - Auto-discover and symlink `.env*` files (excluding `.env.example`) from main repo into worktree
3. Print summary of what was linked

### `scripts/worktree-list.sh`

Lists all directories under `.worktrees/` and shows whether each has been set up (i.e., has node_modules symlinks).

### Edge cases

- Already-existing symlinks: skip (idempotent)
- Missing worktree: error with message
- Missing source node_modules: warn but continue
- Missing workspace in worktree: skip with warning

### Changes

1. New file: `scripts/worktree-setup.sh`
2. New file: `scripts/worktree-list.sh`
3. Edit: `package.json` — add `worktree:setup` and `worktree:list` scripts

### Decisions

- **Symlinks over copies** for both node_modules and .env files (shared state, instant)
- **Shell script over TypeScript** (simple, no build step, ~30 lines)
- **Auto-discover .env files** rather than hardcoding names (future-proof)
- **All three workspaces** (protocol, frontend, evaluator) are set up
