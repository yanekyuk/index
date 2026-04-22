# openclaw-plugin Domain-Driven Architecture Refactor

**Date:** 2026-04-22  
**Scope:** `packages/openclaw-plugin/src/`  
**Type:** Structural refactor — file moves, renames, and extraction only. No logic changes.

---

## Problem

`src/index.ts` currently mixes five distinct responsibilities: plugin registration, HTTP route wiring, negotiation pickup, opportunity batch polling, daily digest delivery, and test message pickup. Shared scheduling state (backoff multiplier, timers) is global. Prompts live in a flat `src/prompts/` folder disconnected from the polling logic they serve.

The result is a file that is hard to read, hard to test in isolation, and whose domain boundaries are invisible.

---

## Goal

Make each polling domain self-contained and independently understandable. `index.ts` becomes pure wiring. Each domain folder contains everything needed to understand and test that concern: the poller, its scheduler, and its prompts.

---

## Target Structure

```
src/
  index.ts                                    # Plugin entry: wires config, starts schedulers, registers route + CLI
  lib/
    openclaw/
      plugin-api.ts                           # OpenClaw SDK type shims + readModel()
    delivery/
      delivery.dispatcher.ts                  # Shared delivery routing (used by ambient-discovery + test-message)
      delivery.prompt.ts                      # Delivery relay prompt (used by dispatcher)
    utils/
      sanitize.ts                             # Field sanitizer (used by opportunity + digest prompts)
  setup/
    setup.cli.ts                              # Interactive setup wizard (openclaw index-network setup)
  polling/
    negotiator/
      negotiator.poller.ts                    # Turn pickup + silent subagent dispatch
      negotiator.scheduler.ts                 # Interval + exponential backoff scheduling
      negotiation-turn.prompt.ts              # Turn deliberation prompt (was: turn.prompt.ts)
      negotiation-accepted.prompt.ts          # Connection formed notification prompt (was: accepted.prompt.ts)
    daily-digest/
      daily-digest.poller.ts                  # Opportunity fetch + digest subagent dispatch
      daily-digest.scheduler.ts               # Time-of-day scheduling (was: digest.scheduler.ts)
      digest-evaluator.prompt.ts              # Daily digest ranking prompt (unchanged)
    ambient-discovery/
      ambient-discovery.poller.ts             # Opportunity batch evaluation + subagent dispatch
      ambient-discovery.scheduler.ts          # Interval + exponential backoff scheduling
      opportunity-evaluator.prompt.ts         # Real-time filter/eval prompt (unchanged)
    test-message/
      test-message.poller.ts                  # Test message pickup + delivery confirmation
      test-message.scheduler.ts               # Interval scheduling
```

---

## Mapping: Old → New

| Old path | New path |
|---|---|
| `src/index.ts` (poll loop, scheduleNext, backoff, triggerPoll) | split into scheduler files per domain |
| `src/index.ts` (handleNegotiationPickup) | `polling/negotiator/negotiator.poller.ts` |
| `src/index.ts` (handleOpportunityBatch) | `polling/ambient-discovery/ambient-discovery.poller.ts` |
| `src/index.ts` (handleDailyDigest) | `polling/daily-digest/daily-digest.poller.ts` |
| `src/index.ts` (handleTestMessagePickup) | `polling/test-message/test-message.poller.ts` |
| `src/delivery.dispatcher.ts` | `lib/delivery/delivery.dispatcher.ts` |
| `src/digest.scheduler.ts` | `polling/daily-digest/daily-digest.scheduler.ts` |
| `src/setup.cli.ts` | `setup/setup.cli.ts` |
| `src/plugin-api.ts` | `lib/openclaw/plugin-api.ts` |
| `src/prompts/turn.prompt.ts` | `polling/negotiator/negotiation-turn.prompt.ts` |
| `src/prompts/accepted.prompt.ts` | `polling/negotiator/negotiation-accepted.prompt.ts` |
| `src/prompts/opportunity-evaluator.prompt.ts` | `polling/ambient-discovery/opportunity-evaluator.prompt.ts` |
| `src/prompts/digest-evaluator.prompt.ts` | `polling/daily-digest/digest-evaluator.prompt.ts` |
| `src/prompts/delivery.prompt.ts` | `lib/delivery/delivery.prompt.ts` |
| `src/prompts/sanitize.ts` | `lib/utils/sanitize.ts` |

---

## Scheduler Extraction

Currently a single global backoff multiplier and poll timer in `index.ts` drives all three interval-based pollers together. After the refactor, each scheduler owns its own state:

- **`negotiator.scheduler.ts`** — 5-min base interval, exponential backoff, owns its own timer and backoff multiplier.
- **`ambient-discovery.scheduler.ts`** — same structure, independent backoff.
- **`test-message.scheduler.ts`** — same structure, independent backoff.
- **`daily-digest.scheduler.ts`** — time-of-day scheduling (extracts `msUntilNextDigest` from `digest.scheduler.ts`, which already has this logic).

Each scheduler exports a `start(config)` function called by `index.ts`. Timers are stored inside the scheduler module, not in global `index.ts` state.

---

## index.ts After Refactor

`index.ts` becomes responsible for exactly:

1. Reading plugin config (`agentId`, `apiKey`, `protocolUrl`, delivery config, digest config)
2. Registering the `openclaw index-network setup` CLI command
3. Auto-configuring the `index-network` MCP server entry
4. Registering the `POST /index-network/poll` HTTP route (required for subagent scope)
5. Calling `start()` on each scheduler

No business logic, no prompt building, no polling state.

---

## What Does Not Change

- All prompt content (no rewrites).
- All API call logic and subagent dispatch patterns.
- `plugin-api.ts` interface shape.
- `setup.cli.ts` logic.
- Test file structure (tests will be updated to import from new paths).
- `openclaw.plugin.json` and `package.json`.

---

## Notes

- `negotiation-accepted.prompt.ts` (`accepted.prompt.ts`) is tested but not currently imported in `index.ts`. It moves to `polling/negotiator/` as-is — wiring it up is out of scope for this refactor.

---

## Out of Scope

- Logic changes to any poller or prompt.
- New features.
- Test rewrites beyond import path updates.
