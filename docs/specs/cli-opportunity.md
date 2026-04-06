---
title: "CLI opportunity command"
type: spec
tags: [cli, opportunities, valency]
created: 2026-03-30
updated: 2026-04-06
---

## Behavior

The `index opportunity` command exposes subcommands for managing opportunities from the terminal. The CLI is a pure HTTP client — no protocol internals are imported.

### `index opportunity list`

1. Reads credentials from `~/.index/credentials.json`. Exits with error if not logged in.
2. Calls `GET /api/opportunities` with optional query params (`status`, `limit`).
3. Renders a table with columns: counterparty name, category, status, confidence, createdAt.
4. Supports `--status <pending|accepted|rejected|expired>` filter and `--limit <n>`.

### `index opportunity show <id>`

1. Reads credentials. Exits with error if not logged in.
2. Calls `GET /api/opportunities/:id` which returns the opportunity with LLM-generated presentation.
3. Renders a detailed card with:
   - Parties: names and valency roles displayed as human-readable labels (agent = Helper, patient = Seeker, peer = Peer) with color coding.
   - Reasoning text.
   - Category, confidence (with visual bar), status.
   - Timestamps (createdAt, updatedAt).
   - Presentation text (if available).

### `index opportunity accept <id>`

1. Reads credentials. Exits with error if not logged in.
2. Calls `PATCH /api/opportunities/:id/status` with `{ status: "accepted" }`.
3. Prints confirmation message.

### `index opportunity reject <id>`

1. Reads credentials. Exits with error if not logged in.
2. Calls `PATCH /api/opportunities/:id/status` with `{ status: "rejected" }`.
3. Prints confirmation message.

### `index opportunity discover <query>`

1. Reads credentials. Exits with error if not logged in.
2. Calls `create_opportunities` tool via Tool HTTP API with `{ query }`.
3. Renders a table of discovered opportunities.

Supports optional flags:
- `--target <uid>` — Discover opportunities for a specific user (on behalf of)
- `--introduce <userA> <userB>` — Discover an introduction opportunity between two users

## Constraints

- The CLI must not import any protocol internals. It is a pure HTTP client.
- Auth tokens are loaded from `~/.index/credentials.json` via the existing `CredentialStore`.
- 401 responses trigger "Session expired. Run `index login` to re-authenticate."
- The `--status` flag only accepts values the API supports: pending, accepted, rejected, expired.
- Valency role display uses friendly labels: agent = "Helper", patient = "Seeker", peer = "Peer".
- The argument parser follows the same pattern as existing commands (no external CLI framework).
- The `opportunity` subcommand requires a valid subcommand; bare `index opportunity` prints usage help.

## Acceptance Criteria

1. `index opportunity list` displays a table of opportunities with counterparty, category, status, confidence, and date.
2. `index opportunity list --status pending` filters to pending opportunities only.
3. `index opportunity list --limit 5` limits results to 5 items.
4. `index opportunity show <id>` displays a detailed card with parties, roles, reasoning, and presentation.
5. `index opportunity accept <id>` sends accepted status and prints confirmation.
6. `index opportunity reject <id>` sends rejected status and prints confirmation.
7. All subcommands exit with code 1 and a helpful message when not authenticated.
8. Missing or invalid subcommand prints usage help for the opportunity command.
9. Missing `<id>` argument for show/accept/reject prints an error message.
10. Unit tests cover: argument parsing for opportunity subcommands, API client methods, output formatting.
