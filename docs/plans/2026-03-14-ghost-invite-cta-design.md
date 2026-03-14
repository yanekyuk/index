# Ghost vs Onboarded User CTA Design

**Issue**: IND-161 — Opportunity card CTA should differ for ghost vs onboarded users
**Date**: 2026-03-14
**Status**: Approved

## Summary

The primary action on an opportunity card should differ based on whether the matched user is a ghost (imported contact, not yet signed up) or a fully onboarded user. Ghost users receive an "Invite to chat" flow with an AI-generated, editable invite message sent via email. Onboarded users get the existing "Start chat" flow.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Invite message generation | Backend LLM agent | Contextual messages referencing shared intents/opportunity |
| Chat session for ghost | Create real DB-backed session immediately | Simplest; transfers via existing ghost claim flow |
| XMTP handling | Skip for ghost users | Ghost can't authenticate XMTP; kicks in after onboarding |
| Referrer line | Include from introducer actor | Data already available in opportunity actors |
| UI after sending invite | Navigate to chat view | Reinforces conversation started; user can add more context |
| Message editing | Pre-fill chat input (no modal) | Reuses existing chat UI, simpler |
| Email trigger | On first message send to ghost | Email always contains what user actually sent |
| Ghost unsubscribe | Soft-delete ghost, prevent re-import | Respects opt-out; direct signup still allowed |

## Design

### 1. API Changes

**Opportunity response** — Add `isGhost` boolean to opportunity presentation data. The service layer resolves this by looking up the counterpart user's `isGhost` flag.

**Invite generation endpoint** — `GET /opportunities/:id/invite-message`:
1. Loads opportunity (actors, intents, interpretation, context)
2. Calls `invite.generator` agent to produce contextual invite message
3. Returns `{ message: string }`

**Ghost email trigger** — No new endpoint. Chat service detects ghost recipient on message creation and queues email via existing Resend infra.

### 2. Invite Generator Agent

**File**: `protocol/src/lib/protocol/agents/invite.generator.ts`

**Input** (Zod schema):
- `recipientName` — ghost user's name
- `senderName` — inviter's name
- `opportunityInterpretation` — why they matched
- `senderIntents` — relevant intents from the sender
- `recipientIntents` — relevant intents/profile info from the ghost
- `referrerName` — optional, from introducer actor if present

**Output**: `{ message: string }` — invite text ready to edit

**Behavior**: Generates a warm, concise message (~3-5 sentences) referencing why they were matched, what the sender is looking for, and optionally who referred them. Conversational tone, no subject line (it's a chat message).

**Model config**: Lightweight model, low temperature.

### 3. Ghost Email Flow

**Trigger**: Chat service detects ghost recipient on message send (`isGhost === true AND deletedAt == null`), queues email.

**Email template**: `ghost-invite.template.ts`:
- Sender's name and context ("reached out to you on Index")
- The actual message content the sender wrote
- CTA button: "Reply on Index" → deep-link to signup with redirect to chat
- Unsubscribe link

**Rate limiting**: Only the first message triggers an email. Tracked via `ghostInviteSent: boolean` in chat session metadata.

**Unsubscribe flow**:
- Endpoint: `GET /unsubscribe/:token` (token encodes ghost user ID)
- Action: soft-delete the ghost user (`deletedAt` timestamp set)
- Soft-deleted ghosts are excluded from contact import — `ContactService.importContacts` filters out emails belonging to soft-deleted ghost users, preventing re-creation
- Direct signup still allowed — if a soft-deleted ghost registers, normal auth flow proceeds; ghost claim skips since ghost row is soft-deleted

### 4. Ghost Claim Extension

The existing `claimGhostUser()` in `auth.adapter.ts` already transfers `chatSessions.userId`. This extension adds the transfer to the claim transaction alongside the existing transfers:
- `chat_sessions.userId` from ghost ID to real user ID (added to claim transaction)
- `chat_messages` transfer implicitly (tied to sessions)
- `chat_session_metadata` and `chat_message_metadata` transfer with sessions

Post-claim: user sees the chat session with the invite as the first message. XMTP kicks in for subsequent messages.

### 5. Frontend Changes

**OpportunityCardData** — Add `isGhost?: boolean`.

**CTA label** — Server-driven via `primaryActionLabel`. Backend sets "Invite to chat" for ghost, "Start chat" for onboarded. No frontend label logic.

**Click handler** — In `ChatContent.tsx`:
- Ghost: call `GET /opportunities/:id/invite-message`, navigate to `/u/${userId}/chat` with `{ state: { prefill: message } }` via React Router navigation state
- Onboarded: existing flow (navigate to `/u/${userId}/chat`)

**Chat input pre-fill** — Chat page reads `location.state.prefill`, passes it as `initialMessage` to `ChatView`. User edits and sends.

**No new components** — no modals, no drawers. Reuses existing chat UI.
