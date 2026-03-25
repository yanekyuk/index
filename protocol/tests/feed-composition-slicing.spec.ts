import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect } from 'bun:test';
import { selectByComposition } from '../src/lib/protocol/support/opportunity.utils';

describe('selectByComposition', () => {
  const viewerId = 'user-1';

  function makeOpp(id: string, hasIntroducer: boolean, status = 'pending') {
    const actors = [
      { userId: viewerId, role: 'party' },
      { userId: `other-${id}`, role: 'party' },
    ];
    if (hasIntroducer) {
      actors.push({ userId: `intro-${id}`, role: 'introducer' });
    }
    return { id, actors, status };
  }

  it('fills soft targets when enough items exist', () => {
    const opps = [
      ...Array.from({ length: 5 }, (_, i) => makeOpp(`conn-${i}`, false)),
      ...Array.from({ length: 4 }, (_, i) => makeOpp(`cf-${i}`, true)),
      ...Array.from({ length: 3 }, (_, i) => makeOpp(`exp-${i}`, false, 'expired')),
    ];
    const result = selectByComposition(opps, viewerId);
    const connections = result.filter((o) => o.status !== 'expired' && !o.actors.some((a) => a.role === 'introducer'));
    const connectorFlows = result.filter((o) => o.status !== 'expired' && o.actors.some((a) => a.role === 'introducer'));
    const expired = result.filter((o) => o.status === 'expired');
    expect(connections.length).toBe(3);
    expect(connectorFlows.length).toBe(2);
    expect(expired.length).toBe(2);
  });

  it('redistributes slots when a category is underrepresented', () => {
    const opps = [
      ...Array.from({ length: 5 }, (_, i) => makeOpp(`conn-${i}`, false)),
      makeOpp('cf-0', true),
    ];
    const result = selectByComposition(opps, viewerId);
    // 1 connector-flow (under target of 2), extra slot goes to connections
    const connections = result.filter((o) => !o.actors.some((a) => a.role === 'introducer'));
    expect(connections.length).toBeGreaterThan(3);
  });

  it('returns all items when fewer than total soft target', () => {
    const opps = [makeOpp('conn-0', false), makeOpp('cf-0', true)];
    const result = selectByComposition(opps, viewerId);
    expect(result.length).toBe(2);
  });

  it('preserves input order within each category', () => {
    const opps = [
      makeOpp('conn-0', false),
      makeOpp('conn-1', false),
      makeOpp('conn-2', false),
      makeOpp('conn-3', false),
    ];
    const result = selectByComposition(opps, viewerId);
    const ids = result.map((o) => o.id);
    expect(ids[0]).toBe('conn-0');
    expect(ids[1]).toBe('conn-1');
    expect(ids[2]).toBe('conn-2');
  });
});
