import { eq, and, isNull, sql, ne, isNotNull } from 'drizzle-orm';
import db from '../lib/drizzle/drizzle';
import { intents, intentIndexes, intentStakes, intentStakeItems, userProfiles } from '../schemas/database.schema';
import { log } from '../lib/log';
import { getUserAccessibleIndexIds } from '../lib/index-access';
import { summarizeIntent } from '../agents/core/intent_summarizer';
import { IndexEmbedder } from '../lib/embedder';
import { VectorSearchResult, VectorStoreOption } from '../agents/common/types';
import { HydeGeneratorAgent, HydeOptions } from '../agents/profile/hyde/hyde.generator';
import { OpportunityEvaluator } from '../agents/opportunity/opportunity.evaluator';
import { UserMemoryProfile } from '../agents/intent/manager/intent.manager.types';
import { IntentManager } from '../agents/intent/manager/intent.manager';
import { json2md } from '../lib/json2md/json2md';
import fs from 'fs/promises';
import path from 'path';


const logger = log.service.from("OpportunityService");
/**
 * Options for creating an intent within the opportunity service.
 * Mirrors the structure from IntentService but is self-contained.
 */
export interface CreateOpportunityIntentOptions {
  payload: string;
  userId: string;
  isIncognito?: boolean;
  indexIds?: string[];
  sourceId?: string;
  sourceType?: 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment';
  confidence: number;
  reasoning?: string;
  inferenceType: 'explicit' | 'implicit';
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Result of intent creation.
 */
export interface CreatedOpportunityIntent {
  id: string;
  payload: string;
  summary: string | null;
  isIncognito: boolean;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}

/**
 * OpportunityService
 * 
 * CORE SERVICE: The "Super Connector" - Finds mutually beneficial connections between users.
 * 
 * This service encapsulates all database operations and business logic for the 
 * Opportunity Finder system. It deliberately reimplements methods found in other 
 * services (ProfileService, IntentService, StakeService) to maintain the rule that 
 * services cannot import other services.
 * 
 * KEY RESPONSIBILITIES:
 * 1. Profile Management: Embeddings, HyDE vectors for opportunity matching.
 * 2. Intent Resolution: Creating implicit intents when opportunities are found.
 * 3. Stake Creation: Recording matches between users as stakes.
 * 4. Opportunity Cycle: Orchestrating the full matching algorithm.
 * 
 * DESIGN RATIONALE:
 * - This service is designed to be self-contained and not dependent on other services.
 * - All database queries are reimplemented here rather than importing from other services.
 * - This follows the project rule: "services cannot import other services."
 */
export class OpportunityService {
  private embedder: IndexEmbedder;

  constructor() {
    this.embedder = new IndexEmbedder({
      searcher: this.searchProfiles.bind(this)
    });
  }

  // ============================================================================
  // PROFILE-RELATED METHODS (Reimplemented from ProfileService)
  // ============================================================================

  /**
   * Get profiles that do not have an embedding yet.
   * Used during the backfill phase to ensure all profiles are embeddable.
   */
  async getProfilesMissingEmbeddings() {
    return await db
      .select()
      .from(userProfiles)
      .where(isNull(userProfiles.embedding));
  }

  /**
   * Update the embedding for a specific user profile.
   * 
   * @param profileId - The profile's primary key (not userId).
   * @param embedding - The vector embedding to store.
   */
  async updateProfileEmbedding(profileId: string, embedding: number[]) {
    await db.update(userProfiles)
      .set({ embedding })
      .where(eq(userProfiles.id, profileId));
  }

  /**
   * Update HyDE (Hypothetical Document Embedding) data for a profile.
   * HyDE describes the "ideal candidate" this user would want to meet.
   * 
   * @param profileId - The profile's primary key.
   * @param hydeDescription - Natural language description of ideal candidate.
   * @param hydeEmbedding - Vector embedding of the description.
   */
  async updateProfileHyde(profileId: string, hydeDescription: string, hydeEmbedding: number[]) {
    await db.update(userProfiles)
      .set({
        hydeDescription,
        hydeEmbedding,
        updatedAt: new Date()
      })
      .where(eq(userProfiles.id, profileId));
  }

  /**
   * Get a complete User Profile by User ID.
   * 
   * @param userId - The user's ID.
   * @returns The profile or undefined if not found.
   */
  async getProfile(userId: string) {
    const [profile] = await db.select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    return profile;
  }

  /**
   * Get all profiles that have an embedding.
   * These are the profiles eligible for opportunity matching.
   */
  async getAllProfilesWithEmbeddings() {
    return db.select()
      .from(userProfiles)
      .where(isNotNull(userProfiles.embedding));
  }

  /**
   * Vector search for profiles.
   * Injected into IndexEmbedder for semantic search during opportunity discovery.
   * 
   * @param vector - Query vector for similarity search.
   * @param collection - Must be 'profiles'.
   * @param options - Search options (limit, filter).
   * @returns Array of profiles with similarity scores.
   */
  async searchProfiles<T>(
    vector: number[],
    collection: string,
    options?: VectorStoreOption<T>
  ): Promise<VectorSearchResult<T>[]> {
    if (collection !== 'profiles') {
      throw new Error(`OpportunityService only supports 'profiles' collection, got '${collection}'`);
    }

    const limit = options?.limit || 10;
    const filter = options?.filter;
    const vectorString = JSON.stringify(vector);

    // Build conditions
    const conditions = [isNotNull(userProfiles.embedding)];

    if (filter) {
      if (filter.userId && typeof filter.userId === 'object' && filter.userId.ne) {
        conditions.push(ne(userProfiles.userId, filter.userId.ne));
      }
    }

    const whereClause = and(...conditions);

    const resultsWithDistance = await db.select({
      item: userProfiles,
      distance: sql<number>`${userProfiles.embedding} <=> ${vectorString}`
    })
      .from(userProfiles)
      .where(whereClause)
      .orderBy(sql`${userProfiles.embedding} <=> ${vectorString}`)
      .limit(limit);

    return resultsWithDistance.map((r: any) => ({
      item: r.item as unknown as T,
      score: 1 - r.distance
    }));
  }

