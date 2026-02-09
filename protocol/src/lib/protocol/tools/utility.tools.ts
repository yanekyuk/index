import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, CONFIRMATION_EXPIRY_MS, resolveIndexNames } from "./tool.helpers";
import type { ExecutionResult } from "../states/intent.state";

export function createUtilityTools(defineTool: DefineTool, deps: ToolDeps) {
  const { database, scraper, graphs, getPendingConfirmation, setPendingConfirmation } = deps;

  const scrapeUrl = defineTool({
    name: "scrape_url",
    description: "Extracts text content from a URL (articles, profiles, documentation, etc.). Use this to read web pages, LinkedIn/GitHub profiles, or any public web content. Pass 'objective' when you know the downstream use: e.g. 'User wants to create an intent from this link (project/repo).' or 'User wants to update their profile from this page.' — this returns content better suited for that use.",
    querySchema: z.object({
      url: z.string().describe("The URL to scrape"),
      objective: z.string().optional().describe("Optional: why we're scraping. E.g. 'User wants to create an intent from this link' or 'User wants to update their profile from this page'. Omit for generic extraction."),
    }),
    handler: async ({ context: _context, query }) => {
      try {
        new URL(query.url);
      } catch {
        return error("Invalid URL format. Please provide a valid URL starting with http:// or https://");
      }

      const content = await scraper.extractUrlContent(query.url, {
        objective: query.objective?.trim() || undefined,
      });

      if (!content) {
        return error("Couldn't extract content from that URL. It may be blocked, require login, or have no extractable text.");
      }

      const truncatedContent = content.length > 10000
        ? content.substring(0, 10000) + "\n\n[Content truncated...]"
        : content;

      return success({
        url: query.url,
        contentLength: content.length,
        content: truncatedContent,
      });
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIRMATION TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

  const confirmAction = defineTool({
    name: "confirm_action",
    description: "Confirm and execute a pending destructive action (update or delete). Call this ONLY after the user has explicitly said yes to the summary you showed them. Do not call without user confirmation.",
    querySchema: z.object({
      confirmationId: z.string().describe("The confirmation ID from the needsConfirmation response."),
    }),
    handler: async ({ context, query }) => {
      if (!getPendingConfirmation || !setPendingConfirmation) {
        return error("Confirmation not available in this context.");
      }
      const pending = getPendingConfirmation();
      if (!pending) {
        return error("There is no pending action to confirm.");
      }
      if (pending.id !== query.confirmationId) {
        return error("Confirmation ID does not match the pending action.");
      }
      const now = Date.now();
      if (now - pending.createdAt > CONFIRMATION_EXPIRY_MS) {
        setPendingConfirmation(undefined);
        return error("The pending confirmation has expired. Please start the action again.");
      }
      const payload = pending.payload;
      if (payload.resource === "intent" && payload.action === "update") {
        const profileResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
        const userProfile = profileResult.profile ? JSON.stringify(profileResult.profile) : "";
        const result = await graphs.intent.invoke({
          userId: context.userId,
          userProfile,
          operationMode: 'update' as const,
          inputContent: payload.newDescription,
          targetIntentIds: [payload.intentId],
        });
        if (result.executionResults?.some((r: ExecutionResult) => !r.success)) {
          return error("Failed to update intent through graph.");
        }
        // Look up which indexes this intent belongs to so the LLM can mention them
        const indexIds = await database.getIndexIdsForIntent(payload.intentId);
        const indexedIn = await resolveIndexNames(database, indexIds);
        setPendingConfirmation(undefined);
        return success({ confirmed: true, message: "Intent updated.", ...(indexedIn.length > 0 && { indexedIn }) });
      } else if (payload.resource === "intent" && payload.action === "delete") {
        // Capture which indexes the intent is in *before* archival
        const indexIds = await database.getIndexIdsForIntent(payload.intentId);
        const deIndexedFrom = await resolveIndexNames(database, indexIds);
        const profileResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
        const userProfile = profileResult.profile ? JSON.stringify(profileResult.profile) : "";
        const result = await graphs.intent.invoke({
          userId: context.userId,
          userProfile,
          operationMode: 'delete' as const,
          targetIntentIds: [payload.intentId],
        });
        if (result.executionResults?.some((r: ExecutionResult) => !r.success)) {
          return error("Failed to delete intent through graph.");
        }
        setPendingConfirmation(undefined);
        return success({ confirmed: true, message: "Intent deleted.", ...(deIndexedFrom.length > 0 && { deIndexedFrom }) });
      } else if (payload.resource === "profile" && payload.action === "update") {
        const profileInput = (payload.updates as { input?: string }).input ?? JSON.stringify(payload.updates);
        await graphs.profile.invoke({
          userId: context.userId,
          operationMode: "write",
          input: profileInput,
          forceUpdate: true,
        });
      } else if (payload.resource === "profile" && payload.action === "delete") {
        await database.deleteProfile(context.userId);
      } else if (payload.resource === "index" && payload.action === "update") {
        const result = await graphs.index.invoke({
          userId: context.userId,
          indexId: payload.indexId,
          operationMode: 'update' as const,
          updateInput: payload.updates as { title?: string; prompt?: string | null; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean },
        });
        if (result.mutationResult && !result.mutationResult.success) {
          return error(result.mutationResult.error || "Failed to update index.");
        }
      } else if (payload.resource === "index" && payload.action === "delete") {
        const result = await graphs.index.invoke({
          userId: context.userId,
          indexId: payload.indexId,
          operationMode: 'delete' as const,
        });
        if (result.mutationResult && !result.mutationResult.success) {
          return error(result.mutationResult.error || "Failed to delete index.");
        }
      } else if (payload.resource === "opportunity" && payload.action === "update") {
        const status = (payload.updates as { status?: string })?.status;
        if (!status || !["accepted", "rejected", "expired"].includes(status)) {
          return error("Opportunity update requires status.");
        }
        const result = await graphs.opportunity.invoke({
          userId: context.userId,
          operationMode: 'update' as const,
          opportunityId: payload.opportunityId,
          newStatus: status,
        });
        if (result.mutationResult && !result.mutationResult.success) {
          return error(result.mutationResult.error || "Failed to update opportunity.");
        }
      } else if (payload.resource === "opportunity" && payload.action === "delete") {
        const result = await graphs.opportunity.invoke({
          userId: context.userId,
          operationMode: 'delete' as const,
          opportunityId: payload.opportunityId,
        });
        if (result.mutationResult && !result.mutationResult.success) {
          return error(result.mutationResult.error || "Failed to delete opportunity.");
        }
      } else {
        return error("Unknown confirmation payload.");
      }
      setPendingConfirmation(undefined);
      return success({ confirmed: true, message: "Action completed." });
    },
  });

  const cancelAction = defineTool({
    name: "cancel_action",
    description: "Cancel a pending destructive action without executing it. Call when the user says no or cancel.",
    querySchema: z.object({
      confirmationId: z.string().describe("The confirmation ID from the needsConfirmation response."),
    }),
    handler: async ({ context: _context, query }) => {
      if (!getPendingConfirmation || !setPendingConfirmation) {
        return error("Confirmation not available in this context.");
      }
      const pending = getPendingConfirmation();
      if (!pending) {
        return success({ cancelled: true, message: "No pending action." });
      }
      if (pending.id !== query.confirmationId) {
        return error("Confirmation ID does not match the pending action.");
      }
      setPendingConfirmation(undefined);
      return success({ cancelled: true, message: "Action cancelled." });
    },
  });

  return [scrapeUrl, confirmAction, cancelAction] as const;
}
