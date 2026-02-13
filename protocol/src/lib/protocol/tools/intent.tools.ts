import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, UUID_REGEX } from "./tool.helpers";
import type { ExecutionResult } from "../states/intent.state";
import { protocolLogger } from "../support/protocol.logger";

const logger = protocolLogger("ChatTools:Intent");

export function createIntentTools(defineTool: DefineTool, deps: ToolDeps) {
  const { graphs } = deps;

  // ─────────────────────────────────────────────────────────────────────────────
  // INTENT CRUD
  // ─────────────────────────────────────────────────────────────────────────────

  const readIntents = defineTool({
    name: "read_intents",
    description:
      "Reads intents (goals, wants, needs). No indexId: returns the user's own active intents. With indexId: returns all intents in that index; add userId to filter to one user. To find other members' intents, use read_index_memberships first, then read_intents per index.",
    querySchema: z.object({
      indexId: z.string().optional().describe("Index UUID — filters intents to this index. Defaults to current index when scoped."),
      userId: z.string().optional().describe("User ID — filters to this user's intents. Combined with indexId: that user's intents in that index."),
      limit: z.number().int().min(1).max(100).optional().describe("Page size (1-100)."),
      page: z.number().int().min(1).optional().describe("Page number (1-based)."),
    }),
    handler: async ({ context, query }) => {
      const effectiveIndexId = query.indexId?.trim() || context.indexId || undefined;
      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format.");
      }

      const queryUserId = query.userId?.trim() || undefined;

      if (!effectiveIndexId && queryUserId && queryUserId !== context.userId) {
        return error("Cannot read another user's global intents. Use indexId to scope to a shared index.");
      }

      const allUserIntents = !effectiveIndexId && (!queryUserId || queryUserId === context.userId);

      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile: "",
        indexId: effectiveIndexId,
        operationMode: 'read' as const,
        queryUserId,
        allUserIntents,
      });

      if (result.readResult) {
        if (result.readResult.count === 0 && result.readResult.message && /not a member|Index not found/i.test(result.readResult.message)) {
          return error(result.readResult.message);
        }

        const shouldPaginate = query.limit !== undefined || query.page !== undefined;
        if (shouldPaginate && Array.isArray(result.readResult.intents)) {
          const limit = query.limit ?? 20;
          const page = query.page ?? 1;
          const offset = (page - 1) * limit;
          const pagedIntents = result.readResult.intents.slice(offset, offset + limit);
          return success({
            ...result.readResult,
            count: pagedIntents.length,
            totalCount: result.readResult.intents.length,
            limit,
            page,
            totalPages: Math.ceil(result.readResult.intents.length / limit),
            intents: pagedIntents,
          });
        }

        return success(result.readResult);
      }
      return error("Failed to fetch intents.");
    },
  });

  const createIntent = defineTool({
    name: "create_intent",
    description:
      "Creates a new intent (goal/want/need). Pass a clear, concept-based description. If indexId is provided, the intent is linked to that index. Background discovery is triggered automatically after creation. The orchestrator should handle URL scraping and vagueness checks BEFORE calling this tool.",
    querySchema: z.object({
      description: z.string().describe("The intent/goal in conceptual terms (scrape URLs and check specificity before calling)"),
      indexId: z.string().optional().describe("Index UUID to link the intent to. Defaults to current index when scoped."),
    }),
    handler: async ({ context, query }) => {
      if (!query.description?.trim()) {
        return error("Description is required.");
      }

      const effectiveIndexId = query.indexId?.trim() || context.indexId || undefined;

      // Fetch profile (the intent graph needs it for inference)
      const profileResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
      const userProfile = profileResult.profile ? JSON.stringify(profileResult.profile) : "";

      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile,
        inputContent: query.description,
        operationMode: 'create' as const,
        ...(effectiveIndexId ? { indexId: effectiveIndexId } : {}),
      });
      logger.debug("Intent graph response", { result });

      // Process created intents
      const created = (result.executionResults || [])
        .filter((r: ExecutionResult): r is ExecutionResult & { intentId: string } => r.actionType === 'create' && r.success && !!r.intentId)
        .map((r: ExecutionResult & { intentId: string }) => ({
          id: r.intentId,
          description: (r.payload ?? query.description) ?? ''
        }));

      // Link to provided index (force-assign when explicit)
      if (created.length > 0 && effectiveIndexId) {
        for (const intent of created) {
          try {
            await graphs.intentIndex.invoke({
              userId: context.userId,
              indexId: effectiveIndexId,
              intentId: intent.id,
              operationMode: 'create' as const,
              skipEvaluation: true,
            });
          } catch (e) {
            logger.warn("Index assignment failed", { intentId: intent.id, indexId: effectiveIndexId });
          }
        }
      }

      if (created.length > 0) {
        return success({
          created: true,
          intents: created,
          ...(effectiveIndexId && { linkedToIndex: effectiveIndexId }),
        });
      }

      // Handle reconciliation: intent graph may update existing similar intents
      const updated = (result.executionResults || [])
        .filter((r: ExecutionResult): r is ExecutionResult & { intentId: string } => r.actionType === 'update' && r.success && !!r.intentId)
        .map((r: ExecutionResult & { intentId: string }) => r.intentId);

      if (updated.length > 0) {
        return success({ created: false, updated: true, intentIds: updated });
      }

      if (result.inferredIntents?.length > 0) {
        return success({ created: false, message: "Similar intent already exists." });
      }

      return error("Could not extract a clear intent. Try being more specific.");
    },
  });

  const updateIntent = defineTool({
    name: "update_intent",
    description: "Updates an existing intent's description. Requires intentId from read_intents.",
    querySchema: z.object({
      intentId: z.string().describe("Intent UUID from read_intents"),
      newDescription: z.string().describe("New description for the intent"),
    }),
    handler: async ({ context, query }) => {
      const intentId = query.intentId?.trim() ?? "";
      if (!UUID_REGEX.test(intentId)) {
        return error("Invalid intent ID format.");
      }

      const profileResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
      const userProfile = profileResult.profile ? JSON.stringify(profileResult.profile) : "";

      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile,
        operationMode: 'update' as const,
        inputContent: query.newDescription,
        targetIntentIds: [intentId],
      });

      if (result.executionResults?.some((r: ExecutionResult) => !r.success)) {
        return error("Failed to update intent.");
      }
      return success({ message: "Intent updated." });
    },
  });

  const deleteIntent = defineTool({
    name: "delete_intent",
    description: "Deletes (archives) an intent. Requires intentId from read_intents.",
    querySchema: z.object({
      intentId: z.string().describe("Intent UUID from read_intents"),
    }),
    handler: async ({ context, query }) => {
      const intentId = query.intentId?.trim() ?? "";
      if (!UUID_REGEX.test(intentId)) {
        return error("Invalid intent ID format.");
      }

      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile: "",
        operationMode: 'delete' as const,
        targetIntentIds: [intentId],
      });

      if (result.executionResults?.some((r: ExecutionResult) => !r.success)) {
        return error("Failed to delete intent.");
      }
      return success({ message: "Intent archived." });
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INTENT–INDEX JUNCTION (link / list / unlink)
  // ─────────────────────────────────────────────────────────────────────────────

  const createIntentIndex = defineTool({
    name: "create_intent_index",
    description: "Links an intent to an index. Requires intentId and indexId.",
    querySchema: z.object({
      intentId: z.string().describe("Intent UUID from read_intents"),
      indexId: z.string().describe("Index UUID from read_indexes"),
    }),
    handler: async ({ context, query }) => {
      const intentId = query.intentId?.trim() ?? "";
      const indexId = query.indexId?.trim() ?? "";
      if (!UUID_REGEX.test(intentId) || !UUID_REGEX.test(indexId)) {
        return error("Invalid ID format. Both must be UUIDs.");
      }

      const result = await graphs.intentIndex.invoke({
        userId: context.userId,
        indexId,
        intentId,
        operationMode: 'create' as const,
        skipEvaluation: true,
      });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({ created: true, message: result.mutationResult.message });
        }
        return error(result.mutationResult.error || "Failed to link intent to index.");
      }
      return error("Failed to link intent to index.");
    },
  });

  const readIntentIndexes = defineTool({
    name: "read_intent_indexes",
    description:
      "Reads intent-index links. Pass indexId to list intents in that index (add userId to filter). Pass intentId to list which indexes an intent is in.",
    querySchema: z.object({
      intentId: z.string().optional().describe("Intent UUID — returns indexes this intent is linked to."),
      indexId: z.string().optional().describe("Index UUID — returns intents in this index. Defaults to current index when scoped."),
      userId: z.string().optional().describe("Filter by user when listing by index."),
    }),
    handler: async ({ context, query }) => {
      const intentId = query.intentId?.trim() || undefined;
      const indexId = query.indexId?.trim() || context.indexId || undefined;
      const queryUserId = query.userId?.trim() || undefined;

      if (intentId && !UUID_REGEX.test(intentId)) {
        return error("Invalid intent ID format.");
      }
      if (indexId && !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format.");
      }
      if (!intentId && !indexId) {
        return error("Provide indexId or intentId.");
      }

      const result = await graphs.intentIndex.invoke({
        userId: context.userId,
        indexId,
        intentId,
        operationMode: 'read' as const,
        queryUserId,
      });

      if (result.error) {
        return error(result.error);
      }
      if (result.readResult) {
        return success(result.readResult);
      }
      return error("Failed to fetch intent-index links.");
    },
  });

  const deleteIntentIndex = defineTool({
    name: "delete_intent_index",
    description: "Unlinks an intent from an index. Does not delete the intent itself.",
    querySchema: z.object({
      intentId: z.string().describe("Intent UUID"),
      indexId: z.string().describe("Index UUID"),
    }),
    handler: async ({ context, query }) => {
      const intentId = query.intentId?.trim() ?? "";
      const indexId = query.indexId?.trim() ?? "";
      if (!UUID_REGEX.test(intentId) || !UUID_REGEX.test(indexId)) {
        return error("Invalid ID format. Both must be UUIDs.");
      }

      const result = await graphs.intentIndex.invoke({
        userId: context.userId,
        indexId,
        intentId,
        operationMode: 'delete' as const,
      });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({ deleted: true, message: result.mutationResult.message });
        }
        return error(result.mutationResult.error || "Failed to unlink.");
      }
      return error("Failed to unlink intent from index.");
    },
  });

  return [readIntents, createIntent, updateIntent, deleteIntent, createIntentIndex, readIntentIndexes, deleteIntentIndex] as const;
}