  // ============================================================================
  // INTENT-RELATED METHODS (Reimplemented from IntentService)
  // ============================================================================

  /**
   * Get all active intents for a user (full objects).
   * Used to provide context when inferring implicit intents.
   * 
   * @param userId - The user's ID.
   * @returns Array of active intent objects.
   */
  async getUserIntentObjects(userId: string) {
    return await db.select({
      id: intents.id,
      payload: intents.payload,
      summary: intents.summary,
      createdAt: intents.createdAt
    })
      .from(intents)
      .where(and(
        eq(intents.userId, userId),
        isNull(intents.archivedAt)
      ));
  }

  /**
   * Create a new intent with full orchestration pipeline.
   * 
   * PIPELINE:
   * 1. Summarize: Generate short summary using IntentSummarizer.
   * 2. Embed: Generate vector embedding for semantic search.
   * 3. Persist: Save to intents table.
   * 4. Index: Associate with specified index IDs.
   * 5. Stake: Create inference stake to track provenance.
   * 
   * @param options - Intent creation options.
   * @returns The created intent.
   */
  async createIntent(options: CreateOpportunityIntentOptions): Promise<CreatedOpportunityIntent> {
    const {
      payload,
      userId,
      isIncognito = false,
      indexIds = [],
      sourceId,
      sourceType,
      confidence,
      reasoning,
      inferenceType,
      createdAt,
      updatedAt
    } = options;

    // Ensure dates are Date objects
    const createdAtDate = createdAt ? (createdAt instanceof Date ? createdAt : new Date(createdAt)) : undefined;
    const updatedAtDate = updatedAt ? (updatedAt instanceof Date ? updatedAt : new Date(updatedAt)) : undefined;

    // Generate summary
    const summary = await summarizeIntent(payload);

    // Generate embedding for semantic search
    let embedding: number[] | null = null;
    try {
      embedding = await this.embedder.generate(payload) as number[];
    } catch (error) {
      logger.error('[OpportunityService.createIntent] Failed to generate embedding:', { error });
      // Continue without embedding - it's optional
    }

    // Create the intent
    const [newIntent] = await db.insert(intents).values({
      payload,
      summary,
      isIncognito,
      userId,
      sourceId: sourceId || undefined,
      sourceType: sourceType || undefined,
      embedding: embedding || undefined,
      ...(createdAtDate && { createdAt: createdAtDate }),
      ...(updatedAtDate && { updatedAt: updatedAtDate })
    }).returning({
      id: intents.id,
      payload: intents.payload,
      summary: intents.summary,
      isIncognito: intents.isIncognito,
      createdAt: intents.createdAt,
      updatedAt: intents.updatedAt,
      userId: intents.userId
    });

    if (!newIntent) {
      throw new Error('Failed to create intent - no intent returned from insert');
    }

    // Associate with indexes if provided
    if (indexIds.length > 0) {
      await db.insert(intentIndexes).values(
        indexIds.map((indexId: string) => ({
          intentId: newIntent.id,
          indexId: indexId
        }))
      );
    }

    // Create inference stake (tracks confidence/provenance)
    await db.insert(intentStakes).values({
      intents: [newIntent.id],
      stake: BigInt(Math.floor(confidence * 100)),
      reasoning: reasoning || `${inferenceType} inference from opportunity discovery`,
      agentId: '028ef80e-9b1c-434b-9296-bb6130509482' // OpportunityFinder Agent ID
    });

    return newIntent;
  }

  /**
   * Update an existing intent's payload.
   * Regenerates summary when payload changes.
   * 
   * @param id - Intent ID.
   * @param userId - User ID (for access control).
   * @param data - Update data.
   * @returns Updated intent or null if not found.
   */
  async updateIntent(
    id: string,
    userId: string,
    data: { payload?: string; isIncognito?: boolean; indexIds?: string[] }
  ) {
    const { payload, isIncognito, indexIds } = data;

    // Check availability
    const intent = await db.select({ id: intents.id, userId: intents.userId })
      .from(intents)
      .where(and(eq(intents.id, id), isNull(intents.archivedAt)))
      .limit(1);

    if (intent.length === 0) return null;
    if (intent[0].userId !== userId) throw new Error('Access denied');

    const updateData: any = { updatedAt: new Date() };

    if (payload !== undefined) {
      updateData.payload = payload;
      const newSummary = await summarizeIntent(payload);
      if (newSummary) {
        updateData.summary = newSummary;
      }
    }

    if (isIncognito !== undefined) {
      updateData.isIncognito = isIncognito;
    }

    const [updatedIntent] = await db.update(intents)
      .set(updateData)
      .where(eq(intents.id, id))
      .returning();

    // Update indexes if provided
    if (indexIds !== undefined) {
      await db.delete(intentIndexes).where(eq(intentIndexes.intentId, id));
      if (indexIds.length > 0) {
        await db.insert(intentIndexes).values(
          indexIds.map(idxId => ({
            intentId: id,
            indexId: idxId
          }))
        );
      }
    }

    return updatedIntent;
  }

  // ============================================================================
  // STAKE-RELATED METHODS (Reimplemented from StakeService)
  // ============================================================================

  /**
   * Get recent stakes for a user to provide context for deduplication.
   * JOINs to get the Candidate's Name and the Stake Reason.
   * 
   * @param userId - The user's ID.
   * @param limit - Maximum number of stakes to return.
   * @returns Array of stake summaries with candidate info.
   */
  async getUserStakes(
    userId: string,
    limit: number = 20
  ): Promise<{ candidateName: string; candidateId: string; reason: string; score: number }[]> {
    // Find all stakes this user is part of
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

    const results: { candidateName: string; candidateId: string; reason: string; score: number }[] = [];

    for (const stake of userStakes) {
      // Find items in this stake NOT belonging to the source user
      const otherItems = await db
        .select({
          userName: userProfiles.identity,
          odaUserId: intents.userId
        })
        .from(intentStakeItems)
        .innerJoin(intents, eq(intents.id, intentStakeItems.intentId))
        .innerJoin(userProfiles, eq(userProfiles.userId, intents.userId))
        .where(and(
          eq(intentStakeItems.stakeId, stake.stakeId),
          sql`${intents.userId} != ${userId}`
        ))
        .limit(1);

      if (otherItems.length > 0) {
        const candidateName = (otherItems[0].userName as any)?.name || 'Unknown';
        results.push({
          candidateName,
          candidateId: otherItems[0].odaUserId,
          reason: stake.reason || 'No reason provided',
          score: Number(stake.score)
        });
      }
    }

    return results;
  }

