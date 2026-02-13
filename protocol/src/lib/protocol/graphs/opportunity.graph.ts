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
import { queueOpportunityNotification } from '../../../queues/notification.queue';
import { selectStrategies } from '../support/opportunity.utils';
import { enrichOrCreate } from '../support/opportunity.enricher';
import { injectOpportunityIntoExistingChat } from '../support/opportunity.chat-injection';
import { protocolLogger, withCallLogging } from '../support/protocol.logger';

const logger = protocolLogger('OpportunityGraph');

/** Input shape for the HyDE generator invoke call (query-based embedding). */
export interface HydeGeneratorInvokeInput {
  sourceType: 'query';
  sourceText: string;
  strategies: HydeStrategy[];
  context?: { indexId: string };
  forceRegenerate?: boolean;
}

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
    private optionalEvaluator?: OpportunityEvaluatorLike
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
              error: 'You need to join at least one index to find opportunities.',
            };
          }
          const intents = await this.database.getActiveIntents(state.userId);
          if (intents.length === 0 && !state.searchQuery) {
            logger.info('[Graph:Prep] User has no active intents and no searchQuery');
            return {
              userIndexes: userIndexIds,
              error: 'You need to add some intents before finding opportunities.',
            };
          }
          const indexedIntents: IndexedIntent[] = intents.map((intent: ActiveIntent) => ({
            intentId: intent.id,
            payload: intent.payload,
            summary: intent.summary ?? undefined,
            indexes: [],
          }));
          return {
            userIndexes: userIndexIds,
            indexedIntents,
          };
        },
        { context: { userId: state.userId }, logOutput: true }
      ).catch((error) => {
        logger.error('[Graph:Prep] Failed', { error });
        return {
          error: 'Failed to prepare opportunity search. Please try again.',
        };
      });

    /**
     * Node 1: Scope
     * Determines which indexes to search within.
     * If indexId provided: searches only that index.
     * Otherwise: searches all user's indexes.
     */
    const scopeNode = async (state: typeof OpportunityGraphState.State) => {
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
    };

    /**
     * Node 2: Discovery
     * Generates HyDE embeddings and performs semantic search.
     * Uses existing searchWithHydeEmbeddings which handles index-scoped search.
     */
    const discoveryNode = async (state: typeof OpportunityGraphState.State) => {
      logger.info('[Graph:Discovery] Starting semantic search', {
        targetIndexesCount: state.targetIndexes.length,
        hasSearchQuery: !!state.searchQuery,
      });

      try {
        // Determine search query (user query or use first intent as fallback)
        const searchText = state.searchQuery ?? state.indexedIntents[0]?.payload ?? '';
        
        if (!searchText) {
          logger.warn('[Graph:Discovery] No search text available');
          return { candidates: [] };
        }

        if (state.targetIndexes.length === 0) {
          logger.warn('[Graph:Discovery] No target indexes for search');
          return { candidates: [] };
        }

        // Determine strategies (use first index for strategy selection)
        const strategies = state.options.strategies ?? selectStrategies(searchText, {
          indexId: state.targetIndexes[0].indexId,
        });

        logger.info('[Graph:Discovery] Generating HyDE and searching', {
          query: searchText.substring(0, 50),
          strategies,
          targetIndexesCount: state.targetIndexes.length,
        });

        // Generate HyDE embeddings (context from first index)
        const hydeResult = await this.hydeGenerator.invoke({
          sourceType: 'query',
          sourceText: searchText,
          strategies,
          context: state.targetIndexes[0] ? { indexId: state.targetIndexes[0].indexId } : undefined,
          forceRegenerate: false,
        });

        const hydeEmbeddings = hydeResult.hydeEmbeddings as Record<string, number[]>;
        
        if (!hydeEmbeddings || Object.keys(hydeEmbeddings).length === 0) {
          logger.warn('[Graph:Discovery] No HyDE embeddings generated');
          return { hydeEmbeddings: {} as Record<HydeStrategy, number[]>, candidates: [] };
        }

        const embeddingsMap = new Map<HydeStrategy, number[]>();
        for (const [strategy, embedding] of Object.entries(hydeEmbeddings)) {
          if (embedding?.length) {
            embeddingsMap.set(strategy as HydeStrategy, embedding);
          }
        }

        const limitPerStrategy = state.options.limit ?? 10;
        const perIndexLimit = state.options.limit ?? 20;
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
            const intentResults = results.filter((r) => r.type === 'intent');
            const profileResults = results.filter((r) => r.type === 'profile');
            for (const result of intentResults) {
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
            for (const result of profileResults) {
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

        // Dedupe by (candidateUserId, indexId): keep one per user per index, intent wins over profile
        const byUserAndIndex = new Map<string, CandidateMatch>();
        for (const c of allCandidates) {
          const key = `${c.candidateUserId}:${c.indexId}`;
          if (!byUserAndIndex.has(key) || (byUserAndIndex.get(key)?.candidateIntentId == null && c.candidateIntentId != null)) {
            byUserAndIndex.set(key, c);
          }
        }
        const candidates = Array.from(byUserAndIndex.values());

        logger.info('[Graph:Discovery] Discovery complete', {
          candidatesFound: candidates.length,
        });
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
    };

    /**
     * Node 3: Evaluation (Entity bundle)
     * Builds entity bundle from source + candidates, invokes entity-bundle evaluator, maps to EvaluatedOpportunity with indexId from entities.
     */
    const evaluationNode = async (state: typeof OpportunityGraphState.State) => {
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
        };

        const minScore = state.options.minScore ?? 70;
        const opportunitiesWithActors =
          typeof (evaluatorAgent as OpportunityEvaluator).invokeEntityBundle === 'function'
            ? await (evaluatorAgent as OpportunityEvaluator).invokeEntityBundle(input, { minScore })
            : await (async () => {
                const realEvaluator = new OpportunityEvaluator();
                return realEvaluator.invokeEntityBundle(input, { minScore });
              })();

        const evaluatedOpportunities: EvaluatedOpportunity[] = opportunitiesWithActors.map((op) => ({
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
    };

    /**
     * Node 4: Ranking
     * Sorts evaluated opportunities by score, applies limit, dedupes by actor-set hash.
     */
    const rankingNode = async (state: typeof OpportunityGraphState.State) => {
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
    };

    /**
     * Node 5: Persist
     * Creates opportunities from evaluator-proposed actors (indexId, userId, role, optional intent).
     */
    const persistNode = async (state: typeof OpportunityGraphState.State) => {
      logger.info('[Graph:Persist] Starting persistence', {
        opportunitiesToCreate: state.evaluatedOpportunities.length,
        initialStatus: state.options.initialStatus ?? 'pending',
      });

      if (state.evaluatedOpportunities.length === 0) {
        logger.info('[Graph:Persist] No opportunities to persist');
        return { opportunities: [] };
      }

      try {
        const persisted: Opportunity[] = [];
        const now = new Date().toISOString();
        const initialStatus = state.options.initialStatus ?? 'pending';

        for (const evaluated of state.evaluatedOpportunities) {
          const data: CreateOpportunityData = {
            detection: {
              source: 'opportunity_graph',
              createdBy: 'agent-opportunity-finder',
              triggeredBy: state.indexedIntents[0]?.intentId,
              timestamp: now,
            },
            actors: evaluated.actors.map((a: EvaluatedOpportunityActor) => ({
              indexId: a.indexId,
              userId: a.userId,
              role: a.role,
              ...(a.intentId ? { intent: a.intentId } : {}),
            })),
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
            },
            confidence: String(evaluated.score / 100),
            status: initialStatus,
          };

          const enrichment = await enrichOrCreate(this.database, this.embedder, data);
          const toCreate = enrichment.data;
          if (enrichment.enriched) {
            toCreate.status = enrichment.resolvedStatus;
          }
          const created = await this.database.createOpportunity(toCreate);
          persisted.push(created);

          if (enrichment.enriched && enrichment.expiredIds.length > 0) {
            for (const id of enrichment.expiredIds) {
              await this.database.updateOpportunityStatus(id, 'expired');
            }
          }

          if (created.status === 'pending') {
            await injectOpportunityIntoExistingChat(created).catch((err) => {
              logger.warn('[Graph:Persist] Chat injection failed for opportunity', { opportunityId: created.id, error: err });
            });
          }
        }

        logger.info('[Graph:Persist] Persistence complete', {
          count: persisted.length,
          status: initialStatus,
        });
        return { opportunities: persisted };
      } catch (error) {
        logger.error('[Graph:Persist] Failed', { error });
        return {
          opportunities: [],
          error: 'Failed to persist opportunities.',
        };
      }
    };

    // ═══════════════════════════════════════════════════════════════
    // CRUD NODES (read, update, delete, send)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Read Node: List opportunities for the user, optionally filtered by indexId.
     * Fast path — no LLM calls.
     */
    const readNode = async (state: typeof OpportunityGraphState.State) => {
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
    };

    /**
     * Update Node: Change opportunity status (accept, reject, etc.).
     */
    const updateNode = async (state: typeof OpportunityGraphState.State) => {
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
    };

    /**
     * Delete Node: Expire/archive an opportunity.
     */
    const deleteNode = async (state: typeof OpportunityGraphState.State) => {
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
    };

    /**
     * Send Node: Promote latent opportunity to pending + queue notification.
     */
    const sendNode = async (state: typeof OpportunityGraphState.State) => {
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
        if (opp.status !== 'latent') {
          return {
            mutationResult: {
              success: false,
              error: `Opportunity is already ${opp.status}; only draft (latent) opportunities can be sent.`,
            },
          };
        }
        const senderActor = opp.actors.find((a: OpportunityActor) => a.userId === state.userId);
        if (!senderActor) {
          return { mutationResult: { success: false, error: 'You are not part of this opportunity.' } };
        }

        const hasIntroducer = opp.actors.some((a: OpportunityActor) => a.role === 'introducer');
        const canSend =
          senderActor.role === 'introducer' ||
          senderActor.role === 'peer' ||
          (senderActor.role === 'patient' && !hasIntroducer) ||
          (senderActor.role === 'party' && !hasIntroducer);
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

        for (const recipient of recipients) {
          await queueOpportunityNotification(opp.id, recipient.userId, 'high');
        }

        await injectOpportunityIntoExistingChat({ ...opp, status: 'pending' }).catch((err) => {
          logger.warn('[Graph:Send] Chat injection failed for opportunity', { opportunityId: opp.id, error: err });
        });

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

      if (state.indexedIntents.length === 0 && !state.searchQuery) {
        logger.info('[Graph:Routing] No indexed intents and no searchQuery - ending early');
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

      logger.info('[Graph:Routing] Continuing to discovery');
      return 'discovery';
    };

    // ═══════════════════════════════════════════════════════════════
    // GRAPH ASSEMBLY
    // ═══════════════════════════════════════════════════════════════

    const workflow = new StateGraph(OpportunityGraphState)
      // Add all nodes
      .addNode('prep', prepNode)
      .addNode('scope', scopeNode)
      .addNode('discovery', discoveryNode)
      .addNode('evaluation', evaluationNode)
      .addNode('ranking', rankingNode)
      .addNode('persist', persistNode)
      // CRUD nodes
      .addNode('read', readNode)
      .addNode('update', updateNode)
      .addNode('delete_opp', deleteNode)
      .addNode('send', sendNode)

      // Route by operation mode from START
      .addConditionalEdges(START, routeByMode, {
        prep: 'prep',
        read: 'read',
        update: 'update',
        delete_opp: 'delete_opp',
        send: 'send',
      })

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
        discovery: 'discovery',
        [END]: END,
      })

      // Linear edges for main flow
      .addEdge('discovery', 'evaluation')
      .addEdge('evaluation', 'ranking')
      .addEdge('ranking', 'persist')
      .addEdge('persist', END);

    return workflow.compile();
  }
}
