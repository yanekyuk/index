/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test';
import { processOpportunityNotification } from './notification.job';
import { onOpportunityNotification } from '../lib/notification-events';
import { userService } from '../services/user.service';
import * as emailQueueModule from '../lib/email/queue/email.queue';

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
          interpretation: { reasoning: 'A great match' },
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

    describe('addToDigest (low priority) idempotent dedupe', () => {
      let redisSetResult: string | null;
      let redisRpushCalls: number;
      const mockRedis = {
        set: mock(async () => redisSetResult),
        rpush: mock(async () => {
          redisRpushCalls += 1;
          return 1;
        }),
        expire: mock(async () => 1),
      };

      beforeEach(() => {
        redisRpushCalls = 0;
        redisSetResult = 'OK';
        mockRedis.set.mockClear();
        mockRedis.rpush.mockClear();
        mockRedis.expire.mockClear();
      });

      it('calls rpush when dedupe key is not set (SET NX returns OK)', async () => {
        spyOn(await import('../lib/redis'), 'getRedisClient').mockReturnValue(mockRedis as any);

        const db = {
          getOpportunity: mock(async () => ({
            id: 'opp-1',
            interpretation: { reasoning: 'Summary' },
          })),
        };

        await processOpportunityNotification(
          { opportunityId: 'opp-1', recipientId: 'user-1', priority: 'low' },
          { database: db as any }
        );

        expect(mockRedis.set).toHaveBeenCalled();
        expect(mockRedis.rpush).toHaveBeenCalledTimes(1);
        expect(mockRedis.expire).toHaveBeenCalled();
      });

      it('skips rpush when dedupe key already exists (SET NX returns null)', async () => {
        redisSetResult = null as any;
        spyOn(await import('../lib/redis'), 'getRedisClient').mockReturnValue(mockRedis as any);

        const db = {
          getOpportunity: mock(async () => ({
            id: 'opp-1',
            interpretation: { reasoning: 'Summary' },
          })),
        };

        await processOpportunityNotification(
          { opportunityId: 'opp-1', recipientId: 'user-1', priority: 'low' },
          { database: db as any }
        );

        expect(mockRedis.set).toHaveBeenCalled();
        expect(mockRedis.rpush).toHaveBeenCalledTimes(0);
      });
    });

    describe('sendHighPriorityEmail idempotent dedupe', () => {
      let redisSetResult: string | null;
      const mockRedis = {
        set: mock(async () => redisSetResult),
      };
      let addEmailJobSpy: ReturnType<typeof spyOn>;

      beforeEach(() => {
        redisSetResult = 'OK';
        mockRedis.set.mockClear();
        addEmailJobSpy = spyOn(emailQueueModule, 'addEmailJob').mockResolvedValue({ id: 'job-1' } as any);
        spyOn(userService, 'getUserForNewsletter').mockResolvedValue({
          id: 'user-1',
          email: 'u@example.com',
          name: 'User',
          onboarding: { completedAt: new Date() },
          prefs: {},
        } as any);
      });

      afterEach(() => {
        addEmailJobSpy.mockRestore?.();
        (userService.getUserForNewsletter as any).mockRestore?.();
      });

      it('calls addEmailJob when dedupe key is not set', async () => {
        spyOn(await import('../lib/redis'), 'getRedisClient').mockReturnValue(mockRedis as any);

        const db = {
          getOpportunity: mock(async () => ({
            id: 'opp-1',
            interpretation: { reasoning: 'Summary' },
          })),
        };

        await processOpportunityNotification(
          { opportunityId: 'opp-1', recipientId: 'user-1', priority: 'high' },
          { database: db as any }
        );

        expect(addEmailJobSpy).toHaveBeenCalledTimes(1);
        expect(addEmailJobSpy).toHaveBeenCalledWith(
          expect.objectContaining({ to: 'u@example.com', subject: expect.any(String) }),
          expect.objectContaining({ jobId: 'opportunity-email:user-1:opp-1' })
        );
      });

      it('skips addEmailJob when dedupe key already exists', async () => {
        redisSetResult = null as any;
        spyOn(await import('../lib/redis'), 'getRedisClient').mockReturnValue(mockRedis as any);

        const db = {
          getOpportunity: mock(async () => ({
            id: 'opp-1',
            interpretation: { reasoning: 'Summary' },
          })),
        };

        await processOpportunityNotification(
          { opportunityId: 'opp-1', recipientId: 'user-1', priority: 'high' },
          { database: db as any }
        );

        expect(addEmailJobSpy).toHaveBeenCalledTimes(0);
      });
    });
  });
});