  /**
   * Retrieves the user ID associated with a given intent.
   * 
   * This helper exists because stakes link intents rather than users directly,
   * but we often need to know which user owns an intent when creating notifications
   * or validating stake participants. The indirection through intents allows for
   * more flexible matching (e.g., multiple intents per user can match independently).
   * 
   * @param intentId - The unique identifier of the intent.
   * @returns The user ID who owns the intent, or null if the intent doesn't exist.
   * @private Only used internally by saveMatch to resolve stake participants.
   */
  private async getIntentUser(intentId: string): Promise<string | null> {
    const res = await db.select({ odaUserId: intents.userId })
      .from(intents)
      .where(eq(intents.id, intentId));
    return res[0]?.odaUserId || null;
  }

  /**
   * Persists a stake (match record) between two intents in a single transaction.
   * 
   * Stakes are the core "match" artifact in the opportunity system. They represent
   * a confirmed connection between two users based on complementary intents. The
   * transactional approach ensures atomicity: either both the stake and all its
   * join table entries are created, or none are (preventing orphaned records).
   * 
   * Intent IDs are sorted before storage to ensure consistent deduplication—
   * a stake between [A, B] and [B, A] would otherwise create duplicates.
   * 
   * @param params.intents - Array of intent IDs to link (exactly 2 for pair matches).
   * @param params.stake - Confidence score as BigInt (0-100 scale).
   * @param params.reasoning - Human-readable explanation of why this match was made.
   * @param params.agentId - ID of the agent that created this stake (for auditing).
   * @param params.userIds - User IDs corresponding to each intent (same order as intents).
   * @returns The newly created stake's unique identifier.
   * @private Only used internally by saveMatch; external code should use saveMatch.
   */
  private async createStake(params: {
    intents: string[];
    stake: bigint;
    reasoning: string;
    agentId: string;
    userIds: string[];
  }): Promise<string> {
    const sortedIntents = [...params.intents].sort();

    return await db.transaction(async (tx) => {
      // Create the stake entry
      const [newStake] = await tx.insert(intentStakes).values({
        intents: sortedIntents,
        stake: params.stake,
        reasoning: params.reasoning,
        agentId: params.agentId
      }).returning({ id: intentStakes.id });

      // Insert into join table for efficient querying by intent or user
      await tx.insert(intentStakeItems).values(
        sortedIntents.map((intentId, i) => ({
          stakeId: newStake.id,
          intentId,
          userId: params.userIds[i]
        }))
      );

      return newStake.id;
    });
  }

  /**
   * Save a confirmed match as a stake between two intents.
   * 
   * @param newIntentId - The source intent ID.
   * @param targetIntentId - The target intent ID.
   * @param score - Match score (0-100).
   * @param reasoning - Explanation for the match.
   * @param agentId - ID of the agent that made the match.
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
      logger.error(`[OpportunityService] Missing user for intents ${newIntentId} or ${targetIntentId}`);
      return;
    }

    const intentIds = [newIntentId, targetIntentId].sort();
    const userIds = intentIds.map(id => id === newIntentId ? newIntentUser : targetIntentUser);

    await this.createStake({
      intents: intentIds,
      userIds,
      stake: BigInt(Math.floor(score)),
      reasoning,
      agentId
    });
  }

  // ============================================================================
  // OPPORTUNITY CYCLE METHODS
  // ============================================================================

  /**
   * Constructs a single text blob from profile fields for embedding generation.
   * 
   * Embedding models work best with natural text that captures the essence of
   * what we're trying to match. By concatenating bio, location, context, interests,
   * and skills, we create a holistic representation of the user that enables
   * semantic similarity search. The order matters less than having all relevant
   * signals present—the embedding model will capture the relationships.
   * 
   * Empty/null values are filtered out to avoid noise in the embedding.
   * 
   * @param profile - The user profile record from the database.
   * @returns A space-separated string of all profile text content.
   * @private Only used internally during embedding backfill and discovery.
   */
  private constructProfileText(profile: typeof userProfiles.$inferSelect): string {
    const parts = [
      profile.identity?.bio,
      profile.identity?.location,
      profile.narrative?.context,
      ...(profile.attributes?.interests || []),
      ...(profile.attributes?.skills || [])
    ];
    return parts.filter(Boolean).join(' ');
  }

  /**
   * Translates IntentManager action responses into actual database operations.
   * 
   * The IntentManager agent returns declarative "actions" (create, update, expire,
   * ignore) rather than performing operations directly. This method bridges that
   * gap by executing the appropriate database calls based on the action type.
   * 
   * Priority order matters: Create takes precedence over Update because if the
   * agent suggests creating a new intent, it means the opportunity is distinct
   * enough to warrant a separate record rather than modifying an existing one.
   * 
   * Returns both the intent ID and its score because stake calculation needs
   * both pieces of information to compute the final pair stake score.
   * 
   * @param userId - The user for whom the intent should be created/updated.
   * @param actions - Array of action objects from IntentManager.processImplicitIntent().
   * @returns Object with intent ID and felicity score, or null if no actionable intent.
   */
  async resolveIntentFromActions(userId: string, actions: any[]): Promise<{ id: string; score: number } | null> {
    // Priority: Create > Update > Ignore
    const createAction = actions.find(a => a.type === 'create');
    if (createAction) {
      const indexIds = await getUserAccessibleIndexIds(userId);
      const created = await this.createIntent({
        userId,
        payload: createAction.payload,
        indexIds,
        sourceType: 'enrichment', // Implicit
        // If score is provided, use it (score is 0-100, confidence is 0-1).
        // If score is 80, confidence should be 0.8
        confidence: createAction.score ? createAction.score / 100 : 1.0,
        reasoning: createAction.reasoning || undefined,
        inferenceType: 'implicit'
      });
      return { id: created.id, score: createAction.score || 100 };
    }

    const updateAction = actions.find(a => a.type === 'update');
    if (updateAction) {
      await this.updateIntent(updateAction.id, userId, {
        payload: updateAction.payload
      });
      return { id: updateAction.id, score: updateAction.score || 100 };
    }

    // If only Expire or Ignore, we don't have a valid active intent for the stake
    return null;
  }

