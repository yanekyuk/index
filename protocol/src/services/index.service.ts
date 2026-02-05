import db from '../lib/drizzle/drizzle';
import { addMemberToIndex } from '../lib/index-members';
import { log } from '../lib/log';
import { indexes, indexMembers, intents, intentIndexes } from '../schemas/database.schema';
import { eq, and, isNull } from 'drizzle-orm';

const logger = log.service.from("IndexService");

const PERSONAL_INDEX_TITLE = 'My Own Private Index';

/** Default permissions for personal index: private, no invitation link. */
const PERSONAL_INDEX_PERMISSIONS = {
  joinPolicy: 'invite_only' as const,
  invitationLink: null as { code: string } | null,
  allowGuestVibeCheck: false,
};

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
   * Get eligible indexes for a user where autoAssign is true.
   * 
   * USED BY:
   * - `IntentService.processIntentForIndex` (to determine potential targets).
   * 
   * @param userId - The user to find indexes for.
   * @returns List of Index IDs.
   */
  async getEligibleIndexesForUser(userId: string) {
    logger.info('[IndexService] Getting eligible indexes for user', { userId });
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
    logger.info('[IndexService] Getting intents for index members', { indexId });
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

  /**
   * Get index IDs that an intent is currently assigned to.
   * Used on intent update to re-evaluate only against existing indexes (no new assignments).
   */
  async getIndexIdsForIntent(intentId: string): Promise<string[]> {
    const rows = await db
      .select({ indexId: intentIndexes.indexId })
      .from(intentIndexes)
      .where(eq(intentIndexes.intentId, intentId));
    return rows.map((r) => r.indexId);
  }

  /**
   * Ensures the user has a personal index ("My Own Private Index"). Creates one if missing.
   * Personal index is the default write location for intents; private by design.
   * @returns The personal index id (existing or newly created)
   */
  async ensurePersonalIndex(userId: string): Promise<string> {
    const existing = await db
      .select({ id: indexes.id })
      .from(indexes)
      .innerJoin(indexMembers, and(eq(indexMembers.indexId, indexes.id), eq(indexMembers.userId, userId)))
      .where(eq(indexes.isPersonal, true))
      .limit(1);

    if (existing.length > 0) {
      return existing[0].id;
    }

    const [newIndex] = await db
      .insert(indexes)
      .values({
        title: PERSONAL_INDEX_TITLE,
        isPersonal: true,
        permissions: PERSONAL_INDEX_PERMISSIONS,
      })
      .returning({ id: indexes.id });

    if (!newIndex) {
      throw new Error('Failed to create personal index');
    }

    const result = await addMemberToIndex({
      indexId: newIndex.id,
      userId,
      role: 'owner',
      autoAssign: true,
    });

    if (!result.success) {
      logger.error('Failed to add owner to personal index', { userId, indexId: newIndex.id, error: result.error });
      throw new Error(result.error ?? 'Failed to add owner to personal index');
    }

    logger.info('Created personal index for user', { userId, indexId: newIndex.id });
    return newIndex.id;
  }

  /**
   * Returns the user's personal index id if it exists, otherwise null.
   */
  async getPersonalIndexId(userId: string): Promise<string | null> {
    const rows = await db
      .select({ id: indexes.id })
      .from(indexes)
      .innerJoin(indexMembers, and(eq(indexMembers.indexId, indexes.id), eq(indexMembers.userId, userId)))
      .where(eq(indexes.isPersonal, true))
      .limit(1);
    return rows[0]?.id ?? null;
  }
}

export const indexService = new IndexService();
