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

/**
 * Meaningful test data: intent IDs and domain-rich opportunity reasonings
 * (third-party analytical style, as produced by the opportunity evaluator).
 * Reasonings are grouped by domain; within a domain they are related to each other,
 * across domains they are not (e.g. AI/ML vs hardware vs design vs fundraising).
 */
const MEANINGFUL = {
  intentIds: {
    aliceMlCofounder: 'intent-alice-ml-cofounder',
    bobEarlyStage: 'intent-bob-early-stage',
    carolHardware: 'intent-carol-hardware',
    daveDesign: 'intent-dave-design',
    eveFundraising: 'intent-eve-fundraising',
  },
  reasoning: {
    // AI/ML domain (related to each other)
    aiMlCofounder:
      'The source user is seeking a technical co-founder for an AI/ML startup; the candidate has deep ML experience and has expressed interest in early-stage roles. Strong fit on domain and stage.',
    aiMlResearch:
      'Both parties have expressed interest in machine learning research and publication; their profiles show complementary skills in NLP and systems. A collaboration could yield joint work.',
    aiMlStartup:
      'Strong match for an early-stage AI company: the source is building in ML infrastructure and the candidate has prior startup experience in the same space.',
    // Hardware domain (related to each other)
    hardwarePrototyping:
      'The source is building hardware prototypes and needs someone with embedded systems experience; the candidate has a background in firmware and PCB design. Clear complementarity.',
    hardwareFirmware:
      'Both have experience in low-level systems and embedded firmware; the source is looking for a co-founder to build IoT devices and the candidate has shipped similar products.',
    // Design domain (related to each other)
    designUx:
      'Product design and UX collaboration: the source is a designer looking for a technical co-founder, the candidate has shipped consumer products with strong design sensibility.',
    designProduct:
      'The source is a product lead seeking a design partner for a new consumer app; the candidate has a strong portfolio in mobile and web design.',
    // Fundraising domain (related to each other)
    fundraising:
      'The source is raising a pre-seed round and the candidate is an angel with relevant sector experience; a warm intro could lead to a conversation.',
    fundraisingAngel:
      'The candidate has been an active angel in the source’s sector and could be a valuable intro for the current round.',
  },
} as const;

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
    const newData = minimalNewData(
      ['user-a', 'user-b'],
      'idx-1',
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const result = await enrichOrCreate(db, embedder, newData);
    expect(result.enriched).toBe(false);
    expect(result.data).toBe(newData);
  });

  test('irrelevant opportunity does not merge: overlap but not semantically related', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.hardwarePrototyping
    );
    const db = {
      findOverlappingOpportunities: async () => [existing],
    };
    const embedder = {
      generate: async () => [[1, 0, 0], [0, 1, 0]] as number[][],
    } as unknown as Embedder;
    const newData = minimalNewData(
      ['user-a', 'user-b'],
      'idx-1',
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(false);
    expect(result.data).toBe(newData);
    expect(result.data.detection.source).not.toBe('enrichment');
    expect(result.data.actors).toHaveLength(newData.actors.length);
  });

  test('relevant opportunity merges: overlap and semantically related', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent' },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      MEANINGFUL.reasoning.aiMlResearch
    );
    const db = {
      findOverlappingOpportunities: async () => [existing],
    };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = {
      generate: async () => [sameVec, sameVec] as number[][],
    } as unknown as Embedder;
    const newData = minimalNewData(
      ['user-a', 'user-b'],
      'idx-1',
      MEANINGFUL.reasoning.aiMlCofounder
    );
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
      MEANINGFUL.reasoning.aiMlResearch,
      'accepted'
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = { generate: async () => [sameVec, sameVec] as number[][] } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlCofounder);
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
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const opp2 = existingOpportunity(
      'opp-2',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'peer' },
        { indexId: 'idx-1', userId: 'user-b', role: 'peer' },
      ],
      MEANINGFUL.reasoning.aiMlResearch
    );
    const db = {
      findOverlappingOpportunities: async () => [opp1, opp2],
    };
    const sameVec = [0.6, 0.6, 0.6];
    const embedder = {
      generate: async () => [sameVec, sameVec, sameVec] as number[][],
    } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlResearch);
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
      MEANINGFUL.reasoning.aiMlResearch
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = { generate: async () => [sameVec, sameVec] as number[][] } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlCofounder);
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
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlCofounder),
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
      MEANINGFUL.reasoning.aiMlResearch
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
    const sharedIntent = MEANINGFUL.intentIds.aliceMlCofounder;
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
      ...minimalNewData([], 'idx-1', MEANINGFUL.reasoning.fundraising),
      actors: [{ indexId: 'idx-1', userId: 'user-intro', role: 'introducer' }],
    };
    const db = { findOverlappingOpportunities: async () => [] as Opportunity[] };
    const embedder = { generate: async () => [] } as unknown as Embedder;
    const result = await enrichOrCreate(db, embedder, newDataOnlyIntroducers);
    expect(result.enriched).toBe(false);
    expect(result.data.actors).toHaveLength(1);
  });
});

