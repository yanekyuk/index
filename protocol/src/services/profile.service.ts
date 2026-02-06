import { log } from '../lib/log';
import type { ProfileGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import type { Scraper } from '../lib/protocol/interfaces/scraper.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import { ProfileGraphFactory } from '../lib/protocol/graphs/profile/profile.graph';
import { ProfileDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';

const logger = log.service.from("ProfileService");

/**
 * ProfileService
 * 
 * Manages profile generation and synchronization.
 * Uses ProfileDatabaseAdapter for database operations.
 * Uses ProfileGraphFactory for graph-based profile generation.
 * 
 * RESPONSIBILITIES:
 * - Generate/sync user profiles through Profile Graph
 * - Coordinate profile, embedder, and scraper operations
 */
export class ProfileService {
  private db: ProfileGraphDatabase;
  private embedder: Embedder;
  private scraper: Scraper;
  private factory: ProfileGraphFactory;

  constructor() {
    this.db = new ProfileDatabaseAdapter();
    this.embedder = new EmbedderAdapter();
    this.scraper = new ScraperAdapter();
    this.factory = new ProfileGraphFactory(this.db, this.embedder, this.scraper);
  }

  /**
   * Sync/generate a profile for a user.
   * Invokes the profile graph to create or update the user's profile.
   * 
   * @param userId - The user ID
   * @returns Graph execution result with profile data
   */
  async syncProfile(userId: string): Promise<Record<string, unknown>> {
    logger.info('[ProfileService] Syncing profile', { userId });

    const graph = this.factory.createGraph();
    const result = await graph.invoke({ userId });

    return result;
  }
}

export const profileService = new ProfileService();
