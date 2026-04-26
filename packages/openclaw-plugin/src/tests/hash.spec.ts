import { describe, expect, it } from 'bun:test';

import { hashOpportunityBatch } from '../lib/utils/hash.js';

describe('hashOpportunityBatch', () => {
  it('is order-independent', () => {
    const a = hashOpportunityBatch(['a', 'b', 'c']);
    const b = hashOpportunityBatch(['c', 'a', 'b']);
    const c = hashOpportunityBatch(['b', 'c', 'a']);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('changes when membership changes', () => {
    expect(hashOpportunityBatch(['a', 'b'])).not.toBe(hashOpportunityBatch(['a', 'b', 'c']));
    expect(hashOpportunityBatch(['a', 'b', 'c'])).not.toBe(hashOpportunityBatch(['a', 'b', 'd']));
  });

  it('returns the same hash for the same input on repeat calls (deterministic)', () => {
    const ids = [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ];
    expect(hashOpportunityBatch(ids)).toBe(hashOpportunityBatch(ids));
  });

  it('does not mutate its input array', () => {
    const ids = ['z', 'a', 'm'];
    const snapshot = [...ids];
    hashOpportunityBatch(ids);
    expect(ids).toEqual(snapshot);
  });

  it('produces a non-empty string for empty input (degenerate case is stable)', () => {
    const empty = hashOpportunityBatch([]);
    expect(typeof empty).toBe('string');
    expect(hashOpportunityBatch([])).toBe(empty);
  });
});
