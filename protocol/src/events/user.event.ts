import { intentQueue } from '../queues/intent.queue';
import { intentService } from '../services/intent.service';

export interface MemberEvent {
  userId: string;
  indexId: string;
  promptChanged?: boolean;
  autoAssignChanged?: boolean;
}

/**
 * Member-related events  
 */
export class MemberEvents {
  /**
   * Triggered when member settings are updated
   */
  static async onSettingsUpdated(event: MemberEvent): Promise<void> {
    try {
      if (event.promptChanged || event.autoAssignChanged) {
        // Get all user's intents (full objects) and queue them individually
        const userIntents = await intentService.getUserIntentObjects(event.userId);

        // Priority 6: Member settings updates - MEDIUM priority
        const queuePromises = userIntents.map((intent) =>
          intentQueue.add('index_intent', {
            intentId: intent.id,
            indexId: event.indexId,
            userId: event.userId,
          }, { priority: 6 })
        );

        await Promise.all(queuePromises);
      }
    } catch (error) {
      // Failed to queue member intents
    }
  }
}
