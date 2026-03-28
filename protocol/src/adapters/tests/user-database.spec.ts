/**
 * Unit tests for createUserDatabase factory.
 *
 * Tests ownership guards, authUserId binding, and delegation to ChatDatabaseAdapter.
 * Uses a mock ChatDatabaseAdapter — no database connection needed.
 */

import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { createUserDatabase } from '../database.adapter';
import type { ChatDatabaseAdapter } from '../database.adapter';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_USER = 'user-owner-123';
const OTHER_USER = 'user-other-456';

const ownedIntent = {
  id: 'intent-1',
  userId: AUTH_USER,
  payload: 'test intent',
  summary: 'summary',
  isIncognito: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null,
  embedding: undefined as number[] | undefined,
  sourceType: undefined as 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment' | undefined,
  sourceId: undefined as string | undefined,
};

const otherIntent = {
  id: 'intent-2',
  userId: OTHER_USER,
  payload: 'other intent',
  summary: null,
  isIncognito: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null,
  embedding: undefined as number[] | undefined,
  sourceType: undefined as 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment' | undefined,
  sourceId: undefined as string | undefined,
};

function createMockDb(): ChatDatabaseAdapter {
  return {
    // Profile
    getProfile: mock(() => Promise.resolve(null)),
    getProfileByUserId: mock(() => Promise.resolve(null)),
    saveProfile: mock(() => Promise.resolve()),
    deleteProfile: mock(() => Promise.resolve()),
    getUser: mock(() => Promise.resolve(null)),
    updateUser: mock(() => Promise.resolve(null)),

    // Intents
    getActiveIntents: mock(() => Promise.resolve([])),
    getIntent: mock(() => Promise.resolve(null)),
    createIntent: mock(() => Promise.resolve({ ...ownedIntent })),
    updateIntent: mock(() => Promise.resolve({ ...ownedIntent })),
    archiveIntent: mock(() => Promise.resolve({ success: true })),
    getIntentForIndexing: mock(() => Promise.resolve(null)),
    assignIntentToIndex: mock(() => Promise.resolve()),
    unassignIntentFromIndex: mock(() => Promise.resolve()),
    getIndexIdsForIntent: mock(() => Promise.resolve([])),
    isIntentAssignedToIndex: mock(() => Promise.resolve(false)),

    // Index membership
    getIndexMemberships: mock(() => Promise.resolve([])),
    getUserIndexIds: mock(() => Promise.resolve([])),
    getOwnedIndexes: mock(() => Promise.resolve([])),
    getIndexMembership: mock(() => Promise.resolve(null)),
    getIndexMemberContext: mock(() => Promise.resolve(null)),

    // Index CRUD
    createIndex: mock(() => Promise.resolve({ id: 'idx-1', title: 'Test', prompt: null, imageUrl: null, permissions: {} })),
    updateIndexSettings: mock(() => Promise.resolve({})),
    softDeleteIndex: mock(() => Promise.resolve()),

    // Public index discovery
    getPublicIndexesNotJoined: mock(() => Promise.resolve({ indexes: [] })),
    joinPublicIndex: mock(() => Promise.resolve({ success: true })),

    // Opportunities
    getOpportunitiesForUser: mock(() => Promise.resolve([])),
    getOpportunity: mock(() => Promise.resolve(null)),
    updateOpportunityStatus: mock(() => Promise.resolve(null)),
    getAcceptedOpportunitiesBetweenActors: mock(() => Promise.resolve([])),
    acceptSiblingOpportunities: mock(() => Promise.resolve([])),

    // HyDE
    getHydeDocument: mock(() => Promise.resolve(null)),
    getHydeDocumentsForSource: mock(() => Promise.resolve([])),
    saveHydeDocument: mock(() => Promise.resolve({})),
    deleteHydeDocumentsForSource: mock(() => Promise.resolve(0)),
  } as unknown as ChatDatabaseAdapter;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('createUserDatabase', () => {
  let mockDb: ChatDatabaseAdapter;
  let userDb: ReturnType<typeof createUserDatabase>;

  beforeEach(() => {
    mockDb = createMockDb();
    userDb = createUserDatabase(mockDb, AUTH_USER);
  });

  it('exposes authUserId', () => {
    expect(userDb.authUserId).toBe(AUTH_USER);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Operations — authUserId binding
  // ─────────────────────────────────────────────────────────────────────────────

  describe('profile operations bind authUserId', () => {
    it('getProfile delegates with authUserId', async () => {
      await userDb.getProfile();
      expect(mockDb.getProfile).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getProfileByUserId delegates with authUserId', async () => {
      await userDb.getProfileByUserId();
      expect(mockDb.getProfileByUserId).toHaveBeenCalledWith(AUTH_USER);
    });

    it('saveProfile delegates with authUserId', async () => {
      const profile = { summary: 'test' } as never;
      await userDb.saveProfile(profile);
      expect(mockDb.saveProfile).toHaveBeenCalledWith(AUTH_USER, profile);
    });

    it('deleteProfile delegates with authUserId', async () => {
      await userDb.deleteProfile();
      expect(mockDb.deleteProfile).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getUser delegates with authUserId', async () => {
      await userDb.getUser();
      expect(mockDb.getUser).toHaveBeenCalledWith(AUTH_USER);
    });

    it('updateUser delegates with authUserId', async () => {
      const data = { name: 'New Name' };
      await userDb.updateUser(data);
      expect(mockDb.updateUser).toHaveBeenCalledWith(AUTH_USER, data);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Intent Operations — ownership enforcement
  // ─────────────────────────────────────────────────────────────────────────────

  describe('intent ownership guards', () => {
    it('getIntent returns owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      const result = await userDb.getIntent('intent-1');
      expect(result).toEqual(ownedIntent);
    });

    it('getIntent returns null for missing intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(null);
      const result = await userDb.getIntent('missing');
      expect(result).toBeNull();
    });

    it('getIntent throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.getIntent('intent-2')).rejects.toThrow('Access denied');
    });

    it('updateIntent succeeds for owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      await userDb.updateIntent('intent-1', { payload: 'updated' });
      expect(mockDb.updateIntent).toHaveBeenCalledWith('intent-1', { payload: 'updated' });
    });

    it('updateIntent throws for missing intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(null);
      await expect(userDb.updateIntent('missing', { payload: 'x' })).rejects.toThrow('Intent not found');
    });

    it('updateIntent throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.updateIntent('intent-2', { payload: 'x' })).rejects.toThrow('Access denied');
    });

    it('archiveIntent succeeds for owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      await userDb.archiveIntent('intent-1');
      expect(mockDb.archiveIntent).toHaveBeenCalledWith('intent-1');
    });

    it('archiveIntent throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.archiveIntent('intent-2')).rejects.toThrow('Access denied');
    });

    it('associateIntentWithIndexes succeeds for owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      await userDb.associateIntentWithIndexes('intent-1', ['idx-a', 'idx-b']);
      expect(mockDb.assignIntentToIndex).toHaveBeenCalledTimes(2);
      expect(mockDb.assignIntentToIndex).toHaveBeenCalledWith('intent-1', 'idx-a');
      expect(mockDb.assignIntentToIndex).toHaveBeenCalledWith('intent-1', 'idx-b');
    });

    it('associateIntentWithIndexes throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.associateIntentWithIndexes('intent-2', ['idx-a'])).rejects.toThrow('Access denied');
    });

    it('assignIntentToIndex succeeds for owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      await userDb.assignIntentToIndex('intent-1', 'idx-a', 0.9);
      expect(mockDb.assignIntentToIndex).toHaveBeenCalledWith('intent-1', 'idx-a', 0.9);
    });

    it('assignIntentToIndex throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.assignIntentToIndex('intent-2', 'idx-a')).rejects.toThrow('Access denied');
    });

    it('unassignIntentFromIndex succeeds for owned intent', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(ownedIntent);
      await userDb.unassignIntentFromIndex('intent-1', 'idx-a');
      expect(mockDb.unassignIntentFromIndex).toHaveBeenCalledWith('intent-1', 'idx-a');
    });

    it('unassignIntentFromIndex throws for intent owned by another user', async () => {
      (mockDb.getIntent as ReturnType<typeof mock>).mockResolvedValueOnce(otherIntent);
      await expect(userDb.unassignIntentFromIndex('intent-2', 'idx-a')).rejects.toThrow('Access denied');
    });
  });

  describe('intent creation binds authUserId', () => {
    it('createIntent injects authUserId into data', async () => {
      await userDb.createIntent({ payload: 'new intent' });
      expect(mockDb.createIntent).toHaveBeenCalledWith({ payload: 'new intent', userId: AUTH_USER });
    });
  });

  describe('intent read operations (no ownership guard)', () => {
    it('getActiveIntents delegates with authUserId', async () => {
      await userDb.getActiveIntents();
      expect(mockDb.getActiveIntents).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getIntentForIndexing delegates directly', async () => {
      await userDb.getIntentForIndexing('intent-1');
      expect(mockDb.getIntentForIndexing).toHaveBeenCalledWith('intent-1');
    });

    it('getIndexIdsForIntent delegates directly', async () => {
      await userDb.getIndexIdsForIntent('intent-1');
      expect(mockDb.getIndexIdsForIntent).toHaveBeenCalledWith('intent-1');
    });

    it('isIntentAssignedToIndex delegates directly', async () => {
      await userDb.isIntentAssignedToIndex('intent-1', 'idx-a');
      expect(mockDb.isIntentAssignedToIndex).toHaveBeenCalledWith('intent-1', 'idx-a');
    });
  });

  describe('findSimilarIntents placeholder', () => {
    it('returns empty array (not yet implemented)', async () => {
      const result = await userDb.findSimilarIntents([1, 2, 3]);
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Membership Operations — authUserId binding
  // ─────────────────────────────────────────────────────────────────────────────

  describe('index membership operations bind authUserId', () => {
    it('getIndexMemberships delegates with authUserId', async () => {
      await userDb.getIndexMemberships();
      expect(mockDb.getIndexMemberships).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getUserIndexIds delegates with authUserId', async () => {
      await userDb.getUserIndexIds();
      expect(mockDb.getUserIndexIds).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getOwnedIndexes delegates with authUserId', async () => {
      await userDb.getOwnedIndexes();
      expect(mockDb.getOwnedIndexes).toHaveBeenCalledWith(AUTH_USER);
    });

    it('getIndexMembership delegates with indexId and authUserId', async () => {
      await userDb.getIndexMembership('idx-a');
      expect(mockDb.getIndexMembership).toHaveBeenCalledWith('idx-a', AUTH_USER);
    });

    it('getIndexMemberContext delegates with indexId and authUserId', async () => {
      await userDb.getIndexMemberContext('idx-a');
      expect(mockDb.getIndexMemberContext).toHaveBeenCalledWith('idx-a', AUTH_USER);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Index CRUD Operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe('index CRUD operations', () => {
    it('createIndex delegates directly', async () => {
      const data = { title: 'Test Index' };
      await userDb.createIndex(data);
      expect(mockDb.createIndex).toHaveBeenCalledWith(data);
    });

    it('updateIndexSettings delegates with authUserId', async () => {
      const data = { title: 'Updated' };
      await userDb.updateIndexSettings('idx-a', data);
      expect(mockDb.updateIndexSettings).toHaveBeenCalledWith('idx-a', AUTH_USER, data);
    });

    it('softDeleteIndex delegates directly (no ownership check)', async () => {
      await userDb.softDeleteIndex('idx-a');
      expect(mockDb.softDeleteIndex).toHaveBeenCalledWith('idx-a');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Index Discovery
  // ─────────────────────────────────────────────────────────────────────────────

  describe('public index discovery binds authUserId', () => {
    it('getPublicIndexesNotJoined delegates with authUserId', async () => {
      await userDb.getPublicIndexesNotJoined();
      expect(mockDb.getPublicIndexesNotJoined).toHaveBeenCalledWith(AUTH_USER);
    });

    it('joinPublicIndex delegates with indexId and authUserId', async () => {
      await userDb.joinPublicIndex('idx-public');
      expect(mockDb.joinPublicIndex).toHaveBeenCalledWith('idx-public', AUTH_USER);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Opportunity Operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe('opportunity operations', () => {
    it('getOpportunitiesForUser delegates with authUserId', async () => {
      const opts = { limit: 10 };
      await userDb.getOpportunitiesForUser(opts);
      expect(mockDb.getOpportunitiesForUser).toHaveBeenCalledWith(AUTH_USER, opts);
    });

    it('getOpportunity delegates directly (no ownership check)', async () => {
      await userDb.getOpportunity('opp-1');
      expect(mockDb.getOpportunity).toHaveBeenCalledWith('opp-1');
    });

    it('updateOpportunityStatus delegates directly (no ownership check)', async () => {
      await userDb.updateOpportunityStatus('opp-1', 'accepted' as never);
      expect(mockDb.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'accepted');
    });

    it('getAcceptedOpportunitiesBetweenActors delegates with authUserId', async () => {
      await userDb.getAcceptedOpportunitiesBetweenActors(OTHER_USER);
      expect(mockDb.getAcceptedOpportunitiesBetweenActors).toHaveBeenCalledWith(AUTH_USER, OTHER_USER);
    });

    it('acceptSiblingOpportunities delegates with authUserId', async () => {
      await userDb.acceptSiblingOpportunities(OTHER_USER, 'opp-exclude');
      expect(mockDb.acceptSiblingOpportunities).toHaveBeenCalledWith(AUTH_USER, OTHER_USER, 'opp-exclude');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // HyDE Operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe('HyDE operations delegate directly', () => {
    it('getHydeDocument delegates', async () => {
      await userDb.getHydeDocument('intent' as never, 'src-1', 'strategy-1');
      expect(mockDb.getHydeDocument).toHaveBeenCalledWith('intent', 'src-1', 'strategy-1');
    });

    it('getHydeDocumentsForSource delegates', async () => {
      await userDb.getHydeDocumentsForSource('intent' as never, 'src-1');
      expect(mockDb.getHydeDocumentsForSource).toHaveBeenCalledWith('intent', 'src-1');
    });

    it('saveHydeDocument delegates', async () => {
      const data = { sourceType: 'intent', sourceId: 'x' } as never;
      await userDb.saveHydeDocument(data);
      expect(mockDb.saveHydeDocument).toHaveBeenCalledWith(data);
    });

    it('deleteHydeDocumentsForSource delegates', async () => {
      await userDb.deleteHydeDocumentsForSource('intent' as never, 'src-1');
      expect(mockDb.deleteHydeDocumentsForSource).toHaveBeenCalledWith('intent', 'src-1');
    });
  });
});
