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
