# Index CLI

Command-line interface for [Index Network](https://index.network). Chat with the AI agent, manage signals, and discover opportunities — all from your terminal.

> **Status: v0.3.0**
> Supports `login`, `chat`, and `intent` (signal management) commands.

## Quick Start

```bash
# Build the binary
bun run build

# Authenticate (opens browser)
./dist/index login

# Start chatting
./dist/index chat
```

## Commands

### `index login`

Authenticate with Index Network. Opens a browser window that exchanges your existing session for a CLI token, or starts a fresh OAuth flow.

```bash
index login                     # Browser-based auth (default)
index login --token <jwt>       # Manual token (skip browser)
index login --api-url <url>     # Custom server URL
```

Credentials are stored in `~/.index/credentials.json`.

### `index logout`

Clear stored credentials.

```bash
index logout
```

### `index intent`

Manage your signals (intents). Create signals from natural language, list active signals, view details, and archive signals you no longer need.

```bash
index intent list                           # List active signals
index intent list --archived                # Include archived signals
index intent list --limit 5                 # Limit to 5 results
index intent show <id>                      # Show full signal details
index intent create "Looking for a CTO"     # Create from natural language
index intent archive <id>                   # Archive a signal
```

### `index chat`

Interactive REPL chat with the Index agent. Supports streaming responses, inline markdown formatting, tool call indicators, and special blocks (signal proposals, opportunities).

```bash
index chat                          # Interactive REPL
index chat "find me collaborators"  # One-shot message
index chat --session <id>           # Resume a session
index chat --session <id> "hello"   # Resume + send message
index chat --list                   # List past sessions
```

### `index profile`

View user profiles and trigger profile regeneration.

```bash
index profile                       # Show your own profile
index profile show <user-id>        # Show another user's profile
index profile sync                  # Regenerate your profile
```

## Options

| Flag | Short | Description |
|------|-------|-------------|
| `--api-url <url>` | | Override API server (default: `http://localhost:3000`) |
| `--token <token>` | `-t` | Provide bearer token directly |
| `--session <id>` | `-s` | Resume a specific chat session |
| `--list` | `-l` | List chat sessions |
| `--archived` | | Include archived signals (intent list) |
| `--limit <n>` | | Limit results (intent list) |
| `--help` | `-h` | Show help |
| `--version` | `-v` | Show version |

## Development

```bash
# Run directly with Bun (no build step)
bun src/main.ts chat

# Build a standalone binary
bun run build        # outputs to dist/index

# Run tests
bun test
```

### Project Structure

```
cli/
  src/
    main.ts            Entry point, command routing, REPL loop
    login.command.ts    OAuth flow with local callback server
    chat.command.ts     SSE stream processor
    output.ts           Terminal formatting, colors, markdown renderer
    api.client.ts       Typed HTTP client for the protocol API
    auth.store.ts       Credential persistence (~/.index/credentials.json)
    args.parser.ts      CLI argument parser (Bun-native parseArgs)
    sse.parser.ts       Server-Sent Events parser
```

## Roadmap

Commands planned for future iterations:

- `index opportunity` — Browse and manage discovered opportunities
- `index network` — Manage indexes and memberships
- `index conversation` — H2H and A2A messaging
