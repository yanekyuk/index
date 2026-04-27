# H2H Chat: Accepted-Opportunity Markers

**Date:** 2026-04-27
**Status:** Design approved, pending implementation plan

## Context

A human-to-human (h2h) chat in Index Network is derived from accepted opportunities — there is exactly one chat per pair of users, but a pair can accumulate multiple accepted opportunities over time (each spawning a negotiation task that references the same `conversationId`).

Today, the chat window (`frontend/src/components/chat/ChatView.tsx`) only renders messages. The opportunities that triggered the conversation — and any subsequent re-engagements — are invisible from inside the thread. The user has to leave the chat to remember why a particular reconnection happened.

## Goal

Show accepted opportunities as inline markers in the chat timeline, positioned chronologically by acceptance time, so the conversation reads as: *opportunity accepted → messages exchanged → another opportunity accepted → more messages*.

## Non-Goals

- No new opportunity detail view — link to the existing one.
- No marker on the message-list preview screen — only inside the chat window.
- No new `acceptedAt` column — `opportunities.updatedAt` is sufficient signal for accepted opportunities.
- No fallback to "any accepted opportunity between these two users" — only opportunities explicitly linked to this conversation via a negotiation task.

## Design

### Visual

Reuse the centered-divider pattern already used in `ChatView.tsx` for the >5-min timestamp gap. The marker *is* the divider for that moment — no new visual primitive.

```
───────  ✓  Accepted "Help with seed fundraising"  ·  Apr 14  ───────
```

- Same muted foreground color, hairline rule, and centering as the existing timestamp divider.
- Tiny check glyph + opportunity headline + relative date.
- Headline truncates at ~60 chars with ellipsis.

### Interaction

- Click toggles inline expansion below the divider:
  - One-line `summary` from the chat-context presenter.
  - "View opportunity" link to the existing opportunity detail view.
- Collapsed by default. State is local to the rendered list (does not need to persist across reloads).

### Positioning

- Strictly chronological by `opportunities.updatedAt` (the de facto acceptance time for accepted rows).
- Marker absorbs the existing 5-min timestamp divider when both would render in the same slot — no double-divider.
- Two opportunities accepted within 5 min of each other with no messages between them collapse into a single marker showing the earliest headline in the group plus "+N more". Expansion lists all grouped opportunities (each with its own headline + summary).

### Data flow

#### Backend

Extend the response of `GET /conversations/:id/messages` (controller: `conversation.controller.ts:100-138`):

```json
{
  "messages": [...],
  "acceptedOpportunities": [
    {
      "opportunityId": "uuid",
      "acceptedAt": "ISO-8601",
      "headline": "string",
      "summary": "string"
    }
  ]
}
```

Scoping query: opportunities where `status='accepted'` AND `id` appears in `tasks.metadata->>'opportunityId'` for some task with `taskId.conversationId = :id`. Sorted by `updatedAt` ascending.

`headline` and `summary` come from `OpportunityService.getChatContext` (`opportunity.service.ts:760`), which already runs an LLM presenter explicitly tuned for "shown inside an active chat between the two parties."

`acceptedAt` is `opportunities.updatedAt`.

#### Frontend

In `ChatView.tsx`:

1. `getMessages` service (`frontend/src/services/conversation.ts:44`) updated to return both `messages` and `acceptedOpportunities`.
2. Build a unified timeline array `Array<{ type: 'message' | 'opportunity', at: string, ... }>` and sort by `at`.
3. Map over the unified array, rendering either a message bubble or an opportunity divider chip.
4. The existing `showTimestamp` logic keys off the previous **timeline item**, not the previous message — so an opportunity divider suppresses a redundant timestamp divider in the same slot.

A small new component `OpportunityDivider.tsx` lives next to `ChatView.tsx` and handles the chip rendering, inline expansion state, and grouped "+N more" case.

## Edge cases

- **Empty chat**: an opportunity has been accepted but no messages exchanged yet. The divider renders alone at the top of the thread.
- **Long headlines**: truncate at ~60 chars, full headline available on expansion (already in `summary` context anyway).
- **Performance**: `getChatContext` is LLM-driven. Cache the presenter output per `(opportunityId, viewerUserId)` — the existing opportunity-delivery cache infrastructure (`opportunity-delivery.service.ts`) already handles this pattern; reuse it.

## Out of scope (deliberate)

- `acceptedAt` column migration — revisit only if `updatedAt` drift becomes a real problem.
- Marker on chat list preview screen.
- Showing rejected/expired opportunities — only accepted ones are part of the conversation's narrative.
- Opportunity card actions (accept/reject) inline — accepted opportunities are terminal; the chip is read-only context.

## Open questions

None blocking. Cache TTL for `getChatContext` results in this read path can be tuned during implementation.
