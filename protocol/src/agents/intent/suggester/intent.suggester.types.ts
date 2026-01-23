/**
 * Output types for the IntentSuggester agent.
 * 
 * These types define the structure of refinement suggestions that help
 * users narrow down or clarify their intents through contextual chip options.
 */

/**
 * A single refinement suggestion that can be applied to an intent.
 * 
 * Suggestions come in two flavors:
 * - "direct": Complete refinements that can be applied immediately on click
 * - "prompt": Partial refinements that prefill the input for user completion
 */
export interface Suggestion {
  /** Short chip label displayed to the user (max 40 chars) */
  label: string;

  /** 
   * Type of suggestion:
   * - "direct": Apply immediately on click (requires followupText)
   * - "prompt": Prefill input for user to complete (requires prefill)
   */
  type: 'direct' | 'prompt';

  /** Complete refinement text to apply (required for "direct" type) */
  followupText?: string;

  /** Partial text to prefill input (required for "prompt" type) */
  prefill?: string;
}

/**
 * The structured output from the IntentSuggester agent.
 */
export interface IntentSuggesterOutput {
  /** Array of 3-5 contextual refinement suggestions */
  suggestions: Suggestion[];
}
