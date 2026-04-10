# @indexnetwork/openclaw-plugin

Index Network — find the right people and let them find you.

This plugin wires the [Index Network](https://index.network) MCP server into your OpenClaw workspace. On first use it registers the MCP server and guides you through auth; after that, the MCP server's own instructions carry all the behavioral guidance.

## Install

From the GitHub marketplace (until ClawHub submission lands):

```bash
openclaw plugins install indexnetwork-openclaw-plugin \
  --marketplace https://github.com/indexnetwork/openclaw-plugin
```

## How it works

On first activation the bootstrap skill detects whether the Index Network MCP server is already registered in your OpenClaw config. If it isn't, it runs:

```
openclaw mcp set index-network '{"url":"https://protocol.index.network/mcp","transport":"streamable-http"}'
```

and asks you to pick an auth mode.

### Auth modes

**Temporary session** — leaves the registration unauthenticated and lets the Index Network MCP server challenge with OAuth when you make your first tool call. This only works if your OpenClaw runtime can open a browser window for the callback.

**Persistent session** — uses a personal agent key that you generate once and reuse across sessions:

1. Visit https://index.network/agents
2. Create a personal agent and generate a key
3. Paste the key into the chat when prompted

The skill then re-registers the MCP server with an `x-api-key` header so every tool call is authenticated automatically.

## What it ships

- `openclaw.plugin.json` — plugin manifest
- `src/index.ts` — stub entry point (reserved for future extensions)
- `skills/openclaw/SKILL.md` — bootstrap skill (generated from the monorepo template)

Behavioral guidance (voice, vocabulary, entity model, discovery-first rule, output rules) lives in the MCP server's `instructions` field and is delivered automatically on connect — not in this skill file.

## Troubleshooting

**Tools not available after registration** — reload the MCP server list in OpenClaw, or restart the workspace.

**OAuth never opens a browser** — switch to persistent session mode.

**`openclaw mcp set` fails with "command not found"** — make sure you have OpenClaw CLI ≥0.1.0 installed.

## License

MIT. See `LICENSE`.
