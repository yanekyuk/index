---
name: update-pr
description: Create and update pull requests with GitHub CLI (gh) into upstream/dev, using changelog-style descriptions. Use when the user asks to create a PR, update a PR, open a pull request, or refresh PR title, body, or status (draft/ready/close/reopen).
---

# Creating and Updating PRs

## Creating a PR

1. **Target**: Open the PR into `upstream/dev` using the GitHub CLI (`gh`).
2. **Describe from commits**: On the branch, inspect commits (e.g. `git log upstream/dev..HEAD --oneline` or `gh pr view` for an existing branch) to build the description.
3. **Changelog-style body**: Write the PR description as a changelog, grouping changes into:
   - **New Features**
   - **Bug Fixes**
   - **Refactors**
   - **Documentation**
   - **Tests**
   Include only sections that apply; omit empty ones.

**Commands:**

```bash
# Inspect commits on current branch vs upstream/dev
git log upstream/dev..HEAD --oneline

# Create PR (replace <owner>/<repo> with actual upstream, e.g. from git remote)
gh pr create --base dev --repo <owner>/<repo> --title "feat(scope): short description" --body "..."
```

**Body template:**

```markdown
## New Features
- Bullet per feature

## Bug Fixes
- Bullet per fix

## Refactors
- Bullet per refactor

## Documentation
- Bullet per doc change

## Tests
- Bullet per test change
```

---

## Updating a PR

1. **Locate the PR**: Use `gh pr list` or `gh pr view` (when on the branch) to find the PR.
2. **Update content**: Refresh title, body, or both from:
   - Current commits on the branch (`git log upstream/dev..HEAD --oneline`), or
   - Explicit user instructions.
3. **Changelog-style**: Keep the description in changelog form (same sections as above).
4. **Status** (when requested):
   - Mark ready for review: `gh pr ready <number>`
   - Mark as draft: `gh pr edit <number> --draft`
   - Close: `gh pr close <number>`
   - Reopen: `gh pr reopen <number>`

**Commands:**

```bash
# Edit title and/or body
gh pr edit <number> --title "feat(scope): new title" --body "$(cat pr-body.md)"

# Status
gh pr ready <number>
gh pr edit <number> --draft
gh pr close <number>
gh pr reopen <number>
```

---

## Examples

**Create PR from branch:**

```bash
gh pr create --base dev --repo owner/repo --title "feat(chat): render opportunity cards in message stream" --body "## New Features
- Render opportunity cards inline in chat message stream

## Bug Fixes
- Fix scroll position when new messages load"
```

**Update existing PR:**

```bash
gh pr edit 42 --title "feat(chat): opportunity cards in stream" --body "$(cat pr-body.md)"
gh pr ready 42
```
