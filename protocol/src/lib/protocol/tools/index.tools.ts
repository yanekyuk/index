import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, UUID_REGEX } from "./tool.helpers";

export function createIndexTools(defineTool: DefineTool, deps: ToolDeps) {
  const { graphs } = deps;

  const readIndexes = defineTool({
    name: "read_indexes",
    description: "Lists indexes the user is a member of and indexes they own. Optional userId (omit for current user). When chat is index-scoped, returns only that index unless showAll: true.",
    querySchema: z.object({
      userId: z.string().optional().describe("Omit for current user."),
      showAll: z.boolean().optional().describe("When true and chat is index-scoped, return all indexes."),
    }),
    handler: async ({ context, query }) => {
      if (query.userId && query.userId.trim() !== context.userId) {
        return error("You can only list your own indexes. Omit userId to see the current user's indexes.");
      }

      const result = await graphs.index.invoke({
        userId: context.userId,
        indexId: context.indexId || undefined,
        operationMode: 'read' as const,
        showAll: query.showAll ?? false,
      });

      if (result.error) {
        return error(result.error);
      }
      if (result.readResult) {
        return success(result.readResult);
      }
      return error("Failed to fetch index information.");
    },
  });

  const readUsers = defineTool({
    name: "read_users",
    description: "Lists all members of an index with their userId, name, avatar, permissions, intentCount, and joinedAt. Requires indexId (UUID from read_indexes). You must be a member of the index. Use the returned userId values to unambiguously reference members in other tools like create_opportunity_between_members.",
    querySchema: z.object({
      indexId: z.string().describe("Index UUID from read_indexes."),
    }),
    handler: async ({ context, query }) => {
      const indexId = query.indexId?.trim();
      if (!indexId || !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }

      const result = await graphs.indexMembership.invoke({
        userId: context.userId,
        indexId,
        operationMode: 'read' as const,
      });

      if (result.error) {
        return error(result.error);
      }
      if (result.readResult) {
        return success(result.readResult);
      }
      return error("Failed to fetch index members.");
    },
  });

  const updateIndex = defineTool({
    name: "update_index",
    description: "Updates an index the user owns. Pass indexId (UUID from read_indexes) or omit when chat is index-scoped. OWNER ONLY.",
    querySchema: z.object({
      indexId: z.string().optional().describe("Index UUID; optional when chat is index-scoped."),
      settings: z.record(z.unknown()).describe("Settings to update: { title?, prompt?, joinPolicy?, allowGuestVibeCheck? }"),
    }),
    handler: async ({ context, query }) => {
      const effectiveIndexId = (query.indexId?.trim() || context.indexId) ?? null;
      if (!effectiveIndexId) {
        return error("Index required. Pass index UUID or open chat from an index you own.");
      }
      if (!UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }

      const readResult = await graphs.index.invoke({
        userId: context.userId,
        indexId: effectiveIndexId,
        operationMode: 'read' as const,
      });
      const owned = readResult.readResult?.owns?.find((o: { indexId: string }) => o.indexId === effectiveIndexId);
      if (!owned) {
        return error("You can only modify indexes you own. Use read_indexes to see your owned indexes.");
      }

      const settingsData: Record<string, unknown> = {};
      if ("title" in query.settings) settingsData.title = query.settings.title;
      if ("prompt" in query.settings) settingsData.prompt = query.settings.prompt;
      if ("joinPolicy" in query.settings) settingsData.joinPolicy = query.settings.joinPolicy;
      if ("allowGuestVibeCheck" in query.settings) settingsData.allowGuestVibeCheck = query.settings.allowGuestVibeCheck;
      if ("private" in query.settings && query.settings.private) settingsData.joinPolicy = "invite_only";
      if ("public" in query.settings && query.settings.public) settingsData.joinPolicy = "anyone";

      // Execute update directly
      const result = await graphs.index.invoke({
        userId: context.userId,
        indexId: effectiveIndexId,
        operationMode: 'update' as const,
        updateInput: settingsData as { title?: string; prompt?: string | null; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean },
      });
      if (result.mutationResult && !result.mutationResult.success) {
        return error(result.mutationResult.error || "Failed to update index.");
      }
      return success({ message: "Index updated.", settings: Object.keys(settingsData) });
    },
  });

  const createIndex = defineTool({
    name: "create_index",
    description: "Creates a new index (community). You become the owner. Pass title; optional prompt and joinPolicy ('anyone' | 'invite_only').",
    querySchema: z.object({
      title: z.string().describe("Display name of the index"),
      prompt: z.string().optional().describe("What the community is about"),
      joinPolicy: z.enum(['anyone', 'invite_only']).optional().describe("Who can join; default invite_only"),
    }),
    handler: async ({ context, query }) => {
      if (!query.title?.trim()) {
        return error("Title is required.");
      }

      const result = await graphs.index.invoke({
        userId: context.userId,
        operationMode: 'create' as const,
        createInput: {
          title: query.title.trim(),
          prompt: query.prompt?.trim() || undefined,
          joinPolicy: query.joinPolicy,
        },
      });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            created: true,
            indexId: result.mutationResult.indexId,
            title: result.mutationResult.title,
            message: result.mutationResult.message,
          });
        }
        return error(result.mutationResult.error || "Failed to create index.");
      }
      return error("Failed to create index.");
    },
  });

  const deleteIndex = defineTool({
    name: "delete_index",
    description: "Deletes an index you own. Only allowed when you are the only member. Requires indexId (UUID from read_indexes).",
    querySchema: z.object({
      indexId: z.string().describe("Index UUID from read_indexes."),
    }),
    handler: async ({ context, query }) => {
      const indexId = query.indexId?.trim();
      if (!indexId || !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }

      const readResult = await graphs.index.invoke({
        userId: context.userId,
        indexId,
        operationMode: 'read' as const,
      });
      const owned = readResult.readResult?.owns?.find((o: { indexId: string }) => o.indexId === indexId);
      if (!owned) {
        return error("You can only delete indexes you own. Use read_indexes to see your owned indexes.");
      }
      if (owned.memberCount > 1) {
        return error("Cannot delete index with other members. Remove members first or transfer ownership.");
      }

      // Execute delete directly
      const result = await graphs.index.invoke({
        userId: context.userId,
        indexId,
        operationMode: 'delete' as const,
      });
      if (result.mutationResult && !result.mutationResult.success) {
        return error(result.mutationResult.error || "Failed to delete index.");
      }
      const title = (owned.title ?? "this index").slice(0, 60);
      return success({ message: `Index "${title}" deleted.` });
    },
  });

  const createIndexMembership = defineTool({
    name: "create_index_membership",
    description: "Adds a user as a member of an index. Requires userId and indexId (UUIDs). For invite_only indexes only the owner can add members.",
    querySchema: z.object({
      userId: z.string().describe("User ID to add as a member"),
      indexId: z.string().describe("Index UUID from read_indexes"),
    }),
    handler: async ({ context, query }) => {
      const indexId = query.indexId?.trim();
      const targetUserId = query.userId?.trim();
      if (!indexId || !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }
      if (!targetUserId) {
        return error("userId is required.");
      }

      const result = await graphs.indexMembership.invoke({
        userId: context.userId,
        indexId,
        targetUserId,
        operationMode: 'create' as const,
      });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          const alreadyMember = result.mutationResult.message?.includes("already");
          return success({
            created: !alreadyMember,
            message: result.mutationResult.message,
          });
        }
        return error(result.mutationResult.error || "Failed to add member.");
      }
      return error("Failed to add member.");
    },
  });

  return [readIndexes, readUsers, updateIndex, createIndex, deleteIndex, createIndexMembership] as const;
}
