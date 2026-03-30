---
title: "CLI v1 — login and conversation"
type: spec
tags: [cli, auth, conversation, h2a, h2h, sse, streaming]
created: 2026-03-30
updated: 2026-03-31
---

## Behavior

The `index` CLI (v0.7.0) is a standalone Bun-based binary in a `cli/` workspace at the monorepo root. It communicates with the Index Network protocol server over HTTP/SSE. Distribution is via npm using platform-specific prebuilt binaries (see `cli-npm-publish.md` for details).

### `index login`

1. Prints a URL pointing to the protocol's Better Auth OAuth flow (Google provider).
2. Opens the user's default browser to that URL.
3. Starts a temporary local HTTP server (ephemeral port) to receive the OAuth callback.
4. On callback, exchanges the authorization parameters for a session token via the protocol's Better Auth endpoints.
5. Stores the session credentials (bearer token + API base URL) in `~/.index/credentials.json`.
6. Prints confirmation with the authenticated user's name and email.
7. The local server shuts down after receiving the callback (or after a 120-second timeout).

### `index conversation [message]`

The unified `conversation` command handles both AI agent chat (H2A) and human-to-human messaging (H2H). The active subcommand determines the behavior.

**One-shot mode** (message provided as positional argument):
1. Reads credentials from `~/.index/credentials.json`. Exits with error if not logged in.
2. Sends `POST /api/chat/stream` with `{ message }` and `Authorization: Bearer <token>`.
3. Reads the SSE stream, printing assistant text tokens to stdout as they arrive.
4. On `done` event, prints the session ID for future reference and exits 0.
5. On `error` event, prints the error to stderr and exits 1.

**Interactive REPL mode** (no subcommand, no message argument):
1. Reads credentials. Exits with error if not logged in.
2. Enters a read-eval-print loop with a `> ` prompt.
3. Each user input is sent to `POST /api/chat/stream` with the current `sessionId`.
4. Streamed tokens are printed. After `done`, the loop resumes.
5. The user exits with Ctrl+C or typing `exit`/`quit`.

### `index conversation --session <id>`

Resumes a specific AI chat session. Works in both one-shot and REPL modes. The session ID is passed as `sessionId` in the stream request body.

### `index conversation sessions`

1. Calls `GET /api/chat/sessions` with auth header.
2. Prints a table of AI chat sessions: ID, title, created date.
3. Exits 0.

### `index conversation list`

1. Calls `GET /api/conversations` with auth header.
2. Prints a table of all conversations (H2A + H2H): ID, participants, created date.
3. Exits 0.

### `index conversation with <user-id>`

Opens or resumes a direct message conversation with another user. See `cli-conversation.md` for full H2H command reference.

### `index conversation show <id>` / `send <id> <msg>` / `stream`

H2H messaging subcommands. See `cli-conversation.md` for full details.

## Constraints

- The CLI must not import any protocol internals. It is a pure HTTP client.
- Auth tokens are stored in the user's home directory, not in the project.
- The CLI must handle expired/invalid tokens gracefully (print "Session expired. Run `index login` again." on 401).
- SSE parsing must handle partial chunks (tokens may arrive mid-line).
- The CLI must work on macOS and Linux. Windows is not required for v1.
- No external CLI framework dependency — argument parsing uses a hand-rolled parser in `args.parser.ts`.
- The binary name is `index`. Distributed via `npm install -g @indexnetwork/cli`.

## Acceptance Criteria

1. `index login` completes an OAuth flow and stores valid credentials.
2. `index login` fails gracefully if the browser cannot be opened (prints URL for manual copy).
3. `index conversation "hello"` sends a message and prints the streamed response.
4. `index conversation` (no args) enters REPL mode and supports multi-turn conversation.
5. `index conversation --session <id>` resumes an existing AI chat session.
6. `index conversation sessions` prints a formatted table of AI chat sessions.
7. `index conversation list` prints all conversations (H2A + H2H).
8. All commands exit with code 1 and a helpful message when not authenticated.
9. 401 responses trigger a "Session expired" message.
10. Network errors (server unreachable) produce a clear error message.
11. Unit tests cover: argument parsing, credential read/write, SSE event parsing, error handling.
