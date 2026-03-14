# Ghost Invite CTA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Differentiate the opportunity card CTA for ghost vs onboarded users — ghost users get "Invite to chat" with an AI-generated, editable invite message sent via email; onboarded users keep the existing "Start chat" flow.

**Architecture:** Backend exposes `isGhost` on opportunity responses and a new invite-message generation endpoint. Chat service detects ghost recipients and queues email on first message. Frontend reads `isGhost` to route between existing chat flow and a prefill-based invite flow. Ghost claim extended to transfer chat sessions.

**Tech Stack:** TypeScript, Drizzle ORM, BullMQ, LangChain (OpenRouter), Resend, React, React Router

**Design doc:** `docs/plans/2026-03-14-ghost-invite-cta-design.md`

---

### Task 1: Expose `isGhost` in opportunity API response

**Files:**
- Modify: `protocol/src/services/opportunity.service.ts:176-242` (getOpportunityWithPresentation)
- Modify: `protocol/src/lib/protocol/support/opportunity.presentation.ts:24-30` (presentOpportunity)

**Step 1: Add `isGhost` to the opportunity presentation response**

In `opportunity.service.ts`, the `getOpportunityWithPresentation()` method already fetches user records for `otherPartyIds` at line 204. The user record includes `isGhost`. Add it to the response object.

```typescript
// In getOpportunityWithPresentation(), after line 217 (otherPartyInfo assignment):
const counterpartUser = userRecords[0];
const isCounterpartGhost = counterpartUser?.isGhost ?? false;

// In the return object (after line 238), add:
isGhost: isCounterpartGhost,
```

**Step 2: Set `primaryActionLabel` based on ghost status**

In `opportunity.service.ts`, in the `getOpportunityWithPresentation()` return block, the `presentation` object is built at line 218. After it, add label logic:

```typescript
// After line 218 (presentation = presentOpportunity(...))
const primaryActionLabel = isCounterpartGhost ? 'Invite to chat' : 'Start chat';
```

Add `primaryActionLabel` to the return object alongside `isGhost`.

**Step 3: Verify the change**

Run: `cd protocol && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add protocol/src/services/opportunity.service.ts
git commit -m "feat(opportunity): expose isGhost and primaryActionLabel in opportunity response"
```

---

### Task 2: Create invite generator agent

**Files:**
- Create: `protocol/src/lib/protocol/agents/invite.generator.ts`
- Modify: `protocol/src/lib/protocol/agents/model.config.ts:15-31`

**Step 1: Add model config entry**

In `model.config.ts`, add to `MODEL_CONFIG` (line 28, before `chatTitleGenerator`):

```typescript
inviteGenerator:      { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 512 },
```

**Step 2: Create the invite generator agent**

Create `protocol/src/lib/protocol/agents/invite.generator.ts`:

```typescript
/**
 * Invite Generator Agent
 *
 * Generates contextual, editable invite messages for ghost users.
 * Produces warm, concise messages (~3-5 sentences) referencing why two
 * users were matched, with optional referrer mention.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createModel } from "./model.config";

const model = createModel("inviteGenerator");

const InviteInputSchema = z.object({
  recipientName: z.string(),
  senderName: z.string(),
  opportunityInterpretation: z.string(),
  senderIntents: z.array(z.string()),
  recipientIntents: z.array(z.string()),
  referrerName: z.string().optional(),
});

const InviteOutputSchema = z.object({
  message: z.string().describe("The invite message text, ready to edit and send"),
});

export type InviteInput = z.infer<typeof InviteInputSchema>;
export type InviteOutput = z.infer<typeof InviteOutputSchema>;

const SYSTEM_PROMPT = `You generate short, warm invite messages for a professional networking platform called Index.

The sender wants to reach out to someone whose profile matched theirs. Generate a conversational message (~3-5 sentences) that:
- Greets the recipient by name
- Briefly explains why they were matched (reference the opportunity interpretation)
- Mentions the sender's relevant intent or interest
- If a referrer is provided, naturally mentions that the referrer suggested they connect
- Ends with an open question or gentle CTA
- Uses a warm but professional tone — not salesy, not stiff

