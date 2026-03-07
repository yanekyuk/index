/** Config */
import { config } from "dotenv";
config({ path: '.env.development', override: true });

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ProfileGraphFactory } from '../profile.graph';
import type { ProfileGraphDatabase } from '../../interfaces/database.interface';
import type { Embedder } from '../../interfaces/embedder.interface';
import type { Scraper } from '../../interfaces/scraper.interface';

/**
 * Integration tests for generate mode (ghost user profile generation).
 *
 * These tests use the real ProfileGenerator LLM agent but mock the database,
 * embedder, and scraper. They verify that the profile graph produces a
 * meaningful profile from minimal ghost user data (name + email only).
 */
describe('ProfileGraph - Generate Mode (Ghost Users)', () => {
  let mockDatabase: ProfileGraphDatabase;
  let mockEmbedder: Embedder;
  let mockScraper: Scraper;

  // Profiles saved by the mock — captured for assertions
  let savedProfiles: Map<string, any>;

  beforeEach(() => {
    savedProfiles = new Map();

    mockDatabase = {
      getProfile: mock(async () => null),
      getProfileByUserId: mock(async () => null),
      getUser: mock(async () => null),
      updateUser: mock(async (userId: string, data: any) => ({ id: userId, ...data })),
      saveProfile: mock(async (userId: string, profile: any) => {
        savedProfiles.set(userId, profile);
      }),
      getHydeDocument: mock(async () => null),
      saveHydeDocument: mock(async () => ({ id: 'mock-hyde-doc-id' })),
    } as any;

    mockEmbedder = {
      generate: mock(async () => Array(2000).fill(0.01)),
    } as any;

    mockScraper = {
      scrape: mock(async () => ''),
    } as any;
  });

  function buildGraph() {
    return new ProfileGraphFactory(mockDatabase, mockEmbedder, mockScraper).createGraph();
  }

  // ─────────────────────────────────────────────────────────
  // Real ghost users from Gmail contacts import
  // ─────────────────────────────────────────────────────────

  describe('seren (single first name, no socials)', () => {
    const seren = {
      id: 'ghost-seren',
      name: 'seren',
      email: 'seren@index.network',
      socials: null,
      location: null,
      intro: null,
    };

    it('should generate a profile with identity fields populated', async () => {
      (mockDatabase.getUser as any).mockResolvedValue(seren);

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: seren.id,
        operationMode: 'generate',
      });

      expect(result.error).toBeUndefined();
      expect(result.needsUserInfo).toBe(false);
      expect(result.profile).toBeDefined();
      expect(result.profile!.identity).toBeDefined();
      expect(result.profile!.identity.name).toBeTruthy();
      expect(result.profile!.narrative).toBeDefined();
      expect(result.profile!.attributes).toBeDefined();
      expect(mockDatabase.saveProfile).toHaveBeenCalledWith(seren.id, expect.anything());
    }, 120_000);
  });

  describe('seref (full name, no socials)', () => {
    const seref = {
      id: 'ghost-seref',
      name: 'Seref Yarar',
      email: 'seref@index.network',
      socials: null,
      location: null,
      intro: null,
    };

    it('should generate a profile from full name and email', async () => {
      (mockDatabase.getUser as any).mockResolvedValue(seref);

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: seref.id,
        operationMode: 'generate',
      });

      expect(result.error).toBeUndefined();
      expect(result.needsUserInfo).toBe(false);
      expect(result.profile).toBeDefined();
      expect(result.profile!.identity).toBeDefined();
      expect(result.profile!.identity.name).toBeTruthy();
      expect(mockDatabase.saveProfile).toHaveBeenCalledWith(seref.id, expect.anything());
    }, 120_000);
  });

  // ─────────────────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────────────────

  describe('ghost user with only email prefix as name', () => {
    const ghost = {
      id: 'ghost-johndoe',
      name: 'johndoe',
      email: 'johndoe@company.com',
      socials: null,
      location: null,
      intro: null,
    };

    it('should generate a profile from email-derived single-word name', async () => {
      (mockDatabase.getUser as any).mockResolvedValue(ghost);

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: ghost.id,
        operationMode: 'generate',
      });

      expect(result.error).toBeUndefined();
      expect(result.needsUserInfo).toBe(false);
      expect(result.profile).toBeDefined();
      expect(result.profile!.identity.name).toBeTruthy();
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
    }, 120_000);
  });

  describe('full pipeline produces hyde document', () => {
    const ghost = {
      id: 'ghost-pipeline',
      name: 'seren',
      email: 'seren@index.network',
      socials: null,
      location: null,
      intro: null,
    };

    it('should generate profile, embedding, and hyde document end to end', async () => {
      (mockDatabase.getUser as any).mockResolvedValue(ghost);

      const graph = buildGraph();
      const result = await graph.invoke({
        userId: ghost.id,
        operationMode: 'generate',
      });

      expect(result.error).toBeUndefined();
      expect(result.profile).toBeDefined();
      // Profile saved
      expect(mockDatabase.saveProfile).toHaveBeenCalled();
      // Embedding generated (at least for profile)
      expect(mockEmbedder.generate).toHaveBeenCalled();
      // Hyde document saved
      expect(mockDatabase.saveHydeDocument).toHaveBeenCalled();
    }, 120_000);
  });
});
