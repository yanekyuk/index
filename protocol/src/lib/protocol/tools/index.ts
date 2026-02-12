import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { HydeGraphDatabase } from "../interfaces/database.interface";
import type { HydeCache } from "../interfaces/cache.interface";
import { IntentGraphFactory } from "../graphs/intent.graph";
import { ProfileGraphFactory } from "../graphs/profile.graph";
import { OpportunityGraphFactory } from "../graphs/opportunity.graph";
import { HydeGraphFactory } from "../graphs/hyde.graph";
import { HydeGenerator } from "../agents/hyde.generator";
import { IndexGraphFactory } from "../graphs/index.graph";
import { IndexMembershipGraphFactory } from "../graphs/index_membership.graph";
import { IntentIndexGraphFactory } from "../graphs/intent_index.graph";
import { RedisCacheAdapter } from "../../../adapters/cache.adapter";
import { protocolLogger } from "../support/protocol.logger";

import type { ToolContext, ResolvedToolContext, ToolDeps } from "./tool.helpers";
import { error } from "./tool.helpers";
import { createProfileTools } from "./profile.tools";
import { createIntentTools } from "./intent.tools";
import { createIndexTools } from "./index.tools";
import { createOpportunityTools } from "./opportunity.tools";
import { createUtilityTools } from "./utility.tools";

// Re-export types for consumers
export type { ToolContext, ResolvedToolContext } from "./tool.helpers";
export type { ToolDeps } from "./tool.helpers";

const logger = protocolLogger("ChatTools");

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates all chat tools bound to a specific user context.
 * Resolves user/index identity from DB at init time.
 * Tools are created fresh for each user session to ensure proper isolation.
 */
export async function createChatTools(deps: ToolContext) {
  const { database, embedder, scraper } = deps;

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
          const reason = err instanceof Error ? err.message : String(err);
          return error(`Failed to execute ${opts.name}: ${reason}`);
        }
      },
      { name: opts.name, description: opts.description, schema: opts.querySchema }
    );
  }

  // ─── Compile subgraphs ─────────────────────────────────────────────────────
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

  // ─── Assemble dependencies ─────────────────────────────────────────────────
  const toolDeps: ToolDeps = {
    database,
    scraper,
    embedder,
    graphs: {
      profile: profileGraph,
      intent: intentGraph,
      index: indexGraph,
      indexMembership: indexMembershipGraph,
      intentIndex: intentIndexGraph,
      opportunity: opportunityGraph,
    },
  };

  // ─── Create domain tools ──────────────────────────────────────────────────
  const profileTools = createProfileTools(defineTool, toolDeps);
  const intentTools = createIntentTools(defineTool, toolDeps);
  const indexTools = createIndexTools(defineTool, toolDeps);
  const opportunityTools = createOpportunityTools(defineTool, toolDeps);
  const utilityTools = createUtilityTools(defineTool, toolDeps);

  return [
    ...profileTools,
    ...intentTools,
    ...indexTools,
    ...opportunityTools,
    ...utilityTools,
  ];
}

/**
 * Type for the tools array returned by createChatTools.
 */
export type ChatTools = Awaited<ReturnType<typeof createChatTools>>;
