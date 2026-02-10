/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, it, expect } from 'bun:test';
import { decideNotificationPriority } from '../opportunity.notification';

describe('NotificationAgent - decideNotificationPriority', () => {
  it('returns immediate for confidence >= 0.8', () => {
    expect(decideNotificationPriority({ confidence: 0.9, category: 'collaboration' })).toBe('immediate');
    expect(decideNotificationPriority({ confidence: 0.8, category: 'other' })).toBe('immediate');
  });

  it('returns high for confidence >= 0.6 when below immediate threshold', () => {
    expect(decideNotificationPriority({ confidence: 0.7, category: 'collaboration' })).toBe('high');
    expect(decideNotificationPriority({ confidence: 0.6, category: 'mentorship' })).toBe('high');
  });

  it('returns high for hiring/investment/mentorship with confidence >= 0.6', () => {
    expect(decideNotificationPriority({ confidence: 0.65, category: 'hiring' })).toBe('high');
    expect(decideNotificationPriority({ confidence: 0.65, category: 'investment' })).toBe('high');
  });

  it('returns low for confidence < 0.6', () => {
    expect(decideNotificationPriority({ confidence: 0.5, category: 'collaboration' })).toBe('low');
    expect(decideNotificationPriority({ confidence: 0.3, category: 'hiring' })).toBe('low');
  });

  it('handles missing category (defaults to collaboration)', () => {
    expect(decideNotificationPriority({ confidence: 0.85, category: '' })).toBe('immediate');
    expect(decideNotificationPriority({ confidence: 0.7, category: '' })).toBe('high');
  });
});
