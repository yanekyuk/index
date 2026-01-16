export interface TagSuggestion {
  /**
   * Lowercase tag value to be added to prompt (1-3 words, clear and specific).
   */
  value: string;

  /**
   * Relevance score between 0 and 1.
   */
  score: number;
}

export interface IntentTagGeneratorOutput {
  /**
   * Array of tag suggestions ordered by relevance.
   */
  suggestions: TagSuggestion[];
}
