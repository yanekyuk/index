/**
 * Opportunity Graph: tests for the refactored linear workflow.
 * Flow: Prep → Scope → Discovery → Evaluation → Ranking → Persist.
 * Invoke API: { userId, searchQuery?, indexId?, options }.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, spyOn } from 'bun:test';
import { OpportunityGraphFactory, type OpportunityEvaluatorLike } from '../opportunity.graph';
import type { Id } from '../../../../types/common.types';
import type {
  OpportunityGraphDatabase,
  OpportunityActor,
} from '../../interfaces/database.interface';
import type { Embedder } from '../../interfaces/embedder.interface';
import type { EvaluatedOpportunityWithActors } from '../../agents/opportunity.evaluator';

type OpportunityGraphInvokeInput = Parameters<ReturnType<OpportunityGraphFactory['createGraph']>['invoke']>[0];
type OpportunityGraphInvokeResult = Awaited<ReturnType<ReturnType<OpportunityGraphFactory['createGraph']>['invoke']>>;

const dummyEmbedding = new Array(2000).fill(0.1);

const defaultMockEvaluatorResult: EvaluatedOpportunityWithActors[] = [
  {
    reasoning: 'The source user is building a DeFi protocol and the candidate has relevant community and marketing expertise in the crypto space.',
    score: 88,
    actors: [
      { userId: 'user-source', role: 'patient' as const, intentId: null },
      { userId: 'user-bob', role: 'agent' as const, intentId: null },
    ],
  },
];

function createMockEvaluator(
  result: EvaluatedOpportunityWithActors[] = defaultMockEvaluatorResult
): OpportunityEvaluatorLike {
  return {
    invokeEntityBundle: async () => result,
  };
}

function createMockGraph(deps?: {
  getUserIndexIds?: () => Promise<Id<'indexes'>[]>;
  getActiveIntents?: () => Promise<Array<{ id: Id<'intents'>; payload: string; summary: string | null; createdAt: Date }>>;
  getIndex?: (id: string) => Promise<{ id: string; title: string } | null>;
  getIndexMemberCount?: (id: string) => Promise<number>;
  getProfile?: Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>;
  evaluatorResult?: EvaluatedOpportunityWithActors[];
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
        confidence: data.confidence,
        status: data.status ?? 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      }),
    opportunityExistsBetweenActors: () => Promise.resolve(false),
    findOverlappingOpportunities: () => Promise.resolve([]),
    getUserIndexIds: deps?.getUserIndexIds ?? (() => Promise.resolve(['idx-1'] as Id<'indexes'>[])),
    getActiveIntents:
      deps?.getActiveIntents ??
      (() =>
        Promise.resolve([
          {
            id: 'intent-1' as Id<'intents'>,
            payload: 'Looking for a technical co-founder',
            summary: 'Co-founder',
            createdAt: new Date(),
          },
        ])),
    getIndex: deps?.getIndex ?? (() => Promise.resolve({ id: 'idx-1', title: 'Test Index' })),
    getIndexMemberCount: deps?.getIndexMemberCount ?? (() => Promise.resolve(2)),
    getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com' }),
    isIndexMember: () => Promise.resolve(true),
    getOpportunity: () => Promise.resolve(null),
    getOpportunitiesForUser: () => Promise.resolve([]),
    updateOpportunityStatus: () => Promise.resolve(null),
    getIntent: () => Promise.resolve(null),
  };

  const mockEmbedder: Embedder = {
    generate: () => Promise.resolve(dummyEmbedding),
    search: () => Promise.resolve([]),
    searchWithHydeEmbeddings: () =>
      Promise.resolve([
        {
          type: 'intent' as const,
          id: 'intent-bob' as Id<'intents'>,
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]),
  } as unknown as Embedder;

  const mockHydeGenerator = {
    invoke: () =>
      Promise.resolve({
        hydeEmbeddings: {
          mirror: dummyEmbedding,
          reciprocal: dummyEmbedding,
        },
      }),
  };

  const evaluator = createMockEvaluator(deps?.evaluatorResult ?? defaultMockEvaluatorResult);
  const factory = new OpportunityGraphFactory(mockDb, mockEmbedder, mockHydeGenerator, evaluator);
  const compiledGraph = factory.createGraph();
  return { compiledGraph, mockDb, mockEmbedder, mockHydeGenerator };
}

describe('Opportunity Graph', () => {
  describe('Prep node', () => {
    test('when user has no index memberships, returns error and no opportunities', async () => {
      const { compiledGraph, mockHydeGenerator, mockEmbedder } = createMockGraph({
        getUserIndexIds: () => Promise.resolve([]),
      });
      const hydeSpy = spyOn(mockHydeGenerator, 'invoke');
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings');

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find a co-founder',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.error).toBeDefined();
      expect(result.error).toContain('join');
      expect(result.opportunities).toEqual([]);
      expect(hydeSpy).not.toHaveBeenCalled();
      expect(searchSpy).not.toHaveBeenCalled();
    });

    test('when user has no active intents, returns error and early exit', async () => {
      const { compiledGraph, mockHydeGenerator, mockEmbedder } = createMockGraph({
        getActiveIntents: () => Promise.resolve([]),
      });
      const hydeSpy = spyOn(mockHydeGenerator, 'invoke');
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings');

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find a co-founder',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.error).toBeDefined();
      expect(result.error).toContain('intents');
      expect(result.opportunities).toEqual([]);
      expect(hydeSpy).not.toHaveBeenCalled();
      expect(searchSpy).not.toHaveBeenCalled();
    });
  });

  describe('Scope node', () => {
    test('when indexId provided and user is member, targetIndexes contains only that index', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'indexes'>[]),
      });
      const getIndexSpy = spyOn(mockDb, 'getIndex');

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find mentor',
        indexId: 'idx-1' as Id<'indexes'>,
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(getIndexSpy).toHaveBeenCalledWith('idx-1');
    });

    test('when indexId omitted, scope uses all user indexes', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'indexes'>[]),
      });
      const getIndexSpy = spyOn(mockDb, 'getIndex');

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find mentor',
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput);

      expect(getIndexSpy).toHaveBeenCalledWith('idx-1');
      expect(getIndexSpy).toHaveBeenCalledWith('idx-2');
    });
  });

  describe('Discovery node', () => {
    test('performs vector search with index scope and excludeUserId', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'user-bob',
          score: 0.92,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find a React developer',
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(searchSpy).toHaveBeenCalled();
      const call = searchSpy.mock.calls[0];
      expect(call?.[1]?.indexScope).toContain('idx-1');
      expect(call?.[1]?.excludeUserId).toBe('user-source');
      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    });

    test('when search returns only profile type (no intent), profile candidates are included', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
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

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find mentor',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // Profile-only candidates are now valid (no candidateIntentId)
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].candidateUserId).toBe('user-bob');
      expect(result.candidates[0].candidateIntentId).toBeUndefined();
    });
  });

  describe('Evaluation and Persist', () => {
    test('when discovery returns intent candidates and evaluator returns one, opportunity is created', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].detection.source).toBe('opportunity_graph');
      expect(result.opportunities[0].actors.length).toBe(2);
      expect(result.opportunities[0].actors.some((a: OpportunityActor) => a.userId === 'user-bob')).toBe(true);
    });
  });

  describe('Ranking node', () => {
    test('sorts by score and applies limit', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          { reasoning: 'Technical help match.', score: 85, actors: [{ userId: 'user-source', role: 'patient', intentId: null }, { userId: 'user-bob', role: 'agent', intentId: null }] },
          { reasoning: 'Complementary interests in developer tools.', score: 92, actors: [{ userId: 'user-source', role: 'peer', intentId: null }, { userId: 'user-alice', role: 'peer', intentId: null }] },
        ],
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'user-bob', score: 0.8, matchedVia: 'mirror' as const, indexId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-alice', userId: 'user-alice', score: 0.9, matchedVia: 'reciprocal' as const, indexId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find partners',
        options: { limit: 1, minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].actors.some((a: OpportunityActor) => a.userId === 'user-alice')).toBe(true);
    });
  });

  describe('Persist node: initialStatus', () => {
    test('when options.initialStatus is "latent", opportunities are created with status latent', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find mentor',
        options: { initialStatus: 'latent', minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].status).toBe('latent');
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'latent' }));
    });

    test('when options.initialStatus is omitted, createOpportunity is called with status pending', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find mentor',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    });

    test('when evaluator assigns discoverer as agent (no introducer), persist swaps discoverer to patient', async () => {
      // Evaluator thinks the discoverer (user-source) is the agent (provider) and
      // the candidate (user-bob) is the patient (seeker). The lifecycle guard in the
      // persist node should swap them so the discoverer always sees first at latent.
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Source can offer mentoring to candidate.',
            score: 85,
            actors: [
              { userId: 'user-source', role: 'agent' as const, intentId: null },
              { userId: 'user-bob', role: 'patient' as const, intentId: null },
            ],
          },
        ],
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find mentee',
        options: { initialStatus: 'latent', minScore: 70 },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalled();
      const createdData = createSpy.mock.calls[0][0];
      const discovererActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'user-source');
      const counterpartActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'user-bob');
      // Discoverer should have been swapped from agent → patient
      expect(discovererActor?.role).toBe('patient');
      // Counterpart should have been swapped from patient → agent
      expect(counterpartActor?.role).toBe('agent');
    });

    test('when evaluator assigns discoverer as patient, no swap occurs', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Source needs mentoring from candidate.',
            score: 85,
            actors: [
              { userId: 'user-source', role: 'patient' as const, intentId: null },
              { userId: 'user-bob', role: 'agent' as const, intentId: null },
            ],
          },
        ],
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find mentor',
        options: { initialStatus: 'latent', minScore: 70 },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalled();
      const createdData = createSpy.mock.calls[0][0];
      const discovererActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'user-source');
      const counterpartActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'user-bob');
      // No swap — discoverer stays patient, counterpart stays agent
      expect(discovererActor?.role).toBe('patient');
      expect(counterpartActor?.role).toBe('agent');
    });

    test('when evaluator assigns both as peers, no swap occurs', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Symmetric collaboration match.',
            score: 90,
            actors: [
              { userId: 'user-source', role: 'peer' as const, intentId: null },
              { userId: 'user-bob', role: 'peer' as const, intentId: null },
            ],
          },
        ],
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'collaborator' as const,
          indexId: 'idx-1',
        },
      ]);

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find collaborator',
        options: { initialStatus: 'latent', minScore: 70 },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalled();
      const createdData = createSpy.mock.calls[0][0];
      const discovererActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'user-source');
      const counterpartActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'user-bob');
      // Both stay peer — no swap needed
      expect(discovererActor?.role).toBe('peer');
      expect(counterpartActor?.role).toBe('peer');
    });
  });

  describe('Conditional routing: early exit', () => {
    test('when no index memberships, full invoke does not call HyDE or search or createOpportunity', async () => {
      const { compiledGraph, mockDb, mockHydeGenerator, mockEmbedder } = createMockGraph({
        getUserIndexIds: () => Promise.resolve([]),
      });
      const hydeSpy = spyOn(mockHydeGenerator, 'invoke');
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings');
      const createSpy = spyOn(mockDb, 'createOpportunity');

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find someone',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(hydeSpy).not.toHaveBeenCalled();
      expect(searchSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    test('when no active intents, full invoke does not call HyDE or search or createOpportunity', async () => {
      const { compiledGraph, mockDb, mockHydeGenerator, mockEmbedder } = createMockGraph({
        getActiveIntents: () => Promise.resolve([]),
      });
      const hydeSpy = spyOn(mockHydeGenerator, 'invoke');
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings');
      const createSpy = spyOn(mockDb, 'createOpportunity');

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find someone',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(hydeSpy).not.toHaveBeenCalled();
      expect(searchSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('Full flow with new API', () => {
    test('invoke with userId, searchQuery, options returns opportunities with correct shape', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find a technical co-founder',
        options: { initialStatus: 'latent', limit: 5, minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities).toBeDefined();
      expect(Array.isArray(result.opportunities)).toBe(true);
      if (result.opportunities.length > 0) {
        const opp = result.opportunities[0];
        expect(opp.detection.source).toBe('opportunity_graph');
        expect(opp.detection.createdBy).toBe('agent-opportunity-finder');
        expect(opp.interpretation.reasoning).toBeDefined();
        // context.indexId is set only when user explicitly scoped search; actor tokens carry discovery indexId
        expect(opp.actors.length).toBeGreaterThanOrEqual(1);
        expect(opp.actors[0].indexId).toBeDefined();
        expect(opp.actors[0].userId).toBeDefined();
        expect(opp.status).toBe('latent');
      }
    });

    test('when search returns empty, opportunities remain empty', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find unicorns',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities).toEqual([]);
      expect(result.candidates).toEqual([]);
    });

    test('when evaluator returns empty (below minScore), opportunities remain empty', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [],
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'user-bob',
          score: 0.6,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'Find mentor',
        options: { minScore: 80 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
      expect(result.opportunities).toEqual([]);
    });
  });
});
