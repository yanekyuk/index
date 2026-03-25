import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect } from 'bun:test';
import { classifyOpportunity, FEED_SOFT_TARGETS } from '../src/lib/protocol/support/opportunity.utils';

describe('classifyOpportunity', () => {
  const viewerId = 'user-1';

  it('classifies expired opportunity as expired', () => {
    const opp = {
      actors: [{ userId: viewerId, role: 'party' }, { userId: 'user-2', role: 'party' }],
      status: 'expired',
    };
    expect(classifyOpportunity(opp, viewerId)).toBe('expired');
  });

  it('classifies opportunity with introducer as connector-flow', () => {
    const opp = {
      actors: [
        { userId: viewerId, role: 'party' },
        { userId: 'user-2', role: 'party' },
        { userId: 'user-3', role: 'introducer' },
      ],
      status: 'pending',
    };
    expect(classifyOpportunity(opp, viewerId)).toBe('connector-flow');
  });

  it('classifies opportunity without introducer as connection', () => {
    const opp = {
      actors: [{ userId: viewerId, role: 'party' }, { userId: 'user-2', role: 'party' }],
      status: 'pending',
    };
    expect(classifyOpportunity(opp, viewerId)).toBe('connection');
  });

  it('classifies expired opportunity with introducer as expired (not connector-flow)', () => {
    const opp = {
      actors: [
        { userId: viewerId, role: 'party' },
        { userId: 'user-2', role: 'party' },
        { userId: 'user-3', role: 'introducer' },
      ],
      status: 'expired',
    };
    expect(classifyOpportunity(opp, viewerId)).toBe('expired');
  });
});

describe('FEED_SOFT_TARGETS', () => {
  it('has expected default values', () => {
    expect(FEED_SOFT_TARGETS.connection).toBe(3);
    expect(FEED_SOFT_TARGETS.connectorFlow).toBe(2);
    expect(FEED_SOFT_TARGETS.expired).toBe(2);
  });
});
