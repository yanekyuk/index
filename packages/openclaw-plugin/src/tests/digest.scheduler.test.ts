import { describe, expect, it } from 'bun:test';
import { msUntilNextDigest } from '../digest.scheduler.js';

describe('msUntilNextDigest', () => {
  it('returns ms until same day if before digest time', () => {
    // 06:00 local time, digest at 08:00 → 2 hours
    const now = new Date('2026-04-22T06:00:00');
    const result = msUntilNextDigest('08:00', now);
    expect(result).toBe(2 * 60 * 60 * 1000);
  });

  it('returns ms until next day if after digest time', () => {
    // 10:00 local time, digest at 08:00 → 22 hours until next 08:00
    const now = new Date('2026-04-22T10:00:00');
    const result = msUntilNextDigest('08:00', now);
    expect(result).toBe(22 * 60 * 60 * 1000);
  });

  it('returns ms until next day if exactly at digest time', () => {
    // 08:00 local time, digest at 08:00 → 24 hours
    const now = new Date('2026-04-22T08:00:00');
    const result = msUntilNextDigest('08:00', now);
    expect(result).toBe(24 * 60 * 60 * 1000);
  });

  it('parses HH:MM format correctly', () => {
    const now = new Date('2026-04-22T14:30:00');
    const result = msUntilNextDigest('15:45', now);
    // 14:30 → 15:45 = 1h 15m = 75 minutes
    expect(result).toBe(75 * 60 * 1000);
  });

  it('throws on invalid format (non-numeric)', () => {
    expect(() => msUntilNextDigest('8am')).toThrow('Invalid digestTime "8am" — expected HH:MM format');
  });

  it('throws on invalid format (missing colon)', () => {
    expect(() => msUntilNextDigest('0800')).toThrow('Invalid digestTime "0800" — expected HH:MM format');
  });

  it('throws on out-of-range hours', () => {
    expect(() => msUntilNextDigest('25:00')).toThrow('Invalid digestTime "25:00" — hours must be 0-23, minutes 0-59');
  });

  it('throws on out-of-range minutes', () => {
    expect(() => msUntilNextDigest('08:60')).toThrow('Invalid digestTime "08:60" — hours must be 0-23, minutes 0-59');
  });
});
