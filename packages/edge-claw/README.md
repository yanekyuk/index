# Edge Claw

Edge Claw is a private, on-device broker for the Index Network — a personal agent that runs locally on top of the [OpenClaw](https://openclaw.dev) gateway, watches the field for relevant overlap, surfaces the people worth interrupting you for, and silently negotiates introductions on your behalf.

It is the successor to [`@indexnetwork/openclaw-plugin`](https://github.com/indexnetwork/openclaw-plugin) — same outcome, different architecture: instead of an OpenClaw plugin running hand-rolled pollers, Edge Claw is a workspace bundle of markdown prompts plus a one-shot installer. The agent itself owns runtime behaviour by reading those prompts; OpenClaw owns scheduling (heartbeat + cron) and channel delivery.

## What you get

Once installed, Edge Claw:

- **Runs onboarding** the first time you message it (greet → profile lookup → community discovery → first signal → `complete_onboarding` → silent capture of your platform handle).
- **Sends a morning digest at 08:00 host-local time** with the connections worth your attention and the asks where you can help.
- **Surfaces ambient discoveries twice daily at 14:00 and 20:00 host-local** — selective per pass: max 3 direct (you're a party) + 3 introducer (you'd make the intro), quality-bar gated. Anything skipped lands in tomorrow's digest.
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
4. Installs three cron jobs: daily digest (`0 8 * * *`), ambient discovery afternoon (`0 14 * * *`), ambient discovery evening (`0 20 * * *`).
5. Restarts the gateway so all config changes take effect.

Send any message in your chat to bring Edge Claw online:

- **Not yet onboarded**: the agent calls `read_user_profiles()` at session start, sees `onboardingComplete: false`, and runs `BOOTSTRAP.md` — which delivers the welcome at the end of the ritual.
- **Already onboarded** (e.g. you reinstalled or migrated machines): the agent skips `BOOTSTRAP.md` and chats normally. The next ambient pass (14:00 / 20:00) or daily digest (08:00) picks you back up.
- **Onboarding got reset server-side**: the next session sees `onboardingComplete: false` and re-runs `BOOTSTRAP.md` from the still-staged file (it's *not* deleted at the end of onboarding, by design).

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
| `BOOTSTRAP.md` | First-run ritual: greet, run onboarding, capture platform handle, welcome. **Not** deleted at the end — the server's `onboardingComplete` flag is the source of truth, so the file stays around in case onboarding ever needs to be re-run. |
| `AGENTS.md` | Operating instructions + canonical voice exemplars (welcome, morning digest, ambient update, greeting drafts). The first-run gate checks `onboardingComplete` from `read_user_profiles()`, not local file state. |
| `COMMUNITY.md` | Edge Esmeralda context — dates, attendee count, programming format, design principles. The agent reads this when composing welcomes and digests. |
| `SOUL.md` | Voice, banned vocabulary, "never name the plumbing", boundaries, continuity. |
| `IDENTITY.md` | Edge Claw record (name, vibe, emoji). |
| `USER.md` | Lived notebook — populated by `BOOTSTRAP.md` from the user's onboarding answers. |
| `TOOLS.md` | MCP endpoint, full tool family list, output translation table, channel formatting, URL preservation rule. |
| `HEARTBEAT.md` | Background tasks that run on the OpenClaw heartbeat tick: ambient discovery, accepted opportunities, signal freshness, memory curation. |
| `prompts/welcome.md` | Self-contained prompt for the welcome ambient pass — used by both `BOOTSTRAP.md` Step 6 and the install-time hooks dispatch. Self-dedupes via `memory/welcome-state.json` and gates on server-side `onboardingComplete`. |
| `prompts/digest.md` | Self-contained prompt for the daily 08:00 digest cron. |
| `prompts/ambient.md` | Self-contained prompt for the 14:00 + 20:00 ambient discovery crons. Selective: max 3 direct + 3 introducer per dispatch, dedup via `memory/heartbeat-state.json:lastAmbientHash`. |

## Architecture

Time-sensitive work (the daily digest) runs as an **OpenClaw cron job**, not a heartbeat task — cron has its own scheduler and runs in isolated sessions with `--light-context` so each tick is cheap. The cron job is installed by `install.ts` and restarts with the gateway.

The remaining ambient/accepted/freshness/memory work stays on the heartbeat tick because 30-minute latency is acceptable for those flows.

## License

MIT. See [LICENSE](../../LICENSE) at the repo root.
