import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, UUID_REGEX } from "./tool.helpers";
import { MINIMAL_MAIN_TEXT_MAX_CHARS } from "../support/opportunity.constants";
import { viewerCentricCardSummary } from "../support/opportunity.card-text";
import { runDiscoverFromQuery } from "../support/opportunity.discover";
import type { EvaluatorEntity } from "../agents/opportunity.evaluator";
import { protocolLogger } from "../support/protocol.logger";
import type { Opportunity } from "../interfaces/database.interface";

const logger = protocolLogger("ChatTools:Opportunity");

/**
 * Sanitize JSON string for use inside a markdown code fence (```). Escapes backticks
 * so embedded ``` cannot close the fence prematurely.
 */
function sanitizeJsonForCodeFence(json: string): string {
  return json.replace(/`/g, "\\u0060");
}

/**
 * Build minimal opportunity card data for chat without calling the LLM presenter.
 * Uses only required fields from the opportunity record and counterpart name/avatar
 * so list_opportunities and discovery return quickly.
 */
function buildMinimalOpportunityCard(
  opp: Opportunity,
  viewerId: string,
  counterpartUserId: string,
  counterpartName: string,
  counterpartAvatar: string | null,
  introducerName?: string | null,
  introducerAvatar?: string | null,
): {
  opportunityId: string;
  userId: string;
  name: string;
  avatar: string | null;
  mainText: string;
  cta: string;
  headline: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  mutualIntentsLabel: string;
  narratorChip: { name: string; text: string; avatar?: string | null; userId?: string };
  viewerRole: string;
  score: number | undefined;
  status: string;
} {
  const viewerActor = opp.actors.find((a) => a.userId === viewerId);
  const viewerRole = viewerActor?.role ?? "party";
  const introducerActor = opp.actors.find(
    (a) => a.role === "introducer" && a.userId !== viewerId,
  );
  const mainText = viewerCentricCardSummary(
    opp.interpretation?.reasoning ?? "",
    counterpartName,
    MINIMAL_MAIN_TEXT_MAX_CHARS,
  );
  const score =
    typeof opp.interpretation?.confidence === "number"
      ? opp.interpretation.confidence
      : undefined;
  const narratorName =
    introducerName ?? (introducerActor ? "Someone" : "Index");
  const primaryActionLabel =
    viewerRole === "introducer"
      ? `Send to ${counterpartName || "them"}`
      : "Start Chat";
  return {
    opportunityId: opp.id,
    userId: counterpartUserId,
    name: counterpartName,
    avatar: counterpartAvatar,
    mainText,
    cta: "Start a conversation to connect.",
    headline: `Connection with ${counterpartName}`,
    primaryActionLabel,
    secondaryActionLabel: "Skip",
    mutualIntentsLabel: "Suggested connection",
    narratorChip: {
      name: narratorName,
      text: "Based on your overlap in this community.",
      ...(introducerActor
        ? { userId: introducerActor.userId, avatar: introducerAvatar ?? null }
        : {}),
    },
    viewerRole,
    score,
    status: opp.status ?? "latent",
  };
}

export function createOpportunityTools(defineTool: DefineTool, deps: ToolDeps) {
  const { database, userDb, systemDb, graphs, embedder } = deps;

  const createOpportunities = defineTool({
    name: "create_opportunities",
    description:
      "Creates opportunities (connections). Two modes:\n" +
      "1. **Discovery**: pass searchQuery and/or indexId. Finds matching people based on intent overlap.\n" +
      "2. **Introduction**: pass partyUserIds (2+ user IDs) + entities (pre-gathered profiles and intents). " +
      "You MUST gather profiles and intents from shared indexes BEFORE calling this. " +
      "Optionally pass hint (the user's reason for the introduction).\n\n" +
      "Results are saved as drafts; use update_opportunity(status='pending') to send.",
    querySchema: z.object({
      searchQuery: z
        .string()
        .optional()
        .describe("Discovery mode: what to look for."),
      indexId: z
        .string()
        .optional()
        .describe("Index UUID; optional when index-scoped."),
      intentId: z
        .string()
        .optional()
        .describe("Discovery mode: optional intent to use as source and for triggeredBy (e.g. from queue)."),
      partyUserIds: z
        .array(z.string())
        .optional()
        .describe("Introduction mode: user IDs to introduce (at least 2)."),
      entities: z
        .array(
          z.object({
            userId: z.string(),
            profile: z
              .object({
                name: z.string().optional(),
                bio: z.string().optional(),
                location: z.string().optional(),
                interests: z.array(z.string()).optional(),
                skills: z.array(z.string()).optional(),
                context: z.string().optional(),
              })
              .optional(),
            intents: z
              .array(
                z.object({
                  intentId: z.string(),
                  payload: z.string(),
                  summary: z.string().optional(),
                }),
              )
              .optional(),
            indexId: z
              .string()
              .describe("Shared index this entity's data comes from (required for intro mode)"),
          }),
        )
        .optional()
        .describe(
          "Introduction mode: pre-gathered profiles + intents per party. Gather via read_user_profiles + read_intents before calling.",
        ),
      hint: z
        .string()
        .optional()
        .describe(
          "Introduction mode: the user's reason for the intro (e.g. 'both AI devs').",
        ),
    }),
    handler: async ({ context, query }) => {
      // Strict scope enforcement: when chat is index-scoped, only allow that index
      if (
        context.indexId &&
        query.indexId?.trim() &&
        query.indexId.trim() !== context.indexId
      ) {
        return error(
          `This chat is scoped to ${context.indexName ?? "this index"}. You can only create opportunities in this community.`,
        );
      }

      const effectiveIndexId =
        (context.indexId || query.indexId?.trim()) ?? undefined;

      // ── Introduction mode ── (validation and persistence via opportunity graph)
      if (query.partyUserIds && query.partyUserIds.length >= 2) {
        if (!query.entities || query.entities.length === 0) {
          return error(
            "Introduction requires pre-gathered entity data. " +
              "First use read_index_memberships to find shared indexes, " +
              "then read_user_profiles and read_intents for each party, " +
              "then pass the results as entities.",
          );
        }

        const primaryIndexId = query.entities[0]?.indexId;
        if (!primaryIndexId) {
          return error(
            "Each entity must include an indexId (the shared index).",
          );
        }

        const introducedPartyUserIds = query.partyUserIds.filter(
          (uid) => uid !== context.userId,
        );
        if (introducedPartyUserIds.length === 0) {
          return error(
            "No counterpart to introduce. Provide at least one other user ID in partyUserIds (besides yourself).",
          );
        }

        const evaluatorEntities: EvaluatorEntity[] = query.entities.map(
          (e) => ({
            userId: e.userId,
            profile: e.profile ?? {},
            intents: e.intents,
            indexId: e.indexId,
          }),
        );

        const result = await graphs.opportunity.invoke({
          operationMode: "create_introduction",
          userId: context.userId,
          indexId: primaryIndexId,
          introductionEntities: evaluatorEntities,
          introductionHint: query.hint,
          requiredIndexId: context.indexId ?? undefined,
        });

        if (result.error || !result.opportunities?.length) {
          return error(
            result.error ?? "Failed to create introduction.",
          );
        }

        const created = result.opportunities[0];
        const reasoning =
          created.interpretation?.reasoning ?? "A suggested connection.";
        const confidence =
          typeof created.interpretation?.confidence === "number"
            ? created.interpretation.confidence
            : parseFloat(String(created.confidence ?? 0)) || 0;
        const introducerUser = await userDb.getUser();
        const firstPartyId = introducedPartyUserIds[0];
        const firstEntity = query.entities?.find((e) => e.userId === firstPartyId);
        const counterpartUser = firstPartyId
          ? await database.getUser(firstPartyId)
          : null;
        const counterpartName =
          firstEntity?.profile?.name ?? firstPartyId ?? "Someone";
        const cardData = {
          opportunityId: created.id,
          userId: firstPartyId,
          name: counterpartName,
          avatar:
            counterpartUser?.avatar ??
            (firstEntity?.profile as { avatar?: string | null } | undefined)
              ?.avatar ??
            null,
          mainText: viewerCentricCardSummary(
            reasoning,
            counterpartName,
            MINIMAL_MAIN_TEXT_MAX_CHARS,
          ),
          cta: "Start a conversation to connect.",
          headline: `Connection with ${counterpartName}`,
          primaryActionLabel: `Send to ${counterpartName || "them"}`,
          secondaryActionLabel: "Skip",
          mutualIntentsLabel: "Suggested connection",
          narratorChip: {
            name: introducerUser?.name ?? "A member",
            text: "Based on your overlap in this community.",
            userId: context.userId,
          },
          viewerRole: "introducer",
          score: confidence,
          status: created.status ?? "latent",
        };
        const block =
          "```opportunity\n" +
          sanitizeJsonForCodeFence(JSON.stringify(cardData)) +
          "\n```";

        return success({
          found: true,
          count: 1,
          message: `Draft introduction created. IMPORTANT: Include the following \`\`\`opportunity code block EXACTLY as-is in your response (it renders as an interactive card):\n\n${block}`,
          opportunities: [
            {
              opportunityId: created.id,
              matchReason: reasoning,
              score: confidence,
              status: created.status ?? "latent",
            },
          ],
        });
      }

      // ── Discovery mode ──
      const searchQuery = query.searchQuery?.trim() ?? "";

      if (query.intentId != null && query.intentId !== "" && !UUID_REGEX.test(query.intentId.trim())) {
        return error("Invalid intent ID format.");
      }

      let indexScope: string[];
      if (effectiveIndexId) {
        if (!UUID_REGEX.test(effectiveIndexId)) {
          return error("Invalid index ID format.");
        }
        const memberResult = await graphs.indexMembership.invoke({
          userId: context.userId,
          indexId: effectiveIndexId,
          operationMode: "read" as const,
        });
        if (memberResult.error) {
          return error("Index not found or you are not a member.");
        }
        indexScope = [effectiveIndexId];
      } else if (context.indexId) {
        // When scoped but no explicit indexId, use the scoped index
        indexScope = [context.indexId];
      } else {
        // No scope - use all indexes (only in unscoped chat)
        const indexResult = await graphs.index.invoke({
          userId: context.userId,
          operationMode: "read" as const,
          showAll: true,
        });
        indexScope = (indexResult.readResult?.memberOf || []).map(
          (m: { indexId: string }) => m.indexId,
        );
      }

      const triggerIntentId = query.intentId?.trim() || undefined;
      if (triggerIntentId != null && !UUID_REGEX.test(triggerIntentId)) {
        return error("Invalid intent ID format.");
      }

      const result = await runDiscoverFromQuery({
        opportunityGraph: graphs.opportunity as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        database,
        userId: context.userId,
        query: searchQuery,
        indexScope,
        limit: 5,
        minimalForChat: true, // Skip LLM presenter; return only required fields for fast chat
        triggerIntentId,
      });

      if (result.createIntentSuggested && result.suggestedIntentDescription) {
        return success({
          found: false,
          count: 0,
          createIntentSuggested: true,
          suggestedIntentDescription: result.suggestedIntentDescription,
          message:
            "No matching opportunities found. Call create_intent with the suggested description, then create_opportunities again.",
        });
      }

      if (!result.found) {
        return success({
          found: false,
          count: 0,
          message: result.message ?? "No matching opportunities found.",
        });
      }

      // Format opportunities as code blocks for the LLM to include in its response
      // The frontend will parse ```opportunity blocks and render them as cards
      const opportunityBlocks = (result.opportunities ?? []).map((opp) => {
        const cardData = {
          opportunityId: opp.opportunityId,
          userId: opp.userId,
          name: opp.name,
          avatar: opp.avatar,
          mainText:
            opp.homeCardPresentation?.personalizedSummary ??
            opp.matchReason ??
            "",
          cta: opp.homeCardPresentation?.suggestedAction,
          headline: opp.homeCardPresentation?.headline,
          primaryActionLabel: opp.homeCardPresentation?.primaryActionLabel,
          secondaryActionLabel: opp.homeCardPresentation?.secondaryActionLabel,
          mutualIntentsLabel: opp.homeCardPresentation?.mutualIntentsLabel,
          narratorChip: opp.narratorChip,
          viewerRole: opp.viewerRole,
          score: opp.score,
          status: opp.status,
        };
        return (
          "```opportunity\n" +
          sanitizeJsonForCodeFence(JSON.stringify(cardData)) +
          "\n```"
        );
      });

      // Join all opportunity blocks into a single string for the LLM to include verbatim
      const blocksText = opportunityBlocks.join("\n\n");

      return success({
        found: true,
        count: result.count,
        message: `Found ${result.count} potential connection(s). IMPORTANT: Include the following \`\`\`opportunity code blocks EXACTLY as-is in your response (they render as interactive cards):\n\n${blocksText}`,
      });
    },
  });

  const listOpportunities = defineTool({
    name: "list_opportunities",
    description:
      "Lists the user's opportunities (suggested connections). Returns opportunity cards to display. When chat is index-scoped, only shows opportunities from that index.",
    querySchema: z.object({
      indexId: z
        .string()
        .optional()
        .describe("Index UUID filter; defaults to current index when scoped."),
    }),
    handler: async ({ context, query }) => {
      // Strict scope enforcement: when chat is index-scoped, only allow that index
      if (
        context.indexId &&
        query.indexId?.trim() &&
        query.indexId.trim() !== context.indexId
      ) {
        return error(
          `This chat is scoped to ${context.indexName ?? "this index"}. You can only list opportunities from this community.`,
        );
      }

      const effectiveIndexId =
        (context.indexId || query.indexId?.trim()) ?? undefined;
      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format.");
      }

      // Get opportunities; use minimal card data (no LLM presenter) for fast chat response
      const opportunities = await database.getOpportunitiesForUser(
        context.userId,
        {
          indexId: effectiveIndexId,
          limit: 10,
        },
      );

      if (!opportunities || opportunities.length === 0) {
        return success({
          found: false,
          count: 0,
          message:
            "You have no opportunities yet. Use create_opportunities to find connections.",
        });
      }

      // Batch-fetch profiles and users for all counterpart and introducer userIds to avoid N+1
      const counterpartUserIds = new Set<string>();
      const introducerUserIds = new Set<string>();
      for (const opp of opportunities) {
        const counterpartActor = opp.actors.find(
          (a) => a.userId !== context.userId && a.role !== "introducer",
        );
        if (counterpartActor?.userId) counterpartUserIds.add(counterpartActor.userId);
        const introducerActor = opp.actors.find(
          (a) => a.role === "introducer" && a.userId !== context.userId,
        );
        if (introducerActor?.userId) introducerUserIds.add(introducerActor.userId);
      }
      const allUserIds = [
        ...new Set([...counterpartUserIds, ...introducerUserIds]),
      ];
      const [profileResults, userResults] = await Promise.all([
        Promise.all(allUserIds.map((id) => database.getProfile(id))),
        Promise.all(allUserIds.map((id) => database.getUser(id))),
      ]);
      const profileMap = new Map<string, Awaited<ReturnType<typeof database.getProfile>>>();
      const userMap = new Map<string, Awaited<ReturnType<typeof database.getUser>>>();
      allUserIds.forEach((userId, i) => {
        const profile = profileResults[i] ?? null;
        const user = userResults[i] ?? null;
        if (profile) profileMap.set(userId, profile);
        if (user) userMap.set(userId, user);
      });

      const opportunityBlocks: string[] = [];

      for (const opp of opportunities) {
        try {
          const counterpartActor = opp.actors.find(
            (a) => a.userId !== context.userId && a.role !== "introducer",
          );
          const counterpartUserId = counterpartActor?.userId;
          if (!counterpartUserId) continue;

          const introducerActor = opp.actors.find(
            (a) => a.role === "introducer" && a.userId !== context.userId,
          );
          const createdByName = opp.detection.createdByName;

          const counterpartProfile = profileMap.get(counterpartUserId) ?? null;
          const counterpartUser = userMap.get(counterpartUserId) ?? null;
          const introducerProfile =
            introducerActor && !createdByName
              ? profileMap.get(introducerActor.userId) ?? null
              : null;

          const counterpartName =
            counterpartProfile?.identity?.name ??
            counterpartUser?.name ??
            "Someone";
          const introducerName =
            createdByName ??
            (introducerActor ? introducerProfile?.identity?.name ?? null : null);
          const introducerUser = introducerActor
            ? userMap.get(introducerActor.userId) ?? null
            : null;

          const cardData = buildMinimalOpportunityCard(
            opp,
            context.userId,
            counterpartUserId,
            counterpartName,
            counterpartUser?.avatar ?? null,
            introducerName,
            introducerUser?.avatar ?? null,
          );

          opportunityBlocks.push(
            "```opportunity\n" +
              sanitizeJsonForCodeFence(JSON.stringify(cardData)) +
              "\n```",
          );
        } catch (err) {
          logger.warn("Skipping opportunity that failed to build minimal card", {
            opportunityId: opp.id,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
      }

      if (opportunityBlocks.length === 0) {
        return success({
          found: false,
          count: 0,
          message:
            "You have no opportunities yet. Use create_opportunities to find connections.",
        });
      }

      // Join all opportunity blocks into a single string for the LLM to include verbatim
      const blocksText = opportunityBlocks.join("\n\n");

      return success({
        found: true,
        count: opportunityBlocks.length,
        message: `You have ${opportunityBlocks.length} opportunity(ies). IMPORTANT: Include the following \`\`\`opportunity code blocks EXACTLY as-is in your response (they render as interactive cards):\n\n${blocksText}`,
      });
    },
  });

  const updateOpportunity = defineTool({
    name: "update_opportunity",
    description:
      "Updates an opportunity's status. Use 'pending' to send a draft (notifies next person). Use 'accepted'/'rejected' to respond to a received opportunity. When chat is index-scoped, can only update opportunities from that index.",
    querySchema: z.object({
      opportunityId: z
        .string()
        .describe("Opportunity ID from list_opportunities"),
      status: z
        .enum(["pending", "accepted", "rejected", "expired"])
        .describe(
          "New status: pending (send draft), accepted, rejected, expired",
        ),
    }),
    handler: async ({ context, query }) => {
      const opportunityId = query.opportunityId?.trim();
      if (!opportunityId || !UUID_REGEX.test(opportunityId)) {
        return error("Valid opportunityId required.");
      }

      // Strict scope enforcement: when chat is index-scoped, verify opportunity is in that index
      if (context.indexId) {
        const opportunity = await systemDb.getOpportunity(opportunityId);
        if (!opportunity) {
          return error("Opportunity not found.");
        }
        const opportunityIndexId = opportunity.context?.indexId;
        if (!opportunityIndexId || opportunityIndexId !== context.indexId) {
          return error("Opportunity not found.");
        }
      }

      const isSend = query.status === "pending";
      const result = await graphs.opportunity.invoke({
        userId: context.userId,
        operationMode: isSend ? ("send" as const) : ("update" as const),
        opportunityId: query.opportunityId,
        ...(isSend ? {} : { newStatus: query.status }),
      });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            opportunityId: result.mutationResult.opportunityId,
            status: query.status,
            message: result.mutationResult.message,
            ...(result.mutationResult.notified && {
              notified: result.mutationResult.notified,
            }),
          });
        }
        return error(
          result.mutationResult.error || "Failed to update opportunity.",
        );
      }
      return error("Failed to update opportunity.");
    },
  });

  return [createOpportunities, listOpportunities, updateOpportunity] as const;
}
