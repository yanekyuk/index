/**
 * HyDE Generator Agent: pure LLM agent for generating hypothetical documents
 * in the target corpus voice. Used by the HyDE graph for cache-aware generation.
 */

import { BaseLangChainAgent } from '../../../../lib/langchain/langchain';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import {
  type HydeStrategy,
  type HydeContext,
  HYDE_STRATEGIES,
  type HydeTargetCorpus,
} from './hyde.strategies';

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

export class HydeGenerator extends BaseLangChainAgent {
  constructor(options?: { preset?: string; temperature?: number }) {
    super({
      preset: options?.preset ?? 'hyde-generator',
      responseFormat,
      temperature: options?.temperature ?? 0.4,
    });
  }

  /**
   * Generate a hypothetical document for the given source text and strategy.
   */
  async generate(
    sourceText: string,
    strategy: HydeStrategy,
    context?: HydeContext
  ): Promise<HydeGeneratorOutput> {
    const config = HYDE_STRATEGIES[strategy];
    const promptText = config.prompt(sourceText, context);

    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(promptText),
    ];

    const result = await this.model.invoke({ messages }) as { structuredResponse?: { hypotheticalDocument: string } };
    const parsed = result?.structuredResponse;
    const text = parsed?.hypotheticalDocument ?? '';

    return { text };
  }

  /** Target corpus for this strategy (profiles vs intents). */
  static getTargetCorpus(strategy: HydeStrategy): HydeTargetCorpus {
    return HYDE_STRATEGIES[strategy].targetCorpus;
  }

  /** Whether this strategy's output should be persisted to DB (vs ephemeral cache). */
  static shouldPersist(strategy: HydeStrategy): boolean {
    return HYDE_STRATEGIES[strategy].persist;
  }

  /** Cache TTL in seconds for non-persisted strategies; undefined if persisted. */
  static getCacheTTL(strategy: HydeStrategy): number | undefined {
    return HYDE_STRATEGIES[strategy].cacheTTL;
  }
}
