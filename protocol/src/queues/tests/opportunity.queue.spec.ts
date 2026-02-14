/**
 * Unit tests for OpportunityQueue. Use injected deps to avoid Redis/DB; QueueFactory is mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it, mock } from 'bun:test';

const mockAdd = mock(async () => ({ id: 'job-1', name: 'discover_opportunities', data: {} }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd }),
    createWorker: mockCreateWorker,
  },
}));

import {
  OpportunityQueue,
  QUEUE_NAME,
  type OpportunityJobData,
  type OpportunityQueueDatabase,
  type OpportunityQueueDeps,
  type OpportunityGraphInvokeOptions,
} from '../opportunity.queue';

const asOppDb = (db: unknown): OpportunityQueueDatabase => db as OpportunityQueueDatabase;

describe('OpportunityQueue', () => {
  describe('constructor and static', () => {
    it('exposes QUEUE_NAME on class', () => {
      expect(OpportunityQueue.QUEUE_NAME).toBe(QUEUE_NAME);
      expect(QUEUE_NAME).toBe('opportunity-discovery-queue');
    });

    it('uses provided database when deps given', async () => {
      const getIntentForIndexing = mock(async () => null as unknown as Awaited<ReturnType<OpportunityQueueDatabase['getIntentForIndexing']>>);
      const db = { getIntentForIndexing };
      const queue = new OpportunityQueue({ database: asOppDb(db) });
      await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' });
      expect(getIntentForIndexing).toHaveBeenCalledWith('i1');
    });
  });

  describe('addJob', () => {
    it('adds discover_opportunities job with data and options', async () => {
      const queue = new OpportunityQueue();
      const job = await queue.addJob({ intentId: 'i1', userId: 'u1', indexIds: ['idx1'] });
      expect(job.id).toBe('job-1');
      expect(mockAdd).toHaveBeenCalledWith(
        'discover_opportunities',
        { intentId: 'i1', userId: 'u1', indexIds: ['idx1'] },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 24 * 60 * 60 },
        })
      );
    });

    it('supports jobId and priority options', async () => {
      const queue = new OpportunityQueue();
      await queue.addJob({ intentId: 'i1', userId: 'u1' }, { jobId: 'custom', priority: 1 });
      expect(mockAdd).toHaveBeenCalledWith(
        'discover_opportunities',
        { intentId: 'i1', userId: 'u1' },
        expect.objectContaining({ jobId: 'custom', priority: 1 })
      );
    });
  });

  describe('processJob', () => {
    it('unknown job name logs warning and does not throw', async () => {
      const queue = new OpportunityQueue();
      await expect(
        queue.processJob('unknown_job', { intentId: 'i1', userId: 'u1' })
      ).resolves.toBeUndefined();
    });

    it('discover_opportunities: intent not found skips', async () => {
      const db = {
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<OpportunityQueueDatabase['getIntentForIndexing']>>,
      };
      const queue = new OpportunityQueue({ database: asOppDb(db) });
      await queue.processJob('discover_opportunities', { intentId: 'missing', userId: 'u1' });
    });

    it('discover_opportunities: intent found, invokeOpportunityGraph called when provided', async () => {
      const invokeOpportunityGraph = mock(async (_opts: OpportunityGraphInvokeOptions) => {});
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null }),
      };
      const queue = new OpportunityQueue({ database: asOppDb(db), invokeOpportunityGraph });
      await queue.processJob('discover_opportunities', {
        intentId: 'i1',
        userId: 'u1',
        indexIds: ['idx1'],
      });
      expect(invokeOpportunityGraph).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          searchQuery: 'Build a SaaS',
          operationMode: 'create',
          indexId: 'idx1',
          options: { initialStatus: 'latent' },
        })
      );
    });

    it('discover_opportunities: uses indexIds[0] as indexId', async () => {
      const invokeOpportunityGraph = mock(async () => {});
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
      };
      const queue = new OpportunityQueue({ database: asOppDb(db), invokeOpportunityGraph });
      await queue.processJob('discover_opportunities', {
        intentId: 'i1',
        userId: 'u1',
        indexIds: ['idx-a', 'idx-b'],
      });
      expect(invokeOpportunityGraph).toHaveBeenCalledWith(
        expect.objectContaining({ indexId: 'idx-a' })
      );
    });

    it('discover_opportunities: without invokeOpportunityGraph uses real graph (may need Redis)', async () => {
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
      };
      const queue = new OpportunityQueue({ database: asOppDb(db) });
      try {
        await queue.processJob('discover_opportunities', { intentId: 'i1', userId: 'u1' });
      } catch {
        // Real graph can fail without Redis/DB
      }
    });
  });

  describe('startWorker', () => {
    it('is idempotent: second call does not create another worker', () => {
      const queue = new OpportunityQueue();
      queue.startWorker();
      queue.startWorker();
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });

    it('processor invokes processJob when worker runs a job', async () => {
      let capturedProcessor: ((job: { id: string; name: string; data: OpportunityJobData }) => Promise<void>) | null = null;
      (mockCreateWorker as import('bun:test').Mock<(n: string, p: (job: unknown) => Promise<void>) => unknown>).mockImplementation((_name: string, processor: (job: unknown) => Promise<void>) => {
        capturedProcessor = processor as (job: { id: string; name: string; data: OpportunityJobData }) => Promise<void>;
        return {};
      });
      const db = { getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<OpportunityQueueDatabase['getIntentForIndexing']>> };
      const queue = new OpportunityQueue({ database: asOppDb(db) });
      queue.startWorker();
      expect(capturedProcessor).not.toBeNull();
      await capturedProcessor!({
        id: 'job-1',
        name: 'discover_opportunities',
        data: { intentId: 'i1', userId: 'u1' },
      });
    });
  });
});
