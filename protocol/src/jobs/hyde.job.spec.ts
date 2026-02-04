import { describe, it, expect, mock, beforeEach } from 'bun:test';
import {
  cleanupExpiredHyde,
  refreshStaleHyde,
  type HydeJobDeps,
} from './hyde.job';

describe('HydeJob', () => {
  describe('cleanupExpiredHyde', () => {
    it('returns count of deleted expired HyDE documents', async () => {
      const deleteExpiredHydeDocuments = mock(async () => 3);
      const deps: HydeJobDeps = {
        database: {
          deleteExpiredHydeDocuments,
        } as HydeJobDeps['database'],
      };
      const count = await cleanupExpiredHyde(deps);
      expect(count).toBe(3);
      expect(deleteExpiredHydeDocuments).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when no expired documents', async () => {
      const deleteExpiredHydeDocuments = mock(async () => 0);
      const deps: HydeJobDeps = {
        database: {
          deleteExpiredHydeDocuments,
        } as HydeJobDeps['database'],
      };
      const count = await cleanupExpiredHyde(deps);
      expect(count).toBe(0);
    });
  });

  describe('refreshStaleHyde', () => {
    it('returns 0 when no stale documents', async () => {
      const getStaleHydeDocuments = mock(async () => []);
      const deps: HydeJobDeps = {
        database: {
          getStaleHydeDocuments,
          getIntentForIndexing: mock(async () => null),
          deleteHydeDocumentsForSource: mock(async () => 0),
        } as HydeJobDeps['database'],
      };
      const count = await refreshStaleHyde(deps);
      expect(count).toBe(0);
      expect(getStaleHydeDocuments).toHaveBeenCalledTimes(1);
    });

    it('deletes HyDE for source when intent is missing (archived) and returns 0', async () => {
      const staleDoc = {
        id: 'hyde-1',
        sourceType: 'intent' as const,
        sourceId: 'intent-archived',
        sourceText: null,
        strategy: 'mirror',
        targetCorpus: 'profiles',
        hydeText: 'x',
        hydeEmbedding: [0.1],
        context: null,
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        expiresAt: null,
      };
      const getStaleHydeDocuments = mock(async () => [staleDoc]);
      const getIntentForIndexing = mock(async () => null);
      const deleteHydeDocumentsForSource = mock(async () => 1);
      const deps: HydeJobDeps = {
        database: {
          getStaleHydeDocuments,
          getIntentForIndexing,
          deleteHydeDocumentsForSource,
        } as HydeJobDeps['database'],
      };
      const count = await refreshStaleHyde(deps);
      expect(count).toBe(0);
      expect(getIntentForIndexing).toHaveBeenCalledWith('intent-archived');
      expect(deleteHydeDocumentsForSource).toHaveBeenCalledWith(
        'intent',
        'intent-archived'
      );
    });
  });
});
