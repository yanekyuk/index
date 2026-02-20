---
name: create-branch
description: Detects working tree changes via git status and git diff, proposes a branch name from those changes, and creates the branch following the Conventional Branch spec. Use when the user asks to create a branch, name a branch, new branch, branch off, switch to a new branch, run git checkout -b, or start work from current changes; or when the user implies they are about to create or name a new git branch.
---

# Creating Branches

When creating branches, follow this workflow and naming spec.

## Workflow

1. **Detect changes** — Run `git status` and/or `git diff` to see what is modified, added, or removed.
2. **Propose a name** — From the changes, derive a short, explanatory branch name that matches the Conventional Branch format below.
3. **Create the branch** — Use the chosen name with `git checkout -b <name>` (or equivalent).

## Conventional Branch Specification

**Purpose:** Structured naming so branch purpose is clear, CI/CD can use it, and the team stays consistent.

### Branch types

| Type | Purpose | Examples |
|------|---------|----------|
| `main` | Primary development branch | `main`, `master`, `dev` |
| `feature/` or `feat/` | New features | `feature/add-login-page`, `feat/opportunity-cards-in-chat` |
| `bugfix/` or `fix/` | Bug corrections | `bugfix/fix-header-bug`, `fix/login-redirect-loop` |
| `hotfix/` | Urgent production fixes | `hotfix/security-patch` |
| `release/` | Release preparation | `release/v1.2.0` |
| `chore/` | Non-code updates | `chore/update-dependencies` |

### Naming rules

1. **Characters** — Lowercase letters, numbers, and hyphens only; dots allowed in version numbers (e.g. `release/v1.2.0`).
2. **No bad patterns** — No consecutive, leading, or trailing hyphens or dots.
3. **Clarity and brevity** — Descriptive but short (e.g. `feat/oauth-login` not `feat/add-oauth-based-authentication-flow`).
4. **Tickets** — Include issue/ticket ID when applicable (e.g. `feature/issue-123-add-login`).

### Examples by change type

- Chat UI and opportunity cards → `feat/render-opportunity-cards-in-chat`
- Login redirect loop fix → `fix/login-redirect-loop`
- Dependency bumps only → `chore/update-dependencies`
- Security patch for production → `hotfix/security-patch`
- Preparing v1.2.0 → `release/v1.2.0`

## Checklist

- [ ] Ran `git status` and/or `git diff` to see changes
- [ ] Chose type from table (`feat/`, `fix/`, `chore/`, etc.)
- [ ] Name is lowercase, hyphenated, no bad patterns
- [ ] Created branch with `git checkout -b <name>`
