/**
 * Run discovery from an ad-hoc query (e.g. chat "find me a mentor", "who needs a React developer").
 *
 * Uses selectStrategiesFromQuery to pick HyDE strategies, invokes the opportunity
 * graph with the query as sourceText and those strategies, then returns
 * formatted candidates (enriched with profile name/bio) for chat display.
 *
 * Used by the create_opportunities chat tool.
 */

import type { Opportunity } from "../interfaces/database.interface";
import type { ChatGraphCompositeDatabase } from "../interfaces/database.interface";
import type { OpportunityGraphOptions } from "../states/opportunity.state";
import type { HydeStrategy } from "../agents/hyde.strategies";
import { OpportunityPresenter, gatherPresenterContext, type OpportunityPresentationResult } from "../agents/opportunity.presenter";
import { protocolLogger, withCallLogging } from "./protocol.logger";

const logger = protocolLogger("OpportunityDiscover");

/** Compiled opportunity graph (from OpportunityGraphFactory.createGraph()). */
export type CompiledOpportunityGraph = ReturnType<
  import("../graphs/opportunity.graph").OpportunityGraphFactory["createGraph"]
>;

export interface DiscoverInput {
  /** Compiled opportunity graph (already has DB, embedder, cache, HyDE graph). */
  opportunityGraph: CompiledOpportunityGraph;
  /** Database for enriching candidates with profile (getProfile). */
  database: ChatGraphCompositeDatabase;
  userId: string;
  query: string;
  indexScope: string[];
  limit?: number;
  /** When provided, each opportunity is enriched with personalized presentation (headline, personalizedSummary, suggestedAction). */
  presenter?: OpportunityPresenter;
}

/** Max chars for bio and matchReason in chat tool results to keep context manageable. */
const MAX_FIELD_CHARS = 100;

function truncateForChat(s: string | undefined, max = MAX_FIELD_CHARS): string | undefined {
  if (s == null || s === "") return undefined;
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + "...";
}

/** One formatted opportunity for chat (candidate-facing). */
export interface FormattedDiscoveryCandidate {
  opportunityId: string;
  userId: string;
  name?: string;
  bio?: string;
  matchReason: string;
  score: number;
  /** Present when DiscoverInput.presenter was provided. */
  presentation?: OpportunityPresentationResult;
}

export interface DiscoverResult {
  found: boolean;
  count: number;
  message?: string;
  opportunities?: FormattedDiscoveryCandidate[];
}

/**
 * Infer HyDE strategies from a free-text discovery query so the opportunity graph
 * runs the right strategy mix (e.g. mentor vs hiree). Used when chat tools call
 * runDiscoverFromQuery with a user query like "find me a mentor" or
 * "who needs a React developer".
 *
 * @param query - User's free-text discovery query
 * @returns Array of HyDE strategy names to run
 */
export function selectStrategiesFromQuery(query: string): HydeStrategy[] {
  const base: HydeStrategy[] = ["mirror", "reciprocal"];
  const q = (query ?? "").toLowerCase().trim();
  if (!q) return base;

  if (
    /mentor|guide|guidance|learn from|advice from|someone to teach|teach me/i.test(q)
  ) {
    base.push("mentor");
  }
  if (
    /investor|invest|funding|raise|seed|series|vc|capital|back (us|me|this)/i.test(
      q
    )
  ) {
    base.push("investor");
  }
  if (
    /co-?founder|collaborator|partner|peer|build together|work together|collaborat/i.test(
      q
    )
  ) {
    base.push("collaborator");
  }
  if (
    /hire|hiring|who needs|looking for (a |an )?(developer|engineer|designer|react|frontend|backend)|job|role|position|developer needed|engineer needed/i.test(
      q
    )
  ) {
    base.push("hiree");
  }

  return [...new Set(base)];
}

