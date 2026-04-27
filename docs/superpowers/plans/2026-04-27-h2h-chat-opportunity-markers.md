# H2H Chat: Accepted-Opportunity Markers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show accepted opportunities as inline chronological markers in the h2h chat window, styled as the existing centered timestamp divider, expandable on click to reveal a 1-line summary plus a link to the opportunity detail.

**Architecture:** Frontend-only. Reuse the existing unused backend endpoint `GET /opportunities/chat-context?peerUserId=:id` which already returns accepted opportunities with `acceptedAt`, `headline`, `personalizedSummary` (LLM-presented for in-chat context, Redis-cached). In `ChatView.tsx`, fetch that list, merge with `messages` into a single timeline sorted by timestamp, and render either a message bubble or an `OpportunityDivider` per slot. Group opportunities accepted within 5 minutes of each other with no messages between them.

**Tech Stack:** React 19, React Router v7, TypeScript, Tailwind CSS 4, Vitest 4 + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-04-27-h2h-chat-opportunity-markers-design.md`

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `frontend/src/services/opportunities.ts` | Modify | Add `ChatContextOpportunity` type and `getChatContext` method |
| `frontend/src/components/chat/timeline.ts` | Create | Pure function `buildChatTimeline(messages, opportunities)` returning typed timeline items with grouping |
| `frontend/src/components/chat/timeline.test.ts` | Create | Vitest tests for the timeline builder |
| `frontend/src/components/chat/OpportunityDivider.tsx` | Create | Renders the chip + inline expansion + grouped "+N more" |
| `frontend/src/components/chat/ChatView.tsx` | Modify | Fetch chat context, build timeline, render dividers/messages |

---

### Task 1: Add `getChatContext` to the opportunities service

**Files:**
- Modify: `frontend/src/services/opportunities.ts`

- [ ] **Step 1: Add the response type and service method**

In `frontend/src/services/opportunities.ts`, add the type below the existing `OpportunityDetailResponse` interface (around line 108):

```ts
/** Single opportunity entry returned by GET /opportunities/chat-context. */
export interface ChatContextOpportunity {
  opportunityId: string;
  headline: string;
  personalizedSummary: string;
  narratorRemark: string;
  introducerName: string | null;
  peerName: string;
  peerAvatar: string | null;
  /** ISO-8601 acceptance time (from opportunities.updatedAt). May be null for legacy rows. */
  acceptedAt: string | null;
}
```

In the `createOpportunitiesService` factory, add this method right after `startChat`:

```ts
  /**
   * Fetch accepted opportunities shared between the authenticated user and
   * a peer. Used as inline context inside the h2h chat window.
   * Wraps GET /opportunities/chat-context?peerUserId=:id.
   */
  getChatContext: async (
    peerUserId: string,
  ): Promise<ChatContextOpportunity[]> => {
    const res = await api.get<{ opportunities: ChatContextOpportunity[] }>(
      `/opportunities/chat-context?peerUserId=${encodeURIComponent(peerUserId)}`,
    );
    return res.opportunities ?? [];
  },
```

- [ ] **Step 2: Verify the file type-checks**

Run from repo root:
```bash
cd frontend && bun run lint
```
Expected: No new errors in `src/services/opportunities.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/opportunities.ts
git commit -m "feat(frontend): add getChatContext client for chat-context endpoint"
```

---

### Task 2: Write the failing timeline-builder test

**Files:**
- Create: `frontend/src/components/chat/timeline.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect } from 'vitest';
import { buildChatTimeline, type TimelineItem } from './timeline';
import type { ConversationMessage } from '@/services/conversation';
import type { ChatContextOpportunity } from '@/services/opportunities';

const msg = (id: string, createdAt: string): ConversationMessage => ({
  id,
  conversationId: 'c1',
  senderId: 'u1',
  role: 'user',
  parts: [{ text: 'hi' }],
  createdAt,
});

