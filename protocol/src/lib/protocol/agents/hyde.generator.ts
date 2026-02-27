/**
 * HyDE Generator Agent: pure LLM agent for generating hypothetical documents
 * in the target corpus voice. Uses free-text lens labels instead of enum strategies.
 */

import { BaseLangChainAgent } from '../../langchain/langchain';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { HYDE_CORPUS_PROMPTS } from './hyde.strategies';
import type { HydeTargetCorpus } from './lens.inferrer';
import { Timed } from "../../performance";

const SYSTEM_PROMPT = `You are a Hypothetical Document Generator for semantic search.

Your task: Given a source statement (e.g. an intent or goal), write a short hypothetical document in the voice of the TARGET side—the kind of person or statement that would be an ideal match for that source.

Rules:
- Write in first person as the target.
- Be concrete and specific so the text is good for vector similarity search.
- Output only the hypothetical document text, no meta-commentary.
- Keep length to a few sentences or one short paragraph.`;

const responseFormat = z.object({
  hypotheticalDocument: z
    .string()
    .describe('The hypothetical document text in the target voice, suitable for embedding and retrieval'),
});

export interface HydeGeneratorOutput {
  text: string;
}

export interface HydeGenerateInput {
  /** Original intent or query text. */
  sourceText: string;
  /** Free-text lens label from LensInferrer (e.g. "crypto infra VC"). */
  lens: string;
  /** Which corpus voice to generate in. */
  corpus: HydeTargetCorpus;
}

/**
 * Generates hypothetical documents in a target corpus voice for semantic search.
 * Uses free-text lens labels (from LensInferrer) instead of enum strategies.
 */
export class HydeGenerator extends BaseLangChainAgent {
  constructor(options?: { preset?: string; temperature?: number }) {
    super({
      preset: options?.preset ?? 'hyde-generator',
      responseFormat,
      temperature: options?.temperature ?? 0.4,
    });
  }

  /**
   * Generate a hypothetical document for the given source text and lens.
   *
   * @param input - Source text, lens label, and target corpus
   * @returns Generated hypothetical document text
   */
  @Timed()
  async generate(input: HydeGenerateInput): Promise<HydeGeneratorOutput> {
    const promptText = HYDE_CORPUS_PROMPTS[input.corpus](input.sourceText, input.lens);

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(promptText),
    ];

    const result = await this.model.invoke({ messages }) as { structuredResponse?: { hypotheticalDocument: string } };
    const parsed = result?.structuredResponse;
    const text = parsed?.hypotheticalDocument ?? '';

    return { text };
  }
}
