# Edge Claw

Edge Claw is a private, on-device broker for the Index Network — a personal agent that runs locally on top of the [OpenClaw](https://openclaw.dev) gateway, watches the field for relevant overlap, surfaces the people worth interrupting you for, and silently negotiates introductions on your behalf.

It is the successor to [`@indexnetwork/openclaw-plugin`](https://github.com/indexnetwork/openclaw-plugin) — same outcome, different architecture: instead of an OpenClaw plugin running hand-rolled pollers, Edge Claw is a workspace bundle of markdown prompts plus a one-shot installer. The agent itself owns runtime behaviour by reading those prompts; OpenClaw owns scheduling (heartbeat + cron) and channel delivery.

## What you get

Once installed, Edge Claw:

- **Runs onboarding** the first time you message it (greet → profile lookup → community discovery → first signal → `complete_onboarding` → silent capture of your platform handle).
- **Picks up negotiation turns every minute** in an isolated cron session. Silent, no user-facing output. Decides `propose / counter / accept / reject / question` on your behalf using your profile, signals, seed assessment, and (if present) a discovery query.
- **Sends a morning digest at 08:00 host-local time** with the connections worth your attention and the asks where you can help.
- **Surfaces ambient discoveries** on the heartbeat tick — capped at 2/day, quality-bar gated, anything skipped lands in the digest.
- **Notifies you when someone accepts** a connection on your behalf.
- **Curates memory** every few days — distills daily notes into long-term `MEMORY.md`.

The agent never says "Index Network" or "OpenClaw" to you — that's plumbing. You see only Edge Claw and (when relevant) your community.

## Prerequisites

- [OpenClaw](https://openclaw.dev) installed and configured (`openclaw onboard --mode local` or `openclaw setup`).
- An Index Network API key. Generate one on your agents page at [index.network](https://index.network) (or your community-branded node).
- [Bun](https://bun.sh) — the installer is a Bun script (Node 20+ also works if you swap the shebang).

## Install

From a clone of this repo:

```bash
bun packages/edge-claw/install.ts <YOUR_INDEX_API_KEY>
# or
INDEX_API_KEY=<YOUR_INDEX_API_KEY> bun packages/edge-claw/install.ts
```

The installer does three things and **does not impersonate the agent**:

1. Writes `mcp.servers.index` in `~/.openclaw/openclaw.json`, pointed at `https://protocol.index.network/mcp` with your API key in `x-api-key`.
2. Sets `channels.telegram.streaming.mode = off` so OpenClaw doesn't dump per-tool "Tidepooling..." status drafts into your chat.
3. Copies the workspace markdown bundle (`BOOTSTRAP.md`, `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, `prompts/*.md`) into `~/.openclaw/workspace/`.

After the installer:

```bash
openclaw gateway restart
```

Send any message in your chat. Edge Claw runs `BOOTSTRAP.md` end-to-end on the first turn, installs its cron jobs, sends a welcome message, and deletes `BOOTSTRAP.md` so subsequent sessions skip the ritual.

## Workspace layout

| File | Purpose |
| --- | --- |
| `BOOTSTRAP.md` | One-time first-run ritual: greet, run onboarding, capture platform handle, install cron jobs, welcome, delete self. Gets deleted by the agent in the last step. |
| `AGENTS.md` | Operating instructions + canonical voice exemplars (welcome, morning digest, ambient update, greeting drafts). The exemplars are the bar for tone, structure, and information density. |
| `SOUL.md` | Voice, banned vocabulary, "never name the plumbing", boundaries, continuity. |
| `IDENTITY.md` | Edge Claw record (name, vibe, emoji). |
| `USER.md` | Lived notebook — populated by `BOOTSTRAP.md` from the user's onboarding answers. |
| `TOOLS.md` | MCP endpoint, full tool family list, output translation table, channel formatting, URL preservation rule. |
| `HEARTBEAT.md` | Background tasks that run on the OpenClaw heartbeat tick: ambient discovery, accepted opportunities, signal freshness, memory curation. |
| `prompts/negotiation.md` | Self-contained prompt for the every-1m negotiation pickup cron. |
| `prompts/digest.md` | Self-contained prompt for the daily 08:00 digest cron. |

## Architecture

Time-sensitive work runs as **OpenClaw cron jobs**, not heartbeat tasks:

- The heartbeat tick is configurable but its default is 30m. Per-task `interval:` values in `HEARTBEAT.md` can't fire faster than the tick.
- Cron has its own scheduler (`every 1m` for negotiation pickup, cron-string `0 8 * * *` for the digest), runs in isolated sessions with `--light-context` so each tick is cheap, and announces deliveries to the user's last channel.

The two cron jobs are installed by `BOOTSTRAP.md` Step 7 via `openclaw cron add`. If the OpenClaw CLI's gateway scope check rejects the call, the CLI falls back to writing `~/.openclaw/cron/jobs.json` directly — the jobs still land.

The remaining ambient/accepted/freshness/memory work stays on the heartbeat tick because 30-minute latency is acceptable for those flows.

## Testing a from-scratch install

```bash
# Wipe what BOOTSTRAP.md owns
openclaw config unset mcp.servers.index
openclaw config unset channels.telegram.streaming.mode

# Drop the workspace md bundle
rm -rf ~/.openclaw/workspace/{BOOTSTRAP,AGENTS,SOUL,IDENTITY,USER,TOOLS,HEARTBEAT}.md ~/.openclaw/workspace/prompts

# Re-run the installer
bun packages/edge-claw/install.ts <YOUR_INDEX_API_KEY>

# Restart and message your agent
openclaw gateway restart
```

For a clean main-session test, also reset the OpenClaw main session via the Control UI — otherwise the agent may resume from a half-completed bootstrap turn.

## License

MIT. See [LICENSE](../../LICENSE) at the repo root.
