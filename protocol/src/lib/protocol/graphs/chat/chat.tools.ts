import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ChatGraphCompositeDatabase, HydeGraphDatabase } from "../../interfaces/database.interface";
import type { Embedder } from "../../interfaces/embedder.interface";
import type { Scraper } from "../../interfaces/scraper.interface";
import type { HydeCache } from "../../interfaces/cache.interface";
import { IntentGraphFactory } from "../intent/intent.graph";
import { ProfileGraphFactory } from "../profile/profile.graph";
import { OpportunityGraphFactory } from "../opportunity/opportunity.graph";
import { HydeGraphFactory } from "../hyde/hyde.graph";
import { HydeGenerator } from "../../agents/hyde/hyde.generator";
import { IndexGraphFactory } from "../index/index.graph";
import { IndexMembershipGraphFactory } from "../index_membership/index_membership.graph";
import { IntentIndexGraphFactory } from "../intent_index/intent_index.graph";
import { RedisCacheAdapter } from "../../../../adapters/cache.adapter";
import { runDiscoverFromQuery } from "../opportunity/opportunity.discover";
import type { ExecutionResult } from "../intent/intent.graph.state";
import { protocolLogger } from "../../protocol.log";
import type { PendingConfirmation, ConfirmationPayload } from "./chat.graph.state";

const logger = protocolLogger("ChatTools");

/** Five minutes in ms for confirmation expiry. */
const CONFIRMATION_EXPIRY_MS = 5 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL CONTEXT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolved context available to every tool handler.
 * Contains the current user and optional index identity, resolved from DB at init.
 * The LLM can see this context (via system prompt) but cannot change it.
 */
export interface ResolvedToolContext {
  userId: string;
  userName: string;
  userEmail: string;
  indexId?: string;
  indexName?: string;
  /** True when chat is index-scoped and the user owns the index. */
  isOwner?: boolean;
}

/**
 * Dependencies passed when creating tools for a user session.
 * Includes DB adapters, embedder, scraper, and confirmation helpers.
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
 * Resolves user/index identity from DB at init time.
 * Tools are created fresh for each user session to ensure proper isolation.
 */
