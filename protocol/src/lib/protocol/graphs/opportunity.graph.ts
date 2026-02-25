/**
 * Opportunity Graph: Linear Multi-Step Workflow for Opportunity Discovery
 *
 * Architecture: Follows intent graph pattern with Annotation-based state.
 * Flow: Prep → Scope → Discovery → Evaluation → Ranking → Persist → END
 *
 * Key Constraints:
 * - Opportunities only between intents sharing the same index
 * - Both intents must have hyde documents for semantic matching
 * - Non-indexed intents cannot participate in discovery
 *
 * Constructor injects Database, Embedder, and compiled HyDE graph.
 */

import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import type { Id } from '../../../types/common.types';
import {
  OpportunityGraphState,
  type IndexedIntent,
  type TargetIndex,
  type CandidateMatch,
  type EvaluatedCandidate,
  type EvaluatedOpportunity,
  type EvaluatedOpportunityActor,
} from '../states/opportunity.state';
import {
  OpportunityEvaluator,
  type CandidateProfile,
  type EvaluatorEntity,
  type EvaluatorInput,
} from '../agents/opportunity.evaluator';
import type { OpportunityGraphDatabase } from '../interfaces/database.interface';
import { validateOpportunityActors } from '../support/opportunity.utils';

/** Optional evaluator for testing (avoids LLM calls). */
export type OpportunityEvaluatorLike = {
  invoke?: (
    sourceProfileContext: string,
    candidates: CandidateProfile[],
    options: { minScore?: number }
  ) => Promise<Array<{
    sourceId: string;
    candidateId: string;
    score: number;
    reasoning: string;
    valencyRole: 'Agent' | 'Patient' | 'Peer';
  }>>;
  invokeEntityBundle?: (input: EvaluatorInput, options: { minScore?: number }) => Promise<Array<{
    reasoning: string;
    score: number;
    actors: Array<{ userId: string; role: 'agent' | 'patient' | 'peer'; intentId?: string | null }>;
  }>>;
};
import type { Embedder, HydeStrategy } from '../interfaces/embedder.interface';
import type {
  CreateOpportunityData,
  Opportunity,
  OpportunityActor,
  ActiveIntent,
} from '../interfaces/database.interface';
import { selectStrategies } from '../support/opportunity.utils';
import { persistOpportunities } from '../support/opportunity.persist';
import { protocolLogger, withCallLogging } from '../support/protocol.logger';
import { timed } from '../../performance';

const logger = protocolLogger('OpportunityGraph');

/** Input shape for the HyDE generator invoke call (query-based embedding). */
export interface HydeGeneratorInvokeInput {
  sourceType: 'query';
  sourceText: string;
  strategies: HydeStrategy[];
  context?: { indexId: string };
  forceRegenerate?: boolean;
}

/** Optional notifier for opportunity send; when omitted, the real queue is used via dynamic import. */
export type QueueOpportunityNotificationFn = (
  opportunityId: string,
  recipientId: string,
  priority: 'immediate' | 'high' | 'low'
) => Promise<unknown>;

/**
 * Factory class to build and compile the Opportunity Graph.
 * Uses dependency injection for testability.
 */
export class OpportunityGraphFactory {
  constructor(
    private database: OpportunityGraphDatabase,
    private embedder: Embedder,
    private hydeGenerator: {
      invoke: (input: HydeGeneratorInvokeInput) => Promise<{ hydeEmbeddings: Record<string, number[]> }>;
    },
    private optionalEvaluator?: OpportunityEvaluatorLike,
    private queueNotification?: QueueOpportunityNotificationFn
  ) {}

