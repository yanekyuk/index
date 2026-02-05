import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type {
  ChatGraphCompositeDatabase,
  HydeGraphDatabase,
  CreateOpportunityData,
  OpportunityActor,
} from "../../interfaces/database.interface";
import type { Embedder } from "../../interfaces/embedder.interface";
import type { Scraper } from "../../interfaces/scraper.interface";
import type { HydeCache } from "../../interfaces/cache.interface";
import { IntentGraphFactory } from "../intent/intent.graph";
import { ProfileGraphFactory } from "../profile/profile.graph";
import { OpportunityGraph } from "../opportunity/opportunity.graph";
import { HydeGraphFactory } from "../hyde/hyde.graph";
import { HydeGenerator } from "../../agents/hyde/hyde.generator";
import { IndexGraphFactory } from "../index/index.graph";
import { RedisCacheAdapter } from "../../../../adapters/cache.adapter";
import { runDiscoverFromQuery } from "./nodes/discover.nodes";
import { queueOpportunityNotification } from "../../../../queues/notification.queue";
import { log } from "../../../log";
import type { PendingConfirmation, ConfirmationPayload } from "./chat.graph.state";

const logger = log.protocol.from("ChatTools");

/** Five minutes in ms for confirmation expiry. */
const CONFIRMATION_EXPIRY_MS = 5 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL CONTEXT TYPE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Context passed to all tools, containing the current user and dependencies.
 * This is bound when creating tools for a specific user session.
 */
