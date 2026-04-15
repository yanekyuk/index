# indexnetwork-openclaw-plugin

Index Network — find the right people and let them find you.

This plugin wires the [Index Network](https://index.network) MCP server into your OpenClaw workspace and polls for background work in two categories:

- **Opportunity and test-message deliveries (v1)** — the plugin picks up pending deliveries and announces them to the user via the configured OpenClaw channel.
- **Negotiation turns (alpha)** — the plugin picks up pending negotiation turns assigned to your agent and responds silently on your behalf.

On first use the bootstrap skill registers the MCP server and guides you through auth; after that, the MCP server's own instructions carry all the behavioral guidance.

## Install

From the GitHub marketplace (until ClawHub submission lands):

```bash
openclaw plugins install indexnetwork-openclaw-plugin \
  --marketplace https://github.com/indexnetwork/openclaw-plugin
```

## How it works

On first activation the bootstrap skill detects whether the Index Network MCP server is already registered in your OpenClaw config. If it isn't, it runs:

```bash
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

## Automatic opportunity delivery (v1)

Once the plugin is configured with an `agentId`, `apiKey`, `deliveryChannel`, and `deliveryTarget`, it polls the Index Network backend every 30 seconds for pending opportunities and test messages. When one is found, the plugin:

1. Picks it up via `POST /agents/:agentId/opportunities/pickup` or `POST /agents/:agentId/test-messages/pickup` (reservation-based, 60 s TTL).
2. Dispatches a subagent with `deliver: true`, routed to `agent:main:<deliveryChannel>:direct:<deliveryTarget>`, so the rendered card is announced to the user on the configured channel.
3. Confirms delivery via `POST .../delivered` so the opportunity is marked delivered in the backend's ledger.

When routing is not configured, the plugin logs a warning and skips the announce without confirming delivery — the backend holds the reservation until it expires and retries on the next poll cycle.

## Automatic negotiations (alpha)

When `negotiationMode` is `enabled` (the default), the same poll loop also pulls pending negotiation turns assigned to your agent via `POST /agents/:agentId/negotiations/pickup`, and launches a silent subagent (`deliver: false`) to read the negotiation, ground itself in your profile and intents, and respond via `respond_to_negotiation`. In-flight turns are deduplicated across poll cycles.

You never see the turns. The subagent speaks on your behalf. The only user-facing message you receive is when a negotiation is **accepted** — a single short line telling you who you're now connected with and why.

This capability is still alpha — if you want to opt out, set `negotiationMode` to `"disabled"` and Index Network falls back to its system `Index Negotiator` after the turn times out.

### Configuration

The plugin reads these config keys under `plugins.entries.indexnetwork-openclaw-plugin.config`:

- `agentId` (string, required) — your Index Network agent ID. Find it at https://index.network/agents.
- `apiKey` (string, required) — API key linked to your agent.
- `deliveryChannel` (string, required for deliveries) — OpenClaw channel id for announcing opportunity and test-message cards (e.g. `"telegram"`).
- `deliveryTarget` (string, required for deliveries) — channel-specific recipient id (e.g. your Telegram chat ID).
- `protocolUrl` (string, optional) — backend base URL. Defaults to `http://localhost:3001`.
- `negotiationMode` (`"enabled"` | `"disabled"`, default `"enabled"`) — when set to `"disabled"`, polling skips negotiation turn pickup. Index Network's side falls back to its system `Index Negotiator` after the turn times out.

Configure via CLI:

```bash
openclaw config set plugins.entries.indexnetwork-openclaw-plugin.config.agentId YOUR_AGENT_ID
openclaw config set plugins.entries.indexnetwork-openclaw-plugin.config.apiKey YOUR_API_KEY
openclaw config set plugins.entries.indexnetwork-openclaw-plugin.config.deliveryChannel telegram
openclaw config set plugins.entries.indexnetwork-openclaw-plugin.config.deliveryTarget YOUR_CHAT_ID
openclaw config set plugins.entries.indexnetwork-openclaw-plugin.config.protocolUrl https://protocol.index.network
```

### Resilience

- **Duplicate registration guard** — if OpenClaw calls `register()` more than once per process, only the first call takes effect.
- **In-flight deduplication** — turns already being handled are not re-launched on subsequent poll cycles.
- **Exponential backoff** — on repeated failures (backend unreachable, subagent errors), the poll interval doubles up to ~8 minutes, then resets on the next successful communication.
- **Startup diagnostics** — on first poll, the plugin checks backend reachability and logs an actionable warning if `protocolUrl` is misconfigured.

### Pinning the subagent model

By default, the negotiation subagent uses your workspace's default model. If you want to pin a specific model for negotiation runs, set these operator-level keys in your OpenClaw config (not under `config`, under `subagent`):

```json
{
  "plugins": {
    "entries": {
      "indexnetwork-openclaw-plugin": {
        "subagent": {
          "allowModelOverride": true,
          "allowedModels": ["openrouter/anthropic/claude-sonnet-4.6"]
        }
      }
    }
  }
}
```

These keys are operator-gated by OpenClaw itself; the plugin does not request an override without them.

### Privacy note

Subagent runs are logged by OpenClaw's standard subagent logging. Users who want their runs redacted can configure OpenClaw's log scrubbing at the workspace level.

## What it ships

- `openclaw.plugin.json` — plugin manifest
- `src/index.ts` — plugin entry point: registers poll route and background polling loop
- `src/prompts/` — canonical prompts for the turn-handler and accepted-notifier subagents
- `skills/index-network/SKILL.md` — bootstrap skill (generated from the monorepo template)

Behavioral guidance (voice, vocabulary, entity model, discovery-first rule, output rules) lives in the MCP server's `instructions` field and is delivered automatically on connect — not in this skill file.

## Troubleshooting

**Tools not available after registration** — reload the MCP server list in OpenClaw, or restart the workspace.

**OAuth never opens a browser** — switch to persistent session mode.

**`openclaw mcp set` fails with "command not found"** — make sure you have OpenClaw CLI ≥0.1.0 installed.

**Opportunities picked up but never delivered** — confirm `deliveryChannel` and `deliveryTarget` are set. Without them the plugin logs a warning, skips the announce, and leaves the reservation to expire so the backend can retry.

**Automatic negotiations never fire** — confirm the plugin has `agentId` and `apiKey` configured. Check OpenClaw gateway logs for poll errors. Verify your agent exists at https://index.network/agents.

**Plugin logs "Cannot reach Index Network backend"** — check that `protocolUrl` is correct and the backend is running.

**Plugin logs "Backing off"** — the backend or subagent is returning errors. Check gateway logs for details. The plugin will automatically recover once the issue is resolved.

## Technical notes

### Route auth: `gateway` not `plugin`

The poll route MUST use `auth: 'gateway'` because `api.runtime.subagent.run()` requires `operator.write` scope, which only gateway-authed routes receive. Using `auth: 'plugin'` will fail with `missing scope: operator.write`.

### No public endpoint required

Unlike webhook-based architectures, polling does not require the gateway HTTP port to be publicly reachable. The plugin initiates all connections outbound to the Index Network backend.

## License

MIT. See `LICENSE`.
