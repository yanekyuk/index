---
name: commit-changes
description: Commits changes modularly with descriptive messages following the Conventional Commits specification. Analyzes git diff to plan logical staging, then stages and commits in chunks with proper type/scope/description. Use when the user asks to commit changes, stage and commit, write commit messages, or follow conventional commits.
---

# Modular Conventional Commits

## Workflow

### 1. Analyze changes

- Run `git status` and `git diff` (and `git diff --staged` if anything is already staged) to see what changed.
- Identify logical units: separate features, fixes, refactors, docs, or unrelated edits.
- Decide how many commits to make and which files/hunks belong together.

### 2. Stage and commit modularly

- Stage in logical chunks:
  - By path: `git add <path>` for whole files that form one logical change.
  - By hunk: `git add -p` to stage only selected hunks when a file mixes multiple concerns.
- After each staged set, commit with a Conventional Commits message (see format below).
- Repeat until all changes are committed.

## Conventional Commits format

```
<type>[optional scope]: <description>

[optional body]

[optional footer]
```

- **type** (required): `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, or `chore`. Use `feat` for new features, `fix` for bug fixes.
- **scope** (optional): Noun in parentheses, e.g. `feat(parser):`, `fix(auth):`.
- **description** (required): Short summary after the colon and space. Imperative mood, lowercase start, no period at end.
- **body** (optional): Extra context; one blank line after the description.
- **footer** (optional): Meta info (e.g. `BREAKING CHANGE:`, `closes #12`). One item per line.

**Breaking changes**: In body or footer add a line starting with `BREAKING CHANGE: ` (uppercase). Optionally append `!` after type/scope (e.g. `feat!: new API`).

**Subject line**: Keep under ~72 characters; put detail in the body if needed.

## Examples

```
feat(chat): add opportunity cards in message stream
```

```
fix(auth): correct redirect after login when origin not allowed
```

```
docs: correct spelling of CHANGELOG
```

```
refactor(intent): extract inferrer into protocol layer

BREAKING CHANGE: intent inferrer is now imported from lib/protocol
```

```
fix: correct minor typos in code

closes #12
```

```
feat: allow provided config object to extend other configs

BREAKING CHANGE: `extends` key in config file is now used for extending other config files
```

## Checklist

- Prefer multiple small commits over one large commit when changes span unrelated concerns.
- Use the most accurate type; if in doubt, use `chore` or `refactor` rather than `feat`/`fix`.
- One commit per logical change; if a commit would need "and" in the description, consider splitting.
