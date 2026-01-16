/**
 * Output structure for the Intent Indexer agent.
 */
export interface IntentIndexerOutput {
  /**
   * Score indicating how appropriate the intent is for the index purpose (0.0 to 1.0).
   * 0.0 = Not appropriate at all
   * 1.0 = Perfectly appropriate
   */
  indexScore: number;

  /**
   * Score indicating how well the intent matches the member's sharing preferences (0.0 to 1.0).
   * 0.0 = Does not match preferences
   * 1.0 = Perfectly matches preferences
   * Return 0.0 if not applicable (e.g. no member prompt provided).
   */
  memberScore: number;

  /**
   * Brief reasoning for the assigned scores.
   */
  reasoning: string;
}
