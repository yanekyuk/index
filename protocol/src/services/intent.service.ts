import db from '../lib/db';
import { intents, intentIndexes, intentStakes, intentStakeItems, indexes, indexMembers } from '../lib/schema';
import { summarizeIntent } from '../agents/core/intent_summarizer';
import { IndexEmbedder } from '../lib/embedder';

const embedder = new IndexEmbedder(db);
import { Events } from '../events';
import { eq, and, isNull } from 'drizzle-orm';
import { INTENT_INFERRER_AGENT_ID } from '../lib/agent-ids';
import { evaluateIntentAppropriateness } from '../agents/core/intent_indexer/evaluator';
import { log } from '../lib/log';

export interface CreateIntentOptions {
  payload: string;
  userId: string;
  isIncognito?: boolean;
  indexIds?: string[];
  sourceId?: string;
  sourceType?: 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment';
  confidence: number; // 0-1, required
  inferenceType: 'explicit' | 'implicit'; // required
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreatedIntent {
  id: string;
  payload: string;
  summary: string | null;
  isIncognito: boolean;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}

/**
 * IntentService
 * 
 * CORE SERVICE: Coordinates the creation, processing, and management of User Intents.
 * 
 * MAIN RESPONSIBILITIES:
 * 1. Intent Creation: Handles raw input -> Database Record (including Summarization & Embedding).
 * 2. Index Association: Assigns intents to "Indexes" (Communities) based on relevance rules.
 * 3. Event Triggering: Fires `onIntentCreated` to notify downstream agents (brokers).
 * 
 * CRITICAL FLOWS:
 * - `createIntent`: The main entry point for all new intents (Explicit or Implicit).
 * - `processIntentForIndex`: The evaluation logic (run by Queues) to decide if an intent belongs in a community.
 */
export class IntentService {
  /**
   * Get existing intents for a user as a Set of payloads
   */
  static async getUserIntents(userId: string): Promise<Set<string>> {
    const existingIntents = await db.select({
      payload: intents.payload,
      summary: intents.summary
    }).from(intents)
      .where(eq(intents.userId, userId));

    return new Set(existingIntents.map(intent => intent.summary || intent.payload));
  }