Do NOT include a subject line. This is a chat message, not an email.
Do NOT use placeholder brackets like [Name]. Use the actual names provided.`;

/**
 * Generates a contextual invite message for a ghost user.
 * @param input - Context about sender, recipient, and opportunity
 * @returns Generated invite message text
 */
export async function generateInviteMessage(input: InviteInput): Promise<InviteOutput> {
  const validated = InviteInputSchema.parse(input);

  const structuredModel = model.withStructuredOutput(InviteOutputSchema);

  const userPrompt = `Generate an invite message with this context:
- Sender: ${validated.senderName}
- Recipient: ${validated.recipientName}
- Why they matched: ${validated.opportunityInterpretation}
- Sender's interests: ${validated.senderIntents.join(', ') || 'Not specified'}
- Recipient's interests: ${validated.recipientIntents.join(', ') || 'Not specified'}${validated.referrerName ? `\n- Referred by: ${validated.referrerName}` : ''}`;

  const result = await structuredModel.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(userPrompt),
  ]);

  return result;
}
```

**Step 3: Verify**

Run: `cd protocol && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/agents/invite.generator.ts protocol/src/lib/protocol/agents/model.config.ts
git commit -m "feat(agent): add invite message generator for ghost user outreach"
```

---

### Task 3: Add invite-message endpoint to opportunity controller

**Files:**
- Modify: `protocol/src/controllers/opportunity.controller.ts:24-213`
- Modify: `protocol/src/services/opportunity.service.ts`

**Step 1: Add `generateInviteMessage` method to OpportunityService**

In `opportunity.service.ts`, add a new method that:
1. Loads the opportunity
2. Validates the viewer is an actor
3. Finds the ghost counterpart
4. Gathers context (intents, interpretation, introducer)
5. Calls the invite generator agent
6. Returns the message

```typescript
/**
 * Generate an invite message for a ghost user counterpart in an opportunity.
 * @param opportunityId - The opportunity ID
 * @param viewerId - The authenticated user requesting the invite
 * @returns Generated invite message or error
 */
async generateInviteMessage(opportunityId: string, viewerId: string) {
  const opp = await this.db.getOpportunity(opportunityId);
  if (!opp) {
    return { error: 'Opportunity not found', status: 404 };
  }

  const isActor = opp.actors.some((a) => a.userId === viewerId);
  if (!isActor) {
    return { error: 'Not authorized', status: 403 };
  }

  const counterpart = opp.actors.find(
    (a) => a.role !== 'introducer' && a.userId !== viewerId
  ) ?? opp.actors.find((a) => a.userId !== viewerId);

  if (!counterpart) {
    return { error: 'No counterpart found', status: 400 };
  }

  const [viewer, recipient] = await Promise.all([
    this.db.getUser(viewerId),
    this.db.getUser(counterpart.userId),
  ]);

  if (!recipient?.isGhost) {
    return { error: 'Counterpart is not a ghost user', status: 400 };
  }

  const introducer = opp.actors.find((a) => a.role === 'introducer');
  const introducerUser = introducer ? await this.db.getUser(introducer.userId) : null;

  // Gather intents for context
  const [senderIntents, recipientIntents] = await Promise.all([
    this.db.getActiveIntents(viewerId).then(intents => intents.map(i => i.title)),
    this.db.getActiveIntents(counterpart.userId).then(intents => intents.map(i => i.title)),
  ]);

  const { generateInviteMessage: generate } = await import('../lib/protocol/agents/invite.generator');

  const result = await generate({
    recipientName: recipient.name ?? 'there',
    senderName: viewer?.name ?? 'Someone',
    opportunityInterpretation: opp.interpretation.reasoning,
    senderIntents,
    recipientIntents,
    referrerName: introducerUser?.name ?? undefined,
  });

  return { message: result.message };
}
```

Note: Use dynamic import for the agent to keep the service layer lightweight. The `getActiveIntents` method should already exist on the database adapter — verify during implementation. If not, use whatever method returns user intents.

**Step 2: Add controller endpoint**

In `opportunity.controller.ts`, add before the `getOpportunity` route (before line 100, since `:id` is a catch-all pattern and `/invite-message` must come before it — actually we need `/:id/invite-message` which is fine after `:id`):

```typescript
/**
 * GET /opportunities/:id/invite-message — generate an invite message for a ghost counterpart.
 */