/**
 * Multiple domains: same actor set, but opportunities differ by reasoning domain
 * (e.g. AI/ML vs hardware vs design). Embedder is mocked so only same-domain pairs
 * are semantically related; we assert which opportunities get merged and that
 * interpretation and status are combined correctly.
 */
describe('Opportunity enricher — multiple domains', () => {
  /** Vectors with cosine similarity 1 (identical). */
  const sameVec = [0.5, 0.5, 0.5];
  /** Vectors with cosine similarity 0 (orthogonal). */
  const unrelatedVecs: [number[], number[]] = [[1, 0, 0], [0, 1, 0]];

  /**
   * Embedder that treats reasoning as related only when existing reasoning
   * contains one of the relatedKeywords; otherwise returns orthogonal vectors.
   */
  function domainAwareEmbedder(relatedKeywords: string[]): Embedder {
    return {
      generate: async (texts: string[]) => {
        const existingReasoning = (texts[1] ?? '').toLowerCase();
        const isRelated = relatedKeywords.some((k) => existingReasoning.includes(k.toLowerCase()));
        if (isRelated) return [sameVec, sameVec] as number[][];
        return unrelatedVecs as unknown as number[][];
      },
    } as unknown as Embedder;
  }

  test('relevant opportunities merge and irrelevant do not (AI vs hardware, design, fundraising)', async () => {
    const oppAI = existingOpportunity(
      'opp-ai',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlResearch
    );
    const oppHardware = existingOpportunity(
      'opp-hw',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.hardwarePrototyping
    );
    const oppDesign = existingOpportunity(
      'opp-design',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.designUx
    );
    const oppFundraising = existingOpportunity(
      'opp-fund',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.fundraising
    );
    const db = {
      findOverlappingOpportunities: async () => [oppAI, oppHardware, oppDesign, oppFundraising],
    };
    const embedder = domainAwareEmbedder(['machine learning', 'ml experience', 'ai/ml', 'nlp']);
    const newData = minimalNewData(
      ['user-a', 'user-b'],
      'idx-1',
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toContain('opp-ai');
      expect(result.expiredIds).not.toContain('opp-hw');
      expect(result.expiredIds).not.toContain('opp-design');
      expect(result.expiredIds).not.toContain('opp-fund');
      expect(result.expiredIds).toHaveLength(1);
    }
  });

  test('four domains (AI, hardware, design, fundraising): only same-domain merges', async () => {
    const oppAI = existingOpportunity(
      'opp-ai',
      [{ indexId: 'idx-1', userId: 'user-a', role: 'party' }, { indexId: 'idx-1', userId: 'user-b', role: 'party' }],
      MEANINGFUL.reasoning.aiMlStartup
    );
    const oppHardware = existingOpportunity(
      'opp-hw',
      [{ indexId: 'idx-1', userId: 'user-a', role: 'party' }, { indexId: 'idx-1', userId: 'user-b', role: 'party' }],
      MEANINGFUL.reasoning.hardwareFirmware
    );
    const oppDesign = existingOpportunity(
      'opp-design',
      [{ indexId: 'idx-1', userId: 'user-a', role: 'party' }, { indexId: 'idx-1', userId: 'user-b', role: 'party' }],
      MEANINGFUL.reasoning.designProduct
    );
    const oppFundraising = existingOpportunity(
      'opp-fund',
      [{ indexId: 'idx-1', userId: 'user-a', role: 'party' }, { indexId: 'idx-1', userId: 'user-b', role: 'party' }],
      MEANINGFUL.reasoning.fundraisingAngel
    );
    const all = [oppAI, oppHardware, oppDesign, oppFundraising];
    const db = { findOverlappingOpportunities: async () => all };

    // New opportunity is AI: only AI (same domain) should merge; hardware, design, fundraising should not
    const embedderAI = domainAwareEmbedder(['machine learning', 'ml ', 'ai/ml', 'startup', 'nlp']);
    const resultAI = await enrichOrCreate(
      db,
      embedderAI,
      minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlCofounder),
      { similarityThreshold: 0.7 }
    );
    expect(resultAI.enriched).toBe(true);
    if (resultAI.enriched) {
      expect(resultAI.expiredIds).toContain('opp-ai');
      expect(resultAI.expiredIds).not.toContain('opp-hw');
      expect(resultAI.expiredIds).not.toContain('opp-design');
      expect(resultAI.expiredIds).not.toContain('opp-fund');
      expect(resultAI.expiredIds).toHaveLength(1);
    }

    // New opportunity is fundraising: only fundraising (same domain) should merge; AI, hardware, design should not
    const embedderFund = domainAwareEmbedder(['pre-seed', 'angel', 'raising', 'sector experience']);
    const resultFund = await enrichOrCreate(
      db,
      embedderFund,
      minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.fundraising),
      { similarityThreshold: 0.7 }
    );
    expect(resultFund.enriched).toBe(true);
    if (resultFund.enriched) {
      expect(resultFund.expiredIds).toContain('opp-fund');
      expect(resultFund.expiredIds).not.toContain('opp-ai');
      expect(resultFund.expiredIds).not.toContain('opp-hw');
      expect(resultFund.expiredIds).not.toContain('opp-design');
      expect(resultFund.expiredIds).toHaveLength(1);
    }
  });

  test('multiple relevant merge and single irrelevant does not (AI/ML vs hardware)', async () => {
    const opp1 = existingOpportunity(
      'opp-1',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent' },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const opp2 = existingOpportunity(
      'opp-2',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'peer' },
        { indexId: 'idx-1', userId: 'user-b', role: 'peer' },
      ],
      MEANINGFUL.reasoning.aiMlResearch
    );
    const opp3 = existingOpportunity(
      'opp-3',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.hardwarePrototyping
    );
    const db = {
      findOverlappingOpportunities: async () => [opp1, opp2, opp3],
    };
    const embedder = domainAwareEmbedder(['ai', 'ml', 'machine learning']);
    const newData = minimalNewData(
      ['user-a', 'user-b'],
      'idx-1',
      MEANINGFUL.reasoning.aiMlResearch
    );
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      // Relevant (AI/ML): both merged and expired
      expect(result.expiredIds).toContain('opp-1');
      expect(result.expiredIds).toContain('opp-2');
      expect(result.data.detection.enrichedFrom).toContain('opp-1');
      expect(result.data.detection.enrichedFrom).toContain('opp-2');
      // Irrelevant (hardware): not merged, not expired
      expect(result.expiredIds).not.toContain('opp-3');
      expect(result.data.detection.enrichedFrom).not.toContain('opp-3');
      expect(result.expiredIds).toHaveLength(2);
      const userIds = new Set(result.data.actors.map((a) => a.userId));
      expect(userIds.has('user-a')).toBe(true);
      expect(userIds.has('user-b')).toBe(true);
    }
  });

  test('merged interpretation combines reasoning and takes max confidence across related', async () => {
    const opp1 = existingOpportunity(
      'opp-1',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    opp1.interpretation = { ...opp1.interpretation!, confidence: 0.7 };
    const opp2 = existingOpportunity(
      'opp-2',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlResearch
    );
    opp2.interpretation = { ...opp2.interpretation!, confidence: 0.9 };
    const db = { findOverlappingOpportunities: async () => [opp1, opp2] };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = {
      generate: async () => [sameVec, sameVec, sameVec] as number[][],
    } as unknown as Embedder;
    const newData = minimalNewData(
      ['user-a', 'user-b'],
      'idx-1',
      MEANINGFUL.reasoning.aiMlResearch
    );
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.data.interpretation.reasoning).toContain('technical co-founder');
      expect(result.data.interpretation.reasoning).toContain('machine learning research');
      expect(result.data.interpretation.reasoning).toContain('complementary skills');
      const conf =
        typeof result.data.interpretation.confidence === 'number'
          ? result.data.interpretation.confidence
          : parseFloat(String(result.data.interpretation.confidence));
      expect(conf).toBe(0.9);
    }
  });

  test('status resolution: pending and rejected yield pending', async () => {
    const oppPending = existingOpportunity(
      'opp-p',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder,
      'pending'
    );
    const oppRejected = existingOpportunity(
      'opp-r',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlResearch,
      'rejected'
    );
    const db = { findOverlappingOpportunities: async () => [oppPending, oppRejected] };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = { generate: async () => [sameVec, sameVec, sameVec] as number[][] } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlResearch);
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.resolvedStatus).toBe('pending');
      expect(result.expiredIds).toContain('opp-p');
      expect(result.expiredIds).toContain('opp-r');
    }
  });

  test('status resolution: all latent yields latent', async () => {
    const opp1 = existingOpportunity(
      'opp-1',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder,
      'latent'
    );
    const opp2 = existingOpportunity(
      'opp-2',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlResearch,
      'latent'
    );
    const db = { findOverlappingOpportunities: async () => [opp1, opp2] };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = { generate: async () => [sameVec, sameVec, sameVec] as number[][] } as unknown as Embedder;
    const newData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlResearch),
      status: 'latent' as const,
    };
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.resolvedStatus).toBe('latent');
    }
  });

  test('signals from all related opportunities are deduplicated in merge', async () => {
    const opp1 = existingOpportunity(
      'opp-1',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const opp2 = existingOpportunity(
      'opp-2',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlResearch
    );
    const opp1WithSignals: Opportunity = {
      ...opp1,
      interpretation: {
        ...opp1.interpretation!,
        signals: [
          { type: 'skill_match', weight: 0.8, detail: 'Python' },
          { type: 'interest_overlap', weight: 0.9, detail: 'AI' },
        ],
      },
    };
    const opp2WithSignals: Opportunity = {
      ...opp2,
      interpretation: {
        ...opp2.interpretation!,
        signals: [
          { type: 'skill_match', weight: 0.8, detail: 'Python' },
          { type: 'intent_overlap', weight: 0.7, detail: 'research' },
        ],
      },
    };
    const db = {
      findOverlappingOpportunities: async () => [opp1WithSignals, opp2WithSignals],
    };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = { generate: async () => [sameVec, sameVec, sameVec] as number[][] } as unknown as Embedder;
    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlResearch),
      interpretation: {
        category: 'collaboration',
        reasoning: MEANINGFUL.reasoning.aiMlResearch,
        confidence: 0.8,
        signals: [{ type: 'curator_judgment', weight: 1, detail: 'Manual' }],
      },
    };
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      const signals = result.data.interpretation.signals ?? [];
      const keys = signals.map((s) => `${s.type}:${s.detail ?? ''}`);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
      expect(signals.some((s) => s.type === 'skill_match' && s.detail === 'Python')).toBe(true);
      expect(signals.some((s) => s.type === 'interest_overlap')).toBe(true);
      expect(signals.some((s) => s.type === 'intent_overlap')).toBe(true);
    }
  });

  test('embedder failure falls back to intent overlap', async () => {
    const sharedIntent = MEANINGFUL.intentIds.aliceMlCofounder;
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: sharedIntent },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const embedder = {
      generate: async () => {
        throw new Error('Embedder unavailable');
      },
    } as unknown as Embedder;
    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlResearch),
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: sharedIntent },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
    };
    const result = await enrichOrCreate(db, embedder, newData);
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-old']);
    }
  });

  test('intent-linked opportunities: shared intent ID drives relatedness when reasoning is short', async () => {
    const existing = existingOpportunity(
      'opp-old',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'agent', intent: MEANINGFUL.intentIds.aliceMlCofounder },
        { indexId: 'idx-1', userId: 'user-b', role: 'patient', intent: MEANINGFUL.intentIds.bobEarlyStage },
      ],
      'Short.' // below MIN_REASONING_LENGTH_FOR_EMBEDDING → intent overlap used
    );
    const db = { findOverlappingOpportunities: async () => [existing] };
    const embedder = { generate: async () => [] } as unknown as Embedder;
    const newData: CreateOpportunityData = {
      ...minimalNewData(['user-a', 'user-b'], 'idx-1', 'Also short.'),
      actors: [
        { indexId: 'idx-1', userId: 'user-a', role: 'party', intent: MEANINGFUL.intentIds.aliceMlCofounder },
        { indexId: 'idx-1', userId: 'user-b', role: 'party', intent: MEANINGFUL.intentIds.bobEarlyStage },
      ],
    };
    const result = await enrichOrCreate(db, embedder, newData);
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toEqual(['opp-old']);
      expect(result.data.actors.some((a) => a.intent === MEANINGFUL.intentIds.aliceMlCofounder)).toBe(true);
      expect(result.data.actors.some((a) => a.intent === MEANINGFUL.intentIds.bobEarlyStage)).toBe(true);
    }
  });

  test('different indexes: actors keyed by indexId so merge preserves both', async () => {
    const oppIdx1 = existingOpportunity(
      'opp-idx1',
      [
        { indexId: 'idx-1', userId: 'user-a', role: 'party' },
        { indexId: 'idx-1', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlCofounder
    );
    const oppIdx2 = existingOpportunity(
      'opp-idx2',
      [
        { indexId: 'idx-2', userId: 'user-a', role: 'party' },
        { indexId: 'idx-2', userId: 'user-b', role: 'party' },
      ],
      MEANINGFUL.reasoning.aiMlResearch
    );
    const db = { findOverlappingOpportunities: async () => [oppIdx1, oppIdx2] };
    const sameVec = [0.5, 0.5, 0.5];
    const embedder = { generate: async () => [sameVec, sameVec, sameVec] as number[][] } as unknown as Embedder;
    const newData = minimalNewData(['user-a', 'user-b'], 'idx-1', MEANINGFUL.reasoning.aiMlCofounder);
    const result = await enrichOrCreate(db, embedder, newData, { similarityThreshold: 0.7 });
    expect(result.enriched).toBe(true);
    if (result.enriched) {
      expect(result.expiredIds).toContain('opp-idx1');
      expect(result.expiredIds).toContain('opp-idx2');
      const indexIds = new Set(result.data.actors.map((a) => a.indexId));
      expect(indexIds.has('idx-1')).toBe(true);
      expect(indexIds.has('idx-2')).toBe(true);
    }
  });
});
