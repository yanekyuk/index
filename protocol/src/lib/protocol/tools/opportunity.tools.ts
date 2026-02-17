import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, UUID_REGEX } from "./tool.helpers";
import { runDiscoverFromQuery } from "../support/opportunity.discover";
import { enrichOrCreate } from "../support/opportunity.enricher";
import { OpportunityPresenter } from "../agents/opportunity.presenter";
import { OpportunityEvaluator } from "../agents/opportunity.evaluator";
import type { EvaluatorEntity, EvaluatorInput } from "../agents/opportunity.evaluator";
import { protocolLogger } from "../support/protocol.logger";

const logger = protocolLogger("ChatTools:Opportunity");

export function createOpportunityTools(defineTool: DefineTool, deps: ToolDeps) {
  const { database, userDb, systemDb, graphs, embedder } = deps;
  const presenter = new OpportunityPresenter();

  const createOpportunities = defineTool({
    name: "create_opportunities",
    description:
      "Creates opportunities (connections). Two modes:\n" +
      "1. **Discovery**: pass searchQuery and/or indexId. Finds matching people via semantic search.\n" +
      "2. **Introduction**: pass partyUserIds (2+ user IDs) + entities (pre-gathered profiles and intents). " +
      "You MUST gather profiles and intents from shared indexes BEFORE calling this. " +
      "Optionally pass hint (the user's reason for the introduction).\n\n" +
      "Results are saved as drafts; use update_opportunity(status='pending') to send.",
    querySchema: z.object({
      searchQuery: z.string().optional().describe("Discovery mode: what to search for."),
      indexId: z.string().optional().describe("Index UUID; optional when index-scoped."),
      partyUserIds: z.array(z.string()).optional().describe("Introduction mode: user IDs to introduce (at least 2)."),
      entities: z.array(z.object({
        userId: z.string(),
        profile: z.object({
          name: z.string().optional(),
          bio: z.string().optional(),
          location: z.string().optional(),
          interests: z.array(z.string()).optional(),
          skills: z.array(z.string()).optional(),
          context: z.string().optional(),
        }).optional(),
        intents: z.array(z.object({
          intentId: z.string(),
          payload: z.string(),
          summary: z.string().optional(),
        })).optional(),
        indexId: z.string().describe("Shared index this entity's data comes from"),
      })).optional().describe("Introduction mode: pre-gathered profiles + intents per party. Gather via read_user_profiles + read_intents before calling."),
      hint: z.string().optional().describe("Introduction mode: the user's reason for the intro (e.g. 'both AI devs')."),
    }),
    handler: async ({ context, query }) => {
      // Strict scope enforcement: when chat is index-scoped, only allow that index
      if (context.indexId && query.indexId?.trim() && query.indexId.trim() !== context.indexId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only create opportunities in this community.`
        );
      }

      const effectiveIndexId = (context.indexId || query.indexId?.trim()) ?? null;

      // ── Introduction mode ──
      if (query.partyUserIds && query.partyUserIds.length >= 2) {
        if (!query.entities || query.entities.length === 0) {
          return error(
            "Introduction requires pre-gathered entity data. " +
            "First use read_index_memberships to find shared indexes, " +
            "then read_user_profiles and read_intents for each party, " +
            "then pass the results as entities."
          );
        }

        const primaryIndexId = query.entities[0]?.indexId;
        if (!primaryIndexId) {
          return error("Each entity must include an indexId (the shared index).");
        }

        // Strict scope enforcement: when chat is index-scoped, primaryIndexId must match
        if (context.indexId && primaryIndexId !== context.indexId) {
          return error(
            `This chat is scoped to ${context.indexName ?? 'this index'}. You can only introduce members of this community.`
          );
        }

        // Verify introducer (caller) is a member of the primary index
        const introducerIsMember = await systemDb.isIndexMember(primaryIndexId, context.userId);
        if (!introducerIsMember) {
          return error(
            "One or more users are not members of the specified community. You can only introduce members who share an index."
          );
        }

        // Verify all party users are members of the primary index
        for (const userId of query.partyUserIds) {
          if (userId === context.userId) continue; // Skip self (we know we're a member)
          const isMember = await systemDb.isIndexMember(primaryIndexId, userId);
          if (!isMember) {
            return error(
              "One or more users are not members of the specified community. You can only introduce members who share an index."
            );
          }
        }

        // Map entities to evaluator format
        const evaluatorEntities: EvaluatorEntity[] = query.entities.map((e) => ({
          userId: e.userId,
          profile: e.profile ?? {},
          intents: e.intents,
          indexId: e.indexId,
        }));

        // Check for existing opportunity
        const partyUserIds = query.partyUserIds;
        // Use systemDb for cross-user opportunity checks
        const exists = await systemDb.opportunityExistsBetweenActors(partyUserIds, primaryIndexId);
        if (exists) {
          return error("An opportunity already exists between these people.");
        }

        // Run evaluator
        const evaluator = new OpportunityEvaluator();
        // Use userDb for own user data
        const introducerUser = await userDb.getUser();
        const evalInput: EvaluatorInput = {
          discovererId: context.userId,
          entities: evaluatorEntities,
          introductionMode: true,
          introducerName: introducerUser?.name ?? undefined,
          introductionHint: query.hint ?? undefined,
        };

        let reasoning: string;
        let score: number;
        let evaluatedActors: Array<{ userId: string; role: string; intentId?: string }> = [];

        try {
          const evaluated = await evaluator.invokeEntityBundle(evalInput, { minScore: 0 });
          if (evaluated.length > 0) {
            const best = evaluated[0];
            reasoning = best.reasoning;
            score = best.score;
            evaluatedActors = best.actors.map((a) => ({
              userId: a.userId,
              role: a.role,
              ...(a.intentId != null ? { intentId: a.intentId } : {}),
            }));
          } else {
            reasoning = `${introducerUser?.name ?? "A member"} believes these people should connect.` +
              (query.hint ? ` Context: ${query.hint}` : "");
            score = 70;
          }
        } catch (evalErr) {
          logger.warn("Evaluator failed, using fallback reasoning", { error: evalErr });
          reasoning = `${introducerUser?.name ?? "A member"} believes these people should connect.` +
            (query.hint ? ` Context: ${query.hint}` : "");
          score = 70;
        }

        // Build actors array
        const requiredPartyUserIds = partyUserIds.filter((uid) => uid !== context.userId);
        const evaluatorHasAllParties = requiredPartyUserIds.every((uid) =>
          evaluatedActors.some((a) => a.userId === uid)
        );
        const actors = evaluatorHasAllParties
          ? [
              ...evaluatedActors
                .filter((a) => a.userId !== context.userId)
                .map((a) => ({
                  indexId: primaryIndexId,
                  userId: a.userId,
                  role: a.role as string,
                  ...(a.intentId ? { intent: a.intentId } : {}),
                })),
              { indexId: primaryIndexId, userId: context.userId, role: 'introducer' },
            ]
          : [
              ...requiredPartyUserIds.map((uid) => ({ indexId: primaryIndexId, userId: uid, role: 'party' })),
              { indexId: primaryIndexId, userId: context.userId, role: 'introducer' },
            ];

        // Persist
        const confidence = score / 100;
        const data = {
          detection: {
            source: 'manual' as const,
            createdBy: context.userId,
            createdByName: introducerUser?.name ?? undefined,
            timestamp: new Date().toISOString(),
          },
          actors,
          interpretation: {
            category: 'collaboration' as const,
            reasoning,
            confidence,
            signals: [{ type: 'curator_judgment' as const, weight: 1, detail: `Introduction by ${introducerUser?.name ?? 'a member'} via chat` }],
          },
          context: { indexId: primaryIndexId },
          confidence: String(confidence),
          status: 'latent' as const,
        };

        // Note: enrichOrCreate still uses the legacy database param for now
        const enrichment = await enrichOrCreate(database, embedder, data);
        const toCreate = enrichment.data;
        if (enrichment.enriched) {
          toCreate.status = enrichment.resolvedStatus;
        }
        // Use systemDb for cross-user opportunity creation
        const created = await systemDb.createOpportunity(toCreate);

        if (enrichment.enriched && enrichment.expiredIds.length > 0) {
          for (const id of enrichment.expiredIds) {
            // Use systemDb for opportunity status updates
            await systemDb.updateOpportunityStatus(id, 'expired');
          }
        }

        return success({
          found: true,
          count: 1,
          opportunities: [{
            opportunityId: created.id,
            matchReason: reasoning,
            score: confidence,
            status: created.status ?? 'latent',
          }],
        });
      }

      // ── Discovery mode ──
      const searchQuery = query.searchQuery?.trim() ?? "";

      let indexScope: string[];
      if (effectiveIndexId) {
        if (!UUID_REGEX.test(effectiveIndexId)) {
          return error("Invalid index ID format.");
        }
        const memberResult = await graphs.indexMembership.invoke({
          userId: context.userId,
          indexId: effectiveIndexId,
          operationMode: 'read' as const,
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
          operationMode: 'read' as const,
          showAll: true,
        });
        indexScope = (indexResult.readResult?.memberOf || []).map((m: { indexId: string }) => m.indexId);
      }

      const result = await runDiscoverFromQuery({
        opportunityGraph: graphs.opportunity as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        database,
        userId: context.userId,
        query: searchQuery,
        indexScope,
        limit: 5,
        presenter,
      });

      if (!result.found) {
        return success({
          found: false,
          count: 0,
          message: result.message ?? "No matching opportunities found.",
        });
      }

      return success({
        found: true,
        count: result.count,
        opportunities: result.opportunities ?? [],
      });
    },
  });

  const listOpportunities = defineTool({
    name: "list_opportunities",
    description:
      "Lists the user's opportunities (suggested connections). Returns raw opportunity data — present it conversationally. When chat is index-scoped, only shows opportunities from that index.",
    querySchema: z.object({
      indexId: z.string().optional().describe("Index UUID filter; defaults to current index when scoped."),
    }),
    handler: async ({ context, query }) => {
      // Strict scope enforcement: when chat is index-scoped, only allow that index
      if (context.indexId && query.indexId?.trim() && query.indexId.trim() !== context.indexId) {
        return error(
          `This chat is scoped to ${context.indexName ?? 'this index'}. You can only list opportunities from this community.`
        );
      }

      const effectiveIndexId = (context.indexId || query.indexId?.trim()) ?? undefined;
      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format.");
      }

      const result = await graphs.opportunity.invoke({
        userId: context.userId,
        indexId: effectiveIndexId,
        operationMode: 'read' as const,
      });

      if (!result.readResult) {
        return error("Failed to list opportunities.");
      }
      return success(result.readResult);
    },
  });

  const updateOpportunity = defineTool({
    name: "update_opportunity",
    description:
      "Updates an opportunity's status. Use 'pending' to send a draft (notifies next person). Use 'accepted'/'rejected' to respond to a received opportunity. When chat is index-scoped, can only update opportunities from that index.",
    querySchema: z.object({
      opportunityId: z.string().describe("Opportunity ID from list_opportunities"),
      status: z.enum(["pending", "accepted", "rejected", "expired"]).describe("New status: pending (send draft), accepted, rejected, expired"),
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
        operationMode: isSend ? ('send' as const) : ('update' as const),
        opportunityId: query.opportunityId,
        ...(isSend ? {} : { newStatus: query.status }),
      });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            opportunityId: result.mutationResult.opportunityId,
            status: query.status,
            message: result.mutationResult.message,
            ...(result.mutationResult.notified && { notified: result.mutationResult.notified }),
          });
        }
        return error(result.mutationResult.error || "Failed to update opportunity.");
      }
      return error("Failed to update opportunity.");
    },
  });

  return [createOpportunities, listOpportunities, updateOpportunity] as const;
}