  public createGraph() {
    const evaluatorAgent = this.optionalEvaluator ?? new OpportunityEvaluator();

    // ═══════════════════════════════════════════════════════════════
    // NODE DEFINITIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Node 0: Prep
     * Fetches user's index memberships and validates requirements.
     * Returns empty if user has no index memberships (requirement).
     */
    const prepNode = async (state: typeof OpportunityGraphState.State) =>
      timed("OpportunityGraph.prep", async () =>
        withCallLogging(
          logger,
          '[Graph:Prep] prepNode',
          {
            userId: state.userId,
            hasSearchQuery: !!state.searchQuery,
            requestedIndexId: state.indexId ?? undefined,
          },
          async () => {
            const userIndexIds = await this.database.getUserIndexIds(state.userId);
            if (userIndexIds.length === 0) {
              logger.info('[Graph:Prep] User has no index memberships - cannot find opportunities');
              return {
                userIndexes: [] as Id<'indexes'>[],
                sourceProfile: null,
                error: 'You need to join at least one index to find opportunities.',
              };
            }
            const [intents, profile] = await Promise.all([
              this.database.getActiveIntents(state.userId),
              this.database.getProfile(state.userId),
            ]);
            const indexedIntents: IndexedIntent[] = intents.map((intent: ActiveIntent) => ({
              intentId: intent.id,
              payload: intent.payload,
              summary: intent.summary ?? undefined,
              indexes: [],
            }));
            const sourceProfile = profile
              ? {
                  embedding: profile.embedding ?? null,
                  identity: profile.identity ?? undefined,
                  narrative: profile.narrative ?? undefined,
                  attributes: profile.attributes ?? undefined,
                }
              : null;
            return {
              userIndexes: userIndexIds,
              indexedIntents,
              sourceProfile,
            };
          },
          { context: { userId: state.userId }, logOutput: true }
        ).catch((error) => {
          logger.error('[Graph:Prep] Failed', { error });
          return {
            error: 'Failed to prepare opportunity search. Please try again.',
          };
        })
      );

    /**
     * Node 1: Scope
     * Determines which indexes to search within.
     * If indexId provided: searches only that index.
     * Otherwise: searches all user's indexes.
     */
    const scopeNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.scope", async () => {
        logger.info('[Graph:Scope] Determining search scope', {
          requestedIndexId: state.indexId,
          userIndexesCount: state.userIndexes.length,
        });

        try {
          let targetIndexIds: Id<'indexes'>[];

          if (state.indexId) {
            // Validate user is member of requested index
            if (!state.userIndexes.includes(state.indexId)) {
              logger.warn('[Graph:Scope] User not member of requested index', {
                indexId: state.indexId,
              });
              return {
                targetIndexes: [],
                error: 'You are not a member of that index.',
              };
            }
            targetIndexIds = [state.indexId];
          } else {
            // Search all user's indexes
            targetIndexIds = state.userIndexes;
          }

          // Fetch index details
          const targetIndexes: TargetIndex[] = await Promise.all(
            targetIndexIds.map(async (indexId) => {
              const index = await this.database.getIndex(indexId);
              const memberCount = await this.database.getIndexMemberCount(indexId);
              return {
                indexId,
                title: index?.title ?? 'Unknown',
                memberCount,
              };
            })
          );

          logger.info('[Graph:Scope] Scope determined', {
            targetIndexesCount: targetIndexes.length,
            indexes: targetIndexes.map(i => i.title),
          });
          return { targetIndexes };
        } catch (error) {
          logger.error('[Graph:Scope] Failed', { error });
          return {
            targetIndexes: [],
            error: 'Failed to determine search scope.',
          };
        }
      });
    };

    /**
     * Node 2: Resolve
     * Resolves trigger intent from triggerIntentId or searchQuery vs indexedIntents;
     * sets discoverySource, resolvedTriggerIntentId, resolvedIntentInIndex for routing (path A/B/C).
     */
    const resolveNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.resolve", async () => {
        logger.info('[Graph:Resolve] Resolving intent and index membership', {
          triggerIntentId: state.triggerIntentId,
          hasSearchQuery: !!state.searchQuery,
          indexedIntentsCount: state.indexedIntents.length,
        });

        const targetIndexIds = state.targetIndexes.map((t) => t.indexId);

        try {
          let resolvedIntentId: Id<'intents'> | undefined;
          if (state.triggerIntentId) {
            const inIndex = await this.database.getIndexIdsForIntent(state.triggerIntentId);
            const inTarget = inIndex.some((id) => targetIndexIds.includes(id as Id<'indexes'>));
            resolvedIntentId = state.triggerIntentId;
            const resolvedIntentInIndex = inTarget;
            const discoverySource = resolvedIntentInIndex ? ('intent' as const) : ('profile' as const);
            return {
              resolvedTriggerIntentId: resolvedIntentId,
              resolvedIntentInIndex,
              discoverySource,
            };
          }

          if (state.searchQuery?.trim() && state.indexedIntents.length > 0) {
            const q = state.searchQuery.trim().toLowerCase();
            const matched = state.indexedIntents.find((i) => i.payload?.toLowerCase().includes(q));
            if (matched) {
              resolvedIntentId = matched.intentId;
              const inIndex = await this.database.getIndexIdsForIntent(matched.intentId);
              const resolvedIntentInIndex = inIndex.some((id) => targetIndexIds.includes(id as Id<'indexes'>));
              const discoverySource = resolvedIntentInIndex ? ('intent' as const) : ('profile' as const);
              return {
                resolvedTriggerIntentId: resolvedIntentId,
                resolvedIntentInIndex,
                discoverySource,
              };
            }
            logger.warn('[Graph:Resolve] No intent matched search query; leaving resolvedIntentId unset', {
              searchQuery: state.searchQuery,
              indexedIntentsCount: state.indexedIntents.length,
            });
          }

          return {
            resolvedTriggerIntentId: undefined,
            resolvedIntentInIndex: false,
            discoverySource: 'profile' as const,
          };
        } catch (err) {
          logger.error('[Graph:Resolve] Failed', {
            triggerIntentId: state.triggerIntentId,
            searchQuery: state.searchQuery,
            error: err,
          });
          return {
            resolvedTriggerIntentId: undefined,
            resolvedIntentInIndex: false,
            discoverySource: 'profile' as const,
            error: err instanceof Error ? err.message : 'Resolve failed',
          };
        }
      });
    };

    /**
     * Node 3: Discovery
     * Generates HyDE embeddings and performs semantic search (path A), or profile-as-source search (path B/C).
     */
    const discoveryNode = async (state: typeof OpportunityGraphState.State) => {
      const self = this;
      return timed("OpportunityGraph.discovery", async () => {
        logger.info('[Graph:Discovery] Starting semantic search', {
          targetIndexesCount: state.targetIndexes.length,
          discoverySource: state.discoverySource,
          searchQueryPreview: state.searchQuery?.trim().slice(0, 60) ?? '(none)',
        });

        try {
          if (state.targetIndexes.length === 0) {
            logger.warn('[Graph:Discovery] No target indexes for search');
            return { candidates: [] };
          }

          const limitPerStrategy = state.options.limit ?? 10;
          const perIndexLimit = state.options.limit ?? 20;
          const minScore = 0.5;

          if (state.discoverySource === 'profile') {
            const embedding = state.sourceProfile?.embedding ?? null;
            const vector = Array.isArray(embedding) && embedding.length > 0 && typeof embedding[0] === 'number'
              ? (embedding as number[])
              : Array.isArray(embedding) && Array.isArray(embedding[0])
                ? (embedding[0] as number[])
                : null;
            // When no viewer profile embedding but we have a search query, run query-based HyDE so e.g. "visual artists" finds people via profile HyDE
            if (!vector || vector.length === 0) {
              if (state.searchQuery?.trim()) {
                logger.info('[Graph:Discovery] Profile source, no vector, has searchQuery → running query HyDE path', {
                  searchQuery: state.searchQuery.trim().substring(0, 80),
                });
                const queryCandidates = await runQueryHydeDiscovery();
                logger.info('[Graph:Discovery] Query HyDE path complete', { candidatesFound: queryCandidates.length });
                return { candidates: queryCandidates };
              }
              return { candidates: [] };
            }
            const allCandidates: CandidateMatch[] = [];
            for (const targetIndex of state.targetIndexes) {
              const results = await this.embedder.searchWithProfileEmbedding(vector, {
                indexScope: [targetIndex.indexId],
                excludeUserId: state.userId,
                limitPerStrategy,
                limit: perIndexLimit,
                minScore,
              });
              for (const result of results) {
                if (result.type === 'intent') {
                  allCandidates.push({
                    candidateUserId: result.userId as Id<'users'>,
                    candidateIntentId: result.id as Id<'intents'>,
                    indexId: targetIndex.indexId,
                    similarity: result.score,
                    strategy: result.matchedVia as HydeStrategy,
                    candidatePayload: '',
                    candidateSummary: undefined,
                  });
                } else {
                  allCandidates.push({
                    candidateUserId: result.userId as Id<'users'>,
                    indexId: targetIndex.indexId,
                    similarity: result.score,
                    strategy: result.matchedVia as HydeStrategy,
                    candidatePayload: '',
                    candidateSummary: undefined,
                  });
                }
              }
            }
            const byUserAndIndex = new Map<string, CandidateMatch>();
            for (const c of allCandidates) {
              const key = `${c.candidateUserId}:${c.indexId}`;
              if (!byUserAndIndex.has(key) || (byUserAndIndex.get(key)?.candidateIntentId == null && c.candidateIntentId != null)) {
                byUserAndIndex.set(key, c);
              }
            }
            const candidates = Array.from(byUserAndIndex.values());
            const isPathB = !state.resolvedTriggerIntentId;
            if (candidates.length === 0 && isPathB && state.searchQuery?.trim()) {
              const queryCandidates = await runQueryHydeDiscovery();
              logger.info('[Graph:Discovery] Profile search returned 0, query HyDE fallback complete', { candidatesFound: queryCandidates.length });
              return { candidates: queryCandidates };
            }
            logger.info('[Graph:Discovery] Profile-as-source discovery complete', { candidatesFound: candidates.length });
            return { candidates };
          }

          async function runQueryHydeDiscovery(): Promise<CandidateMatch[]> {
            const searchText = state.searchQuery?.trim() ?? '';
            if (!searchText) return [];
            const strategies = state.options.strategies ?? selectStrategies(searchText, {
              indexId: state.targetIndexes[0] ? state.targetIndexes[0].indexId : undefined,
            });
            logger.info('[Graph:Discovery] runQueryHydeDiscovery start', { searchText: searchText.slice(0, 80), strategies });
            const hydeResult = await self.hydeGenerator.invoke({
              sourceType: 'query',
              sourceText: searchText,
              strategies,
              context: state.targetIndexes[0] ? { indexId: state.targetIndexes[0].indexId } : undefined,
              forceRegenerate: false,
            });
            const hydeEmbeddings = hydeResult.hydeEmbeddings as Record<string, number[]>;
            const embeddingKeys = hydeEmbeddings ? Object.keys(hydeEmbeddings) : [];
            logger.info('[Graph:Discovery] HyDE generator result', {
              strategyCount: embeddingKeys.length,
              strategies: embeddingKeys,
              hasMirror: embeddingKeys.includes('mirror'),
              hasReciprocal: embeddingKeys.includes('reciprocal'),
            });
            if (!hydeEmbeddings || Object.keys(hydeEmbeddings).length === 0) return [];
            const embeddingsMap = new Map<HydeStrategy, number[]>();
            for (const [strategy, emb] of Object.entries(hydeEmbeddings)) {
              if (emb?.length) embeddingsMap.set(strategy as HydeStrategy, emb);
            }
            const all: CandidateMatch[] = [];
            await Promise.all(
              state.targetIndexes.map(async (targetIndex) => {
                const results = await self.embedder.searchWithHydeEmbeddings(embeddingsMap, {
                  strategies,
                  indexScope: [targetIndex.indexId],
                  excludeUserId: state.userId,
                  limitPerStrategy,
                  limit: perIndexLimit,
                  minScore: 0.5,
                });
                for (const r of results.filter((x) => x.type === 'intent')) {
                  all.push({
                    candidateUserId: r.userId as Id<'users'>,
                    candidateIntentId: r.id as Id<'intents'>,
                    indexId: targetIndex.indexId,
                    similarity: r.score,
                    strategy: r.matchedVia as HydeStrategy,
                    candidatePayload: '',
                    candidateSummary: undefined,
                  });
                }
                for (const r of results.filter((x) => x.type === 'profile')) {
                  all.push({
                    candidateUserId: r.userId as Id<'users'>,
                    indexId: targetIndex.indexId,
                    similarity: r.score,
                    strategy: r.matchedVia as HydeStrategy,
                    candidatePayload: '',
                    candidateSummary: undefined,
                  });
                }
              })
            );
            const profileCount = all.filter((c) => !c.candidateIntentId).length;
            const intentCount = all.filter((c) => c.candidateIntentId).length;
            logger.info('[Graph:Discovery] searchWithHydeEmbeddings raw results', {
              total: all.length,
              fromProfile: profileCount,
              fromIntent: intentCount,
            });
            const byKey = new Map<string, CandidateMatch>();
            for (const c of all) {
              const key = `${c.candidateUserId}:${c.indexId}`;
              if (!byKey.has(key) || (byKey.get(key)?.candidateIntentId == null && c.candidateIntentId != null)) {
                byKey.set(key, c);
              }
            }
            return Array.from(byKey.values());
          }

          const resolvedIntent = state.resolvedTriggerIntentId
            ? state.indexedIntents.find((i) => i.intentId === state.resolvedTriggerIntentId)
            : state.indexedIntents[0];
          const searchText = state.searchQuery ?? resolvedIntent?.payload ?? '';
          if (!searchText) {
            logger.warn('[Graph:Discovery] No search text available for intent path');
            return { candidates: [] };
          }

          const strategies = state.options.strategies ?? selectStrategies(searchText, {
            indexId: state.targetIndexes[0].indexId,
          });
          const hydeResult = await this.hydeGenerator.invoke({
            sourceType: 'query',
            sourceText: searchText,
            strategies,
            context: state.targetIndexes[0] ? { indexId: state.targetIndexes[0].indexId } : undefined,
            forceRegenerate: false,
          });
          const hydeEmbeddings = hydeResult.hydeEmbeddings as Record<string, number[]>;
          if (!hydeEmbeddings || Object.keys(hydeEmbeddings).length === 0) {
            return { hydeEmbeddings: {} as Record<HydeStrategy, number[]>, candidates: [] };
          }
          const embeddingsMap = new Map<HydeStrategy, number[]>();
          for (const [strategy, embedding] of Object.entries(hydeEmbeddings)) {
            if (embedding?.length) {
              embeddingsMap.set(strategy as HydeStrategy, embedding);
            }
          }
          const allCandidates: CandidateMatch[] = [];
          await Promise.all(
            state.targetIndexes.map(async (targetIndex) => {
              const results = await this.embedder.searchWithHydeEmbeddings(embeddingsMap, {
                strategies,
                indexScope: [targetIndex.indexId],
                excludeUserId: state.userId,
                limitPerStrategy,
                limit: perIndexLimit,
                minScore: 0.5,
              });
              for (const result of results.filter((r) => r.type === 'intent')) {
                allCandidates.push({
                  candidateUserId: result.userId as Id<'users'>,
                  candidateIntentId: result.id as Id<'intents'>,
                  indexId: targetIndex.indexId,
                  similarity: result.score,
                  strategy: result.matchedVia as HydeStrategy,
                  candidatePayload: '',
                  candidateSummary: undefined,
                });
              }
              for (const result of results.filter((r) => r.type === 'profile')) {
                allCandidates.push({
                  candidateUserId: result.userId as Id<'users'>,
                  indexId: targetIndex.indexId,
                  similarity: result.score,
                  strategy: result.matchedVia as HydeStrategy,
                  candidatePayload: '',
                  candidateSummary: undefined,
                });
              }
            })
          );
          const byUserAndIndex = new Map<string, CandidateMatch>();
          for (const c of allCandidates) {
            const key = `${c.candidateUserId}:${c.indexId}`;
            if (!byUserAndIndex.has(key) || (byUserAndIndex.get(key)?.candidateIntentId == null && c.candidateIntentId != null)) {
              byUserAndIndex.set(key, c);
            }
          }
          const candidates = Array.from(byUserAndIndex.values());
          logger.info('[Graph:Discovery] Intent-path discovery complete', { candidatesFound: candidates.length });
          return {
            hydeEmbeddings: hydeEmbeddings as Record<HydeStrategy, number[]>,
            candidates,
          };
        } catch (error) {
          logger.error('[Graph:Discovery] Failed', { error });
          return {
            candidates: [],
            error: 'Failed to search for candidates.',
          };
        }
      });
    };

    /**
     * Node 3: Evaluation (Entity bundle)
     * Builds entity bundle from source + candidates, invokes entity-bundle evaluator, maps to EvaluatedOpportunity with indexId from entities.
     */
    const evaluationNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.evaluation", async () => {
        logger.info('[Graph:Evaluation] Starting evaluation', {
          candidatesCount: state.candidates.length,
        });

        if (state.candidates.length === 0) {
          logger.info('[Graph:Evaluation] No candidates to evaluate');
          return { evaluatedOpportunities: [] };
        }

        try {
          const sourceProfile = await this.database.getProfile(state.userId);
          const sourceIndexId = state.targetIndexes[0]?.indexId ?? state.userIndexes[0];
          const sourceEntity: EvaluatorEntity = {
            userId: state.userId,
            profile: {
              name: sourceProfile?.identity?.name,
              bio: sourceProfile?.identity?.bio,
              location: sourceProfile?.identity?.location,
              interests: sourceProfile?.attributes?.interests,
              skills: sourceProfile?.attributes?.skills,
              context: sourceProfile?.narrative?.context,
            },
            intents: state.indexedIntents.slice(0, 5).map((i) => ({
              intentId: i.intentId,
              payload: i.payload,
              summary: i.summary,
            })),
            indexId: sourceIndexId ?? ('' as Id<'indexes'>),
            ragScore: undefined,
            matchedVia: undefined,
          };

          const candidateEntities: EvaluatorEntity[] = await Promise.all(
            state.candidates.map(async (c) => {
              const profile = await this.database.getProfile(c.candidateUserId);
              let intentPayload = c.candidatePayload;
              let intentSummary = c.candidateSummary;
              if (c.candidateIntentId != null && (!intentPayload || intentPayload === '')) {
                const intent = await this.database.getIntent(c.candidateIntentId);
                if (intent) {
                  intentPayload = intent.payload;
                  intentSummary = intent.summary ?? undefined;
                }
              }
              return {
                userId: c.candidateUserId,
                profile: {
                  name: profile?.identity?.name,
                  bio: profile?.identity?.bio,
                  location: profile?.identity?.location,
                  interests: profile?.attributes?.interests,
                  skills: profile?.attributes?.skills,
                  context: profile?.narrative?.context,
                },
                intents:
                  c.candidateIntentId != null
                    ? [{ intentId: c.candidateIntentId, payload: intentPayload ?? '', summary: intentSummary }]
                    : undefined,
                indexId: c.indexId,
                ragScore: c.similarity * 100,
                matchedVia: c.strategy,
              };
            })
          );

          const entities: EvaluatorEntity[] = [sourceEntity, ...candidateEntities];
          const userIdToIndexId = new Map<string, Id<'indexes'>>();
          for (const e of entities) {
            if (!userIdToIndexId.has(e.userId)) userIdToIndexId.set(e.userId, e.indexId as Id<'indexes'>);
          }

          const input: EvaluatorInput = {
            discovererId: state.userId,
            entities,
            existingOpportunities: state.options.existingOpportunities,
            ...(state.searchQuery?.trim() ? { discoveryQuery: state.searchQuery.trim() } : {}),
          };

          const minScore = state.options.minScore ?? 70;
          const opportunitiesWithActors =
            typeof (evaluatorAgent as OpportunityEvaluator).invokeEntityBundle === 'function'
              ? await (evaluatorAgent as OpportunityEvaluator).invokeEntityBundle(input, { minScore })
              : await (async () => {
                  const realEvaluator = new OpportunityEvaluator();
                  return realEvaluator.invokeEntityBundle(input, { minScore });
                })();

          // Split multi-actor evaluator results into pairwise (viewer + candidate).
          // Each persisted discovery opportunity should have exactly 2 actors.
          const pairwiseOpportunities: typeof opportunitiesWithActors = [];
          for (const op of opportunitiesWithActors) {
            const nonViewerActors = op.actors.filter(a => a.userId !== state.userId);
            if (nonViewerActors.length <= 1) {
              pairwiseOpportunities.push(op);
            } else {
              const viewerActor = op.actors.find(a => a.userId === state.userId);
              for (const candidate of nonViewerActors) {
                pairwiseOpportunities.push({
                  reasoning: op.reasoning,
                  score: op.score,
                  actors: [
                    viewerActor ?? { userId: state.userId, role: 'patient' as const, intentId: null },
                    candidate,
                  ],
                });
              }
            }
          }

          const evaluatedOpportunities: EvaluatedOpportunity[] = pairwiseOpportunities.map((op) => ({
            reasoning: op.reasoning,
            score: op.score,
            actors: op.actors.map((a) => ({
              userId: a.userId as Id<'users'>,
              role: a.role,
              intentId: a.intentId as Id<'intents'> | undefined,
              indexId: userIdToIndexId.get(a.userId) ?? (entities.find((e) => e.userId === a.userId)?.indexId as Id<'indexes'>),
            })),
          }));

          logger.info('[Graph:Evaluation] Evaluation complete', {
            evaluatedCount: evaluatedOpportunities.length,
            passed: evaluatedOpportunities.filter((o) => o.score >= minScore).length,
          });
          return { evaluatedOpportunities };
        } catch (error) {
          logger.error('[Graph:Evaluation] Failed', { error });
          return {
            evaluatedOpportunities: [],
            error: 'Failed to evaluate candidates.',
          };
        }
      });
    };

    /**
     * Node 4: Ranking
     * Sorts evaluated opportunities by score, applies limit, dedupes by actor-set hash.
     */
    const rankingNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.ranking", async () => {
        logger.info('[Graph:Ranking] Starting ranking', {
          evaluatedCount: state.evaluatedOpportunities.length,
        });

        try {
          const sorted = [...state.evaluatedOpportunities].sort((a, b) => b.score - a.score);
          const limit = state.options.limit ?? 10;
          const ranked = sorted.slice(0, limit);

          const actorSetKey = (opp: EvaluatedOpportunity) =>
            opp.actors
              .map((a) => `${a.userId}:${a.indexId}`)
              .sort()
              .join('|');
          const seen = new Set<string>();
          const deduplicated = ranked.filter((opp) => {
            const key = actorSetKey(opp);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          logger.info('[Graph:Ranking] Ranking complete', {
            sorted: sorted.length,
            afterLimit: ranked.length,
            afterDedup: deduplicated.length,
          });
          return { evaluatedOpportunities: deduplicated };
        } catch (error) {
          logger.error('[Graph:Ranking] Failed', { error });
          return { error: 'Failed to rank opportunities.' };
        }
      });
    };

    /**
     * Node: intro_validation (create_introduction path)
     * Validates index scope, membership for introducer and all party users, and no existing opportunity.
     */
    const introValidationNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.introValidation", async () => {
        logger.info('[Graph:IntroValidation] Starting', {
          userId: state.userId,
          indexId: state.indexId,
          entitiesCount: state.introductionEntities?.length ?? 0,
        });

        try {
          const entities = state.introductionEntities ?? [];
          const primaryIndexId = (state.indexId ?? entities[0]?.indexId) as Id<'indexes'> | undefined;
          const partyUserIds = [...new Set(entities.map((e) => e.userId).filter((id) => id !== state.userId))];

          if (!primaryIndexId || partyUserIds.length < 1) {
            return {
              error: 'Introduction requires indexId and at least two entities (introducer + one counterpart).',
            };
          }

          if (state.requiredIndexId && primaryIndexId !== state.requiredIndexId) {
            return {
              error: 'This chat is scoped to a different community. You can only introduce members of the current community.',
            };
          }

          const introducerIsMember = await this.database.isIndexMember(primaryIndexId, state.userId);
          if (!introducerIsMember) {
            return {
              error: 'One or more users are not members of the specified community. You can only introduce members who share an index.',
            };
          }
          const partyMemberships = await Promise.all(
            partyUserIds.map((userId) => this.database.isIndexMember(primaryIndexId, userId))
          );
          const allPartyMembers = partyMemberships.every(Boolean);
          if (!allPartyMembers) {
            return {
              error: 'One or more users are not members of the specified community. You can only introduce members who share an index.',
            };
          }

          const exists = await this.database.opportunityExistsBetweenActors(partyUserIds, primaryIndexId);
          if (exists) {
            return { error: 'An opportunity already exists between these people.' };
          }

          logger.info('[Graph:IntroValidation] Validation passed');
          return {};
        } catch (err) {
          logger.error('[Graph:IntroValidation] Failed', {
            userId: state.userId,
            indexId: state.indexId,
            error: err,
          });
          return {
            error: err instanceof Error ? err.message : 'Introduction validation failed.',
          };
        }
      });
    };

    /**
     * Build fallback reasoning and actors when evaluator returns empty or throws.
     */
    function buildIntroFallback(
      entities: EvaluatorEntity[],
      state: typeof OpportunityGraphState.State,
      primaryIndexId: Id<'indexes'>,
      introducerName?: string
    ): { reasoning: string; score: number; actors: EvaluatedOpportunityActor[] } {
      const reasoning =
        `${introducerName ?? 'A member'} believes these people should connect.` +
        (state.introductionHint ? ` Context: ${state.introductionHint}` : '');
      const score = 70;
      const partyUserIds = entities.map((e) => e.userId).filter((id) => id !== state.userId);
      const actors: EvaluatedOpportunityActor[] = partyUserIds.map((uid) => ({
        userId: uid as Id<'users'>,
        role: 'peer' as const,
        indexId: primaryIndexId,
      }));
      return { reasoning, score, actors };
    }

    /**
     * Node: intro_evaluation (create_introduction path)
     * Runs entity-bundle evaluator and sets evaluatedOpportunities (one) + introductionContext.
     */
    const introEvaluationNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.introEvaluation", async () => {
        logger.info('[Graph:IntroEvaluation] Starting', { userId: state.userId });

        if (state.error) {
          return { evaluatedOpportunities: [] };
        }

        const entities = state.introductionEntities ?? [];
        const primaryIndexId = (state.indexId ?? entities[0]?.indexId) as Id<'indexes'> | undefined;
        if (!primaryIndexId || entities.length < 2) {
          return { evaluatedOpportunities: [], error: 'Missing entities or index for introduction.' };
        }

        let introducerName: string | undefined;
        let reasoning: string;
        let score: number;
        let actors: EvaluatedOpportunityActor[] = [];

        try {
          const introducerUser = await this.database.getUser(state.userId);
          introducerName = introducerUser?.name ?? undefined;
          const input: EvaluatorInput = {
            discovererId: state.userId,
            entities,
            introductionMode: true,
            introducerName,
            introductionHint: state.introductionHint ?? undefined,
          };

          const evaluated = await (evaluatorAgent as OpportunityEvaluator).invokeEntityBundle(input, { minScore: 0 });
          if (evaluated.length > 0) {
            const best = evaluated[0];
            reasoning = best.reasoning;
            score = best.score;
            actors = best.actors.map((a) => ({
              userId: a.userId as Id<'users'>,
              role: a.role,
              intentId: a.intentId ?? undefined,
              indexId: primaryIndexId,
            }));
          } else {
            const fallback = buildIntroFallback(entities, state, primaryIndexId, introducerName);
            reasoning = fallback.reasoning;
            score = fallback.score;
            actors = fallback.actors;
          }
        } catch (evalErr) {
          logger.warn('[Graph:IntroEvaluation] Evaluator or getUser failed, using fallback', { error: evalErr });
          const fallback = buildIntroFallback(entities, state, primaryIndexId, introducerName);
          reasoning = fallback.reasoning;
          score = fallback.score;
          actors = fallback.actors;
        }

        const evaluatedOpportunity: EvaluatedOpportunity = {
          actors,
          score,
          reasoning,
        };

        return {
          evaluatedOpportunities: [evaluatedOpportunity],
          introductionContext: { createdByName: introducerName },
          options: { ...state.options, initialStatus: state.options.initialStatus ?? 'latent' },
        };
      });
    };

    /**
     * Node 5: Persist
     * Creates opportunities from evaluator-proposed actors (indexId, userId, role, optional intent).
     */
    const persistNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.persist", async () => {
        logger.info('[Graph:Persist] Starting persistence (dedup-v2)', {
          opportunitiesToCreate: state.evaluatedOpportunities.length,
          initialStatus: state.options.initialStatus ?? 'pending',
        });

        if (state.evaluatedOpportunities.length === 0) {
          logger.info('[Graph:Persist] No opportunities to persist');
          return { opportunities: [] };
        }

        try {
          const itemsToPersist: CreateOpportunityData[] = [];
          const reactivatedOpportunities: Opportunity[] = [];
          const existingBetweenActors: Array<{
            candidateUserId: Id<'users'>;
            indexId: Id<'indexes'>;
            existingOpportunityId?: Id<'opportunities'>;
            existingStatus?: string;
          }> = [];
          const now = new Date().toISOString();
          const initialStatus = state.options.initialStatus ?? 'pending';
          const DEDUP_SKIP_STATUSES: Array<'draft' | 'latent'> = ['draft', 'latent'];

          for (const evaluated of state.evaluatedOpportunities) {
            const indexIdForActors = state.indexId ?? evaluated.actors[0]?.indexId;
            let actors: OpportunityActor[];
            let data: CreateOpportunityData;

            logger.info('[Graph:Persist:PathSelect]', {
              isIntroduction: !!state.introductionContext,
              stateUserId: state.userId,
              stateIndexId: state.indexId,
              evaluatedActorUserIds: evaluated.actors.map(a => a.userId),
            });

            if (state.introductionContext) {
              if (indexIdForActors === undefined) {
                logger.warn('[Graph:Persist] Introduction path missing indexId; skipping opportunity', {
                  userId: state.userId,
                  actorsCount: evaluated.actors.length,
                });
                continue;
              }
              // Introduction path: manual detection, introducer actor, curator_judgment signal.
              const evaluatorActors: OpportunityActor[] = evaluated.actors.map((a: EvaluatedOpportunityActor) => ({
                indexId: a.indexId ?? indexIdForActors,
                userId: a.userId,
                role: a.role,
                ...(a.intentId ? { intent: a.intentId } : {}),
              }));
              const viewerAlreadyInActors = evaluatorActors.some(a => a.userId === state.userId);
              actors = viewerAlreadyInActors
                ? evaluatorActors
                : [
                    ...evaluatorActors,
                    { indexId: indexIdForActors, userId: state.userId, role: 'introducer' as const },
                  ];
              data = {
                detection: {
                  source: 'manual',
                  createdBy: state.userId,
                  createdByName: state.introductionContext.createdByName,
                  timestamp: now,
                },
                actors,
                interpretation: {
                  category: 'collaboration',
                  reasoning: evaluated.reasoning,
                  confidence: evaluated.score / 100,
                  signals: [
                    {
                      type: 'curator_judgment',
                      weight: 1,
                      detail: `Introduction by ${state.introductionContext.createdByName ?? 'a member'} via chat`,
                    },
                  ],
                },
                context: {
                  indexId: state.indexId ?? indexIdForActors,
                  ...(state.options.conversationId ? { conversationId: state.options.conversationId } : {}),
                },
                confidence: String(evaluated.score / 100),
                status: initialStatus,
              };
            } else {
              // Discovery path: opportunity_graph source, no introducer, lifecycle guard for agent/patient.
              const evaluatorActors: OpportunityActor[] = evaluated.actors.map((a: EvaluatedOpportunityActor) => ({
                indexId: a.indexId ?? indexIdForActors,
                userId: a.userId,
                role: a.role,
                ...(a.intentId ? { intent: a.intentId } : {}),
              }));
              actors = evaluatorActors;

              const hasIntroducerActor = actors.some(a => a.role === 'introducer');
              if (!hasIntroducerActor) {
                const discovererIdx = actors.findIndex(a => a.userId === state.userId);
                if (discovererIdx >= 0 && actors[discovererIdx].role === 'agent') {
                  const counterpartIdx = actors.findIndex(
                    (a, i) => i !== discovererIdx && a.role === 'patient'
                  );
                  actors[discovererIdx] = { ...actors[discovererIdx], role: 'patient' };
                  if (counterpartIdx >= 0) {
                    actors[counterpartIdx] = { ...actors[counterpartIdx], role: 'agent' };
                  }
                  logger.info('[Graph:Persist] Swapped discoverer from agent to patient for lifecycle visibility', {
                    discovererId: state.userId,
                  });
                }
              }

              // Index-agnostic dedup: find ANY existing opportunity between these users,
              // regardless of which index it was created in or whether context.indexId is set.
              const candidateUserId = evaluated.actors.find((a) => a.userId !== state.userId)?.userId;
              logger.info('[Graph:Persist:Dedup] Checking overlapping opportunities', {
                stateUserId: state.userId,
                candidateUserId: candidateUserId ?? 'NONE',
                evaluatedActors: evaluated.actors.map(a => ({ userId: a.userId, role: a.role })),
              });
              const overlapping = candidateUserId
                ? await this.database.findOverlappingOpportunities(
                    [state.userId as Id<'users'>, candidateUserId as Id<'users'>],
                    { excludeStatuses: DEDUP_SKIP_STATUSES },
                  )
                : [];
              logger.info('[Graph:Persist:Dedup] findOverlappingOpportunities result', {
                count: overlapping.length,
                results: overlapping.map(o => ({ id: o.id, status: o.status, actors: o.actors?.map((a: OpportunityActor) => ({ userId: a.userId, role: a.role })) })),
              });

              if (overlapping.length > 0) {
                const existing = overlapping[0];
                const existingIndexId = (existing.context?.indexId ?? state.indexId ?? state.userIndexes?.[0] ?? '') as Id<'indexes'>;

                if (existing.status === 'expired') {
                  const reactivated = await this.database.updateOpportunityStatus(existing.id, 'draft');
                  if (reactivated) {
                    logger.info('[Graph:Persist] Reactivated expired opportunity as draft', {
                      opportunityId: existing.id,
                      candidateUserId,
                    });
                    reactivatedOpportunities.push(reactivated);
                  }
                } else if (candidateUserId) {
                  existingBetweenActors.push({
                    candidateUserId: candidateUserId as Id<'users'>,
                    indexId: existingIndexId,
                    existingOpportunityId: existing.id as Id<'opportunities'>,
                    existingStatus: existing.status,
                  });
                  logger.info('[Graph:Persist] Skipping duplicate; opportunity already exists between actors', {
                    candidateUserId,
                    existingStatus: existing.status,
                    existingOpportunityId: existing.id,
                  });
                }
                continue;
              }

              data = {
                detection: {
                  source: 'opportunity_graph',
                  createdBy: 'agent-opportunity-finder',
                  ...(state.discoverySource === 'intent' && state.resolvedTriggerIntentId
                    ? { triggeredBy: state.resolvedTriggerIntentId }
                    : {}),
                  timestamp: now,
                },
                actors,
                interpretation: {
                  category: 'collaboration',
                  reasoning: evaluated.reasoning,
                  confidence: evaluated.score / 100,
                  signals: [
                    {
                      type: evaluated.actors.some((a) => a.intentId) ? 'intent_match' : 'profile_match',
                      weight: evaluated.score / 100,
                      detail: 'Entity-bundle evaluator',
                    },
                  ],
                },
                context: {
                  ...(state.indexId ? { indexId: state.indexId } : {}),
                  ...(state.options.conversationId ? { conversationId: state.options.conversationId } : {}),
                },
                confidence: String(evaluated.score / 100),
                status: initialStatus,
              };
            }

            try {
              validateOpportunityActors(data.actors);
            } catch (err) {
              logger.warn('[Graph:Persist] Skipping opportunity with invalid actors', {
                error: err instanceof Error ? err.message : String(err),
                opportunityReasoning: evaluated.reasoning?.slice(0, 80),
              });
              continue;
            }

            itemsToPersist.push(data);
          }

          const { created: createdList } = await persistOpportunities({
            database: this.database,
            embedder: this.embedder,
            items: itemsToPersist,
          });

          const allOpportunities = [...reactivatedOpportunities, ...createdList];

          logger.info('[Graph:Persist] Persistence complete', {
            created: createdList.length,
            reactivated: reactivatedOpportunities.length,
            existingBetweenActorsCount: existingBetweenActors.length,
            status: initialStatus,
          });
          return { opportunities: allOpportunities, existingBetweenActors };
        } catch (error) {
          logger.error('[Graph:Persist] Failed', { error });
          return {
            opportunities: [],
            existingBetweenActors: [],
            error: 'Failed to persist opportunities.',
          };
        }
      });
    };

    // ═══════════════════════════════════════════════════════════════
    // CRUD NODES (read, update, delete, send)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Read Node: List opportunities for the user, optionally filtered by indexId.
     * Fast path — no LLM calls.
     */
    const readNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.read", async () => {
        logger.info('[Graph:Read] Listing opportunities', {
          userId: state.userId,
          indexId: state.indexId,
        });

        try {
          let indexIdFilter: string | undefined;
          if (state.indexId) {
            const isMember = await this.database.isIndexMember(state.indexId, state.userId);
            if (!isMember) {
              return {
                readResult: { count: 0, opportunities: [], message: 'Index not found or you are not a member.' },
              };
            }
            indexIdFilter = state.indexId;
          }

          const rawList = await this.database.getOpportunitiesForUser(state.userId, {
            limit: 30,
            ...(indexIdFilter ? { indexId: indexIdFilter } : {}),
          });
          const list = rawList.filter((opp) => opp.status !== 'expired');

          if (list.length === 0) {
            return {
              readResult: {
                count: 0,
                message: 'You have no opportunities yet. Use create_opportunities to search for connections.',
                opportunities: [],
              },
            };
          }

          // Dedupe by counterpart set (same people = one row) so chat does not show "You and X" per index
          const counterpartKey = (opp: (typeof list)[number]) =>
            opp.actors
              .filter((a: OpportunityActor) => a.userId !== state.userId && a.role !== 'introducer')
              .map((a: OpportunityActor) => a.userId)
              .sort()
              .join(',');
          const byKey = new Map<string, (typeof list)[number]>();
          for (const opp of list) {
            const key = counterpartKey(opp);
            const existing = byKey.get(key);
            const conf = Number(opp.interpretation?.confidence ?? opp.confidence ?? 0);
            const existingConf = existing ? Number(existing.interpretation?.confidence ?? existing.confidence ?? 0) : 0;
            const oppTime = opp.updatedAt instanceof Date ? opp.updatedAt.getTime() : new Date(opp.updatedAt).getTime();
            const existingTime = existing
              ? (existing.updatedAt instanceof Date ? existing.updatedAt.getTime() : new Date(existing.updatedAt).getTime())
              : 0;
            if (!existing || conf > existingConf || (conf === existingConf && oppTime > existingTime)) {
              byKey.set(key, opp);
            }
          }
          const dedupedList = [...byKey.values()];

          const sourceLabel: Record<string, string> = {
            chat: 'Suggested in chat',
            opportunity_graph: 'System match',
            manual: 'Manual',
            cron: 'Scheduled',
            member_added: 'Member added',
          };

          const enriched = await Promise.all(
            dedupedList.map(async (opp) => {
              // "Other parties" = all actors who are not the current user (exclude introducer for suggestedBy).
              // Opportunity graph persists roles as 'agent'|'patient'|'peer'; manual/createManual use 'party'.
              const otherParties = opp.actors.filter((a: OpportunityActor) => a.userId !== state.userId && a.role !== 'introducer');
              const introducer = opp.actors.find((a: OpportunityActor) => a.role === 'introducer');
              const partyIds = otherParties.map((a: OpportunityActor) => a.userId);
              const idsToResolve = introducer ? [...partyIds, introducer.userId] : partyIds;
              const actorIndexId = opp.actors[0]?.indexId;
              const [indexRecord, ...profileAndUserPairs] = await Promise.all([
                actorIndexId ? this.database.getIndex(actorIndexId) : Promise.resolve(null),
                ...idsToResolve.map(async (uid: string) => {
                  const [profile, user] = await Promise.all([
                    this.database.getProfile(uid),
                    this.database.getUser(uid),
                  ]);
                  return (profile?.identity?.name ?? user?.name ?? 'Unknown') as string;
                }),
              ]);
              const connectedWith = profileAndUserPairs.slice(0, partyIds.length);
              const suggestedBy = introducer ? profileAndUserPairs[partyIds.length] ?? null : null;
              const category = opp.interpretation?.category ?? 'connection';
              const confidence = opp.interpretation?.confidence ?? (opp.confidence ? Number(opp.confidence) : null);
              const source = opp.detection?.source ? (sourceLabel[opp.detection.source] ?? opp.detection.source) : null;
              return {
                id: opp.id,
                indexName: indexRecord?.title ?? (actorIndexId ?? ''),
                connectedWith,
                suggestedBy,
                reasoning: opp.interpretation?.reasoning ?? 'Connection opportunity',
                status: opp.status,
                category,
                confidence: confidence != null ? confidence : null,
                source,
              };
            })
          );

          return {
            readResult: {
              count: enriched.length,
              message: `You have ${enriched.length} opportunity(ies).`,
              opportunities: enriched,
            },
          };
        } catch (err) {
          logger.error('[Graph:Read] Failed', { error: err });
          return {
            readResult: { count: 0, opportunities: [], message: 'Failed to list opportunities.' },
          };
        }
      });
    };

    /**
     * Update Node: Change opportunity status (accept, reject, etc.).
     */
    const updateNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.update", async () => {
        logger.info('[Graph:Update] Updating opportunity status', {
          userId: state.userId,
          opportunityId: state.opportunityId,
          newStatus: state.newStatus,
        });

        try {
          if (!state.opportunityId) {
            return { mutationResult: { success: false, error: 'opportunityId is required.' } };
          }
          if (!state.newStatus || !['accepted', 'rejected', 'expired'].includes(state.newStatus)) {
            return { mutationResult: { success: false, error: 'newStatus must be one of: accepted, rejected, expired.' } };
          }

          const opp = await this.database.getOpportunity(state.opportunityId);
          if (!opp) {
            return { mutationResult: { success: false, error: 'Opportunity not found.' } };
          }
          const isActor = opp.actors.some((a: OpportunityActor) => a.userId === state.userId);
          if (!isActor) {
            return { mutationResult: { success: false, error: 'You are not part of this opportunity.' } };
          }

          await this.database.updateOpportunityStatus(
            state.opportunityId,
            state.newStatus as 'accepted' | 'rejected' | 'expired'
          );

          return {
            mutationResult: {
              success: true,
              opportunityId: state.opportunityId,
              message: `Opportunity status updated to ${state.newStatus}.`,
            },
          };
        } catch (err) {
          logger.error('[Graph:Update] Failed', { error: err });
          return { mutationResult: { success: false, error: 'Failed to update opportunity.' } };
        }
      });
    };

    /**
     * Delete Node: Expire/archive an opportunity.
     */
    const deleteNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.delete", async () => {
        logger.info('[Graph:Delete] Expiring opportunity', {
          userId: state.userId,
          opportunityId: state.opportunityId,
        });

        try {
          if (!state.opportunityId) {
            return { mutationResult: { success: false, error: 'opportunityId is required.' } };
          }

          const opp = await this.database.getOpportunity(state.opportunityId);
          if (!opp) {
            return { mutationResult: { success: false, error: 'Opportunity not found.' } };
          }
          const isActor = opp.actors.some((a: OpportunityActor) => a.userId === state.userId);
          if (!isActor) {
            return { mutationResult: { success: false, error: 'You are not part of this opportunity.' } };
          }

          await this.database.updateOpportunityStatus(state.opportunityId, 'expired');

          return {
            mutationResult: {
              success: true,
              opportunityId: state.opportunityId,
              message: 'Opportunity archived (expired).',
            },
          };
        } catch (err) {
          logger.error('[Graph:Delete] Failed', { error: err });
          return { mutationResult: { success: false, error: 'Failed to delete opportunity.' } };
        }
      });
    };

    /**
     * Send Node: Promote latent or draft opportunity to pending + queue notification.
     */
    const sendNode = async (state: typeof OpportunityGraphState.State) => {
      return timed("OpportunityGraph.send", async () => {
        logger.info('[Graph:Send] Sending opportunity', {
          userId: state.userId,
          opportunityId: state.opportunityId,
        });

        try {
          if (!state.opportunityId) {
            return { mutationResult: { success: false, error: 'opportunityId is required.' } };
          }

          const opp = await this.database.getOpportunity(state.opportunityId);
          if (!opp) {
            return { mutationResult: { success: false, error: 'Opportunity not found.' } };
          }
          const canSendStatus = opp.status === 'latent' || opp.status === 'draft';
          if (!canSendStatus) {
            return {
              mutationResult: {
                success: false,
                error: `Opportunity is already ${opp.status}; only latent or draft opportunities can be sent.`,
              },
            };
          }
          const senderActor = opp.actors.find((a: OpportunityActor) => a.userId === state.userId);
          const hasIntroducer = opp.actors.some((a: OpportunityActor) => a.role === 'introducer');
          const canSend =
            senderActor?.role === 'introducer' ||
            senderActor?.role === 'peer' ||
            (senderActor?.role === 'patient' && !hasIntroducer) ||
            (senderActor?.role === 'party' && !hasIntroducer);
          if (!senderActor) {
            return { mutationResult: { success: false, error: 'You are not part of this opportunity.' } };
          }
          if (!canSend) {
            return { mutationResult: { success: false, error: 'You cannot send this opportunity.' } };
          }

          await this.database.updateOpportunityStatus(state.opportunityId, 'pending');

          // Notify only the role that becomes visible at the next tier
          let recipients: OpportunityActor[];
          if (senderActor.role === 'introducer') {
            recipients = opp.actors.filter((a: OpportunityActor) => a.role === 'patient' || a.role === 'party');
          } else if (senderActor.role === 'peer') {
            recipients = opp.actors.filter((a: OpportunityActor) => a.role === 'peer' && a.userId !== state.userId);
          } else {
            recipients = opp.actors.filter((a: OpportunityActor) => a.role === 'agent');
          }

          const notifier: QueueOpportunityNotificationFn | undefined =
            this.queueNotification ??
            (await import('../../../queues/notification.queue').then((m) => m.queueOpportunityNotification));
          if (!notifier) throw new Error('Opportunity notification not configured');
          for (const recipient of recipients) {
            await notifier(opp.id, recipient.userId, 'high');
          }

          const recipientIds = recipients.map((a: OpportunityActor) => a.userId);
          return {
            mutationResult: {
              success: true,
              opportunityId: opp.id,
              notified: recipientIds,
              message: 'Opportunity sent. The other person has been notified.',
            },
          };
        } catch (err) {
          logger.error('[Graph:Send] Failed', { error: err });
          return { mutationResult: { success: false, error: 'Failed to send opportunity.' } };
        }
      });
    };

    // ═══════════════════════════════════════════════════════════════
    // CONDITIONAL ROUTING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Router: Decides which path based on operationMode.
     */
    const routeByMode = (state: typeof OpportunityGraphState.State): string => {
      const mode = state.operationMode ?? 'create';
      if (mode === 'read') return 'read';
      if (mode === 'update') return 'update';
      if (mode === 'delete') return 'delete_opp';
      if (mode === 'send') return 'send';
      if (mode === 'create_introduction') return 'intro_validation';
      // 'create' is the default discovery pipeline
      return 'prep';
    };

    /**
     * After prep: check if user has indexed intents.
     * Early exit if none (cannot find opportunities).
     */
    const shouldContinueAfterPrep = (state: typeof OpportunityGraphState.State): string => {
      if (state.error) {
        logger.info('[Graph:Routing] Error in prep - ending early');
        return END;
      }
      logger.info('[Graph:Routing] Continuing to scope');
      return 'scope';
    };

    /**
     * After scope: check if we have target indexes.
     */
    const shouldContinueAfterScope = (state: typeof OpportunityGraphState.State): string => {
      if (state.error || state.targetIndexes.length === 0) {
        logger.info('[Graph:Routing] No target indexes - ending early');
        return END;
      }
      logger.info('[Graph:Routing] Continuing to resolve');
      return 'resolve';
    };

    /**
     * After discovery: if create-intent signal was set, end so tool can return it; else continue to evaluation.
     */
    const shouldContinueAfterDiscovery = (state: typeof OpportunityGraphState.State): string => {
      if (state.createIntentSuggested) {
        logger.info('[Graph:Routing] Create-intent suggested - ending for tool signal');
        return END;
      }
      return 'evaluation';
    };

    /**
     * After intro_validation: if validation set state.error, end early; else continue to intro_evaluation.
     */
    const routeAfterIntroValidation = (state: typeof OpportunityGraphState.State): string => {
      if (state.error) {
        logger.info('[Graph:Routing] Intro validation error - ending early');
        return END;
      }
      return 'intro_evaluation';
    };

    // ═══════════════════════════════════════════════════════════════
    // GRAPH ASSEMBLY
    // ═══════════════════════════════════════════════════════════════

    const workflow = new StateGraph(OpportunityGraphState)
      // Add all nodes
      .addNode('prep', prepNode)
      .addNode('scope', scopeNode)
      .addNode('resolve', resolveNode)
      .addNode('discovery', discoveryNode)
      .addNode('evaluation', evaluationNode)
      .addNode('ranking', rankingNode)
      .addNode('intro_validation', introValidationNode)
      .addNode('intro_evaluation', introEvaluationNode)
      .addNode('persist', persistNode)
      // CRUD nodes
      .addNode('read', readNode)
      .addNode('update', updateNode)
      .addNode('delete_opp', deleteNode)
      .addNode('send', sendNode)

      // Route by operation mode from START
      .addConditionalEdges(START, routeByMode, {
        prep: 'prep',
        intro_validation: 'intro_validation',
        read: 'read',
        update: 'update',
        delete_opp: 'delete_opp',
        send: 'send',
      })

      // Introduction path: validation -> evaluation -> persist (or END on validation error)
      .addConditionalEdges('intro_validation', routeAfterIntroValidation, {
        intro_evaluation: 'intro_evaluation',
        [END]: END,
      })
      .addEdge('intro_evaluation', 'persist')

      // CRUD fast paths -> END
      .addEdge('read', END)
      .addEdge('update', END)
      .addEdge('delete_opp', END)
      .addEdge('send', END)

      // Conditional routing: early exit if no indexed intents
      .addConditionalEdges('prep', shouldContinueAfterPrep, {
        scope: 'scope',
        [END]: END,
      })

      // Conditional routing: early exit if no target indexes
      .addConditionalEdges('scope', shouldContinueAfterScope, {
        resolve: 'resolve',
        [END]: END,
      })
      .addEdge('resolve', 'discovery')

      .addConditionalEdges('discovery', shouldContinueAfterDiscovery, {
        evaluation: 'evaluation',
        [END]: END,
      })

      // Linear edges for main flow
      .addEdge('evaluation', 'ranking')
      .addEdge('ranking', 'persist')
      .addEdge('persist', END);

    return workflow.compile();
  }
}
