import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, UUID_REGEX } from "./tool.helpers";
import { runDiscoverFromQuery } from "../support/opportunity.discover";

export function createOpportunityTools(defineTool: DefineTool, deps: ToolDeps) {
  const { database, graphs } = deps;

  const createOpportunities = defineTool({
    name: "create_opportunities",
    description:
      "REQUIRED when user asks to find opportunities, find connections, who can help with X, find a mentor, or similar discovery requests—call this tool; do not answer with text only. Creates draft (latent) opportunities. searchQuery is optional: when omitted or empty, discovery uses the user's existing intents in the current scope (index if chat is index-scoped, otherwise all their indexes). When the user does not specify what they want, do NOT ask—call with no searchQuery so their intents drive the search. Pass indexId when chat is index-scoped or user names an index. Returns concise summaries (name, short bio, match reason, score). Results are saved as drafts; use send_opportunity when ready.",
    querySchema: z.object({
      searchQuery: z.string().optional().describe("Optional. What kind of connections to search for; when omitted, uses the user's intents in scope (index or all indexes)."),
      indexId: z.string().optional().describe("Index UUID from read_indexes; optional when chat is index-scoped."),
    }),
    handler: async ({ context, query }) => {
      const effectiveIndexId = (query.indexId?.trim() || context.indexId) ?? null;
      const searchQuery = query.searchQuery?.trim() ?? "";

      let indexScope: string[];
      if (effectiveIndexId) {
        if (!UUID_REGEX.test(effectiveIndexId)) {
          return error("Invalid index ID format. Use the exact UUID from read_indexes.");
        }
        const memberResult = await graphs.indexMembership.invoke({
          userId: context.userId,
          indexId: effectiveIndexId,
          operationMode: 'read' as const,
        });
        if (memberResult.error) {
          return error("Index not found or you are not a member. Use read_indexes to see your indexes.");
        }
        indexScope = [effectiveIndexId];
      } else {
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
      "Lists the current user's opportunities (suggested connections). When the chat is scoped to an index, you can omit indexId to list only opportunities in that index.",
    querySchema: z.object({
      indexId: z.string().optional().describe("Index UUID from read_indexes; optional when chat is index-scoped."),
    }),
    handler: async ({ context, query }) => {
      const effectiveIndexId = (query.indexId?.trim() || context.indexId) ?? undefined;
      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }

      const result = await graphs.opportunity.invoke({
        userId: context.userId,
        indexId: effectiveIndexId,
        operationMode: 'read' as const,
      });

      if (result.readResult) {
        return success(result.readResult);
      }
      return error("Failed to list opportunities.");
    },
  });

  const sendOpportunity = defineTool({
    name: "send_opportunity",
    description:
      "Sends a draft (latent) opportunity to the other person, promoting it to pending and triggering a notification. Use after create_opportunities or when listing draft opportunities (list_opportunities) when the user wants to send the intro.",
    querySchema: z.object({
      opportunityId: z.string().describe("The opportunity ID to send (from create_opportunities or list_opportunities)"),
    }),
    handler: async ({ context, query }) => {
      const result = await graphs.opportunity.invoke({
        userId: context.userId,
        operationMode: 'send' as const,
        opportunityId: query.opportunityId,
      });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            sent: true,
            opportunityId: result.mutationResult.opportunityId,
            notified: result.mutationResult.notified,
            message: result.mutationResult.message,
          });
        }
        return error(result.mutationResult.error || "Failed to send opportunity.");
      }
      return error("Failed to send opportunity.");
    },
  });

  return [createOpportunities, listOpportunities, sendOpportunity] as const;
}
