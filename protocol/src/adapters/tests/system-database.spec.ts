/**
 * Unit tests for createSystemDatabase factory.
 *
 * Tests scope enforcement (verifyScope), cross-user access via verifySharedIndex,
 * embedder integration, and delegation to ChatDatabaseAdapter.
 * Uses a mock ChatDatabaseAdapter — no database connection needed.
 */

import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Mock getPersonalIndexId before importing the module under test.
// This prevents verifySharedIndex from hitting the real DB.
const mockGetPersonalIndexId = mock(() => Promise.resolve(null));
mock.module('../database.adapter', () => {
  const actual = require('../database.adapter');
  return {
    ...actual,
    getPersonalIndexId: mockGetPersonalIndexId,
  };
});

import { createSystemDatabase } from '../database.adapter';
import type { ChatDatabaseAdapter } from '../database.adapter';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_USER = 'user-auth-123';
const OTHER_USER = 'user-other-456';
const SCOPED_INDEX = 'index-scoped-1';
const SCOPED_INDEX_2 = 'index-scoped-2';
const OUT_OF_SCOPE_INDEX = 'index-out-of-scope';

function createMockDb(): ChatDatabaseAdapter {
  return {
    // Profile
    getProfile: mock(() => Promise.resolve(null)),
    getUser: mock(() => Promise.resolve(null)),

    // Intents
    getIntent: mock(() => Promise.resolve(null)),
    getIndexIntentsForMember: mock(() => Promise.resolve([])),
    getIntentsInIndexForMember: mock(() => Promise.resolve([])),

    // Index membership
    getIndexMemberships: mock(() => Promise.resolve([])),
    getIndexMembership: mock(() => Promise.resolve(null)),
    isIndexMember: mock(() => Promise.resolve(false)),
    isIndexOwner: mock(() => Promise.resolve(false)),
    getIndexMembersForMember: mock(() => Promise.resolve([])),
    getMembersFromUserIndexes: mock(() => Promise.resolve([])),
    addMemberToIndex: mock(() => Promise.resolve({ success: true })),
    removeMemberFromIndex: mock(() => Promise.resolve({ success: true })),

    // Index operations
    getIndex: mock(() => Promise.resolve(null)),
    getIndexWithPermissions: mock(() => Promise.resolve(null)),
    getIndexMemberCount: mock(() => Promise.resolve(0)),

    // Opportunities
    createOpportunity: mock(() => Promise.resolve({})),
    createOpportunityAndExpireIds: mock(() => Promise.resolve({ created: {}, expired: [] })),
    getOpportunity: mock(() => Promise.resolve(null)),
    getOpportunitiesForIndex: mock(() => Promise.resolve([])),
    updateOpportunityStatus: mock(() => Promise.resolve(null)),
    opportunityExistsBetweenActors: mock(() => Promise.resolve(false)),
    getOpportunityBetweenActors: mock(() => Promise.resolve(null)),
    findOverlappingOpportunities: mock(() => Promise.resolve([])),
    expireOpportunitiesByIntent: mock(() => Promise.resolve(0)),
    expireOpportunitiesForRemovedMember: mock(() => Promise.resolve(0)),
    expireStaleOpportunities: mock(() => Promise.resolve(0)),

    // HyDE
    getHydeDocument: mock(() => Promise.resolve(null)),
    getHydeDocumentsForSource: mock(() => Promise.resolve([])),
    saveHydeDocument: mock(() => Promise.resolve({})),
    deleteExpiredHydeDocuments: mock(() => Promise.resolve(0)),
    getStaleHydeDocuments: mock(() => Promise.resolve([])),
  } as unknown as ChatDatabaseAdapter;
}

