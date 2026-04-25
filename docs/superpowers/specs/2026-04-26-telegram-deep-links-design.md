# Telegram Deep Links for Opportunity Digest Messages

## Problem

Digest messages delivered via Telegram (daily digest and ambient discovery) show opportunity summaries with plain-text names and generic "next step" suggestions. People's names are not clickable to their profiles, and there are no action URLs for accepting or skipping opportunities. The dispatcher LLM is instructed to construct links from extracted userIds, but this is unreliable — the LLM frequently omits them.

## Solution

1. Two new frontend pages (`/opportunities/:id/accept` and `/opportunities/:id/skip`) that wrap existing API endpoints as URL-addressable entry points for external channels (Telegram, email, etc.).
2. Make `startChat()` idempotent so the accept page gracefully handles already-accepted opportunities.
3. Move link generation from the dispatcher LLM to deterministic code in the evaluator prompt candidate blocks.

## Design

### Frontend: Accept Page (`/opportunities/:id/accept`)

Route: `/opportunities/:id/accept` — a loading page that performs the accept flow and redirects.

Flow:
1. Show centered spinner with "Connecting..."
2. Call `POST /opportunities/:id/start-chat`
3. **Success** — redirect to `/chat/:conversationId`
4. **Already accepted** — `startChat()` now handles this idempotently (see backend section), returns `{ conversationId }`, redirect to `/chat/:conversationId`
5. **Not authenticated** — redirect to `/` (home shows auth modal)
6. **Not authorized / not found** — show error with "Go Home" button

File: `frontend/src/app/opportunities/[id]/accept/page.tsx`

### Frontend: Skip Page (`/opportunities/:id/skip`)

Route: `/opportunities/:id/skip` — a loading page that rejects the opportunity and redirects home.

Flow:
1. Show centered spinner
2. Call `PATCH /opportunities/:id/status` with `{ status: "rejected" }`
3. **Success** — redirect to `/` with toast "Opportunity skipped"
4. **Already rejected/expired** — redirect to `/` silently (already done)
5. **Not authenticated** — redirect to `/` (home shows auth modal)
6. **Not authorized / not found** — show error with "Go Home" button

File: `frontend/src/app/opportunities/[id]/skip/page.tsx`

### Frontend: Route Registration

Add both routes to `frontend/src/routes.tsx`:
```
/opportunities/:id/accept
/opportunities/:id/skip
```

### Backend: Idempotent `startChat()`

Current behavior (`opportunity.service.ts:439`): Returns 400 when opportunity status is not `pending` or `draft`.

New behavior: When opportunity status is `accepted`, resolve the counterpart, call `getOrCreateDM()`, unhide the conversation, and return `{ conversationId, counterpartUserId, opportunity }` — same response shape as a fresh accept. No status change needed since it's already accepted. Skip the side effects (sibling acceptance, contact upsert) since those ran on the original accept.

Other terminal statuses (`rejected`, `expired`) still return 400 — you can't start a chat on a rejected opportunity.

### OpenClaw Plugin: Evaluator Prompts

Both `digest-evaluator.prompt.ts` and `opportunity-evaluator.prompt.ts`:

- Accept `frontendUrl` as a new parameter
- Add pre-computed URLs to each candidate block:
  ```
  [1] opportunityId: abc | userId: xyz
      profileUrl: https://index.network/u/xyz
      acceptUrl: https://index.network/opportunities/abc/accept
      skipUrl: https://index.network/opportunities/abc/skip
      headline: ...
      summary: ...
  ```
- Update output instructions to: "Format person names as `[Name](profileUrl)`. After each opportunity summary, add `[Connect ›](acceptUrl)` and `[Skip](skipUrl)` on their own line."

The `OpportunityCandidate` interface gains three optional fields: `profileUrl`, `acceptUrl`, `skipUrl`.

Callers (`daily-digest.poller.ts`, ambient discovery poller) compute these URLs from `frontendUrl` + candidate data before passing to the prompt builders.

### OpenClaw Plugin: Dispatcher Prompt

`delivery.prompt.ts` `channelStyleBlock()`:

- Remove the `frontendUrl`-based link construction instructions (current lines 44-51 that tell the LLM to build `[View Profile]` and `[Start Chat ›]` links from userIds)
- Replace with: "Preserve all markdown links from the content as-is. Do not construct, modify, or remove URLs."

The `frontendUrl` parameter to `buildDispatcherPrompt()` becomes unused and can be removed. The `dispatchDelivery()` call in `daily-digest.poller.ts` no longer needs to pass `frontendUrl`.

### Expected Telegram Message Output

```
**[Myles O'Neil](https://index.network/u/abc123): A connection for agentic commerce**

Myles O'Neil's work on agentic commerce fits your broader frontier-tech interests.
[Connect ›](https://index.network/opportunities/opp123/accept)  [Skip](https://index.network/opportunities/opp123/skip)
```

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/routes.tsx` | Add two route entries |
| `frontend/src/app/opportunities/[id]/accept/page.tsx` | New file — accept redirect page |
| `frontend/src/app/opportunities/[id]/skip/page.tsx` | New file — skip redirect page |
| `backend/src/services/opportunity.service.ts` | Handle `accepted` status idempotently in `startChat()` |
| `packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts` | Add `frontendUrl` param, pre-computed URLs in candidates, link formatting instructions |
| `packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts` | Same as above |
| `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts` | Compute URLs per candidate, pass `frontendUrl` to evaluator prompt |
| `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts` | Compute URLs per candidate, pass `frontendUrl` to evaluator prompt |
| `packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts` | Remove LLM link construction, add "preserve links" instruction |
| `packages/openclaw-plugin/src/lib/delivery/delivery.dispatcher.ts` | Remove `frontendUrl` from `dispatchDelivery` if no longer needed |
