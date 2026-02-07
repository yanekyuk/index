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
import type { Id } from '../../../../types/common.types';
import {
  OpportunityGraphState,
  type IndexedIntent,
  type TargetIndex,
  type CandidateMatch,
  type EvaluatedCandidate,
} from './opportunity.graph.state';
import { OpportunityEvaluator, type CandidateProfile } from '../../agents/opportunity/opportunity.evaluator';
import type { OpportunityGraphDatabase } from '../../interfaces/database.interface';

/** Optional evaluator for testing (avoids LLM calls). */
export type OpportunityEvaluatorLike = {
  invoke: (
    sourceProfileContext: string,
    candidates: CandidateProfile[],
    options: { minScore?: number }
  ) => Promise<Array<{
    sourceId: string;
    candidateId: string;
    score: number;
    sourceDescription: string;
    candidateDescription: string;
    valencyRole: 'Agent' | 'Patient' | 'Peer';
  }>>;
};
import type { Embedder, HydeStrategy } from '../../interfaces/embedder.interface';
import type {
  CreateOpportunityData,
  Opportunity,
  ActiveIntent,
} from '../../interfaces/database.interface';
import { selectStrategies, deriveRolesFromStrategy } from './opportunity.utils';
import { log } from '../../../log';

const logger = log.protocol.from('OpportunityGraph');

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
    const prepNode = async (state: typeof OpportunityGraphState.State) => {
      logger.info('[Graph:Prep] Starting preparation', {
        userId: state.userId,
        hasSearchQuery: !!state.searchQuery,
        requestedIndexId: state.indexId,
      });

      try {
        // Fetch user's index memberships (returns index IDs)
        const userIndexIds = await this.database.getUserIndexIds(state.userId);
        
        if (userIndexIds.length === 0) {
          logger.info('[Graph:Prep] User has no index memberships - cannot find opportunities');
          return {
            userIndexes: [],
            error: 'You need to join at least one index to find opportunities.',
          };
        }

        // Fetch user's active intents to verify they have some
        const intents = await this.database.getActiveIntents(state.userId);
        
        if (intents.length === 0) {
          logger.info('[Graph:Prep] User has no active intents');
          return {
            userIndexes: userIndexIds,
            error: 'You need to add some intents before finding opportunities.',
          };
        }

        // Note: We don't filter for indexed intents here - the search will handle scope
        // Hyde documents are generated automatically for all intents
        const indexedIntents: IndexedIntent[] = intents.map((intent: ActiveIntent) => ({
          intentId: intent.id,
          payload: intent.payload,
          summary: intent.summary ?? undefined,
          indexes: [], // Will be populated by search
        }));

        logger.info('[Graph:Prep] Preparation complete', {
          userIndexesCount: userIndexIds.length,
          intentsCount: intents.length,
        });
        return {
          userIndexes: userIndexIds,
          indexedIntents,
        };
      } catch (error) {
        logger.error('[Graph:Prep] Failed', { error });
        return {
          error: 'Failed to prepare opportunity search. Please try again.',
        };
      }
    };

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

        // Determine target index scope
        const indexScope = state.targetIndexes.map((idx) => idx.indexId);
        
        if (indexScope.length === 0) {
          logger.warn('[Graph:Discovery] No target indexes for search');
          return { candidates: [] };
        }

        // Determine strategies
        const strategies = state.options.strategies ?? selectStrategies(searchText, {
          indexId: indexScope[0],
        });

        logger.info('[Graph:Discovery] Generating HyDE and searching', {
          query: searchText.substring(0, 50),
          strategies,
          indexScopeCount: indexScope.length,
        });

        // Generate HyDE embeddings
        const hydeResult = await this.hydeGenerator.invoke({
          sourceType: 'query',
          sourceText: searchText,
          strategies,
          context: indexScope[0] ? { indexId: indexScope[0] } : undefined,
          forceRegenerate: false,
        });

        const hydeEmbeddings = hydeResult.hydeEmbeddings as Record<string, number[]>;
        
        if (!hydeEmbeddings || Object.keys(hydeEmbeddings).length === 0) {
          logger.warn('[Graph:Discovery] No HyDE embeddings generated');
          return { hydeEmbeddings: {} as Record<HydeStrategy, number[]>, candidates: [] };
        }

        // Convert to Map for search
        const embeddingsMap = new Map<HydeStrategy, number[]>();
        for (const [strategy, embedding] of Object.entries(hydeEmbeddings)) {
          if (embedding?.length) {
            embeddingsMap.set(strategy as HydeStrategy, embedding);
          }
        }

        // Perform search using existing method (handles index scope, dedup, ranking)
        const hydeSearchResults = await this.embedder.searchWithHydeEmbeddings(embeddingsMap, {
          strategies,
          indexScope,
          excludeUserId: state.userId,
          limitPerStrategy: state.options.limit ?? 10,
          limit: state.options.limit ?? 20,
          minScore: 0.5,
        });

        const intentResults = hydeSearchResults.filter((r) => r.type === 'intent');
        const profileResults = hydeSearchResults.filter((r) => r.type === 'profile');

        // Map intent results to CandidateMatch (with candidateIntentId)
        const intentCandidates: CandidateMatch[] = intentResults.map((result) => ({
          candidateUserId: result.userId as Id<'users'>,
          candidateIntentId: result.id as Id<'intents'>,
          indexId: result.indexId as Id<'indexes'>,
          similarity: result.score,
          strategy: result.matchedVia as HydeStrategy,
          candidatePayload: '',
          candidateSummary: undefined,
        }));

        // Include profile matches (profile-only candidates have no candidateIntentId)
        const profileCandidates: CandidateMatch[] = profileResults.map((result) => ({
          candidateUserId: result.userId as Id<'users'>,
          indexId: result.indexId as Id<'indexes'>,
          similarity: result.score,
          strategy: result.matchedVia as HydeStrategy,
          candidatePayload: '',
          candidateSummary: undefined,
        }));

        // Dedupe by candidateUserId (intent match wins if both exist)
        const byUser = new Map<string, CandidateMatch>();
        for (const c of [...intentCandidates, ...profileCandidates]) {
          const key = c.candidateUserId;
          if (!byUser.has(key) || (byUser.get(key)?.candidateIntentId == null && c.candidateIntentId != null)) {
            byUser.set(key, c);
          }
        }
        const candidates = Array.from(byUser.values());

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
     * Node 3: Evaluation (Parallel Processing)
     * Evaluates each candidate match using OpportunityEvaluator agent.
     */
    const evaluationNode = async (state: typeof OpportunityGraphState.State) => {
      logger.info('[Graph:Evaluation] Starting evaluation', {
        candidatesCount: state.candidates.length,
      });

      if (state.candidates.length === 0) {
        logger.info('[Graph:Evaluation] No candidates to evaluate');
        return { evaluatedCandidates: [] };
      }

      try {
        // Fetch source profile
        const sourceProfile = await this.database.getProfile(state.userId);
        const sourceProfileContext = sourceProfile
          ? [
              `Name: ${sourceProfile.identity?.name ?? 'Unknown'}`,
              `Bio: ${sourceProfile.identity?.bio ?? ''}`,
              `Location: ${sourceProfile.identity?.location ?? ''}`,
              `Interests: ${sourceProfile.attributes?.interests?.join(', ') ?? ''}`,
              `Skills: ${sourceProfile.attributes?.skills?.join(', ') ?? ''}`,
              `Context: ${sourceProfile.narrative?.context ?? ''}`,
            ].join('\n')
          : '';

        // Fetch candidate profiles
        const candidateProfiles: CandidateProfile[] = await Promise.all(
          state.candidates.map(async (c) => {
            const profile = await this.database.getProfile(c.candidateUserId);
            return {
              userId: c.candidateUserId,
              identity: profile?.identity
                ? {
                    name: profile.identity.name,
                    bio: profile.identity.bio,
                    location: profile.identity.location,
                  }
                : undefined,
              attributes: profile?.attributes,
              narrative: profile?.narrative,
              score: c.similarity * 100, // Convert to 0-100
            };
          })
        );

        // Invoke evaluator agent
        const minScore = state.options.minScore ?? 70;
        const evaluatorResults = await evaluatorAgent.invoke(
          sourceProfileContext,
          candidateProfiles,
          { minScore }
        );

        // Map evaluator results to evaluated candidates (filter out nulls from missing candidates)
        const withNulls = evaluatorResults.map((result) => {
          const candidate = state.candidates.find(c => c.candidateUserId === result.candidateId);
          if (!candidate) return null;

          const base: EvaluatedCandidate = {
            sourceUserId: state.userId,
            candidateUserId: result.candidateId as Id<'users'>,
            ...(candidate.candidateIntentId != null && { candidateIntentId: candidate.candidateIntentId }),
            indexId: candidate.indexId,
            score: result.score,
            sourceDescription: result.sourceDescription ?? '',
            candidateDescription: result.candidateDescription ?? '',
            valencyRole: result.valencyRole,
            strategy: candidate.strategy,
          };
          if (state.indexedIntents[0]?.intentId != null) {
            base.sourceIntentId = state.indexedIntents[0].intentId;
          }
          return base;
        });
        const evaluatedCandidates: EvaluatedCandidate[] = withNulls.filter(
          (c): c is EvaluatedCandidate => c !== null
        );

        logger.info('[Graph:Evaluation] Evaluation complete', {
          evaluatedCount: evaluatedCandidates.length,
          passed: evaluatedCandidates.filter(c => c.score >= minScore).length,
        });
        return { evaluatedCandidates };
      } catch (error) {
        logger.error('[Graph:Evaluation] Failed', { error });
        return {
          evaluatedCandidates: [],
          error: 'Failed to evaluate candidates.',
        };
      }
    };

    /**
     * Node 4: Ranking
     * Sorts opportunities by confidence score and applies limit.
     */
    const rankingNode = async (state: typeof OpportunityGraphState.State) => {
      logger.info('[Graph:Ranking] Starting ranking', {
        evaluatedCount: state.evaluatedCandidates.length,
      });

      try {
        // Sort by score descending
        const sorted = [...state.evaluatedCandidates].sort((a, b) => b.score - a.score);

        // Apply limit
        const limit = state.options.limit ?? 10;
        const ranked = sorted.slice(0, limit);

        // Deduplicate by (sourceUser, candidateUser, index) tuple
        const seen = new Set<string>();
        const deduplicated = ranked.filter((opp) => {
          const key = `${opp.sourceUserId}-${opp.candidateUserId}-${opp.indexId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        logger.info('[Graph:Ranking] Ranking complete', {
          sorted: sorted.length,
          afterLimit: ranked.length,
          afterDedup: deduplicated.length,
        });
        return { evaluatedCandidates: deduplicated };
      } catch (error) {
        logger.error('[Graph:Ranking] Failed', { error });
        return { error: 'Failed to rank opportunities.' };
      }
    };

    /**
     * Node 5: Persist
     * Creates opportunities in database with initialStatus from options.
     */
    const persistNode = async (state: typeof OpportunityGraphState.State) => {
      logger.info('[Graph:Persist] Starting persistence', {
        opportunitiesToCreate: state.evaluatedCandidates.length,
        initialStatus: state.options.initialStatus ?? 'pending',
      });

      if (state.evaluatedCandidates.length === 0) {
        logger.info('[Graph:Persist] No opportunities to persist');
        return { opportunities: [] };
      }

      try {
        const persisted: Opportunity[] = [];
        const now = new Date().toISOString();
        const initialStatus = state.options.initialStatus ?? 'pending';

        for (const evaluated of state.evaluatedCandidates) {
          // Derive roles from valency
          const sourceRole = evaluated.valencyRole === 'Agent' ? 'patient' : 
                             evaluated.valencyRole === 'Patient' ? 'agent' : 'peer';
          const candidateRole = evaluated.valencyRole === 'Agent' ? 'agent' : 
                                evaluated.valencyRole === 'Patient' ? 'patient' : 'peer';

          const data: CreateOpportunityData = {
            detection: {
              source: 'opportunity_graph',
              createdBy: 'agent-opportunity-finder',
              triggeredBy: evaluated.sourceIntentId,
              timestamp: now,
            },
            actors: [
              {
                role: sourceRole,
                identityId: evaluated.sourceUserId,
                intents: evaluated.sourceIntentId ? [evaluated.sourceIntentId] : [],
                profile: true,
              },
              {
                role: candidateRole,
                identityId: evaluated.candidateUserId,
                intents: evaluated.candidateIntentId ? [evaluated.candidateIntentId] : [],
                profile: true,
              },
            ],
            interpretation: {
              category: 'collaboration',
              summary: evaluated.sourceDescription,
              confidence: evaluated.score / 100,
              signals: [
                {
                  type: evaluated.candidateIntentId ? 'intent_match' : 'profile_match',
                  weight: evaluated.score / 100,
                  detail: `Matched via ${evaluated.strategy} strategy`,
                },
              ],
            },
            context: {
              indexId: evaluated.indexId,
              triggeringIntentId: evaluated.sourceIntentId,
            },
            indexId: evaluated.indexId,
            confidence: String(evaluated.score / 100),
            status: initialStatus,
          };

          const created = await this.database.createOpportunity(data);
          persisted.push(created);
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
    // CONDITIONAL ROUTING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * After prep: check if user has indexed intents.
     * Early exit if none (cannot find opportunities).
     */
    const shouldContinueAfterPrep = (state: typeof OpportunityGraphState.State): string => {
      if (state.error) {
        logger.info('[Graph:Routing] Error in prep - ending early');
        return END;
      }

      if (state.indexedIntents.length === 0) {
        logger.info('[Graph:Routing] No indexed intents - ending early');
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

      // Define entry point
      .addEdge(START, 'prep')

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