const opp = (id: string, acceptedAt: string | null): ChatContextOpportunity => ({
  opportunityId: id,
  headline: `Headline ${id}`,
  personalizedSummary: `Summary ${id}`,
  narratorRemark: '',
  introducerName: null,
  peerName: 'Peer',
  peerAvatar: null,
  acceptedAt,
});

describe('buildChatTimeline', () => {
  it('returns an empty array for empty inputs', () => {
    expect(buildChatTimeline([], [])).toEqual([]);
  });

  it('returns only message items when there are no opportunities', () => {
    const items = buildChatTimeline(
      [msg('m1', '2026-04-27T10:00:00Z')],
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('message');
  });

  it('drops opportunities with no acceptedAt', () => {
    const items = buildChatTimeline([], [opp('o1', null)]);
    expect(items).toEqual([]);
  });

  it('interleaves opportunities and messages by timestamp', () => {
    const items = buildChatTimeline(
      [
        msg('m1', '2026-04-27T10:00:00Z'),
        msg('m2', '2026-04-27T12:00:00Z'),
      ],
      [opp('o1', '2026-04-27T11:00:00Z')],
    );
    expect(items.map((i) => i.type)).toEqual(['message', 'opportunity', 'message']);
    expect(items[0]).toMatchObject({ type: 'message', message: { id: 'm1' } });
    const op = items[1] as Extract<TimelineItem, { type: 'opportunity' }>;
    expect(op.opportunities[0].opportunityId).toBe('o1');
    expect(items[2]).toMatchObject({ type: 'message', message: { id: 'm2' } });
  });

  it('groups two opportunities within 5 minutes with no messages between', () => {
    const items = buildChatTimeline(
      [],
      [
        opp('o1', '2026-04-27T10:00:00Z'),
        opp('o2', '2026-04-27T10:03:00Z'),
      ],
    );
    expect(items).toHaveLength(1);
    const op = items[0] as Extract<TimelineItem, { type: 'opportunity' }>;
    expect(op.type).toBe('opportunity');
    expect(op.opportunities.map((o) => o.opportunityId)).toEqual(['o1', 'o2']);
    expect(op.at).toBe('2026-04-27T10:00:00Z');
  });

  it('does NOT group opportunities separated by a message', () => {
    const items = buildChatTimeline(
      [msg('m1', '2026-04-27T10:01:00Z')],
      [
        opp('o1', '2026-04-27T10:00:00Z'),
        opp('o2', '2026-04-27T10:03:00Z'),
      ],
    );
    expect(items.map((i) => i.type)).toEqual(['opportunity', 'message', 'opportunity']);
  });

  it('does NOT group opportunities more than 5 minutes apart', () => {
    const items = buildChatTimeline(
      [],
      [
        opp('o1', '2026-04-27T10:00:00Z'),
        opp('o2', '2026-04-27T10:06:00Z'),
      ],
    );
    expect(items.map((i) => i.type)).toEqual(['opportunity', 'opportunity']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && bun test src/components/chat/timeline.test.ts
```
Expected: FAIL with `Cannot find module './timeline'` or similar.

---

### Task 3: Implement the timeline builder

**Files:**
- Create: `frontend/src/components/chat/timeline.ts`

- [ ] **Step 1: Implement the module**

```ts
import type { ConversationMessage } from '@/services/conversation';
import type { ChatContextOpportunity } from '@/services/opportunities';

/** A merged timeline item: either a single message or a (possibly grouped) opportunity divider. */
export type TimelineItem =
  | { type: 'message'; at: string; message: ConversationMessage }
  | { type: 'opportunity'; at: string; opportunities: ChatContextOpportunity[] };

/** Group opportunities accepted within this many ms with no message between them. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Merge messages and accepted opportunities into a single chronological timeline.
 * Opportunities accepted within {@link GROUP_WINDOW_MS} of each other with no
 * message between them are coalesced into a single grouped entry.
 *
 * @param messages - Conversation messages in any order.
 * @param opportunities - Accepted opportunities; entries with `acceptedAt === null` are dropped.
 * @returns Timeline items sorted ascending by timestamp.
 */
export function buildChatTimeline(
  messages: ConversationMessage[],
  opportunities: ChatContextOpportunity[],
): TimelineItem[] {
  const messageItems: TimelineItem[] = messages.map((m) => ({
    type: 'message',
    at: m.createdAt,
    message: m,
  }));

  const opportunityItems: TimelineItem[] = opportunities
    .filter((o): o is ChatContextOpportunity & { acceptedAt: string } => !!o.acceptedAt)
    .map((o) => ({ type: 'opportunity', at: o.acceptedAt as string, opportunities: [o] }));

  const merged = [...messageItems, ...opportunityItems].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  // Coalesce adjacent opportunity items within the grouping window.
  const result: TimelineItem[] = [];
  for (const item of merged) {
    const last = result[result.length - 1];
    if (
      item.type === 'opportunity' &&
      last &&
      last.type === 'opportunity' &&
      new Date(item.at).getTime() - new Date(last.at).getTime() <= GROUP_WINDOW_MS
    ) {
      last.opportunities.push(...item.opportunities);
      continue;
    }
    result.push(item);
  }

  return result;
}
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
cd frontend && bun test src/components/chat/timeline.test.ts
```
Expected: PASS — all 7 tests green.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/chat/timeline.ts frontend/src/components/chat/timeline.test.ts
git commit -m "feat(frontend): add buildChatTimeline merging messages and opportunities"
```

---

### Task 4: Build the `OpportunityDivider` component

**Files:**
- Create: `frontend/src/components/chat/OpportunityDivider.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import { useState } from 'react';
import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatContextOpportunity } from '@/services/opportunities';

interface OpportunityDividerProps {
  /** One or more opportunities accepted in the same time slot (already grouped upstream). */
  opportunities: ChatContextOpportunity[];
}

const HEADLINE_MAX = 60;

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isToday) return 'Today';
  if (isYesterday) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

/**
 * Centered divider chip rendered between messages to mark the moment a shared
 * opportunity was accepted. Click toggles inline expansion showing the
 * personalized summary and a link to the opportunity detail. When multiple
 * opportunities were accepted in the same time slot, shows the earliest
 * headline plus a "+N more" affordance and lists all of them on expansion.
 */
export default function OpportunityDivider({ opportunities }: OpportunityDividerProps) {
  const [expanded, setExpanded] = useState(false);
  const [first, ...rest] = opportunities;
  const extra = rest.length;
  const headline = truncate(first.headline, HEADLINE_MAX);
  const date = first.acceptedAt ? formatDate(first.acceptedAt) : '';

  return (
    <div className="my-4">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={cn(
          'w-full flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wider',
          'hover:text-gray-600 transition-colors',
        )}
      >
        <span className="flex-1 h-px bg-gray-200" />
        <span className="flex items-center gap-1.5 normal-case tracking-normal">
          <Check className="w-3.5 h-3.5" />
          <span>Accepted &ldquo;{headline}&rdquo;</span>
          {extra > 0 && (
            <span className="text-gray-400">+{extra} more</span>
          )}
          <span className="text-gray-400">&middot; {date}</span>
        </span>
        <span className="flex-1 h-px bg-gray-200" />
      </button>

      {expanded && (
        <div className="mt-3 mx-auto max-w-md text-xs text-gray-600 space-y-2">
          {opportunities.map((opp) => (
            <div key={opp.opportunityId} className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
              <p className="font-medium text-gray-700">{opp.headline}</p>
              {opp.personalizedSummary && (
                <p className="mt-1 text-gray-500">{opp.personalizedSummary}</p>
              )}
              <Link
                to={`/opportunities/${opp.opportunityId}`}
                className="inline-block mt-1.5 text-gray-500 hover:text-gray-800 underline"
              >
                View opportunity
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
cd frontend && bun run lint
```
Expected: no new errors in `src/components/chat/OpportunityDivider.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/chat/OpportunityDivider.tsx
git commit -m "feat(frontend): add OpportunityDivider chip for in-chat opportunity markers"
```

---

### Task 5: Wire the divider into `ChatView`

**Files:**
- Modify: `frontend/src/components/chat/ChatView.tsx`

- [ ] **Step 1: Add imports near the top of the file**

In `frontend/src/components/chat/ChatView.tsx`, add to the existing imports:

```tsx
import { apiClient } from '@/lib/api';
import { createOpportunitiesService, type ChatContextOpportunity } from '@/services/opportunities';
import { buildChatTimeline } from './timeline';
import OpportunityDivider from './OpportunityDivider';
```

- [ ] **Step 2: Add chat-context fetching state and effect**

After the existing `const messages = ...` line (currently `ChatView.tsx:64`), add:

```tsx
  const [acceptedOpportunities, setAcceptedOpportunities] = useState<ChatContextOpportunity[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setAcceptedOpportunities([]);
      return;
    }
    // We don't have access to the typed `useAuthenticatedAPI` hook here; reuse
    // the same `apiClient` the ConversationContext uses to keep auth consistent.
    const opportunities = createOpportunitiesService(apiClient as unknown as ReturnType<typeof import('@/lib/api').useAuthenticatedAPI>);
    opportunities
      .getChatContext(userId)
      .then((list) => {
        if (!cancelled) setAcceptedOpportunities(list);
      })
      .catch((err) => {
        console.error('[ChatView] Failed to load chat context:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);
```

- [ ] **Step 3: Replace the messages map with the unified-timeline render**

In `ChatView.tsx`, find the block currently between `{messages.map((message, index) => {` and its closing `})}` (lines 264–307). Replace the entire block with:

```tsx
            {(() => {
              const timeline = buildChatTimeline(messages, acceptedOpportunities);
              return timeline.map((item, index) => {
                const prev = timeline[index - 1];
                const showTimestamp =
                  item.type === 'message' &&
                  (index === 0 ||
                    (prev && prev.type === 'message' &&
                      new Date(item.at).getTime() - new Date(prev.at).getTime() > 300_000));

                if (item.type === 'opportunity') {
                  return (
                    <OpportunityDivider
                      key={`opp-${item.opportunities[0].opportunityId}`}
                      opportunities={item.opportunities}
                    />
                  );
                }

                const message = item.message;
                const isOwn = message.senderId === user?.id;
                const textPart = (message.parts as { text?: string }[] | undefined)?.find((p) => p.text)?.text;
                const content = textPart ?? '';
                if (!content.trim()) return null;

                return (
                  <div key={message.id}>
                    {showTimestamp && message.createdAt && (
                      <div className="text-center text-xs text-gray-400 uppercase tracking-wider my-4">
                        {(() => {
                          const d = new Date(message.createdAt);
                          const now = new Date();
                          const isToday = d.toDateString() === now.toDateString();
                          const yesterday = new Date(now);
                          yesterday.setDate(yesterday.getDate() - 1);
                          const isYesterday = d.toDateString() === yesterday.toDateString();
                          const label = isToday ? 'Today' : isYesterday ? 'Yesterday' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                          return `${label}, ${formatTime(message.createdAt)}`;
                        })()}
                      </div>
                    )}
                    <div className={cn('flex items-end gap-2', isOwn ? 'justify-end' : 'justify-start')}>
                      {!isOwn && (
                        <Link to={`/u/${userId}`} className="flex-shrink-0">
                          <UserAvatar avatar={userAvatar} id={userId} name={userName} size={32} />
                        </Link>
                      )}
                      <div className={cn('max-w-[70%] rounded-2xl px-4 py-2', isOwn ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900')}>
                        <article className={cn('text-sm', isOwn && 'text-white')}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                        </article>
                      </div>
                      {isOwn && (
                        <Link to={`/u/${user?.id}`} className="flex-shrink-0">
                          <UserAvatar avatar={user?.avatar} id={user?.id} name={user?.name} size={32} />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
```

The key behavioral change vs. the old block: `showTimestamp` is now driven by the previous *timeline item*, so an opportunity divider in the slot before a message suppresses the redundant timestamp divider (the divider already conveys "time passed here").

- [ ] **Step 4: Run lint to catch any type errors**

```bash
cd frontend && bun run lint
```
Expected: no new errors in `ChatView.tsx`.

- [ ] **Step 5: Verify the existing timeline test still passes**

```bash
cd frontend && bun test src/components/chat/timeline.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/ChatView.tsx
git commit -m "feat(frontend): interleave accepted-opportunity dividers in h2h chat"
```

---

### Task 6: Manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

From the repo root:
```bash
bun run dev
```
Pick `frontend` (and `backend` in another shell — `cd backend && bun run dev`).

- [ ] **Step 2: Open a h2h chat with a peer that has at least one accepted opportunity**

Navigate to `http://127.0.0.1:5173/chat/<peer-user-id>` (or open via the chat list UI).

Verify, in order:
1. The opportunity divider chip renders centered, styled like a hairline divider with the check glyph + truncated headline + relative date.
2. Clicking the chip expands a small card showing the full headline, the `personalizedSummary`, and a "View opportunity" link.
3. Messages and dividers are interleaved by timestamp — for a peer with multiple accepted opportunities, dividers appear at the right moments in the message flow.
4. When two opportunities are accepted within 5 minutes with no messages between, they collapse into a single chip with `+N more`; expansion shows both.
5. When an opportunity divider precedes a message that would otherwise show a 5-minute timestamp divider, the timestamp divider is suppressed (no double-divider).

- [ ] **Step 3: Verify a peer with NO accepted opportunities still works**

Open a chat with someone you've only DM'd directly. Confirm the chat renders with no dividers, no errors in the browser console.

- [ ] **Step 4: Verify a peer with NO messages but accepted opportunities still works**

Open a chat where the only history is an accepted opportunity (no messages). Confirm the divider renders alone, and sending a new message places the message after the divider.

- [ ] **Step 5: Resolve any visual regressions before considering the task complete**

If anything looks off, fix it inline in `OpportunityDivider.tsx` or `ChatView.tsx` and re-verify. Then commit any tweaks:

```bash
git add -p frontend/src/components/chat/
git commit -m "fix(frontend): visual tweaks for opportunity divider"
```

---

## Self-Review

**Spec coverage:**
- ✅ Visual: chip styled like existing centered timestamp divider — Task 4 implements this.
- ✅ Click expand to summary + "View opportunity" link — Task 4 implements this.
- ✅ Strictly chronological by `acceptedAt` — Task 3 (`buildChatTimeline`).
- ✅ Absorbs same-slot timestamp dividers — Task 5 Step 3 (`showTimestamp` keys off previous timeline item).
- ✅ 5-min grouping with "+N more" — Tasks 3 (logic) and 4 (display).
- ✅ Backend reuse of existing endpoint — Task 1 wires the existing `/opportunities/chat-context`.
- ✅ Headline source: existing `getChatContext` presenter — consumed verbatim in Task 1.
- ✅ Acceptance time: `opportunities.updatedAt` (already populated by service as `acceptedAt`).

**Placeholder scan:** No TBDs, TODOs, or "implement later" markers. Every step contains the actual code or command to run.

**Type consistency:**
- `ChatContextOpportunity` defined in Task 1 is referenced verbatim in Tasks 2, 3, and 4.
- `TimelineItem` discriminated union defined in Task 3 is consumed in Task 5.
- `buildChatTimeline` signature `(ConversationMessage[], ChatContextOpportunity[]) => TimelineItem[]` matches across tasks.
