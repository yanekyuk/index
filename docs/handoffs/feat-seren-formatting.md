---
trigger: "IND-247: Seren's Telegram message formatting for all notification types"
type: feat
branch: feat/seren-formatting
base-branch: dev
created: 2026-05-06
linear-issue: IND-247
---

## Related Files
- packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts
- packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts
- packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts
- packages/openclaw-plugin/src/polling/welcome/welcome.watcher.ts
- packages/openclaw-plugin/src/lib/delivery/config.ts
- packages/openclaw-plugin/src/lib/utils/connect-token.ts
- backend/src/controllers/opportunity.controller.ts
- backend/src/services/opportunity.service.ts

## Relevant Docs
- docs/specs/2026-05-06-seren-formatting-design.md
- docs/specs/2026-05-06-welcome-message-design.md
- docs/domain/opportunities.md
- docs/design/protocol-deep-dive.md

## Related Issues
- IND-247 Seren's Telegram message formatting for all notification types (Todo)
- IND-253 Expose introducer opportunities to notification pollers (Done)
- IND-249 OpenClaw plugin: welcome message (Done)

## Scope
Design spec at `docs/specs/2026-05-06-seren-formatting-design.md`. Summary:

1. **Backend: Approve-introduction endpoint** — New `GET /api/opportunities/:id/approve-introduction?token=...` that verifies connect-token, validates introducer role, flips approved flag, triggers negotiation, redirects to success page.

2. **Plugin: Payload changes** — Add `feedCategory: 'connection' | 'connector-flow'` to `OpportunityCandidate`, add `totalPending: number` to digest/ambient/welcome payloads.

3. **Plugin: Poller changes** — All three pollers (ambient, daily-digest, welcome) thread `feedCategory` and `totalPending` from API response. Connector-flow candidates get `/approve-introduction?token=...` URLs instead of `/connect?token=...`.

4. **Prompt: Per-type instruction rewrite** — Welcome + daily use two-section layout ("Conversations waiting" for connection, "Help your community" for connector-flow) with section-aware CTAs. Ambient is flat (agent decides). Connection candidates get &msg= greeting; connector candidates don't. Overflow count when totalPending > shown.
