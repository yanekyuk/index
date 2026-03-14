/**
 * Unit tests for ProfileQueue. Use injected deps to avoid Redis/DB; QueueFactory is mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it } from 'bun:test';
import { mock } from 'bun:test';

const mockAdd = mock(async (name: string, data: unknown) => ({ id: 'job-1', name, data }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

import {
  ProfileQueue,
  QUEUE_NAME,
  type ProfileJobPayload,
} from '../profile.queue';

describe('ProfileQueue', () => {
  describe('addEnsureProfileHydeJob', () => {
    it('returns a job with name ensure_profile_hyde and data { userId: "u1" }', async () => {
      const queue = new ProfileQueue();
      const job = await queue.addEnsureProfileHydeJob({ userId: 'u1' });
      expect(job.name).toBe('ensure_profile_hyde');
      expect(job.data).toEqual({ userId: 'u1' });
      expect(mockAdd).toHaveBeenCalledWith('ensure_profile_hyde', { userId: 'u1' }, expect.any(Object));
    });
  });

  describe('addEnrichGhostJob', () => {
    it('returns a job with name ghost.enrich and data { userId: "g1" }', async () => {
      const queue = new ProfileQueue();
      const job = await queue.addEnrichGhostJob({ userId: 'g1' });
      expect(job.name).toBe('ghost.enrich');
      expect(job.data).toEqual({ userId: 'g1' });
      expect(mockAdd).toHaveBeenCalledWith('ghost.enrich', { userId: 'g1' }, expect.any(Object));
    });
  });

  describe('processJob', () => {
    it('ensure_profile_hyde invokes profile-write handler with userId', async () => {
      const invokeProfileWrite = mock(async (_userId: string) => {});
      const queue = new ProfileQueue({ invokeProfileWrite });
      await queue.processJob('ensure_profile_hyde', { userId: 'u1' });
      expect(invokeProfileWrite).toHaveBeenCalledWith('u1');
      expect(invokeProfileWrite).toHaveBeenCalledTimes(1);
    });

    it('ghost.enrich invokes enrich-ghost handler with userId', async () => {
      const invokeEnrichGhost = mock(async (_userId: string) => {});
      const queue = new ProfileQueue({ invokeEnrichGhost });
      await queue.processJob('ghost.enrich', { userId: 'g1' });
      expect(invokeEnrichGhost).toHaveBeenCalledWith('g1');
      expect(invokeEnrichGhost).toHaveBeenCalledTimes(1);
    });

    it('unknown job name logs warning and does not throw', async () => {
      const queue = new ProfileQueue();
      await expect(queue.processJob('unknown_job', { userId: 'u1' })).resolves.toBeUndefined();
    });
  });

  describe('startWorker', () => {
    it('is idempotent: second call does not create another worker', () => {
      const queue = new ProfileQueue();
      queue.startWorker();
      queue.startWorker();
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });
  });

  describe('static', () => {
    it('exposes QUEUE_NAME on class', () => {
      expect(ProfileQueue.QUEUE_NAME).toBe(QUEUE_NAME);
      expect(QUEUE_NAME).toBe('profile-hyde-queue');
    });
  });
});
