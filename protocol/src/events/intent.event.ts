import { intentQueue, addJob as addIntentJob, queueEvents } from '../queues/intent.queue';
import { stakeService } from '../services/stake.service';
import { indexService } from '../services/index.service';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { onIntentCreated, onIntentUpdated } from '../jobs/opportunity.job';

export interface IntentEvent {
  intentId: string;
  userId: string;
  payload?: string;
  previousStatus?: string;
}

/**
 * Intent-related events
 */
export class IntentEvents {
  /**
   * Triggered when a new intent is created
   */
  static async onCreated(event: IntentEvent): Promise<void> {

    const intentEventsDisabled = process.env.DISABLE_INTENT_EVENTS === 'disabled';
    if (intentEventsDisabled) {
      console.log('IntentEvents.onCreated disabled');
      return;
    }

    try {
      // Get all eligible indexes for this user
      const eligibleIndexes = await indexService.getEligibleIndexesForUser(event.userId);

      // Queue individual intent-index pairs
      // Priority 8: New intents - HIGHEST priority (user just created intent)
      // These are time-sensitive user actions that should be processed immediately
      const indexingJobs = await Promise.all(
        eligibleIndexes.map(({ id: indexId }) =>
          intentQueue.add('index_intent', {
            intentId: event.intentId,
            indexId,
            userId: event.userId, // Include userId for per-user queuing
          }, { priority: 8 })
        )
      );

      // Wait for all indexing jobs to complete before triggering brokers
      // Timeout: 60 seconds to avoid blocking indefinitely
      const WAIT_TIMEOUT_MS = 60000;
      try {
        await Promise.all(
          indexingJobs.map(job =>
            job.waitUntilFinished(queueEvents, WAIT_TIMEOUT_MS).catch(error => {
              // Log but don't fail - brokers should handle missing data gracefully
              console.error(`Indexing job ${job.id} failed or timed out:`, error);
              return null;
            })
          )
        );
      } catch (error) {
        // Log but continue - trigger brokers even if some jobs failed
        console.error('Error waiting for indexing jobs to complete:', error);
      }

      // Trigger Stake Service via processIntent
      // Replaces legacy triggerBrokersOnIntentCreated
      await stakeService.processIntent(event.intentId);

      // Pre-generate HyDE for new intent (persisted strategies)
      await addIntentJob('generate_hyde', { intentId: event.intentId }, 6);
      // Trigger opportunity graph cycle (legacy) and intent-scoped opportunity graph (new)
      await onIntentCreated(event.intentId, { userId: event.userId });
    } catch (error) {
      // Failed to queue intent indexing
      console.error('Failed to queue intent indexing:', error);
    }
  }

  /**
   * Triggered when an intent is updated.
   * Re-evaluate only against indexes the intent is already in (no new index assignments).
   */
  static async onUpdated(event: IntentEvent): Promise<void> {
    try {
      // Only re-evaluate against indexes this intent is already assigned to (can unassign if no longer qualifies; never add to new indexes)
      const existingIndexIds = await indexService.getIndexIdsForIntent(event.intentId);

      if (existingIndexIds.length === 0) {
        await stakeService.processIntent(event.intentId);
        await addIntentJob('refresh_hyde', { intentId: event.intentId }, 6);
        await onIntentUpdated(event.intentId, { userId: event.userId });
        return;
      }

      // Queue index_intent only for existing indexes
      const indexingJobs = await Promise.all(
        existingIndexIds.map((indexId) =>
          intentQueue.add('index_intent', {
            intentId: event.intentId,
            indexId,
            userId: event.userId,
          }, { priority: 8 })
        )
      );

      // Wait for all indexing jobs to complete before triggering brokers
      // Timeout: 60 seconds to avoid blocking indefinitely
      const WAIT_TIMEOUT_MS = 60000;
      try {
        await Promise.all(
          indexingJobs.map(job =>
            job.waitUntilFinished(queueEvents, WAIT_TIMEOUT_MS).catch(error => {
              // Log but don't fail - brokers should handle missing data gracefully
              console.error(`Indexing job ${job.id} failed or timed out:`, error);
              return null;
            })
          )
        );
      } catch (error) {
        // Log but continue - trigger brokers even if some jobs failed
        console.error('Error waiting for indexing jobs to complete:', error);
      }

      // Trigger Stake Service via processIntent (Re-evaluation)
      await stakeService.processIntent(event.intentId);

      // Refresh HyDE for updated intent
      await addIntentJob('refresh_hyde', { intentId: event.intentId }, 6);
      await onIntentUpdated(event.intentId, { userId: event.userId });
    } catch (error) {
      // Failed to queue intent indexing
      console.error('Failed to queue intent indexing:', error);
    }
  }

  /**
   * Triggered when an intent is archived.
   * Expires related opportunities and deletes HyDE documents for this intent.
   * @param event - Intent event with intentId and userId.
   * @param opts - Optional; pass a mock database for testing.
   */
  static async onArchived(
    event: IntentEvent,
    opts?: {
      database?: Pick<
        ChatDatabaseAdapter,
        'expireOpportunitiesByIntent' | 'deleteHydeDocumentsForSource'
      >;
    }
  ): Promise<void> {
    try {
      const db = opts?.database ?? new ChatDatabaseAdapter();
      await db.expireOpportunitiesByIntent(event.intentId);
      await db.deleteHydeDocumentsForSource('intent', event.intentId);
    } catch (error) {
      console.error('IntentEvents.onArchived failed:', error);
    }
  }
}