export interface ToolContext {
  userId: string;
  database: ChatGraphCompositeDatabase;
  embedder: Embedder;
  scraper: Scraper;
  /** When set, chat is scoped to this index; tools use it as default for get_intents_in_index and create_intent. */
  indexId?: string;
  /** Read pending confirmation (for confirm_action / cancel_action). */
  getPendingConfirmation?: () => PendingConfirmation | undefined;
  /** Set pending confirmation (for tools that require user confirm before update/delete). */
  setPendingConfirmation?: (p: PendingConfirmation | undefined) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Standard result format for all tools.
 * Tools return success/error status with data or error message.
 */
interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function success<T>(data: T): string {
  return JSON.stringify({ success: true, data });
}

function error(message: string): string {
  return JSON.stringify({ success: false, error: message });
}

/** Return needsConfirmation so the agent asks the user before calling confirm_action. */
function needsConfirmation(params: {
  confirmationId: string;
  action: string;
  resource: string;
  summary: string;
}): string {
  return JSON.stringify({
    success: false,
    needsConfirmation: true,
    ...params,
  });
}

/** Return needsClarification for missing required fields. */
function needsClarification(params: {
  missingFields: string[];
  message: string;
}): string {
  return JSON.stringify({
    success: false,
    needsClarification: true,
    ...params,
  });
}

/** Matches http/https URLs in text; captures full URL. */
const URL_IN_TEXT_REGEX = /https?:\/\/[^\s"'<>)\]]+/gi;

/**
 * Extract unique, valid URLs from a string (e.g. user message or details).
 */
function extractUrls(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const matches = text.match(URL_IN_TEXT_REGEX) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const url = raw.replace(/[.,;:!?)]+$/, "").trim();
    try {
      new URL(url);
      if (!seen.has(url)) {
        seen.add(url);
        out.push(url);
      }
    } catch {
      // skip invalid
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates all chat tools bound to a specific user context.
 * Tools are created fresh for each user session to ensure proper isolation.
 */
export function createChatTools(context: ToolContext) {
  const { userId, database, embedder, scraper } = context;

  // Pre-compile subgraphs
  const intentGraph = new IntentGraphFactory(database).createGraph();
  const profileGraph = new ProfileGraphFactory(database, embedder, scraper).createGraph();
  const hydeCache: HydeCache = new RedisCacheAdapter();
  const hydeGenerator = new HydeGenerator();
  const compiledHydeGraph = new HydeGraphFactory(
    database as unknown as HydeGraphDatabase,
    embedder,
    hydeCache,
    hydeGenerator
  ).createGraph();
  const opportunityGraph = new OpportunityGraph(
    database,
    embedder,
    hydeCache,
    compiledHydeGraph
  ).compile();

  // ─────────────────────────────────────────────────────────────────────────────
  // PROFILE TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

  const getUserProfile = tool(
    async () => {
      logger.info("Tool: get_user_profile", { userId });
      
      try {
        const profile = await database.getProfile(userId);
        
        if (!profile) {
          return success({
            hasProfile: false,
            message: "You don't have a profile yet. Would you like to create one? You can share your LinkedIn, GitHub, or X/Twitter profile, or just tell me about yourself."
          });
        }

        return success({
          hasProfile: true,
          profile: {
            name: profile.identity.name,
            bio: profile.identity.bio,
            location: profile.identity.location,
            skills: profile.attributes.skills,
            interests: profile.attributes.interests,
          }
        });
      } catch (err) {
        logger.error("get_user_profile failed", { error: err });
        return error("Failed to fetch profile. Please try again.");
      }
    },
    {
      name: "get_user_profile",
      description: "Fetches the user's profile including name, bio, skills, interests, and location. Returns profile data or indicates if no profile exists.",
      schema: z.object({})
    }
  );

  const updateUserProfile = tool(
    async (args: { action: string; details?: string }) => {
      logger.info("Tool: update_user_profile", { userId, action: args.action });

      const setPending = context.setPendingConfirmation;
      if (!setPending || !context.getPendingConfirmation) {
        return error("Confirmation is not available in this context.");
      }

      const inputForProfile = [args.action, args.details].filter(Boolean).join("\n") || (args.details ?? args.action);
      if (!inputForProfile.trim()) {
        return error("Please specify what to update (e.g. action: 'update bio to X').");
      }

      const confirmationId = crypto.randomUUID();
      const summary = `Update your profile: ${args.action.slice(0, 80)}${args.action.length > 80 ? "…" : ""}`;
      const payload: ConfirmationPayload = {
        resource: "profile",
        action: "update",
        updates: { input: inputForProfile },
      };
      setPending({
        id: confirmationId,
        action: "update",
        resource: "profile",
        summary,
        payload,
        createdAt: Date.now(),
      });
      return needsConfirmation({ confirmationId, action: "update", resource: "profile", summary });
    },
    {
      name: "update_user_profile",
      description: "Creates or updates the user's profile. Can add/remove skills and interests, update bio, or create a new profile from scratch. Use ONE call to apply all requested changes in a single turn—e.g. if the user asks to update bio, skills, and interests, pass all changes in action (and details if needed); do not call once per field. Use 'action' to describe what to do (e.g. 'update bio to X, add Python to skills, set interests to A and B'). Use 'details' for additional context or pasted content. For profile URLs: you MUST call scrape_url first for each URL, then pass the scraped content in 'details'—do not pass raw URLs here.",
      schema: z.object({
        action: z.string().describe("What to do: one or more changes, e.g. 'update bio to X', 'add Python to skills and set interests to A, B', 'create profile'. Combine all requested profile changes into this single action."),
        details: z.string().optional().describe("Additional context: URLs, specific content, or detailed instructions")
      })
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // INTENT TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

  async function getIntentsImpl(args: { indexNameOrId?: string }) {
    const effectiveIndex = args.indexNameOrId?.trim() || context.indexId?.trim() || undefined;
    const intents = effectiveIndex
      ? await database.getIntentsInIndexForMember(userId, effectiveIndex)
      : await database.getActiveIntents(userId);

    if (intents.length === 0) {
      return success({
        count: 0,
        intents: [],
        message: effectiveIndex
          ? "You don't have any intents in this index yet. Add one and I'll list it here."
          : "You don't have any active intents yet. Share your goals or what you're looking for, and I'll help track them.",
      });
    }

    return success({
      count: intents.length,
      intents: intents.map((i) => ({
        id: i.id,
        description: i.payload,
        summary: i.summary,
        createdAt: i.createdAt,
      })),
    });
  }

  const getIntents = tool(
    async (args: { indexNameOrId?: string }) => {
      logger.info("Tool: get_intents", { userId, indexNameOrId: args.indexNameOrId ?? undefined, contextIndexId: context.indexId });
      try {
        return await getIntentsImpl(args);
      } catch (err) {
        logger.error("get_intents failed", { error: err });
        return error("Failed to fetch intents. Please try again.");
      }
    },
    {
      name: "get_intents",
      description:
        "Fetches the user's intents (goals, wants, needs). With no index: returns all active intents. When the chat is scoped to an index or you pass indexNameOrId: returns only intents in that index. Returns id, description, summary, createdAt.",
      schema: z.object({
        indexNameOrId: z.string().optional().describe("Optional index name or UUID to list intents in that index only; when chat is index-scoped, omitting this uses the current index."),
      }),
    }
  );

  const getActiveIntents = tool(
    async () => {
      logger.warn("get_active_intents is deprecated; use get_intents instead.");
      try {
        return await getIntentsImpl({});
      } catch (err) {
        logger.error("get_active_intents failed", { error: err });
        return error("Failed to fetch intents. Please try again.");
      }
    },
    {
      name: "get_active_intents",
      description:
        "(Deprecated: prefer get_intents.) Fetches the user's active intents. When the conversation is scoped to an index, returns only intents in that index; otherwise returns all active intents.",
      schema: z.object({}),
    }
  );

  const getIntentsInIndex = tool(
    async (args: { indexNameOrId?: string }) => {
      const effectiveIndex = (args.indexNameOrId?.trim() || context.indexId?.trim()) ?? null;
      if (!effectiveIndex) {
        return error("Index required. Use index name or ID, or open chat from an index page.");
      }
      logger.info("Tool: get_intents_in_index", { userId, indexNameOrId: effectiveIndex });
      try {
        const intents = await database.getIntentsInIndexForMember(userId, effectiveIndex);
        return success({
          intents: intents.map((i) => ({
            id: i.id,
            payload: i.payload,
            summary: i.summary,
            createdAt: i.createdAt,
          })),
          count: intents.length,
        });
      } catch (err) {
        logger.error("get_intents_in_index failed", { error: err });
        return error("Failed to fetch intents for that index. Please try again.");
      }
    },
    {
      name: "get_intents_in_index",
      description:
        "Lists the user's active intents that are in a specific index (community). Use when the user asks to see their intents within a particular community. When the chat is scoped to an index, you can omit indexNameOrId to use that index. Otherwise pass index display name or index UUID.",
      schema: z.object({
        indexNameOrId: z.string().optional().describe("Index display name (e.g. 'Open Mock Network') or index UUID; optional when chat is index-scoped."),
      }),
    }
  );

  const createIntent = tool(
    async (args: { description: string; indexId?: string }) => {
      if (!args.description?.trim()) {
        return needsClarification({
          missingFields: ["description"],
          message: "Please provide a description of what you're looking for (e.g. your goal, want, or need).",
        });
      }
      logger.info("Tool: create_intent", { userId, description: args.description.substring(0, 50), indexId: args.indexId });

      try {
        let inputContent = args.description;
        const urls = extractUrls(args.description);
        if (urls.length > 0) {
          logger.info("Intent description contains URLs - scraping for context", { urlCount: urls.length });
          const parts: string[] = [args.description];
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

        // Get user profile for context
        const profile = await database.getProfile(userId);
        
        const effectiveIndexId = args.indexId?.trim() || context.indexId?.trim() || undefined;
        const intentInput = {
          userId,
          userProfile: profile ? JSON.stringify(profile) : "",
          inputContent,
          operationMode: 'create' as const,
          ...(effectiveIndexId ? { indexId: effectiveIndexId } : {})
        };

        const result = await intentGraph.invoke(intentInput);
        logger.debug("Intent graph response", { result });

        // Process execution results
        const created = (result.executionResults || [])
          .filter((r: any) => r.actionType === 'create' && r.success)
          .map((r: any) => ({
            id: r.intentId,
            description: r.payload || args.description
          }));

        // Assign created intents to indexes. When the user explicitly chose one index (effectiveIndexId), force-assign
        // so the intent always appears in that index. When no index is set, run the index graph so the LLM decides
        // which of the user's indexes each intent qualifies for.
        if (created.length > 0) {
          const scopeIndexIds = effectiveIndexId
            ? [effectiveIndexId]
            : await database.getUserIndexIds(userId);
          if (scopeIndexIds.length > 0) {
            const forceAssignSingleIndex = scopeIndexIds.length === 1;
            const indexGraph = forceAssignSingleIndex ? null : new IndexGraphFactory(database).createGraph();
            for (const intent of created) {
              for (const indexId of scopeIndexIds) {
                try {
                  if (forceAssignSingleIndex) {
                    await database.assignIntentToIndex(intent.id, indexId);
                  } else {
                    await indexGraph!.invoke({ intentId: intent.id, indexId });
                  }
                } catch (e) {
                  logger.warn("Index assignment failed", { intentId: intent.id, indexId });
                }
              }
            }
          }
        }

        if (created.length > 0) {
          return success({
            created: true,
            intents: created,
            message: `Created ${created.length} intent(s)`
          });
        }

        // Check if intents were inferred but not created (e.g., duplicates)
        const inferredCount = result.inferredIntents?.length || 0;
        if (inferredCount > 0) {
          return success({
            created: false,
            message: "The intent seems similar to one you already have. Would you like me to update an existing intent instead?"
          });
        }

        return error("Couldn't extract a clear intent from that. Could you be more specific about what you're looking for?");
      } catch (err) {
        logger.error("create_intent failed", { error: err });
        return error("Failed to create intent. Please try again.");
      }
    },
    {
      name: "create_intent",
      description: "Creates a new intent (goal, want, or need) for the user. Pass a concept-based description: what they want to achieve or find, in human-readable terms. If the user includes URLs (e.g. a repo or project link), include them in the description—the tool will scrape those URLs for context so the intent can be inferred from the actual project/content. Do not embed only raw URLs; describe the goal (e.g. 'Hiring developers for an open-source intent-driven discovery protocol' rather than just 'Hire developers for https://...'). When the user is clearly acting in a specific index/community (e.g. 'add my intent in YC Founders', 'my intents in Open Mock Network'), pass indexId so reconciliation is scoped to that index—use get_intents_in_index first if needed to get the index ID.",
      schema: z.object({
        description: z.string().describe("The intent/goal in conceptual terms; may include URLs—they will be scraped for context"),
        indexId: z.string().optional().describe("Optional index (community) ID when the user is creating the intent in a specific index; enables index-scoped reconciliation")
      })
    }
  );

  // UUID v4 format: 8-4-4-4-12 hex chars (e.g. c2505011-2e45-426e-81dd-b9abb9b72023)
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const updateIntent = tool(
    async (args: { intentId: string; newDescription: string }) => {
      const intentId = args.intentId?.trim() ?? "";
      logger.info("Tool: update_intent", { userId, intentId, contextIndexId: context.indexId });

      if (!UUID_REGEX.test(intentId)) {
        return error(
          "Invalid intent ID format. Use the exact 'id' value from get_intents (UUID format)."
        );
      }

      if (context.indexId?.trim()) {
        const intentsInIndex = await database.getIntentsInIndexForMember(userId, context.indexId);
        const inScope = intentsInIndex.some((i) => i.id === intentId);
        if (!inScope) {
          return error("That intent is not in the current index. You can only update intents that belong to this community.");
        }
      }

      const setPending = context.setPendingConfirmation;
      const getPending = context.getPendingConfirmation;
      if (!setPending || !getPending) {
        return error("Confirmation is not available in this context.");
      }

      try {
        const intent = await database.getIntent(intentId);
        if (!intent) {
          const currentIntents = await database.getActiveIntents(userId);
          return error(
            currentIntents.length === 0
              ? "Intent not found. You have no active intents. Create one with create_intent first."
              : "Intent not found. The ID may be wrong or from an old session. Here are your current intents—use the exact 'id' from the one you want to update: " +
                JSON.stringify(currentIntents.map((i) => ({ id: i.id, payload: i.payload, summary: i.summary })))
          );
        }
        if (intent.userId !== userId) {
          return error("You can only update your own intents.");
        }

        const confirmationId = crypto.randomUUID();
        const summary = `Update intent from "${(intent.summary || intent.payload || "").slice(0, 80)}${(intent.summary || intent.payload || "").length > 80 ? "…" : ""}" to "${args.newDescription.slice(0, 80)}${args.newDescription.length > 80 ? "…" : ""}"`;
        const payload: ConfirmationPayload = {
          resource: "intent",
          action: "update",
          intentId,
          newDescription: args.newDescription,
        };
        setPending({
          id: confirmationId,
          action: "update",
          resource: "intent",
          summary,
          payload,
          createdAt: Date.now(),
        });
        return needsConfirmation({ confirmationId, action: "update", resource: "intent", summary });
      } catch (err) {
        logger.error("update_intent failed", { error: err });
        return error("Failed to update intent. Please try again.");
      }
    },
    {
      name: "update_intent",
      description: "Updates an existing intent with a new description. Requires the intent ID (get it from get_intents first). When the chat is index-scoped, only intents in that index can be updated.",
      schema: z.object({
        intentId: z.string().describe("The ID of the intent to update"),
        newDescription: z.string().describe("The new description for the intent")
      })
    }
  );

  const deleteIntent = tool(
    async (args: { intentId: string }) => {
      const intentId = args.intentId?.trim() ?? "";
      logger.info("Tool: delete_intent", { userId, intentId, contextIndexId: context.indexId });

      if (!UUID_REGEX.test(intentId)) {
        return error(
          "Invalid intent ID format. Intent IDs must be UUIDs (e.g. c2505011-2e45-426e-81dd-b9abb9b72023). " +
          "Use the exact 'id' value from get_intents—do not add or remove characters."
        );
      }

      if (context.indexId?.trim()) {
        const intentsInIndex = await database.getIntentsInIndexForMember(userId, context.indexId);
        const inScope = intentsInIndex.some((i) => i.id === intentId);
        if (!inScope) {
          return error("That intent is not in the current index. You can only delete intents that belong to this community.");
        }
      }

      const setPending = context.setPendingConfirmation;
      if (!setPending || !context.getPendingConfirmation) {
        return error("Confirmation is not available in this context.");
      }

      try {
        const intent = await database.getIntent(intentId);
        if (!intent) {
          const currentIntents = await database.getActiveIntents(userId);
          return error(
            currentIntents.length === 0
              ? "Intent not found. You have no active intents."
              : "Intent not found. The ID may be wrong or from an old session. Here are your current intents—use the exact 'id' from the one you want to delete: " +
                JSON.stringify(currentIntents.map((i) => ({ id: i.id, payload: i.payload, summary: i.summary })))
          );
        }
        if (intent.userId !== userId) {
          return error("You can only delete your own intents.");
        }

        const confirmationId = crypto.randomUUID();
        const summary = `Delete intent: "${(intent.summary || intent.payload || "").slice(0, 100)}${(intent.summary || intent.payload || "").length > 100 ? "…" : ""}"`;
        const payload: ConfirmationPayload = { resource: "intent", action: "delete", intentId };
        setPending({
          id: confirmationId,
          action: "delete",
          resource: "intent",
          summary,
          payload,
          createdAt: Date.now(),
        });
        return needsConfirmation({ confirmationId, action: "delete", resource: "intent", summary });
      } catch (err) {
        logger.error("delete_intent failed", { error: err });
        return error("Failed to delete intent. Please try again.");
      }
    },
    {
      name: "delete_intent",
      description: "Deletes (archives) an existing intent. Requires the intent ID (get it from get_intents first). When the chat is index-scoped, only intents in that index can be deleted.",
      schema: z.object({
        intentId: z.string().describe("The ID of the intent to delete")
      })
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // INDEX TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

  const getIndexMemberships = tool(
    async (args: { showAll?: boolean }) => {
      logger.info("Tool: get_index_memberships", { userId, showAll: args.showAll, contextIndexId: context.indexId });

      try {
        const [allMemberships, ownedIndexes] = await Promise.all([
          database.getIndexMemberships(userId),
          database.getOwnedIndexes(userId),
        ]);

        const scopeToCurrentIndex = context.indexId?.trim() && !args.showAll;
        if (scopeToCurrentIndex) {
          const indexId = await resolveMemberIndexId(context.indexId!);
          if (!indexId) {
            return error("Current chat index not found or you are not a member. To see all your indexes, call this tool with showAll: true.");
          }
          const membership = allMemberships.find((m) => m.indexId === indexId);
          const owned = ownedIndexes.find((o) => o.id === indexId);
          return success({
            memberOf: membership
              ? [
                  {
                    indexId: membership.indexId,
                    title: membership.indexTitle,
                    description: membership.indexPrompt,
                    autoAssign: membership.autoAssign,
                    joinedAt: membership.joinedAt,
                  },
                ]
              : [],
            owns: owned ? [{ indexId: owned.id, title: owned.title, description: owned.prompt, memberCount: owned.memberCount, intentCount: owned.intentCount, joinPolicy: owned.permissions.joinPolicy }] : [],
            summary: {
              memberOfCount: membership ? 1 : 0,
              ownsCount: owned ? 1 : 0,
              scopeNote: "Showing membership for current index. To see all your indexes, ask 'list all my indexes'.",
            },
          });
        }

        return success({
          memberOf: allMemberships.map((m) => ({
            indexId: m.indexId,
            title: m.indexTitle,
            description: m.indexPrompt,
            autoAssign: m.autoAssign,
            joinedAt: m.joinedAt,
          })),
          owns: ownedIndexes.map((o) => ({
            indexId: o.id,
            title: o.title,
            description: o.prompt,
            memberCount: o.memberCount,
            intentCount: o.intentCount,
            joinPolicy: o.permissions.joinPolicy,
          })),
          summary: {
            memberOfCount: allMemberships.length,
            ownsCount: ownedIndexes.length,
          },
        });
      } catch (err) {
        logger.error("get_index_memberships failed", { error: err });
        return error("Failed to fetch index information. Please try again.");
      }
    },
    {
      name: "get_index_memberships",
      description:
        "Fetches indexes the user is a member of and indexes they own. When the chat is scoped to an index, returns only that index's membership unless showAll is true. Use showAll: true to list all indexes when the user asks to see all their indexes.",
      schema: z.object({
        showAll: z.boolean().optional().describe("When true and chat is index-scoped, return all memberships instead of just the current index."),
      }),
    }
  );

  // UUID v4 format for index IDs
  const INDEX_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Resolve index name or ID to indexId for an owned index.
   * Returns null if not found or user is not owner.
   */
  async function resolveOwnedIndexId(indexNameOrId: string): Promise<string | null> {
    const trimmed = indexNameOrId.trim();
    if (INDEX_UUID_REGEX.test(trimmed)) {
      const isOwner = await database.isIndexOwner(trimmed, userId);
      return isOwner ? trimmed : null;
    }
    const owned = await database.getOwnedIndexes(userId);
    const needle = trimmed.toLowerCase();
    const match = owned.find((o) => (o.title ?? "").toLowerCase() === needle || (o.title ?? "").toLowerCase().includes(needle));
    return match?.id ?? null;
  }

  /**
   * Resolve index name or ID to indexId for any index the user is a member of.
   * Returns null if not found or user is not a member.
   */
  async function resolveMemberIndexId(indexNameOrId: string): Promise<string | null> {
    const trimmed = indexNameOrId.trim();
    const memberships = await database.getIndexMemberships(userId);
    if (INDEX_UUID_REGEX.test(trimmed)) {
      const membership = memberships.find((m) => m.indexId === trimmed);
      return membership ? trimmed : null;
    }
    const needle = trimmed.toLowerCase();
    const match = memberships.find((m) => (m.indexTitle ?? "").toLowerCase() === needle || (m.indexTitle ?? "").toLowerCase().includes(needle));
    return match?.indexId ?? null;
  }

  const listIndexMembers = tool(
    async (args: { indexNameOrId?: string }) => {
      const effectiveIndex = (args.indexNameOrId?.trim() || context.indexId?.trim()) ?? null;
      if (!effectiveIndex) {
        return error("Index required. Use index name or ID, or open chat from an index page.");
      }
      logger.info("Tool: list_index_members", { userId, indexNameOrId: effectiveIndex });
      try {
        const indexId = await resolveMemberIndexId(effectiveIndex);
        if (!indexId) {
          return error("Index not found or you are not a member. Use get_index_memberships to see indexes you belong to.");
        }
        const members = await database.getIndexMembersForMember(indexId, userId);
        const result = success({
          indexId,
          count: members.length,
          members: members.map((m) => ({
            name: m.name,
            avatar: m.avatar,
            permissions: m.permissions,
            intentCount: m.intentCount,
            joinedAt: m.joinedAt,
          })),
        });
        return result;
      } catch (err) {
        logger.error("list_index_members failed", { error: err });
        if (err instanceof Error && err.message === "Access denied: Not a member of this index") {
          return error("You must be a member of that index to list its members. Use get_index_memberships to see your indexes.");
        }
        return error("Failed to fetch index members. Please try again.");
      }
    },
    {
      name: "list_index_members",
      description:
        "Lists all members of an index (community) you are a member of. When the chat is scoped to an index, you can omit indexNameOrId. Otherwise pass index display name or index UUID.",
      schema: z.object({
        indexNameOrId: z.string().optional().describe("Index display name (e.g. 'AI Founders') or index UUID; optional when chat is index-scoped."),
      }),
    }
  );

  const listIndexIntents = tool(
    async (args: { indexNameOrId?: string; limit?: number; offset?: number }) => {
      const effectiveIndex = (args.indexNameOrId?.trim() || context.indexId?.trim()) ?? null;
      if (!effectiveIndex) {
        return error("Index required. Use index name or ID, or open chat from an index page.");
      }
      logger.info("Tool: list_index_intents", { userId, indexNameOrId: effectiveIndex });
      try {
        const indexId = await resolveMemberIndexId(effectiveIndex);
        if (!indexId) {
          return error("Index not found or you are not a member. Use get_index_memberships to see indexes you belong to.");
        }
        const intents = await database.getIndexIntentsForMember(indexId, userId, {
          limit: args.limit ?? 50,
          offset: args.offset ?? 0,
        });
        const result = success({
          indexId,
          count: intents.length,
          intents: intents.map((i) => ({
            userName: i.userName,
            payload: i.payload,
            summary: i.summary,
            createdAt: i.createdAt,
          })),
        });
        return result;
      } catch (err) {
        logger.error("list_index_intents failed", { error: err });
        if (err instanceof Error && err.message === "Access denied: Not a member of this index") {
          return error("You must be a member of that index to list its intents. Use get_index_memberships to see your indexes.");
        }
        return error("Failed to fetch index intents. Please try again.");
      }
    },
    {
      name: "list_index_intents",
      description:
        "Lists all intents in an index you are a member of. When the chat is scoped to an index, you can omit indexNameOrId. Otherwise pass index display name or index UUID.",
      schema: z.object({
        indexNameOrId: z.string().optional().describe("Index display name (e.g. 'AI Founders') or index UUID; optional when chat is index-scoped."),
        limit: z.number().optional().describe("Max number of intents to return (default 50)"),
        offset: z.number().optional().describe("Offset for pagination (default 0)"),
      }),
    }
  );

  const updateIndexSettings = tool(
    async (args: { indexId?: string; settings: Record<string, unknown> }) => {
      const effectiveIndexId = (args.indexId?.trim() || context.indexId?.trim()) ?? null;
      if (!effectiveIndexId) {
        return error("Index required. Pass index ID or open chat from an index you own.");
      }
      logger.info("Tool: update_index_settings", { userId, indexId: effectiveIndexId });

      const setPending = context.setPendingConfirmation;
      if (!setPending || !context.getPendingConfirmation) {
        return error("Confirmation is not available in this context.");
      }

      try {
        const isOwner = await database.isIndexOwner(effectiveIndexId, userId);
        if (!isOwner) {
          return error("You can only modify indexes you own. Use get_index_memberships to see your owned indexes.");
        }

        const settingsData: Record<string, unknown> = {};
        if ("title" in args.settings) settingsData.title = args.settings.title;
        if ("prompt" in args.settings) settingsData.prompt = args.settings.prompt;
        if ("joinPolicy" in args.settings) settingsData.joinPolicy = args.settings.joinPolicy;
        if ("allowGuestVibeCheck" in args.settings) settingsData.allowGuestVibeCheck = args.settings.allowGuestVibeCheck;
        if ("private" in args.settings && args.settings.private) settingsData.joinPolicy = "invite_only";
        if ("public" in args.settings && args.settings.public) settingsData.joinPolicy = "anyone";

        const indexMeta = await database.getIndex(effectiveIndexId);
        const title = (indexMeta?.title ?? "this index").slice(0, 60);
        const confirmationId = crypto.randomUUID();
        const summary = `Update index "${title}" settings: ${Object.keys(settingsData).join(", ")}`;
        const payload: ConfirmationPayload = {
          resource: "index",
          action: "update",
          indexId: effectiveIndexId,
          updates: settingsData,
        };
        setPending({
          id: confirmationId,
          action: "update",
          resource: "index",
          summary,
          payload,
          createdAt: Date.now(),
        });
        return needsConfirmation({ confirmationId, action: "update", resource: "index", summary });
      } catch (err) {
        logger.error("update_index_settings failed", { error: err });
        return error("Failed to update index settings. Please try again.");
      }
    },
    {
      name: "update_index_settings",
      description:
        "Updates settings for an index the user owns. When the chat is scoped to an index, you can omit indexId to update that index. OWNER ONLY.",
      schema: z.object({
        indexId: z.string().optional().describe("The ID of the index to update; optional when chat is index-scoped."),
        settings: z.record(z.unknown()).describe("Settings to update: { title?, prompt?, joinPolicy?, private?, public?, allowGuestVibeCheck? }"),
      }),
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // DISCOVERY TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

  const findOpportunities = tool(
    async (args: { searchQuery: string; indexNameOrId?: string }) => {
      const effectiveIndex = (args.indexNameOrId?.trim() || context.indexId?.trim()) ?? null;
      logger.info("Tool: find_opportunities", { userId, query: args.searchQuery.substring(0, 50), indexScope: effectiveIndex ?? "all" });

      try {
        let indexScope: string[];
        if (effectiveIndex) {
          const resolvedId = await resolveMemberIndexId(effectiveIndex);
          if (!resolvedId) {
            return error("Index not found or you are not a member. Use get_index_memberships to see your indexes.");
          }
          indexScope = [resolvedId];
        } else {
          const memberships = await database.getIndexMemberships(userId);
          indexScope = memberships.map((m) => m.indexId);
        }

        const result = await runDiscoverFromQuery({
          opportunityGraph,
          database,
          userId,
          query: args.searchQuery,
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
      } catch (err) {
        logger.error("find_opportunities failed", { error: err });
        return error("Failed to search for opportunities. Please try again.");
      }
    },
    {
      name: "find_opportunities",
      description:
        "Searches for relevant connections and opportunities. Returns concise summaries (name, short bio, match reason, score). For full details use list_my_opportunities. When the chat is scoped to an index, search is limited to that index unless you pass a different index or omit index scope.",
      schema: z.object({
        searchQuery: z.string().describe("What kind of connections or opportunities to search for"),
        indexNameOrId: z.string().optional().describe("Limit search to this index; optional when chat is index-scoped (uses current index)."),
      }),
    }
  );

  const listMyOpportunities = tool(
    async (args: { indexNameOrId?: string }) => {
      const effectiveIndex = (args.indexNameOrId?.trim() || context.indexId?.trim()) ?? undefined;
      logger.info("Tool: list_my_opportunities", { userId, indexId: effectiveIndex });
      try {
        let indexIdFilter: string | undefined;
        if (effectiveIndex) {
          const resolved = await resolveMemberIndexId(effectiveIndex);
          if (!resolved) {
            return error("Index not found or you are not a member. Use get_index_memberships to see your indexes.");
          }
          indexIdFilter = resolved;
        }
        const list = await database.getOpportunitiesForUser(userId, {
          limit: 30,
          ...(indexIdFilter ? { indexId: indexIdFilter } : {}),
        });
        if (list.length === 0) {
          return success({
            count: 0,
            message: "You have no opportunities yet. Use find_opportunities to search for connections, or ask someone to suggest a connection for you.",
            opportunities: [],
          });
        }
        const sourceLabel: Record<string, string> = {
          chat: "Suggested in chat",
          opportunity_graph: "System match",
          manual: "Manual",
          cron: "Scheduled",
          member_added: "Member added",
        };
        const enriched = await Promise.all(
          list.map(async (opp) => {
            const otherParties = opp.actors.filter((a) => a.identityId !== userId && a.role === "party");
            const introducer = opp.actors.find((a) => a.role === "introducer");
            const partyIds = otherParties.map((a) => a.identityId);
            const idsToResolve = introducer ? [...partyIds, introducer.identityId] : partyIds;
            const [indexRecord, ...userRecords] = await Promise.all([
              database.getIndex(opp.indexId),
              ...idsToResolve.map((uid) => database.getUser(uid)),
            ]);
            const connectedWith = userRecords.slice(0, partyIds.length).map((u) => u?.name ?? "Unknown");
            const suggestedBy = introducer ? (userRecords[partyIds.length]?.name ?? "Unknown") : null;
            const category = opp.interpretation?.category ?? "connection";
            const confidence = opp.interpretation?.confidence ?? (opp.confidence ? Number(opp.confidence) : null);
            const source = opp.detection?.source ? (sourceLabel[opp.detection.source] ?? opp.detection.source) : null;
            return {
              id: opp.id,
              indexName: indexRecord?.title ?? opp.indexId,
              connectedWith,
              suggestedBy,
              summary: opp.interpretation?.summary ?? "Connection opportunity",
              status: opp.status,
              category,
              confidence: confidence != null ? confidence : null,
              source,
            };
          })
        );
        return success({
          count: enriched.length,
          message: `You have ${enriched.length} opportunity(en).`,
          opportunities: enriched,
        });
      } catch (err) {
        logger.error("list_my_opportunities failed", { error: err });
        return error("Failed to list opportunities. Please try again.");
      }
    },
    {
      name: "list_my_opportunities",
      description:
        "Lists the current user's opportunities (suggested connections). When the chat is scoped to an index, you can omit indexNameOrId to list only opportunities in that index.",
      schema: z.object({
        indexNameOrId: z.string().optional().describe("Limit to opportunities in this index; optional when chat is index-scoped."),
      }),
    }
  );

  // UUID v4 for user IDs
  const USER_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const createOpportunityBetweenMembers = tool(
    async (args: {
      indexNameOrId?: string;
      firstMemberRef: string;
      secondMemberRef: string;
      reasoning: string;
    }) => {
      const effectiveIndex = (args.indexNameOrId?.trim() || context.indexId?.trim()) ?? null;
      if (!effectiveIndex) {
        return error("Index required. Pass index name or ID, or open chat from an index.");
      }
      logger.info("Tool: create_opportunity_between_members", {
        userId,
        indexNameOrId: effectiveIndex,
        first: args.firstMemberRef.substring(0, 30),
        second: args.secondMemberRef.substring(0, 30),
      });

      try {
        const indexId = await resolveMemberIndexId(effectiveIndex);
        if (!indexId) {
          return error("Index not found or you are not a member. Use get_index_memberships to see indexes you belong to.");
        }

        const members = await database.getIndexMembersForMember(indexId, userId);

        const resolveRef = (ref: string): string | null => {
          const trimmed = ref.trim();
          if (USER_ID_REGEX.test(trimmed)) {
            const found = members.find((m) => m.userId === trimmed);
            return found ? trimmed : null;
          }
          const needle = trimmed.toLowerCase();
          const found = members.find(
            (m) =>
              (m.name ?? "").toLowerCase() === needle ||
              (m.name ?? "").toLowerCase().includes(needle) ||
              needle.includes((m.name ?? "").toLowerCase())
          );
          return found?.userId ?? null;
        };

        const firstUserId = resolveRef(args.firstMemberRef);
        const secondUserId = resolveRef(args.secondMemberRef);

        if (!firstUserId || !secondUserId) {
          return error(
            "Could not resolve one or both members. Use list_index_members to see names and ensure both people are in that index. firstMemberRef and secondMemberRef can be display names (e.g. Yanki, Seref) or user IDs."
          );
        }
        if (firstUserId === secondUserId) {
          return error("The two members must be different people.");
        }

        const partyIds = [firstUserId, secondUserId];
        const exists = await database.opportunityExistsBetweenActors(partyIds, indexId);
        if (exists) {
          return success({
            created: false,
            message: "An opportunity already exists between these two members in this index.",
          });
        }

        const actors: OpportunityActor[] = [
          { role: "party", identityId: firstUserId, intents: [], profile: true },
          { role: "party", identityId: secondUserId, intents: [], profile: true },
          { role: "introducer", identityId: userId, intents: [], profile: false },
        ];

        const data: CreateOpportunityData = {
          detection: {
            source: "chat",
            createdBy: userId,
            timestamp: new Date().toISOString(),
          },
          actors,
          interpretation: {
            category: "collaboration",
            summary: args.reasoning.trim() || "Suggested connection by a community member.",
            confidence: 0.8,
            signals: [{ type: "curator_judgment", weight: 1, detail: "Suggested via chat" }],
          },
          context: { indexId },
          indexId,
          confidence: "0.8",
          status: "pending",
        };

        const opportunity = await database.createOpportunity(data);
        const recipientIds = actors.filter((a) => a.role !== "introducer").map((a) => a.identityId);
        for (const recipientId of recipientIds) {
          if (recipientId === userId) continue;
          await queueOpportunityNotification(opportunity.id, recipientId, "high");
        }
        return success({
          created: true,
          opportunityId: opportunity.id,
          message: "Opportunity created. Both members can see it in their opportunities list.",
        });
      } catch (err) {
        logger.error("create_opportunity_between_members failed", { error: err });
        if (err instanceof Error && err.message === "Access denied: Not a member of this index") {
          return error("You must be a member of that index to suggest a connection. Use get_index_memberships to see your indexes.");
        }
        return error("Failed to create opportunity. Please try again.");
      }
    },
    {
      name: "create_opportunity_between_members",
      description:
        "Creates an opportunity (suggested connection) between two members of an index. Use when a user says they think two people should meet, e.g. 'I think Yanki and Seref should meet'. You must first use list_index_intents or list_index_members to identify the index and the two members' names. firstMemberRef and secondMemberRef can be display names (e.g. Yanki, Seref) or user IDs. You must be a member of the index. reasoning should briefly explain why they should connect.",
      schema: z.object({
        indexNameOrId: z.string().optional().describe("Index display name or UUID; optional when chat is index-scoped."),
        firstMemberRef: z.string().describe("First person: display name (e.g. Yanki) or user ID"),
        secondMemberRef: z.string().describe("Second person: display name (e.g. Seref) or user ID"),
        reasoning: z.string().describe("Brief reason why these two should connect (e.g. complementary intents)"),
      }),
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // UTILITY TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

  const scrapeUrl = tool(
    async (args: { url: string; objective?: string }) => {
      logger.info("Tool: scrape_url", { userId, url: args.url, hasObjective: !!args.objective });
      
      // Basic URL validation
      try {
        new URL(args.url);
      } catch {
        return error("Invalid URL format. Please provide a valid URL starting with http:// or https://");
      }
      
      try {
        const content = await scraper.extractUrlContent(args.url, {
          objective: args.objective?.trim() || undefined,
        });
        
        if (!content) {
          return error("Couldn't extract content from that URL. It may be blocked, require login, or have no extractable text.");
        }

        // Truncate very long content
        const truncatedContent = content.length > 10000
          ? content.substring(0, 10000) + "\n\n[Content truncated...]"
          : content;

        return success({
          url: args.url,
          contentLength: content.length,
          content: truncatedContent
        });
      } catch (err) {
        logger.error("scrape_url failed", { error: err, url: args.url });
        return error("Failed to scrape URL. The page may be inaccessible or blocked.");
      }
    },
    {
      name: "scrape_url",
      description: "Extracts text content from a URL (articles, profiles, documentation, etc.). Use this to read web pages, LinkedIn/GitHub profiles, or any public web content. Pass 'objective' when you know the downstream use: e.g. 'User wants to create an intent from this link (project/repo).' or 'User wants to update their profile from this page.' — this returns content better suited for that use.",
      schema: z.object({
        url: z.string().describe("The URL to scrape"),
        objective: z.string().optional().describe("Optional: why we're scraping. E.g. 'User wants to create an intent from this link' or 'User wants to update their profile from this page'. Omit for generic extraction.")
      })
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIRMATION TOOLS (Phase 4a)
  // ─────────────────────────────────────────────────────────────────────────────

  const confirmAction = tool(
    async (args: { confirmationId: string }) => {
      const getPending = context.getPendingConfirmation;
      const setPending = context.setPendingConfirmation;
      if (!getPending || !setPending) {
        return error("Confirmation not available in this context.");
      }
      const pending = getPending();
      if (!pending) {
        return error("There is no pending action to confirm.");
      }
      if (pending.id !== args.confirmationId) {
        return error("Confirmation ID does not match the pending action.");
      }
      const now = Date.now();
      if (now - pending.createdAt > CONFIRMATION_EXPIRY_MS) {
        setPending(undefined);
        return error("The pending confirmation has expired. Please start the action again.");
      }
      const payload = pending.payload;
      try {
        if (payload.resource === "intent" && payload.action === "update") {
          await database.updateIntent(payload.intentId, { payload: payload.newDescription });
        } else if (payload.resource === "intent" && payload.action === "delete") {
          await database.archiveIntent(payload.intentId);
        } else if (payload.resource === "profile" && payload.action === "update") {
          const profileGraphInstance = new ProfileGraphFactory(database as any, embedder, scraper).createGraph();
          const profileInput = (payload.updates as { input?: string }).input ?? JSON.stringify(payload.updates);
          await profileGraphInstance.invoke({
            userId,
            operationMode: "write",
            input: profileInput,
            forceUpdate: true,
          });
        } else if (payload.resource === "profile" && payload.action === "delete") {
          await database.deleteProfile(userId);
        } else if (payload.resource === "index" && payload.action === "update") {
          await database.updateIndexSettings(payload.indexId, userId, payload.updates as any);
        } else if (payload.resource === "index" && payload.action === "delete") {
          await database.softDeleteIndex(payload.indexId);
        } else if (payload.resource === "opportunity" && payload.action === "update") {
          const status = (payload.updates as { status?: string })?.status;
          if (status && ["accepted", "rejected", "expired"].includes(status)) {
            await database.updateOpportunityStatus(payload.opportunityId, status as "accepted" | "rejected" | "expired");
          } else {
            return error("Opportunity update requires status.");
          }
        } else if (payload.resource === "opportunity" && payload.action === "delete") {
          await database.updateOpportunityStatus(payload.opportunityId, "expired");
        } else {
          return error("Unknown confirmation payload.");
        }
        setPending(undefined);
        return success({ confirmed: true, message: "Action completed." });
      } catch (err) {
        logger.error("confirm_action execution failed", { payload, error: err });
        return error(err instanceof Error ? err.message : "Failed to execute action.");
      }
    },
    {
      name: "confirm_action",
      description: "Confirm and execute a pending destructive action (update or delete). Call this ONLY after the user has explicitly said yes to the summary you showed them. Do not call without user confirmation.",
      schema: z.object({
        confirmationId: z.string().describe("The confirmation ID from the needsConfirmation response."),
      }),
    }
  );

  const cancelAction = tool(
    async (args: { confirmationId: string }) => {
      const getPending = context.getPendingConfirmation;
      const setPending = context.setPendingConfirmation;
      if (!getPending || !setPending) {
        return error("Confirmation not available in this context.");
      }
      const pending = getPending();
      if (!pending) {
        return success({ cancelled: true, message: "No pending action." });
      }
      if (pending.id !== args.confirmationId) {
        return error("Confirmation ID does not match the pending action.");
      }
      setPending(undefined);
      return success({ cancelled: true, message: "Action cancelled." });
    },
    {
      name: "cancel_action",
      description: "Cancel a pending destructive action without executing it. Call when the user says no or cancel.",
      schema: z.object({
        confirmationId: z.string().describe("The confirmation ID from the needsConfirmation response."),
      }),
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // RETURN ALL TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

  return [
    // Confirmation tools (Phase 4a)
    confirmAction,
    cancelAction,
    // Profile tools
    getUserProfile,
    updateUserProfile,
    // Intent tools
    getIntents,
    getActiveIntents, // deprecated alias for get_intents
    getIntentsInIndex,
    createIntent,
    updateIntent,
    deleteIntent,
    // Index tools
    getIndexMemberships,
    listIndexMembers,
    listIndexIntents,
    updateIndexSettings,
    // Discovery tools
    findOpportunities,
    listMyOpportunities,
    createOpportunityBetweenMembers,
    // Utility tools
    scrapeUrl
  ];
}

/**
 * Type for the tools array returned by createChatTools.
 */
export type ChatTools = ReturnType<typeof createChatTools>;