@Get('/:id/invite-message')
@UseGuards(AuthGuard)
async getInviteMessage(req: Request, user: AuthenticatedUser, params?: RouteParams) {
  const id = params?.id;
  if (!id) {
    return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
  }

  const result = await opportunityService.generateInviteMessage(id, user.id);

  if ('error' in result && 'status' in result && typeof result.status === 'number') {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result);
}
```

**Step 3: Verify**

Run: `cd protocol && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add protocol/src/services/opportunity.service.ts protocol/src/controllers/opportunity.controller.ts
git commit -m "feat(opportunity): add invite-message generation endpoint for ghost users"
```

---

### Task 4: Create ghost invite email template

**Files:**
- Create: `protocol/src/lib/email/templates/ghost-invite.template.ts`
- Modify: `protocol/src/lib/email/templates/index.ts`

**Step 1: Create the email template**

Create `protocol/src/lib/email/templates/ghost-invite.template.ts` following the pattern from `opportunity-notification.template.ts`:

```typescript
import { escapeHtml, sanitizeUrlForHref } from '../../escapeHtml';

/**
 * Email template for ghost user invite — sent when an onboarded user
 * messages a ghost user for the first time.
 */
export function ghostInviteTemplate(
  recipientName: string,
  senderName: string,
  messageContent: string,
  replyUrl: string,
  unsubscribeUrl: string
) {
  const subject = `${senderName} reached out to you on Index`;

  const safeReplyUrl = escapeHtml(sanitizeUrlForHref(replyUrl));
  const safeUnsubscribeUrl = escapeHtml(sanitizeUrlForHref(unsubscribeUrl));
  const sanitizedReplyUrlForText = sanitizeUrlForHref(replyUrl);

  const html = `
    <div style="font-family: Arial, sans-serif;">
      <p>Hey ${escapeHtml(recipientName)},</p>
      <p><strong>${escapeHtml(senderName)}</strong> reached out to you on Index:</p>
      <div style="margin: 16px 0; padding: 16px; background-color: #f9f9f9; border-left: 3px solid #041729; border-radius: 4px;">
        <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(messageContent)}</p>
      </div>
      <div style="margin: 20px 0;">
        <a href="${safeReplyUrl}" style="text-decoration: none; font-weight: bold; color: #FFFFFF; background-color: #0A0A0A; font-size: 1.1em; padding: 10px 20px; border-radius: 5px; display: inline-block;">Reply on Index</a>
      </div>
      <p>—Index</p>
      <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px; font-size: 0.8em; color: #888;">
        <p><a href="${safeUnsubscribeUrl}" style="color: #888; text-decoration: underline;">Unsubscribe</a></p>
      </div>
    </div>
  `;

  const text = `Hey ${recipientName},

${senderName} reached out to you on Index:

"${messageContent}"

Reply on Index: ${sanitizedReplyUrlForText}

—Index
`;

  return { subject, html, text };
}
```

**Step 2: Export from barrel**

In `protocol/src/lib/email/templates/index.ts`, add:

```typescript
export * from './ghost-invite.template';
```

**Step 3: Verify**

Run: `cd protocol && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add protocol/src/lib/email/templates/ghost-invite.template.ts protocol/src/lib/email/templates/index.ts
git commit -m "feat(email): add ghost invite email template"
```

---

### Task 5: Ghost email trigger in chat service

**Files:**
- Modify: `protocol/src/services/chat.service.ts:159-189` (addMessage)
- Modify: `protocol/src/queues/email.queue.ts` (if needed for helpers)

**Step 1: Add ghost detection and email queueing to `addMessage`**

In `chat.service.ts`, after the message is created and session timestamp updated (line 186), add logic to detect ghost recipient and queue email. The chat service needs access to the database adapter to look up user info and the email queue.

The chat service constructor already receives a `db` adapter. Check if it can look up users. If `getUser` is available on the db adapter, use it. Otherwise, add the needed method.

```typescript
// After line 186 (updateSessionTimestamp), add:

