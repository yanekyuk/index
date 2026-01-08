// src/agents/intent/felicity/pragmatic/pragmatic-monitor.types.ts

export interface PragmaticMonitorOutput {
  /**
   * The status of the intent based on recent conversation.
   * - FULFILLED: User explicitly stated they finished the task (e.g., "I pushed the code").
   * - BREACHED: User admitted failure or changed direction (e.g., "I decided not to do it").
   * - PENDING: The topic hasn't been mentioned again, or is still in progress.
   * - CONTRADICTED: User is doing something that makes the old intent impossible.
   */
  status: "FULFILLED" | "BREACHED" | "PENDING" | "CONTRADICTED";

  /**
   * Confidence score (0-100).
   * - 100: Explicit confirmation ("Here is the link: github.com/...").
   * - 50: Vague allusion ("I'm working on it").
   * - 0: No signal.
   */
  confidence_score: number;

  /**
   * The specific text from the recent history that proves the status.
   */
  evidence_quote: string;

  /**
   * Explanation of the deduction.
   */
  reasoning: string;
}