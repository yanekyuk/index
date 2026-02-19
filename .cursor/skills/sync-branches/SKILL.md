---
name: sync-branches
description: Detects branches merged into upstream/dev (and optionally closed PR branches), then deletes them from local and origin. Use when the user asks to sync branches, clean up branches, delete merged branches, remove stale branches, or prune local and origin after PRs are merged or closed.
---

# Syncing Branches (Local + Origin)

Assumes workflow: create branch locally → push to **origin** → open PR from that branch to **upstream/dev**. After merge (or close), remove the branch from both local and origin.

## Prerequisites

- Remotes: **origin** (your push target), **upstream** (PR target; base branch `upstream/dev`)
- Ensure `upstream` is configured: `git remote -v` should show `upstream` pointing at the main repo

## Workflow

### 1. Fetch latest refs

```bash
git fetch upstream
git fetch origin
```

### 2. Find branches to remove

**Merged into upstream/dev** (safe to delete):

```bash
git branch --merged upstream/dev
```

Exclude: current branch (`git branch --show-current`), and protected names (`main`, `master`, `dev`). Only delete branches that are **merged** into `upstream/dev`.

**Optional — closed PRs:** To also remove branches whose PRs were closed (not merged), list closed PR branches and intersect with local branches. Example:

```bash
gh pr list --state closed --author "@me" --json headRefName -q '.[].headRefName'
```

Use that list only for branches that exist locally and that the user wants to delete (e.g. closed without merge).

### 3. Delete locally

For each branch to remove (do not delete the branch you are on):

```bash
git checkout dev   # or another branch you want to keep current
git branch -d <branch>   # safe delete (only if merged)
# or git branch -D <branch>  # force delete (e.g. for closed-only branches)
```

### 4. Delete on origin

For each same branch name:

```bash
git push origin --delete <branch>
```

## Safety

- **Do not** delete the current branch; switch to `dev` or `main` first.
- **Do not** delete `main`, `master`, or `dev` unless the user explicitly asks.
- Prefer `git branch -d` (merged only); use `-D` only when intentionally removing unmerged/closed branches.
- Before running `git push origin --delete`, confirm the branch list with the user if many branches or ambiguous names.

## One-shot cleanup (merged only)

Example sequence the agent can run (after fetching and resolving current branch):

```bash
git fetch upstream && git fetch origin
CURRENT=$(git branch --show-current)
for b in $(git branch --merged upstream/dev); do
  b=$(echo "$b" | tr -d ' *')
  if [ "$b" = "$CURRENT" ] || [ "$b" = "main" ] || [ "$b" = "master" ] || [ "$b" = "dev" ]; then continue; fi
  git branch -d "$b" 2>/dev/null && git push origin --delete "$b" 2>/dev/null
done
```

User can request "sync branches" or "clean up merged branches"; run fetch, then either list candidates for confirmation or run the one-shot loop and report what was deleted.
