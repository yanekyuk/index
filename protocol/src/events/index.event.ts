import { intentQueue } from '../queues/intent.queue';
import { indexService } from '../services/index.service';

export interface IndexEvent {
  indexId: string;
  userId?: string;
  promptChanged?: boolean;
}

/**
 * Index-related events
 */
export class IndexEvents {
  /**
   * Triggered when index prompt is updated
   */
  static async onPromptUpdated(event: IndexEvent): Promise<void> {
    try {
      // Get all intents from members of this index and queue them individually
      const memberIntents = await indexService.getIntentsForIndexMembers(event.indexId);

      // Priority 4: Index prompt updates - LOWEST priority (background maintenance)
      // When an index prompt changes, re-indexing can happen in background
      // Less urgent than direct user actions (creating/updating intents)
      const queuePromises = memberIntents.map(({ intentId, userId }) =>
        intentQueue.add('index_intent', {
          intentId,
          indexId: event.indexId,
          userId, // Include userId for per-user queuing
        }, { priority: 4 }) // Highest priority
      );

      await Promise.all(queuePromises);
    } catch (error) {
      // Failed to queue index intents
    }
  }
}
