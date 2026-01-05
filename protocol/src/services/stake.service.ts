import db from '../lib/db';
import { intents, intentStakes, intentStakeItems, indexMembers, userProfiles } from '../lib/schema';
import { eq, and, sql, isNull, inArray, gt, or, cosineDistance, desc, ne, SQL } from 'drizzle-orm';
import { IndexEmbedder } from '../lib/embedder';
import { VectorSearchResult, VectorStoreOption } from '../agents/common/types';

// Helper to map collection names to tables
const COLLECTIONS = {
  intents: intents,
  profiles: userProfiles
};

async function postgresSearcher<T>(
  queryVector: number[],
  collection: string,
  options: VectorStoreOption<T> = {}
): Promise<VectorSearchResult<T>[]> {
  const table = COLLECTIONS[collection as keyof typeof COLLECTIONS];
  if (!table) {
    throw new Error(`PostgresSearcher: Unknown collection '${collection}'`);
  }

  const limit = options.limit || 10;
  const vectorColumn = table.embedding;

  // Calculate similarity (1 - cosine_distance)
  const similarity = sql<number>`1 - (${cosineDistance(vectorColumn, queryVector)})`;

  const filters: SQL[] = [];

  // Apply filters
  if (options.filter) {
    for (const [key, value] of Object.entries(options.filter)) {
      const column = table[key as keyof typeof table] as any;
      if (!column) continue; // Skip unknown columns

      if (value === null) {
        filters.push(isNull(column));
      } else if (typeof value === 'object' && value !== null) {
        // Handle operators like { ne: ... }, { in: ... }
        if ('ne' in value) {
          filters.push(ne(column, value.ne));
        }
        if ('in' in value && Array.isArray(value.in)) {
          filters.push(inArray(column, value.in));
        }
      } else {
        // Direct equality
        filters.push(eq(column, value));
      }
    }
  }

  const query = db
    .select({
      item: table,
      score: similarity
    })
    .from(table)
    .where(and(...filters))
    .orderBy(desc(similarity))
    .limit(limit);

  const results = await query;

  return results.map(row => ({
    item: row.item as T,
    score: row.score
  }));
}

