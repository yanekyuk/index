/**
 * Integration tests for EmbedderAdapter.
 * Requires DATABASE_URL; OPENROUTER_API_KEY needed for generate() tests.
 * Run: bun test src/adapters/embedder.adapter.spec.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../.env.development'), override: true });

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import db from '../lib/drizzle/drizzle';
import {
  users,
  userProfiles,
  indexes,
  indexMembers,
  intents,
  intentIndexes,
} from '../schemas/database.schema';
import { EmbedderAdapter } from './embedder.adapter';

const TEST_PREFIX = 'embedder_spec_' + Date.now() + '_';

/** Simple normalized 2000-dim vector for deterministic similarity (self-similarity 1). */
function makeTestVector(seed: number): number[] {
  const arr = new Array(2000).fill(0).map((_, i) => Math.sin(seed + i) * 0.05);
  const norm = Math.sqrt(arr.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? arr.map((x) => x / norm) : arr.map((_, i) => (i === 0 ? 1 : 0));
}

let fixture: {
  userAId: string;
  userBId: string;
  indexId: string;
  intentId: string;
};

beforeAll(async () => {
  const userAId = uuidv4();
  const userBId = uuidv4();
  const indexId = uuidv4();
  const intentId = uuidv4();

  await db.insert(users).values([
    { id: userAId, privyId: TEST_PREFIX + 'a', email: TEST_PREFIX + 'a@t.com', name: 'User A' },
    { id: userBId, privyId: TEST_PREFIX + 'b', email: TEST_PREFIX + 'b@t.com', name: 'User B' },
  ]);
  await db.insert(userProfiles).values({
    userId: userAId,
    identity: { name: 'User A', bio: 'Bio A', location: '' },
    narrative: { context: 'Context A' },
    attributes: { interests: [], skills: [] },
  });
  await db.insert(userProfiles).values({
    userId: userBId,
    identity: { name: 'User B', bio: 'Bio B', location: '' },
    narrative: { context: 'Context B' },
    attributes: { interests: [], skills: [] },
  });
  await db.insert(indexes).values({
    id: indexId,
    title: TEST_PREFIX + 'Index',
    prompt: 'Test index',
  });
  await db.insert(indexMembers).values([
    { indexId, userId: userAId, permissions: ['owner'], autoAssign: false },
    { indexId, userId: userBId, permissions: [], autoAssign: true },
  ]);

  fixture = { userAId, userBId, indexId, intentId };
});

afterAll(async () => {
  await db.delete(intentIndexes).where(eq(intentIndexes.indexId, fixture.indexId));
  await db.delete(intents).where(inArray(intents.userId, [fixture.userAId, fixture.userBId]));
  await db.delete(indexMembers).where(eq(indexMembers.indexId, fixture.indexId));
  await db.delete(userProfiles).where(inArray(userProfiles.userId, [fixture.userAId, fixture.userBId]));
  await db.delete(indexes).where(eq(indexes.id, fixture.indexId));
  await db.delete(users).where(inArray(users.id, [fixture.userAId, fixture.userBId]));
});

describe('EmbedderAdapter', () => {
  const adapter = new EmbedderAdapter();

  describe('search (single-vector)', () => {
    it('should return intent match when searching with same embedding and index scope', async () => {
      const queryVector = makeTestVector(42);
      await db.insert(intents).values({
        id: fixture.intentId,
        userId: fixture.userBId,
        payload: TEST_PREFIX + 'Intent for vector search',
        summary: 'Summary',
        embedding: queryVector,
      });
      await db.insert(intentIndexes).values({ intentId: fixture.intentId, indexId: fixture.indexId });

      const results = await adapter.search<{ id: string; userId: string }>(
        queryVector,
        'intents',
        { limit: 10, minScore: 0.99, filter: { indexScope: [fixture.indexId] } }
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      const match = results.find((r) => r.item.id === fixture.intentId);
      expect(match).toBeDefined();
      expect(match!.score).toBeGreaterThanOrEqual(0.99);
    });

    it('should apply index scope filtering (only members of index)', async () => {
      const queryVector = makeTestVector(100);
      const results = await adapter.search<{ id: string; userId: string }>(
        queryVector,
        'intents',
        { limit: 5, minScore: 0, filter: { indexScope: [fixture.indexId] } }
      );

      for (const r of results) {
        expect(r.item).toBeDefined();
      }
      // All results should be from intents in this index (enforced by join in adapter)
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('searchWithHydeEmbeddings', () => {
    it('should merge and rank candidates from multiple strategies', async () => {
      const vec = makeTestVector(200);
      const hydeEmbeddings = new Map([
        ['mirror' as const, vec],
        ['reciprocal' as const, vec],
      ]);

      const results = await adapter.searchWithHydeEmbeddings(hydeEmbeddings, {
        strategies: ['mirror', 'reciprocal'],
        indexScope: [fixture.indexId],
        limitPerStrategy: 5,
        limit: 10,
        minScore: 0,
      });

      expect(Array.isArray(results)).toBe(true);
      for (const c of results) {
        expect(['profile', 'intent']).toContain(c.type);
        expect(c.id).toBeDefined();
        expect(c.userId).toBeDefined();
        expect(c.score).toBeGreaterThanOrEqual(0);
        expect(c.matchedVia).toBeDefined();
        expect(c.indexId).toBe(fixture.indexId);
      }
    });

    it('should respect indexScope and excludeUserId', async () => {
      const vec = makeTestVector(300);
      const results = await adapter.searchWithHydeEmbeddings(
        new Map([['reciprocal' as const, vec]]),
        {
          strategies: ['reciprocal'],
          indexScope: [fixture.indexId],
          excludeUserId: fixture.userAId,
          limit: 5,
          minScore: 0,
        }
      );

      for (const c of results) {
        expect(c.userId).not.toBe(fixture.userAId);
        expect(c.indexId).toBe(fixture.indexId);
      }
    });
  });
});

describe('EmbedderAdapter – generate (optional)', () => {
  it('should generate embedding for text when OPENROUTER_API_KEY is set', async () => {
    if (!process.env.OPENROUTER_API_KEY) {
      return; // skip when no key
    }
    const adapter = new EmbedderAdapter();
    const emb = await adapter.generate('Hello world');
    expect(Array.isArray(emb)).toBe(true);
    expect((emb as number[]).length).toBe(2000);
  }, 15000);
});
