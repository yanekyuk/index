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
import { viewerCentricCardSummary, narratorRemarkFromReasoning } from "./opportunity.card-text";
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
  /** When set (e.g. from chat), create opportunities as draft with context.conversationId = chatSessionId. */
  chatSessionId?: string;
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

/** One step for debug visibility (subgraph/subtask). */
export interface DiscoverDebugStep {
  step: string;
  detail?: string;
}

/** One existing connection (no new opportunity created; user already has one with this person). */
export interface ExistingConnection {
  userId: string;
  name: string;
  status?: string;
  opportunityId?: string;
}

/** Statuses for which an existing connection may be shown as a card; others (pending, viewed, accepted, rejected, expired) are only mentioned in text. */
const EXISTING_CONNECTION_CARD_STATUSES = ['draft', 'latent'] as const;

export interface DiscoverResult {
  found: boolean;
  count: number;
  message?: string;
  opportunities?: FormattedDiscoveryCandidate[];
  /** Existing connections eligible for card display (draft or latent only). Others are mention-only. */
  existingConnections?: ExistingConnection[];
  /** All existing connections for mention text (e.g. "You already have a connection with: X (pending), Y (draft)."). */
  existingConnectionsForMention?: ExistingConnection[];
  /** When true, the chat agent should call create_intent(suggestedIntentDescription) and retry discovery. */
  createIntentSuggested?: boolean;
  /** Description to pass to create_intent when createIntentSuggested is true. */
  suggestedIntentDescription?: string;
  /** Internal steps for copy-debug (select_strategies, opportunity_graph, enrich, etc.). */
  debugSteps?: DiscoverDebugStep[];
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
    chatSessionId,
  } = input;

  if (indexScope.length === 0) {
    return {
      found: false,
      count: 0,
      message:
        "You need to join at least one index (community) to discover opportunities. Use read_indexes to see available indexes, or create one.",
    };
  }

  const debugSteps: DiscoverDebugStep[] = [];

  // When query is empty, the opportunity graph uses the user's intents in scope (indexedIntents[0].payload) and derives strategies from that
  const queryOrEmpty = query?.trim() ?? "";
  const options: OpportunityGraphOptions = {
    limit,
    initialStatus: chatSessionId ? "draft" : "latent",
    ...(chatSessionId ? { conversationId: chatSessionId } : {}),
  };
  if (queryOrEmpty) {
    options.strategies = selectStrategiesFromQuery(queryOrEmpty);
    debugSteps.push({
      step: "select_strategies",
      detail: (options.strategies ?? []).join(", "),
    });
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
        if (chatSessionId) {
          return {
            found: false,
            count: 0,
            message: "No matching opportunities found. Try a different query.",
          };
        }
        return {
          found: false,
          count: 0,
          createIntentSuggested: true,
          suggestedIntentDescription: result.suggestedIntentDescription,
          message:
            "No matching opportunities; add an intent with the suggested description to improve discovery.",
          debugSteps,
        };
      }

      let opportunities: Opportunity[] = Array.isArray(result.opportunities)
        ? result.opportunities
        : [];
      const rawExistingBetweenActors = Array.isArray(result.existingBetweenActors)
        ? result.existingBetweenActors
        : [];
      // Enrich existing-between-actors with names so the tool can say "You already have a connection with X (pending)."
      const existingConnections: ExistingConnection[] = await Promise.all(
        rawExistingBetweenActors.map(async (item) => {
          const user = await database.getUser(item.candidateUserId);
          return {
            userId: item.candidateUserId,
            name: user?.name ?? "Someone",
            ...(item.existingStatus ? { status: item.existingStatus } : {}),
            ...(item.existingOpportunityId ? { opportunityId: item.existingOpportunityId } : {}),
          };
        }),
      );
      if (existingConnections.length > 0) {
        logger.info("[runDiscoverFromQuery] Skipped duplicates; existing connections", {
          count: existingConnections.length,
          userIds: existingConnections.map((c) => c.userId),
        });
      }
      // Only expose existing connections as cards when status is in EXISTING_CONNECTION_CARD_STATUSES (draft, latent); others are mention-only.
      const existingConnectionsForCards = existingConnections.filter((c) =>
        c.status != null && EXISTING_CONNECTION_CARD_STATUSES.includes(c.status as typeof EXISTING_CONNECTION_CARD_STATUSES[number])
      );
      // Chat discovery: when we have chatSessionId we just invoked the graph; all result.opportunities
      // were created in this call and belong to this session. Do not filter by status: the enricher
      // may set status to pending/latent when merging with related opportunities, so filtering to
      // "draft" would incorrectly drop them.
      if (chatSessionId && (result.opportunities?.length ?? 0) > 0) {
        logger.info("[runDiscoverFromQuery] Chat session opportunities from graph", {
          count: opportunities.length,
          statuses: opportunities.map((o) => o.status),
        });
      }
      debugSteps.push({
        step: "opportunity_graph",
        detail: `${opportunities.length} opportunity(ies)${existingConnections.length > 0 ? `, ${existingConnections.length} existing` : ""}`,
      });
      if (opportunities.length === 0) {
        if (existingConnections.length > 0) {
          return {
            found: true,
            count: 0,
            message:
              "No new opportunities created; you already have a connection with: " +
              existingConnections.map((c) => `${c.name}${c.status ? ` (${c.status})` : ""}`).join(", ") +
              ". View on your home page.",
            existingConnections: existingConnectionsForCards,
            existingConnectionsForMention: existingConnections,
            debugSteps,
          };
        }
        return {
          found: false,
          count: 0,
          message:
            "No matching opportunities found. Try a different query or create intents to improve matching.",
          debugSteps,
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
      debugSteps.push({
        step: "enrich_profiles",
        detail: `${baseEnriched.length} profile(s)`,
      });

      // Batch-fetch user records (candidates + introducers) for name/avatar fallback.
      // Moved before presentation so name fallback and viewerName are available.
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
      const [viewerUser, ...userResults] = await Promise.all([
        database.getUser(userId),
        ...candidateUserIds.map((id) => database.getUser(id)),
      ]);
      const avatarByUserId = new Map<string, string | null>();
      const nameByUserId = new Map<string, string | null>();
      candidateUserIds.forEach((id, i) => {
        const user = userResults[i] ?? null;
        avatarByUserId.set(id, user?.avatar ?? null);
        nameByUserId.set(id, user?.name ?? null);
      });
      const viewerName = viewerUser?.name ?? undefined;

      let presentations: OpportunityPresentationResult[] | undefined;
      let homeCardPresentations: HomeCardPresentationResult[] | undefined;
      let presenterContexts:
        | (Awaited<ReturnType<typeof gatherPresenterContext>> | MinimalPresenterContext)[]
        | undefined;

      if (input.minimalForChat && baseEnriched.length > 0) {
        // Minimal path: no LLM, viewer-centric card text (introduce counterpart to viewer)
        const counterpartName = (n: {
          profile?: { identity?: { name?: string } } | null;
          candidateUserId: string;
        }) => n.profile?.identity?.name ?? nameByUserId.get(n.candidateUserId) ?? "";
        homeCardPresentations = baseEnriched.map((item) => {
          const name = counterpartName(item);
          const reasoning = item.opportunity.interpretation?.reasoning ?? "";
          return {
            headline: `Connection with ${name}`,
            personalizedSummary:
              viewerCentricCardSummary(
                reasoning,
                name,
                MINIMAL_MAIN_TEXT_MAX_CHARS,
                viewerName,
              ),
            suggestedAction: "Start a conversation to connect.",
            narratorRemark: narratorRemarkFromReasoning(reasoning, name, viewerName),
            primaryActionLabel: "Start Chat",
            secondaryActionLabel: "Skip",
            mutualIntentsLabel: "Suggested connection",
          };
        });
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
            name: item.profile?.identity?.name ?? nameByUserId.get(item.candidateUserId) ?? undefined,
            avatar: avatarByUserId.get(item.candidateUserId) ?? null,
            bio: truncateForChat(item.profile?.identity?.bio),
            matchReason:
              truncateForChat(
                item.opportunity.interpretation?.reasoning ?? "",
              ) ?? "",
            score: item.confidence,
            status: chatSessionId ? "draft" : item.opportunity.status,
            viewerRole: item.viewerRole,
            ...(presentations?.[idx] && { presentation: presentations[idx] }),
            ...(homeCard && { homeCardPresentation: homeCard }),
            ...(narratorChip && { narratorChip }),
          };
        },
      );
      debugSteps.push({
        step: "format_cards",
        detail: `${enriched.length} card(s)`,
      });

      return {
        found: true,
        count: enriched.length,
        opportunities: enriched,
        ...(existingConnectionsForCards.length > 0 ? { existingConnections: existingConnectionsForCards } : {}),
        ...(existingConnections.length > 0 ? { existingConnectionsForMention: existingConnections } : {}),
        debugSteps,
      };
    },
    { context: { userId }, logOutput: false },
  ).catch((err) => {
    return {
      found: false,
      count: 0,
      message: "Failed to find opportunities. Please try again.",
    };
  });
}
