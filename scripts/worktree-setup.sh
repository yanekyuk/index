#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREES_DIR="$REPO_ROOT/.worktrees"
INSTALL_WORKSPACES=("backend" "frontend")
ENV_WORKSPACES=("backend" "frontend" "packages/protocol" "packages/cli")

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

for ws in "${ENV_WORKSPACES[@]}"; do
  ws_src="$REPO_ROOT/$ws"
  ws_dst="$WORKTREE/$ws"

  if [ ! -d "$ws_dst" ]; then
    echo "  [$ws] skipped (not present in worktree)"
    continue
  fi

  should_install=false
  for install_ws in "${INSTALL_WORKSPACES[@]}"; do
    if [ "$ws" = "$install_ws" ]; then
      should_install=true
      break
    fi
  done

  # Install node_modules only for app workspaces.
  if [ "$should_install" = true ]; then
    if [ -d "$ws_dst/node_modules" ]; then
      echo "  [$ws] node_modules already installed"
    else
      echo "  [$ws] node_modules -> installing..."
      (cd "$ws_dst" && bun install --frozen-lockfile 2>&1 | tail -1)
    fi
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

# Symlink .claude/settings.local.json (gitignored, not present in worktrees)
CLAUDE_SRC="$REPO_ROOT/.claude/settings.local.json"
CLAUDE_DST="$WORKTREE/.claude/settings.local.json"
if [ -f "$CLAUDE_SRC" ]; then
  if [ -L "$CLAUDE_DST" ]; then
    echo "  [.claude] settings.local.json already linked"
  elif [ -f "$CLAUDE_DST" ]; then
    echo "  [.claude] settings.local.json exists (not a symlink, skipping)"
  else
    mkdir -p "$WORKTREE/.claude"
    ln -s "$CLAUDE_SRC" "$CLAUDE_DST"
    echo "  [.claude] settings.local.json -> linked"
  fi
fi

# Configure git hooks path (points to committed scripts/hooks/)
git -C "$WORKTREE" config core.hooksPath "$REPO_ROOT/scripts/hooks"
echo "  [git] hooksPath -> scripts/hooks"

echo ""
echo "Done. Worktree '$1' is ready."
