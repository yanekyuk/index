---
title: "CLI intent command — list, show, create, archive"
type: spec
tags: [cli, intent, signal, api]
created: 2026-03-30
updated: 2026-03-30
---

## Behavior

The `index intent` command exposes four subcommands for managing intents (user-facing: "signals") from the CLI.

### `index intent list`

1. Calls `POST /api/intents/list` with optional pagination/filter body.
2. Renders a table with columns: description (truncated to 50 chars), confidence, source type, status, created date.
3. Flags: `--archived` includes archived intents, `--limit <n>` sets page size (default 20).

### `index intent show <id>`

1. Calls `GET /api/intents/:id`.
2. Renders a detailed card with: full description (payload), summary, confidence, source type, status, intent mode, speech act type, timestamps (created, updated, archived), and index assignments if present in the response.

### `index intent create <content>`

1. Calls `POST /api/intents/process` with `{ content }`.
2. Prints the processing result summary.
3. Content is the remaining positional arguments joined with spaces.

### `index intent archive <id>`

1. Calls `PATCH /api/intents/:id/archive`.
2. Prints confirmation message on success, error on failure.

## Constraints

- The CLI is a pure HTTP client. No protocol internals may be imported.
- User-facing copy uses "signal" (per IND-144). Internal code uses "intent" for variable names, API paths, and types.
- Auth tokens are loaded from `~/.index/credentials.json` via the existing `CredentialStore`.
- 401 responses produce "Session expired. Run `index login` to re-authenticate."
- No external CLI framework — argument parsing uses the existing hand-rolled parser in `args.parser.ts`.

## Acceptance Criteria

1. `index intent list` displays a formatted table of the user's active signals.
2. `index intent list --archived` includes archived signals in the listing.
3. `index intent list --limit 5` limits results to 5 items.
4. `index intent show <id>` displays full signal details in a card format.
5. `index intent show <nonexistent>` prints a "not found" error.
6. `index intent create "Looking for a technical co-founder"` processes the content and prints a result.
7. `index intent archive <id>` archives the signal and prints confirmation.
8. All subcommands exit with code 1 and a helpful message when not authenticated.
9. `index intent` (no subcommand) prints usage help for the intent command.
10. Unit tests cover: argument parsing for intent subcommands, API client methods, output formatting.
