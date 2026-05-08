# Edge Claw

Edge Claw is a private, on-device broker for the Index Network — a personal agent that runs locally on top of the [OpenClaw](https://openclaw.dev) gateway, watches the field for relevant overlap, surfaces the people worth interrupting you for, and silently negotiates introductions on your behalf.

It is the successor to [`@indexnetwork/openclaw-plugin`](https://github.com/indexnetwork/openclaw-plugin) — same outcome, different architecture: instead of an OpenClaw plugin running hand-rolled pollers, Edge Claw is a workspace bundle of markdown prompts plus a one-shot installer. The agent itself owns runtime behaviour by reading those prompts; OpenClaw owns scheduling (heartbeat + cron) and channel delivery.

## What you get

Once installed, Edge Claw:

- **Runs onboarding** the first time you message it (greet → profile lookup → community discovery → first signal → `complete_onboarding` → silent capture of your platform handle).
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

The installer:

1. Writes `mcp.servers.index` in `~/.openclaw/openclaw.json`, pointed at `https://protocol.index.network/mcp` with your API key in `x-api-key`.
2. Sets `channels.telegram.streaming.mode = off` so OpenClaw doesn't dump per-tool status drafts into your chat.
3. Copies the workspace markdown bundle into `~/.openclaw/workspace/`.
4. Installs the daily digest cron job (`0 8 * * *`).
5. Restarts the gateway so everything takes effect.

Send any message in your chat. Edge Claw runs `BOOTSTRAP.md` end-to-end on the first turn, sends a welcome message, and deletes `BOOTSTRAP.md` so subsequent sessions skip the ritual.

## Reset

To tear down Edge Claw and start fresh (leaves Telegram token, OpenRouter key, and gateway config untouched):

```bash
bun packages/edge-claw/reset.ts
```

Then re-install:

```bash
bun packages/edge-claw/install.ts <YOUR_INDEX_API_KEY>
```

Pass `--wipe-user` to also remove `USER.md` and the `memory/` directory:

```bash
bun packages/edge-claw/reset.ts --wipe-user
```

## Workspace layout

| File | Purpose |
| --- | --- |
| `BOOTSTRAP.md` | One-time first-run ritual: greet, run onboarding, capture platform handle, welcome, delete self. Gets deleted by the agent in the last step. |
| `AGENTS.md` | Operating instructions + canonical voice exemplars (welcome, morning digest, ambient update, greeting drafts). |
| `SOUL.md` | Voice, banned vocabulary, "never name the plumbing", boundaries, continuity. |
| `IDENTITY.md` | Edge Claw record (name, vibe, emoji). |
| `USER.md` | Lived notebook — populated by `BOOTSTRAP.md` from the user's onboarding answers. |
| `TOOLS.md` | MCP endpoint, full tool family list, output translation table, channel formatting, URL preservation rule. |
| `HEARTBEAT.md` | Background tasks that run on the OpenClaw heartbeat tick: ambient discovery, accepted opportunities, signal freshness, memory curation. |
| `prompts/digest.md` | Self-contained prompt for the daily 08:00 digest cron. |

## Architecture

Time-sensitive work (the daily digest) runs as an **OpenClaw cron job**, not a heartbeat task — cron has its own scheduler and runs in isolated sessions with `--light-context` so each tick is cheap. The cron job is installed by `install.ts` and restarts with the gateway.

The remaining ambient/accepted/freshness/memory work stays on the heartbeat tick because 30-minute latency is acceptable for those flows.

## License

MIT. See [LICENSE](../../LICENSE) at the repo root.