const embedder = new IndexEmbedder({
  searcher: postgresSearcher
});
import { StakeEvaluator } from '../agents/intent/stake/evaluator/stake.evaluator';
import { SynthesisGenerator } from '../agents/intent/stake/synthesis/synthesis.generator';
import { IntroGenerator } from '../agents/intent/stake/intro/intro.generator';
import { getConnectingStakes, stakeBuildPairs, stakeUserItems } from '../lib/stakes';
import { cache } from '../lib/redis';
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
      queryEmbedding = (await embedder.generate(currentIntent.payload)) as number[];
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
    // 4. Vector search via Embedder
    const searchResults = await embedder.search<typeof intents.$inferSelect>(
      queryEmbedding,
      'intents',
      {
        limit,
        filter: {
          id: { ne: currentIntent.id },
          userId: { in: validUserIds },
          archivedAt: null
        }
      }
    );

    return searchResults.map((r) => ({
      ...r.item,
      distance: 1 - r.score, // Legacy mapping compatibility
      similarity: r.score
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
   * 
   * LOGIC:
   * 1. Performs a broader vector search (fetch 50) to gather a diverse pool.
   * 2. Filters to keep only the *single best match* per unique User.
   *    (This ensures we don't return 10 stakes all from the same user).
   * 3. Sorts by similarity and returns the top `limit`.
   * 
   * @param intentId - The source ID looking for matches.
   * @param limit - Maximum number of diverse candidates to return.
   * @returns List of candidate intents with similarity scores.
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
   * Get recent stakes for a user to provide context for deduplication.
   * JOINs to get the Candidate's Name and the Stake Reason.
   */
  async getUserStakes(userId: string, limit: number = 20): Promise<{ candidateName: string, candidateId: string, reason: string, score: number }[]> {
    // 1. Find all stakes this user is part of
    // user -> intent -> stake_item -> stake
    const userStakes = await db
      .select({
        stakeId: intentStakes.id,
        reason: intentStakes.reasoning,
        score: intentStakes.stake,
        createdAt: intentStakes.createdAt
      })
      .from(intentStakes)
      .innerJoin(intentStakeItems, eq(intentStakeItems.stakeId, intentStakes.id))
      .innerJoin(intents, eq(intents.id, intentStakeItems.intentId))
      .where(eq(intents.userId, userId))
      .orderBy(sql`${intentStakes.createdAt} DESC`)
      .limit(limit);

    if (userStakes.length === 0) return [];

    // 2. For each stake, find the OTHER user (Candidate)
    const results: { candidateName: string, candidateId: string, reason: string, score: number }[] = [];

    for (const stake of userStakes) {
      // Find items in this stake NOT belonging to the source user
      const otherItems = await db
        .select({
          userName: userProfiles.identity,
          userId: intents.userId
        })
        .from(intentStakeItems)
        .innerJoin(intents, eq(intents.id, intentStakeItems.intentId))
        .innerJoin(userProfiles, eq(userProfiles.userId, intents.userId)) // Join profile to get name
        .where(and(
          eq(intentStakeItems.stakeId, stake.stakeId),
          sql`${intents.userId} != ${userId}`
        ))
        .limit(1);

      if (otherItems.length > 0) {
        const candidateName = (otherItems[0].userName as any)?.name || 'Unknown';
        results.push({
          candidateName,
          candidateId: otherItems[0].userId,
          reason: stake.reason || 'No reason provided',
          score: Number(stake.score)
        });
      }
    }

    return results;
  }

  async createCacheHash(data: any, options?: any): Promise<string> {
    const { default: crypto } = await import('crypto');
    return crypto
      .createHash('sha256')
      .update(JSON.stringify({ data, options: options || {} }))
      .digest('hex');
  }

  /**
   * Generates a "Vibe Check" (Synthesis) for a pair of users.
   * 
   * LOGIC:
   * 1. Check Cache (Redis).
   * 2. If Miss: 
   *    - Find Connecting Stakes (Why are they related?).
   *    - Flatten Stakes into "Intent Pairs".
   *    - Call `SynthesisGenerator` agent.
   * 3. Cache Result & Return.
   * 
   * @param contextUser - The person initiating the request (or "You").
   * @param targetUser - The person being looked at.
   * @param opts - Config options.
   */
  async generateSynthesis(
    contextUser: { id: string; name: string },
    targetUser: { id: string; name: string; intro?: string | null },
    opts: {
      intentIds?: string[];
      indexIds?: string[];
      vibeOptions?: any;
    } = {}
  ): Promise<{ synthesis: string; subject: string }> {
    try {
      const { intentIds, indexIds, vibeOptions } = opts;
      const isThirdPerson = vibeOptions?.style === 'newsletter';

      log.info(`[StakeService] Starting synthesis`, { contextUser: contextUser.id, targetUser: targetUser.id, isThirdPerson });

      // 1. Get connecting stakes
      const stakes = await getConnectingStakes({
        authenticatedUserId: contextUser.id,
        userIds: [contextUser.id, targetUser.id],
        requireAllUsers: true,
        indexIds,
        intentIds,
        limit: 10
      });

      if (!stakes.length) {
        log.info('[StakeService] No connecting stakes found');
        return { synthesis: "", subject: "" };
      }

      // 2. Build intent pairs
      const intentPairs = stakes
        .flatMap(stake => stakeBuildPairs(stake, contextUser.id, targetUser.id))
        .filter(p => p !== null);

      if (!intentPairs.length) {
        log.info('[StakeService] No intent pairs built');
        return { synthesis: "", subject: "" };
      }

      // 3. Deduplicate pairs
      const seenPayloads = new Set<string>();
      const uniqueIntentPairs: typeof intentPairs = [];

      for (const pair of intentPairs) {
        const key = `${pair.contextUserIntent.payload.trim()}::${pair.targetUserIntent.payload.trim()}`;
        if (!seenPayloads.has(key)) {
          seenPayloads.add(key);
          uniqueIntentPairs.push(pair);
        }
      }

      // 4. Prepare Agent Input
      const vibeData = {
        initiator: contextUser.name,
        target: targetUser.name,
        targetIntro: targetUser.intro || "",
        isThirdPerson,
        intentPairs: uniqueIntentPairs.map(p => ({
          contextUserIntent: {
            id: p.contextUserIntent.id,
            payload: p.contextUserIntent.payload,
            createdAt: p.contextUserIntent.createdAt || new Date()
          },
          targetUserIntent: {
            id: p.targetUserIntent.id,
            payload: p.targetUserIntent.payload,
            createdAt: p.targetUserIntent.createdAt || new Date()
          }
        }))
      };

      // 5. Check Cache
      const cacheKey = await this.createCacheHash(vibeData, vibeOptions);
      const cached = await cache.hget('synthesis', cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed.synthesis === 'string') {
            log.info('[StakeService] Returning cached synthesis');
            return parsed;
          }
        } catch { }
      }

      // 6. Generate
      log.debug('[StakeService] Calling SynthesisGenerator agent', {
        intentPairsCount: vibeData.intentPairs.length
      });

      const synthesisGenerator = new SynthesisGenerator();
      const result = await synthesisGenerator.run(vibeData);

      if (result && result.body) {
        const output = { synthesis: result.body, subject: result.subject };
        await cache.hset('synthesis', cacheKey, JSON.stringify(output));
        return output;
      }

      return { synthesis: "", subject: "" };

    } catch (error) {
      log.error('[StakeService] Error generating synthesis:', { error });
      return { synthesis: "", subject: "" };
    }
  }

  /**
   * Generates an intro message.
   */
  async generateIntro(
    sender: { id: string; name: string },
    recipient: { id: string; name: string },
    indexIds?: string[]
  ): Promise<string> {
    try {
      const stakes = await getConnectingStakes({
        authenticatedUserId: sender.id,
        userIds: [sender.id, recipient.id],
        requireAllUsers: true,
        indexIds
      });

      if (!stakes.length) return "";

      const senderReasonings: string[] = [];
      const recipientReasonings: string[] = [];

      for (const stake of stakes) {
        if (!stake.reasoning) continue;
        const senderItems = stakeUserItems(stake, sender.id);
        const recipientItems = stakeUserItems(stake, recipient.id);
        if (senderItems.length) senderReasonings.push(stake.reasoning);
        if (recipientItems.length) recipientReasonings.push(stake.reasoning);
      }

      if (!senderReasonings.length || !recipientReasonings.length) return "";

      const introGenerator = new IntroGenerator();
      const result = await introGenerator.run({
        sender: { name: sender.name, reasonings: senderReasonings },
        recipient: { name: recipient.name, reasonings: recipientReasonings }
      });

      return result.synthesis || "";
    } catch (error) {
      log.error('[StakeService] Error generating intro:', { error });
      return "";
    }
  }
}

export const stakeService = new StakeService();
