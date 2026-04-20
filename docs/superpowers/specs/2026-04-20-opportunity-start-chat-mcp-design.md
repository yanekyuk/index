# Opportunity Start Chat via MCP

**Date:** 2026-04-20  
**Status:** Approved

## Problem

When the OpenClaw plugin surfaces a received pending opportunity to the user, the agent has no way to accept it and open a conversation. `update_opportunity` with `accepted` only updates the status — it does not create the DM conversation that the frontend's "Start Chat" button creates (`POST /opportunities/:id/start-chat`). Additionally, the MCP agent guidance does not instruct the agent to ask for user approval before accepting.

## Solution (Approach A)

Enhance the opportunity graph's `update` node so that accepting an opportunity follows the same path as "Start Chat": create the DM conversation, then return a `conversationId` the agent can surface to the user. Add approval-gating guidance to `MCP_INSTRUCTIONS`.

---

## Changes

### 1. Opportunity graph — `update` node (`opportunity.graph.ts`)

When `operationMode === 'update'` and `newStatus === 'accepted'`:

1. Fetch the opportunity and identify the counterpart actor (the non-introducer userId that is not `state.userId`).
2. Call `this.database.getOrCreateDM(state.userId, counterpartUserId)` to get or create the one-on-one conversation.
3. Call `this.database.updateOpportunityStatus(opportunityId, 'accepted')`.
4. Return `mutationResult` with `success: true`, `opportunityId`, and `conversationId`.

`getOrCreateDM` is already declared on `DatabaseInterface` — no new interface plumbing required.

Side effects (`acceptSiblingOpportunities`, `upsertContactMembership`) remain in the backend `OpportunityService.startChat` path and are not replicated here. They can be added later if needed.

### 2. `update_opportunity` tool — handler and description (`opportunity.tools.ts`)

**Handler:** Thread `conversationId` from `mutationResult` through to the success response object when `status === 'accepted'`.

**Description update for `accepted`:**
> Before: "Accept a received opportunity — signals interest in connecting. Both parties can now communicate."  
> After: "Accept a received opportunity — opens a direct conversation between both parties. Returns a `conversationId` to surface to the user."

### 3. `MCP_INSTRUCTIONS` — opportunity lifecycle guidance (`mcp.server.ts`)

Add a new `# Opportunity lifecycle` section:

```
# Opportunity lifecycle
Opportunities move through: draft → pending → accepted (or rejected).

- **draft** (you created it, not yet sent): offer to send it; confirm before calling update_opportunity with pending.
- **pending, you sent it**: waiting for the other side — nothing to do.
- **pending, you received it**: the other person is waiting for your response. Surface it to the user and ask if they want to start a chat. Only call update_opportunity with accepted after explicit user confirmation.
- **accepted**: both sides connected — a direct conversation exists.

Never accept a received opportunity without explicit user approval in the current conversation.
```

---

## Files to change

| File | Change |
|------|--------|
| `packages/protocol/src/opportunity/opportunity.graph.ts` | Add `getOrCreateDM` call and `conversationId` return in the `accepted` branch of the `update` node |
| `packages/protocol/src/opportunity/opportunity.tools.ts` | Thread `conversationId` in handler; update `accepted` description |
| `packages/protocol/src/mcp/mcp.server.ts` | Add `# Opportunity lifecycle` section to `MCP_INSTRUCTIONS` |

---

## Out of scope

- Sibling-opportunity auto-accept and contact upsert (already handled in `OpportunityService.startChat`; not replicated in graph)
- Changes to the OpenClaw bootstrap skill (`SKILL.MD.template`) — no behavioral guidance lives there after bootstrap
- Frontend changes — no frontend changes needed
