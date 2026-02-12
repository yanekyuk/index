/**
 * Tests for opportunity enricher: enrichOrCreate, overlap detection, semantic relatedness, and merge.
 *
 * Overlap contract: findOverlappingOpportunities(actorUserIds) is expected to return only
 * opportunities whose set of non-introducer actor userIds equals actorUserIds exactly.
 * The DB adapter implements this via exact set matching; mocks in these tests simulate that.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, test, expect } from 'bun:test';
import { enrichOrCreate } from '../opportunity.enricher';
import type { CreateOpportunityData, Opportunity } from '../../interfaces/database.interface';
import type { Embedder } from '../../interfaces/embedder.interface';

function minimalNewData(actorUserIds: string[], indexId: string, reasoning: string): CreateOpportunityData {
  const actors = actorUserIds.map((userId) => ({
    indexId,
    userId,
    role: 'party' as const,
  }));
  return {
    detection: { source: 'manual', createdBy: 'user-1', timestamp: new Date().toISOString() },
    actors,
    interpretation: {
      category: 'collaboration',
      reasoning,
      confidence: 0.8,
      signals: [{ type: 'curator_judgment', weight: 1, detail: 'Manual' }],
    },
    context: { indexId },
    confidence: '0.8',
    status: 'pending',
  };
}

function existingOpportunity(
  id: string,
  actors: Array<{ indexId: string; userId: string; role: string; intent?: string }>,
  reasoning: string,
  status: 'latent' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired' = 'pending'
): Opportunity {
  return {
    id,
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: actors.map((a) => ({ ...a, indexId: a.indexId as typeof a.indexId })),
    interpretation: {
      category: 'collaboration',
      reasoning,
      confidence: 0.75,
      signals: [],
    },
    context: {},
    confidence: '0.75',
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };
}

describe('Opportunity enricher', () => {
  test('no overlap: returns original data unchanged', async () => {
    const db = {
      findOverlappingOpportunities: async () => [] as Opportunity[],
    };
    const embedder = { generate: async () => [[0.1, 0.2], [0.3, 0.4]] } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', 'They should collaborate on AI.');
    const result = await enrichOrCreate(db, embedder, newData);
    expect(result.enriched).toBe(false);
    expect(result.data).toBe(newData);
  });

  test('overlap but not semantically related: returns original data unchanged', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      'Different topic: hardware design.'
    );
    const db = {
      findOverlappingOpportunities: async () => [existing],
    };
    const embedder = {
      generate: async () => [[1, 0, 0], [0, 1, 0]] as number[][],
    } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', 'They should collaborate on AI and ML.');
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(false);
    expect(result.data.actors).toHaveLength(newData.actors.length);
  });

  test('overlap and semantically related: returns enriched data with merged actors and expiredIds', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent' },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      'Both interested in AI and ML collaboration.'
    );
    const db = {
      findOverlappingOpportunities: async () => [existing],
    };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = {
      generate: async () => [sameVec, sameVec] as number[][],
    } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', 'They should collaborate on AI.');
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-old']);
      expect(result.resolvedStatus).toBe('pending');
      expect(result.data.detection.source).toBe('enrichment');
      expect(result.data.detection.enrichedFrom).toEqual(['opp-old']);
      expect(result.data.actors.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('enriched status is accepted when related opportunity is accepted', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent' },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      'Both interested in AI.',
      'accepted'
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = { generate: async () => [sameVec, sameVec] as number[][] } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', 'AI collaboration.');
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.resolvedStatus).toBe('accepted');
      expect(result.expiredIds).toEqual(['opp-old']);
    }
  });

  test('multiple overlapping (same non-introducer set) and related: merges all and returns all expiredIds', async () => {
    // Both opp1 and opp2 have exact same non-introducer set {user-a, user-b} as newData (exact-match contract).
    const opp1 = existingOpportunity(
      'opp-1',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent' },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      'AI collaboration match.'
    );
    const opp2 = existingOpportunity(
      'opp-2',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'peer' },
        { indexId: 'idx-1', userId: 'user-b', role: 'peer' },
      ],
      'Same domain collaboration.'
    );
    const db = {
      findOverlappingOpportunities: async () => [opp1, opp2],
    };
    const sameVec = [0.6, 0.6, 0.6];
    const embedder = {
      generate: async () => [sameVec, sameVec, sameVec] as number[][],
    } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', 'AI and ML collaboration.');
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toContain('opp-1');
      expect(result.expiredIds).toContain('opp-2');
      expect(result.expiredIds).toHaveLength(2);
      expect(result.resolvedStatus).toBe('pending');
      const userIds = new Set(result.data.actors.map((a) => a.userId));
      expect(userIds.has('user-a')).toBe(true);
      expect(userIds.has('user-b')).toBe(true);
    }
  });

  test('actor deduplication: same (indexId, userId, intent) appears once', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent' },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      'Same as new.'
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = { generate: async () => [sameVec, sameVec] as number[][] } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', 'Same as existing.');
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      const keys = result.data.actors.map((a) => `${a.indexId}:${a.userId}:${a.intent ?? ''}`);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    }
  });

  test('introducer not used for overlap; introducers preserved in merge', async () => {
    const newDataWithIntroducer: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', 'Intro reason.'),
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
        { indexId: 'idx-1', userId: 'user-intro', role: 'introducer' },
      ],
    };
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent' },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      'Match reason.'
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = { generate: async () => [sameVec, sameVec] as number[][] } as unknown as Embedder;
    const result = await enrichOrCreate(db, embedder, newDataWithIntroducer, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      const introducers = result.data.actors.filter((a) => a.role === 'introducer');
      expect(introducers.some((a) => a.userId === 'user-intro')).toBe(true);
    }
  });

  test('short reasoning uses intent overlap for relatedness', async () => {
    const sharedIntent = 'intent-xyz';
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent', intent: sharedIntent },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      'Short.'
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const embedder = { generate: async () => [] } as unknown as Embedder;
    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', 'Hi'),
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: sharedIntent },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
    };
    const result = await enrichOrCreate(db, embedder, newData);
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-old']);
      expect(result.resolvedStatus).toBe('pending');
    }
  });

  test('no non-introducer actors: returns original data unchanged', async () => {
    const newDataOnlyIntroducers: CreateOpportunityData = {
      ...minimalNewData([], 'idx-1', 'No parties'),
      actors: [{ indexId: 'idx-1', userId: 'user-intro', role: 'introducer' }],
    };
    const db = { findOverlappingOpportunities: async () => [] as Opportunity[] };
    const embedder = { generate: async () => [] } as unknown as Embedder;
    const result = await enrichOrCreate(db, embedder, newDataOnlyIntroducers);
    expect(result.enriched).toBe(false);
    expect(result.data.actors).toHaveLength(1);
  });
});
