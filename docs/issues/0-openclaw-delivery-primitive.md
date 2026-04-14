# Issue 0: OpenClaw delivery primitive + agents-page test button

**Spec:** [`docs/superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md` § Issue 0](../superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md#issue-0--openclaw-delivery-primitive--test-channel)
**Plan:** [`docs/superpowers/plans/2026-04-15-openclaw-opportunity-delivery.md` § Issue 0](../superpowers/plans/2026-04-15-openclaw-opportunity-delivery.md)
**Dependencies:** none (foundational)
**Blocks:** Issues 1, 4, 5
**Layer:** OpenClaw plugin + backend + frontend

## Goal

Prove end-to-end that a backend-originated message reaches the user via OpenClaw's active gateway, and extract the reusable `dispatchDelivery` helper that every subsequent delivery-adjacent issue builds on.

## Context

The OpenClaw plugin currently polls for negotiation turns and dispatches silent subagents (`deliver: false`). To surface opportunities and morning digests to users, the plugin needs to call `subagent.run({ deliver: true, ... })` — where OpenClaw's runtime routes the subagent's output through whichever gateway (Telegram, WhatsApp, default) the user has configured. Before building the opportunity delivery machinery (Issues 1–5), we need a minimal end-to-end validation that this delivery channel actually works, plus a reusable helper factored out cleanly.

## Scope

### In
- New `dispatchDelivery(api, request)` helper in the plugin wrapping `api.runtime.subagent.run({ deliver: true, ... })`.
- New delivery-subagent prompt (`delivery.prompt.ts`) that instructs the subagent to relay server-rendered content naturally for the user's gateway.
- Backend `agent_test_messages` table + three endpoints (post, pickup, confirm) using the reservation/confirm pattern with a 60s TTL.
- Plugin poll-loop extension: one additional endpoint polled per cycle (`test-messages/pickup`).
- Agents-page "Send test message" button that POSTs to the backend endpoint.

### Out
- Any opportunity-specific logic (lands in Issues 1, 4, 5).
- Multi-channel delivery (future `channel` values beyond implicit-via-plugin).
- Frontend polling for delivery confirmation (optional polish; skipped if it complicates anything).

## Acceptance Criteria

- [ ] Clicking "Send test message" on the agents page inserts a row in `agent_test_messages`.
- [ ] Within ~30s, the OpenClaw plugin (running on any connected machine) dispatches a subagent whose output surfaces in the user's active gateway (e.g. Telegram shows the test message).
- [ ] After successful delivery, the row's `delivered_at` is committed.
- [ ] Reservation expires cleanly if the plugin crashes between pickup and confirm — the message becomes pickup-eligible again on the next poll.
- [ ] Existing negotiation poller continues to work unchanged.
- [ ] `dispatchDelivery` is used from at least one call site and is exported/reusable from a clearly-named module.

## Implementation Notes

- Plugin helper lives at `packages/openclaw-plugin/src/delivery.dispatcher.ts`.
- Backend controller at `backend/src/controllers/agent-test-message.controller.ts`; service at `backend/src/services/agent-test-message.service.ts`.
- Poll loop in `packages/openclaw-plugin/src/index.ts` extends to call `negotiations/pickup` **then** `test-messages/pickup` sequentially each cycle.
- Frontend UI change scoped to the existing agents detail page (exact file confirmed during implementation; see plan).
- Full task-level breakdown with test and implementation code: megaplan Issue 0 section.
