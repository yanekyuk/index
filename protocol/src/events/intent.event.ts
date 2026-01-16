import { intentQueue, queueEvents } from '../queues/intent.queue';
import { stakeService } from '../services/stake.service';
import { indexService } from '../services/index.service';

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

    } catch (error) {
      // Failed to queue intent indexing
      console.error('Failed to queue intent indexing:', error);
    }
  }

  /**
   * Triggered when an intent is updated
   */
  static async onUpdated(event: IntentEvent): Promise<void> {
    try {
      // Get all eligible indexes for this user
      const eligibleIndexes = await indexService.getEligibleIndexesForUser(event.userId);

      // If no eligible indexes, trigger brokers immediately (via StakeService)
      if (eligibleIndexes.length === 0) {
        await stakeService.processIntent(event.intentId);
        return;
      }

      // Queue individual intent-index pairs
      // Priority 8: Updated intents - HIGHEST priority (user just modified intent)
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

      // Trigger Stake Service via processIntent (Re-evaluation)
      await stakeService.processIntent(event.intentId);

    } catch (error) {
      // Failed to queue intent indexing
      console.error('Failed to queue intent indexing:', error);
    }
  }

  /**
   * Triggered when an intent is archived
   */
  static async onArchived(event: IntentEvent): Promise<void> {
    try {
      // Placeholder for archive logic
      // await triggerBrokersOnIntentArchived(event.intentId);
    } catch (error) {
      // Failed to process archived intent
    }
  }
}
