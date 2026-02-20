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
import {
  OpportunityPresenter,
  gatherPresenterContext,
  type OpportunityPresentationResult,
  type HomeCardPresentationResult,
  type HomeCardPresenterInput,
} from "../agents/opportunity.presenter";
import { MINIMAL_MAIN_TEXT_MAX_CHARS } from "./opportunity.constants";
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
  /** Optional intent to use as discovery source and for triggeredBy (e.g. from opportunity queue). */
  triggerIntentId?: string;
  /** When provided, each opportunity is enriched with personalized presentation (headline, personalizedSummary, suggestedAction). */
  presenter?: OpportunityPresenter;
  /**
   * When true, use the full home card presentation format (with narratorRemark, action labels, mutualIntentsLabel).
   * This enables rendering the same rich opportunity cards in chat as on the home page.
   */
  useHomeCardFormat?: boolean;
  /**
   * When true, skip the LLM presenter and return minimal card data only (faster for chat).
   * Sets homeCardPresentation and narratorChip from static labels and match reason.
   */
  minimalForChat?: boolean;
}

/** Context used by the minimal (no-LLM) path; only introducerName is needed for narrator chip. */
type MinimalPresenterContext = { introducerName?: string };

/** Max chars for bio and matchReason in chat tool results to keep context manageable. */
const MAX_FIELD_CHARS = 100;

function truncateForChat(
  s: string | undefined,
  max = MAX_FIELD_CHARS,
): string | undefined {
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
  avatar?: string | null;
  bio?: string;
  matchReason: string;
  score: number;
  status?: string;
  /** Present when DiscoverInput.presenter was provided (basic presentation). */
  presentation?: OpportunityPresentationResult;
  /** Present when DiscoverInput.useHomeCardFormat is true (full home card contract). */
  homeCardPresentation?: HomeCardPresentationResult;
  /** Viewer's role in this opportunity. */
  viewerRole?: string;
  /** Narrator chip for home card display (name + remark, with optional avatar/userId for introducer). */
  narratorChip?: {
    name: string;
    text: string;
    avatar?: string | null;
    userId?: string;
  };
}

