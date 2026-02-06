import { log } from '../lib/log';
import type { IntentGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import { IntentGraphFactory } from '../lib/protocol/graphs/intent/intent.graph';
import { IntentDatabaseAdapter } from '../adapters/database.adapter';

const logger = log.service.from("IntentService");

/**
 * IntentService
 * 
 * Manages intent processing through the Intent Graph.
 * Uses IntentDatabaseAdapter for database operations.
 * Uses IntentGraphFactory for graph-based intent processing.
 * 
 * RESPONSIBILITIES:
 * - Process intents through Intent Graph
 * - Extract, verify, reconcile, and execute intent actions
 */
export class IntentService {
  private db: IntentGraphDatabase;
  private factory: IntentGraphFactory;

  constructor() {
    this.db = new IntentDatabaseAdapter();
    this.factory = new IntentGraphFactory(this.db);
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
}

export const intentService = new IntentService();
