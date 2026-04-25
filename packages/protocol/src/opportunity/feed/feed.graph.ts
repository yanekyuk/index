/**
 * Home Graph: Build the opportunity home view with dynamic sections.
 *
 * Independent of ChatGraph. Flow:
 * loadOpportunities → generateCardText (cache-aside presenter) → checkCategorizerCache
 * → [categorizeDynamically if miss] → cacheCategorizerResults → normalizeAndSort
 *
 * Uses OpportunityPresenter for card text and an LLM to categorize cards into dynamic sections
 * with titles and Lucide icon names. Caches presenter and categorizer results via OpportunityCache.
 */

import { createHash } from 'crypto';

import { StateGraph, START, END } from '@langchain/langgraph';

import type {
  ChatGraphCompositeDatabase,
  HomeGraphDatabase,
  OpportunityStatus,
} from '../../shared/interfaces/database.interface.js';
import type { OpportunityCache } from '../../shared/interfaces/cache.interface.js';
import {
  HomeGraphState,
  type HomeCardItem,
  type HomeSection,
  type HomeSectionProposal,
  type HomeSectionItem,
} from './feed.state.js';
import { OpportunityPresenter } from '../opportunity.presenter.js';
import { getOrCreateHomeCardItemBatch } from '../opportunity.card-cache.js';
import { HomeCategorizerAgent } from './feed.categorizer.js';
import { canUserSeeOpportunity, isActionableForViewer, selectByComposition } from '../opportunity.utils.js';
import { resolveHomeSectionIcon, DEFAULT_HOME_SECTION_ICON } from '../../shared/ui/lucide.icon-catalog.js';
import type { DebugMetaAgent } from '../../chat/chat-streaming.types.js';
import { protocolLogger } from '../../shared/observability/protocol.logger.js';
import { timed } from '../../shared/observability/performance.js';
import { requestContext } from "../../shared/observability/request-context.js";

const logger = protocolLogger('HomeGraph');

/** Database must satisfy both HomeGraphDatabase and presenter context (getProfile, getActiveIntents, getNetwork, getUser). */
type HomeGraphDb = HomeGraphDatabase;

export type HomeGraphInvokeInput = {
  userId: string;
  networkId?: string;
  limit?: number;
  noCache?: boolean;
  /** When set, filter loaded opportunities to these lifecycle statuses. Defaults to `DEFAULT_HOME_STATUSES`. */
  statuses?: OpportunityStatus[];
};

export type HomeGraphInvokeResult = {
  sections: HomeSection[];
  meta: { totalOpportunities: number; totalSections: number };
  error?: string;
};

/** Default home-feed statuses: the lifecycle stages a viewer can act on today. */
export const DEFAULT_HOME_STATUSES: OpportunityStatus[] = ['latent', 'pending'];

// Exhaustive registry — keys must cover every OpportunityStatus union member.
// Adding a new status to OpportunityStatus without adding a key here is a TS error,
// which is the whole point: prevents ALL_OPPORTUNITY_STATUSES from silently drifting.
const OPPORTUNITY_STATUS_REGISTRY: Record<OpportunityStatus, true> = {
  latent: true,
  draft: true,
  negotiating: true,
  pending: true,
  stalled: true,
  accepted: true,
  rejected: true,
  expired: true,
};

/** Full status enumeration. Pass this to `HomeGraphInvokeInput.statuses` to restore pre-Issue-3 (unfiltered) behavior. */
export const ALL_OPPORTUNITY_STATUSES: OpportunityStatus[] = Object.keys(
  OPPORTUNITY_STATUS_REGISTRY,
) as OpportunityStatus[];

const MAX_ITEMS_PER_SECTION = 20;
const HOME_CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds

/** @deprecated Import from `../opportunity.card-cache.js` instead. Re-exported for existing tests. */
export { stripLeadingNarratorName } from '../opportunity.card-cache.js';

/** Normalize timestamp for sorting; returns numeric ms or 0 for invalid/missing. */
const safeParseDate = (value: unknown): number => {
  if (value == null) return 0;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
};