  /**
   * Main Orchestration: The "Opportunity Finder" Cycle.
   * 
   * ALGORITHM:
   * 1. Backfill Embeddings: Ensures all active profiles have vector embeddings.
   * 2. Iterate Sources: For every profile (as Source):
   *    - Backfill HyDE: If missing, generate "Ideal Candidate Description" vector.
   *    - Agent Discovery: Run OpportunityEvaluator.runDiscovery().
   * 3. Implicit Intent Creation:
   *    - If Match Score > 85, create implicit intents for both users.
   *    - Create a Stake connecting them.
   * 
   * @param evaluator - Optional OpportunityEvaluator (for testing).
   */
  async runOpportunityFinderCycle(evaluator?: OpportunityEvaluator) {
    // Setup evaluator with profile search injection
    if (!evaluator) {
      evaluator = new OpportunityEvaluator(this.embedder);
    }

    const intentManager = new IntentManager();

    console.time('OpportunityFinderCycle');
    logger.info('🔄 [OpportunityJob] Starting Opportunity Finder Cycle...');

    try {
      // 1. Backfill Missing Embeddings
      logger.info('🔍 [OpportunityJob] Checking for missing embeddings...');
      const profilesWithoutEmbeddings = await this.getProfilesMissingEmbeddings();

      logger.info(`[OpportunityJob] Found ${profilesWithoutEmbeddings.length} profiles needing embeddings.`);

      for (const profile of profilesWithoutEmbeddings) {
        try {
          const textToEmbed = this.constructProfileText(profile);
          if (!textToEmbed || textToEmbed.length < 10) {
            logger.warn(`[OpportunityJob] Skipping profile ${profile.userId} - Insufficient content.`);
            continue;
          }

          logger.info(`[OpportunityJob] Generating embedding for user ${profile.userId}...`);
          logger.debug(`[OpportunityJob] Payload length: ${textToEmbed.length} chars. Preview: "${textToEmbed.substring(0, 100)}..."`);
          const embedding = await this.embedder.generate(textToEmbed) as number[];

          await this.updateProfileEmbedding(profile.id, embedding);

          logger.info(`[OpportunityJob] ✅ Embedding updated for ${profile.userId}`);
        } catch (err) {
          logger.error(`[OpportunityJob] ❌ Failed to generate embedding for ${profile.userId}:`, { error: err });
        }
      }

      // 2. Run Opportunity Finder for All Users
      logger.info('🚀 [OpportunityJob] Running Opportunity Matchmaking...');
      const allCycleResults: any[] = [];

      // Fetch all valid profiles to act as sources
      const allProfiles = await this.getAllProfilesWithEmbeddings();

      for (const sourceProfile of allProfiles) {
        logger.info(`\n🔎 [OpportunityJob] Finding opportunities for ${sourceProfile.userId}...`);

        // Construct UserMemoryProfile object expected by Agent
        const memoryProfile: UserMemoryProfile = {
          userId: sourceProfile.userId,
          identity: sourceProfile.identity || {},
          narrative: sourceProfile.narrative || {},
          attributes: sourceProfile.attributes || {}
        } as any;

        if (!sourceProfile.embedding) {
          logger.warn(`[OpportunityJob] Skipping ${sourceProfile.userId} - Missing embedding.`);
          continue;
        }

        // --- BACKFILL HyDE IF MISSING ---
        if (!sourceProfile.hydeEmbedding) {
          logger.info(`   [OpportunityJob] Generating missing HyDE for ${sourceProfile.userId}...`);
          try {
            const hydeGenerator = new HydeGeneratorAgent(this.embedder);

            const profileContext = json2md.keyValue({
              bio: memoryProfile.identity.bio,
              location: memoryProfile.identity.location,
              interests: memoryProfile.attributes.interests,
              skills: memoryProfile.attributes.skills,
              context: memoryProfile.narrative?.context || ''
            });

            const result = await hydeGenerator.generate(profileContext);

            if (result && result.description) {
              const description = result.description;
              const embedding = (result.embedding || await this.embedder.generate(description)) as number[];

              // Update DB
              await this.updateProfileHyde(sourceProfile.id, description, embedding);

              // Update local object so we can use it immediately
              sourceProfile.hydeDescription = description;
              sourceProfile.hydeEmbedding = embedding;
              logger.info(`   [OpportunityJob] ✅ HyDE Generated & Backfilled.`);
            }
          } catch (e) {
            logger.error(`   [OpportunityJob] ❌ Failed to generate HyDE for ${sourceProfile.userId}`, { error: e });
          }
        }
        // --------------------------------

        const hydeDesc = sourceProfile.hydeDescription;
        if (!hydeDesc) {
          logger.warn(`[OpportunityJob] Skipping ${sourceProfile.userId} - Missing HyDE description (Backfill failed).`);
          continue;
        }

        // RUN AGENT DISCOVERY
        const profileContext = json2md.keyValue({
          bio: memoryProfile.identity.bio,
          location: memoryProfile.identity.location,
          interests: memoryProfile.attributes.interests,
          skills: memoryProfile.attributes.skills,
          context: memoryProfile.narrative?.context || ''
        });

        // --- DEDUPLICATION: Fetch Existing Stakes ---
        const existingStakes = await this.getUserStakes(sourceProfile.userId, 20);
        let existingOpportunitiesContext = "";

        if (existingStakes.length > 0) {
          existingOpportunitiesContext = existingStakes
            .map(s => `- Match with ${s.candidateName} (ID: ${s.candidateId}) (Score: ${s.score}): ${s.reason}`)
            .join('\n');
        }

        const opportunities = await evaluator.runDiscovery(profileContext, {
          hydeDescription: hydeDesc,
          limit: 20,
          minScore: 0.5,
          filter: {
            userId: { ne: sourceProfile.userId }
          } as any,
          existingOpportunities: existingOpportunitiesContext
        });

        if (opportunities.length > 0) {
          logger.info(`✨ [OpportunityJob] Found ${opportunities.length} opportunities for ${sourceProfile.userId}:`);
          opportunities.forEach(op => {
            logger.info(`   - [${op.score}] ${op.sourceDescription.substring(0, 50)}... (with ${op.candidateId})`);
          });

          allCycleResults.push({
            sourceUserId: sourceProfile.userId,
            sourceName: sourceProfile.identity?.name,
            opportunityCount: opportunities.length,
            opportunities: opportunities
          });

          // --- Implicit Intent & Stake Creation ---
          for (const op of opportunities) {
            if (op.score < 85) continue; // Only for very strong matches

            const candidateProfile = await this.getProfile(op.candidateId);
            if (!candidateProfile) continue;

            try {
              // 1. Process Source Intent
              logger.info(`   [OpportunityJob] Processing implicit source intent for ${sourceProfile.userId}...`);

              const sourceActiveIntents = await this.getUserIntentObjects(sourceProfile.userId);
              const sourceActiveContext = sourceActiveIntents
                .map(i => `ID: ${i.id}, Description: ${i.payload}, Status: active`)
                .join('\n');

              const sourceProfileContext = json2md.keyValue({
                bio: memoryProfile.identity.bio,
                location: memoryProfile.identity.location,
                interests: memoryProfile.attributes.interests,
                skills: memoryProfile.attributes.skills,
                context: memoryProfile.narrative?.context || ''
              });

              const sourceResponse = await intentManager.processImplicitIntent(
                sourceProfileContext,
                `Opportunity Match. Reason: ${op.sourceDescription}`,
                sourceActiveContext
              );

              const sourceIntentResult = await this.resolveIntentFromActions(sourceProfile.userId, sourceResponse.actions);

              if (!sourceIntentResult) {
                logger.info(`   [OpportunityJob] Source intent not created/resolved. Skipping stake.`);
                continue;
              }
              const sourceIntentId = sourceIntentResult.id;

              // 2. Process Candidate Intent
              logger.info(`   [OpportunityJob] Processing implicit candidate intent for ${candidateProfile.userId}...`);

              const candidateMemoryProfile: UserMemoryProfile = {
                userId: candidateProfile.userId,
                identity: candidateProfile.identity || {},
                narrative: candidateProfile.narrative || {},
                attributes: candidateProfile.attributes || {}
              } as any;

              const candidateActiveIntents = await this.getUserIntentObjects(candidateProfile.userId);
              const candidateActiveContext = candidateActiveIntents
                .map(i => `ID: ${i.id}, Description: ${i.payload}, Status: active`)
                .join('\n');

              const candidateProfileContext = json2md.keyValue({
                bio: candidateMemoryProfile.identity.bio,
                location: candidateMemoryProfile.identity.location,
                interests: candidateMemoryProfile.attributes.interests,
                skills: candidateMemoryProfile.attributes.skills,
                context: candidateMemoryProfile.narrative?.context || ''
              });

              const candidateResponse = await intentManager.processImplicitIntent(
                candidateProfileContext,
                `Opportunity Match. Reason: ${op.candidateDescription}`,
                candidateActiveContext
              );

              const candidateIntentResult = await this.resolveIntentFromActions(candidateProfile.userId, candidateResponse.actions);

              if (!candidateIntentResult) {
                logger.info(`   [OpportunityJob] Candidate intent not created/resolved. Skipping stake.`);
                continue;
              }
              const candidateIntentId = candidateIntentResult.id;

              if (sourceIntentId && candidateIntentId) {
                // 3. Create Pair Match Stake
                // PairStake = avg(OpportunityScore, SourceIntentScore, CandidateIntentScore)
                const opportunityScore = Math.floor(op.score);
                const sourceScore = sourceIntentResult.score;
                const candidateScore = candidateIntentResult.score;

                const finalStakeScore = Math.floor((opportunityScore + sourceScore + candidateScore) / 3);

                logger.info(`   [OpportunityJob] Creating pair stake. Op: ${opportunityScore}, Source: ${sourceScore}, Candidate: ${candidateScore} -> Final: ${finalStakeScore}`);

                await this.saveMatch(
                  sourceIntentId,
                  candidateIntentId,
                  finalStakeScore,
                  `Source: ${op.sourceDescription} | Candidate: ${op.candidateDescription}`, // Use opportunity reason
                  '028ef80e-9b1c-434b-9296-bb6130509482'
                );
              }

            } catch (err) {
              logger.error(`   [OpportunityJob] Failed to process implicit stake for ${sourceProfile.userId}`, { error: err });
            }
          }
          // ---------------------------------------------

        } else {
          logger.info(`   [OpportunityJob] No high-value opportunities found.`);
        }
      }

      // Write full debug results
      if (allCycleResults.length > 0) {
        const debugPath = path.resolve(process.cwd(), 'opportunity-finder-results.json');
        await fs.writeFile(debugPath, JSON.stringify(allCycleResults, null, 2));
        logger.info(`\n📝 [OpportunityJob] Debug results written to: ${debugPath}`);
      }

      logger.info('✅ [OpportunityJob] Opportunity Finder Cycle Complete.');
      console.timeEnd('OpportunityFinderCycle');

    } catch (error) {
      logger.error('❌ [OpportunityJob] Error in Opportunity Finder Cycle:', { error });
      console.timeEnd('OpportunityFinderCycle');
    }
  }

