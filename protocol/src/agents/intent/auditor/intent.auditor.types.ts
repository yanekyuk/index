export interface IntentAuditorOutput {
  /** Whether the intent has expired */
  isExpired: boolean;
  /** Confidence score 0-100 indicating certainty of expiration */
  confidenceScore: number;
  /** Brief explanation of why the intent is considered expired or valid */
  reasoning: string;
}
