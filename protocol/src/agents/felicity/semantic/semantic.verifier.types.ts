// src/agents/intent/felicity/semantic/semantic-verifier.types.ts

/**
 * The output of the Semantic Verifier (Phase 2).
 * This agent evaluates the "Illocutionary Force" and "Felicity Conditions"
 * of a user's intent.
 */
export interface SemanticVerifierOutput {
  /** * The Speech Act Category (Searle's Taxonomy). 
   * - COMMISSIVE: Promises, Offers, Vows (High Value).
   * - DIRECTIVE: Requests, Commands.
   * - ASSERTIVE: Statements of fact/belief.
   * - EXPRESSIVE: Thanks, Apologies.
   * - DECLARATION: Immediate changes to reality (rare in chat).
   */
  classification: "COMMISSIVE" | "DIRECTIVE" | "ASSERTIVE" | "EXPRESSIVE" | "DECLARATION" | "UNKNOWN";

  /**
   * Quantitative scoring of the Felicity Conditions (0-100).
   * Used to filter "Cheap Talk" vs. "Real Intent".
   */
  felicity_scores: {
    /** Essential Condition: Is the intent clearly stated or ambiguous? */
    clarity: number;
    /** Preparatory Condition: Does the User Profile (Context) support this claim? */
    authority: number;
    /** Sincerity Condition: Does the language imply genuine commitment? */
    sincerity: number;
  };

  /** * Specific violations detected during verification.
   * e.g., "SKILL_MISMATCH", "HEDGING_DETECTED", "FUTURE_TENSE_MISSING"
   */
  flags: string[];

  /** Human-readable explanation of the verdict. */
  reasoning: string;
}