  /**
   * Run the Opportunity Finder for a SINGLE user.
   * 
   * This is the method to call after onboarding. It:
   * 1. Ensures the user's profile has embedding and HyDE
   * 2. Runs OpportunityEvaluator.runDiscovery() to find matching candidates
   * 3. Creates implicit intents for BOTH the source user AND the candidate
   * 4. Creates a STAKE linking the two intents together
   * 
   * This provides immediate matching after a user completes onboarding.
   * 
   * @param userId - The user ID to run the cycle for.
   */
  async runOpportunityFinderForUser(userId: string) {
    logger.info(`🔄 [OpportunityService] Running Opportunity Finder for user ${userId}...`);

    const evaluator = new OpportunityEvaluator(this.embedder);
    const intentManager = new IntentManager();

    try {
      // 1. Get the user's profile
      const sourceProfile = await this.getProfile(userId);
      if (!sourceProfile) {
        logger.warn(`[OpportunityService] Profile not found for user ${userId}, aborting.`);
        return;
      }

      // 2. Ensure profile has embedding
      if (!sourceProfile.embedding) {
        logger.info(`[OpportunityService] Generating embedding for user ${userId}...`);
        const textToEmbed = this.constructProfileText(sourceProfile);
        if (!textToEmbed || textToEmbed.length < 10) {
          logger.warn(`[OpportunityService] Insufficient content for embedding, skipping.`);
          return;
        }
        const embedding = await this.embedder.generate(textToEmbed) as number[];
        await this.updateProfileEmbedding(sourceProfile.id, embedding);
        sourceProfile.embedding = embedding;
      }

      // 3. Construct memory profile
      const memoryProfile: UserMemoryProfile = {
        userId: sourceProfile.userId,
        identity: sourceProfile.identity || {},
        narrative: sourceProfile.narrative || {},
        attributes: sourceProfile.attributes || {}
      } as any;

      const profileContext = json2md.keyValue({
        bio: memoryProfile.identity.bio || '',
        location: memoryProfile.identity.location || '',
        interests: memoryProfile.attributes.interests || [],
        skills: memoryProfile.attributes.skills || [],
        context: memoryProfile.narrative?.context || ''
      });

      // 4. Ensure HyDE exists
      if (!sourceProfile.hydeEmbedding || !sourceProfile.hydeDescription) {
        logger.info(`[OpportunityService] Generating HyDE for user ${userId}...`);
        try {
          const hydeGenerator = new HydeGeneratorAgent(this.embedder);
          const result = await hydeGenerator.generate(profileContext);

          if (result && result.description) {
            const embedding = (result.embedding || await this.embedder.generate(result.description)) as number[];
            await this.updateProfileHyde(sourceProfile.id, result.description, embedding);
            sourceProfile.hydeDescription = result.description;
            sourceProfile.hydeEmbedding = embedding;
            logger.info(`[OpportunityService] ✅ HyDE generated for ${userId}`);
          } else {
            logger.warn(`[OpportunityService] Failed to generate HyDE for ${userId}, skipping.`);
            return;
          }
        } catch (e) {
          logger.error(`[OpportunityService] Failed to generate HyDE for ${userId}`, { error: e });
          return;
        }
      }

      // 5. Fetch existing stakes to avoid duplicates
      const existingStakes = await this.getUserStakes(userId, 20);
      const existingOpportunitiesContext = existingStakes.length > 0
        ? existingStakes.map(s => `- Match with ${s.candidateName} (ID: ${s.candidateId}) (Score: ${s.score}): ${s.reason}`).join('\n')
        : '';

      // 6. Run opportunity discovery
      logger.info(`[OpportunityService] Running discovery for user ${userId}...`);
      const opportunities = await evaluator.runDiscovery(profileContext, {
        hydeDescription: sourceProfile.hydeDescription!,
        limit: 20,
        minScore: 70,
        filter: { userId: { ne: userId } } as any,
        existingOpportunities: existingOpportunitiesContext
      });

      logger.info(`[OpportunityService] Found ${opportunities.length} opportunities for ${userId}`);

      if (opportunities.length === 0) {
        logger.info(`[OpportunityService] No opportunities found for ${userId}.`);
        return;
      }

      // 7. Process opportunities - Create intents for BOTH users and stakes
      for (const op of opportunities) {
        if (op.score < 70) continue;

        const candidateProfile = await this.getProfile(op.candidateId);
        if (!candidateProfile) continue;

        try {
          // 7a. Process Source Intent
          logger.info(`[OpportunityService] Processing source intent for ${userId}...`);

          const sourceActiveIntents = await this.getUserIntentObjects(userId);
          const sourceActiveContext = sourceActiveIntents
            .map(i => `ID: ${i.id}, Description: ${i.payload}, Status: active`)
            .join('\n');

          const sourceResponse = await intentManager.processImplicitIntent(
            profileContext,
            `Opportunity Match. Reason: ${op.sourceDescription}`,
            sourceActiveContext
          );

          const sourceIntentId = await this.resolveIntentFromActions(userId, sourceResponse.actions);

          if (!sourceIntentId) {
            logger.info(`[OpportunityService] Source intent not created/resolved. Skipping.`);
            continue;
          }

          // 7b. Process Candidate Intent
          logger.info(`[OpportunityService] Processing candidate intent for ${candidateProfile.userId}...`);

          const candidateMemoryProfile: UserMemoryProfile = {
            userId: candidateProfile.userId,
            identity: candidateProfile.identity || {},
            narrative: candidateProfile.narrative || {},
            attributes: candidateProfile.attributes || {}
          } as any;

          const candidateProfileContext = json2md.keyValue({
            bio: candidateMemoryProfile.identity.bio || '',
            location: candidateMemoryProfile.identity.location || '',
            interests: candidateMemoryProfile.attributes.interests || [],
            skills: candidateMemoryProfile.attributes.skills || [],
            context: candidateMemoryProfile.narrative?.context || ''
          });

          const candidateActiveIntents = await this.getUserIntentObjects(candidateProfile.userId);
          const candidateActiveContext = candidateActiveIntents
            .map(i => `ID: ${i.id}, Description: ${i.payload}, Status: active`)
            .join('\n');

          const candidateResponse = await intentManager.processImplicitIntent(
            candidateProfileContext,
            `Opportunity Match. Reason: ${op.candidateDescription}`,
            candidateActiveContext
          );

          const candidateIntentResult = await this.resolveIntentFromActions(candidateProfile.userId, candidateResponse.actions);

          // 7c. Create Stake linking both intents
          if (sourceIntentId && candidateIntentResult) {
            const candidateIntentId = candidateIntentResult.id;

            // PairStake = avg(OpportunityScore, SourceIntentScore, CandidateIntentScore)
            const opportunityScore = Math.floor(op.score);
            const sourceScore = typeof sourceIntentId === 'string' ? opportunityScore : sourceIntentId.score; // Handle legacy string or object
            const candidateScore = candidateIntentResult.score;

            const rawSourceId = typeof sourceIntentId === 'string' ? sourceIntentId : sourceIntentId.id;

            const finalStakeScore = Math.floor((opportunityScore + sourceScore + candidateScore) / 3);

            logger.info(`[OpportunityService] ✅ Creating stake between ${userId} and ${candidateProfile.userId} (Op: ${opportunityScore}, S: ${sourceScore}, C: ${candidateScore} -> Final: ${finalStakeScore})`);

            await this.saveMatch(
              rawSourceId,
              candidateIntentId,
              finalStakeScore,
              `Source: ${op.sourceDescription} | Candidate: ${op.candidateDescription}`,
              '028ef80e-9b1c-434b-9296-bb6130509482' // OpportunityFinder Agent ID
            );
          }

        } catch (err) {
          logger.error(`[OpportunityService] Failed to process opportunity for ${userId}`, { error: err });
        }
      }

      logger.info(`✅ [OpportunityService] Opportunity Finder completed for user ${userId}.`);

    } catch (error) {
      logger.error(`❌ [OpportunityService] Error in Opportunity Finder for ${userId}:`, { error });
    }
  }

