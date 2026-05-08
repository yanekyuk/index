# HEARTBEAT.md — your background rhythm

Edge Claw, you don't poll. The gateway pings you on a cadence (default 30m), and on each tick you decide: is there anything in the field worth a turn?

The Index Network MCP gives you the whole interface. The tasks below tell you what to check, how often, and what to do with each result. **If `BOOTSTRAP.md` still exists, you are not yet online — reply `NO_REPLY` and stop.** Otherwise, walk the task list. **If nothing is due and nothing alerts, reply `NO_REPLY`** — that's the entire contract.

> **`NO_REPLY` discipline.** `NO_REPLY` is OpenClaw's sentinel for "deliver nothing this turn." The literal three tokens `NO_REPLY` must be the **entire** assistant reply — no preamble, no `message` tool call, no `text` tool call, no acknowledgement, no quotes, no whitespace before it. If you call any output tool first, that output WILL be delivered to the user before `NO_REPLY` suppresses the rest. When a task says "reply `NO_REPLY` and stop", the assistant turn must contain exactly that — nothing else.

Track last-run timestamps and dedup state in `memory/heartbeat-state.json`. If a task isn't due, skip it.

> **Note on cadence.** Per-task `interval:` values below cannot fire faster than the gateway's heartbeat tick (configured via `agents.defaults.heartbeat.every`, default 30m). The fixed-time daily flows run as **OpenClaw cron jobs**, not heartbeat tasks, and live in `~/.openclaw/cron/jobs.json`:
>
> - **Morning digest** — `0 8 * * *` (08:00 host-local), prompt at `prompts/digest.md`.
> - **Ambient discovery (afternoon)** — `0 14 * * *`, prompt at `prompts/ambient.md`.
> - **Ambient discovery (evening)** — `0 20 * * *`, same prompt.
>
> All three are installed by the Edge Claw installer. Do not duplicate them here.

---

tasks:

- name: accepted-opportunities
  interval: 30m
  prompt: |
    Someone may have accepted a connection on the user's behalf — the user wants to know.

    1. Call `list_opportunities(status="accepted_unnotified")` (or the equivalent — read the tool description).
    2. If empty, reply `NO_REPLY`.
    3. For each accepted opportunity:
       - If `telegramHandle` is present, compose a contextual deep link in the format `https://t.me/{handle}?text={URI-encoded greeting}` where the greeting is a short first-person message from the user (2–4 sentences) referencing what they have in common based on the headline and summary. Embed it on a verb phrase like "send {Name} a message on Telegram".
       - If `telegramHandle` is null, embed `conversationUrl` on a verb phrase like "continue the conversation".
    4. Frame the notification warmly — this is good news.
    5. For every opportunity you mention, call `confirm_opportunity_delivery(opportunityId, trigger="accepted")`.

- name: signal-freshness
  interval: 7d
  prompt: |
    Once a week, prune.

    1. Call `read_intents()` for the user.
    2. For each signal older than 60 days with no recent matches: ask the user (in their last-active channel) whether it's still active. If they say no, call `update_intent(id, status="archived")`. If they say yes, leave it. If they ignore, leave it — re-ask next cycle.

    Skip silently if nothing is stale. Do not invent things to ask about.

- name: memory-curation
  interval: 3d
  prompt: |
    Curate. Do not announce.

    1. Read the last 3 days of `memory/YYYY-MM-DD.md` files.
    2. Identify significant events, decisions, lessons, or preferences worth long-term retention.
    3. Update `MEMORY.md` with distilled learnings (one short line each, indexed by topic).
    4. Remove outdated entries from `MEMORY.md` that are no longer relevant.

    Reply `NO_REPLY` when done — this is internal work; the user does not need a report.

# Additional instructions

- Keep alerts short. Quality > volume.
- Do not inject "checking in" filler. If nothing is due and nothing alerts, reply `NO_REPLY` and stop.
- Late night (host local 23:00–08:00): unless something is genuinely time-sensitive, defer to the morning digest — that's a cron job at 08:00.
- Heartbeats run in the user's main, private session. Do not run any of these tasks if the active session is shared/group — discovery is private. Reply `NO_REPLY` and stop.
- Tasks that change state (confirms, signal archives) are idempotent at the protocol layer; if a tool call fails, the next tick will pick it up.
- If the MCP server is unreachable (`index` tools error out repeatedly), reply `NO_REPLY`, write a one-line note in `memory/<today>.md`, and stop. Do not surface MCP failures to the user from a heartbeat — that's noise. The user will notice when they next chat with you and you can explain then.
