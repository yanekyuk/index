/**
 * Opportunity Graph: HyDE-based opportunity detection.
 *
 * Flow: resolve_source_profile → invoke_hyde → search_candidates → deduplicate
 *       → evaluate_candidates → persist_opportunities.
 *
 * Constructor injects Database, Embedder, Cache, and compiled HyDE graph.
 */

import { StateGraph, END, START } from '@langchain/langgraph';
import type { Id } from '../../../../types/common.types';
import { OpportunityGraphState } from './opportunity.state';
import { OpportunityEvaluator, type CandidateProfile } from '../../agents/opportunity/opportunity.evaluator';
import type { OpportunityGraphDatabase } from '../../interfaces/database.interface';
import type { Embedder, HydeCandidate, HydeStrategy } from '../../interfaces/embedder.interface';
import type { HydeCache } from '../../interfaces/cache.interface';
import type { CreateOpportunityData, Opportunity } from '../../interfaces/database.interface';
import { selectStrategies, deriveRolesFromStrategy } from './opportunity.utils';
import { log } from '../../../log';

const logger = log.protocol.from('OpportunityGraph');

/** Intermediate shape produced by evaluate_candidates and consumed by persist_opportunities. */
export interface EvaluatedOpportunityForPersist {
  sourceUserId: string;
  candidateUserId: string;
  indexId: string;
  score: number;
  summary: string;
  sourceRole: string;
  candidateRole: string;
  intentId?: string;
}

/** Compiled HyDE graph (from HydeGraphFactory.createGraph()). */
export type CompiledHydeGraph = ReturnType<
  import('../hyde/hyde.graph').HydeGraphFactory['createGraph']
>;

export interface OpportunityGraphDependencies {
  database: OpportunityGraphDatabase;
  embedder: Embedder;
  cache: HydeCache;
  compiledHydeGraph: CompiledHydeGraph;
}

export class OpportunityGraph {
  private database: OpportunityGraphDatabase;
  private embedder: Embedder;
  private compiledHydeGraph: CompiledHydeGraph;
  private evaluatorAgent: OpportunityEvaluator;

  constructor(
    database: OpportunityGraphDatabase,
    embedder: Embedder,
    _cache: HydeCache,
    compiledHydeGraph: CompiledHydeGraph
  ) {
    this.database = database;
    this.embedder = embedder;
    this.compiledHydeGraph = compiledHydeGraph;
    this.evaluatorAgent = new OpportunityEvaluator();
  }

  /**
   * Compiles the graph into a Runnable.
   */
  public compile() {
    const builder = new StateGraph<OpportunityGraphState>({
      channels: {
        options: { value: (a, b) => b ?? a, default: () => ({}) },
        sourceProfileContext: { value: (a, b) => b ?? a, default: () => '' },
        sourceUserId: { value: (a, b) => b ?? a, default: (): Id<'users'> => '' as Id<'users'> },
        sourceText: { value: (a, b) => b ?? a, default: () => undefined },
        intentId: { value: (a, b) => b ?? a, default: () => undefined },
        indexScope: { value: (a, b) => b ?? a, default: (): Id<'indexes'>[] => [] },
        hydeEmbeddings: { value: (a, b) => (b && Object.keys(b).length) ? b : a, default: () => ({}) },
        candidates: { value: (a, b) => b ?? a, default: () => [] },
        opportunities: { value: (a, b) => b ?? a, default: () => [] },
      },
    })
      .addNode('resolve_source_profile', this.resolveSourceProfileNode.bind(this))
      .addNode('invoke_hyde', this.invokeHydeNode.bind(this))
      .addNode('search_candidates', this.searchCandidatesNode.bind(this))
      .addNode('deduplicate', this.deduplicateNode.bind(this))
      .addNode('evaluate_candidates', this.evaluateCandidatesNode.bind(this))
      .addNode('persist_opportunities', this.persistOpportunitiesNode.bind(this))
      .addEdge(START, 'resolve_source_profile')
      .addConditionalEdges('resolve_source_profile', (state) => {
        const hasCandidates =
          state.candidates && Array.isArray(state.candidates) && state.candidates.length > 0;
        if (hasCandidates) {
          logger.info?.('[OpportunityGraph] Candidates provided directly. Skipping HyDE and search.');
          return 'evaluate_candidates';
        }
        const sourceText = state.sourceText ?? state.options?.hydeDescription;
        if (sourceText && state.indexScope?.length) {
          return 'invoke_hyde';
        }
        logger.warn?.('[OpportunityGraph] No sourceText and no indexScope. Ending.');
        return END;
      })
      .addEdge('invoke_hyde', 'search_candidates')
      .addEdge('search_candidates', 'deduplicate')
      .addEdge('deduplicate', 'evaluate_candidates')
      .addEdge('evaluate_candidates', 'persist_opportunities')
      .addEdge('persist_opportunities', END);

    return builder.compile();
  }

  // ──────────────────────────────────────────────────────────────
  // Node Implementations
  // ──────────────────────────────────────────────────────────────

