---
name: index-network-signal
description: Use when the user wants to express what they are looking for or offering, create or update intents/signals, or manage intent-network links.
---

# Signals (Intents)

Help users articulate and manage their intents — what they are looking for or what they can offer.

## Prerequisites

The parent skill (index-network) has already verified CLI availability and auth. Context has been gathered silently.

## Creating Intents

When a user describes a need or offering, run:

```
index intent create "<their natural language description>" --json
```

Do not ask the user to structure their intent — the server processes natural language. After creating, silently re-run `index intent list --json` to refresh context.

## Updating Intents

If a user wants to refine an existing intent:

```
index intent update <id> "<new description>" --json
```

The server checks similarity with the old version and enriches as needed.

## Linking to Networks

After creating an intent, suggest linking it to relevant networks:

```
index intent link <intent-id> <network-id> --json
```

Show current links:

```
index intent links <intent-id> --json
```

Unlink:

```
index intent unlink <intent-id> <network-id> --json
```

## Archiving

When an intent is fulfilled or no longer relevant:

```
index intent archive <id> --json
```

## Reading

List the user's active or archived intents:

```
index intent list [--archived] [--limit <n>] --json
```

Show details of a specific intent:

```
index intent show <id> --json
```
