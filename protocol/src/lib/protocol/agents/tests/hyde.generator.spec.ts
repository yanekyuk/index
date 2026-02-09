/**
 * HyDE Generator agent tests using Smartest (spec-driven, LLM-verified).
 * Covers all six strategies, alternate sources, context variants, and LLM-verified
 * criteria per opportunity-redesign-plan Section 5 (HyDE pipeline) and Step 6.
 *
 * Plan: "Integration test: Generator produces reasonable text for each strategy (mocked or real LLM)"
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { runScenario, defineScenario, expectSmartest } from '../../../smartest';
import { HydeGenerator } from '../hyde.generator';
import type { HydeStrategy } from '../hyde.strategies';
import type { HydeContext } from '../hyde.strategies';

const generatorOutputSchema = z.object({
  text: z.string().min(1),
});

/** Primary source and description per strategy (plan Section 5.4). */
const STRATEGY_SOURCES: Record<HydeStrategy, { source: string; description: string }> = {
  mirror: {
    source: 'Looking for a technical co-founder to build a B2B SaaS in AI.',
    description: 'hypothetical profile (who can help me)',
  },
  reciprocal: {
    source: 'I offer React and TypeScript consulting.',
    description: 'hypothetical intent (who needs what I offer)',
  },
  mentor: {
    source: 'I want to grow as an early-stage founder.',
    description: 'hypothetical mentor profile',
  },
  investor: {
    source: 'Building a fintech startup seeking seed funding.',
    description: 'hypothetical investor thesis',
  },
  collaborator: {
    source: 'Looking for a design co-founder for a consumer app.',
    description: 'hypothetical collaboration-seeking intent',
  },
  hiree: {
    source: 'We are hiring a senior backend engineer (Go/Rust).',
    description: 'hypothetical job-seeking intent',
  },
};

/** Alternate sources per strategy for broader coverage (schema-only). */
const ALT_SCENARIOS: Array<{ strategy: HydeStrategy; source: string; label: string }> = [
  { strategy: 'mirror', source: 'Seeking a React developer for an early-stage startup.', label: 'mirror-react' },
  { strategy: 'reciprocal', source: 'I am looking for seed investment for a climate tech company.', label: 'reciprocal-funding' },
  { strategy: 'mentor', source: 'I need guidance on scaling a B2B SaaS.', label: 'mentor-scaling' },
  { strategy: 'investor', source: 'We are a pre-seed healthtech startup.', label: 'investor-healthtech' },
  { strategy: 'collaborator', source: 'Building an AI tool and want a peer to co-build.', label: 'collaborator-ai' },
  { strategy: 'hiree', source: 'Hiring a frontend lead (React, design systems).', label: 'hiree-frontend' },
];

describe('HydeGenerator static helpers', () => {
  it('getTargetCorpus returns correct corpus per strategy', () => {
    expect(HydeGenerator.getTargetCorpus('mirror')).toBe('profiles');
    expect(HydeGenerator.getTargetCorpus('reciprocal')).toBe('intents');
    expect(HydeGenerator.getTargetCorpus('mentor')).toBe('profiles');
    expect(HydeGenerator.getTargetCorpus('investor')).toBe('profiles');
    expect(HydeGenerator.getTargetCorpus('collaborator')).toBe('intents');
    expect(HydeGenerator.getTargetCorpus('hiree')).toBe('intents');
  });

  it('shouldPersist returns true only for mirror and reciprocal', () => {
    expect(HydeGenerator.shouldPersist('mirror')).toBe(true);
    expect(HydeGenerator.shouldPersist('reciprocal')).toBe(true);
    expect(HydeGenerator.shouldPersist('mentor')).toBe(false);
    expect(HydeGenerator.shouldPersist('investor')).toBe(false);
    expect(HydeGenerator.shouldPersist('collaborator')).toBe(false);
    expect(HydeGenerator.shouldPersist('hiree')).toBe(false);
  });

  it('getCacheTTL returns number for non-persisted, undefined for persisted', () => {
    expect(HydeGenerator.getCacheTTL('mirror')).toBeUndefined();
    expect(HydeGenerator.getCacheTTL('reciprocal')).toBeUndefined();
    expect(HydeGenerator.getCacheTTL('mentor')).toBe(3600);
    expect(HydeGenerator.getCacheTTL('investor')).toBe(3600);
    expect(HydeGenerator.getCacheTTL('collaborator')).toBe(3600);
    expect(HydeGenerator.getCacheTTL('hiree')).toBe(3600);
  });
});

const ALL_STRATEGIES: HydeStrategy[] = [
  'mirror',
  'reciprocal',
  'mentor',
  'investor',
  'collaborator',
  'hiree',
];

