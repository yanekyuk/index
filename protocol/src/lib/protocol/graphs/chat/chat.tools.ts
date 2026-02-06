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
  /** When set, chat is scoped to this index; tools use it as default for read_intents and create_intent. */
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

/** UUID v4 format: 8-4-4-4-12 hex chars (e.g. c2505011-2e45-426e-81dd-b9abb9b72023) */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const readUserProfiles = tool(
    async () => {
      logger.info("Tool: read_user_profiles", { userId });

      try {
        const profile = await database.getProfileByUserId(userId);

        if (!profile) {
          return success({
            hasProfile: false,
            message: "You don't have a profile yet. Would you like to create one? You can share your LinkedIn, GitHub, or X/Twitter profile, or just tell me about yourself.",
          });
        }

        return success({
          hasProfile: true,
          profile: {
            id: profile.id,
            name: profile.identity.name,
            bio: profile.identity.bio,
            location: profile.identity.location,
            skills: profile.attributes.skills,
            interests: profile.attributes.interests,
          },
        });
      } catch (err) {
        logger.error("read_user_profiles failed", { error: err });
        return error("Failed to fetch profile. Please try again.");
      }
    },
    {
      name: "read_user_profiles",
      description: "Fetches the user's profile including id, name, bio, skills, interests, and location. Returns profile data (with id field for use in update_user_profile) or indicates if no profile exists.",
      schema: z.object({}),
    }
  );

  const createUserProfile = tool(
    async (args: { action: string; details?: string }) => {
      logger.info("Tool: create_user_profile", { userId, action: args.action });

      const inputForProfile = [args.action, args.details].filter(Boolean).join("\n") || (args.details ?? args.action);
      if (!inputForProfile.trim()) {
        return error("Please specify what to put in the profile (e.g. action: 'Create my profile from the following', details: pasted content).");
      }

      try {
        const existing = await database.getProfile(userId);
        if (existing) {
          return error("You already have a profile. Use update_user_profile to change it.");
        }
        const profileGraphInstance = new ProfileGraphFactory(database as any, embedder, scraper).createGraph();
        await profileGraphInstance.invoke({
          userId,
          operationMode: "write",
          input: inputForProfile,
          forceUpdate: true,
        });
        const profile = await database.getProfile(userId);
        if (!profile) return error("Profile creation failed.");
        return success({
          created: true,
          message: "Profile created.",
          profile: {
            name: profile.identity.name,
            bio: profile.identity.bio,
            location: profile.identity.location,
            skills: profile.attributes.skills,
            interests: profile.attributes.interests,
          },
        });
      } catch (err) {
        logger.error("create_user_profile failed", { error: err });
        return error("Failed to create profile. Please try again.");
      }
    },
    {
      name: "create_user_profile",
      description:
        "Creates a new profile for the user. Only use when the user has no profile yet. For profile URLs you MUST call scrape_url first, then pass the scraped content in details. Use 'action' to describe what to do (e.g. 'Create my profile from the following').",
      schema: z.object({
        action: z.string().describe("What to do, e.g. 'Create my profile from the following'"),
        details: z.string().optional().describe("Additional context or pasted content from scrape_url"),
      }),
    }
  );

  const updateUserProfile = tool(
    async (args: { profileId: string; action: string; details?: string }) => {
      logger.info("Tool: update_user_profile", { userId, profileId: args.profileId, action: args.action });

      const setPending = context.setPendingConfirmation;
      if (!setPending || !context.getPendingConfirmation) {
        return error("Confirmation is not available in this context.");
      }

      const profileWithId = await database.getProfileByUserId(userId);
      if (!profileWithId) {
        return error("You don't have a profile yet. Use create_user_profile first.");
      }
      if (profileWithId.id !== args.profileId.trim()) {
        return error("Invalid profileId. Use the profile id from read_user_profiles.");
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
      description:
        "Updates the user's existing profile. Requires profileId from read_user_profiles. Use ONE call per request with all changes in action (and details if needed). For profile URLs call scrape_url first, then pass scraped content in details.",
      schema: z.object({
        profileId: z.string().describe("The profile id from read_user_profiles"),
        action: z.string().describe("What to do: one or more changes, e.g. 'update bio to X', 'add Python to skills'"),
        details: z.string().optional().describe("Additional context or pasted content"),
      }),
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // INTENT TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

  const readIntents = tool(
    async (args: { indexId?: string; userId?: string }) => {
      const indexId = args.indexId?.trim() || context.indexId?.trim() || undefined;
      if (indexId && !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }
      const effectiveUserId = args.userId?.trim() || userId;
      logger.info("Tool: read_intents", { userId, indexId, effectiveUserId });

      try {
        if (indexId) {
          const isOwner = await database.isIndexOwner(indexId, userId);
          const isMember = await database.isIndexMember(indexId, userId);
          if (!isMember) {
            return error("Index not found or you are not a member. Use read_indexes to see your indexes.");
          }
          if (isOwner && !args.userId) {
            const intents = await database.getIndexIntentsForOwner(indexId, userId, { limit: 50, offset: 0 });
            if (intents.length === 0) {
              return success({ count: 0, intents: [], message: "No intents in this index yet.", indexId });
            }
            return success({
              count: intents.length,
              indexId,
              intents: intents.map((i) => ({
                id: i.id,
                description: i.payload,
                summary: i.summary,
                createdAt: i.createdAt,
                userId: i.userId,
                userName: i.userName,
              })),
            });
          }
          const intents = await database.getIntentsInIndexForMember(effectiveUserId, indexId);
          if (intents.length === 0) {
            return success({
              count: 0,
              intents: [],
              message: effectiveUserId === userId ? "You don't have any intents in this index yet." : "No intents for that user in this index.",
              indexId,
            });
          }
          return success({
            count: intents.length,
            indexId,
            intents: intents.map((i) => ({
              id: i.id,
              description: i.payload,
              summary: i.summary,
              createdAt: i.createdAt,
          })),
        });
      }
      
      // Global (no-index) path: restrict to session user only
      if (effectiveUserId !== userId) {
        return error("Not authorized to view other users' global intents. You can only view your own intents when no index is specified.");
      }
      
      const intents = await database.getActiveIntents(effectiveUserId);
      if (intents.length === 0) {
        return success({
          count: 0,
          intents: [],
          message: "You don't have any active intents yet. Share your goals or what you're looking for.",
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
      } catch (err) {
        logger.error("read_intents failed", { error: err });
        return error("Failed to fetch intents. Please try again.");
      }
    },
    {
      name: "read_intents",
      description:
        "Fetches intents (goals, wants, needs). With no indexId: returns the user's active intents. With indexId: if you are the index owner and omit userId, returns all intents in that index; otherwise returns intents for the given user (or yourself) in that index. indexId must be a UUID from read_indexes.",
      schema: z.object({
        indexId: z.string().optional().describe("Index UUID; optional when chat is index-scoped (uses current index)."),
        userId: z.string().optional().describe("When index-scoped and you are owner, limit to this user's intents; omit to list all intents in the index."),
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
      description: "Creates a new intent (goal, want, or need) for the user. Pass a concept-based description. When the user is clearly acting in a specific index, pass indexId (UUID from read_indexes). If the user includes URLs, include them in the description—the tool will scrape for context.",
      schema: z.object({
        description: z.string().describe("The intent/goal in conceptual terms; may include URLs—they will be scraped for context"),
        indexId: z.string().optional().describe("Optional index UUID from read_indexes when creating in a specific index."),
      })
    }
  );

  const updateIntent = tool(
    async (args: { intentId: string; newDescription: string }) => {
      const intentId = args.intentId?.trim() ?? "";
      logger.info("Tool: update_intent", { userId, intentId, contextIndexId: context.indexId });

      if (!UUID_REGEX.test(intentId)) {
        return error(
          "Invalid intent ID format. Use the exact 'id' value from read_intents (UUID format)."
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
              ? "Intent not found. You have no active intents. Create one with create_intent, then use read_intents to get the id."
              : "Intent not found. The ID may be wrong or from an old session. Call read_intents to get current intents and use the exact 'id': " +
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
      description: "Updates an existing intent with a new description. Requires the intent ID from read_intents. When the chat is index-scoped, only intents in that index can be updated.",
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
          "Use the exact 'id' value from read_intents—do not add or remove characters."
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
      description: "Deletes (archives) an existing intent. Requires the intent ID from read_intents. When the chat is index-scoped, only intents in that index can be deleted.",
      schema: z.object({
        intentId: z.string().describe("The ID of the intent to delete")
      })
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // INDEX TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

  const readIndexes = tool(
    async (args: { userId?: string; showAll?: boolean }) => {
      const effectiveUser = args.userId?.trim() || userId;
      if (args.userId && args.userId.trim() !== userId) {
        return error("You can only list your own indexes. Omit userId to see the current user's indexes.");
      }
      logger.info("Tool: read_indexes", { userId, effectiveUser, showAll: args.showAll, contextIndexId: context.indexId });

      try {
        const [allMemberships, ownedIndexes] = await Promise.all([
          database.getIndexMemberships(effectiveUser),
          database.getOwnedIndexes(effectiveUser),
        ]);

        const scopeToCurrentIndex = context.indexId?.trim() && !args.showAll;
        if (scopeToCurrentIndex) {
          const indexId = context.indexId!;
          const isMember = await database.isIndexMember(indexId, userId);
          if (!isMember) {
            return error("Current chat index not found or you are not a member. To see all your indexes, call with showAll: true.");
          }
          const membership = allMemberships.find((m) => m.indexId === indexId);
          const owned = ownedIndexes.find((o) => o.id === indexId);
          return success({
            memberOf: membership ? [{ indexId: membership.indexId, title: membership.indexTitle, description: membership.indexPrompt, autoAssign: membership.autoAssign, joinedAt: membership.joinedAt }] : [],
            owns: owned ? [{ indexId: owned.id, title: owned.title, description: owned.prompt, memberCount: owned.memberCount, intentCount: owned.intentCount, joinPolicy: owned.permissions.joinPolicy }] : [],
            summary: { memberOfCount: membership ? 1 : 0, ownsCount: owned ? 1 : 0, scopeNote: "Showing current index. Use showAll: true for all indexes." },
          });
        }

        return success({
          memberOf: allMemberships.map((m) => ({ indexId: m.indexId, title: m.indexTitle, description: m.indexPrompt, autoAssign: m.autoAssign, joinedAt: m.joinedAt })),
          owns: ownedIndexes.map((o) => ({ indexId: o.id, title: o.title, description: o.prompt, memberCount: o.memberCount, intentCount: o.intentCount, joinPolicy: o.permissions.joinPolicy })),
          summary: { memberOfCount: allMemberships.length, ownsCount: ownedIndexes.length },
        });
      } catch (err) {
        logger.error("read_indexes failed", { error: err });
        return error("Failed to fetch index information. Please try again.");
      }
    },
    {
      name: "read_indexes",
      description: "Lists indexes the user is a member of and indexes they own. Optional userId (omit for current user). When chat is index-scoped, returns only that index unless showAll: true.",
      schema: z.object({
        userId: z.string().optional().describe("Omit for current user."),
        showAll: z.boolean().optional().describe("When true and chat is index-scoped, return all indexes."),
      }),
    }
  );

  const readUsers = tool(
    async (args: { indexId: string }) => {
      const indexId = args.indexId?.trim();
      if (!indexId || !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }
      logger.info("Tool: read_users", { userId, indexId });
      try {
        const isMember = await database.isIndexMember(indexId, userId);
        if (!isMember) {
          return error("Index not found or you are not a member. Use read_indexes to see your indexes.");
        }
        const members = await database.getIndexMembersForMember(indexId, userId);
        return success({
          indexId,
          count: members.length,
          members: members.map((m) => ({ userId: m.userId, name: m.name, avatar: m.avatar, permissions: m.permissions, intentCount: m.intentCount, joinedAt: m.joinedAt })),
        });
      } catch (err) {
        logger.error("read_users failed", { error: err });
        if (err instanceof Error && err.message === "Access denied: Not a member of this index") {
          return error("You must be a member of that index. Use read_indexes to see your indexes.");
        }
        return error("Failed to fetch index members. Please try again.");
      }
    },
    {
      name: "read_users",
      description: "Lists all members of an index with their userId, name, avatar, permissions, intentCount, and joinedAt. Requires indexId (UUID from read_indexes). You must be a member of the index. Use the returned userId values to unambiguously reference members in other tools like create_opportunity_between_members.",
      schema: z.object({
        indexId: z.string().describe("Index UUID from read_indexes."),
      }),
    }
  );

  const updateIndex = tool(
    async (args: { indexId?: string; settings: Record<string, unknown> }) => {
      const effectiveIndexId = (args.indexId?.trim() || context.indexId?.trim()) ?? null;
      if (!effectiveIndexId) {
        return error("Index required. Pass index UUID or open chat from an index you own.");
      }
      if (!UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }
      logger.info("Tool: update_index", { userId, indexId: effectiveIndexId });

      const setPending = context.setPendingConfirmation;
      if (!setPending || !context.getPendingConfirmation) {
        return error("Confirmation is not available in this context.");
      }

      try {
        const isOwner = await database.isIndexOwner(effectiveIndexId, userId);
        if (!isOwner) {
          return error("You can only modify indexes you own. Use read_indexes to see your owned indexes.");
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
        logger.error("update_index failed", { error: err });
        return error("Failed to update index. Please try again.");
      }
    },
    {
      name: "update_index",
      description: "Updates an index the user owns. Pass indexId (UUID from read_indexes) or omit when chat is index-scoped. OWNER ONLY.",
      schema: z.object({
        indexId: z.string().optional().describe("Index UUID; optional when chat is index-scoped."),
        settings: z.record(z.unknown()).describe("Settings to update: { title?, prompt?, joinPolicy?, allowGuestVibeCheck? }"),
      }),
    }
  );

  const createIndex = tool(
    async (args: { title: string; prompt?: string; joinPolicy?: 'anyone' | 'invite_only' }) => {
      if (!args.title?.trim()) {
        return error("Title is required.");
      }
      logger.info("Tool: create_index", { userId, title: args.title });
      let createdIndexId: string | undefined;
      try {
        const index = await database.createIndex({
          title: args.title.trim(),
          prompt: args.prompt?.trim() || undefined,
          joinPolicy: args.joinPolicy,
        });
        createdIndexId = index.id;
        
        const added = await database.addMemberToIndex(index.id, userId, 'owner');
        if (!added.success) {
          // Cleanup: delete the orphaned index since adding the owner failed
          logger.error("addMemberToIndex failed after createIndex; cleaning up orphaned index", { 
            indexId: index.id, 
            userId 
          });
          try {
            await database.softDeleteIndex(index.id);
            logger.info("Successfully cleaned up orphaned index", { indexId: index.id });
          } catch (cleanupErr) {
            logger.error("Failed to cleanup orphaned index", { 
              indexId: index.id, 
              cleanupError: cleanupErr 
            });
          }
          return error("Failed to set you as owner of the index. The index was not created. Please try again.");
        }
        return success({
          created: true,
          indexId: index.id,
          title: index.title,
          message: `Index "${index.title}" created. You are the owner.`,
        });
      } catch (err) {
        logger.error("create_index failed", { error: err });
        // If we created an index but an exception occurred, clean it up
        if (createdIndexId) {
          logger.error("Exception after createIndex; cleaning up orphaned index", { 
            indexId: createdIndexId, 
            userId 
          });
          try {
            await database.softDeleteIndex(createdIndexId);
            logger.info("Successfully cleaned up orphaned index after exception", { 
              indexId: createdIndexId 
            });
          } catch (cleanupErr) {
            logger.error("Failed to cleanup orphaned index after exception", { 
              indexId: createdIndexId, 
              cleanupError: cleanupErr 
            });
          }
        }
        return error("Failed to create index. Please try again.");
      }
    },
    {
      name: "create_index",
      description: "Creates a new index (community). You become the owner. Pass title; optional prompt and joinPolicy ('anyone' | 'invite_only').",
      schema: z.object({
        title: z.string().describe("Display name of the index"),
        prompt: z.string().optional().describe("What the community is about"),
        joinPolicy: z.enum(['anyone', 'invite_only']).optional().describe("Who can join; default invite_only"),
      }),
    }
  );

  const deleteIndex = tool(
    async (args: { indexId: string }) => {
      const indexId = args.indexId?.trim();
      if (!indexId || !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }
      logger.info("Tool: delete_index", { userId, indexId });

      const setPending = context.setPendingConfirmation;
      if (!setPending || !context.getPendingConfirmation) {
        return error("Confirmation is not available in this context.");
      }

      try {
        const isOwner = await database.isIndexOwner(indexId, userId);
        if (!isOwner) {
          return error("You can only delete indexes you own. Use read_indexes to see your owned indexes.");
        }
        const count = await database.getIndexMemberCount(indexId);
        if (count > 1) {
          return error("Cannot delete index with other members. Remove members first or transfer ownership.");
        }
        const indexMeta = await database.getIndex(indexId);
        const title = (indexMeta?.title ?? "this index").slice(0, 60);
        const confirmationId = crypto.randomUUID();
        const summary = `Delete index "${title}"`;
        const payload: ConfirmationPayload = { resource: "index", action: "delete", indexId };
        setPending({ id: confirmationId, action: "delete", resource: "index", summary, payload, createdAt: Date.now() });
        return needsConfirmation({ confirmationId, action: "delete", resource: "index", summary });
      } catch (err) {
        logger.error("delete_index failed", { error: err });
        return error("Failed to prepare delete. Please try again.");
      }
    },
    {
      name: "delete_index",
      description: "Deletes an index you own. Only allowed when you are the only member. Requires indexId (UUID from read_indexes).",
      schema: z.object({
        indexId: z.string().describe("Index UUID from read_indexes."),
      }),
    }
  );

  const createIndexMembership = tool(
    async (args: { userId: string; indexId: string }) => {
      const indexId = args.indexId?.trim();
      const targetUserId = args.userId?.trim();
      if (!indexId || !UUID_REGEX.test(indexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }
      if (!targetUserId) {
        return error("userId is required.");
      }
      logger.info("Tool: create_index_membership", { userId, indexId, targetUserId });

      try {
        const indexRecord = await database.getIndexWithPermissions(indexId);
        if (!indexRecord) {
          return error("Index not found.");
        }
        const joinPolicy = indexRecord.permissions.joinPolicy;
        const isMember = await database.isIndexMember(indexId, userId);
        if (!isMember) {
          return error("You must be a member of that index to add others.");
        }
        if (joinPolicy === 'invite_only') {
          const isOwner = await database.isIndexOwner(indexId, userId);
          if (!isOwner) {
            return error("Only the index owner can add members when the index is invite-only.");
          }
        }
        const result = await database.addMemberToIndex(indexId, targetUserId, 'member');
        if (result.alreadyMember) {
          return success({ created: false, message: "That user is already a member of this index." });
        }
        return success({ created: true, message: "Member added to the index." });
      } catch (err) {
        logger.error("create_index_membership failed", { error: err });
        return error(err instanceof Error ? err.message : "Failed to add member. Please try again.");
      }
    },
    {
      name: "create_index_membership",
      description: "Adds a user as a member of an index. Requires userId and indexId (UUIDs). For invite_only indexes only the owner can add members.",
      schema: z.object({
        userId: z.string().describe("User ID to add as a member"),
        indexId: z.string().describe("Index UUID from read_indexes"),
      }),
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // DISCOVERY TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

  const findOpportunities = tool(
    async (args: { searchQuery: string; indexId?: string }) => {
      const effectiveIndexId = (args.indexId?.trim() || context.indexId?.trim()) ?? null;
      logger.info("Tool: find_opportunities", { userId, query: args.searchQuery.substring(0, 50), indexScope: effectiveIndexId ?? "all" });

      try {
        let indexScope: string[];
        if (effectiveIndexId) {
          if (!UUID_REGEX.test(effectiveIndexId)) {
            return error("Invalid index ID format. Use the exact UUID from read_indexes.");
          }
          const isMember = await database.isIndexMember(effectiveIndexId, userId);
          if (!isMember) {
            return error("Index not found or you are not a member. Use read_indexes to see your indexes.");
          }
          indexScope = [effectiveIndexId];
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
        indexId: z.string().optional().describe("Index UUID from read_indexes; optional when chat is index-scoped."),
      }),
    }
  );

  const listMyOpportunities = tool(
    async (args: { indexId?: string }) => {
      const effectiveIndexId = (args.indexId?.trim() || context.indexId?.trim()) ?? undefined;
      logger.info("Tool: list_my_opportunities", { userId, indexId: effectiveIndexId });
      try {
        let indexIdFilter: string | undefined;
        if (effectiveIndexId) {
          if (!UUID_REGEX.test(effectiveIndexId)) {
            return error("Invalid index ID format. Use the exact UUID from read_indexes.");
          }
          const isMember = await database.isIndexMember(effectiveIndexId, userId);
          if (!isMember) {
            return error("Index not found or you are not a member. Use read_indexes to see your indexes.");
          }
          indexIdFilter = effectiveIndexId;
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
        "Lists the current user's opportunities (suggested connections). When the chat is scoped to an index, you can omit indexId to list only opportunities in that index.",
      schema: z.object({
        indexId: z.string().optional().describe("Index UUID from read_indexes; optional when chat is index-scoped."),
      }),
    }
  );

  const createOpportunityBetweenMembers = tool(
    async (args: {
      indexId?: string;
      firstMemberRef: string;
      secondMemberRef: string;
      reasoning: string;
    }) => {
      const effectiveIndexId = (args.indexId?.trim() || context.indexId?.trim()) ?? null;
      if (!effectiveIndexId) {
        return error("Index required. Pass index UUID from read_indexes, or open chat from an index.");
      }
      if (!UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }
      logger.info("Tool: create_opportunity_between_members", {
        userId,
        indexId: effectiveIndexId,
        first: args.firstMemberRef.substring(0, 30),
        second: args.secondMemberRef.substring(0, 30),
      });

      try {
        const isMember = await database.isIndexMember(effectiveIndexId, userId);
        if (!isMember) {
          return error("Index not found or you are not a member. Use read_indexes to see indexes you belong to.");
        }

        const members = await database.getIndexMembersForMember(effectiveIndexId, userId);

        const resolveRef = (ref: string): string | null => {
          const trimmed = ref.trim();
          if (UUID_REGEX.test(trimmed)) {
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
            "Could not resolve one or both members. Use read_users to see names and ensure both people are in that index. firstMemberRef and secondMemberRef can be display names or user IDs."
          );
        }
        if (firstUserId === secondUserId) {
          return error("The two members must be different people.");
        }

        const partyIds = [firstUserId, secondUserId];
        const exists = await database.opportunityExistsBetweenActors(partyIds, effectiveIndexId);
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
          context: { indexId: effectiveIndexId },
          indexId: effectiveIndexId,
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
          return error("You must be a member of that index to suggest a connection. Use read_indexes to see your indexes.");
        }
        return error("Failed to create opportunity. Please try again.");
      }
    },
    {
      name: "create_opportunity_between_members",
      description:
        "Creates an opportunity (suggested connection) between two members of an index. Use read_users to get member userId and name, then pass indexId (UUID from read_indexes), firstMemberRef, secondMemberRef (prefer userId from read_users for unambiguous matching; display names also work), and reasoning.",
      schema: z.object({
        indexId: z.string().optional().describe("Index UUID from read_indexes; optional when chat is index-scoped."),
        firstMemberRef: z.string().describe("First person: userId from read_users (preferred) or display name"),
        secondMemberRef: z.string().describe("Second person: userId from read_users (preferred) or display name"),
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
    confirmAction,
    cancelAction,
    readUserProfiles,
    createUserProfile,
    updateUserProfile,
    readIntents,
    createIntent,
    updateIntent,
    deleteIntent,
    readIndexes,
    createIndex,
    updateIndex,
    deleteIndex,
    createIndexMembership,
    readUsers,
    findOpportunities,
    listMyOpportunities,
    createOpportunityBetweenMembers,
    scrapeUrl,
  ];
}

/**
 * Type for the tools array returned by createChatTools.
 */
export type ChatTools = ReturnType<typeof createChatTools>;
