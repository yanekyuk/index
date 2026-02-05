/**
 * Priority for opportunity notifications.
 * - immediate: WebSocket broadcast (real-time)
 * - high: Email via Resend
 * - low: Aggregate for weekly digest (no immediate email)
 */
export type NotificationPriority = 'immediate' | 'high' | 'low';

/**
 * Job payload for opportunity notification.
 */
export interface NotificationJobData {
  opportunityId: string;
  recipientId: string;
  priority: NotificationPriority;
}
