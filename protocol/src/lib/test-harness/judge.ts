import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

import { buildJudgePrompt, judgeResponseSchema, type JudgeResponse } from "./judge.prompt";

const MAX_VALUE_LENGTH = 10_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface CallJudgeInput {
  value: string;
  criteria: string[];
  context?: string;
  timeout?: number;
}

/**
 * Calls an LLM judge to score how well a value satisfies a list of criteria.
 *
 * @param input - The value to evaluate, criteria to score against, and optional context
 * @returns Structured scores for each criterion with reasoning
 * @throws Error if OPENROUTER_API_KEY is not set or if the LLM returns no parseable response
 */
export async function callJudge(input: CallJudgeInput): Promise<JudgeResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set — cannot run LLM judge");
  }

  const model = process.env.TEST_JUDGE_MODEL ?? "google/gemini-2.5-flash";
  const baseURL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  const client = new OpenAI({ apiKey, baseURL });

  const truncatedValue = input.value.length > MAX_VALUE_LENGTH
    ? input.value.slice(0, MAX_VALUE_LENGTH) + "\n... [truncated]"
    : input.value;

  const prompt = buildJudgePrompt({
    value: truncatedValue,
    criteria: input.criteria,
    context: input.context,
  });

  const response = await client.beta.chat.completions.parse({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 1024,
    response_format: zodResponseFormat(judgeResponseSchema, "judge_response"),
  }, {
    timeout: input.timeout ?? DEFAULT_TIMEOUT_MS,
  });

  const parsed = response.choices[0]?.message?.parsed;
  if (!parsed) {
    throw new Error("LLM judge returned no parseable response");
  }

  return parsed;
}
