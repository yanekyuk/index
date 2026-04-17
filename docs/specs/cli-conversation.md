---
title: "CLI conversation command — chat and DM"
type: spec
tags: [cli, conversation, dm, h2h, h2a, chat, message, command]
created: 2026-03-30
updated: 2026-04-17
---

## Behavior

The `index conversation` command is the unified entry point for everything in the conversation surface. It serves both:

- **Human-to-Agent (H2A) chat** — the default mode: an SSE-streaming REPL against the Index chat orchestrator (`/api/chat/stream`), plus session listing and one-shot messages via positional args.
- **Human-to-Human (H2H) direct messaging** — via the `list`/`with`/`show`/`send`/`stream` subcommands backed by `/api/conversations/*`.

Everything is a conversation: the H2A and H2H surfaces live under one command because chat sessions and DMs share the same message model.

### `index conversation list`

1. Calls `GET /api/conversations` with auth header.
2. Renders a table of conversations: ID (truncated), participants, last message preview, created date.
3. Exits 0.

### `index conversation with <user-id>`

1. Calls `POST /api/conversations/dm` with `{ peerUserId }`.
2. If a DM already exists, returns the existing conversation. Otherwise creates a new one.
3. Prints the conversation ID and participant info.
4. Exits 0.

### `index conversation show <id>`

1. Calls `GET /api/conversations/:id/messages` with optional `--limit <n>` (default 20).
2. Renders messages in chronological order showing sender, timestamp, and text content.
3. Exits 0.

### `index conversation send <id> <message>`

1. Calls `POST /api/conversations/:id/messages` with `{ parts: [{ type: "text", text: message }] }`.
2. Prints confirmation with the sent message ID.
3. Exits 0.

### `index conversation stream`

1. Opens `GET /api/conversations/stream` as an SSE connection.
2. Prints real-time events (new messages, conversation updates) to stdout.
3. Runs until interrupted with Ctrl+C.

## Constraints

- The CLI is a pure HTTP client; it must not import protocol internals.
- Auth tokens are loaded from `~/.index/credentials.json` via the existing `CredentialStore`.
- 401 responses produce "Session expired or invalid. Run `index login` to re-authenticate."
- Network errors produce a clear error message.
- No external CLI framework -- argument parsing uses the existing hand-rolled parser in `args.parser.ts`.
- Follows the same command handler pattern as `network.command.ts` (exported `handleConversation` function).

## Acceptance Criteria

1. `index conversation list` displays a formatted table of conversations.
2. `index conversation with <user-id>` gets or creates a DM and prints the conversation summary.
3. `index conversation show <id>` displays messages in chronological order.
4. `index conversation show <id> --limit 5` limits results to 5 messages.
5. `index conversation send <id> <message>` sends a message and prints confirmation.
6. `index conversation stream` opens an SSE connection and prints real-time events.
7. `index conversation` with no subcommand prints conversation help text.
8. All subcommands exit with code 1 and a helpful message when not authenticated.
9. Argument parser correctly routes "conversation" command with all subcommands and positional args.
10. API client methods send correct HTTP requests with auth headers.
11. Unit tests cover: argument parsing for conversation subcommands, API client methods, output formatting, command handler logic.
