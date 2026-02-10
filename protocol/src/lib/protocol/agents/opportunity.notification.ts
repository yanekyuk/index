/**
 * Notification priority agent: decides how urgently to notify a user about an opportunity.
 * Used to choose immediate (WebSocket), high (email), or low (weekly digest).
 * Pure logic, no LLM — based on confidence and category.
 */

export type NotificationPriority = 'immediate' | 'high' | 'low';

export interface NotificationPriorityInput {
  /** Confidence score 0–1 from opportunity interpretation */
  confidence: number;
  /** Category e.g. 'collaboration' | 'hiring' | 'investment' | 'mentorship' */
  category: string;
}

const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const EMAIL_THRESHOLD = 0.6;

/**
 * Decide notification priority from opportunity confidence and category.
 * - immediate: Very high confidence or high-signal categories (e.g. hiring, investment) → real-time push
 * - high: Above email threshold → send email now
 * - low: Below threshold → aggregate for weekly digest
 */
export function decideNotificationPriority(input: NotificationPriorityInput): NotificationPriority {
  const { confidence, category } = input;
  const normalizedCategory = (category ?? 'collaboration').toLowerCase();

  let result: NotificationPriority;
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    result = 'immediate';
  } else {
    const highSignalCategories = ['hiring', 'investment', 'mentorship'];
    if (highSignalCategories.some((c) => normalizedCategory.includes(c)) && confidence >= EMAIL_THRESHOLD) {
      result = 'high';
    } else if (confidence >= EMAIL_THRESHOLD) {
      result = 'high';
    } else {
      result = 'low';
    }
  }
  return result;
}
