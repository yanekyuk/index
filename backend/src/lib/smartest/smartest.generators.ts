/**
 * Built-in generators for smartest fixtures (data creation).
 * Use SMARTEST_GENERATOR_MODEL (default: gemini-2.5-flash).
 * Pass responseSchema (Zod) in params for structured output.
 */

import { HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import type { z } from 'zod';
import { SMARTEST_GENERATOR_MODEL } from './smartest.config';
import type { GeneratorFn, GeneratorParams, GeneratorRegistry } from './smartest.types';

function createLlm(maxTokens = 1024) {
  return new ChatOpenAI({
    model: SMARTEST_GENERATOR_MODEL,
    apiKey: process.env.OPENROUTER_API_KEY!,
    configuration: {
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    },
    temperature: 0.6,
    maxTokens,
  });
}

/** Check if value looks like a Zod schema (has parse). */
function isZodSchema(value: unknown): value is z.ZodType<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'parse' in value &&
    typeof (value as z.ZodType).parse === 'function'
  );
}

function getResponseSchema(params: GeneratorParams): z.ZodType<unknown> | undefined {
  const schema = params.responseSchema ?? params.schema ?? params.params?.responseSchema ?? params.params?.schema;
  return isZodSchema(schema) ? schema : undefined;
}

/**
 * Generator "text": produce text or structured output from a prompt.
 * Params: prompt (string), maxTokens (optional), responseSchema (optional Zod schema).
 */
export const textGenerator: GeneratorFn = async (params: GeneratorParams) => {
  const prompt = params.prompt ?? params.params?.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Generator "text" requires params.prompt (string).');
  }
  const maxTokens = (params.maxTokens ?? params.params?.maxTokens) as number | undefined;
  const schema = getResponseSchema(params);
  const llm = createLlm(maxTokens ?? 1024);
  const msg = new HumanMessage(prompt);

  if (schema) {
    const structured = llm.withStructuredOutput(schema, { name: 'text_generator' });
    return await structured.invoke([msg]);
  }
  const response = await llm.invoke([msg]);
  const content = response?.content;
  return typeof content === 'string' ? content : String(content ?? '');
};

/**
 * Default generator registry: only the generic "text" generator.
 * Domain-specific generators (e.g. profile, intent, opportunity) must be defined
 * by the project and passed via runScenario(..., { generators: { ... } }).
 */
export const defaultGeneratorRegistry: GeneratorRegistry = {
  text: textGenerator,
};

/**
 * Merge default registry with custom entries (custom overrides same keys).
 */
export function mergeGeneratorRegistry(
  custom?: GeneratorRegistry
): GeneratorRegistry {
  if (!custom || Object.keys(custom).length === 0) {
    return { ...defaultGeneratorRegistry };
  }
  return { ...defaultGeneratorRegistry, ...custom };
}
