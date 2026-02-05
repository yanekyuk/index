import { z } from "zod";

// ──────────────────────────────────────────────────────────────
// Response schema (re-exported for use in intent.indexer.ts)
// ──────────────────────────────────────────────────────────────

export const IntentIndexerOutputSchema = z.object({
  indexScore: z.number().min(0).max(1).describe("Score for index appropriateness (0.0-1.0)"),
  memberScore: z.number().min(0).max(1).describe("Score for member preference match (0.0-1.0)"),
  reasoning: z.string().describe("Brief reasoning for the scores"),
});

/**
 * Output structure for the Intent Indexer agent.
 */
export type IntentIndexerOutput = z.infer<typeof IntentIndexerOutputSchema>;
