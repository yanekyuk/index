import { describe, it, expect } from 'bun:test';
import { computeRemainingBudgetMs } from '../negotiation-polling.service';

describe('computeRemainingBudgetMs', () => {
  it('returns full budget when task just started', () => {
    const parkStart = new Date();
    const result = computeRemainingBudgetMs(parkStart, 300_000);
    expect(result).toBeGreaterThan(299_000);
    expect(result).toBeLessThanOrEqual(300_000);
  });

  it('returns reduced budget after time has passed', () => {
    const parkStart = new Date(Date.now() - 60_000);
    const result = computeRemainingBudgetMs(parkStart, 300_000);
    expect(result).toBeGreaterThan(239_000);
    expect(result).toBeLessThanOrEqual(240_000);
  });

  it('clamps to a floor (never returns <= 0) so BullMQ delay is always positive', () => {
    const parkStart = new Date(Date.now() - 400_000);
    const result = computeRemainingBudgetMs(parkStart, 300_000);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(5_000); // small floor, e.g. 1s
  });
});