// Ghost invite email: on first user message in a DM, check if the peer is a ghost
if (params.role === 'user' && params.recipientUserId) {
  try {
    const recipient = await this.db.getUser(params.recipientUserId);
    if (recipient?.isGhost && !recipient.deletedAt) {
      // Check if we already sent a ghost invite for this session
      const metadata = await this.db.getSessionMetadata(params.sessionId);
      if (!metadata?.ghostInviteSent) {
        const sender = await this.db.getUser(params.sessionUserId ?? '');
        if (sender && recipient.email) {
          const { ghostInviteTemplate } = await import('../lib/email/templates');
          const appUrl = process.env.APP_URL || 'https://index.network';
          const replyUrl = `${appUrl}/onboarding?ref=invite`;
          const unsubscribeUrl = `${appUrl}/api/unsubscribe/${recipient.id}`;

          const email = ghostInviteTemplate(
            recipient.name ?? 'there',
            sender.name ?? 'Someone',
            params.content,
            replyUrl,
            unsubscribeUrl,
          );

          const { emailQueue } = await import('../queues/email.queue');
          await emailQueue.addJob({
            to: recipient.email,
            subject: email.subject,
            html: email.html,
            text: email.text,
          });

          await this.db.updateSessionMetadata(params.sessionId, { ghostInviteSent: true });
        }
      }
    }
  } catch (err) {
    // Log but don't fail the message creation
    logger.error('Failed to send ghost invite email', { error: err, sessionId: params.sessionId });
  }
}
```

Note: The exact implementation depends on how `addMessage` receives the recipient user ID. Since this is a DM-style chat (navigated via `/u/:id/chat`), the recipient is implicit from the chat session. During implementation, check how the chat controller passes this context. You may need to:
- Add `recipientUserId` as an optional param to `addMessage`
- Or look up the DM peer from the session/route context

The `sessionMetadata` table already exists (`chat_session_metadata`). Check if `updateSessionMetadata` exists on the db adapter; if not, add a simple upsert.

**Step 2: Verify**

Run: `cd protocol && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add protocol/src/services/chat.service.ts
git commit -m "feat(chat): trigger ghost invite email on first message to ghost user"
```

---

### Task 6: Ghost unsubscribe endpoint and contact import filter

**Files:**
- Modify: `protocol/src/controllers/opportunity.controller.ts` (or create a new controller)
- Modify: `protocol/src/services/contact.service.ts:118-238`

**Step 1: Add unsubscribe endpoint**

Create a simple unsubscribe route. This can be a new lightweight controller or added to an existing one. Since it's public (no auth needed — ghost users aren't logged in), it should NOT use AuthGuard.

Option: Add to a new `UnsubscribeController` or add as a public route. For simplicity, add to the opportunity controller or create a minimal controller.

```typescript
// New file: protocol/src/controllers/unsubscribe.controller.ts

import { Controller, Post } from '../lib/router/router.decorators';
import { db } from '../adapters/database.adapter'; // or inject via service
import { log } from '../lib/log';

const logger = log.controller.from('unsubscribe');

/**
 * Handles ghost user unsubscribe requests.
 * Public endpoint — no auth required (ghost users can't log in).
 */
