/**
 * HyDE strategy registry tests using Smartest (spec-driven scenarios).
 * Each strategy is validated via a scenario: fixtures → SUT (config + prompt) → schema verification.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { runScenario, defineScenario } from '../../../smartest';
import { type HydeStrategy, HYDE_STRATEGIES } from './hyde.strategies';

const ALL_STRATEGIES: HydeStrategy[] = [
  'mirror',
  'reciprocal',
  'mentor',
  'investor',
  'collaborator',
  'hiree',
];

/** Output shape when SUT "invokes" a strategy: config slice + prompt result. */
const strategyOutputSchema = z.object({
  targetCorpus: z.enum(['profiles', 'intents']),
  persist: z.boolean(),
  cacheTTL: z.number().optional(),
  promptResult: z.string().min(1),
});

function buildStrategyScenario(strategy: HydeStrategy, sourceText: string) {
  return defineScenario({
    name: `strategy-${strategy}-valid`,
    description: `${strategy} strategy has valid config and prompt returns non-empty string containing source.`,
    fixtures: {
      strategy,
      source: sourceText,
    },
    sut: {
      type: 'agent',
      factory: () => HYDE_STRATEGIES,
      invoke: async (registry, resolvedInput) => {
        const input = resolvedInput as { strategy: HydeStrategy; source: string };
        const config = (registry as typeof HYDE_STRATEGIES)[input.strategy];
        return {
          targetCorpus: config.targetCorpus,
          persist: config.persist,
          cacheTTL: config.cacheTTL,
          promptResult: config.prompt(input.source),
        };
      },
      input: {
        strategy: '@fixtures.strategy',
        source: '@fixtures.source',
      },
    },
    verification: {
      schema: strategyOutputSchema,
      criteria: 'N/A',
      llmVerify: false,
    },
  });
}

describe('HyDE Strategies', () => {
  it('should define all six strategies', () => {
    expect(Object.keys(HYDE_STRATEGIES).sort()).toEqual(ALL_STRATEGIES.slice().sort());
  });

  it.each(ALL_STRATEGIES)('strategy "%s" config is valid and prompt embeds source', async (strategy) => {
    const scenario = buildStrategyScenario(strategy, 'Looking for a React co-founder');
    const result = await runScenario(scenario);
    expect(result.pass).toBe(true);
    expect(result.schemaError).toBeUndefined();
    const output = result.output as { promptResult: string };
    expect(output?.promptResult).toContain('Looking for a React co-founder');
  });

  it('mirror and reciprocal are persisted; others ephemeral with cacheTTL', () => {
    expect(HYDE_STRATEGIES.mirror.persist).toBe(true);
    expect(HYDE_STRATEGIES.reciprocal.persist).toBe(true);
    expect(HYDE_STRATEGIES.mentor.persist).toBe(false);
    expect(HYDE_STRATEGIES.investor.persist).toBe(false);
    expect(HYDE_STRATEGIES.collaborator.persist).toBe(false);
    expect(HYDE_STRATEGIES.hiree.persist).toBe(false);
  });

  it('profile strategies are mirror, mentor, investor', () => {
    expect(HYDE_STRATEGIES.mirror.targetCorpus).toBe('profiles');
    expect(HYDE_STRATEGIES.mentor.targetCorpus).toBe('profiles');
    expect(HYDE_STRATEGIES.investor.targetCorpus).toBe('profiles');
  });

  it('intent strategies are reciprocal, collaborator, hiree', () => {
    expect(HYDE_STRATEGIES.reciprocal.targetCorpus).toBe('intents');
    expect(HYDE_STRATEGIES.collaborator.targetCorpus).toBe('intents');
    expect(HYDE_STRATEGIES.hiree.targetCorpus).toBe('intents');
  });

  it('prompt with context returns non-empty string containing source', async () => {
    const scenario = defineScenario({
      name: 'prompt-with-context',
      description: 'Strategy prompt accepts optional context and returns string containing source.',
      fixtures: {
        source: 'Build a SaaS',
        context: { category: 'startup', indexId: 'idx-1', customPrompt: 'Focus on B2B.' } as const,
      },
      sut: {
        type: 'agent',
        factory: () => HYDE_STRATEGIES.mirror,
        invoke: async (config, resolvedInput) => {
          const input = resolvedInput as { source: string; context: { category: string; indexId: string } };
          return { promptResult: (config as typeof HYDE_STRATEGIES.mirror).prompt(input.source, input.context) };
        },
        input: { source: '@fixtures.source', context: '@fixtures.context' },
      },
      verification: {
        schema: z.object({ promptResult: z.string().min(1) }),
        criteria: 'N/A',
        llmVerify: false,
      },
    });
    const result = await runScenario(scenario);
    expect(result.pass).toBe(true);
    const output = result.output as { promptResult: string };
    expect(output.promptResult).toContain('Build a SaaS');
  });
});
