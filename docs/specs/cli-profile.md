---
title: "CLI profile command"
type: spec
tags: [cli, profile, user]
created: 2026-03-30
updated: 2026-03-30
---

## Behavior

The `index profile` command lets users view profiles and trigger profile regeneration from the terminal.

### `index profile` (no args)

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Call `GET /api/auth/me` to get the current user's ID.
3. Call `GET /api/users/:userId` to get the full profile.
4. Render a styled profile card showing: name, intro/bio, location, socials, ghost status, and member-since date.

### `index profile show <user-id>`

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Call `GET /api/users/:userId` directly with the provided user ID.
3. Render the same styled profile card.

### `index profile sync`

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Call `POST /api/profiles/sync` to trigger profile regeneration.
3. Print a success confirmation message.

## Constraints

- The CLI must not import protocol internals. All data comes via HTTP.
- Auth tokens are loaded from `~/.index/credentials.json` (existing pattern).
- 401 responses produce "Session expired. Run `index login` again."
- Network errors produce a clear error message.
- The profile card must gracefully handle missing fields (null name, no socials, ghost users).
- No external CLI framework dependency -- uses the existing `parseArgs` system.

## Acceptance Criteria

1. `index profile` displays the current user's profile card.
2. `index profile show <user-id>` displays another user's profile card.
3. `index profile sync` triggers regeneration and prints confirmation.
4. Missing/null fields are handled gracefully (show placeholder or omit).
5. Ghost users are indicated in the profile card.
6. 401 responses trigger the standard "Session expired" message.
7. Network errors produce a clear error message.
8. Unit tests cover: argument parsing for profile subcommands, API client methods, profile card rendering.