@Controller('/unsubscribe')
export class UnsubscribeController {
  /**
   * POST /unsubscribe/:token — soft-delete a ghost user to opt out of emails.
   */
  @Post('/:token')
  async unsubscribe(req: Request, _user: unknown, params?: Record<string, string>) {
    const token = params?.token;
    if (!token) {
      return Response.json({ error: 'Missing token' }, { status: 400 });
    }

    try {
      // Token is the ghost user ID
      const result = await db.softDeleteGhostUser(token);
      if (!result) {
        return Response.json({ error: 'Not found' }, { status: 404 });
      }

      // Return a simple HTML page confirming unsubscribe
      return new Response(
        '<html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px"><h2>Unsubscribed</h2><p>You will no longer receive emails from Index.</p></body></html>',
        { headers: { 'Content-Type': 'text/html' } }
      );
    } catch (err) {
      logger.error('Unsubscribe failed', { token, error: err });
      return Response.json({ error: 'Internal error' }, { status: 500 });
    }
  }
}
```

Register this controller in `main.ts`.

The `softDeleteGhostUser` method on the database adapter should:
1. Find user by ID where `isGhost = true`
2. Set `deletedAt = now()`
3. Return true/false

**Step 2: Filter soft-deleted ghosts from contact import**

In `contact.service.ts`, at line 178-179, `getUsersByEmails` returns existing users. Soft-deleted ghost users should be treated as if they don't exist — BUT we must NOT re-create them as ghosts.

Modify the `needGhosts` filter (lines 182-187) to also exclude emails of soft-deleted ghost users:

```typescript
// After line 179 (existingByEmail map), add a check for soft-deleted ghosts:
const softDeletedGhosts = await this.db.getSoftDeletedGhostEmails(emails);
const softDeletedSet = new Set(softDeletedGhosts.map(e => e.toLowerCase()));

// Modify needGhosts filter (line 183-186):
for (const contact of validContacts) {
  if (!existingByEmail.has(contact.email) && !softDeletedSet.has(contact.email)) {
    needGhosts.push(contact);
  }
}
```

Note: The `getSoftDeletedGhostEmails` method needs to be added to the database adapter. It queries users where `isGhost = true AND deletedAt IS NOT NULL` and returns their emails. Since ghost emails get renamed on claim (`__ghost_claimed_xxx`), we need to also store the original email somewhere or check by the original email. During implementation, verify the exact mechanism — the simplest approach may be to check if any user (ghost or not, deleted or not) already has that email, and skip ghost creation for those.

Actually, a simpler approach: modify `getUsersByEmails` to also return soft-deleted users (or do a separate query). Then in the `needGhosts` loop, also check if the email belongs to a soft-deleted ghost and skip it.

**Step 3: Verify**

Run: `cd protocol && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add protocol/src/controllers/unsubscribe.controller.ts protocol/src/services/contact.service.ts protocol/src/main.ts
git commit -m "feat(unsubscribe): add ghost unsubscribe endpoint and prevent re-import of opted-out ghosts"
```

---

### Task 7: Extend ghost claim to transfer chat sessions

**Files:**
- Modify: `protocol/src/adapters/auth.adapter.ts:70-79` (claimGhostUser)

**Step 1: Add chat session transfer to the claim transaction**

In `auth.adapter.ts`, inside the `claimGhostUser` transaction (lines 71-78), add transfers for chat sessions. Chat messages are tied to sessions via `sessionId`, so transferring session ownership is sufficient.

```typescript
// Add inside the transaction, after line 76 (userContacts update):
await tx.update(schema.chatSessions).set({ userId: realUserId }).where(eq(schema.chatSessions.userId, ghostId));
```

Also handle `chatSessionMetadata` if it has a userId reference (check schema). The `chatMessages` table references `sessionId` not `userId`, so those transfer implicitly.

**Step 2: Verify**

Run: `cd protocol && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add protocol/src/adapters/auth.adapter.ts
git commit -m "feat(auth): transfer chat sessions during ghost claim"
```

---

### Task 8: Frontend — add `isGhost` to OpportunityCardData and prefill flow

**Files:**
- Modify: `frontend/src/components/chat/OpportunityCardInChat.tsx:14-44` (OpportunityCardData interface)
- Modify: `frontend/src/components/ChatContent.tsx:649-716` (handleHomeOpportunityAction)
- Modify: `frontend/src/services/opportunities.ts` (add getInviteMessage method)
- Modify: `frontend/src/app/u/[id]/chat/page.tsx:1-92` (read prefill param)

**Step 1: Add `isGhost` to OpportunityCardData**

In `OpportunityCardInChat.tsx`, add to the interface (after line 37):

```typescript
isGhost?: boolean;
```

**Step 2: Add `getInviteMessage` to opportunities service**

In `frontend/src/services/opportunities.ts`, add a method to the service factory:

```typescript
async getInviteMessage(opportunityId: string): Promise<{ message: string }> {
  const response = await fetchWithAuth(`/opportunities/${opportunityId}/invite-message`);
  if (!response.ok) throw new Error('Failed to generate invite message');
  return response.json();
},
```

**Step 3: Modify the click handler for ghost users**

In `ChatContent.tsx`, modify `handleHomeOpportunityAction` (lines 649-716). When action is "accepted" and the counterpart is a ghost, fetch the invite message and navigate with prefill:

The handler currently receives `viewerRole` but not `isGhost`. The `onPrimaryAction` callback in `OpportunityCardInChat.tsx` passes `card.viewerRole` (line 201). We need to also pass `card.isGhost`.

Update `OpportunityCardInChat.tsx` `handlePrimaryAction` (lines 194-209) to also pass `isGhost`:

```typescript
await onPrimaryAction(
  card.opportunityId,
  card.userId,
  card.viewerRole,
  card.name,
  card.isGhost,  // Add this parameter
);
```

Update the `onPrimaryAction` type to include `isGhost?: boolean`.

Then in `ChatContent.tsx`, update `handleHomeOpportunityAction` signature and body:

```typescript
const handleHomeOpportunityAction = useCallback(
  async (
    opportunityId: string,
    action: "accepted" | "rejected",
    fallbackUserId?: string,
    viewerRole?: string,
    counterpartName?: string,
    isGhost?: boolean,
  ) => {
    // ... existing code ...

    // Replace the navigation block (lines 680-687):
    if (action === "accepted" && !isIntroducer && counterpartUserId) {
      if (isGhost) {
        // Fetch invite message and navigate with prefill
        try {
          const { message } = await opportunitiesService.getInviteMessage(opportunityId);
          navigate(`/u/${counterpartUserId}/chat?prefill=${encodeURIComponent(message)}`);
        } catch {
          // Fallback: navigate without prefill
          navigate(`/u/${counterpartUserId}/chat`);
        }
      } else {
        navigate(`/u/${counterpartUserId}/chat`);
      }
    }
    // ... rest stays the same
  },
  [opportunitiesService, navigate, showError, showSuccess],
);
```

**Step 4: Read prefill param in chat page**

In `frontend/src/app/u/[id]/chat/page.tsx`, read the `prefill` query param and pass it to `ChatView`:

```typescript
const prefillMessage = searchParams.get('prefill') ?? undefined;

