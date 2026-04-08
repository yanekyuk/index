/**
 * Smartest LLM verifier: system prompt and structured output schema.
 */

import { z } from 'zod';

export const SMARTEST_VERIFIER_SYSTEM_PROMPT = `You are a test oracle. Given a scenario description, the input that was sent to the system under test, and the actual output produced, determine whether the output satisfies the stated criteria.

Output may be truncated for brevity (e.g. long message lists or tool results). Base your verdict on the fields that matter for the criteria (e.g. responseText, error); truncated parts are for context only.

Reply with a strict JSON object containing:
- "pass": boolean — true if the output satisfies the criteria, false otherwise.
- "reasoning": string — brief explanation (one to three sentences) for your verdict.

Do not add any text outside the JSON object.`;

/**
 * Structured output schema for the verifier agent.
 */
export const smartestVerifierOutputSchema = z.object({
  pass: z.boolean().describe('True if the output satisfies the criteria'),
  reasoning: z.string().describe('Brief explanation for the verdict'),
});

export type SmartestVerifierOutput = z.infer<typeof smartestVerifierOutputSchema>;

const MAX_INPUT_OUTPUT_LENGTH = 3000;

function truncateForPrompt(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (str.length <= MAX_INPUT_OUTPUT_LENGTH) return str;
  return str.slice(0, MAX_INPUT_OUTPUT_LENGTH) + '\n... [truncated]';
}

/**
 * Build the user message for the verifier.
 */
export function buildVerifierUserMessage(
  scenarioDescription: string,
  input: unknown,
  output: unknown,
  criteria: string
): string {
  const inputStr = truncateForPrompt(input);
  const outputStr = truncateForPrompt(output);

  return `## Scenario
${scenarioDescription}

## Input to the system
${inputStr}

## Actual output from the system
${outputStr}

## Criteria to check
${criteria}

Respond with a JSON object: { "pass": boolean, "reasoning": "..." }`;
}
