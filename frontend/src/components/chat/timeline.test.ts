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