  private async resolveSourceProfileNode(
    state: OpportunityGraphState
  ): Promise<Partial<OpportunityGraphState>> {
    let { sourceProfileContext, sourceUserId } = state;

    if (!sourceProfileContext && sourceUserId) {
      logger.info?.(`[OpportunityGraph] Resolving source profile for userId: ${sourceUserId}`);
      try {
        const profile = await this.database.getProfile(sourceUserId);
        if (profile) {
          const identity = profile.identity || {};
          const attributes = profile.attributes || {};
          const narrative = profile.narrative || {};
          sourceProfileContext = [
            `Name: ${identity.name ?? 'Unknown'}`,
            `Bio: ${identity.bio ?? ''}`,
            `Location: ${identity.location ?? ''}`,
            `Interests: ${attributes.interests?.join(', ') ?? ''}`,
            `Skills: ${attributes.skills?.join(', ') ?? ''}`,
            `Context: ${narrative.context ?? ''}`,
          ].join('\n');
          logger.info?.('[OpportunityGraph] Source profile resolved.');
        } else {
          logger.warn?.(`[OpportunityGraph] Profile not found for userId: ${sourceUserId}`);
        }
      } catch (error) {
        logger.error?.('[OpportunityGraph] Failed to fetch source profile', { error });
      }
    }

    return { sourceProfileContext };
  }

  private async invokeHydeNode(
    state: OpportunityGraphState
  ): Promise<Partial<OpportunityGraphState>> {
    const sourceText = state.sourceText ?? state.options?.hydeDescription ?? '';
    const sourceType = state.intentId ? ('intent' as const) : ('query' as const);
    const strategies =
      (state.options?.strategies?.length ?? 0) > 0
        ? (state.options!.strategies as HydeStrategy[])
        : selectStrategies(sourceText, {
            indexId: state.indexScope?.[0],
          });

    logger.info?.('[OpportunityGraph] Invoking HyDE', {
      sourceType,
      sourceId: state.intentId,
      strategies,
    });

    const hydeResult = await this.compiledHydeGraph.invoke({
      sourceType,
      sourceId: state.intentId,
      sourceText,
      strategies,
      context: state.indexScope?.[0]
        ? { indexId: state.indexScope[0] }
        : undefined,
      forceRegenerate: false,
    });

    const hydeEmbeddings = (hydeResult?.hydeEmbeddings ?? {}) as Record<string, number[]>;
    logger.info?.('[OpportunityGraph] HyDE complete', {
      strategiesWithEmbeddings: Object.keys(hydeEmbeddings).length,
    });
    return { hydeEmbeddings };
  }

  private async searchCandidatesNode(
    state: OpportunityGraphState
  ): Promise<Partial<OpportunityGraphState>> {
    const { hydeEmbeddings, indexScope, sourceUserId, options } = state;
    if (!hydeEmbeddings || Object.keys(hydeEmbeddings).length === 0) {
      logger.warn?.('[OpportunityGraph] No HyDE embeddings for search.');
      return { candidates: [] };
    }

    const strategies = Object.keys(hydeEmbeddings).filter(
      (s): s is HydeStrategy =>
        ['mirror', 'reciprocal', 'mentor', 'investor', 'collaborator', 'hiree'].includes(s)
    );
    const map = new Map<HydeStrategy, number[]>();
    for (const s of strategies) {
      const emb = hydeEmbeddings[s];
      if (emb?.length) map.set(s, emb);
    }
    if (map.size === 0) {
      return { candidates: [] };
    }

    const scope = indexScope ?? [];
    if (scope.length === 0) {
      logger.warn?.('[OpportunityGraph] No indexScope for search; returning no candidates.');
      return { candidates: [] };
    }

    let candidates: HydeCandidate[];
    try {
      candidates = await this.embedder.searchWithHydeEmbeddings(map, {
        strategies,
        indexScope: scope,
        excludeUserId: sourceUserId,
        limitPerStrategy: options?.limit ?? 10,
        limit: options?.limit ?? 20,
        minScore: 0.5,
      });
    } catch (searchErr) {
      const msg = searchErr instanceof Error ? searchErr.message : String(searchErr);
      logger.error?.('[OpportunityGraph] search_candidates failed', {
        error: searchErr,
        message: msg,
        indexScopeLength: scope.length,
      });
      return { candidates: [] };
    }

    logger.info?.('[OpportunityGraph] Search found', { count: candidates.length });
    return { candidates };
  }

  private async deduplicateNode(
    state: OpportunityGraphState
  ): Promise<Partial<OpportunityGraphState>> {
    const candidates = state.candidates as HydeCandidate[] | undefined;
    if (!candidates?.length) return {};

    const sourceUserId = state.sourceUserId;
    const filtered: HydeCandidate[] = [];

    for (const c of candidates) {
      const actorIds = [sourceUserId, c.userId].sort();
      const exists = await this.database.opportunityExistsBetweenActors(actorIds, c.indexId);
      if (!exists) filtered.push(c);
    }

    const removed = candidates.length - filtered.length;
    if (removed > 0) {
      logger.info?.('[OpportunityGraph] Deduplicate removed', { removed });
    }
    return { candidates: filtered };
  }

