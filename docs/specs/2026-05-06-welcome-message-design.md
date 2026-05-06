---
title: "Welcome Message (First Post-Onboarding Notification)"
type: spec
tags: [openclaw-plugin, welcome, onboarding, ambient-discovery, delivery]
created: 2026-05-06
updated: 2026-05-06
---

# Welcome Message — Design Spec

**Linear issue:** IND-249
**Depends on:** IND-248 (onboarding guard — merged)
**Related:** IND-247 (Seren's formatting — applies to welcome prompt)

## Problem

After the user completes onboarding, there is no immediate follow-up message. The user calls `complete_onboarding()`, the onboarding subagent says "You're all set," and then silence until the next scheduled ambient or daily digest pass fires. The first intent is already captured during onboarding (Step 3), and `create_opportunities` runs at Step 4 — pending opportunities may already exist. The system should deliver a welcome message immediately, framing those initial results.

## Solution

Piggyback on the **ambient discovery poller** to detect the onboarding-just-completed transition and dispatch a welcome-variant prompt before the normal ambient pass. Track `welcomeSent` in plugin config to prevent re-fire.

## Design

### Trigger: Ambient Poller Pre-Check

At the top of `ambient-discovery.poller.ts` `handle()`, before the existing ambient logic:

1. Check `isOnboardingComplete()` → must be `true`
2. Check `api.pluginConfig['welcomeSent']` → must be falsy
3. If both conditions met:
   - Fetch pending opportunities (same endpoint as daily digest)
   - Build `OpportunityCandidate[]` with connect tokens and URLs
   - Build prompt with content type `'welcome'`
   - Dispatch to main agent
   - Set `api.pluginConfig['welcomeSent'] = true`
   - Return early — skip normal ambient pass for this tick

If `welcomeSent` is already true, fall through to normal ambient logic.

### New Content Type: `welcome`

Add `'welcome'` to `MainAgentContentType` and `MainAgentPayload` in `main-agent.prompt.ts`.

**Payload shape:** Same as `daily_digest` — `{ contentType: 'welcome', candidates: OpportunityCandidate[] }`. The candidates array may be empty.

**Prompt instructions (`perTypeInstruction`):**

- Frame as the first message after onboarding — "here's what I found based on what you just told me."
- If candidates exist: render as numbered list (same URL/link rules as daily digest). Each mentioned opportunity requires `confirm_opportunity_delivery` with `trigger: 'welcome'`.
- If no candidates: warm closing — acknowledge that nothing was found yet, but the system is actively looking. No empty-list awkwardness.
- Always fires regardless of candidate count.

### State: `welcomeSent` in Plugin Config

- Key: `welcomeSent` in `api.pluginConfig`
- Type: boolean
- Written once after successful welcome dispatch
- Read by the ambient poller pre-check
- Persistent across plugin restarts (plugin config is on disk)
- One-way: once true, never reset

### `readWelcomeSent` / `writeWelcomeSent` Helpers

Add to `config.ts`:

- `readWelcomeSent(api): boolean` — reads `api.pluginConfig['welcomeSent']`, returns `false` if absent
- `writeWelcomeSent(api): void` — sets `api.pluginConfig['welcomeSent'] = true`

## Files Touched

| File | Change |
|------|--------|
| `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts` | Welcome pre-check at top of `handle()` |
| `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts` | Add `'welcome'` to `MainAgentContentType`, `MainAgentPayload`, and `perTypeInstruction` |
| `packages/openclaw-plugin/src/lib/delivery/config.ts` | Add `readWelcomeSent` / `writeWelcomeSent` helpers |

## Tests

| Test | Assertion |
|------|-----------|
| Welcome fires when onboarding complete + welcomeSent false | Dispatch called with content type `'welcome'`, `welcomeSent` written to config |
| Welcome skipped when welcomeSent true | No dispatch, normal ambient pass proceeds |
| Welcome dispatches with zero candidates | Prompt built with empty candidates array, dispatch still fires |
| Welcome dispatches with candidates | Same `OpportunityCandidate[]` shape as daily digest, connect tokens fetched |
| Normal ambient pass unaffected after welcome sent | `welcomeSent = true` → ambient logic runs as before |
