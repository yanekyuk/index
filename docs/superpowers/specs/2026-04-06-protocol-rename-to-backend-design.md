# Rename `protocol/` directory to `backend/`

## Summary

Rename the main backend workspace directory from `protocol/` to `backend/` for clarity. The name "protocol" is ambiguous — it also refers to the `@indexnetwork/protocol` npm package at `packages/protocol/`. Renaming the directory to `backend/` removes this ambiguity.

`packages/protocol/` and all `@indexnetwork/protocol` references are untouched.

## Changes

### Directory

- `protocol/` → `backend/`

### Root `package.json`

Script names and bodies:

| Before | After |
|---|---|
| `dev:protocol` | `dev:backend` |
| `build:protocol` | `build:backend` |
| `start:protocol` | `start:backend` |
| `cd protocol && ...` | `cd backend && ...` |
| lint-staged key `protocol/src/**/*.ts` | `backend/src/**/*.ts` |

### Scripts

| File | Change |
|---|---|
| `scripts/dev.sh` | `dev:protocol` ref → `dev:backend`; workspace list entry `protocol` → `backend` |
| `scripts/worktree-dev.sh` | workspace loop entry `protocol` → `backend` |
| `scripts/worktree-list.sh` | workspace loop entry `protocol` → `backend` |
| `scripts/worktree-setup.sh` | `WORKSPACES` array entry `protocol` → `backend` |
| `scripts/check-adapter-names.sh` | `ADAPTER_DIR` path `protocol/src/adapters` → `backend/src/adapters` |

### Documentation

- `CLAUDE.md`: directory path references only (e.g. `cd protocol`, `protocol/src/`, `protocol/tests/`)
- `docs/` files: directory path references only; conceptual uses of "protocol" left unchanged

## What Does NOT Change

- `packages/protocol/` and all contents
- All `@indexnetwork/protocol` package references
- Conceptual uses of "the protocol" in docs
- `scripts/hooks/pre-push` subtree entry for `packages/protocol`
- All code inside the backend (no internal imports reference the directory name)
