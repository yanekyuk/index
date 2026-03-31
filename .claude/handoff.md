---
trigger: "5 CLI bugs: (1) missing status in intent list, (2) short-form ID fails in intent show, (3) opportunity list shows Unknown counterparty and wrong confidence, (4) short-form ID fails in network join, (5) conversation show returns Forbidden for own conversations"
type: fix
branch: fix/cli-id-resolution
base-branch: dev
created: 2026-03-31
---

## Related Files
- cli/src/output/formatters.ts — intent/opportunity table formatting
- cli/src/types.ts — CLI type definitions (Opportunity, Intent)
- cli/src/intent.command.ts — intent CLI commands
- cli/src/opportunity.command.ts — opportunity CLI commands
- cli/src/network.command.ts — network join command
- cli/src/conversation.command.ts — conversation show command
- cli/src/api.client.ts — API client methods
- protocol/src/controllers/intent.controller.ts — intent endpoints
- protocol/src/controllers/opportunity.controller.ts — opportunity list endpoint
- protocol/src/controllers/index.controller.ts — index join endpoint (missing resolveIndexId)
- protocol/src/controllers/conversation.controller.ts — conversation message endpoint
- protocol/src/services/intent.service.ts — resolveId method
- protocol/src/services/index.service.ts — resolveIndexId, joinPublicIndex
- protocol/src/services/conversation.service.ts — resolveId, verifyParticipant
- protocol/src/adapters/database.adapter.ts — listIntents query (missing status), resolveConversationId, resolveIntentId, OpportunityRow

## Relevant Docs
- docs/specs/user-index-keys.md — key format and prefix-matching spec
- docs/specs/cli-intent-command.md — intent CLI spec
- docs/specs/cli-opportunity.md — opportunity CLI spec
- docs/specs/cli-network.md — network CLI spec
- docs/specs/cli-conversation.md — conversation CLI spec

## Related Issues
None — no related issues found.

## Scope

Five bugs to fix, all related to the recently shipped keys/prefix-matching feature (PR #615):

### Bug 1: Missing `status` in `index intent list`
The `listIntents` query in `database.adapter.ts` does not SELECT the `status` column from the intents table (intentStatusEnum: ACTIVE/PAUSED/FULFILLED/EXPIRED). The CLI formatter expects `intent.status` but it's undefined. Fix: add `status` to the select in `listIntents` and ensure the controller maps it through.

### Bug 2: `index intent show <shortId>` returns "Intent not found"
The `resolveIntentId` in database.adapter.ts and the controller both look correct. Investigate deeper — may be a routing issue (another route matching before `/:id`), a UUID detection false positive, or userId mismatch. Check if the short prefix actually matches when queried with LIKE.

### Bug 3: Opportunity list shows "Unknown" counterparty and wrong confidence
The API returns raw `OpportunityRow` objects which don't have a `counterpartName` field — the CLI defaults to "Unknown". The `actors` JSONB array contains participant info but names aren't extracted. Confidence shows as e.g. "0.7%" suggesting the raw 0-1 float is being displayed with a % suffix. Fix: either enrich the API response with counterpart name extracted from actors, or fix the CLI to extract it from the actors array. Fix confidence display (multiply by 100 or remove %).

### Bug 4: `index network join <shortId>` fails
The POST `/:id/join` endpoint in `index.controller.ts` passes `params.id` directly to `joinPublicIndex` without calling `resolveIndexId()` first. Fix: add ID resolution (key or prefix) before the join call, same pattern as GET `/:id`.

### Bug 5: `index conversation show <id>` returns "Forbidden: not a participant"
The user can list conversations (sees themselves as participant) but `conversation show` returns 403. `resolveConversationId` scopes by participant and `verifyParticipant` checks the same table — both should pass if the user is a participant. Investigate the actual flow: check if resolveId returns the correct conversation ID, verify participantId storage matches auth user.id.
