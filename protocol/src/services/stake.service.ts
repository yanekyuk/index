import db from '../lib/db';
import { intents, intentStakes, intentStakeItems, intentIndexes, userConnectionEvents, indexMembers } from '../lib/schema';
import { eq, and, sql, isNull, inArray, gt, or } from 'drizzle-orm';
import { generateEmbedding } from '../lib/embeddings';
import { StakeEvaluator } from '../agents/intent/stake/evaluator/stake.evaluator';
import { log } from '../lib/log';

/**
 * StakeService
 * 
 * CORE SERVICE: "The Matchmaker".
 * 
 * RESPONSIBILITIES:
 * 1. Discovering Candidates: Finding compatible intents using Vector Search & Shared Indexes.
 * 2. Evaluating Matches: Using LLM (`StakeEvaluator`) to determine if a connection offers Mutual Value.
 * 3. Creating Stakes: Storing the "Proof of Match" (Reasoning + Score) in the DB.
 * 
 * TERMINOLOGY:
 * - "Stake": A claim that two intents are related. It acts as an edge in the intent graph.
 *   (e.g., "Intent A stakes Intent B with 85% confidence")
 */
export class StakeService {
  /**
   * Main Pipeline: Matches a single Intent against the world.
   * 
   * STEPS:
   * 1. Retrieve the Source Intent.
   * 2. Find Candidates via Vector Search (Filtered by Privacy Scope / Index).
   * 3. LLM Eval: Batch evaluate candidates using `StakeEvaluator`.
   * 4. Persist: Save high-quality matches as "Stakes".
   * 
   * @param intentId - The intent looking for matches.
   */
  async processIntent(intentId: string) {
    log.info(`[StakeService] Processing intent ${intentId}`);

    // 1. Get Intent
    const currentIntent = await this.getIntent(intentId);
    if (!currentIntent) throw new Error(`Intent ${intentId} not found`);

    // 2. Find Candidates
    const candidates = await this.findCandidates(intentId, 10);
    log.info(`[StakeService] Found ${candidates.length} candidates`);

    if (candidates.length === 0) return;

    // 3. Run Info Matcher
    const matcher = new StakeEvaluator();
    const result = await matcher.run(
      { id: currentIntent.id, payload: currentIntent.payload },
      candidates.map(c => ({ id: c.id, payload: c.payload }))
    );

    log.info(`[StakeService] Matcher found ${result.matches.length} matches`);

    // 4. Save Matches
    for (const match of result.matches) {
      await this.saveMatch(
        currentIntent.id,
        match.candidateIntentId,
        match.confidence,
        match.reason,
        '028ef80e-9b1c-434b-9296-bb6130509482'
      );
    }
  }
  /**
   * Get an intent by ID
   */
  async getIntent(intentId: string) {
    const rows = await db.select()
      .from(intents)
      .where(eq(intents.id, intentId));
    return rows[0] || null;
  }

