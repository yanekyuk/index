# OpenClaw Plugin Setup Wizard

**Date**: 2026-04-16  
**Status**: Draft  
**Scope**: `packages/openclaw-plugin/`, `frontend/src/app/agents/`

## Problem

Installing the Index Network OpenClaw plugin currently requires 4 manual CLI steps after `openclaw plugins install`:

1. `openclaw mcp set index-network '{...}'` — register MCP server
2. `openclaw config set ...agentId` / `...apiKey` / `...protocolUrl` — 3 separate config commands
3. `openclaw config set ...deliveryChannel` / `...deliveryTarget` — delivery routing

Users must copy-paste 6+ commands with substituted values. This friction slows onboarding and causes misconfiguration.

## Goal

Reduce setup to a single command:

```
openclaw plugins install indexnetwork-openclaw-plugin --marketplace https://github.com/indexnetwork/openclaw-plugin
```

An interactive wizard collects all required configuration during install. The plugin auto-registers the MCP server from the collected values.

## Design

### 1. Setup Wizard (`src/setup-entry.ts`)

New file registered via `openclaw.setupEntry` in `package.json`. Runs during `openclaw plugins install` or `openclaw configure`.

#### Wizard Prompts

```
Index Network Setup
───────────────────
Server URL [https://protocol.index.network]: _
Agent ID: _
API key: _
Delivery channel: [Telegram] / [Discord] / [Skip]
Telegram chat ID: _

✓ MCP server registered
✓ Plugin configured
✓ Delivery routed to Telegram
```

| Prompt | Type | Default | Required | Notes |
|--------|------|---------|----------|-------|
| Server URL | Free text | `https://protocol.index.network` | Yes (default accepted on Enter) | Also accepts `https://protocol.dev.index.network`, `http://localhost:3001`, or any URL |
| Agent ID | Free text | — | Yes | UUID from the frontend Agents page |
| API key | Free text (masked) | — | Yes | Generated on the frontend Agents page |
| Delivery channel | Selection list | — | No (skippable) | Auto-detected from OpenClaw's configured channels |
| Delivery target | Free text | — | Yes (if channel selected) | Label adapts to channel: "Telegram chat ID", "Discord channel ID", etc. |

#### Channel Detection

The setup entry receives the OpenClaw config object (`cfg`). The wizard inspects `cfg.channels` to discover which messaging channels have configured credentials (e.g. Telegram bot token, Discord bot token). Only channels with valid config appear in the selection list. If no channels are configured, the delivery prompts are skipped entirely with a note: "No delivery channels configured. You can add one later with `openclaw configure`."

The exact detection logic: iterate `Object.keys(cfg.channels || {})`, filter to entries that have a truthy token/credential, and present those channel IDs as selectable options with human-readable labels.

#### Config Written

The wizard writes to plugin config (`plugins.entries.indexnetwork-openclaw-plugin.config`):

- `protocolUrl` — the server URL entered by the user
- `agentId` — the agent ID
- `apiKey` — the API key
- `deliveryChannel` — selected channel ID (omitted if skipped)
- `deliveryTarget` — channel-specific recipient (omitted if skipped)

### 2. Auto MCP Registration

The MCP server is registered automatically — never manually. Two integration points:

#### a) Wizard (first-time setup)

After writing config, the wizard registers the MCP server via OpenClaw's config API:

```json
{
  "index-network": {
    "url": "<protocolUrl>/mcp",
    "transport": "streamable-http",
    "headers": { "x-api-key": "<apiKey>" }
  }
}
```

#### b) `register()` (every startup)

On every plugin load, `register()` checks whether the MCP server definition matches the current plugin config. If `apiKey` or `protocolUrl` changed (or the MCP entry doesn't exist), it updates the registration. This ensures config changes via `openclaw config set` are always reflected without manual `openclaw mcp set`.

### 3. `package.json` Changes

Add `setupEntry` to the `openclaw` block:

```json
{
  "openclaw": {
    "extensions": ["./src/index.ts"],
    "setupEntry": "./src/setup-entry.ts",
    "compat": {
      "openclaw": ">=0.1.0"
    }
  }
}
```

### 4. Frontend Changes

Update `SetupInstructions` component in both `frontend/src/app/agents/page.tsx` and `frontend/src/app/agents/[id]/page.tsx`.

#### Before (4 code blocks for OpenClaw)

1. Install plugin
2. Register MCP server
3. Configure plugin (3 commands)
4. Configure delivery (2 commands)

#### After (1 code block + value display)

**OpenClaw section:**

1. **Install command** — single copy-able line:
   ```
   openclaw plugins install indexnetwork-openclaw-plugin --marketplace https://github.com/indexnetwork/openclaw-plugin
   ```
2. **Your values** — `Agent ID` and `API Key` shown with copy buttons, plus explanatory text: "The setup wizard will prompt for these values during installation."

Claude Code and Hermes sections remain unchanged.

### 5. Fallback Path

If `setupEntry` doesn't activate for non-channel plugins (SDK limitation), the plugin handles it gracefully:

- `register()` logs a warning: "Index Network plugin not configured. Run `openclaw configure` to complete setup."
- The existing bootstrap skill (`skills/index-network/SKILL.md`) can guide configuration conversationally as a secondary fallback.
- The frontend instructions can optionally show the manual `openclaw config set` commands in a collapsed "Manual setup" section.

## Files Changed

| File | Change |
|------|--------|
| `packages/openclaw-plugin/package.json` | Add `openclaw.setupEntry` field |
| `packages/openclaw-plugin/src/setup-entry.ts` | New — interactive setup wizard |
| `packages/openclaw-plugin/src/index.ts` | Add auto MCP registration in `register()` |
| `packages/openclaw-plugin/src/plugin-api.ts` | Extend type interface if needed for config write / MCP registration APIs |
| `packages/openclaw-plugin/openclaw.plugin.json` | Add `"default": "https://protocol.index.network"` to `protocolUrl` in `configSchema` |
| `frontend/src/app/agents/page.tsx` | Simplify OpenClaw `SetupInstructions` |
| `frontend/src/app/agents/[id]/page.tsx` | Simplify OpenClaw `SetupInstructions` |

## Out of Scope

- Auto-provisioning agents from OpenClaw identity (no backend pairing endpoint exists)
- Webhook-based setup (would require backend changes)
- Modifying Claude Code or Hermes setup instructions
