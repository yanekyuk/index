# indexnetwork-openclaw-plugin

Index Network — find the right people and let them find you.

This plugin wires the [Index Network](https://index.network) MCP server into your OpenClaw workspace and polls for background work in two categories:

- **Opportunity delivery** — the plugin picks up pending opportunities and hands them to your main OpenClaw agent, which renders and delivers them in its own voice on whichever channel you currently chat with it.
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

## Automatic opportunity delivery

Once the plugin is configured with an `apiKey` (which resolves your `agentId`), the plugin polls the Index Network backend every 5 minutes for pending opportunities. When candidates are found, the plugin discovers your most-recently-active chat-bound session by reading `~/.openclaw/agents/main/sessions/sessions.json`, then hands the candidates to your **main OpenClaw agent** via the gateway's `POST /hooks/agent` endpoint with `deliver: true` plus the session's `sessionKey`, `channel`, and `to`. Your agent ranks the candidates, picks what's worth surfacing, and renders the message in its own voice; the gateway routes the reply directly to that chat session's channel. If no chat-bound session exists yet (you haven't messaged your agent on a chat platform), delivery falls back to `channel: "last"` and a warning is logged — send a chat message first and the next poll will route correctly.

The setup wizard bootstraps the gateway hooks subsystem automatically — `hooks.enabled=true`, a fresh `hooks.token`, `hooks.allowRequestSessionKey=true`, and `hooks.allowedSessionKeyPrefixes` containing `agent:main:` are written to your OpenClaw config the first time you run `openclaw index-network setup`. If you already use hooks for other integrations, your existing token and other allowed prefixes are preserved (`agent:main:` is appended to the list, not substituted).

The hooks endpoint returns only an acknowledgement (`{status: "sent"}`); the plugin does not see what the agent rendered. Once dispatch is acknowledged, every opportunity in the dispatched batch is marked delivered. The agent's editorial decision (which subset to surface) is respected on the channel — but items it chose not to mention this cycle do not roll over. The dedup hash prevents back-to-back redispatch of the same set, so a fresh batch tomorrow will surface anything new.

## Automatic negotiations (alpha)

When `negotiationMode` is `enabled` (the default), the same poll loop also pulls pending negotiation turns assigned to your agent via `POST /agents/:agentId/negotiations/pickup`, and launches a silent subagent (`deliver: false`) to read the negotiation, ground itself in your profile and intents, and respond via `respond_to_negotiation`. In-flight turns are deduplicated across poll cycles.

You never see the turns. The subagent speaks on your behalf.

This capability is still alpha — if you want to opt out, set `negotiationMode` to `"disabled"` and Index Network falls back to its system `Index Negotiator` after the turn times out.

### Configuration

The plugin reads these config keys under `plugins.entries.indexnetwork-openclaw-plugin.config`:

- `apiKey` (string, required) — API key linked to your agent. The setup wizard resolves the bound `agentId` for you via `GET /api/agents/me`; you do not need to enter it manually.
- `agentId` (string, populated by setup) — your Index Network agent ID, written automatically from the API key. Visible at https://index.network/agents if you need to verify it.
- `mainAgentToolUse` (`"disabled"` | `"enabled"`, default `"disabled"`) — if `"enabled"`, your main agent may call MCP tools while rendering Index Network notifications.
- `protocolUrl` (string, optional) — backend base URL. Defaults to `http://localhost:3001`.
- `negotiationMode` (`"enabled"` | `"disabled"`, default `"enabled"`) — when set to `"disabled"`, polling skips negotiation turn pickup. Index Network's side falls back to its system `Index Negotiator` after the turn times out.

Prefer `openclaw index-network setup` for configuration — it resolves your `agentId` from the API key automatically. If you need to write keys directly:

```bash
openclaw config set plugins.entries.indexnetwork-openclaw-plugin.config.apiKey YOUR_API_KEY
openclaw config set plugins.entries.indexnetwork-openclaw-plugin.config.protocolUrl https://protocol.index.network
```

When configuring manually, look up your agent ID at https://index.network/agents and set `…config.agentId YOUR_AGENT_ID` as well.

### Gateway hooks

The plugin requires the OpenClaw `hooks` subsystem because that's the only path that delivers an agent's reply to the user's last-active channel. The setup wizard configures it for you:

| Top-level key | Set by setup | Behavior |
|---------------|--------------|----------|
| `hooks.enabled` | `true` (flipped from `false` if needed) | Mounts `POST /hooks/*` routes on the gateway |
| `hooks.token` | random 32-byte hex (or preserved if you already have one) | Bearer token the plugin sends with every dispatch |
| `hooks.path` | `/hooks` (only set if missing) | Sub-path under which hook routes are mounted |
| `hooks.allowRequestSessionKey` | `true` (set if not already true) | Lets the plugin pass `sessionKey` per request so dispatches land in the user's chat-bound session |
| `hooks.allowedSessionKeyPrefixes` | merged with `agent:main:` (existing entries preserved) | Allowlist of prefixes the gateway accepts in `sessionKey` |

`hooks.token` is rejected at OpenClaw load time if it equals `gateway.auth.token`; the wizard refuses to overwrite an existing collision and points you at `openclaw config unset hooks.token` to recover.

### Daily Digest

In addition to real-time polling every 5 minutes, the plugin sends a daily digest of lower-priority opportunities at a configurable time. Like real-time deliveries, the digest is rendered by your main OpenClaw agent in its own voice via `/hooks/agent`.

| Config Key | Default | Description |
|------------|---------|-------------|
| `digestEnabled` | `"true"` | Set to `"false"` to disable daily digest |
| `digestTime` | `"08:00"` | Time to send digest in HH:MM format (24-hour, local timezone) |
| `digestMaxCount` | `20` | Maximum opportunities to include in digest |

The digest ranks all pending opportunities by relevance and passes the top N to your agent. Once the gateway acknowledges the dispatch, every candidate in the batch is marked delivered (the plugin does not see what the agent surfaced).

### Resilience

- **Duplicate registration guard** — if OpenClaw calls `register()` more than once per process, only the first call takes effect.
- **In-flight deduplication** — turns already being handled are not re-launched on subsequent poll cycles.
- **Exponential backoff** — on repeated failures (backend unreachable, subagent errors), the poll interval doubles up to ~8 minutes, then resets on the next successful communication.
- **Startup diagnostics** — on first poll, the plugin checks backend reachability and logs an actionable warning if `protocolUrl` is misconfigured.

### Model used for rendering

Opportunity and digest rendering happens inside your main OpenClaw agent session — no separate subagent is launched. The model used is whatever your main agent is configured with. To change it, update your main agent's model setting in OpenClaw.

### Privacy note

Two distinct rendering paths are logged differently:

- **Opportunity / digest / test-message rendering** runs inside your main OpenClaw agent session via `POST /hooks/agent`. It surfaces in your normal main-agent log — there is no separate subagent transcript.
- **Negotiation turns** still run in a silent subagent (`api.runtime.subagent.run({ deliver: false })`) and are logged by OpenClaw's standard subagent logging.

Users who want either path redacted can configure OpenClaw's log scrubbing at the workspace level.

## What it ships

- `openclaw.plugin.json` — plugin manifest
- `src/index.ts` — plugin entry point: registers poll route and background polling loop
- `src/lib/delivery/main-agent.dispatcher.ts` — POSTs to `/hooks/agent` so the gateway routes to the user's last channel
- `src/lib/delivery/main-agent.prompt.ts` — prompt template passed to the main agent for rendering
- `src/lib/delivery/post-delivery-confirm.ts` — confirms the dispatched batch via `/opportunities/confirm-batch`
- `src/lib/delivery/config.ts` — reads the `mainAgentToolUse` knob from plugin config
- `src/setup/setup.cli.ts` — interactive wizard; bootstraps `hooks.enabled` / `hooks.token` / `hooks.path` / `hooks.allowRequestSessionKey` / `hooks.allowedSessionKeyPrefixes`
- `src/polling/negotiator/negotiation-turn.prompt.ts` — prompt for the silent negotiation-turn subagent
- `skills/index-network/SKILL.md` — bootstrap skill (generated from the monorepo template)

Behavioral guidance (voice, vocabulary, entity model, discovery-first rule, output rules) lives in the MCP server's `instructions` field and is delivered automatically on connect — not in this skill file.

## Troubleshooting

**Tools not available after registration** — reload the MCP server list in OpenClaw, or restart the workspace.

**OAuth never opens a browser** — switch to persistent session mode.

**`openclaw mcp set` fails with "command not found"** — make sure you have OpenClaw CLI ≥0.1.0 installed.

**Opportunities picked up but not rendered** — check OpenClaw gateway logs. The most common causes:

- `Cannot dispatch to main agent: hooks.enabled=false or hooks.token unset` — re-run `openclaw index-network setup` to bootstrap hooks.
- `/hooks/agent returned 401: hooks.token rejected` — your `hooks.token` is wrong or expired. Run `openclaw config unset hooks.token` and re-run setup.
- `/hooks/agent returned 404` — confirm `hooks.enabled=true` in `~/.openclaw/openclaw.json`; the route only mounts when enabled.

**Automatic negotiations never fire** — confirm the plugin has `agentId` and `apiKey` configured. Check OpenClaw gateway logs for poll errors. Verify your agent exists at https://index.network/agents.

**Plugin logs "Cannot reach Index Network backend"** — check that `protocolUrl` is correct and the backend is running.

**Plugin logs "Backing off"** — the backend is returning errors. Check gateway logs for details. The plugin will automatically recover once the issue is resolved.

## Technical notes

### Route auth: `gateway` not `plugin`

The poll route MUST use `auth: 'gateway'` because `api.runtime.subagent.run()` requires `operator.write` scope, which only gateway-authed routes receive. Using `auth: 'plugin'` will fail with `missing scope: operator.write`.

### No public endpoint required

Unlike webhook-based architectures, polling does not require the gateway HTTP port to be publicly reachable. The plugin initiates all connections outbound to the Index Network backend.

## License

MIT. See `LICENSE`.