  /**
   * Get all active intents for a user (full objects)
   */
  static async getUserIntentObjects(userId: string) {
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
   * Universal Intent Creation Method.
   * 
   * ORCHESTRATION PIPELINE:
   * 1. Summarize: Generates a short summary of the payload using `IntentSummarizer`.
   * 2. Embed: Generates vector embeddings for semantic search.
   * 3. Persist: Saves to `intents` table.
   * 4. Index: Associations intent with specified Index IDs (if any).
   * 5. Stake: Creates an initial "Inference Stake" (confidence score) to track provenance.
   * 6. Event: Emits `Intent.onCreated` to trigger side effects (Context Brokers).
   * 
   * @param options - Configuration object (payload, userId, confidence, etc.).
   * @returns Promise resolving to the created `CreatedIntent` object.
   * @throws Error if DB insertion fails.
   */
  static async createIntent(options: CreateIntentOptions): Promise<CreatedIntent> {
    try {
      console.log(`[IntentService.createIntent] Starting with:`, {
        payload: options.payload.substring(0, 50) + '...',
        userId: options.userId,
        indexIds: options.indexIds,
        confidence: options.confidence,
        inferenceType: options.inferenceType
      });

      const {
        payload,
        userId,
        isIncognito = false,
        indexIds = [],
        sourceId,
        sourceType,
        confidence,
        inferenceType,
        createdAt,
        updatedAt
      } = options;

      console.log(`[IntentService.createIntent] Parameters destructured`);

      // Ensure createdAt and updatedAt are Date objects if provided
      const createdAtDate = createdAt ? (createdAt instanceof Date ? createdAt : new Date(createdAt)) : undefined;
      const updatedAtDate = updatedAt ? (updatedAt instanceof Date ? updatedAt : new Date(updatedAt)) : undefined;

      if (createdAtDate) {
        console.log(`[IntentService.createIntent] Creating intent with datetime: ${createdAtDate.toISOString()}`);
      }

      // Generate summary
      console.log(`[IntentService.createIntent] About to generate summary...`);
      const summary = await summarizeIntent(payload);
      console.log(`[IntentService.createIntent] Summary generated:`, summary);

      // Generate embedding for semantic search
      console.log(`[IntentService.createIntent] Generating embedding...`);
      let embedding: number[] | null = null;
      try {
        embedding = await embedder.generate(payload) as number[];
        console.log(`[IntentService.createIntent] Embedding generated: ${embedding ? `${embedding.length} dimensions` : 'null'}`);
      } catch (error) {
        console.error('[IntentService.createIntent] Failed to generate embedding:', error);
        // Continue without embedding - it's optional
      }

      console.log(`[IntentService.createIntent] Inserting intent into database...`);

      // Create the intent
      let newIntent;
      try {
        newIntent = await db.insert(intents).values({
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
      } catch (error) {
        console.error('[IntentService.createIntent] Failed to insert intent into DB:', error);
        throw error;
      }

      console.log(`[IntentService.createIntent] ✅ Intent inserted:`, newIntent);

      if (!newIntent || newIntent.length === 0) {
        throw new Error('Failed to create intent - no intent returned from insert');
      }

      const createdIntent = newIntent[0];
      console.log(`[IntentService.createIntent] ✅ Created intent with ID: ${createdIntent.id}`);

      // Associate with indexes if provided
      if (indexIds.length > 0) {
        console.log(`[IntentService.createIntent] Associating intent ${createdIntent.id} with ${indexIds.length} indexes:`, indexIds);
        try {
          await db.insert(intentIndexes).values(
            indexIds.map((indexId: string) => ({
              intentId: createdIntent.id,
              indexId: indexId
            }))
          );
          console.log(`[IntentService.createIntent] ✅ Successfully associated with indexes`);
        } catch (error) {
          console.error(`[IntentService.createIntent] ❌ Failed to associate intent ${createdIntent.id} with indexes:`, error);
          throw error;
        }
      } else {
        // Dynamic scoping: Intents are associated with users, and users are associated with indexes.
        log.info(`[IntentService.createIntent] Intent ${createdIntent.id} created without explicit index links (using dynamic User scope).`);
      }

      // Create inference stake (always required)
      try {
        const [newStake] = await db.insert(intentStakes).values({
          intents: [createdIntent.id],
          stake: BigInt(Math.floor(confidence * 100)),
          reasoning: `Inferred as ${inferenceType} intent`,
          agentId: INTENT_INFERRER_AGENT_ID
        }).returning({ id: intentStakes.id });

        // Insert into join table with denormalized user_id
        await db.insert(intentStakeItems).values({
          stakeId: newStake.id,
          intentId: createdIntent.id,
          userId: createdIntent.userId
        });
        console.log(`[IntentService.createIntent] ✅ Created inference stake for intent ${createdIntent.id}: ${inferenceType} (${confidence})`);
      } catch (error) {
        console.error(`[IntentService.createIntent] Failed to create inference stake for intent ${createdIntent.id}:`, error);
        // Continue without inference stake - it's optional
      }

      // Trigger centralized intent created event
      Events.Intent.onCreated({
        intentId: createdIntent.id,
        userId: createdIntent.userId,
        payload: createdIntent.payload
      });

      console.log(`[IntentService.createIntent] ✅ Successfully completed for intent ${createdIntent.id}`);
      return createdIntent;
    } catch (error) {
      console.error(`[IntentService.createIntent] ❌ FATAL ERROR:`, error);
      console.error(`[IntentService.createIntent] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
      throw error;
    }
  }

  /**
   * Index Assignment Logic (Queue Consumer).
   * 
   * Evaluates if a specific intent is "Appropriate" (Relevant & Safe) for a specific Index.
   * 
   * ALGORITHM:
   * 1. Fetches Intent and Index/Member Prompts.
   * 2. Calls `evaluateIntentAppropriateness` (LLM Agent).
   * 3. If Score > 0.7: Adds to Index.
   * 4. If Score <= 0.7 but currently assigned: Removes from Index.
   * 
   * @param intentId - The intent to evaluate.
   * @param indexId - The target community.
   */
  static async processIntentForIndex(intentId: string, indexId: string): Promise<void> {
    try {
      // Get intent details
      const intentData = await db.select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId
      }).from(intents)
        .where(eq(intents.id, intentId))
        .limit(1);

      if (intentData.length === 0) return;
      const intent = intentData[0];

      // Get index details (including prompts)
      const indexData = await db.select({
        id: indexes.id,
        indexPrompt: indexes.prompt,
        memberPrompt: indexMembers.prompt
      })
        .from(indexes)
        .innerJoin(indexMembers, eq(indexes.id, indexMembers.indexId))
        .where(and(
          eq(indexes.id, indexId),
          eq(indexMembers.userId, intent.userId),
          eq(indexMembers.autoAssign, true), // Only auto-assignable
          isNull(indexes.deletedAt)
        ))
        .limit(1);

      if (indexData.length === 0) return;
      const targetIndex = indexData[0];

      // Check if already assigned
      const existingAssignment = await db.select({ indexId: intentIndexes.indexId })
        .from(intentIndexes)
        .where(and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, indexId)
        ))
        .limit(1);

      const isCurrentlyAssigned = existingAssignment.length > 0;

      // Evaluate appropriateness
      const appropriatenessScore = await evaluateIntentAppropriateness(
        intent.payload,
        targetIndex.indexPrompt || '',
        targetIndex.memberPrompt || '',
        intent.sourceType,
        intent.sourceId
      );

      const isAppropriate = appropriatenessScore > 0.7;

      if (isAppropriate && !isCurrentlyAssigned) {
        // Index it
        await db.insert(intentIndexes).values({
          intentId,
          indexId
        });
        console.log(`[IntentService] Indexed intent ${intentId} to index ${indexId} (Score: ${appropriatenessScore})`);
      } else if (!isAppropriate && isCurrentlyAssigned) {
        // De-index it
        await db.delete(intentIndexes)
          .where(and(
            eq(intentIndexes.intentId, intentId),
            eq(intentIndexes.indexId, indexId)
          ));
        console.log(`[IntentService] Removed intent ${intentId} from index ${indexId} (Score: ${appropriatenessScore})`);
      }

    } catch (error) {
      console.error(`[IntentService] Error processing intent ${intentId} for index ${indexId}:`, error);
      throw error;
    }
  }
}
