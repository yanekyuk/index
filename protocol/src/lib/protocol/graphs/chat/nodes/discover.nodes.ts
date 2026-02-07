/**
 * Discover node: run discovery from an ad-hoc chat query.
 *
 * Uses selectStrategiesFromQuery to pick HyDE strategies, invokes the opportunity
 * graph with the query as sourceText and those strategies, then returns
 * formatted candidates (enriched with profile name/bio) for chat display.
 *
 * Used by the create_opportunities chat tool.
 */

import type { Opportunity } from "../../../interfaces/database.interface";
import type { ChatGraphCompositeDatabase } from "../../../interfaces/database.interface";
import type { OpportunityGraphOptions } from "../../opportunity/opportunity.graph.state";
import { selectStrategiesFromQuery } from "../chat.utils";
import { protocolLogger, withCallLogging } from "../../../protocol.log";

const logger = protocolLogger("DiscoverNodes");

/** Compiled opportunity graph (from OpportunityGraphFactory.createGraph()). */
export type CompiledOpportunityGraph = ReturnType<
  import("../../opportunity/opportunity.graph").OpportunityGraphFactory["createGraph"]
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
}

export interface DiscoverResult {
  found: boolean;
  count: number;
  message?: string;
  opportunities?: FormattedDiscoveryCandidate[];
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
        indexId: indexScope.length > 0 ? indexScope[0] : undefined,
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

      const enriched = await Promise.all(
        opportunities.map(async (opp) => {
          const candidateActor = opp.actors.find((a) => a.identityId !== userId);
          const candidateUserId = candidateActor?.identityId ?? "";
          const profile = candidateUserId
            ? await database.getProfile(candidateUserId)
            : null;
          const confidence =
            typeof opp.interpretation?.confidence === "number"
              ? opp.interpretation.confidence
              : parseFloat(String(opp.interpretation?.confidence ?? 0)) || 0;
          return {
            opportunityId: opp.id,
            userId: candidateUserId,
            name: profile?.identity?.name ?? undefined,
            bio: truncateForChat(profile?.identity?.bio),
            matchReason: truncateForChat(opp.interpretation?.summary ?? "") ?? "",
            score: confidence,
          };
        })
      );

      return {
        found: true,
        count: enriched.length,
        opportunities: enriched,
      };
    },
    { context: { userId }, logOutput: true }
  ).catch(() => {
    return {
      found: false,
      count: 0,
      message: "Failed to search for opportunities. Please try again.",
    };
  });
}
