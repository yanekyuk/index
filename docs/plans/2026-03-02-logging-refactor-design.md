# Logging Refactor Design

**Date**: 2026-03-02
**Status**: Approved

## Problem

The protocol server produces excessive log noise. A single authenticated request generates 7 `main:` log lines, all at `info` level. Routine operations across services, controllers, agents, and graphs also log at `info`, drowning out meaningful signals. Additionally, ~25 direct `console.*` calls exist in non-CLI production code without structured context.

## Design

### 1. Add `verbose` log level

Add a new level below `debug` for request-level tracing:

| Level | Order | Purpose |
|-------|-------|---------|
| `verbose` | 5 | Request-level firehose: every step of every request, node entry/exit, guard execution |
| `debug` | 10 | Targeted diagnostics: parameter values, intermediate state, investigation aids |
| `info` | 20 | Significant events: startup, infrastructure lifecycle, completed side effects |
| `warn` | 30 | Recoverable issues |
| `error` | 40 | Failures |

Dev default stays `debug`, so verbose output is off by default. Opt in with `LOG_LEVEL=verbose`.

### 2. Replace `console.*` in non-CLI production code

~25 calls across 7 files:

- `adapters/database.adapter.ts` — 14 `console.error` -> `log.lib.from(...).error`
- `lib/email/notification.sender.ts` — 4 `console.log` -> `log.lib.from(...)`
- `lib/uploads.ts` — 1 `console.log` + 3 `console.warn` -> `log.lib.from(...)`
- `lib/langchain/langchain.ts` — 1 `console.log` -> `log.lib.from(...)`
- `lib/integrations/providers/slack-logger.ts` — 1 `console.log` -> `log.lib.from(...)`
- `lib/embedder/embedder.generator.ts` — 1 `console.error` -> `log.lib.from(...)`
- `lib/langchain/middleware/retry.ts` — 1 `console.warn` -> `log.lib.from(...)`

### 3. Downgrade routine `info` to `verbose`

Across ~30 files, ~100+ calls:

- `main.ts`: dispatch internals (matched route, guards found/executing/success, invoking/invoked handler)
- Services: routine CRUD logging ("Listing intents", "Creating session", "Getting indexes")
- Controllers: request receipt and parameter logging
- Agents/graphs: invocation, node entry/exit
- Protocol logger utility (`withCallLogging` wrapper)

### 4. What stays at `info`

- Server startup/shutdown
- Redis/infrastructure connection events
- Completed operations with user-visible side effects (email sent, profile generated)
- Auth events surfaced to the user (login, logout)
- Route/controller registration at startup

### Out of scope

- CLI scripts (`src/cli/*`) — keep `console.log` for user-facing terminal output
- Test files
- Template/doc files (`.template.md`)
