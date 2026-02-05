/**
 * Opportunity Graph: spec-driven tests with Smartest.
 * The graph finds opportunities (matches between a source user and candidates) via
 * HyDE-based search, deduplication, evaluation, and persistence.
 *
 * Scenarios use Smartest to generate input data (source profile, query) and to
 * validate output shape and semantics (opportunities with detection, actors, interpretation).
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, spyOn, beforeAll } from 'bun:test';
import { z } from 'zod';
import { runScenario, defineScenario, expectSmartest } from '../../../smartest';
import { OpportunityGraph, type CompiledHydeGraph } from './opportunity.graph';
import type { Id } from '../../../../types/common';
import type {
  OpportunityGraphDatabase,
  OpportunityActor,
} from '../../interfaces/database.interface';
import type { Embedder } from '../../interfaces/embedder.interface';
import type { HydeCache } from '../../interfaces/cache.interface';
import type { CandidateProfile } from '../../agents/opportunity/opportunity.evaluator';
import type { OpportunityGraphState } from './opportunity.state';

// ─── Output schema for verification ─────────────────────────────────────────

const opportunityOutputItemSchema = z.object({
  id: z.string(),
  detection: z.object({
    source: z.string(),
    timestamp: z.string().optional(),
    triggeredBy: z.string().optional(),
  }),
  actors: z.array(
    z.object({
      role: z.string(),
      identityId: z.string(),
      intents: z.array(z.string()).optional(),
      profile: z.boolean().optional(),
    })
  ),
  interpretation: z.object({
    category: z.string(),
    summary: z.string(),
    confidence: z.union([z.number(), z.string()]),
    signals: z.array(z.unknown()).optional(),
  }),
  context: z.object({
    indexId: z.string(),
    triggeringIntentId: z.string().optional(),
  }),
  indexId: z.string(),
  status: z.string(),
});

const opportunityGraphOutputSchema = z.object({
  opportunities: z.array(opportunityOutputItemSchema),
  candidates: z.array(z.unknown()),
  sourceProfileContext: z.string().optional(),
  sourceUserId: z.string().optional(),
});

// ─── Mock graph factory (shared by scenarios) ──────────────────────────────

const dummyEmbedding = new Array(2000).fill(0.1);
const defaultCandidates: CandidateProfile[] = [
  {
    userId: 'user-bob',
    identity: { name: 'Bob', bio: 'Looking for a Rust mentor' },
    narrative: { context: 'I want to learn systems programming.' },
    score: 0.9,
  },
  {
    userId: 'user-alice',
    identity: { name: 'Alice', bio: 'React Dev' },
    narrative: { context: 'Building frontend apps.' },
    score: 0.8,
  },
];

function createMockGraph(deps?: {
  opportunityExistsBetweenActors?: boolean;
  getProfile?: Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>;
}) {
  const mockDb: OpportunityGraphDatabase = {
    getProfile: () => Promise.resolve(deps?.getProfile ?? null),
    createOpportunity: (data) =>
      Promise.resolve({
        id: 'opp-1',
        detection: data.detection,
        actors: data.actors,
        interpretation: data.interpretation,
        context: data.context,
        indexId: data.indexId,
        confidence: data.confidence,
        status: data.status ?? 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      }),
    opportunityExistsBetweenActors: () =>
      Promise.resolve(deps?.opportunityExistsBetweenActors ?? false),
  };

  const mockEmbedder: Embedder = {
    generate: () => Promise.resolve(dummyEmbedding),
    search: () => Promise.resolve(defaultCandidates.map((c) => ({ item: c, score: 0.9 }))),
    searchWithHydeEmbeddings: () =>
      Promise.resolve([
        {
          type: 'profile' as const,
          id: 'user-bob',
          userId: 'user-bob',
          score: 0.95,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]),
  } as unknown as Embedder;

  const mockCache: HydeCache = {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    delete: () => Promise.resolve(true),
    exists: () => Promise.resolve(false),
  };

  const mockCompiledHydeGraph = {
    invoke: () =>
      Promise.resolve({
        hydeEmbeddings: {
          mirror: dummyEmbedding,
          reciprocal: dummyEmbedding,
        },
      }),
  };

  const graph = new OpportunityGraph(
    mockDb,
    mockEmbedder,
    mockCache,
    mockCompiledHydeGraph as unknown as CompiledHydeGraph
  );
  const compiledGraph = graph.compile();
  return { graph, compiledGraph, mockDb, mockEmbedder, mockCompiledHydeGraph };
}

// ─── Smartest scenarios ─────────────────────────────────────────────────────

describe('Opportunity Graph', () => {
  describe('Smartest: direct candidates → opportunities', () => {
    test('given source profile and candidates, graph returns persisted opportunities with correct shape', async () => {
      const { graph, compiledGraph } = createMockGraph();
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([
        {
          sourceId: 'user-source',
          candidateId: 'user-bob',
          score: 95,
          sourceDescription: 'Meet Bob for mentorship.',
          candidateDescription: 'Meet source for Rust guidance.',
          valencyRole: 'Agent',
        },
      ]);

      const result = await runScenario(
        defineScenario({
          name: 'opportunity-direct-candidates',
          description:
            'Graph with direct candidates (no HyDE/search): source profile and candidate list in; persisted opportunities out with detection, actors, interpretation.',
          fixtures: {
            sourceProfileContext:
              'User is an experienced Rust developer building a decentralized exchange.',
            sourceUserId: 'user-source' as Id<'users'>,
            candidates: defaultCandidates,
          },
          sut: {
            type: 'graph',
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as {
                sourceProfileContext: string;
                sourceUserId: string;
                candidates: CandidateProfile[];
              };
              return await (instance as ReturnType<OpportunityGraph['compile']>).invoke({
                sourceProfileContext: input.sourceProfileContext,
                sourceUserId: input.sourceUserId as Id<'users'>,
                candidates: input.candidates,
                indexScope: [],
                options: { minScore: 50 },
                opportunities: [],
              });
            },
            input: {
              sourceProfileContext: '@fixtures.sourceProfileContext',
              sourceUserId: '@fixtures.sourceUserId',
              candidates: '@fixtures.candidates',
            },
          },
          verification: {
            schema: opportunityGraphOutputSchema,
            criteria:
              'Output must have at least one opportunity. Each opportunity must have detection.source "opportunity_graph", exactly two actors (source and candidate), and interpretation.summary non-empty. The candidate (second actor) should match the fixture candidate (e.g. user-bob).',
            llmVerify: false,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as OpportunityGraphState;
      expect(output.opportunities.length).toBeGreaterThanOrEqual(1);
      const opp = output.opportunities[0];
      expect(opp.actors.some((a: OpportunityActor) => a.identityId === 'user-bob')).toBe(true);
      expect(opp.detection.source).toBe('opportunity_graph');
    });
  });

  describe('Smartest: HyDE discovery path', () => {
    test('given discovery query and source profile, graph output satisfies schema and semantics', async () => {
      const { graph, compiledGraph, mockCompiledHydeGraph, mockEmbedder } = createMockGraph();
      spyOn(mockCompiledHydeGraph, 'invoke').mockResolvedValue({
        hydeEmbeddings: { mirror: dummyEmbedding, reciprocal: dummyEmbedding },
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'profile' as const,
          id: 'user-bob',
          userId: 'user-bob',
          score: 0.95,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([
        {
          sourceId: 'user-source',
          candidateId: 'user-bob',
          score: 92,
          sourceDescription: 'Strong match for your goal.',
          candidateDescription: 'Relevant opportunity.',
          valencyRole: 'Agent',
        },
      ]);

      const result = await runScenario(
        defineScenario({
          name: 'opportunity-hyde-discovery',
          description:
            'Graph with HyDE path: discovery query and source profile in; output has opportunities from search and evaluation with correct shape.',
          fixtures: {
            sourceProfileContext:
              'Experienced backend engineer looking for a technical co-founder.',
            discoveryQuery: 'Find me a technical co-founder for an early-stage startup.',
            sourceUserId: 'user-source' as Id<'users'>,
            indexScope: ['idx-1'] as Id<'indexes'>[],
          },
          sut: {
            type: 'graph',
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as {
                sourceProfileContext: string;
                discoveryQuery: string;
                sourceUserId: string;
                indexScope: string[];
              };
              return await (instance as ReturnType<OpportunityGraph['compile']>).invoke({
                sourceProfileContext: input.sourceProfileContext,
                sourceUserId: input.sourceUserId as Id<'users'>,
                sourceText: input.discoveryQuery,
                indexScope: input.indexScope as Id<'indexes'>[],
                candidates: [],
                options: { hydeDescription: input.discoveryQuery, limit: 5, minScore: 70 },
                opportunities: [],
              });
            },
            input: {
              sourceProfileContext: '@fixtures.sourceProfileContext',
              discoveryQuery: '@fixtures.discoveryQuery',
              sourceUserId: '@fixtures.sourceUserId',
              indexScope: '@fixtures.indexScope',
            },
          },
          verification: {
            schema: opportunityGraphOutputSchema,
            criteria:
              'Output must contain opportunities array. Each opportunity must have detection.source "opportunity_graph", two actors (identityIds), interpretation.summary and interpretation.confidence. Candidates may be empty or populated after search.',
            llmVerify: false,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as OpportunityGraphState;
      expect(Array.isArray(output.opportunities)).toBe(true);
      if (output.opportunities.length > 0) {
        expect(output.opportunities[0].detection.source).toBe('opportunity_graph');
        expect(output.opportunities[0].actors.length).toBe(2);
      }
    });
  });

  describe('Smartest: deduplication', () => {
    test('when opportunity already exists between actors, graph returns no new opportunities', async () => {
      const { graph, compiledGraph, mockDb, mockCompiledHydeGraph, mockEmbedder } =
        createMockGraph({ opportunityExistsBetweenActors: true });
      spyOn(mockCompiledHydeGraph, 'invoke').mockResolvedValue({
        hydeEmbeddings: { mirror: dummyEmbedding, reciprocal: dummyEmbedding },
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'profile' as const,
          id: 'user-bob',
          userId: 'user-bob',
          score: 0.95,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([]);

      const result = await runScenario(
        defineScenario({
          name: 'opportunity-deduplication',
          description:
            'When DB reports an opportunity already exists between source and candidate, deduplicate node filters them out; final opportunities are empty.',
          fixtures: {
            sourceProfileContext: 'Rust developer seeking mentor.',
            sourceUserId: 'user-source' as Id<'users'>,
            sourceText: 'Find Rust mentors',
            indexScope: ['idx-1'] as Id<'indexes'>[],
          },
          sut: {
            type: 'graph',
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as {
                sourceProfileContext: string;
                sourceUserId: string;
                sourceText: string;
                indexScope: string[];
              };
              return await (instance as ReturnType<OpportunityGraph['compile']>).invoke({
                sourceProfileContext: input.sourceProfileContext,
                sourceUserId: input.sourceUserId as Id<'users'>,
                sourceText: input.sourceText,
                indexScope: input.indexScope as Id<'indexes'>[],
                candidates: [],
                options: { hydeDescription: input.sourceText },
                opportunities: [],
              });
            },
            input: {
              sourceProfileContext: '@fixtures.sourceProfileContext',
              sourceUserId: '@fixtures.sourceUserId',
              sourceText: '@fixtures.sourceText',
              indexScope: '@fixtures.indexScope',
            },
          },
          verification: {
            schema: opportunityGraphOutputSchema,
            criteria:
              'opportunities array must be empty (deduplication removed the candidate). candidates may be empty after deduplicate node.',
            llmVerify: false,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as OpportunityGraphState;
      expect(output.opportunities.length).toBe(0);
      expect(output.candidates.length).toBe(0);
    });
  });

  describe('Smartest: resolve source profile', () => {
    test('when sourceProfileContext is empty but sourceUserId given, graph resolves profile from DB and produces opportunities', async () => {
      const resolvedProfile = {
        identity: { name: 'Resolved User', bio: 'AI Engineer' },
        attributes: { skills: ['Python', 'LangChain'] },
        narrative: { context: 'Building agents.' },
      };
      const { graph, compiledGraph, mockDb } = createMockGraph({
        getProfile: resolvedProfile as Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>,
      });
      const getProfileSpy = spyOn(mockDb, 'getProfile').mockResolvedValue(
        resolvedProfile as Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>
      );
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([
        {
          sourceId: 'user-source-resolved',
          candidateId: 'user-bob',
          score: 88,
          sourceDescription: 'Good match.',
          candidateDescription: 'Relevant.',
          valencyRole: 'Agent',
        },
      ]);

      const result = await runScenario(
        defineScenario({
          name: 'opportunity-resolve-profile',
          description:
            'Empty sourceProfileContext with sourceUserId: graph resolves profile from DB, then evaluates candidates and persists opportunities.',
          fixtures: {
            sourceUserId: 'user-source-resolved' as Id<'users'>,
            candidates: defaultCandidates,
          },
          sut: {
            type: 'graph',
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as { sourceUserId: string; candidates: CandidateProfile[] };
              return await (instance as ReturnType<OpportunityGraph['compile']>).invoke({
                sourceProfileContext: '',
                sourceUserId: input.sourceUserId as Id<'users'>,
                candidates: input.candidates,
                indexScope: [],
                options: { minScore: 50 },
                opportunities: [],
              });
            },
            input: {
              sourceUserId: '@fixtures.sourceUserId',
              candidates: '@fixtures.candidates',
            },
          },
          verification: {
            schema: opportunityGraphOutputSchema,
            criteria:
              'sourceProfileContext must be non-empty (resolved from DB). opportunities must have at least one item with two actors.',
            llmVerify: false,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as OpportunityGraphState;
      expect(getProfileSpy).toHaveBeenCalledWith('user-source-resolved');
      expect(output.sourceProfileContext).toContain('Resolved User');
      expect(output.sourceProfileContext).toContain('AI Engineer');
      expect(output.opportunities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Smartest: early exit when no sourceText and no indexScope', () => {
    test('graph ends without invoking HyDE or search when sourceText and indexScope are missing', async () => {
      const { compiledGraph, mockCompiledHydeGraph, mockEmbedder } = createMockGraph();
      const hydeSpy = spyOn(mockCompiledHydeGraph, 'invoke');
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings');

      const result = await runScenario(
        defineScenario({
          name: 'opportunity-early-exit',
          description:
            'No sourceText and no indexScope: graph exits after resolve_source_profile without calling HyDE or search.',
          fixtures: {
            sourceUserId: 'user-source' as Id<'users'>,
            sourceProfileContext: 'Some profile',
          },
          sut: {
            type: 'graph',
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as { sourceUserId: string; sourceProfileContext: string };
              return await (instance as ReturnType<OpportunityGraph['compile']>).invoke({
                sourceProfileContext: input.sourceProfileContext,
                sourceUserId: input.sourceUserId as Id<'users'>,
                sourceText: undefined,
                indexScope: [],
                candidates: [],
                options: {},
                opportunities: [],
              });
            },
            input: {
              sourceUserId: '@fixtures.sourceUserId',
              sourceProfileContext: '@fixtures.sourceProfileContext',
            },
          },
          verification: {
            schema: opportunityGraphOutputSchema,
            criteria: 'opportunities must be empty. No HyDE or search should have been invoked.',
            llmVerify: false,
          },
        })
      );

      expectSmartest(result);
      expect(hydeSpy).not.toHaveBeenCalled();
      expect(searchSpy).not.toHaveBeenCalled();
      const output = result.output as OpportunityGraphState;
      expect(output.opportunities.length).toBe(0);
    });
  });

  describe('Smartest: intent-triggered flow', () => {
    test('when intentId is provided, persisted opportunity has detection.triggeredBy and context.triggeringIntentId', async () => {
      const intentId = 'intent-abc123';
      const { graph, compiledGraph, mockCompiledHydeGraph, mockEmbedder } = createMockGraph();
      spyOn(mockCompiledHydeGraph, 'invoke').mockResolvedValue({
        hydeEmbeddings: { mirror: dummyEmbedding, reciprocal: dummyEmbedding },
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'profile' as const,
          id: 'user-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([
        {
          sourceId: 'user-source',
          candidateId: 'user-bob',
          score: 85,
          sourceDescription: 'Match.',
          candidateDescription: 'Match.',
          valencyRole: 'Agent',
        },
      ]);

      const result = await runScenario(
        defineScenario({
          name: 'opportunity-intent-triggered',
          description:
            'Intent-triggered flow: intentId and sourceText set; output opportunity has detection.triggeredBy and context.triggeringIntentId.',
          fixtures: {
            sourceUserId: 'user-source' as Id<'users'>,
            sourceText: 'Looking for a React developer',
            intentId: intentId as Id<'intents'>,
            indexScope: ['idx-1'] as Id<'indexes'>[],
          },
          sut: {
            type: 'graph',
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as {
                sourceUserId: string;
                sourceText: string;
                intentId: string;
                indexScope: string[];
              };
              return await (instance as ReturnType<OpportunityGraph['compile']>).invoke({
                sourceProfileContext: 'Product lead.',
                sourceUserId: input.sourceUserId as Id<'users'>,
                sourceText: input.sourceText,
                intentId: input.intentId as Id<'intents'> | undefined,
                indexScope: input.indexScope as Id<'indexes'>[],
                candidates: [],
                options: { hydeDescription: input.sourceText },
                opportunities: [],
              });
            },
            input: {
              sourceUserId: '@fixtures.sourceUserId',
              sourceText: '@fixtures.sourceText',
              intentId: '@fixtures.intentId',
              indexScope: '@fixtures.indexScope',
            },
          },
          verification: {
            schema: opportunityGraphOutputSchema,
            criteria:
              'At least one opportunity must have detection.triggeredBy equal to the intent ID and context.triggeringIntentId equal to the intent ID. detection.source must be opportunity_graph.',
            llmVerify: false,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as OpportunityGraphState;
      expect(output.opportunities.length).toBeGreaterThanOrEqual(1);
      expect(output.opportunities[0].detection.source).toBe('opportunity_graph');
      expect(output.opportunities[0].detection.triggeredBy).toBe(intentId);
      expect(output.opportunities[0].context.triggeringIntentId).toBe(intentId);
      expect(output.opportunities[0].actors[0].intents).toEqual([intentId]);
    });
  });

  describe('Smartest: roles derived from strategy', () => {
    test('candidate matched via mirror → source role patient, candidate role agent', async () => {
      const { graph, compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'profile' as const,
          id: 'user-bob',
          userId: 'user-bob',
          score: 0.95,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([
        {
          sourceId: 'user-source',
          candidateId: 'user-bob',
          score: 90,
          sourceDescription: 'Bob can help.',
          candidateDescription: 'You can help source.',
          valencyRole: 'Agent',
        },
      ]);

      const result = (await compiledGraph.invoke({
        sourceProfileContext: 'Seeking mentor.',
        sourceUserId: 'user-source' as Id<'users'>,
        sourceText: 'Find a mentor',
        indexScope: ['idx-1'] as Id<'indexes'>[],
        candidates: [],
        options: { hydeDescription: 'Find a mentor' },
        opportunities: [],
      })) as unknown as OpportunityGraphState;

      expect(result.opportunities.length).toBe(1);
      const [sourceActor, candidateActor] = result.opportunities[0].actors;
      expect(sourceActor.role).toBe('patient');
      expect(candidateActor.role).toBe('agent');
      expect(candidateActor.identityId).toBe('user-bob');
    });

    test('candidate matched via reciprocal → source role agent, candidate role patient', async () => {
      const { graph, compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-xyz',
          userId: 'user-bob',
          score: 0.88,
          matchedVia: 'reciprocal' as const,
          indexId: 'idx-1',
        },
      ]);
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([
        {
          sourceId: 'user-source',
          candidateId: 'user-bob',
          score: 82,
          sourceDescription: 'Bob needs what you offer.',
          candidateDescription: 'Source has what you need.',
          valencyRole: 'Patient',
        },
      ]);

      const result = (await compiledGraph.invoke({
        sourceProfileContext: 'Offering dev services.',
        sourceUserId: 'user-source' as Id<'users'>,
        sourceText: 'Who needs a developer',
        indexScope: ['idx-1'] as Id<'indexes'>[],
        candidates: [],
        options: { hydeDescription: 'Who needs a developer' },
        opportunities: [],
      })) as unknown as OpportunityGraphState;

      expect(result.opportunities.length).toBe(1);
      const [sourceActor, candidateActor] = result.opportunities[0].actors;
      expect(sourceActor.role).toBe('agent');
      expect(candidateActor.role).toBe('patient');
    });

    test('candidate matched via collaborator → both roles peer', async () => {
      const { graph, compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-2',
          userId: 'user-carol',
          score: 0.85,
          matchedVia: 'collaborator' as const,
          indexId: 'idx-1',
        },
      ]);
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([
        {
          sourceId: 'user-source',
          candidateId: 'user-carol',
          score: 80,
          sourceDescription: 'Collaboration fit.',
          candidateDescription: 'Peer collaboration.',
          valencyRole: 'Peer',
        },
      ]);

      const result = (await compiledGraph.invoke({
        sourceProfileContext: 'Looking for co-founder.',
        sourceUserId: 'user-source' as Id<'users'>,
        sourceText: 'Find co-founder',
        indexScope: ['idx-1'] as Id<'indexes'>[],
        candidates: [],
        options: { hydeDescription: 'Find co-founder' },
        opportunities: [],
      })) as unknown as OpportunityGraphState;

      expect(result.opportunities.length).toBe(1);
      const [sourceActor, candidateActor] = result.opportunities[0].actors;
      expect(sourceActor.role).toBe('peer');
      expect(candidateActor.role).toBe('peer');
    });

    test('candidate matched via hiree → source role agent, candidate role patient', async () => {
      const { graph, compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-job',
          userId: 'user-dave',
          score: 0.9,
          matchedVia: 'hiree' as const,
          indexId: 'idx-1',
        },
      ]);
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([
        {
          sourceId: 'user-source',
          candidateId: 'user-dave',
          score: 88,
          sourceDescription: 'Dave is looking for this role.',
          candidateDescription: 'Source is hiring.',
          valencyRole: 'Patient',
        },
      ]);

      const result = (await compiledGraph.invoke({
        sourceProfileContext: 'Hiring a designer.',
        sourceUserId: 'user-source' as Id<'users'>,
        sourceText: 'We are hiring a designer',
        indexScope: ['idx-1'] as Id<'indexes'>[],
        candidates: [],
        options: { hydeDescription: 'We are hiring a designer' },
        opportunities: [],
      })) as unknown as OpportunityGraphState;

      expect(result.opportunities.length).toBe(1);
      const [sourceActor, candidateActor] = result.opportunities[0].actors;
      expect(sourceActor.role).toBe('agent');
      expect(candidateActor.role).toBe('patient');
    });
  });

  describe('Smartest: search returns empty', () => {
    test('when searchWithHydeEmbeddings returns empty, opportunities remain empty', async () => {
      const { graph, compiledGraph, mockCompiledHydeGraph, mockEmbedder } = createMockGraph();
      spyOn(mockCompiledHydeGraph, 'invoke').mockResolvedValue({
        hydeEmbeddings: { mirror: dummyEmbedding, reciprocal: dummyEmbedding },
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([]);

      const result = await runScenario(
        defineScenario({
          name: 'opportunity-search-empty',
          description: 'HyDE runs, search returns no candidates; evaluate and persist produce empty opportunities.',
          fixtures: {
            sourceProfileContext: 'Backend engineer.',
            sourceUserId: 'user-source' as Id<'users'>,
            sourceText: 'Find ML engineers',
            indexScope: ['idx-1'] as Id<'indexes'>[],
          },
          sut: {
            type: 'graph',
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as {
                sourceProfileContext: string;
                sourceUserId: string;
                sourceText: string;
                indexScope: string[];
              };
              return await (instance as ReturnType<OpportunityGraph['compile']>).invoke({
                sourceProfileContext: input.sourceProfileContext,
                sourceUserId: input.sourceUserId as Id<'users'>,
                sourceText: input.sourceText,
                indexScope: input.indexScope as Id<'indexes'>[],
                candidates: [],
                options: { hydeDescription: input.sourceText },
                opportunities: [],
              });
            },
            input: {
              sourceProfileContext: '@fixtures.sourceProfileContext',
              sourceUserId: '@fixtures.sourceUserId',
              sourceText: '@fixtures.sourceText',
              indexScope: '@fixtures.indexScope',
            },
          },
          verification: {
            schema: opportunityGraphOutputSchema,
            criteria: 'opportunities must be empty when no candidates are returned from search.',
            llmVerify: false,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as OpportunityGraphState;
      expect(output.opportunities.length).toBe(0);
      expect(output.candidates.length).toBe(0);
    });
  });

  describe('Smartest: evaluator returns empty', () => {
    test('when evaluator returns no opportunities (all below minScore), persisted opportunities are empty', async () => {
      const { graph, compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'profile' as const,
          id: 'user-bob',
          userId: 'user-bob',
          score: 0.6,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([]);

      const result = (await compiledGraph.invoke({
        sourceProfileContext: 'Rust developer.',
        sourceUserId: 'user-source' as Id<'users'>,
        sourceText: 'Find Rust devs',
        indexScope: ['idx-1'] as Id<'indexes'>[],
        candidates: [],
        options: { hydeDescription: 'Find Rust devs', minScore: 80 },
        opportunities: [],
      })) as unknown as OpportunityGraphState;

      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
      expect(result.opportunities.length).toBe(0);
    });
  });

  describe('Smartest: detection and context shape', () => {
    test('persisted opportunity has detection.source, detection.createdBy, interpretation.signals', async () => {
      const { graph, compiledGraph } = createMockGraph();
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([
        {
          sourceId: 'user-source',
          candidateId: 'user-bob',
          score: 91,
          sourceDescription: 'Strong match.',
          candidateDescription: 'Strong match.',
          valencyRole: 'Agent',
        },
      ]);

      const result = (await compiledGraph.invoke({
        sourceProfileContext: 'Profile.',
        sourceUserId: 'user-source' as Id<'users'>,
        candidates: defaultCandidates,
        indexScope: [],
        options: { minScore: 50 },
        opportunities: [],
      })) as unknown as OpportunityGraphState;

      expect(result.opportunities.length).toBe(1);
      const opp = result.opportunities[0];
      expect(opp.detection.source).toBe('opportunity_graph');
      expect(opp.detection.createdBy).toBe('agent-opportunity-finder');
      expect(opp.detection.timestamp).toBeDefined();
      expect(opp.interpretation.category).toBe('collaboration');
      expect(opp.interpretation.summary).toBe('Strong match.');
      expect(opp.interpretation.confidence).toBeDefined();
      expect(Array.isArray(opp.interpretation.signals)).toBe(true);
      expect(opp.interpretation.signals!.length).toBeGreaterThanOrEqual(1);
      expect(opp.context.indexId).toBeDefined();
      expect(opp.status).toBe('pending');
    });
  });

  describe('Smartest: resolve profile when getProfile returns null', () => {
    test('when getProfile returns null, sourceProfileContext stays empty but graph still runs', async () => {
      const { graph, compiledGraph, mockDb } = createMockGraph();
      spyOn(mockDb, 'getProfile').mockResolvedValue(null);
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([
        {
          sourceId: 'user-source',
          candidateId: 'user-bob',
          score: 70,
          sourceDescription: 'Match.',
          candidateDescription: 'Match.',
          valencyRole: 'Agent',
        },
      ]);

      const result = (await compiledGraph.invoke({
        sourceProfileContext: '',
        sourceUserId: 'user-source' as Id<'users'>,
        candidates: defaultCandidates,
        indexScope: [],
        options: { minScore: 50 },
        opportunities: [],
      })) as unknown as OpportunityGraphState;

      expect(result.sourceProfileContext).toBe('');
      expect(result.opportunities.length).toBe(1);
    });
  });

  describe('Smartest: direct candidates with valencyRole Patient', () => {
    test('when candidates are direct (no matchedVia), roles derived from evaluator valencyRole', async () => {
      const { graph, compiledGraph } = createMockGraph();
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([
        {
          sourceId: 'user-source',
          candidateId: 'user-bob',
          score: 78,
          sourceDescription: 'You can help Bob.',
          candidateDescription: 'Source can help you.',
          valencyRole: 'Patient',
        },
      ]);

      const result = (await compiledGraph.invoke({
        sourceProfileContext: 'Mentor.',
        sourceUserId: 'user-source' as Id<'users'>,
        candidates: defaultCandidates,
        indexScope: [],
        options: { minScore: 70 },
        opportunities: [],
      })) as unknown as OpportunityGraphState;

      expect(result.opportunities.length).toBe(1);
      const [sourceActor, candidateActor] = result.opportunities[0].actors;
      expect(sourceActor.role).toBe('agent');
      expect(candidateActor.role).toBe('patient');
    });
  });

  describe('Smartest: multiple candidates from search, evaluator returns one', () => {
    test('two candidates from search, evaluator returns one opportunity → one persisted', async () => {
      const { graph, compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'profile' as const,
          id: 'user-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
        {
          type: 'profile' as const,
          id: 'user-alice',
          userId: 'user-alice',
          score: 0.75,
          matchedVia: 'reciprocal' as const,
          indexId: 'idx-1',
        },
      ]);
      spyOn(
        (graph as unknown as { evaluatorAgent: { invoke: (a: string, b: CandidateProfile[], c: unknown) => Promise<unknown> } }).evaluatorAgent,
        'invoke'
      ).mockResolvedValue([
        {
          sourceId: 'user-source',
          candidateId: 'user-bob',
          score: 92,
          sourceDescription: 'Bob is the best match.',
          candidateDescription: 'Relevant.',
          valencyRole: 'Agent',
        },
      ]);

      const result = (await compiledGraph.invoke({
        sourceProfileContext: 'Seeking help.',
        sourceUserId: 'user-source' as Id<'users'>,
        sourceText: 'Find experts',
        indexScope: ['idx-1'] as Id<'indexes'>[],
        candidates: [],
        options: { hydeDescription: 'Find experts', minScore: 70 },
        opportunities: [],
      })) as unknown as OpportunityGraphState;

      expect(result.candidates.length).toBe(2);
      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].actors.some((a: OpportunityActor) => a.identityId === 'user-bob')).toBe(true);
    });
  });
});