  // ============================================================================
  // PROFILE INTENT GENERATION (Used by ProfileQueue)
  // ============================================================================

  /**
   * Generate intent data from a user's profile using OpportunityEvaluator.
   * 
   * This method replaces the old IntentManager.processExplicitIntent approach.
   * Instead of inferring explicit intents from text, it:
   * 1. Runs OpportunityEvaluator.runDiscovery() to find matching candidates
   * 2. Converts high-scoring opportunities into implicit intent options
   * 
   * @param userId - The user's ID.
   * @param userProfile - The user's profile data.
   * @returns Array of CreateOpportunityIntentOptions ready for creation.
   */
  async generateIntentsFromProfile(
    userId: string,
    userProfile: typeof userProfiles.$inferSelect
  ): Promise<CreateOpportunityIntentOptions[]> {
    const newIntentOptions: CreateOpportunityIntentOptions[] = [];
    logger.info(`[OpportunityService] generateIntentsFromProfile called for ${userId}`);

    try {
      // Construct memory profile for the evaluator
      const memoryProfile: UserMemoryProfile = {
        userId: userId,
        identity: {
          name: userProfile.identity?.name || 'User',
          bio: userProfile.identity?.bio || '',
          location: userProfile.identity?.location || ''
        },
        narrative: userProfile.narrative || undefined,
        attributes: {
          interests: userProfile.attributes?.interests || [],
          skills: userProfile.attributes?.skills || [],
          goals: []
        }
      };

      const profileContext = json2md.keyValue({
        bio: memoryProfile.identity.bio,
        location: memoryProfile.identity.location,
        interests: memoryProfile.attributes.interests,
        skills: memoryProfile.attributes.skills,
        context: memoryProfile.narrative?.context || ''
      });

      // Check if profile has HyDE - required for discovery
      if (!userProfile.hydeDescription) {
        logger.warn(`[OpportunityService] Profile ${userId} missing HyDE description, generating...`);

        try {
          const hydeGenerator = new HydeGeneratorAgent(this.embedder);
          const result = await hydeGenerator.generate(profileContext);

          if (result && result.description) {
            const embedding = (result.embedding || await this.embedder.generate(result.description)) as number[];
            await this.updateProfileHyde(userProfile.id, result.description, embedding);
            userProfile.hydeDescription = result.description;
            userProfile.hydeEmbedding = embedding;
            logger.info(`[OpportunityService] ✅ HyDE generated for ${userId}`);
          } else {
            logger.warn(`[OpportunityService] Failed to generate HyDE for ${userId}, skipping opportunity discovery`);
            return [];
          }
        } catch (e) {
          logger.error(`[OpportunityService] Failed to generate HyDE for ${userId}`, { error: e });
          return [];
        }
      }

      // Fetch existing stakes to avoid duplicates
      const existingStakes = await this.getUserStakes(userId, 20);
      const existingOpportunitiesContext = existingStakes.length > 0
        ? existingStakes
          .map(s => `- Match with ${s.candidateName} (ID: ${s.candidateId}) (Score: ${s.score}): ${s.reason}`)
          .join('\n')
        : '';

      // Run opportunity discovery
      const evaluator = new OpportunityEvaluator(this.embedder);
      const opportunities = await evaluator.runDiscovery(profileContext, {
        hydeDescription: userProfile.hydeDescription!,
        limit: 10,
        minScore: 70, // Only consider good matches
        filter: {
          userId: { ne: userId }
        } as any,
        existingOpportunities: existingOpportunitiesContext
      });

      logger.info(`[OpportunityService] Found ${opportunities.length} opportunities for ${userId}`);

      // Convert opportunities to intent options
      for (const op of opportunities) {
        if (op.score >= 70) {
          logger.info(`[OpportunityService] Creating intent option from opportunity: "${op.sourceDescription.substring(0, 30)}..." (score: ${op.score})`);

          newIntentOptions.push({
            userId,
            payload: `Opportunity: ${op.sourceDescription}`,
            confidence: op.score / 100,
            inferenceType: 'implicit',
            sourceType: 'enrichment',
            sourceId: userProfile.id
          });
        }
      }

    } catch (error) {
      logger.error('[OpportunityService] Failed to generate intents from profile:', { error });
    }

    return newIntentOptions;
  }