function buildGenerateScenario(strategy: HydeStrategy, overrides?: { source?: string; name?: string }) {
  const { source, description } = overrides?.source
    ? { source: overrides.source, description: '' }
    : STRATEGY_SOURCES[strategy];
  return defineScenario({
    name: overrides?.name ?? `generate-${strategy}`,
    description: `Generator produces reasonable ${description || strategy} output.`,
    fixtures: { source, strategy },
    sut: {
      type: 'agent',
      factory: () => new HydeGenerator(),
      invoke: async (instance, resolvedInput) => {
        const input = resolvedInput as { source: string; strategy: HydeStrategy };
        return await (instance as HydeGenerator).generate(input.source, input.strategy);
      },
      input: { source: '@fixtures.source', strategy: '@fixtures.strategy' },
    },
    verification: {
      schema: generatorOutputSchema,
      criteria: 'N/A',
      llmVerify: false,
    },
  });
}

function buildGenerateWithContextScenario(
  source: string,
  strategy: HydeStrategy,
  context: HydeContext,
  name: string
) {
  return defineScenario({
    name,
    description: `generate(sourceText, strategy, context) with context ${JSON.stringify(context)}.`,
    fixtures: { source, strategy, context },
    sut: {
      type: 'agent',
      factory: () => new HydeGenerator(),
      invoke: async (instance, resolvedInput) => {
        const input = resolvedInput as { source: string; strategy: HydeStrategy; context: HydeContext };
        return await (instance as HydeGenerator).generate(input.source, input.strategy, input.context);
      },
      input: { source: '@fixtures.source', strategy: '@fixtures.strategy', context: '@fixtures.context' },
    },
    verification: {
      schema: generatorOutputSchema,
      criteria: 'N/A',
      llmVerify: false,
    },
  });
}

/** LLM verification criteria per strategy (plan: first person, target voice, no meta-commentary). */
const LLM_CRITERIA: Record<HydeStrategy, string> = {
  mirror:
    'The source is a goal or need (e.g. "looking for a React developer"). ' +
    'The output must be a short hypothetical document in first person, written from the perspective of the OTHER side—the ideal candidate or match, NOT the person who wrote the source. ' +
    'It should read like a profile or bio of someone who could satisfy the source goal (e.g. a React developer describing themselves). ' +
    'No meta-commentary; only the hypothetical text.',
  reciprocal:
    'The output must be a short goal or aspiration statement in first person, as if someone stating what they are looking for. ' +
    'It should match someone who would want exactly what the source offers. No meta-commentary; only the hypothetical statement.',
  mentor:
    'The output must be a short mentor profile in first person: someone who could guide a person with the source goal. ' +
    'Describe background and how they help others. No meta-commentary; only the hypothetical profile.',
  investor:
    'The output must be a short investor thesis in first person: someone who would be interested in funding the source. ' +
    'Include focus, stage, and what they look for. No meta-commentary; only the hypothetical thesis.',
  collaborator:
    'The output must be a short collaboration-seeking statement in first person: a peer who would be a great partner for the source. ' +
    'Complementary skills and shared interests. No meta-commentary; only the hypothetical statement.',
  hiree:
    'The output must be a short job-seeking statement in first person: someone who would be perfect for the source role. ' +
    'Role they want and relevant experience. No meta-commentary; only the hypothetical statement.',
};

function buildLLMVerifiedScenario(strategy: HydeStrategy, source: string, name: string) {
  return defineScenario({
    name,
    description: `HyDE ${strategy} strategy: given a source statement, produce a first-person hypothetical document written from the perspective of the ideal counterpart (the other side of the match), not from the source's own perspective.`,
    fixtures: { source, strategy },
    sut: {
      type: 'agent',
      factory: () => new HydeGenerator(),
      invoke: async (instance, resolvedInput) => {
        const input = resolvedInput as { source: string; strategy: HydeStrategy };
        return await (instance as HydeGenerator).generate(input.source, input.strategy);
      },
      input: { source: '@fixtures.source', strategy: '@fixtures.strategy' },
    },
    verification: {
      schema: generatorOutputSchema,
      criteria: LLM_CRITERIA[strategy],
      llmVerify: true,
    },
  });
}

