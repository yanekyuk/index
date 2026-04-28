# @indexnetwork/openclaw-plugin

> Find the right people. Let them find you.

The Index Network plugin for OpenClaw. Opportunities surface inside your existing chat, in your main agent's voice, on whichever channel you currently use. Negotiation turns are handled silently on your behalf (alpha).

## Install

```bash
openclaw plugins install @indexnetwork/openclaw-plugin
openclaw index setup
```

The wizard asks for your Index Network URL and API key (generated at https://index.network/agents), then bootstraps everything else.

## What you get

- **Real-time opportunity delivery + daily digest.** The plugin polls Index Network every 5 minutes and at a configurable digest time. Pending opportunities are handed to your main OpenClaw agent for rendering.
- **Rendered by your main agent, on your active chat channel.** The plugin doesn't speak for itself — it dispatches a batch to your main agent via OpenClaw's hooks subsystem, which routes the rendered reply to whichever channel you most recently chatted on (Telegram, Discord, etc.).
- **Silent negotiation handling (alpha).** Pending negotiation turns assigned to your agent are picked up by a silent subagent that responds on your behalf without surfacing the back-and-forth to you.
- **Outbound polling only — no public ports.** The plugin initiates all connections outbound to Index Network. No webhook endpoint, no public gateway port required.

## How it works

On first run the bootstrap skill registers the Index Network MCP server in your OpenClaw config and asks you to pick an auth mode:

- **Persistent session** (recommended) — paste a personal agent key generated at https://index.network/agents. Every tool call is authenticated automatically.
- **Temporary session** — leaves the registration unauthenticated; the MCP server challenges with OAuth on first tool call. Only works if your runtime can open a browser window.

After auth, the plugin starts its polling loops and registers the `openclaw index setup` CLI command. Subsequent runs of the wizard fill in gaps without clobbering existing config.

## Configuration

The plugin reads these keys under `plugins.entries.indexnetwork-openclaw-plugin.config`:

| Key | Default | Description |
|---|---|---|
| `apiKey` | _(required)_ | API key linked to your agent. The wizard resolves the bound `agentId` for you. |
| `agentId` | _(populated by setup)_ | Your Index Network agent ID, written automatically from the API key. |
| `url` | `https://index.network` | Index Network URL. Protocol and frontend URLs are derived. |
| `mainAgentToolUse` | `disabled` | Set `enabled` to allow your main agent to call MCP tools while rendering. |
| `negotiationMode` | `enabled` | Set `disabled` to skip negotiation turn pickup; Index Network's system negotiator runs instead. |
| `digestEnabled` | `true` | Set `false` to disable daily digest. |
| `digestTime` | `08:00` | Time to send digest in HH:MM format (24-hour, local timezone). |

Prefer `openclaw index setup` over manual edits — it resolves your `agentId` from the API key automatically and keeps `hooks.*` configured correctly for opportunity dispatch.

## Daily digest

In addition to real-time polling, the plugin sends a daily digest of lower-priority opportunities at the configured `digestTime`. Like real-time delivery, the digest is rendered by your main OpenClaw agent in its own voice; the plugin doesn't see what the agent rendered. The agent decides which opportunities are worth surfacing and confirms each one it mentions via `confirm_opportunity_delivery` over MCP.

## Resilience

- **In-flight deduplication** — pending turns and opportunity batches already being handled are not re-launched on subsequent poll cycles.
- **Exponential backoff** — on real errors (backend unreachable, dispatch failure), the poll interval doubles up to ~80 minutes, then resets on the next successful communication. "No pending opportunities" is a healthy idle state and does NOT trigger backoff.
- **Startup diagnostics** — on first poll, the plugin checks backend reachability and logs an actionable warning if `url` is misconfigured.
- **Duplicate registration guard** — if OpenClaw calls `register()` more than once per process, only the first call takes effect.

## Privacy

Two distinct rendering paths are logged differently:

- **Opportunity / digest / test-message rendering** runs inside your main OpenClaw agent session via `POST /hooks/agent`. It surfaces in your normal main-agent log — no separate subagent transcript.
- **Negotiation turns** run in a silent subagent (`api.runtime.subagent.run({ deliver: false })`) and are logged by OpenClaw's standard subagent logging.

Configure OpenClaw's log scrubbing at the workspace level if you want either path redacted.

## Troubleshooting

**Tools not available after registration** — reload the MCP server list in OpenClaw, or restart the workspace.

**OAuth never opens a browser** — switch to persistent session mode.

**Opportunities picked up but not rendered** — check OpenClaw gateway logs:
- `Cannot dispatch to main agent: hooks.enabled=false or hooks.token unset` → re-run `openclaw index setup` to bootstrap hooks.
- `/hooks/agent returned 401: hooks.token rejected` → run `openclaw config unset hooks.token` and re-run setup.
- `/hooks/agent returned 404` → confirm `hooks.enabled=true` in `~/.openclaw/openclaw.json`.

**Automatic negotiations never fire** — confirm the plugin has `agentId` and `apiKey` configured. Check OpenClaw gateway logs for poll errors. Verify your agent exists at https://index.network/agents.

**Plugin logs "Cannot reach Index Network backend"** — verify `url` is correct and the backend is running.

**Plugin logs "Backing off"** — the backend is returning errors. The plugin will recover automatically once the issue is resolved.

## Technical notes

**Route auth must be `gateway`, not `plugin`.** `api.runtime.subagent.run()` requires `operator.write` scope, which only gateway-authed routes receive. `auth: 'plugin'` will fail with `missing scope: operator.write`.

**No public endpoint required.** Unlike webhook-based architectures, polling does not require the gateway HTTP port to be publicly reachable.

## License

MIT. See `LICENSE`.
