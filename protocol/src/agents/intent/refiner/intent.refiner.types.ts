/**
 * Output type for the IntentRefiner agent.
 */
export interface IntentRefinerOutput {
  /** The refined intent text combining the original with the followup refinement */
  refinedPayload: string;
}
