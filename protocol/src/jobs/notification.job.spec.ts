/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, it, expect, mock } from 'bun:test';
import { processOpportunityNotification } from './notification.job';
import { onOpportunityNotification } from '../lib/notification-events';

describe('NotificationJob', () => {
  describe('processOpportunityNotification', () => {
    it('skips when opportunity not found', async () => {
      const db = {
        getOpportunity: mock(async () => null),
      };
      await processOpportunityNotification(
        { opportunityId: 'opp-1', recipientId: 'user-1', priority: 'high' },
        { database: db as any }
      );
      expect(db.getOpportunity).toHaveBeenCalledWith('opp-1');
    });

    it('emits event for immediate priority (WebSocket path)', async () => {
      const payloads: Array<{ opportunityId: string; recipientId: string }> = [];
      const unsub = onOpportunityNotification((p) => payloads.push(p));

      const db = {
        getOpportunity: mock(async () => ({
          id: 'opp-1',
          interpretation: { summary: 'A great match' },
          confidence: '0.9',
        })),
      };

      await processOpportunityNotification(
        { opportunityId: 'opp-1', recipientId: 'user-1', priority: 'immediate' },
        { database: db as any }
      );

      expect(payloads).toHaveLength(1);
      expect(payloads[0]).toEqual({ opportunityId: 'opp-1', recipientId: 'user-1' });
      unsub();
    });
  });
});
