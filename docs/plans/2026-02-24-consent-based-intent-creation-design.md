# Consent-Based Intent Creation in Chat

**Date**: 2026-02-24
**Status**: Approved

## Problem

Intent creation in the LLM chat is currently automatic — the agent calls `create_intent` and persists intents to the database without asking the user. Users have no visibility or control over what intents are created on their behalf.

## Solution

Make intent creation consent-based by introducing an **intent proposal widget** in the chat UI. The agent proposes intents via interactive cards (following the existing opportunity card pattern), and the user explicitly approves or rejects each one.

## Architecture: Code-Fence + API Confirm

Follows the same pattern as opportunity widgets:

1. `create_intent` tool stops before persisting — runs inference + verification only
2. Tool returns a `intent_proposal` code fence with proposal JSON
3. Frontend parses code fences from streamed response and renders `IntentProposalCard`
4. User clicks "Create Intent" → frontend calls `POST /intents/confirm` → intent persisted
5. User clicks "Skip" → frontend calls `POST /intents/reject` → proposal dismissed

## Backend Changes

### `create_intent` Tool (intent.tools.ts)

**Before**: Runs full intent graph (inference → verification → reconciliation → executor), persists intent.

**After**: Runs inference + verification only. Returns a code fence:

```
\`\`\`intent_proposal
{
  "proposalId": "uuid",
  "description": "Looking for a CTO with distributed systems experience",
  "summary": "CTO search - distributed systems",
  "indexId": "optional-index-id",
  "sessionId": "chat-session-id",
  "confidence": 0.85,
  "speechActType": "DIRECTIVE"
}
\`\`\`
```

The tool response instructs the LLM to include the code fence verbatim (same pattern as opportunities).

### New Endpoint: `POST /intents/confirm`

- **Auth**: Required (AuthGuard)
- **Body**: `{ proposalId, description, sessionId?, indexId? }`
- **Action**: Runs the full intent graph with `operationMode: 'create'`
- **Returns**: Created intent with id, payload, summary

### New Endpoint: `POST /intents/reject`

- **Auth**: Required (AuthGuard)
- **Body**: `{ proposalId }`
- **Action**: Logs rejection for analytics/agent context
- **Returns**: 200 OK

## Frontend Changes

### Code Fence Parsing (ChatContent.tsx)

Add `intent_proposal` parsing alongside existing `opportunity` parsing:

- New regex: `/```intent_proposal\s*\n([\s\S]*?)```/g`
- New `MessageSegment` type: `{ type: "intent_proposal", data: IntentProposalData }`
- Deduplication by `proposalId`
- Skeleton during streaming (partial blocks)

### IntentProposalCard Component

```
+---------------------------------------------+
|  * Proposed Intent                          |
|                                             |
|  "Looking for a CTO with distributed        |
|   systems experience"                       |
|                                             |
|  Confidence: 85%  .  Directive              |
|                                             |
|  [v Create Intent]  [x Skip]               |
+---------------------------------------------+
```

**States**:
- `pending` — Actionable buttons (Create Intent / Skip)
- `loading` — Spinner on Create Intent button during API call
- `created` — Green check, "Intent Created", buttons disabled
- `rejected` — Muted styling, "Skipped", buttons disabled

**Actions**:
- "Create Intent" → `POST /intents/confirm` → update card in-place to `created`
- "Skip" → `POST /intents/reject` → update card in-place to `rejected`

### Status Tracking

Follow opportunity card pattern — maintain a `proposalStatusMap` in ChatContent, fetch current statuses on mount for historical messages.

## Agent Prompt Changes (chat.prompt.ts)

1. Remove instructions for automatic intent creation
2. Add: `create_intent` returns a proposal widget — include the code fence verbatim
3. Add: Explain to user that creating an intent enables background discovery
4. Update onboarding Step 6: Propose intent via widget instead of auto-creating
5. Instruct agent to acknowledge when user approves/rejects (agent sees intents in context on next turn)

## Interaction Flow

```
User: "I'm looking for a React Native engineer for my startup"

Agent: "That's a great goal! I've prepared this as a proposed intent for you.
Creating it will let me continuously look for matches in the background.

```intent_proposal
{"proposalId":"...","description":"Looking for a React Native engineer for startup","confidence":0.9,...}
```

Would you like me to refine the description, or go ahead and create it?"

[User clicks "Create Intent" on the widget]

[Widget updates to show green "Intent Created"]

[User sends next message]

Agent: "Your intent is now active! I'll be looking for React Native engineers
across your networks. In the meantime, ..."
```

## What This Does NOT Change

- **Intent graph pipeline** — inference, verification, reconciliation, executor remain the same
- **`create_intent` tool name** — stays as `create_intent`
- **Opportunity `createIntentSuggested` callback** — out of scope (see Follow-Up below)
- **Other intent tools** — `update_intent`, `delete_intent`, `read_intents` unchanged
- **Non-chat intent creation** — file uploads, API, integrations unaffected

---

## Follow-Up: Opportunity Search Refactor

**Tracked separately** — not part of this implementation.

### Problem

Opportunity search is currently intent-based: the agent needs an existing intent to find opportunities, and auto-creates one if missing (`createIntentSuggested` callback).

### Proposed Direction

1. **Decouple opportunity search from intents**: Search based on (i) user profile and (ii) search query derived from conversation, matched against other users' profile embeddings via RAG
2. **Show opportunities as drafts**: Results displayed as draft opportunity cards before any intent exists
3. **Suggest intent creation after search**: Whether or not opportunities are found, propose creating an intent (via the consent widget from this design) — explain that it enables continuous background matching
4. **Remove `createIntentSuggested` callback**: The auto-create flow goes away entirely

### Key Changes (high-level)

- `create_opportunities` tool refactored to accept search queries + user profile (not intentId)
- RAG search against `user_profiles.embedding` instead of `intents.embedding`
- Opportunity results shown with "draft" status
- Intent proposal follows naturally after opportunity results
- Background matching (via brokers) still uses intents — this creates the bridge between real-time search and async discovery
