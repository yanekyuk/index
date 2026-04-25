# Telegram Deep Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make opportunity digest messages in Telegram actionable — people's names link to profiles, and each opportunity has clickable accept/skip URLs.

**Architecture:** Two thin frontend redirect pages wrap existing API endpoints for external entry. Backend `startChat()` gains idempotency for already-accepted opportunities. Evaluator prompts embed pre-computed URLs per candidate so the dispatcher LLM just preserves them.

**Tech Stack:** React Router v7, Vite, Bun, Express, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-26-telegram-deep-links-design.md`

---

### Task 1: Make `startChat()` idempotent for already-accepted opportunities

**Files:**
- Modify: `backend/src/services/opportunity.service.ts:428-522`
- Modify: `backend/src/services/tests/opportunity.service.startChat.spec.ts:95-104`

- [ ] **Step 1: Update the existing test that asserts 400 on accepted status**

In `backend/src/services/tests/opportunity.service.startChat.spec.ts`, change the test at line 95 from asserting a 400 error to asserting idempotent success:

```typescript
  it('returns conversation idempotently when opportunity is already accepted', async () => {
    const opp = makeOpportunity({ status: 'accepted' });
    const { service, db } = makeServiceWithDb(opp);

    const result = await service.startChat(OPP_ID, VIEWER_ID);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.conversationId).toBe(CONV_ID);
    expect(result.counterpartUserId).toBe(PEER_ID);
    expect(db.getOrCreateDM).toHaveBeenCalledWith(VIEWER_ID, PEER_ID);
    expect(db.unhideConversation).toHaveBeenCalledWith(VIEWER_ID, CONV_ID);
    // No status change or side effects — those ran on the original accept
    expect(db.updateOpportunityStatus).not.toHaveBeenCalled();
    expect(db.acceptSiblingOpportunities).not.toHaveBeenCalled();
    expect(db.upsertContactMembership).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Add test for rejected/expired still returning 400**

Add a new test right after the one above:

```typescript
  it('rejects with 400 when opportunity is rejected or expired', async () => {
    for (const status of ['rejected', 'expired'] as const) {
      const opp = makeOpportunity({ status });
      const { service } = makeServiceWithDb(opp);

      const result = await service.startChat(OPP_ID, VIEWER_ID);

      expect('error' in result).toBe(true);
      if (!('error' in result)) return;
      expect(result.status).toBe(400);
    }
  });
```

- [ ] **Step 3: Run tests to verify the new test fails**

Run: `cd backend && bun test src/services/tests/opportunity.service.startChat.spec.ts`
Expected: The idempotent accepted test FAILS (current code returns 400 for accepted).

- [ ] **Step 4: Implement idempotent handling in `startChat()`**

In `backend/src/services/opportunity.service.ts`, replace the status check at lines 439-444:

```typescript
    // Before (lines 439-444):
    if (opp.status !== 'pending' && opp.status !== 'draft') {
      return {
        error: `Cannot start chat on opportunity in status '${opp.status}'; must be pending or draft.`,
        status: 400,
      };
    }
```

With:

```typescript
    if (opp.status === 'accepted') {
      const counterpart =
        opp.actors.find((a) => a.role !== 'introducer' && a.userId !== userId)
        ?? opp.actors.find((a) => a.userId !== userId);
      if (!counterpart) {
        return { error: 'Opportunity has no counterpart to chat with', status: 400 };
      }
      let conversation: { id: string };
      try {
        conversation = await this.db.getOrCreateDM(userId, counterpart.userId);
      } catch (err) {
        logger.error('[OpportunityService.startChat] getOrCreateDM failed for accepted opp', {
          opportunityId, userId, counterpartUserId: counterpart.userId, error: err,
        });
        return { error: 'Failed to resolve conversation for this opportunity', status: 500 };
      }
      await this.db.unhideConversation(userId, conversation.id).catch((err) => {
        logger.error('[OpportunityService.startChat] unhideConversation failed (non-blocking)', {
          conversationId: conversation.id, userId, error: err,
        });
      });
      return { conversationId: conversation.id, counterpartUserId: counterpart.userId, opportunity: opp };
    }
    if (opp.status !== 'pending' && opp.status !== 'draft') {
      return {
        error: `Cannot start chat on opportunity in status '${opp.status}'; must be pending or draft.`,
        status: 400,
      };
    }
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `cd backend && bun test src/services/tests/opportunity.service.startChat.spec.ts`
Expected: ALL tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/opportunity.service.ts backend/src/services/tests/opportunity.service.startChat.spec.ts
git commit -m "feat(opportunity): make startChat idempotent for already-accepted opportunities"
```

---

### Task 2: Create the Accept redirect page

**Files:**
- Create: `frontend/src/app/opportunities/[id]/accept/page.tsx`
- Modify: `frontend/src/routes.tsx:129`

- [ ] **Step 1: Create the accept page**

Create `frontend/src/app/opportunities/[id]/accept/page.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2 } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useOpportunities } from "@/contexts/APIContext";

export default function AcceptOpportunityPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const opportunitiesService = useOpportunities();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate("/", { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const result = await opportunitiesService.startChat(id!);
        if (!cancelled) {
          navigate(`/chat/${result.conversationId}`, { replace: true });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Something went wrong";
        setError(message);
      }
    })();
    return () => { cancelled = true; };
  }, [id, authLoading, isAuthenticated, navigate, opportunitiesService]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <h2 className="text-xl font-bold text-red-600 mb-2">Error</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <button
          onClick={() => navigate("/")}
          className="px-4 py-2 bg-[#041729] text-white rounded hover:bg-[#0a2d4a]"
        >
          Go Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      <p className="text-sm text-gray-500">Connecting...</p>
    </div>
  );
}

export const Component = AcceptOpportunityPage;
```

- [ ] **Step 2: Register the route in `routes.tsx`**

In `frontend/src/routes.tsx`, add the route entry after the `/u/:id/chat` route (after line 129):

```typescript
      {
        path: "/opportunities/:id/accept",
        lazy: () => import("@/app/opportunities/[id]/accept/page"),
      },
```

- [ ] **Step 3: Verify the frontend builds**

Run: `cd frontend && bun run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/opportunities/\[id\]/accept/page.tsx frontend/src/routes.tsx
git commit -m "feat(frontend): add /opportunities/:id/accept redirect page"
```

---

### Task 3: Create the Skip redirect page

**Files:**
- Create: `frontend/src/app/opportunities/[id]/skip/page.tsx`
- Modify: `frontend/src/routes.tsx`

- [ ] **Step 1: Create the skip page**

Create `frontend/src/app/opportunities/[id]/skip/page.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2 } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useOpportunities } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";

export default function SkipOpportunityPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const opportunitiesService = useOpportunities();
  const { info } = useNotifications();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate("/", { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await opportunitiesService.updateStatus(id!, "rejected");
        if (!cancelled) {
          info("Opportunity skipped");
          navigate("/", { replace: true });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const status = (err as { status?: number })?.status;
        if (status === 400) {
          navigate("/", { replace: true });
          return;
        }
        const message = err instanceof Error ? err.message : "Something went wrong";
        setError(message);
      }
    })();
    return () => { cancelled = true; };
  }, [id, authLoading, isAuthenticated, navigate, opportunitiesService, info]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <h2 className="text-xl font-bold text-red-600 mb-2">Error</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <button
          onClick={() => navigate("/")}
          className="px-4 py-2 bg-[#041729] text-white rounded hover:bg-[#0a2d4a]"
        >
          Go Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );
}

export const Component = SkipOpportunityPage;
```

- [ ] **Step 2: Register the route in `routes.tsx`**

In `frontend/src/routes.tsx`, add the route entry right after the accept route:

```typescript
      {
        path: "/opportunities/:id/skip",
        lazy: () => import("@/app/opportunities/[id]/skip/page"),
      },
```

- [ ] **Step 3: Verify the frontend builds**

Run: `cd frontend && bun run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/opportunities/\[id\]/skip/page.tsx frontend/src/routes.tsx
git commit -m "feat(frontend): add /opportunities/:id/skip redirect page"
```

---

### Task 4: Add pre-computed URLs to evaluator prompts

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts`
- Modify: `packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts`

- [ ] **Step 1: Add URL fields to `OpportunityCandidate` and update the ambient evaluator prompt**

In `packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts`:

Replace the `OpportunityCandidate` interface (lines 3-10):

```typescript
export interface OpportunityCandidate {
  opportunityId: string;
  userId: string;
  headline: string;
  personalizedSummary: string;
  suggestedAction: string;
  narratorRemark: string;
  profileUrl?: string;
  acceptUrl?: string;
  skipUrl?: string;
}
```

Update the `candidateBlock` construction (lines 23-36) to include URLs when present:

```typescript
  const candidateBlock = candidates
    .map(
      (c, i) =>
        [
          `[${i + 1}] opportunityId: ${c.opportunityId} | userId: ${c.userId}`,
          ...(c.profileUrl ? [`    profileUrl: ${c.profileUrl}`] : []),
          ...(c.acceptUrl ? [`    acceptUrl: ${c.acceptUrl}`] : []),
          ...(c.skipUrl ? [`    skipUrl: ${c.skipUrl}`] : []),
          `    headline: ${sanitizeField(c.headline)}`,
          `    summary: ${sanitizeField(c.personalizedSummary)}`,
          `    suggestedAction: ${sanitizeField(c.suggestedAction)}`,
          ...(c.narratorRemark
            ? [`    narratorRemark: ${sanitizeField(c.narratorRemark)}`]
            : []),
        ].join('\n'),
    )
    .join('\n\n');
```

Replace the output instruction at line 66:

```
'For each chosen opportunity output: the opportunityId and userId on the first line, then headline, one-sentence summary, and suggested next step.',
```

With:

```
'OUTPUT FORMAT for each chosen opportunity:',
'- Format the person\'s name as a markdown link: [Name](profileUrl)',
'- Write the headline (bold) and a one-sentence summary.',
'- On a new line, add action links: [Connect ›](acceptUrl)  [Skip](skipUrl)',
'- Use the exact URLs from the candidate data — do not modify or construct URLs.',
```

- [ ] **Step 2: Update the digest evaluator prompt**

In `packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts`:

Update the `candidateBlock` construction (lines 18-31) identically:

```typescript
  const candidateBlock = candidates
    .map(
      (c, i) =>
        [
          `[${i + 1}] opportunityId: ${c.opportunityId} | userId: ${c.userId}`,
          ...(c.profileUrl ? [`    profileUrl: ${c.profileUrl}`] : []),
          ...(c.acceptUrl ? [`    acceptUrl: ${c.acceptUrl}`] : []),
          ...(c.skipUrl ? [`    skipUrl: ${c.skipUrl}`] : []),
          `    headline: ${sanitizeField(c.headline)}`,
          `    summary: ${sanitizeField(c.personalizedSummary)}`,
          `    suggestedAction: ${sanitizeField(c.suggestedAction)}`,
          ...(c.narratorRemark
            ? [`    narratorRemark: ${sanitizeField(c.narratorRemark)}`]
            : []),
        ].join('\n'),
    )
    .join('\n\n');
```

Replace the output instruction at line 65:

```
'For each chosen opportunity output: the opportunityId and userId on the first line, then headline, one-sentence summary, and suggested next step.',
```

With:

```
'OUTPUT FORMAT for each chosen opportunity:',
'- Format the person\'s name as a markdown link: [Name](profileUrl)',
'- Write the headline (bold) and a one-sentence summary.',
'- On a new line, add action links: [Connect ›](acceptUrl)  [Skip](skipUrl)',
'- Use the exact URLs from the candidate data — do not modify or construct URLs.',
```

- [ ] **Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts packages/openclaw-plugin/src/polling/daily-digest/digest-evaluator.prompt.ts
git commit -m "feat(openclaw): add pre-computed URLs to evaluator prompt candidates"
```

---

### Task 5: Compute URLs in pollers and pass to evaluator prompts

**Files:**
- Modify: `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts:105-116`
- Modify: `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts:99-111`

- [ ] **Step 1: Update the ambient discovery poller to compute URLs**

In `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts`, update the candidate mapping at lines 105-115:

```typescript
      message: opportunityEvaluatorPrompt(
        body.opportunities
          .filter((o): o is typeof o & { counterpartUserId: string } => o.counterpartUserId !== null)
          .map((o) => ({
            opportunityId: o.opportunityId,
            userId: o.counterpartUserId,
            headline: o.rendered.headline,
            personalizedSummary: o.rendered.personalizedSummary,
            suggestedAction: o.rendered.suggestedAction,
            narratorRemark: o.rendered.narratorRemark,
            profileUrl: `${config.frontendUrl}/u/${o.counterpartUserId}`,
            acceptUrl: `${config.frontendUrl}/opportunities/${o.opportunityId}/accept`,
            skipUrl: `${config.frontendUrl}/opportunities/${o.opportunityId}/skip`,
          })),
      ),
```

- [ ] **Step 2: Update the daily digest poller to compute URLs**

In `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts`, update the candidate mapping at lines 99-111:

```typescript
      message: digestEvaluatorPrompt(
        body.opportunities
          .filter((o): o is typeof o & { counterpartUserId: string } => o.counterpartUserId !== null)
          .map((o) => ({
            opportunityId: o.opportunityId,
            userId: o.counterpartUserId,
            headline: o.rendered.headline,
            personalizedSummary: o.rendered.personalizedSummary,
            suggestedAction: o.rendered.suggestedAction,
            narratorRemark: o.rendered.narratorRemark,
            profileUrl: `${config.frontendUrl}/u/${o.counterpartUserId}`,
            acceptUrl: `${config.frontendUrl}/opportunities/${o.opportunityId}/accept`,
            skipUrl: `${config.frontendUrl}/opportunities/${o.opportunityId}/skip`,
          })),
        effectiveMax,
      ),
```

- [ ] **Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts
git commit -m "feat(openclaw): compute profile/accept/skip URLs per candidate in pollers"
```

---

### Task 6: Simplify dispatcher prompt — preserve links instead of constructing them

**Files:**
- Modify: `packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts`
- Modify: `packages/openclaw-plugin/src/lib/delivery/delivery.dispatcher.ts`

- [ ] **Step 1: Update `channelStyleBlock` to remove URL construction instructions**

In `packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts`, replace `channelStyleBlock` (lines 34-56):

```typescript
function channelStyleBlock(channel: DeliveryChannel): string {
  if (channel === 'telegram') {
    return [
      'CHANNEL: Telegram (Markdown — the gateway converts to HTML automatically)',
      'Format rules:',
      '- Use **bold** for opportunity headlines.',
      '- Keep messages concise and chat-friendly. No markdown tables.',
      '- Use [text](url) for hyperlinks — they render as tappable links in Telegram.',
      '- Do NOT use raw HTML tags — they will be escaped and shown literally.',
      '- Preserve all markdown links from the content as-is. Do not construct, modify, or remove URLs.',
    ].join('\n');
  }
  return `CHANNEL: ${channel}`;
}
```

- [ ] **Step 2: Update `buildDispatcherPrompt` to remove `frontendUrl` parameter**

In the same file, replace `buildDispatcherPrompt` (lines 9-32):

```typescript
export function buildDispatcherPrompt(
  channel: DeliveryChannel,
  contentType: DeliveryContentType,
  content: string,
): string {
  const lines = [
    'You are delivering a message to the user via their active OpenClaw gateway.',
    'Always deliver the content below — do not skip or suppress it.',
  ];

  lines.push(
    '',
    channelStyleBlock(channel),
    '',
    contentTypeContextBlock(contentType),
    '',
    '===== CONTENT =====',
    content,
    '===== END CONTENT =====',
  );

  return lines.join('\n');
}
```

- [ ] **Step 3: Update `contentTypeContextBlock` to remove link construction references**

In the same file, update the `ambient_discovery` and `daily_digest` cases in `contentTypeContextBlock` (lines 58-72):

```typescript
function contentTypeContextBlock(contentType: DeliveryContentType): string {
  switch (contentType) {
    case 'ambient_discovery':
      return [
        'CONTENT TYPE: Real-time opportunity alert.',
        'Surface only signal-rich matches. For each opportunity include the headline,',
        'a one-sentence reason it\'s relevant, and the action links from the content.',
        'Keep it to 2-3 lines per opportunity max.',
      ].join('\n');
    case 'daily_digest':
      return [
        'CONTENT TYPE: Daily digest of ranked opportunities.',
        'Present as a numbered list. For each entry: headline, one-sentence summary,',
        'and the action links from the content. Add a brief intro line (e.g. "Here are today\'s top opportunities:").',
      ].join('\n');
    case 'test_message':
      return [
        'CONTENT TYPE: Delivery verification message.',
        'Format the content using all the channel formatting rules above (bold headlines,',
        'markdown links, etc.) so the user can verify that rich formatting renders correctly.',
      ].join('\n');
    case 'negotiation_accept':
      return 'CONTENT TYPE: Negotiation outcome notification — one short natural sentence.';
    default:
      return `CONTENT TYPE: ${contentType satisfies never}`;
  }
}
```

- [ ] **Step 4: Remove `frontendUrl` from `DeliveryRequest` and `dispatchDelivery`**

In `packages/openclaw-plugin/src/lib/delivery/delivery.dispatcher.ts`, remove `frontendUrl` from the interface and the call (lines 10-16, 60):

Replace the `DeliveryRequest` interface:

```typescript
export interface DeliveryRequest {
  contentType: DeliveryContentType;
  content: string;
  /** Stable per-message key for OpenClaw idempotency. */
  idempotencyKey: string;
}
```

Update line 60 to remove the `frontendUrl` argument from `buildDispatcherPrompt`:

```typescript
    message: buildDispatcherPrompt(channel, request.contentType, request.content),
```

- [ ] **Step 5: Remove `frontendUrl` from `dispatchDelivery` call sites**

In `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts`, remove `frontendUrl` from the `dispatchDelivery` call at line 163:

```typescript
  const dispatchResult = await dispatchDelivery(api, {
    contentType: 'daily_digest',
    content,
    idempotencyKey: `index:delivery:daily-digest:${config.agentId}:${dateStr}:${batchHash}:${startupNonce}`,
  });
```

In `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts`, remove `frontendUrl` from the `dispatchDelivery` call at line 169:

```typescript
  const dispatchResult = await dispatchDelivery(api, {
    contentType: 'ambient_discovery',
    content,
    idempotencyKey: `index:delivery:opportunity-batch:${config.agentId}:${dateStr}:${batchHash}:${startupNonce}`,
  });
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd packages/openclaw-plugin && npx tsc --noEmit`
Expected: No type errors. (If the plugin doesn't have a standalone tsconfig, verify by building: `cd packages/openclaw-plugin && bun run build` or check from root.)

- [ ] **Step 7: Commit**

```bash
git add packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts packages/openclaw-plugin/src/lib/delivery/delivery.dispatcher.ts packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts
git commit -m "refactor(openclaw): remove LLM link construction from dispatcher, preserve evaluator links"
```
