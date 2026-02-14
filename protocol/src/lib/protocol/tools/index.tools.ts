import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, UUID_REGEX } from "./tool.helpers";

export function createIndexTools(defineTool: DefineTool, deps: ToolDeps) {
  const { graphs, database } = deps;

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

  const readIndexMemberships = defineTool({
    name: "read_index_memberships",
    description:
      "Reads index membership data. Two modes: (1) Pass indexId to list all members of that index (returns userId, name, avatar, permissions, intentCount, joinedAt). (2) Pass userId (or omit for current user) to list all indexes that user belongs to (returns indexId, indexTitle, permissions, joinedAt). Pass both to check whether a specific user is in a specific index.",
    querySchema: z.object({
      indexId: z.string().optional().describe("Index UUID — when provided, lists members of this index."),
      userId: z.string().optional().describe("User ID — when provided, lists that user's index memberships. Omit to default to current user."),
    }),
    handler: async ({ context, query }) => {
      const indexId = query.indexId?.trim() || undefined;
      const userId = query.userId?.trim() || undefined;

      if (indexId && !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }

      // Mode 1: list members of an index
      if (indexId && !userId) {
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
      }

      // Mode 2: list a user's memberships (indexes they belong to)
      const targetUserId = userId || context.userId;

      // Guard: only allow targetUserId === context.userId, or verify shared index access for another user
      let memberships: Awaited<ReturnType<typeof database.getIndexMemberships>>;
      if (targetUserId !== context.userId) {
        const callerMemberships = await database.getIndexMemberships(context.userId);
        if (indexId) {
          const callerInIndex = callerMemberships.some((m) => m.indexId === indexId);
          if (!callerInIndex) {
            return error(
              "Unauthorized: you can only view another user's membership in an index you belong to. Provide your own userId or omit userId for your memberships.",
            );
          }
          memberships = await database.getIndexMemberships(targetUserId);
        } else {
          const targetMemberships = await database.getIndexMemberships(targetUserId);
          const callerIndexIds = new Set(callerMemberships.map((m) => m.indexId));
          const hasOverlap = targetMemberships.some((m) => callerIndexIds.has(m.indexId));
          if (!hasOverlap) {
            return error(
              "Unauthorized: you can only view another user's memberships if you share at least one index, or request your own memberships.",
            );
          }
          memberships = targetMemberships;
        }
      } else {
        memberships = await database.getIndexMemberships(targetUserId);
      }

      // If both indexId and userId: filter to that specific membership (guard already enforced when targetUserId !== context.userId)
      if (indexId) {
        const callerInIndex =
          targetUserId === context.userId ||
          (await database.getIndexMemberships(context.userId)).some((m) => m.indexId === indexId);
        if (!callerInIndex) {
          return error(
            "Unauthorized: you can only view membership in an index you belong to.",
          );
        }
        const match = memberships.find((m) => m.indexId === indexId);
        if (!match) {
          return success({ isMember: false, userId: targetUserId, indexId, message: "User is not a member of this index." });
        }
        return success({
          isMember: true,
          userId: targetUserId,
          indexId,
          indexTitle: match.indexTitle,
          permissions: match.permissions,
          joinedAt: match.joinedAt,
        });
      }

      return success({
        userId: targetUserId,
        count: memberships.length,
        memberships: memberships.map((m) => ({
          indexId: m.indexId,
          indexTitle: m.indexTitle,
          permissions: m.permissions,
          joinedAt: m.joinedAt,
        })),
      });
    },
  });

  const updateIndexSettingsSchema = z.object({
    title: z.string().optional(),
    prompt: z.string().nullable().optional(),
    joinPolicy: z.enum(['anyone', 'invite_only']).optional(),
    allowGuestVibeCheck: z.boolean().optional(),
  }).strict();

  const updateIndex = defineTool({
    name: "update_index",
    description: "Updates an index (owner only). Pass indexId or omit when index-scoped.",
    querySchema: z.object({
      indexId: z.string().optional().describe("Index UUID; defaults to current index when scoped."),
      settings: updateIndexSettingsSchema.describe("Fields to update: title?, prompt?, joinPolicy?, allowGuestVibeCheck?"),
    }),
    handler: async ({ context, query }) => {
      const effectiveIndexId = (query.indexId?.trim() || context.indexId) ?? null;
      if (!effectiveIndexId || !UUID_REGEX.test(effectiveIndexId)) {
        return error("Valid indexId required.");
      }

      const result = await graphs.index.invoke({
        userId: context.userId,
        indexId: effectiveIndexId,
        operationMode: 'update' as const,
        updateInput: query.settings,
      });

      if (result.mutationResult && !result.mutationResult.success) {
        return error(result.mutationResult.error || "Failed to update index.");
      }
      return success({ message: "Index updated.", settings: Object.keys(query.settings) });
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
    description: "Deletes an index (owner only, must be sole member).",
    querySchema: z.object({
      indexId: z.string().describe("Index UUID from read_indexes"),
    }),
    handler: async ({ context, query }) => {
      const indexId = query.indexId?.trim();
      if (!indexId || !UUID_REGEX.test(indexId)) {
        return error("Valid indexId required.");
      }

      const result = await graphs.index.invoke({
        userId: context.userId,
        indexId,
        operationMode: 'delete' as const,
      });

      if (result.mutationResult && !result.mutationResult.success) {
        return error(result.mutationResult.error || "Failed to delete index.");
      }
      return success({ message: "Index deleted." });
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

  return [readIndexes, readIndexMemberships, updateIndex, createIndex, deleteIndex, createIndexMembership] as const;
}