  // ============================================================================
  // PROMPT-DRIVEN OPPORTUNITY DISCOVERY (Generic - used by admin and members)
  // ============================================================================

  /**
   * Discover opportunities for specified members using a natural language prompt.
   * 
   * This is the generic method that can be used by:
   * - Admin routes (for any members in their index)
   * - Member routes (for themselves only)
   * 
   * @param options - Discovery options including prompt and member IDs
   * @returns Array of discovered opportunities
   */
  async discoverOpportunitiesWithPrompt(
    options: DiscoverOpportunitiesOptions
  ): Promise<DiscoveredOpportunity[]> {
    const { prompt, memberIds, limit = 10 } = options;
    
    logger.info(`[OpportunityService] discoverOpportunitiesWithPrompt called with prompt: "${prompt}" for ${memberIds.length} members`);
    
    const allOpportunities: DiscoveredOpportunity[] = [];
    const evaluator = new OpportunityEvaluator(this.embedder);
    const hydeGenerator = new HydeGeneratorAgent(this.embedder);

    for (const memberId of memberIds) {
      try {
        // 1. Get member profile
        const memberProfile = await this.getProfile(memberId);
        if (!memberProfile) {
          logger.warn(`[OpportunityService] Profile not found for member ${memberId}, skipping.`);
          continue;
        }

        // 2. Ensure profile has embedding
        if (!memberProfile.embedding) {
          logger.info(`[OpportunityService] Generating embedding for member ${memberId}...`);
          const textToEmbed = this.constructProfileText(memberProfile);
          if (!textToEmbed || textToEmbed.length < 10) {
            logger.warn(`[OpportunityService] Insufficient content for embedding, skipping ${memberId}.`);
            continue;
          }
          const embedding = await this.embedder.generate(textToEmbed) as number[];
          await this.updateProfileEmbedding(memberProfile.id, embedding);
          memberProfile.embedding = embedding;
        }

        // 3. Construct profile context
        const memoryProfile: UserMemoryProfile = {
          userId: memberProfile.userId,
          identity: memberProfile.identity || {},
          narrative: memberProfile.narrative || {},
          attributes: memberProfile.attributes || {}
        } as any;

        const profileContext = json2md.keyValue({
          bio: memoryProfile.identity.bio || '',
          location: memoryProfile.identity.location || '',
          interests: memoryProfile.attributes.interests || [],
          skills: memoryProfile.attributes.skills || [],
          context: memoryProfile.narrative?.context || ''
        });

        // 4. Generate HyDE with instruction from prompt
        logger.info(`[OpportunityService] Generating HyDE for ${memberId} with instruction: "${prompt}"...`);
        const hydeResult = await hydeGenerator.generate(profileContext, { instruction: prompt });

        if (!hydeResult || !hydeResult.description) {
          logger.warn(`[OpportunityService] Failed to generate HyDE for ${memberId}, skipping.`);
          continue;
        }

        const hydeDescription = hydeResult.description;
        const hydeEmbedding = hydeResult.embedding || await this.embedder.generate(hydeDescription) as number[];

        // 5. Fetch existing stakes to avoid duplicates
        const existingStakes = await this.getUserStakes(memberId, 20);
        const existingOpportunitiesContext = existingStakes.length > 0
          ? existingStakes.map(s => `- Match with ${s.candidateName} (ID: ${s.candidateId}) (Score: ${s.score}): ${s.reason}`).join('\n')
          : '';

        // 6. Run opportunity discovery
        logger.info(`[OpportunityService] Running discovery for ${memberId}...`);
        const opportunities = await evaluator.runDiscovery(profileContext, {
          hydeDescription,
          limit,
          minScore: 70,
          filter: { userId: { ne: memberId } } as any,
          existingOpportunities: existingOpportunitiesContext
        });

        logger.info(`[OpportunityService] Found ${opportunities.length} opportunities for ${memberId}`);

        // 7. Convert to DiscoveredOpportunity format with user details
        for (const op of opportunities) {
          const targetProfile = await this.getProfile(op.candidateId);
          if (!targetProfile) continue;

          allOpportunities.push({
            sourceUser: {
              id: memberId,
              name: memberProfile.identity?.name || 'Unknown',
              avatar: null
            },
            targetUser: {
              id: op.candidateId,
              name: targetProfile.identity?.name || 'Unknown',
              avatar: null
            },
            opportunity: {
              type: 'collaboration',
              title: `Match with ${targetProfile.identity?.name || 'Unknown'}`,
              description: op.sourceDescription,
              score: op.score
            }
          });
        }

      } catch (err) {
        logger.error(`[OpportunityService] Error discovering opportunities for ${memberId}:`, { error: err });
      }
    }

    // Sort by score descending
    return allOpportunities.sort((a, b) => b.opportunity.score - a.opportunity.score);
  }
}

// ============================================================================
// PROMPT-DRIVEN DISCOVERY TYPES
// ============================================================================

/**
 * Options for prompt-driven opportunity discovery.
 */
export interface DiscoverOpportunitiesOptions {
  /** Natural language prompt describing what to find (e.g., "investors", "collaborators") */
  prompt: string;
  /** User IDs to find opportunities FOR */
  memberIds: string[];
  /** Optional: Scope to specific index */
  indexId?: string;
  /** Maximum opportunities per member */
  limit?: number;
}

/**
 * A discovered opportunity between two users.
 */
export interface DiscoveredOpportunity {
  sourceUser: { id: string; name: string; avatar: string | null };
  targetUser: { id: string; name: string; avatar: string | null };
  opportunity: {
    type: 'collaboration' | 'mentorship' | 'networking' | 'other';
    title: string;
    description: string;
    score: number;
  };
}

export const opportunityService = new OpportunityService();