function createMockEmbedder() {
  return {
    search: mock(() => Promise.resolve([])),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('createSystemDatabase', () => {
  let mockDb: ChatDatabaseAdapter;
  let sysDb: ReturnType<typeof createSystemDatabase>;

  beforeEach(() => {
    mockDb = createMockDb();
    sysDb = createSystemDatabase(mockDb, AUTH_USER, [SCOPED_INDEX, SCOPED_INDEX_2]);
  });

  it('exposes authUserId and indexScope', () => {
    expect(sysDb.authUserId).toBe(AUTH_USER);
    expect(sysDb.indexScope).toEqual([SCOPED_INDEX, SCOPED_INDEX_2]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope enforcement (verifyScope)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('verifyScope — index operations', () => {
    it('getIntentsInIndex allows scoped index', async () => {
      await sysDb.getIntentsInIndex(SCOPED_INDEX);
      expect(mockDb.getIndexIntentsForMember).toHaveBeenCalledWith(SCOPED_INDEX, AUTH_USER, undefined);
    });

    it('getIntentsInIndex throws for out-of-scope index', async () => {
      await expect(sysDb.getIntentsInIndex(OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });

    it('getUserIntentsInIndex allows scoped index', async () => {
      await sysDb.getUserIntentsInIndex(OTHER_USER, SCOPED_INDEX);
      expect(mockDb.getIntentsInIndexForMember).toHaveBeenCalledWith(OTHER_USER, SCOPED_INDEX);
    });

    it('getUserIntentsInIndex throws for out-of-scope index', async () => {
      await expect(sysDb.getUserIntentsInIndex(OTHER_USER, OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });

    it('getIndexMembers allows scoped index', async () => {
      await sysDb.getIndexMembers(SCOPED_INDEX);
      expect(mockDb.getIndexMembersForMember).toHaveBeenCalledWith(SCOPED_INDEX, AUTH_USER);
    });

    it('getIndexMembers throws for out-of-scope index', async () => {
      await expect(sysDb.getIndexMembers(OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });

    it('getIndex allows scoped index', async () => {
      await sysDb.getIndex(SCOPED_INDEX);
      expect(mockDb.getIndex).toHaveBeenCalledWith(SCOPED_INDEX);
    });

    it('getIndex throws for out-of-scope index', async () => {
      await expect(sysDb.getIndex(OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });

    it('getIndexWithPermissions allows scoped index', async () => {
      await sysDb.getIndexWithPermissions(SCOPED_INDEX);
      expect(mockDb.getIndexWithPermissions).toHaveBeenCalledWith(SCOPED_INDEX);
    });

    it('getIndexWithPermissions throws for out-of-scope index', async () => {
      await expect(sysDb.getIndexWithPermissions(OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });

    it('getIndexMemberCount allows scoped index', async () => {
      await sysDb.getIndexMemberCount(SCOPED_INDEX);
      expect(mockDb.getIndexMemberCount).toHaveBeenCalledWith(SCOPED_INDEX);
    });

    it('getIndexMemberCount throws for out-of-scope index', async () => {
      await expect(sysDb.getIndexMemberCount(OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scope enforcement — opportunity operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe('verifyScope — opportunity operations', () => {
    it('createOpportunity allows scoped indexId in context', async () => {
      const data = { context: { indexId: SCOPED_INDEX } } as never;
      await sysDb.createOpportunity(data);
      expect(mockDb.createOpportunity).toHaveBeenCalledWith(data);
    });

    it('createOpportunity throws for out-of-scope indexId in context', () => {
      const data = { context: { indexId: OUT_OF_SCOPE_INDEX } } as never;
      expect(() => sysDb.createOpportunity(data)).toThrow('not in scope');
    });

    it('createOpportunity allows data without context.indexId', async () => {
      const data = { context: {} } as never;
      await sysDb.createOpportunity(data);
      expect(mockDb.createOpportunity).toHaveBeenCalled();
    });

    it('getOpportunitiesForIndex allows scoped index', async () => {
      await sysDb.getOpportunitiesForIndex(SCOPED_INDEX);
      expect(mockDb.getOpportunitiesForIndex).toHaveBeenCalledWith(SCOPED_INDEX, undefined);
    });

    it('getOpportunitiesForIndex throws for out-of-scope index', async () => {
      await expect(sysDb.getOpportunitiesForIndex(OUT_OF_SCOPE_INDEX)).rejects.toThrow('not in scope');
    });

    it('updateOpportunityStatus validates scope via opportunity lookup', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'opp-1',
        context: { indexId: SCOPED_INDEX },
      });
      await sysDb.updateOpportunityStatus('opp-1', 'accepted' as never);
      expect(mockDb.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'accepted');
    });

    it('updateOpportunityStatus throws for missing opportunity', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce(null);
      await expect(sysDb.updateOpportunityStatus('missing', 'accepted' as never)).rejects.toThrow('not found');
    });

    it('updateOpportunityStatus throws for out-of-scope opportunity', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'opp-1',
        context: { indexId: OUT_OF_SCOPE_INDEX },
      });
      await expect(sysDb.updateOpportunityStatus('opp-1', 'accepted' as never)).rejects.toThrow('not in scope');
    });

    it('updateOpportunityStatus throws for opportunity without indexId', async () => {
      (mockDb.getOpportunity as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: 'opp-1',
        context: {},
      });
      await expect(sysDb.updateOpportunityStatus('opp-1', 'accepted' as never)).rejects.toThrow('not found');
    });

    it('opportunityExistsBetweenActors allows scoped index', async () => {
      await sysDb.opportunityExistsBetweenActors([AUTH_USER, OTHER_USER], SCOPED_INDEX);
      expect(mockDb.opportunityExistsBetweenActors).toHaveBeenCalledWith([AUTH_USER, OTHER_USER], SCOPED_INDEX);
    });

    it('opportunityExistsBetweenActors throws for out-of-scope index', () => {
      expect(() =>
        sysDb.opportunityExistsBetweenActors([AUTH_USER], OUT_OF_SCOPE_INDEX)
      ).toThrow('not in scope');
    });

    it('getOpportunityBetweenActors allows scoped index', async () => {
      await sysDb.getOpportunityBetweenActors([AUTH_USER, OTHER_USER], SCOPED_INDEX);
      expect(mockDb.getOpportunityBetweenActors).toHaveBeenCalledWith([AUTH_USER, OTHER_USER], SCOPED_INDEX);
    });

    it('getOpportunityBetweenActors throws for out-of-scope index', () => {
      expect(() =>
        sysDb.getOpportunityBetweenActors([AUTH_USER], OUT_OF_SCOPE_INDEX)
      ).toThrow('not in scope');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Unscoped pass-through operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe('unscoped pass-through operations', () => {
    it('getIntent delegates directly', async () => {
      await sysDb.getIntent('intent-1');
      expect(mockDb.getIntent).toHaveBeenCalledWith('intent-1');
    });

    it('isIndexMember delegates directly', async () => {
      await sysDb.isIndexMember(SCOPED_INDEX, OTHER_USER);
      expect(mockDb.isIndexMember).toHaveBeenCalledWith(SCOPED_INDEX, OTHER_USER);
    });

    it('isIndexOwner delegates directly', async () => {
      await sysDb.isIndexOwner(SCOPED_INDEX, AUTH_USER);
      expect(mockDb.isIndexOwner).toHaveBeenCalledWith(SCOPED_INDEX, AUTH_USER);
    });

    it('addMemberToIndex delegates directly', async () => {
      await sysDb.addMemberToIndex(SCOPED_INDEX, OTHER_USER, 'member');
      expect(mockDb.addMemberToIndex).toHaveBeenCalledWith(SCOPED_INDEX, OTHER_USER, 'member');
    });

    it('removeMemberFromIndex delegates directly', async () => {
      await sysDb.removeMemberFromIndex(SCOPED_INDEX, OTHER_USER);
      expect(mockDb.removeMemberFromIndex).toHaveBeenCalledWith(SCOPED_INDEX, OTHER_USER);
    });

    it('getMembersFromScope delegates with authUserId', async () => {
      await sysDb.getMembersFromScope();
      expect(mockDb.getMembersFromUserIndexes).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getOpportunity delegates directly', async () => {
      await sysDb.getOpportunity('opp-1');
      expect(mockDb.getOpportunity).toHaveBeenCalledWith('opp-1');
    });

    it('findOverlappingOpportunities delegates directly', async () => {
      const actorIds = [AUTH_USER, OTHER_USER] as never;
      await sysDb.findOverlappingOpportunities(actorIds);
      expect(mockDb.findOverlappingOpportunities).toHaveBeenCalledWith(actorIds, undefined);
    });

    it('expireOpportunitiesByIntent delegates directly', async () => {
      await sysDb.expireOpportunitiesByIntent('intent-1');
      expect(mockDb.expireOpportunitiesByIntent).toHaveBeenCalledWith('intent-1');
    });

    it('expireOpportunitiesForRemovedMember delegates directly', async () => {
      await sysDb.expireOpportunitiesForRemovedMember(SCOPED_INDEX, OTHER_USER);
      expect(mockDb.expireOpportunitiesForRemovedMember).toHaveBeenCalledWith(SCOPED_INDEX, OTHER_USER);
    });

    it('expireStaleOpportunities delegates directly', async () => {
      await sysDb.expireStaleOpportunities();
      expect(mockDb.expireStaleOpportunities).toHaveBeenCalled();
    });

    it('createOpportunityAndExpireIds delegates directly', async () => {
      const data = { context: {} } as never;
      await sysDb.createOpportunityAndExpireIds(data, ['exp-1']);
      expect(mockDb.createOpportunityAndExpireIds).toHaveBeenCalledWith(data, ['exp-1']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // HyDE Operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe('HyDE operations delegate directly', () => {
    it('getHydeDocument delegates', async () => {
      await sysDb.getHydeDocument('intent' as never, 'src-1', 'strategy-1');
      expect(mockDb.getHydeDocument).toHaveBeenCalledWith('intent', 'src-1', 'strategy-1');
    });

    it('getHydeDocumentsForSource delegates', async () => {
      await sysDb.getHydeDocumentsForSource('intent' as never, 'src-1');
      expect(mockDb.getHydeDocumentsForSource).toHaveBeenCalledWith('intent', 'src-1');
    });

    it('saveHydeDocument delegates', async () => {
      const data = { sourceType: 'intent' } as never;
      await sysDb.saveHydeDocument(data);
      expect(mockDb.saveHydeDocument).toHaveBeenCalledWith(data);
    });

    it('deleteExpiredHydeDocuments delegates', async () => {
      await sysDb.deleteExpiredHydeDocuments();
      expect(mockDb.deleteExpiredHydeDocuments).toHaveBeenCalled();
    });

    it('getStaleHydeDocuments delegates', async () => {
      const threshold = new Date();
      await sysDb.getStaleHydeDocuments(threshold);
      expect(mockDb.getStaleHydeDocuments).toHaveBeenCalledWith(threshold);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // findSimilarIntentsInScope — embedder integration
  // ─────────────────────────────────────────────────────────────────────────────

  describe('findSimilarIntentsInScope', () => {
    it('returns empty array when no embedder provided', async () => {
      const result = await sysDb.findSimilarIntentsInScope([1, 2, 3]);
      expect(result).toEqual([]);
    });

    it('returns empty array when indexScope is empty', async () => {
      const emptyScope = createSystemDatabase(mockDb, AUTH_USER, [], createMockEmbedder());
      const result = await emptyScope.findSimilarIntentsInScope([1, 2, 3]);
      expect(result).toEqual([]);
    });

    it('calls embedder.search and maps results with intent data', async () => {
      const mockEmbedder = createMockEmbedder();
      const sysDbWithEmbedder = createSystemDatabase(mockDb, AUTH_USER, [SCOPED_INDEX], mockEmbedder);

      const intentData = {
        id: 'intent-1',
        payload: 'test',
        summary: 'sum',
        userId: AUTH_USER,
        isIncognito: false,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        archivedAt: null,
      };

      (mockEmbedder.search as ReturnType<typeof mock>).mockResolvedValueOnce([
        { item: { id: 'intent-1', payload: 'test', summary: 'sum', userId: AUTH_USER }, score: 0.85 },
      ]);
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(intentData);

      const result = await sysDbWithEmbedder.findSimilarIntentsInScope([1, 2, 3], { limit: 5, threshold: 0.8 });

      expect(mockEmbedder.search).toHaveBeenCalledWith(
        [1, 2, 3],
        'intents',
        { limit: 5, minScore: 0.8, filter: { indexScope: [SCOPED_INDEX] } },
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('intent-1');
      expect(result[0].similarity).toBe(0.85);
    });

    it('filters out intents that no longer exist', async () => {
      const mockEmbedder = createMockEmbedder();
      const sysDbWithEmbedder = createSystemDatabase(mockDb, AUTH_USER, [SCOPED_INDEX], mockEmbedder);

      (mockEmbedder.search as ReturnType<typeof mock>).mockResolvedValueOnce([
        { item: { id: 'intent-1', payload: 'test', summary: null, userId: AUTH_USER }, score: 0.9 },
        { item: { id: 'intent-deleted', payload: 'gone', summary: null, userId: AUTH_USER }, score: 0.8 },
      ]);
      // First intent exists, second doesn't
      (mockDb.getIntent as ReturnType<typeof mock>)
        .mockResolvedValueOnce({
          id: 'intent-1', payload: 'test', summary: null, userId: AUTH_USER,
          isIncognito: false, createdAt: new Date(), updatedAt: new Date(), archivedAt: null,
        })
        .mockResolvedValueOnce(null);

      const result = await sysDbWithEmbedder.findSimilarIntentsInScope([1, 2, 3]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('intent-1');
    });

    it('uses default limit=10 and threshold=0.7 when options omitted', async () => {
      const mockEmbedder = createMockEmbedder();
      const sysDbWithEmbedder = createSystemDatabase(mockDb, AUTH_USER, [SCOPED_INDEX], mockEmbedder);

      (mockEmbedder.search as ReturnType<typeof mock>).mockResolvedValueOnce([]);

      await sysDbWithEmbedder.findSimilarIntentsInScope([1, 2, 3]);

      expect(mockEmbedder.search).toHaveBeenCalledWith(
        [1, 2, 3],
        'intents',
        { limit: 10, minScore: 0.7, filter: { indexScope: [SCOPED_INDEX] } },
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile operations — verifySharedIndex
  // ─────────────────────────────────────────────────────────────────────────────

  describe('verifySharedIndex — profile/user access', () => {
    it('getProfile allows access to own profile (userId === authUserId)', async () => {
      await sysDb.getProfile(AUTH_USER);
      expect(mockDb.getProfile).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getUser allows access to own user (userId === authUserId)', async () => {
      await sysDb.getUser(AUTH_USER);
      expect(mockDb.getUser).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getProfile allows access when other user shares a scoped index', async () => {
      (mockDb.getIndexMemberships as ReturnType<typeof mock>).mockResolvedValueOnce([
        { indexId: SCOPED_INDEX },
      ]);
      await sysDb.getProfile(OTHER_USER);
      expect(mockDb.getProfile).toHaveBeenCalledWith(OTHER_USER);
    });

    it('getProfile throws when other user shares no scoped index and no personal index contact', async () => {
      // No shared memberships, getPersonalIndexId returns null (mocked)
      (mockDb.getIndexMemberships as ReturnType<typeof mock>).mockResolvedValueOnce([
        { indexId: 'some-unrelated-index' },
      ]);
      await expect(sysDb.getProfile(OTHER_USER)).rejects.toThrow('no shared index');
    });

    it('getUser throws when other user shares no scoped index and no personal index contact', async () => {
      (mockDb.getIndexMemberships as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(sysDb.getUser(OTHER_USER)).rejects.toThrow('no shared index');
    });
  });
});
