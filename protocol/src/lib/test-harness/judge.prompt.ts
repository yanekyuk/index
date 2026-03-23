// protocol/src/lib/test-harness/judge.prompt.ts
import { z } from "zod";

export const judgeResponseSchema = z.object({
  scores: z.array(z.object({
    criterion: z.string(),
    score: z.number().min(0).max(1),
    reasoning: z.string(),
  })),
});

export type JudgeResponse = z.infer<typeof judgeResponseSchema>;

export function buildJudgePrompt(params: {
  value: string;
  criteria: string[];
  context?: string;
}): string {
  const contextBlock = params.context
    ? `Context describes the test scenario setup and expected conditions.\nContext: ${params.context}\n\n`
    : "";

  const criteriaList = params.criteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  return (
    `You are a test judge. Score how well the given value satisfies each criterion.\n\n` +
    contextBlock +
    `Value is the actual output being evaluated.\n` +
    `Value: ${params.value}\n\n` +
    `Criteria:\n${criteriaList}\n\n` +
    `For each criterion, return the criterion text (exactly as given), a score (0.0-1.0), and a one-sentence reasoning.`
  );
}