// In the return, pass to ChatView:
<ChatView
  userId={profileData.id}
  userName={profileData.name}
  userAvatar={profileData.avatar || undefined}
  userTitle={profileData.location || undefined}
  initialGroupId={initialGroupId}
  initialMessage={prefillMessage}
  onClose={handleClose}
  onBack={handleBack}
/>
```

Then in `ChatView`, accept `initialMessage` prop and populate the input field with it on mount. The exact implementation depends on ChatView's input mechanism — check how it handles the message input state and pre-fill it.

**Step 5: Verify**

Run: `cd frontend && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add frontend/src/components/chat/OpportunityCardInChat.tsx frontend/src/components/ChatContent.tsx frontend/src/services/opportunities.ts frontend/src/app/u/\\[id\\]/chat/page.tsx
git commit -m "feat(frontend): differentiate CTA for ghost vs onboarded users with prefill invite flow"
```

---

### Task 9: Wire up the home view to pass `isGhost` through

**Files:**
- Modify: `protocol/src/services/opportunity.service.ts` (home view builder)
- Modify: `frontend/src/components/ChatContent.tsx` (home view card mapping)

**Step 1: Ensure `isGhost` flows through the home view API**

The home view endpoint (`GET /opportunities/home`) builds card data differently than the single-opportunity endpoint. Check how `getHomeView()` in `opportunity.service.ts` constructs cards and ensure `isGhost` is included. The home view likely uses the opportunity presenter or a card-building helper — trace the code path and add `isGhost` to each card in the response.

**Step 2: Ensure the frontend maps `isGhost` from home view response to `OpportunityCardData`**

In `ChatContent.tsx`, find where `HomeViewCardItem` data is mapped to `OpportunityCardData` for rendering. Add the `isGhost` field to that mapping.

**Step 3: Verify**

Run both: `cd protocol && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire isGhost through home view API and frontend card mapping"
```

---

### Task 10: Database adapter methods for ghost operations

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts`