  /**
   * Vector Search Logic.
   * Finds semantically similar intents within the "Privacy Scope" of the user.
   * 
   * PRIVACY RULE:
   * You can only match with intents that share at least one "Index" (Community) with you.
   * This prevents global leaking of private intents.
   * 
   * @param currentIntent - The source intent.
   * @param limit - Max results.
   */
  async findSimilarIntents(currentIntent: typeof intents.$inferSelect, limit: number = 50) {
    // 1. Get the specific indexes that the USER belongs to (Dynamic Scoping)
    const currentIntentIndexes = await db
      .select({ indexId: indexMembers.indexId })
      .from(indexMembers)
      .where(eq(indexMembers.userId, currentIntent.userId));

    const indexIds = currentIntentIndexes.map(row => row.indexId);

    if (indexIds.length === 0) {
      return [];
    }

    // 2. Generate embedding if missing
    let queryEmbedding: number[];
    if (currentIntent.embedding) {
      queryEmbedding = currentIntent.embedding;
    } else {
      queryEmbedding = await generateEmbedding(currentIntent.payload);
    }

    // 3. Get Eligible User IDs (Scope)
    // Find all users who are members of the same indexes
    const eligibleUsers = await db
      .selectDistinct({ userId: indexMembers.userId })
      .from(indexMembers)
      .where(inArray(indexMembers.indexId, indexIds));

    const eligibleUserIds = eligibleUsers.map(u => u.userId);

    // Filter out self
    const validUserIds = eligibleUserIds.filter(id => id !== currentIntent.userId);

    if (validUserIds.length === 0) {
      return [];
    }

    // 4. Vector search (No JOINs needed, just WHERE IN)
    const results = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        userId: intents.userId,
        createdAt: intents.createdAt,
        distance: sql<number>`${intents.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`
      })
      .from(intents)
      .where(
        and(
          sql`${intents.id} != ${currentIntent.id}`,
          inArray(intents.userId, validUserIds),
          sql`${intents.embedding} IS NOT NULL`,
          isNull(intents.archivedAt)
        )
      )
      .orderBy(sql`${intents.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(limit);

    // Map to include similarity
    return results.map(r => ({
      ...r,
      similarity: 1 - r.distance
    }));
  }

  /**
   * Save a new stake into the database
   */
  async createStake(params: {
    intents: string[];
    stake: bigint;
    reasoning: string;
    agentId: string;
    userIds: string[];
  }): Promise<string> {
    const sortedIntents = [...params.intents].sort();

    return await db.transaction(async (tx) => {
      // 1. Create the stake entry
      const [newStake] = await tx.insert(intentStakes).values({
        intents: sortedIntents,
        stake: params.stake,
        reasoning: params.reasoning,
        agentId: params.agentId
      }).returning({ id: intentStakes.id });

      // 2. Insert into join table
      await tx.insert(intentStakeItems).values(
        sortedIntents.map((intentId, i) => ({
          stakeId: newStake.id,
          intentId,
          userId: params.userIds[i] // Assumes userIds matches sortedIntents order (caller must ensure)
        }))
      );

      return newStake.id;
    });
  }

  /**
   * Find candidate intents for a given intent.
   * Limits to best match per user, up to `limit` candidates.
   */
  async findCandidates(intentId: string, limit: number = 10) {
    const currentIntent = await this.getIntent(intentId);
    if (!currentIntent) throw new Error(`Intent ${intentId} not found`);

    // Fetch more candidates initially to allow for user diversity filtering
    const rawCandidates = await this.findSimilarIntents(currentIntent, 50);

    // Filter to keep best match per user
    const userBestMatch = new Map<string, typeof rawCandidates[0]>();

    for (const candidate of rawCandidates) {
      const existing = userBestMatch.get(candidate.userId);
      if (!existing || candidate.similarity > existing.similarity) {
        userBestMatch.set(candidate.userId, candidate);
      }
    }

    // Sort by similarity and take top N
    return Array.from(userBestMatch.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Save a confirmed match as a stake
   */
  async saveMatch(
    newIntentId: string,
    targetIntentId: string,
    score: number,
    reasoning: string,
    agentId: string
  ) {
    const newIntentUser = await this.getIntentUser(newIntentId);
    const targetIntentUser = await this.getIntentUser(targetIntentId);

    if (!newIntentUser || !targetIntentUser) {
      log.error(`[StakeService] Missing user for intents ${newIntentId} or ${targetIntentUser}`);
      return;
    }

    const intents = [newIntentId, targetIntentId].sort();
    const userIds = intents.map(id => id === newIntentId ? newIntentUser : targetIntentUser);

    await this.createStake({
      intents,
      userIds,
      stake: BigInt(Math.floor(score)),
      reasoning,
      agentId
    });
  }

  /**
   * Helper to get user ID for an intent
   */
  async getIntentUser(intentId: string): Promise<string | null> {
    const res = await db.select({ userId: intents.userId })
      .from(intents)
      .where(eq(intents.id, intentId));
    return res[0]?.userId || null;
  }

  /**
   * Get stakes created in the last N days
   */
  async getRecentStakes(daysSince: number) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysSince);

    return db.select({
      id: intentStakes.id,
      createdAt: intentStakes.createdAt
    })
      .from(intentStakes)
      .where(gt(intentStakes.createdAt, cutoffDate));
  }

  /**
   * Get unique user IDs involved in the given stakes
   */
  async getAffectedUserIdsFromStakes(stakeIds: string[]) {
    if (stakeIds.length === 0) return [];

    const affectedUserRows = await db.selectDistinct({ userId: intents.userId })
      .from(intentStakeItems)
      .innerJoin(intents, eq(intents.id, intentStakeItems.intentId))
      .where(inArray(intentStakeItems.stakeId, stakeIds));

    return affectedUserRows.map(r => r.userId);
  }

  /**
   * Check if there is an existing connection event between two users
   */
  async checkConnectionEvent(user1Id: string, user2Id: string) {
    const events = await db.select({ id: userConnectionEvents.id })
      .from(userConnectionEvents)
      .where(
        or(
          and(
            eq(userConnectionEvents.initiatorUserId, user1Id),
            eq(userConnectionEvents.receiverUserId, user2Id)
          ),
          and(
            eq(userConnectionEvents.initiatorUserId, user2Id),
            eq(userConnectionEvents.receiverUserId, user1Id)
          )
        )
      )
      .limit(1);

    return events.length > 0;
  }
}

export const stakeService = new StakeService();