  private async evaluateCandidatesNode(
    state: OpportunityGraphState
  ): Promise<Partial<OpportunityGraphState>> {
    const candidates = state.candidates;
    const sourceProfileContext = state.sourceProfileContext ?? '';
    const options = state.options ?? {};

    if (!candidates || (Array.isArray(candidates) && candidates.length === 0)) {
      return { opportunities: [] };
    }

    const isHydeCandidates = Array.isArray(candidates) && candidates.length > 0 && 'matchedVia' in (candidates as HydeCandidate[])[0];
    let profileCandidates: CandidateProfile[];

    if (isHydeCandidates) {
      const hydeList = candidates as HydeCandidate[];
      profileCandidates = await Promise.all(
        hydeList.map(async (c) => {
          const profile = await this.database.getProfile(c.userId);
          const identity = profile?.identity;
          const attributes = profile?.attributes;
          const narrative = profile?.narrative;
          return {
            userId: c.userId,
            identity: identity
              ? { name: identity.name, bio: identity.bio, location: identity.location }
              : undefined,
            attributes,
            narrative,
            score: c.score,
          } as CandidateProfile;
        })
      );
    } else {
      profileCandidates = candidates as CandidateProfile[];
    }

    const minScore = options.minScore ?? 70;
    const evaluatorOpportunities = await this.evaluatorAgent.invoke(
      sourceProfileContext,
      profileCandidates,
      { ...options, minScore }
    );

    const hydeList = Array.isArray(state.candidates) && state.candidates.length > 0 && 'matchedVia' in (state.candidates as HydeCandidate[])[0]
      ? (state.candidates as HydeCandidate[])
      : [];
    const getCandidate = (userId: string) => hydeList.find((c) => c.userId === userId);

    const indexId = state.indexScope?.[0] ?? '';

    const opportunitiesForPersist: EvaluatedOpportunityForPersist[] = evaluatorOpportunities.map(
      (op: {
        sourceId: string;
        candidateId: string;
        score: number;
        sourceDescription?: string;
        candidateDescription?: string;
        valencyRole?: string;
      }) => {
        const candidate = getCandidate(op.candidateId);
        const valency = (op.valencyRole ?? '').toLowerCase();
        let sourceRole: string;
        let candidateRole: string;
        if (candidate?.matchedVia) {
          const derived = deriveRolesFromStrategy(candidate.matchedVia as HydeStrategy);
          sourceRole = derived.sourceRole;
          candidateRole = derived.candidateRole;
        } else {
          sourceRole = valency === 'agent' ? 'patient' : valency === 'patient' ? 'agent' : 'peer';
          candidateRole = valency === 'agent' ? 'agent' : valency === 'patient' ? 'patient' : 'peer';
        }
        return {
          sourceUserId: op.sourceId,
          candidateUserId: op.candidateId,
          indexId: candidate?.indexId ?? indexId,
          score: op.score,
          summary: op.sourceDescription ?? op.candidateDescription ?? '',
          sourceRole,
          candidateRole,
          intentId: state.intentId,
        };
      }
    );

    return {
      candidates: profileCandidates,
      opportunities: opportunitiesForPersist as unknown as Opportunity[],
    };
  }

  private async persistOpportunitiesNode(
    state: OpportunityGraphState
  ): Promise<Partial<OpportunityGraphState>> {
    const toPersist = state.opportunities as unknown as EvaluatedOpportunityForPersist[];
    if (!toPersist?.length) return { opportunities: state.opportunities };

    const persisted: Opportunity[] = [];
    const now = new Date().toISOString();

    for (const p of toPersist) {
      const data: CreateOpportunityData = {
        detection: {
          source: 'opportunity_graph',
          createdBy: 'agent-opportunity-finder',
          triggeredBy: p.intentId,
          timestamp: now,
        },
        actors: [
          {
            role: p.sourceRole,
            identityId: p.sourceUserId,
            intents: p.intentId ? [p.intentId] : [],
            profile: true,
          },
          {
            role: p.candidateRole,
            identityId: p.candidateUserId,
            intents: [],
            profile: true,
          },
        ],
        interpretation: {
          category: 'collaboration',
          summary: p.summary,
          confidence: p.score / 100,
          signals: [{ type: 'intent_match', weight: p.score / 100, detail: p.summary }],
        },
        context: {
          indexId: p.indexId,
          triggeringIntentId: p.intentId,
        },
        indexId: p.indexId,
        confidence: String(p.score / 100),
        status: 'pending',
      };
      const created = await this.database.createOpportunity(data);
      persisted.push(created);
    }

    logger.info?.('[OpportunityGraph] Persisted opportunities', { count: persisted.length });
    return { opportunities: persisted };
  }
}