This task covers any database adapter methods needed by Tasks 5, 6, and 7 that don't already exist:

**Step 1: Add `softDeleteGhostUser` method**

```typescript
async softDeleteGhostUser(userId: string): Promise<boolean> {
  const result = await db.update(schema.users)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.users.id, userId), eq(schema.users.isGhost, true), isNull(schema.users.deletedAt)))
    .returning({ id: schema.users.id });
  return result.length > 0;
}
```

**Step 2: Add `getSoftDeletedGhostEmails` method (if needed)**

```typescript
async getSoftDeletedGhostEmails(emails: string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const results = await db.select({ email: schema.users.email })
    .from(schema.users)
    .where(and(
      inArray(schema.users.email, emails),
      eq(schema.users.isGhost, true),
      isNotNull(schema.users.deletedAt),
    ));
  return results.map(r => r.email);
}
```

**Step 3: Add/verify `updateSessionMetadata` method for ghost invite tracking**

Check if `updateSessionMetadata` exists. If not, add a simple upsert for the `chat_session_metadata` table that merges a JSON field.

**Step 4: Verify**

Run: `cd protocol && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add protocol/src/adapters/database.adapter.ts
git commit -m "feat(db): add ghost user soft-delete and metadata methods"
```

---

### Task 11: Register UnsubscribeController in main.ts

**Files:**
- Modify: `protocol/src/main.ts`

**Step 1: Import and register the controller**

Add the `UnsubscribeController` import and register it alongside other controllers in `main.ts`.

**Step 2: Verify**

Run: `cd protocol && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add protocol/src/main.ts
git commit -m "feat: register UnsubscribeController in server"
```

---

### Task 12: Integration test

**Files:**
- Create: `protocol/tests/ghost-invite.spec.ts`

**Step 1: Write test for the invite generation endpoint**

```typescript
import { loadEnv } from '../src/lib/env';
loadEnv();

import { describe, test, expect } from 'bun:test';

describe('Ghost Invite CTA', () => {
  test('invite-message endpoint returns message for ghost counterpart', async () => {
    // This test requires a running server with seeded data
    // Adjust based on your test infrastructure
    // Test that GET /opportunities/:id/invite-message returns { message: string }
  }, 30_000);

  test('ghost unsubscribe sets deletedAt', async () => {
    // Test POST /unsubscribe/:ghostId soft-deletes the ghost user
  });

  test('soft-deleted ghosts are not re-imported as contacts', async () => {
    // Test that importContacts skips emails of soft-deleted ghosts
  });
});
```

**Step 2: Run tests**

Run: `cd protocol && bun test tests/ghost-invite.spec.ts`

**Step 3: Commit**

```bash
git add protocol/tests/ghost-invite.spec.ts
git commit -m "test: add integration tests for ghost invite flow"
```

---

## Execution Order

Tasks can be partially parallelized:

```
Task 10 (DB adapter methods) ──┐
Task 2 (invite agent) ─────────┤
Task 4 (email template) ───────┼── Task 3 (endpoint) ── Task 5 (email trigger) ── Task 12 (tests)
Task 1 (isGhost in API) ───────┤
Task 7 (ghost claim) ──────────┘
Task 6 (unsubscribe + import filter) ── Task 11 (register controller)
Task 8 (frontend changes) ── Task 9 (home view wiring)
```

Independent tasks (1, 2, 4, 7, 10) can run in parallel. Tasks 3, 5, 6 depend on earlier tasks. Frontend tasks (8, 9) can run in parallel with backend once Task 1 is done.
