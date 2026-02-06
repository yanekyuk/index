import { log } from '../lib/log';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';

const logger = log.service.from("IndexService");

/**
 * IndexService
 * 
 * Manages index/community operations.
 * Uses ChatDatabaseAdapter for database operations.
 * 
 * RESPONSIBILITIES:
 * - List indexes for users
 * - Manage index memberships
 */
export class IndexService {
  constructor(private db = new ChatDatabaseAdapter()) {}

  /**
   * Get all indexes that a user is a member of, including their personal index.
   * 
   * @param userId - The user ID
   * @returns Indexes with pagination metadata
   */
  async getIndexesForUser(userId: string) {
    logger.info('[IndexService] Getting indexes for user', { userId });
    
    return this.db.getIndexesForUser(userId);
  }
}

export const indexService = new IndexService();
