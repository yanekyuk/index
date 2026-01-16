import db from '../lib/db';
import { indexes, indexMembers, intents } from '../lib/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { log } from '../lib/log';

/**
 * IndexService
 * 
 * Manages "Indexes" (Communities/Groups) and member relationships.
 * 
 * CONTEXT:
 * An "Index" is a grouping of users and their intents.
 * Members of an Index allow their intents to be "seen" by other members of that same index (privacy scope).
 */
export class IndexService {
  /**
  /**
   * Get eligible indexes for a user where autoAssign is true.
   * 
   * USED BY:
   * - `IntentService.processIntentForIndex` (to determine potential targets).
   * 
   * @param userId - The user to find indexes for.
   * @returns List of Index IDs.
   */
  async getEligibleIndexesForUser(userId: string) {
    log.info('[IndexService] Getting eligible indexes for user', { userId });
    return await db
      .select({ id: indexes.id })
      .from(indexes)
      .innerJoin(indexMembers, eq(indexes.id, indexMembers.indexId))
      .where(and(
        eq(indexMembers.userId, userId),
        eq(indexMembers.autoAssign, true),
        isNull(indexes.deletedAt)
      ));
  }

  /**
   * Get intents for all members of an index where autoAssign is true.
   * 
   * USED BY:
   * - Legacy matchmaking logic (potentially deprecated).
   * 
   * @param indexId - The index to query.
   * @returns List of { intentId, userId }.
   */
  async getIntentsForIndexMembers(indexId: string) {
    log.info('[IndexService] Getting intents for index members', { indexId });
    return await db
      .select({ intentId: intents.id, userId: intents.userId })
      .from(intents)
      .innerJoin(indexMembers, eq(intents.userId, indexMembers.userId))
      .where(and(
        eq(indexMembers.indexId, indexId),
        eq(indexMembers.autoAssign, true),
        isNull(intents.archivedAt)
      ));
  }
}

export const indexService = new IndexService();