/**
 * Run discovery from an ad-hoc query (e.g. "find me a mentor", "who needs a React developer").
 * Selects HyDE strategies from the query, invokes the opportunity graph, and returns
 * formatted candidates suitable for chat display.
 */
export async function runDiscoverFromQuery(
  input: DiscoverInput
): Promise<DiscoverResult> {
  const {
    opportunityGraph,
    database,
    userId,
    query,
    indexScope,
    limit = 5,
  } = input;

  if (indexScope.length === 0) {
    return {
      found: false,
      count: 0,
      message:
        "You need to join at least one index (community) to discover opportunities. Use read_indexes to see available indexes, or create one.",
    };
  }

  // When query is empty, the opportunity graph uses the user's intents in scope (indexedIntents[0].payload) and derives strategies from that
  const queryOrEmpty = query?.trim() ?? "";
  const options: OpportunityGraphOptions = {
    limit,
    initialStatus: 'latent',
  };
  if (queryOrEmpty) {
    options.strategies = selectStrategiesFromQuery(queryOrEmpty);
  }

  return withCallLogging(
    logger,
    "runDiscoverFromQuery",
    {
      userId,
      queryPreview: queryOrEmpty ? queryOrEmpty.substring(0, 50) : "(using user intents in scope)",
      indexScopeCount: indexScope.length,
      limit,
    },
    async () => {
      // When searchQuery is empty/undefined, graph uses user's indexed intents (prep loads them; discovery uses first intent payload and derives strategies)
      const result = await opportunityGraph.invoke({
        userId,
        searchQuery: queryOrEmpty || undefined,
        indexId: indexScope.length === 1 ? indexScope[0] : undefined,
        options,
      });

      const opportunities: Opportunity[] = Array.isArray(result.opportunities)
        ? result.opportunities
        : [];
      if (opportunities.length === 0) {
        return {
          found: false,
          count: 0,
          message:
            "No matching opportunities found. Try a different search or create intents to improve matching.",
        };
      }

      const baseEnriched = await Promise.all(
        opportunities.map(async (opp) => {
          const candidateActor = opp.actors.find((a) => a.userId !== userId);
          const candidateUserId = candidateActor?.userId ?? "";
          const profile = candidateUserId
            ? await database.getProfile(candidateUserId)
            : null;
          const confidence =
            typeof opp.interpretation?.confidence === "number"
              ? opp.interpretation.confidence
              : parseFloat(String(opp.interpretation?.confidence ?? 0)) || 0;
          return {
            opportunity: opp,
            candidateUserId,
            profile,
            confidence,
          };
        })
      );

      let presentations: OpportunityPresentationResult[] | undefined;
      if (input.presenter && baseEnriched.length > 0) {
        try {
          const contexts = await Promise.all(
            baseEnriched.map(({ opportunity }) =>
              gatherPresenterContext(database, opportunity, userId)
            )
          );
          presentations = await input.presenter.presentBatch(contexts, {
            concurrency: 5,
          });
        } catch (error) {
          logger.warn(
            "Presenter enrichment failed during opportunity discovery; returning base results without presentations",
            {
              userId,
              opportunitiesCount: baseEnriched.length,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          presentations = undefined;
        }
      }

      const enriched: FormattedDiscoveryCandidate[] = baseEnriched.map(
        (item, idx) => ({
          opportunityId: item.opportunity.id,
          userId: item.candidateUserId,
          name: item.profile?.identity?.name ?? undefined,
          bio: truncateForChat(item.profile?.identity?.bio),
          matchReason:
            truncateForChat(item.opportunity.interpretation?.reasoning ?? "") ?? "",
          score: item.confidence,
          ...(presentations?.[idx] && { presentation: presentations[idx] }),
        })
      );

      return {
        found: true,
        count: enriched.length,
        opportunities: enriched,
      };
    },
    { context: { userId }, logOutput: true }
  ).catch((err) => {
    return {
      found: false,
      count: 0,
      message: "Failed to search for opportunities. Please try again.",
    };
  });
}
