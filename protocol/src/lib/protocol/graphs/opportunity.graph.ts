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
} from '../states/opportunity.state';
import { OpportunityEvaluator, type CandidateProfile } from '../agents/opportunity.evaluator';
import type { OpportunityGraphDatabase } from '../interfaces/database.interface';

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
    reasoning: string;
    valencyRole: 'Agent' | 'Patient' | 'Peer';
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
import { selectStrategies, deriveRolesFromStrategy } from '../support/opportunity.utils';
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
          if (intents.length === 0) {
            logger.info('[Graph:Prep] User has no active intents');
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
            reasoning: result.reasoning ?? '',
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
              reasoning: evaluated.reasoning,
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

        const list = await this.database.getOpportunitiesForUser(state.userId, {
          limit: 30,
          ...(indexIdFilter ? { indexId: indexIdFilter } : {}),
        });

        if (list.length === 0) {
          return {
            readResult: {
              count: 0,
              message: 'You have no opportunities yet. Use create_opportunities to search for connections.',
              opportunities: [],
            },
          };
        }

        const sourceLabel: Record<string, string> = {
          chat: 'Suggested in chat',
          opportunity_graph: 'System match',
          manual: 'Manual',
          cron: 'Scheduled',
          member_added: 'Member added',
        };

        const enriched = await Promise.all(
          list.map(async (opp) => {
            // "Other parties" = all actors who are not the current user (exclude introducer for suggestedBy).
            // Opportunity graph persists roles as 'agent'|'patient'|'peer'; manual/createManual use 'party'.
            const otherParties = opp.actors.filter((a: OpportunityActor) => a.identityId !== state.userId && a.role !== 'introducer');
            const introducer = opp.actors.find((a: OpportunityActor) => a.role === 'introducer');
            const partyIds = otherParties.map((a: OpportunityActor) => a.identityId);
            const idsToResolve = introducer ? [...partyIds, introducer.identityId] : partyIds;
            const [indexRecord, ...profileAndUserPairs] = await Promise.all([
              this.database.getIndex(opp.indexId),
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
              indexName: indexRecord?.title ?? opp.indexId,
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
        const isActor = opp.actors.some((a: OpportunityActor) => a.identityId === state.userId);
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
        const isActor = opp.actors.some((a: OpportunityActor) => a.identityId === state.userId);
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
        const isActor = opp.actors.some((a: OpportunityActor) => a.identityId === state.userId);
        if (!isActor) {
          return { mutationResult: { success: false, error: 'You are not part of this opportunity.' } };
        }

        await this.database.updateOpportunityStatus(state.opportunityId, 'pending');

        // Notify other actors
        const recipients = opp.actors.filter((a: OpportunityActor) => a.identityId !== state.userId);
        for (const recipient of recipients) {
          await queueOpportunityNotification(opp.id, recipient.identityId, 'high');
        }

        const recipientIds = recipients.map((a: OpportunityActor) => a.identityId);
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
