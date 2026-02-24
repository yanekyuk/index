import { log } from '../lib/log';
import type { IntentGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import { IntentGraphFactory } from '../lib/protocol/graphs/intent.graph';
import { IntentDatabaseAdapter, intentDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { intentQueue } from '../queues/intent.queue';

const logger = log.service.from("IntentService");

/**
 * IntentService
 * 
 * Manages intent processing through the Intent Graph and CRUD operations.
 * Uses IntentDatabaseAdapter for database operations.
 * Uses IntentGraphFactory for graph-based intent processing.
 * 
 * RESPONSIBILITIES:
 * - Process intents through Intent Graph
 * - Extract, verify, reconcile, and execute intent actions
 * - Intent CRUD operations (list, get, archive)
 */
export class IntentService {
  private db: IntentGraphDatabase;
  private factory: IntentGraphFactory;
  private adapter: IntentDatabaseAdapter;
  private embedder: EmbedderAdapter;

  constructor() {
    this.adapter = intentDatabaseAdapter;
    this.db = this.adapter;
    this.embedder = new EmbedderAdapter();
    this.factory = new IntentGraphFactory(this.db, this.embedder, intentQueue);
  }

  /**
   * Process user input through the Intent Graph.
   * Extracts, verifies, reconciles, and executes intent actions.
   * 
   * @param userId - The user ID
   * @param userProfile - The user profile as JSON string
   * @param content - Optional input content to process
   * @returns Graph execution result
   */
  async processIntent(
    userId: string,
    userProfile: string,
    content?: string
  ): Promise<Record<string, unknown>> {
    logger.info('[IntentService] Processing intent', { userId });

    const graph = this.factory.createGraph();
    const result = await graph.invoke(
      {
        userId,
        userProfile,
        inputContent: content,
      },
      { recursionLimit: 100 }
    );

    return result;
  }

  /**
   * List intents for a user with pagination and filters.
   * 
   * @param userId - The user ID
   * @param options - Pagination and filter options
   * @returns Intents and pagination metadata
   */
  async listIntents(userId: string, options: {
    page?: number;
    limit?: number;
    archived?: boolean;
    sourceType?: string;
  } = {}) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const archived = options.archived ?? false;

    logger.info('[IntentService] Listing intents', { userId, page, limit, archived });

    const { rows, total } = await this.adapter.listIntents(userId, {
      page,
      limit,
      archived,
      sourceType: options.sourceType,
    });

    return {
      intents: rows,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        count: rows.length,
        totalCount: total,
      },
    };
  }

  /**
   * Get a single intent by ID.
   * 
   * @param intentId - The intent ID
   * @param userId - The user ID (for ownership verification)
   * @returns Intent record or null if not found or unauthorized
   */
  async getById(intentId: string, userId: string) {
    logger.info('[IntentService] Getting intent by ID', { intentId, userId });
    
    return this.adapter.getIntentById(intentId, userId);
  }

  /**
   * Create an intent directly from a confirmed chat proposal.
   * Bypasses the full intent graph (no LLM re-inference/verification).
   * Idempotent: if an intent already exists for this proposalId + userId, returns it.
   * Generates embedding, inserts into DB, optionally associates with index, and enqueues HyDE job.
   * Embedder and queue failures are logged but do not abort creation.
   *
   * @param userId - The user ID
   * @param description - The pre-verified intent description
   * @param proposalId - The proposal ID (stored as sourceId for status tracking)
   * @param indexId - Optional index to associate the intent with
   * @returns The created or existing intent record (at least { id }).
   */
  async createFromProposal(userId: string, description: string, proposalId: string, indexId?: string) {
    logger.info('[IntentService] Creating intent from proposal', { userId, proposalId });

    const existing = await this.adapter.getIntentBySourceId(proposalId, userId);
    if (existing) {
      return existing;
    }

    const EMBEDDING_DIMS = 2000;
    let embedding: number[];
    try {
      embedding = (await this.embedder.generate(description)) as number[];
    } catch (err) {
      logger.warn('[IntentService] Embedding generation failed (intent will be created with zero vector)', {
        userId,
        proposalId,
        error: err,
      });
      embedding = new Array(EMBEDDING_DIMS).fill(0);
    }

    const created = await this.adapter.createIntent({
      userId,
      payload: description,
      embedding,
      sourceType: 'discovery_form',
      sourceId: proposalId,
    });

    if (indexId) {
      try {
        await this.adapter.assignIntentToIndex(created.id, indexId);
      } catch (err) {
        logger.warn('[IntentService] Failed to associate intent with index', {
          intentId: created.id,
          indexId,
          error: err,
        });
      }
    }

    try {
      await intentQueue.addGenerateHydeJob({ intentId: created.id, userId });
    } catch (err) {
      logger.warn('[IntentService] Failed to enqueue HyDE job', { intentId: created.id, userId, error: err });
    }

    return created;
  }

  /**
   * Check which proposal IDs have been confirmed (have a matching intent).
   *
   * @param userId - The user ID
   * @param proposalIds - Array of proposal IDs to check
   * @returns Map of proposalId -> "created"
   */
  async getProposalStatuses(userId: string, proposalIds: string[]): Promise<Record<string, 'created'>> {
    if (proposalIds.length === 0) return {};

    const result: Record<string, 'created'> = {};
    // Query intents where sourceId matches any proposalId and user owns them
    for (const pid of proposalIds) {
      const intent = await this.adapter.getIntentBySourceId(pid, userId);
      if (intent) {
        result[pid] = 'created';
      }
    }
    return result;
  }

  /**
   * Archive an intent.
   *
   * @param intentId - The intent ID
   * @param userId - The user ID (for ownership verification)
   * @returns Result with success flag and optional error
   */
  async archive(intentId: string, userId: string) {
    logger.info('[IntentService] Archiving intent', { intentId, userId });

    // Verify ownership
    const owned = await this.adapter.isOwnedByUser(intentId, userId);
    if (!owned) {
      return { success: false, error: 'Intent not found or unauthorized' };
    }

    return this.adapter.archiveIntent(intentId);
  }
}

export const intentService = new IntentService();
