#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREES_DIR="$REPO_ROOT/.worktrees"
WORKSPACES=("protocol" "frontend" "evaluator")

if [ -z "${1:-}" ]; then
  echo "Usage: bun run worktree:setup <worktree-name>"
  echo ""
  echo "Available worktrees:"
  ls -1 "$WORKTREES_DIR" 2>/dev/null || echo "  (none)"
  exit 1
fi

WORKTREE="$WORKTREES_DIR/$1"

if [ ! -d "$WORKTREE" ]; then
  echo "Error: worktree '$1' not found at $WORKTREE"
  echo ""
  echo "Available worktrees:"
  ls -1 "$WORKTREES_DIR" 2>/dev/null || echo "  (none)"
  exit 1
fi

echo "Setting up worktree: $1"
echo ""

for ws in "${WORKSPACES[@]}"; do
  ws_src="$REPO_ROOT/$ws"
  ws_dst="$WORKTREE/$ws"

  if [ ! -d "$ws_dst" ]; then
    echo "  [$ws] skipped (not present in worktree)"
    continue
  fi

  # Symlink node_modules
  if [ -L "$ws_dst/node_modules" ]; then
    echo "  [$ws] node_modules already linked"
  elif [ -d "$ws_src/node_modules" ]; then
    ln -s "$ws_src/node_modules" "$ws_dst/node_modules"
    echo "  [$ws] node_modules -> linked"
  else
    echo "  [$ws] node_modules -> warning: source not found (run bun install first)"
  fi

  # Symlink .env* files (excluding .env.example)
  for env_file in "$ws_src"/.env*; do
    [ -e "$env_file" ] || continue
    basename="$(basename "$env_file")"
    [ "$basename" = ".env.example" ] && continue

    if [ -L "$ws_dst/$basename" ]; then
      echo "  [$ws] $basename already linked"
    else
      ln -s "$env_file" "$ws_dst/$basename"
      echo "  [$ws] $basename -> linked"
    fi
  done
done

echo ""
echo "Done. Worktree '$1' is ready."