describe('HydeGenerator generate (smartest scenarios)', () => {
  describe('primary source per strategy (schema only)', () => {
    it.each(ALL_STRATEGIES)(
      'produces non-empty text for strategy "%s"',
      async (strategy) => {
        const result = await runScenario(buildGenerateScenario(strategy));
        expectSmartest(result);
        expect((result.output as { text: string })?.text?.length).toBeGreaterThan(0);
      },
      30000
    );
  });

  describe('alternate sources (schema only)', () => {
    it.each(ALT_SCENARIOS)(
      'produces non-empty text for $label ($strategy)',
      async ({ strategy, source, label }) => {
        const result = await runScenario(
          buildGenerateScenario(strategy, { source, name: `alt-${label}` })
        );
        expectSmartest(result);
        expect((result.output as { text: string })?.text?.length).toBeGreaterThan(0);
      },
      30000
    );
  });

  describe('with context (plan HydeContext)', () => {
    it('produces text with no context', async () => {
      const result = await runScenario(
        buildGenerateWithContextScenario(
          'Looking for seed investment.',
          'investor',
          {},
          'generate-investor-no-context'
        )
      );
      expectSmartest(result);
      expect((result.output as { text: string })?.text?.length).toBeGreaterThan(0);
    }, 30000);

    it('produces text with category only', async () => {
      const result = await runScenario(
        buildGenerateWithContextScenario(
          'Building a B2B SaaS.',
          'investor',
          { category: 'startup' },
          'generate-investor-category'
        )
      );
      expectSmartest(result);
      expect((result.output as { text: string })?.text?.length).toBeGreaterThan(0);
    }, 30000);

    it('produces text with indexId only', async () => {
      const result = await runScenario(
        buildGenerateWithContextScenario(
          'Seeking a design co-founder.',
          'collaborator',
          { indexId: 'idx-founders' },
          'generate-collaborator-indexId'
        )
      );
      expectSmartest(result);
      expect((result.output as { text: string })?.text?.length).toBeGreaterThan(0);
    }, 30000);

    it('produces text with customPrompt only', async () => {
      const result = await runScenario(
        buildGenerateWithContextScenario(
          'Looking for seed investment.',
          'investor',
          { customPrompt: 'B2B and SaaS focus only.' },
          'generate-investor-customPrompt'
        )
      );
      expectSmartest(result);
      expect((result.output as { text: string })?.text?.length).toBeGreaterThan(0);
    }, 30000);

    it('produces text with full context (category, indexId, customPrompt)', async () => {
      const context: HydeContext = {
        category: 'startup',
        indexId: 'idx-test',
        customPrompt: 'B2B focus.',
      };
      const result = await runScenario(
        buildGenerateWithContextScenario(
          'Looking for seed investment.',
          'investor',
          context,
          'generate-with-full-context'
        )
      );
      expectSmartest(result);
      expect((result.output as { text: string })?.text?.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('LLM-verified (first person, target voice per plan)', () => {
    const LLM_TIMEOUT = 70000; // per test; verifier can be slow

    it('mirror: first-person profile that could match intent', async () => {
      const result = await runScenario(
        buildLLMVerifiedScenario(
          'mirror',
          'Looking for a React developer to join our early-stage startup.',
          'mirror-llm-verify'
        )
      );
      expectSmartest(result);
    }, LLM_TIMEOUT);

    it('reciprocal: first-person goal of someone who needs what source offers', async () => {
      const result = await runScenario(
        buildLLMVerifiedScenario(
          'reciprocal',
          'I offer React and TypeScript consulting for early-stage teams.',
          'reciprocal-llm-verify'
        )
      );
      expectSmartest(result);
    }, LLM_TIMEOUT);

    it('mentor: first-person mentor profile for source goal', async () => {
      const result = await runScenario(
        buildLLMVerifiedScenario(
          'mentor',
          'I want to grow as an early-stage founder.',
          'mentor-llm-verify'
        )
      );
      expectSmartest(result);
    }, LLM_TIMEOUT);

    it('investor: first-person investor thesis for source', async () => {
      const result = await runScenario(
        buildLLMVerifiedScenario(
          'investor',
          'Building a fintech startup seeking seed funding.',
          'investor-llm-verify'
        )
      );
      expectSmartest(result);
    }, LLM_TIMEOUT);

    it('collaborator: first-person collaboration-seeking statement', async () => {
      const result = await runScenario(
        buildLLMVerifiedScenario(
          'collaborator',
          'Looking for a design co-founder for a consumer app.',
          'collaborator-llm-verify'
        )
      );
      expectSmartest(result);
    }, LLM_TIMEOUT);

    it('hiree: first-person job-seeking statement for source role', async () => {
      const result = await runScenario(
        buildLLMVerifiedScenario(
          'hiree',
          'We are hiring a senior backend engineer (Go/Rust).',
          'hiree-llm-verify'
        )
      );
      expectSmartest(result);
    }, LLM_TIMEOUT);
  });
});
