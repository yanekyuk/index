#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREES_DIR="$REPO_ROOT/.worktrees"

if [ -z "${1:-}" ]; then
  # No argument: build at root (main tree)
  echo "Building at root..."
  cd "$REPO_ROOT"
  bun run build
  exit 0
fi

# Argument: build in the named worktree
WORKTREE="$WORKTREES_DIR/$1"
if [ ! -d "$WORKTREE" ]; then
  echo "Error: worktree '$1' not found at $WORKTREE"
  echo ""
  echo "Available worktrees:"
  bash "$REPO_ROOT/scripts/worktree-list.sh"
  exit 1
fi

echo "Building worktree: $1"
echo "Working directory: $WORKTREE"
echo ""
cd "$WORKTREE"
bun run build
