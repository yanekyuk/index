// src/agents/intent/input-validator/input-validator.types.ts

export interface SyntacticValidatorOutput {
  /**
   * Status of the validation.
   * - PASS: Input is intelligible English and safe to process.
   * - FAIL: Input is gibberish, wrong language, empty, or spam.
   */
  status: "PASS" | "FAIL";

  /** Detected language code (ISO 639-1), e.g., "en", "es", "fr". */
  language: string;

  /** * Boolean flag indicating if the text makes basic logical sense.
   * Example: "dhskjfhsd" -> false. "I want to build a rocket" -> true.
   */
  is_intelligible: boolean;

  /**
   * If status is FAIL, this field explains why.
   * e.g., "Detected non-English input", "High perplexity/Gibberish".
   */
  rejection_reason: string | null;
}