export async function createChatTools(deps: ToolContext) {
  const { database, embedder, scraper, getPendingConfirmation, setPendingConfirmation } = deps;

  // ─── Resolve context from DB ───────────────────────────────────────────────
  const user = await database.getUser(deps.userId);
  const indexInfo = deps.indexId ? await database.getIndex(deps.indexId) : null;
  const isOwner = deps.indexId ? await database.isIndexOwner(deps.indexId, deps.userId) : false;

  const resolvedContext: ResolvedToolContext = {
    userId: deps.userId,
    userName: user?.name ?? "Unknown",
    userEmail: user?.email ?? "",
    indexId: deps.indexId,
    indexName: indexInfo?.title,
    isOwner,
  };

  // ─── Tool wrapper ──────────────────────────────────────────────────────────
  /**
   * Standardized tool factory. Auto-injects resolved context and
   * provides uniform logging / error handling for every tool.
   */
  function defineTool<T extends z.ZodType>(opts: {
    name: string;
    description: string;
    querySchema: T;
    handler: (input: { context: ResolvedToolContext; query: z.infer<T> }) => Promise<string>;
  }) {
    return tool(
      async (query: z.infer<T>) => {
        logger.info(`Tool: ${opts.name}`, {
          context: { userId: resolvedContext.userId, indexId: resolvedContext.indexId },
          query,
        });
        try {
          return await opts.handler({ context: resolvedContext, query });
        } catch (err) {
          logger.error(`${opts.name} failed`, {
            error: err instanceof Error ? err.message : String(err),
          });
          return error(`Failed to execute ${opts.name}. Please try again.`);
        }
      },
      { name: opts.name, description: opts.description, schema: opts.querySchema }
    );
  }

  // Pre-compile all 6 domain subgraphs
  const intentGraph = new IntentGraphFactory(database, embedder).createGraph();
  const profileGraph = new ProfileGraphFactory(database, embedder, scraper).createGraph();
  const hydeCache: HydeCache = new RedisCacheAdapter();
  const hydeGenerator = new HydeGenerator();
  const compiledHydeGraph = new HydeGraphFactory(
    database as unknown as HydeGraphDatabase,
    embedder,
    hydeCache,
    hydeGenerator
  ).createGraph();
  const opportunityGraph = new OpportunityGraphFactory(
    database,
    embedder,
    compiledHydeGraph
  ).createGraph();
  const indexGraph = new IndexGraphFactory(database).createGraph();
  const indexMembershipGraph = new IndexMembershipGraphFactory(database).createGraph();
  const intentIndexGraph = new IntentIndexGraphFactory(database).createGraph();

  // ─────────────────────────────────────────────────────────────────────────────
  // PROFILE TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

  const readUserProfiles = defineTool({
    name: "read_user_profiles",
    description:
      "Fetches user profiles. In an index-scoped chat, no args returns the current user's profile. With `userId`: returns that user's profile. With `indexId`: returns profiles of all members in that index. Outside an index-scoped chat, `userId` or `indexId` is required.",
    querySchema: z.object({
      userId: z.string().optional().describe("Optional user ID to fetch a specific user's profile"),
      indexId: z.string().optional().describe("Optional index ID to fetch profiles of all members in that index"),
    }),
    handler: async ({ context, query }) => {
      const effectiveIndexId = query.indexId?.trim() || undefined;
      const targetUserId = query.userId?.trim() || undefined;

      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }

      // Guard: when chat is NOT index-scoped and no userId/indexId provided, disallow
      if (!effectiveIndexId && !targetUserId && !context.indexId) {
        return error("Please provide a userId or indexId. Outside of an index-scoped chat, read_user_profiles requires at least one of these parameters. To read your own profile, pass your own userId.");
      }

      // --- Mode 3: indexId provided → fetch all member profiles ---
      if (effectiveIndexId) {
        const members = await database.getIndexMembersForMember(effectiveIndexId, context.userId);
        const profiles = await Promise.all(
          members.map(async (member) => {
            const profile = await database.getProfile(member.userId);
            return {
              userId: member.userId,
              name: member.name,
              hasProfile: !!profile,
              profile: profile
                ? {
                    name: profile.identity.name,
                    bio: profile.identity.bio,
                    location: profile.identity.location,
                    skills: profile.attributes.skills,
                    interests: profile.attributes.interests,
                  }
                : undefined,
            };
          })
        );
        return success({ indexId: effectiveIndexId, memberCount: members.length, profiles });
      }

      // --- Mode 2: userId provided (different user) → fetch single profile directly ---
      if (targetUserId && targetUserId !== context.userId) {
        const profile = await database.getProfile(targetUserId);
        if (profile) {
          return success({
            hasProfile: true,
            profile: {
              name: profile.identity.name,
              bio: profile.identity.bio,
              location: profile.identity.location,
              skills: profile.attributes.skills,
              interests: profile.attributes.interests,
            },
          });
        }
        return success({ hasProfile: false, message: "This user does not have a profile yet." });
      }

      // --- Mode 1: No args / self → use profileGraph query (returns id for updates) ---
      const result = await profileGraph.invoke({
        userId: context.userId,
        operationMode: 'query' as const,
      });

      if (result.readResult) {
        return success(result.readResult);
      }
      if (result.profile) {
        return success({
          hasProfile: true,
          profile: {
            name: result.profile.identity.name,
            bio: result.profile.identity.bio,
            location: result.profile.identity.location,
            skills: result.profile.attributes.skills,
            interests: result.profile.attributes.interests,
          },
        });
      }
      return success({
        hasProfile: false,
        message: "You don't have a profile yet. Would you like to create one? You can share your LinkedIn, GitHub, or X/Twitter profile, or just tell me about yourself.",
      });
    },
  });

  const createUserProfile = defineTool({
    name: "create_user_profile",
    description:
      "Auto-generates (or regenerates) a profile from the user's account data (name, email, social links) via web search. Works whether or not the user already has a profile. Call with no args first; if it returns missing fields, ask the user conversationally for their full name and/or social URLs, then call again with those fields filled in.",
    querySchema: z.object({
      name: z.string().optional().describe("User's full name (first and last), if provided by the user"),
      linkedinUrl: z.string().optional().describe("LinkedIn profile URL"),
      githubUrl: z.string().optional().describe("GitHub profile URL"),
      twitterUrl: z.string().optional().describe("X/Twitter profile URL"),
      websites: z.array(z.string()).optional().describe("Personal or portfolio website URLs"),
      location: z.string().optional().describe("User's location (city, country)"),
    }),
    handler: async ({ context, query }) => {
      // If any user-info fields are provided, persist them to the users table first
      const hasSocials = !!(query.linkedinUrl || query.githubUrl || query.twitterUrl || (query.websites && query.websites.length));
      if (query.name || query.location || hasSocials) {
        const socialsUpdate: { linkedin?: string; github?: string; x?: string; websites?: string[] } = {};
        if (query.linkedinUrl) socialsUpdate.linkedin = query.linkedinUrl;
        if (query.githubUrl) socialsUpdate.github = query.githubUrl;
        if (query.twitterUrl) socialsUpdate.x = query.twitterUrl;
        if (query.websites && query.websites.length) socialsUpdate.websites = query.websites;

        await database.updateUser(context.userId, {
          ...(query.name ? { name: query.name } : {}),
          ...(query.location ? { location: query.location } : {}),
          ...(hasSocials ? { socials: socialsUpdate } : {}),
        });
        logger.info("Updated user record before profile generation", { userId: context.userId });
      }

      // Invoke profile graph in generate mode (uses user table data + Parallels searchUser)
      const result = await profileGraph.invoke({
        userId: context.userId,
        operationMode: 'generate' as const,
        forceUpdate: true,
      });

      // If user info is insufficient, ask conversationally
      if (result.needsUserInfo) {
        return needsClarification({
          missingFields: result.missingUserInfo || ['social_urls', 'full_name'],
          message: "I need a bit more information to create your profile. Could you share your full name and any social links (LinkedIn, GitHub, or X/Twitter)?",
        });
      }

      if (result.error) {
        return error(result.error);
      }

      if (result.profile) {
        return success({
          created: true,
          message: "Profile generated from your account data.",
          profile: {
            name: result.profile.identity.name,
            bio: result.profile.identity.bio,
            location: result.profile.identity.location,
            skills: result.profile.attributes.skills,
            interests: result.profile.attributes.interests,
          },
        });
      }

      return error("Failed to create profile. Please try again.");
    },
  });

  const updateUserProfile = defineTool({
    name: "update_user_profile",
    description:
      "Updates the user's existing profile. Requires profileId from read_user_profiles. Use ONE call per request with all changes in action (and details if needed). For profile URLs call scrape_url first, then pass scraped content in details.",
    querySchema: z.object({
      profileId: z.string().describe("The profile id from read_user_profiles"),
      action: z.string().describe("What to do: one or more changes, e.g. 'update bio to X', 'add Python to skills'"),
      details: z.string().optional().describe("Additional context or pasted content"),
    }),
    handler: async ({ context, query }) => {
      if (!setPendingConfirmation || !getPendingConfirmation) {
        return error("Confirmation is not available in this context.");
      }

      // Use profileGraph query mode to validate profile existence
      const queryResult = await profileGraph.invoke({ userId: context.userId, operationMode: 'query' as const });
      if (!queryResult.readResult?.hasProfile && !queryResult.profile) {
        return error("You don't have a profile yet. Use create_user_profile first.");
      }
      const existingProfileId = queryResult.readResult?.profile?.id;
      if (existingProfileId && existingProfileId !== query.profileId.trim()) {
        return error("Invalid profileId. Use the profile id from read_user_profiles.");
      }

      const inputForProfile = [query.action, query.details].filter(Boolean).join("\n") || (query.details ?? query.action);
      if (!inputForProfile.trim()) {
        return error("Please specify what to update (e.g. action: 'update bio to X').");
      }

      const confirmationId = crypto.randomUUID();
      const summary = `Update your profile: ${query.action.slice(0, 80)}${query.action.length > 80 ? "…" : ""}`;
      const payload: ConfirmationPayload = {
        resource: "profile",
        action: "update",
        updates: { input: inputForProfile },
      };
      setPendingConfirmation({
        id: confirmationId,
        action: "update",
        resource: "profile",
        summary,
        payload,
        createdAt: Date.now(),
      });
      return needsConfirmation({ confirmationId, action: "update", resource: "profile", summary });
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INTENT TOOLS
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

      const result = await intentGraph.invoke({
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
      const profileResult = await profileGraph.invoke({ userId: context.userId, operationMode: 'query' as const });
      const profile = profileResult.profile || null;

      const effectiveIndexId = query.indexId?.trim() || context.indexId || undefined;
      // When index-scoped, fetch all user intents so the reconciler can detect
      // duplicates and modifications across all indexes (not just the current one).
      let activeIntentsPreFetched: Array<{ id: string; payload: string; summary: string | null; createdAt: Date }> | undefined;
      if (effectiveIndexId) {
        const allIntents = await database.getActiveIntents(context.userId);
        activeIntentsPreFetched = allIntents.map((i) => ({
          id: i.id,
          payload: i.payload,
          summary: i.summary ?? null,
          createdAt: i.createdAt,
        }));
      }
      const intentInput = {
        userId: context.userId,
        userProfile: profile ? JSON.stringify(profile) : "",
        inputContent,
        operationMode: 'create' as const,
        ...(effectiveIndexId ? { indexId: effectiveIndexId } : {}),
        ...(activeIntentsPreFetched !== undefined ? { activeIntentsPreFetched } : {}),
      };

      const result = await intentGraph.invoke(intentInput);
      logger.debug("Intent graph response", { result });

      if (result.requiredMessage) {
        return success({
          created: false,
          message: result.requiredMessage,
        });
      }

      // Process execution results
      const created = (result.executionResults || [])
        .filter((r: ExecutionResult): r is ExecutionResult & { intentId: string } => r.actionType === 'create' && r.success && !!r.intentId)
        .map((r) => ({
          id: r.intentId,
          description: (r.payload ?? query.description) ?? ''
        }));

      // Link created intents to indexes via intent_indexes (intents table has no indexId; association is many-to-many).
      const indexForAssignment = effectiveIndexId || context.indexId || undefined;
      if (created.length > 0) {
        let autoAssignIndexIds: string[] = [];
        if (!indexForAssignment) {
          const idxResult = await indexGraph.invoke({ userId: context.userId, operationMode: 'read' as const, showAll: true });
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
                await intentIndexGraph.invoke({
                  userId: context.userId,
                  indexId: idxId,
                  intentId: intent.id,
                  operationMode: 'create' as const,
                  skipEvaluation: forceAssignSingleIndex,
                });
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
        .map((r) => r.intentId);
      if (updated.length > 0 && indexForAssignment) {
        for (const intentId of updated) {
          try {
            await intentIndexGraph.invoke({
              userId: context.userId,
              indexId: indexForAssignment,
              intentId,
              operationMode: 'create' as const,
              skipEvaluation: true,
            });
          } catch (e) {
            logger.warn("Index assignment failed for updated intent", { intentId, indexId: indexForAssignment });
          }
        }
      }

      if (created.length > 0) {
        // Auto-trigger discovery
        let discoveryRan = false;
        let discoveryCount = 0;
        let discoveryError = false;
        let indexScope: string[] = [];
        const discoveryIndexId = effectiveIndexId || context.indexId || undefined;
        if (discoveryIndexId) {
          if (UUID_REGEX.test(discoveryIndexId)) {
            const memberResult = await indexMembershipGraph.invoke({
              userId: context.userId,
              indexId: discoveryIndexId,
              operationMode: 'read' as const,
            });
            if (!memberResult.error) indexScope = [discoveryIndexId];
          }
        } else {
          const indexResult = await indexGraph.invoke({
            userId: context.userId,
            operationMode: 'read' as const,
            showAll: true,
          });
          indexScope = (indexResult.readResult?.memberOf || []).map((m: { indexId: string }) => m.indexId);
        }
        if (indexScope.length > 0) {
          try {
            const intentQuery = created.map((c) => c.description).filter(Boolean).join(" ") || "";
            const discoveryResult = await runDiscoverFromQuery({
              opportunityGraph,
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
        const scopeResult = await intentIndexGraph.invoke({
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

      const readResult = await intentGraph.invoke({
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
              JSON.stringify(userIntents.map((i) => ({ id: i.id, payload: i.description, summary: i.summary })))
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
        const scopeResult = await intentIndexGraph.invoke({
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

      const readResult = await intentGraph.invoke({
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
              JSON.stringify(userIntents.map((i) => ({ id: i.id, payload: i.description, summary: i.summary })))
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
  // To show intent and index names/descriptions, use read_intents and read_indexes.
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

      const result = await intentIndexGraph.invoke({
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

      const result = await intentIndexGraph.invoke({
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

      const result = await intentIndexGraph.invoke({
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

  // ─────────────────────────────────────────────────────────────────────────────
  // INDEX TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

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

      const result = await indexGraph.invoke({
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

      const result = await indexMembershipGraph.invoke({
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

      if (!setPendingConfirmation || !getPendingConfirmation) {
        return error("Confirmation is not available in this context.");
      }

      const readResult = await indexGraph.invoke({
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

      const title = (owned.title ?? "this index").slice(0, 60);
      const confirmationId = crypto.randomUUID();
      const summary = `Update index "${title}" settings: ${Object.keys(settingsData).join(", ")}`;
      const payload: ConfirmationPayload = {
        resource: "index",
        action: "update",
        indexId: effectiveIndexId,
        updates: settingsData,
      };
      setPendingConfirmation({
        id: confirmationId,
        action: "update",
        resource: "index",
        summary,
        payload,
        createdAt: Date.now(),
      });
      return needsConfirmation({ confirmationId, action: "update", resource: "index", summary });
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

      const result = await indexGraph.invoke({
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

      if (!setPendingConfirmation || !getPendingConfirmation) {
        return error("Confirmation is not available in this context.");
      }

      const readResult = await indexGraph.invoke({
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
      const title = (owned.title ?? "this index").slice(0, 60);
      const confirmationId = crypto.randomUUID();
      const summary = `Delete index "${title}"`;
      const payload: ConfirmationPayload = { resource: "index", action: "delete", indexId };
      setPendingConfirmation({ id: confirmationId, action: "delete", resource: "index", summary, payload, createdAt: Date.now() });
      return needsConfirmation({ confirmationId, action: "delete", resource: "index", summary });
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

      const result = await indexMembershipGraph.invoke({
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

  // ─────────────────────────────────────────────────────────────────────────────
  // DISCOVERY TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

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
        const memberResult = await indexMembershipGraph.invoke({
          userId: context.userId,
          indexId: effectiveIndexId,
          operationMode: 'read' as const,
        });
        if (memberResult.error) {
          return error("Index not found or you are not a member. Use read_indexes to see your indexes.");
        }
        indexScope = [effectiveIndexId];
      } else {
        const indexResult = await indexGraph.invoke({
          userId: context.userId,
          operationMode: 'read' as const,
          showAll: true,
        });
        indexScope = (indexResult.readResult?.memberOf || []).map((m: { indexId: string }) => m.indexId);
      }

      const result = await runDiscoverFromQuery({
        opportunityGraph,
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

      const result = await opportunityGraph.invoke({
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
      const result = await opportunityGraph.invoke({
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

  // ─────────────────────────────────────────────────────────────────────────────
  // UTILITY TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

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
  // CONFIRMATION TOOLS (Phase 4a)
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
        const profileResult = await profileGraph.invoke({ userId: context.userId, operationMode: 'query' as const });
        const userProfile = profileResult.profile ? JSON.stringify(profileResult.profile) : "";
        const result = await intentGraph.invoke({
          userId: context.userId,
          userProfile,
          operationMode: 'update' as const,
          inputContent: payload.newDescription,
          targetIntentIds: [payload.intentId],
        });
        if (result.executionResults?.some((r: ExecutionResult) => !r.success)) {
          return error("Failed to update intent through graph.");
        }
      } else if (payload.resource === "intent" && payload.action === "delete") {
        const profileResult = await profileGraph.invoke({ userId: context.userId, operationMode: 'query' as const });
        const userProfile = profileResult.profile ? JSON.stringify(profileResult.profile) : "";
        const result = await intentGraph.invoke({
          userId: context.userId,
          userProfile,
          operationMode: 'delete' as const,
          targetIntentIds: [payload.intentId],
        });
        if (result.executionResults?.some((r: ExecutionResult) => !r.success)) {
          return error("Failed to delete intent through graph.");
        }
      } else if (payload.resource === "profile" && payload.action === "update") {
        const profileInput = (payload.updates as { input?: string }).input ?? JSON.stringify(payload.updates);
        await profileGraph.invoke({
          userId: context.userId,
          operationMode: "write",
          input: profileInput,
          forceUpdate: true,
        });
      } else if (payload.resource === "profile" && payload.action === "delete") {
        await database.deleteProfile(context.userId);
      } else if (payload.resource === "index" && payload.action === "update") {
        const result = await indexGraph.invoke({
          userId: context.userId,
          indexId: payload.indexId,
          operationMode: 'update' as const,
          updateInput: payload.updates as { title?: string; prompt?: string | null; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean },
        });
        if (result.mutationResult && !result.mutationResult.success) {
          return error(result.mutationResult.error || "Failed to update index.");
        }
      } else if (payload.resource === "index" && payload.action === "delete") {
        const result = await indexGraph.invoke({
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
        const result = await opportunityGraph.invoke({
          userId: context.userId,
          operationMode: 'update' as const,
          opportunityId: payload.opportunityId,
          newStatus: status,
        });
        if (result.mutationResult && !result.mutationResult.success) {
          return error(result.mutationResult.error || "Failed to update opportunity.");
        }
      } else if (payload.resource === "opportunity" && payload.action === "delete") {
        const result = await opportunityGraph.invoke({
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

  // ─────────────────────────────────────────────────────────────────────────────
  // RETURN ALL TOOLS
  // ─────────────────────────────────────────────────────────────────────────────

  return [
    // Tools
    sendOpportunity,
    scrapeUrl,
    // Confirmation Tools
    confirmAction,
    cancelAction,
    // CRUDS
    readUserProfiles,
    createUserProfile,
    updateUserProfile,
    readIntents,
    createIntent,
    updateIntent,
    deleteIntent,
    createIntentIndex,
    readIntentIndexes,
    deleteIntentIndex,
    readIndexes,
    createIndex,
    updateIndex,
    deleteIndex,
    createIndexMembership,
    readUsers,
    createOpportunities,
    listOpportunities,
  ];
}

/**
 * Type for the tools array returned by createChatTools.
 */
export type ChatTools = Awaited<ReturnType<typeof createChatTools>>;