export interface DiscoverResult {
  found: boolean;
  count: number;
  message?: string;
  opportunities?: FormattedDiscoveryCandidate[];
  /** When true, the chat agent should call create_intent(suggestedIntentDescription) and retry discovery. */
  createIntentSuggested?: boolean;
  /** Description to pass to create_intent when createIntentSuggested is true. */
  suggestedIntentDescription?: string;
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
    /mentor|guide|guidance|learn from|advice from|someone to teach|teach me/.test(
      q,
    )
  ) {
    base.push("mentor");
  }
  if (
    /investor|invest|funding|raise|seed|series|vc|capital|back (us|me|this)/.test(
      q,
    )
  ) {
    base.push("investor");
  }
  if (
    /co-?founder|collaborator|partner|peer|build together|work together|collaborat/.test(
      q,
    )
  ) {
    base.push("collaborator");
  }
  if (
    /hire|hiring|who needs|looking for (a |an )?(developer|engineer|designer|react|frontend|backend)|job|role|position|developer needed|engineer needed/.test(
      q,
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
  input: DiscoverInput,
): Promise<DiscoverResult> {
  const {
    opportunityGraph,
    database,
    userId,
    query,
    indexScope,
    limit = 5,
    triggerIntentId,
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
    initialStatus: "latent",
  };
  if (queryOrEmpty) {
    options.strategies = selectStrategiesFromQuery(queryOrEmpty);
  }

  return withCallLogging(
    logger,
    "runDiscoverFromQuery",
    {
      userId,
      queryPreview: queryOrEmpty
        ? queryOrEmpty.substring(0, 50)
        : "(using user intents in scope)",
      indexScopeCount: indexScope.length,
      limit,
    },
    async () => {
      const result = await opportunityGraph.invoke({
        userId,
        searchQuery: queryOrEmpty || undefined,
        indexId: indexScope.length === 1 ? indexScope[0] : undefined,
        triggerIntentId,
        options,
      });

      if (result.createIntentSuggested && result.suggestedIntentDescription) {
        return {
          found: false,
          count: 0,
          createIntentSuggested: true,
          suggestedIntentDescription: result.suggestedIntentDescription,
          message:
            "No matching opportunities; add an intent with the suggested description to improve discovery.",
        };
      }

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
          const viewerActor = opp.actors.find((a) => a.userId === userId);
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
            viewerRole: viewerActor?.role ?? "party",
            profile,
            confidence,
          };
        }),
      );

      let presentations: OpportunityPresentationResult[] | undefined;
      let homeCardPresentations: HomeCardPresentationResult[] | undefined;
      let presenterContexts:
        | (Awaited<ReturnType<typeof gatherPresenterContext>> | MinimalPresenterContext)[]
        | undefined;

      if (input.minimalForChat && baseEnriched.length > 0) {
        // Minimal path: no LLM, static labels and match reason only
        homeCardPresentations = baseEnriched.map((item) => ({
          headline: `Connection with ${item.profile?.identity?.name ?? "someone"}`,
          personalizedSummary:
            truncateForChat(
              item.opportunity.interpretation?.reasoning ?? "",
              MINIMAL_MAIN_TEXT_MAX_CHARS,
            ) ?? "A suggested connection.",
          suggestedAction: "Start a conversation to connect.",
          narratorRemark: "Based on your overlap in this community.",
          primaryActionLabel: "Start Chat",
          secondaryActionLabel: "Skip",
          mutualIntentsLabel: "Suggested connection",
        }));
        presenterContexts = baseEnriched.map((item) => ({
          introducerName: item.opportunity.detection.createdByName ?? undefined,
        })) as MinimalPresenterContext[];
      } else if (input.presenter && baseEnriched.length > 0) {
        try {
          presenterContexts = await Promise.all(
            baseEnriched.map(({ opportunity }) =>
              gatherPresenterContext(database, opportunity, userId),
            ),
          );

          if (input.useHomeCardFormat) {
            // Use full home card format with action labels, narrator remark, etc.
            // In this branch presenterContexts is from gatherPresenterContext (full PresenterInput)
            const fullContexts = presenterContexts as Awaited<
              ReturnType<typeof gatherPresenterContext>
            >[];
            const homeCardInputs: HomeCardPresenterInput[] = fullContexts.map(
              (ctx, idx) => ({
                ...ctx,
                mutualIntentCount: undefined, // Could compute mutual intents if needed
                opportunityStatus: baseEnriched[idx].opportunity.status,
              }),
            );
            homeCardPresentations = await input.presenter.presentHomeCardBatch(
              homeCardInputs,
              { concurrency: 5 },
            );
          } else {
            // Use basic presentation format; presenterContexts is full type from gatherPresenterContext
            presentations = await input.presenter.presentBatch(
              presenterContexts as Awaited<
                ReturnType<typeof gatherPresenterContext>
              >[],
              {
                concurrency: 5,
              },
            );
          }
        } catch (error) {
          logger.warn(
            "Presenter enrichment failed during opportunity discovery; returning base results without presentations",
            {
              userId,
              opportunitiesCount: baseEnriched.length,
              useHomeCardFormat: input.useHomeCardFormat,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          presentations = undefined;
          homeCardPresentations = undefined;
        }
      }

      // Batch-fetch user avatars (candidates + introducers for narrator chip)
      const introducerUserIds = new Set<string>();
      for (const item of baseEnriched) {
        const introducer = item.opportunity.actors.find(
          (a) => a.role === "introducer" && a.userId !== userId,
        );
        if (introducer?.userId) introducerUserIds.add(introducer.userId);
      }
      const candidateUserIds = [
        ...new Set([
          ...baseEnriched.map((item) => item.candidateUserId),
          ...introducerUserIds,
        ]),
      ];
      const userResults = await Promise.all(
        candidateUserIds.map((id) => database.getUser(id)),
      );
      const avatarByUserId = new Map<string, string | null>();
      candidateUserIds.forEach((id, i) => {
        const user = userResults[i] ?? null;
        avatarByUserId.set(id, user?.avatar ?? null);
      });

      const enriched: FormattedDiscoveryCandidate[] = baseEnriched.map(
        (item, idx) => {
          const homeCard = homeCardPresentations?.[idx];
          const ctx = presenterContexts?.[idx];

          // Build narrator chip for home card format
          let narratorChip: FormattedDiscoveryCandidate["narratorChip"];
          if (homeCard) {
            // Check if this is an introduction (has introducer actor)
            const introducerActor = item.opportunity.actors.find(
              (a) => a.role === "introducer" && a.userId !== userId,
            );
            if (introducerActor && ctx?.introducerName) {
              narratorChip = {
                name: ctx.introducerName,
                text: homeCard.narratorRemark,
                userId: introducerActor.userId,
                avatar: avatarByUserId.get(introducerActor.userId) ?? null,
              };
            } else {
              narratorChip = {
                name: "Index",
                text: homeCard.narratorRemark,
              };
            }
          }

          return {
            opportunityId: item.opportunity.id,
            userId: item.candidateUserId,
            name: item.profile?.identity?.name ?? undefined,
            avatar: avatarByUserId.get(item.candidateUserId) ?? null,
            bio: truncateForChat(item.profile?.identity?.bio),
            matchReason:
              truncateForChat(
                item.opportunity.interpretation?.reasoning ?? "",
              ) ?? "",
            score: item.confidence,
            status: item.opportunity.status,
            viewerRole: item.viewerRole,
            ...(presentations?.[idx] && { presentation: presentations[idx] }),
            ...(homeCard && { homeCardPresentation: homeCard }),
            ...(narratorChip && { narratorChip }),
          };
        },
      );

      return {
        found: true,
        count: enriched.length,
        opportunities: enriched,
      };
    },
    { context: { userId }, logOutput: false },
  ).catch((err) => {
    return {
      found: false,
      count: 0,
      message: "Failed to search for opportunities. Please try again.",
    };
  });
}
