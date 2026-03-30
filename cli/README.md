# Index CLI

Command-line interface for [Index Network](https://index.network). Chat with the AI agent, manage signals, and discover opportunities — all from your terminal.

## Installation

```bash
npm install -g @indexnetwork/cli
```

## Quick Start

```bash
# Authenticate (opens browser)
index login

# Chat with the AI agent (interactive REPL)
index conversation

# One-shot message
index conversation "What opportunities do I have?"

# Browse your signals
index intent list

# Review pending opportunities
index opportunity list
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

### `index conversation`

Unified conversation command for AI agent chat and human-to-human messaging. Supports streaming responses, inline markdown formatting, tool call indicators, and special blocks (signal proposals, opportunities).

```bash
index conversation                          # Interactive AI chat REPL
index conversation "find me collaborators"  # One-shot message to AI agent
index conversation --session <id>           # Resume an AI chat session
index conversation sessions                 # List AI chat sessions
index conversation list                     # List all conversations (H2A + H2H)
index conversation with <user-id>           # Open or resume a DM
index conversation show <id>               # Show messages
index conversation send <id> <msg>         # Send a message
index conversation stream                  # Real-time SSE stream
```

### `index profile`

View user profiles and trigger profile regeneration.

```bash
index profile                       # Show your own profile
index profile show <user-id>        # Show another user's profile
index profile sync                  # Regenerate your profile
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

### `index opportunity`

Browse and manage discovered opportunities.

```bash
index opportunity list                     # List all opportunities
index opportunity list --status pending    # Filter by status
index opportunity list --limit 5           # Limit results
index opportunity show <id>                # Show full details
index opportunity accept <id>              # Accept an opportunity
index opportunity reject <id>              # Reject an opportunity
```

Status values: `pending`, `accepted`, `rejected`, `expired`.

### `index network`

Manage networks (communities). List, create, join, leave, and invite members.

```bash
index network list                     # List your networks
index network create "My Network"      # Create a network
index network create "AI" --prompt "AI researchers"  # Create with description
index network show <id>                # Show details and members
index network join <id>                # Join a public network
index network leave <id>               # Leave a network
index network invite <id> user@email   # Invite a user by email
```

## Options

| Flag | Short | Description |
|------|-------|-------------|
| `--api-url <url>` | | Override API server (default: `https://protocol.index.network`) |
| `--app-url <url>` | | Override app URL for login (default: `https://index.network`) |
| `--token <token>` | `-t` | Provide bearer token directly |
| `--session <id>` | `-s` | Resume a specific chat session |
| `--archived` | | Include archived signals (intent list) |
| `--status <status>` | | Filter opportunities by status |
| `--limit <n>` | | Limit number of results |
| `--prompt <text>` | `-p` | Network description (for `network create`) |
| `--help` | `-h` | Show help |
| `--version` | `-v` | Show version |

## Development

```bash
# Run directly with Bun (no build step)
bun src/main.ts conversation

# Build for all platforms
bun run build

# Build for current platform only (fast dev builds)
bun scripts/build.ts --current

# Run tests
bun test

# Dry-run publish
bun scripts/publish.ts --dry-run
```

### Project Structure

```
cli/
  bin/
    index.cjs                  Bin shim (resolves platform binary or JS fallback)
  npm/
    {os}-{arch}/               Platform-specific packages with precompiled binaries
  scripts/
    build.ts                   Cross-compilation build script
    publish.ts                 npm publish orchestration
  src/
    main.ts                    Entry point, command routing
    login.command.ts           OAuth flow with local callback server
    conversation.command.ts    H2A agent chat + H2H messaging + SSE stream parser
    profile.command.ts         Profile subcommand handlers
    intent.command.ts          Intent (signal) subcommand handlers
    opportunity.command.ts     Opportunity subcommand handlers
    network.command.ts         Network subcommand handlers
    output/                    Terminal formatting, colors, markdown renderer
    api.client.ts              Typed HTTP client for the protocol API
    auth.store.ts              Credential persistence (~/.index/credentials.json)
    args.parser.ts             CLI argument parser
    sse.parser.ts              Server-Sent Events parser
    types.ts                   Shared type definitions
```
