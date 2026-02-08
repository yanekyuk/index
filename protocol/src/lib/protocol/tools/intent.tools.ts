import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, needsConfirmation, needsClarification, UUID_REGEX, extractUrls, resolveIndexNames } from "./tool.helpers";
import type { ConfirmationPayload } from "../states/chat.state";
import type { ExecutionResult } from "../states/intent.state";
import { runDiscoverFromQuery } from "../support/opportunity.discover";
import { protocolLogger } from "../support/protocol.logger";

const logger = protocolLogger("ChatTools:Intent");

export function createIntentTools(defineTool: DefineTool, deps: ToolDeps) {
  const { database, scraper, graphs, getPendingConfirmation, setPendingConfirmation } = deps;

  // ─────────────────────────────────────────────────────────────────────────────
  // INTENT CRUD
  // ─────────────────────────────────────────────────────────────────────────────

  const readIntents = defineTool({
    name: "read_intents",
    description:
      `Fetches intents (goals, wants, needs). With no indexId: returns the user's active intents. With indexId: omit userId to return all intents in that index (all members); pass userId to return only that user's intents in the index. When chat is index-scoped, the current index is used unless you pass allUserIntents: true to get all of the user's intents (e.g. for create_intent). indexId must be a UUID from read_indexes.`,
    querySchema: z.object({
      indexId: z.string().optional().describe("Index UUID; optional when chat is index-scoped (uses current index). Omit and use allUserIntents: true when you need all user intents for create_intent."),
      userId: z.string().optional().describe("When index-scoped: pass the current user's id when they ask for their own intents only; omit to return all intents in the index (any member can see everyone's intents in a shared network)."),
      allUserIntents: z.boolean().optional().describe("When true, return all of the current user's intents and ignore index scope. Use this before create_intent in an index so the system can detect duplicates and modifications. Required when index-scoped and you are about to call create_intent."),
    }),
    handler: async ({ context, query }) => {
      const effectiveIndexId = query.allUserIntents
        ? undefined
        : (query.indexId?.trim() || context.indexId || undefined);
      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }
      const rawArgUserId = query.userId?.trim();
      // Authorization: non-index-scoped reads of other users are blocked
      if (!effectiveIndexId && rawArgUserId && rawArgUserId !== context.userId) {
        return error("Not authorized to view other users' global intents. You can only view your own intents when no index is specified.");
      }
      const queryUserId = query.userId?.trim() || undefined;

      const result = await graphs.intent.invoke({
        userId: context.userId,
        userProfile: "",
        indexId: effectiveIndexId,
        operationMode: 'read' as const,
        queryUserId,
        allUserIntents: query.allUserIntents ?? false,
      });

      if (result.readResult) {
        return success(result.readResult);
      }
      return error("Failed to fetch intents.");
    },
  });

  const createIntent = defineTool({
    name: "create_intent",
    description: "Creates a new intent (goal, want, or need) for the user. Pass a concept-based description. Intents are linked to indexes via intent_indexes (intents have no indexId column). When chat is index-scoped, pass that indexId so the tool creates the intent and adds an intent_indexes row linking it to the active index; if omitted but chat is index-scoped, the link is still created. When the user includes URLs, include them in the description—the tool will scrape for context.",
    querySchema: z.object({
      description: z.string().describe("The intent/goal in conceptual terms; may include URLs—they will be scraped for context"),
      indexId: z.string().optional().describe("Index UUID from read_indexes or the system message. When chat is index-scoped, pass this so the intent is linked to the active index (via intent_indexes)."),
    }),
    handler: async ({ context, query }) => {
      if (!query.description?.trim()) {
        return needsClarification({
          missingFields: ["description"],
          message: "Please provide a description of what you're looking for (e.g. your goal, want, or need).",
        });
      }

      let inputContent = query.description;
      const urls = extractUrls(query.description);
      if (urls.length > 0) {
        logger.info("Intent description contains URLs - scraping for context", { urlCount: urls.length });
        const parts: string[] = [query.description];
        const maxContentPerUrl = 6000;
        const intentObjective = "User wants to create an intent from this link (project/repo or similar).";
        for (const url of urls) {
          try {
            const content = await scraper.extractUrlContent(url, { objective: intentObjective });
            if (content && content.trim()) {
              const truncated = content.length > maxContentPerUrl
                ? content.slice(0, maxContentPerUrl) + "\n\n[Content truncated...]"
                : content;
              parts.push(`Context from ${url}:\n\n${truncated}`);
            }
          } catch (err) {
            logger.warn("Failed to scrape URL for intent context", { url, error: err });
          }
        }
        if (parts.length > 1) inputContent = parts.join("\n\n");
      }

      // Get user profile via profileGraph query mode
      const profileResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
      const profile = profileResult.profile || null;

      const effectiveIndexId = query.indexId?.trim() || context.indexId || undefined;

      const intentInput = {
        userId: context.userId,
        userProfile: profile ? JSON.stringify(profile) : "",
        inputContent,
        operationMode: 'create' as const,
        ...(effectiveIndexId ? { indexId: effectiveIndexId } : {}),
      };

      const result = await graphs.intent.invoke(intentInput);
      logger.debug("Intent graph response", { result });

      // Process execution results
      const created = (result.executionResults || [])
        .filter((r: ExecutionResult): r is ExecutionResult & { intentId: string } => r.actionType === 'create' && r.success && !!r.intentId)
        .map((r: ExecutionResult & { intentId: string }) => ({
          id: r.intentId,
          description: (r.payload ?? query.description) ?? ''
        }));

      // Link created intents to indexes via intent_indexes (intents table has no indexId; association is many-to-many).
      const indexForAssignment = effectiveIndexId || context.indexId || undefined;
      const assignedIndexIds = new Set<string>();
      if (created.length > 0) {
        let autoAssignIndexIds: string[] = [];
        if (!indexForAssignment) {
          const idxResult = await graphs.index.invoke({ userId: context.userId, operationMode: 'read' as const, showAll: true });
          autoAssignIndexIds = (idxResult.readResult?.memberOf || [])
            .filter((m: { autoAssign: boolean }) => m.autoAssign)
            .map((m: { indexId: string }) => m.indexId);
        }
        const scopeIndexIds = indexForAssignment
          ? [indexForAssignment]
          : autoAssignIndexIds;
        if (scopeIndexIds.length > 0) {
          const forceAssignSingleIndex = scopeIndexIds.length === 1;
          for (const intent of created) {
            for (const idxId of scopeIndexIds) {
              try {
                const assignResult = await graphs.intentIndex.invoke({
                  userId: context.userId,
                  indexId: idxId,
                  intentId: intent.id,
                  operationMode: 'create' as const,
                  skipEvaluation: forceAssignSingleIndex,
                });
                if (assignResult.mutationResult?.success) {
                  assignedIndexIds.add(idxId);
                }
              } catch (e) {
                logger.warn("Index assignment failed", { intentId: intent.id, indexId: idxId });
              }
            }
          }
        }
      }
      // When creating in index scope, also link updated intents to the active index.
      const updated = (result.executionResults || [])
        .filter((r: ExecutionResult): r is ExecutionResult & { intentId: string } => r.actionType === 'update' && r.success && !!r.intentId)
        .map((r: ExecutionResult & { intentId: string }) => r.intentId);
      if (updated.length > 0 && indexForAssignment) {
        for (const intentId of updated) {
          try {
            const updateAssignResult = await graphs.intentIndex.invoke({
              userId: context.userId,
              indexId: indexForAssignment,
              intentId,
              operationMode: 'create' as const,
              skipEvaluation: true,
            });
            if (updateAssignResult.mutationResult?.success) {
              assignedIndexIds.add(indexForAssignment);
            }
          } catch (e) {
            logger.warn("Index assignment failed for updated intent", { intentId, indexId: indexForAssignment });
          }
        }
      }

      // Resolve assigned index IDs to display names
      const assignedToIndexes = await resolveIndexNames(database, [...assignedIndexIds]);

      if (created.length > 0) {
        // Auto-trigger discovery
        let discoveryRan = false;
        let discoveryCount = 0;
        let discoveryError = false;
        let indexScope: string[] = [];
        const discoveryIndexId = effectiveIndexId || context.indexId || undefined;
        if (discoveryIndexId) {
          if (UUID_REGEX.test(discoveryIndexId)) {
            const memberResult = await graphs.indexMembership.invoke({
              userId: context.userId,
              indexId: discoveryIndexId,
              operationMode: 'read' as const,
            });
            if (!memberResult.error) indexScope = [discoveryIndexId];
          }
        } else {
          const indexResult = await graphs.index.invoke({
            userId: context.userId,
            operationMode: 'read' as const,
            showAll: true,
          });
          indexScope = (indexResult.readResult?.memberOf || []).map((m: { indexId: string }) => m.indexId);
        }
        if (indexScope.length > 0) {
          try {
            const intentQuery = created.map((c: { description: string }) => c.description).filter(Boolean).join(" ") || "";
            const discoveryResult = await runDiscoverFromQuery({
              opportunityGraph: graphs.opportunity as any, // eslint-disable-line @typescript-eslint/no-explicit-any
              database,
              userId: context.userId,
              query: intentQuery,
              indexScope,
              limit: 5,
            });
            discoveryRan = true;
            discoveryCount = discoveryResult.count ?? 0;
          } catch (err) {
            logger.warn("create_intent: auto-discovery failed", { error: err });
            discoveryRan = true;
            discoveryError = true;
          }
        }
        return success({
          created: true,
          intents: created,
          message: `Created ${created.length} intent(s)`,
          ...(assignedToIndexes.length > 0 && { assignedToIndexes }),
          ...(discoveryRan && {
            discoveryRan: true,
            discoveryCount,
            ...(discoveryError && { discoveryError: true }),
          }),
        });
      }

      if (updated.length > 0) {
        return success({
          created: false,
          linkedToIndex: true,
          message: indexForAssignment
            ? "The intent already existed; it has been added to this index."
            : "The intent was updated.",
          ...(assignedToIndexes.length > 0 && { assignedToIndexes }),
        });
      }

      const inferredCount = result.inferredIntents?.length || 0;
      if (inferredCount > 0) {
        return success({
          created: false,
          message: "The intent seems similar to one you already have. Would you like me to update an existing intent instead?"
        });
      }

      return error("Couldn't extract a clear intent from that. Could you be more specific about what you're looking for?");
    },
  });

  // TODO: Prevent users from updating intents that are not theirs.
  const updateIntent = defineTool({
    name: "update_intent",
    description: "Updates an existing intent with a new description. Requires the intent ID from read_intents. When the chat is index-scoped, only intents in that index can be updated.",
    querySchema: z.object({
      intentId: z.string().describe("The ID of the intent to update"),
      newDescription: z.string().describe("The new description for the intent"),
    }),
    handler: async ({ context, query }) => {
      const intentId = query.intentId?.trim() ?? "";
      if (!UUID_REGEX.test(intentId)) {
        return error("Invalid intent ID format. Use the exact 'id' value from read_intents (UUID format).");
      }

      if (context.indexId) {
        const scopeResult = await graphs.intentIndex.invoke({
          userId: context.userId,
          indexId: context.indexId,
          queryUserId: context.userId,
          operationMode: 'read' as const,
        });
        const inScope = scopeResult.readResult?.links?.some((l: { intentId: string }) => l.intentId === intentId);
        if (!inScope) {
          return error("That intent is not in the current index. You can only update intents that belong to this community.");
        }
      }

      if (!setPendingConfirmation || !getPendingConfirmation) {
        return error("Confirmation is not available in this context.");
      }

      const readResult = await graphs.intent.invoke({
        userId: context.userId,
        userProfile: "",
        operationMode: 'read' as const,
        allUserIntents: true,
      });
      const userIntents = readResult.readResult?.intents || [];
      const intent = userIntents.find((i: { id: string }) => i.id === intentId);

      if (!intent) {
        return error(
          userIntents.length === 0
            ? "Intent not found. You have no active intents. Create one with create_intent, then use read_intents to get the id."
            : "Intent not found. The ID may be wrong or from an old session. Call read_intents to get current intents and use the exact 'id': " +
              JSON.stringify(userIntents.map((i: { id: string; description?: string; summary?: string }) => ({ id: i.id, payload: i.description, summary: i.summary })))
        );
      }

      const confirmationId = crypto.randomUUID();
      const intentText = (intent as { summary?: string; description?: string }).summary || (intent as { description?: string }).description || "";
      const summary = `Update intent from "${intentText.slice(0, 80)}${intentText.length > 80 ? "…" : ""}" to "${query.newDescription.slice(0, 80)}${query.newDescription.length > 80 ? "…" : ""}"`;
      const payload: ConfirmationPayload = {
        resource: "intent",
        action: "update",
        intentId,
        newDescription: query.newDescription,
      };
      setPendingConfirmation({
        id: confirmationId,
        action: "update",
        resource: "intent",
        summary,
        payload,
        createdAt: Date.now(),
      });
      return needsConfirmation({ confirmationId, action: "update", resource: "intent", summary });
    },
  });

  // TODO: Prevent users from deleting intents that are not theirs, as long as they are not the owner of the index.
  const deleteIntent = defineTool({
    name: "delete_intent",
    description: "Deletes (archives) an existing intent. Requires the intent ID from read_intents. When the chat is index-scoped, only intents in that index can be deleted.",
    querySchema: z.object({
      intentId: z.string().describe("The ID of the intent to delete"),
    }),
    handler: async ({ context, query }) => {
      const intentId = query.intentId?.trim() ?? "";
      if (!UUID_REGEX.test(intentId)) {
        return error(
          "Invalid intent ID format. Intent IDs must be UUIDs (e.g. c2505011-2e45-426e-81dd-b9abb9b72023). " +
          "Use the exact 'id' value from read_intents—do not add or remove characters."
        );
      }

      if (context.indexId) {
        const scopeResult = await graphs.intentIndex.invoke({
          userId: context.userId,
          indexId: context.indexId,
          queryUserId: context.userId,
          operationMode: 'read' as const,
        });
        const inScope = scopeResult.readResult?.links?.some((l: { intentId: string }) => l.intentId === intentId);
        if (!inScope) {
          return error("That intent is not in the current index. You can only delete intents that belong to this community.");
        }
      }

      if (!setPendingConfirmation || !getPendingConfirmation) {
        return error("Confirmation is not available in this context.");
      }

      const readResult = await graphs.intent.invoke({
        userId: context.userId,
        userProfile: "",
        operationMode: 'read' as const,
        allUserIntents: true,
      });
      const userIntents = readResult.readResult?.intents || [];
      const intent = userIntents.find((i: { id: string }) => i.id === intentId);

      if (!intent) {
        return error(
          userIntents.length === 0
            ? "Intent not found. You have no active intents."
            : "Intent not found. The ID may be wrong or from an old session. Here are your current intents—use the exact 'id' from the one you want to delete: " +
              JSON.stringify(userIntents.map((i: { id: string; description?: string; summary?: string }) => ({ id: i.id, payload: i.description, summary: i.summary })))
        );
      }

      const confirmationId = crypto.randomUUID();
      const intentText = (intent as { summary?: string; description?: string }).summary || (intent as { description?: string }).description || "";
      const summary = `Delete intent: "${intentText.slice(0, 100)}${intentText.length > 100 ? "…" : ""}"`;
      const payload: ConfirmationPayload = { resource: "intent", action: "delete", intentId };
      setPendingConfirmation({
        id: confirmationId,
        action: "delete",
        resource: "intent",
        summary,
        payload,
        createdAt: Date.now(),
      });
      return needsConfirmation({ confirmationId, action: "delete", resource: "intent", summary });
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INTENT–INDEX TOOLS (intent_indexes junction: save / list / remove intent in index)
  // ─────────────────────────────────────────────────────────────────────────────

  const createIntentIndex = defineTool({
    name: "create_intent_index",
    description: "Saves (links) an intent to an index. Use when the user wants to add one of their intents to a specific index. Requires intentId from read_intents and indexId from read_indexes.",
    querySchema: z.object({
      intentId: z.string().describe("The ID of the intent (from read_intents)"),
      indexId: z.string().describe("The ID of the index (from read_indexes)"),
    }),
    handler: async ({ context, query }) => {
      const intentId = query.intentId?.trim() ?? "";
      const indexId = query.indexId?.trim() ?? "";
      if (!UUID_REGEX.test(intentId) || !UUID_REGEX.test(indexId)) {
        return error("Invalid ID format. intentId and indexId must be UUIDs from read_intents and read_indexes.");
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
        return error(result.mutationResult.error || "Failed to save intent to index.");
      }
      return error("Failed to save intent to index.");
    },
  });

  const readIntentIndexes = defineTool({
    name: "read_intent_indexes",
    description:
      "Three modes. (1) By index: pass indexId (or omit when index-scoped) to list intents in that index. Omit userId to see all intents in the index (any member in a shared network); pass userId to see that user's intents only (e.g. your own). (2) By intent: pass intentId to list all indexes that intent is in (you must own the intent). (3) Works with user and index scope: indexId defaults to context when chat is index-scoped. Use read_indexes and read_intents to show names/descriptions.",
    querySchema: z.object({
      intentId: z.string().optional().describe("Intent UUID from read_intents. When set, returns all indexIds the intent is registered to (owner only)."),
      indexId: z.string().optional().describe("Index UUID from read_indexes. When set, returns intents in that index. Optional when chat is index-scoped."),
      userId: z.string().optional().describe("When listing by index: omit to list all intents in the index (any member); pass to limit to that user's intents (e.g. yourself)."),
    }),
    handler: async ({ context, query }) => {
      const intentId = query.intentId?.trim() || undefined;
      const indexId = query.indexId?.trim() || context.indexId || undefined;
      const queryUserId = query.userId?.trim() || undefined;

      if (intentId && !UUID_REGEX.test(intentId)) {
        return error("Invalid intent ID format. Use the exact UUID from read_intents.");
      }
      if (indexId && !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }
      if (!intentId && !indexId) {
        return error("Provide indexId (to list intents in an index) or intentId (to list indexes for an intent). When chat is index-scoped, indexId defaults to the current index.");
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
    description: "Removes an intent from a specific index. Use when the user wants to take one of their intents out of an index. Requires intentId from read_intents and indexId from read_indexes. Does not delete the intent itself—use delete_intent for that.",
    querySchema: z.object({
      intentId: z.string().describe("The ID of the intent to remove (from read_intents)"),
      indexId: z.string().describe("The ID of the index (from read_indexes)"),
    }),
    handler: async ({ context, query }) => {
      const intentId = query.intentId?.trim() ?? "";
      const indexId = query.indexId?.trim() ?? "";
      if (!UUID_REGEX.test(intentId) || !UUID_REGEX.test(indexId)) {
        return error("Invalid ID format. intentId and indexId must be UUIDs from read_intents and read_indexes.");
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
        return error(result.mutationResult.error || "Failed to remove intent from index.");
      }
      return error("Failed to remove intent from index.");
    },
  });

  return [readIntents, createIntent, updateIntent, deleteIntent, createIntentIndex, readIntentIndexes, deleteIntentIndex] as const;
}