/** Confidence score for sorting (interpretation.confidence or opportunity.confidence). */
const getConfidence = (opp: typeof HomeGraphState.State['opportunities'][number]): number => {
  const fromInterp = opp.interpretation?.confidence;
  if (typeof fromInterp === 'number' && !Number.isNaN(fromInterp)) return fromInterp;
  if (typeof fromInterp === 'string') {
    const n = parseFloat(fromInterp);
    if (!Number.isNaN(n)) return n;
  }
  const fromRow = opp.confidence;
  if (typeof fromRow === 'number' && !Number.isNaN(fromRow)) return fromRow;
  if (typeof fromRow === 'string') {
    const n = parseFloat(fromRow);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
};

/** Unique non-introducer, non-viewer userIds for an opportunity (actors can repeat). */
const getUniqueCounterpartUserIds = (
  opp: typeof HomeGraphState.State['opportunities'][number],
  viewerId: string
): Set<string> => {
  const ids = new Set<string>();
  for (const a of opp.actors) {
    if (a.role !== 'introducer' && a.userId !== viewerId && a.userId) {
      ids.add(a.userId);
    }
  }
  return ids;
};

export class HomeGraphFactory {
  constructor(private database: HomeGraphDb, private cache: OpportunityCache) {}

  createGraph() {
    const presenter = new OpportunityPresenter();
    const categorizer = new HomeCategorizerAgent();

    const loadOpportunitiesNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.loadOpportunities", async () => {
        if (!state.userId) {
          return { error: 'userId is required' };
        }
        try {
          // Minimum of 50 ensures enough candidates across all feed categories
          // (connection, connector-flow, expired) for selectByComposition to fill
          // its soft targets, even after visibility filtering and dedup.
          const fetchLimit = Math.min(150, Math.max(50, state.limit * 3));
          const statuses = state.statuses ?? DEFAULT_HOME_STATUSES;
          const options: { limit?: number; networkId?: string; statuses?: OpportunityStatus[] } = {
            limit: fetchLimit,
            statuses,
          };
          if (state.networkId) options.networkId = state.networkId;
          // Do not pass conversationId: home view excludes draft opportunities (chat-only drafts).
          const raw = await this.database.getOpportunitiesForUser(state.userId, options);
          const visible = raw.filter((opp) =>
            canUserSeeOpportunity(opp.actors, opp.status, state.userId)
          );
          const visibleForFeed = visible.filter((opp) =>
            isActionableForViewer(opp.actors, opp.status, state.userId)
          );
          const sorted = [...visibleForFeed].sort((a, b) => {
            // Connections before connector-flow so dedup claims counterpart IDs
            // for direct connections first — prevents introducer cards from
            // shadowing a user's own connection opportunities.
            const aIsIntroducer = a.actors.some((ac) => ac.userId === state.userId && ac.role === 'introducer');
            const bIsIntroducer = b.actors.some((ac) => ac.userId === state.userId && ac.role === 'introducer');
            if (aIsIntroducer !== bIsIntroducer) return aIsIntroducer ? 1 : -1;
            const confA = getConfidence(a);
            const confB = getConfidence(b);
            if (confB !== confA) return confB - confA;
            const aTime = safeParseDate(a.updatedAt);
            const bTime = safeParseDate(b.updatedAt);
            return bTime - aTime;
          });
          const seenUserIds = new Set<string>();
          const deduped = sorted.filter((opp) => {
            const counterpartIds = getUniqueCounterpartUserIds(opp, state.userId);
            const hasOverlap = [...counterpartIds].some((id) => seenUserIds.has(id));
            if (hasOverlap) return false;
            for (const id of counterpartIds) seenUserIds.add(id);
            return true;
          });
          const opportunities = selectByComposition(deduped, state.userId);
          return { opportunities };
        } catch (e) {
          logger.error('HomeGraph loadOpportunities failed', { error: e });
          return { error: 'Failed to load opportunities', opportunities: [] };
        }
      });
    };

    const generateCardTextNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.generateCardText", async () => {
        const { opportunities, userId, noCache } = state;
        logger.verbose('[HomeGraph:generateCardText] entry', {
          opportunitiesLength: opportunities.length,
          userId,
        });
        if (opportunities.length === 0) {
          logger.verbose('[HomeGraph:generateCardText] exit', { totalOpportunities: 0, totalSections: 0 });
          return { cards: [], agentTimings: [], meta: { totalOpportunities: 0, totalSections: 0 } };
        }
        const compositeDb = this.database as unknown as ChatGraphCompositeDatabase;
        const { cards, agentTimings: batchTimings } = await getOrCreateHomeCardItemBatch({
          presenter,
          database: compositeDb,
          cache: this.cache,
          opportunities,
          viewerUserId: userId,
          noCache,
        });
        const prior = state.agentTimings ?? [];
        logger.verbose('[HomeGraph:generateCardText] exit', {
          totalOpportunities: opportunities.length,
          totalSections: 0,
        });
        return {
          cards,
          agentTimings: [...prior, ...batchTimings],
          meta: { totalOpportunities: opportunities.length, totalSections: 0 },
        };
      });
    };

    const checkCategorizerCacheNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.checkCategorizerCache", async () => {
        if (state.cards.length === 0) {
          return { categoryCacheHit: false };
        }

        if (state.noCache) {
          logger.verbose('[HomeGraph:checkCategorizerCache] noCache=true, skipping cache');
          return { categoryCacheHit: false };
        }

        try {
          const oppIds = state.cards
            .map((c) => c.opportunityId)
            .join(',');
          const hash = createHash('sha256').update(oppIds).digest('hex').slice(0, 16);
          const key = `home:categories:${state.userId}:${hash}`;

          const cached = await this.cache.get<HomeSectionProposal[]>(key);
          if (cached) {
            logger.verbose('[HomeGraph:checkCategorizerCache] cache hit');
            return { sectionProposals: cached, categoryCacheHit: true };
          }

          logger.verbose('[HomeGraph:checkCategorizerCache] cache miss');
        } catch (e) {
          logger.warn('[HomeGraph:checkCategorizerCache] cache unavailable, skipping', { error: e });
        }
        return { categoryCacheHit: false };
      });
    };

    const shouldCategorize = (state: typeof HomeGraphState.State): string => {
      if (state.categoryCacheHit) {
        logger.verbose('[HomeGraph] Categorizer results cached, skipping');
        return 'skip';
      }
      return 'categorize';
    };

    const categorizeDynamicallyNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.categorizeDynamically", async () => {
        logger.verbose('[HomeGraph:categorizeDynamically] entry', { cardsLength: state.cards.length });
        if (state.cards.length === 0) {
          logger.verbose('[HomeGraph:categorizeDynamically] exit', { sectionProposalsCount: 0 });
          return { sectionProposals: [], agentTimings: [] };
        }
        const agentTimingsAccum: DebugMetaAgent[] = [];
        const categorizerInput = state.cards.map((c) => ({
          index: c._cardIndex,
          headline: c.headline,
          mainText: c.mainText,
          name: c.name,
          viewerRole: c.viewerRole === 'introducer' ? 'introducer' : undefined,
          opportunityStatus: c.viewerRole === 'introducer' ? 'pending' : undefined,
        }));
        const _traceEmitterCategorizer = requestContext.getStore()?.traceEmitter;
        const categorizerStart = Date.now();
        _traceEmitterCategorizer?.({ type: "agent_start", name: "home-categorizer" });
        const { sections } = await categorizer.categorize(categorizerInput);
        const _categorizerDuration = Date.now() - categorizerStart;
        agentTimingsAccum.push({ name: 'home.categorizer', durationMs: _categorizerDuration });
        _traceEmitterCategorizer?.({ type: "agent_end", name: "home-categorizer", durationMs: _categorizerDuration, summary: `Categorized into ${sections.length} section(s)` });
        const proposals: HomeSectionProposal[] = sections.map((s) => ({
          ...s,
          itemIndices: s.itemIndices.filter((i) => i >= 0 && i < state.cards.length),
        }));
        logger.verbose('[HomeGraph:categorizeDynamically] exit', { sectionProposalsCount: proposals.length });
        return { sectionProposals: proposals, agentTimings: agentTimingsAccum };
      });
    };

    const cacheCategorizerResultsNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.cacheCategorizerResults", async () => {
        if (state.categoryCacheHit || state.sectionProposals.length === 0) {
          return {};
        }

        try {
          const oppIds = state.cards
            .map((c) => c.opportunityId)
            .join(',');
          const hash = createHash('sha256').update(oppIds).digest('hex').slice(0, 16);
          const key = `home:categories:${state.userId}:${hash}`;

          await this.cache.set(key, state.sectionProposals, { ttl: HOME_CACHE_TTL });

          logger.verbose('[HomeGraph:cacheCategorizerResults] cached', {
            sectionCount: state.sectionProposals.length,
          });
        } catch (e) {
          logger.warn('[HomeGraph:cacheCategorizerResults] cache write failed, continuing', { error: e });
        }

        return {};
      });
    };

    const normalizeAndSortNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.normalizeAndSort", async () => {
        const cards = state.cards;
        const proposals = state.sectionProposals;
        logger.verbose('[HomeGraph:normalizeAndSort] entry', { cardsLength: cards.length, proposalsLength: proposals.length });
        if (cards.length === 0) {
          logger.verbose('[HomeGraph:normalizeAndSort] exit', { totalOpportunities: 0, totalSections: 0 });
          return { sections: [], meta: { totalOpportunities: 0, totalSections: 0 } };
        }
        const usedIndices = new Set<number>();
        const sections: HomeSection[] = proposals.map((p) => {
          const iconName = resolveHomeSectionIcon(p.iconName);
          const items: HomeSectionItem[] = p.itemIndices
            .filter((i) => i >= 0 && i < cards.length && !usedIndices.has(i))
            .slice(0, MAX_ITEMS_PER_SECTION)
            .map((i) => {
              usedIndices.add(i);
              const card = cards[i];
              const { _cardIndex, ...rest } = card;
              return rest;
            });
          return {
            id: p.id,
            title: p.title,
            subtitle: p.subtitle,
            iconName,
            items,
          };
        });

        // Enforce category ordering: sections with connections first, then
        // connector-flow only, then expired only. This prevents the LLM
        // categorizer from placing introducer sections before connection sections.
        const sectionCategoryPriority = (section: HomeSection): number => {
          const hasConnection = section.items.some((item) => item.viewerRole !== 'introducer');
          if (hasConnection) return 0; // mixed or connection-only sections first
          const hasConnectorFlow = section.items.some((item) => item.viewerRole === 'introducer');
          if (hasConnectorFlow) return 1; // connector-flow only sections next
          return 2; // empty or expired sections last
        };
        sections.sort((a, b) => sectionCategoryPriority(a) - sectionCategoryPriority(b));
        const meta = {
          totalOpportunities: state.opportunities.length,
          totalSections: sections.length,
        };
        logger.verbose('[HomeGraph:normalizeAndSort] exit', { totalOpportunities: meta.totalOpportunities, totalSections: meta.totalSections });
        return { sections, meta };
      });
    };

    const graph = new StateGraph(HomeGraphState)
      .addNode('loadOpportunities', loadOpportunitiesNode)
      .addNode('generateCardText', generateCardTextNode)
      .addNode('checkCategorizerCache', checkCategorizerCacheNode)
      .addNode('categorizeDynamically', categorizeDynamicallyNode)
      .addNode('cacheCategorizerResults', cacheCategorizerResultsNode)
      .addNode('normalizeAndSort', normalizeAndSortNode)
      .addEdge(START, 'loadOpportunities')
      .addEdge('loadOpportunities', 'generateCardText')
      .addEdge('generateCardText', 'checkCategorizerCache')
      .addConditionalEdges('checkCategorizerCache', shouldCategorize, {
        categorize: 'categorizeDynamically',
        skip: 'normalizeAndSort',
      })
      .addEdge('categorizeDynamically', 'cacheCategorizerResults')
      .addEdge('cacheCategorizerResults', 'normalizeAndSort')
      .addEdge('normalizeAndSort', END);

    return graph.compile();
  }
}
