/**
 * Home Graph: Build the opportunity home view with dynamic sections.
 *
 * Independent of ChatGraph. Flow:
 * loadOpportunities → generateCardText → categorizeDynamically → normalizeAndSort → finalizeResponse
 *
 * Uses OpportunityPresenter for card text and an LLM to categorize cards into dynamic sections
 * with titles and Lucide icon names.
 */

import { StateGraph, START, END } from '@langchain/langgraph';

import type { HomeGraphDatabase } from '../interfaces/database.interface';
import {
  HomeGraphState,
  type HomeCardItem,
  type HomeSection,
  type HomeSectionProposal,
  type HomeSectionItem,
} from '../states/home.state';
import { OpportunityPresenter, gatherPresenterContext } from '../agents/opportunity.presenter';
import { HomeCategorizerAgent } from '../agents/home.categorizer';
import { canUserSeeOpportunity } from '../support/opportunity.utils';
import { resolveHomeSectionIcon, DEFAULT_HOME_SECTION_ICON } from '../support/lucide.icon-catalog';
import { protocolLogger } from '../support/protocol.logger';

const logger = protocolLogger('HomeGraph');

/** Database must satisfy both HomeGraphDatabase and presenter context (getProfile, getActiveIntents, getIndex, getUser). */
type HomeGraphDb = HomeGraphDatabase;

export type HomeGraphInvokeInput = {
  userId: string;
  indexId?: string;
  limit?: number;
};

export type HomeGraphInvokeResult = {
  sections: HomeSection[];
  meta: { totalOpportunities: number; totalSections: number };
  error?: string;
};

const MAX_ITEMS_PER_SECTION = 20;
const PRESENTATION_CONCURRENCY = 5;
const MAX_REASONING_SNIPPET_LENGTH = 240;

const toIntentArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toIntentKey = (intent: unknown): string | null => {
  if (typeof intent === 'string' || typeof intent === 'number') {
    return String(intent);
  }
  if (!intent || typeof intent !== 'object') {
    return null;
  }

  const record = intent as Record<string, unknown>;
  const candidate =
    record.intentId ?? record.id ?? record.payload ?? record.summary ?? record.title ?? record.name;

  if (typeof candidate === 'string' || typeof candidate === 'number') {
    return String(candidate);
  }
  return null;
};

const computeMutualIntentCount = (ctx: Record<string, unknown>): number => {
  const actorIntents = toIntentArray(ctx.intents ?? ctx.viewerIntents ?? ctx.actorIntents);
  const partnerIntents = toIntentArray(ctx.otherIntents ?? ctx.partnerIntents ?? ctx.otherPartyIntents);

  const actorIntentSet = new Set(
    actorIntents.map((intent) => toIntentKey(intent)).filter((key): key is string => key !== null)
  );
  const partnerIntentSet = new Set(
    partnerIntents.map((intent) => toIntentKey(intent)).filter((key): key is string => key !== null)
  );

  let overlap = 0;
  for (const key of actorIntentSet) {
    if (partnerIntentSet.has(key)) {
      overlap += 1;
    }
  }

  return overlap;
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

const pickDisplayCounterpartActor = (
  opportunity: typeof HomeGraphState.State['opportunities'][number],
  viewerId: string
): { userId: string; role: string } | null => {
  const candidates = opportunity.actors.filter(
    (actor) => actor.userId !== viewerId && actor.role !== 'introducer'
  );
  if (candidates.length === 0) {
    return null;
  }

  // Prefer direct counterpart roles when available, then stable sort by user id.
  const rolePriority = new Map<string, number>([
    ['patient', 0],
    ['party', 1],
    ['agent', 2],
    ['peer', 3],
  ]);

  const sorted = [...candidates].sort((a, b) => {
    const aPriority = rolePriority.get(a.role) ?? 99;
    const bPriority = rolePriority.get(b.role) ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.userId.localeCompare(b.userId);
  });
  return sorted[0] ?? null;
};

export class HomeGraphFactory {
  constructor(private database: HomeGraphDb) {}

  createGraph() {
    const presenter = new OpportunityPresenter();
    const categorizer = new HomeCategorizerAgent();

    const loadOpportunitiesNode = async (state: typeof HomeGraphState.State) => {
      if (!state.userId) {
        return { error: 'userId is required' };
      }
      try {
        const fetchLimit = Math.min(150, Math.max(state.limit * 3, state.limit));
        const options: { limit?: number; indexId?: string } = {
          limit: fetchLimit,
        };
        if (state.indexId) options.indexId = state.indexId;
        const raw = await this.database.getOpportunitiesForUser(state.userId, options);
        const visible = raw.filter((opp) => {
          const isPendingIntroducerForViewer =
            opp.status === 'pending' &&
            opp.actors.some((actor) => actor.userId === state.userId && actor.role === 'introducer');
          return isPendingIntroducerForViewer || canUserSeeOpportunity(opp.actors, opp.status, state.userId);
        });
        const visibleForFeed = visible.filter((opp) => opp.status !== 'expired');
        // #region agent log
        const rawByStatus: Record<string, number> = {};
        const visibleByStatus: Record<string, number> = {};
        const feedByStatus: Record<string, number> = {};
        for (const opp of raw) {
          rawByStatus[opp.status] = (rawByStatus[opp.status] ?? 0) + 1;
        }
        for (const opp of visible) {
          visibleByStatus[opp.status] = (visibleByStatus[opp.status] ?? 0) + 1;
        }
        for (const opp of visibleForFeed) {
          feedByStatus[opp.status] = (feedByStatus[opp.status] ?? 0) + 1;
        }
        fetch('http://127.0.0.1:7242/ingest/9e8c82c7-69e7-439d-9a66-0d60a0032c44', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'home.graph.ts:loadOpportunitiesNode:afterVisible', message: 'home loadOpportunities status breakdown', data: { userId: state.userId, rawCount: raw.length, rawByStatus, visibleCount: visible.length, visibleByStatus, feedCount: visibleForFeed.length, feedByStatus, expiredInFeed: (feedByStatus.expired ?? 0) > 0 }, timestamp: Date.now() }) }).catch(() => {});
        // #endregion
        const expired = raw.filter(
          (opp) =>
            opp.status === 'expired' && canUserSeeOpportunity(opp.actors, opp.status, state.userId)
        );
        const sorted = [...visibleForFeed].sort((a, b) => {
          const confA = getConfidence(a);
          const confB = getConfidence(b);
          if (confB !== confA) return confB - confA;
          const aTime = a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt).getTime();
          const bTime = b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt).getTime();
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
        const opportunities = deduped.slice(0, state.limit);
        return { opportunities, expired };
      } catch (e) {
        logger.error('HomeGraph loadOpportunities failed', { error: e });
        return { error: 'Failed to load opportunities', opportunities: [], expired: [] };
      }
    };

    const generateCardTextNode = async (state: typeof HomeGraphState.State) => {
      if (state.opportunities.length === 0) {
        return { cards: [], meta: { totalOpportunities: 0, totalSections: 0 } };
      }
      const db = this.database as Parameters<typeof gatherPresenterContext>[0];
      const cards: HomeCardItem[] = [];
      const relevantActorIds = new Set<string>();
      for (const opp of state.opportunities) {
        for (const a of opp.actors) {
          if (a.userId) relevantActorIds.add(a.userId);
        }
      }

      const userEntries = await Promise.all(
        Array.from(relevantActorIds).map(async (userId) => {
          try {
            const user = await this.database.getUser(userId);
            return [userId, user ?? null] as const;
          } catch {
            return [userId, null] as const;
          }
        })
      );
      const userMap = new Map(userEntries);

      const opportunities = state.opportunities;
      for (let i = 0; i < opportunities.length; i += PRESENTATION_CONCURRENCY) {
        const chunk = opportunities.slice(i, i + PRESENTATION_CONCURRENCY);
        const chunkCards = await Promise.all(
          chunk.map(async (opportunity, offset) => {
            const cardIndex = i + offset;
            const viewerActor = opportunity.actors.find((a) => a.userId === state.userId);
            const viewerRole = viewerActor?.role ?? 'party';
            const isPendingIntroducer =
              viewerRole === 'introducer' && opportunity.status === 'pending';
            const preferredActor = pickDisplayCounterpartActor(opportunity, state.userId)
              ?? opportunity.actors.find((a) => a.userId !== state.userId && a.role !== 'introducer');
            const actorWithProfile = opportunity.actors.find(
              (a) => a.userId !== state.userId && a.role !== 'introducer' && !!userMap.get(a.userId)
            );
            const otherActor = (preferredActor && userMap.get(preferredActor.userId))
              ? preferredActor
              : (actorWithProfile ?? preferredActor);
            const introducer = opportunity.actors.find((a) => a.role === 'introducer');
            const otherUser = otherActor ? userMap.get(otherActor.userId) ?? null : null;
            const introducerCounterparts = opportunity.actors.filter(
              (a) => a.userId !== state.userId && a.role !== 'introducer'
            );
            const participantNames = introducerCounterparts
              .map((actor) => userMap.get(actor.userId)?.name ?? 'Unknown')
              .sort();
            const userName = isPendingIntroducer && participantNames.length > 0
              ? participantNames.join(' ↔ ')
              : (otherUser?.name ?? 'Unknown');
            const userAvatar = otherUser?.avatar ?? null;
            const reasoningSnippet =
              (typeof opportunity.interpretation?.reasoning === 'string'
                ? opportunity.interpretation.reasoning.replace(/\s+/g, ' ').trim().slice(0, MAX_REASONING_SNIPPET_LENGTH)
                : '') || 'A connection opportunity.';

            const fallbackCard = (): HomeCardItem => ({
              opportunityId: opportunity.id,
              userId: otherActor?.userId ?? '',
              name: userName,
              avatar: userAvatar,
              mainText: reasoningSnippet.slice(0, 300),
              cta: isPendingIntroducer
                ? 'Decide whether to introduce these members.'
                : 'View opportunity and decide whether to reach out.',
              primaryActionLabel: isPendingIntroducer ? 'Good match' : 'Start Chat',
              secondaryActionLabel: isPendingIntroducer ? 'Pass' : 'Skip',
              mutualIntentsLabel: isPendingIntroducer ? 'Connector opportunity' : 'Shared interests',
              narratorChip: { name: 'Index', text: 'Worth a look.' },
              _cardIndex: cardIndex,
            });

            try {
              const ctx = await gatherPresenterContext(db, opportunity, state.userId);
              const mutualIntentCount = computeMutualIntentCount(ctx as unknown as Record<string, unknown>);
              const homeInput = {
                ...ctx,
                mutualIntentCount,
                opportunityStatus: opportunity.status,
              };
              const presentation = await presenter.presentHomeCard(homeInput);
              let narratorChip: { name: string; text: string; avatar?: string | null } | undefined;
              if (introducer && introducer.userId !== state.userId) {
                const introUser = userMap.get(introducer.userId) ?? null;
                narratorChip = {
                  name: introUser?.name ?? 'Someone',
                  text: presentation.narratorRemark,
                  avatar: introUser?.avatar ?? null,
                };
              } else {
                narratorChip = { name: 'Index', text: presentation.narratorRemark };
              }
              return {
                opportunityId: opportunity.id,
                userId: otherActor?.userId ?? '',
                name: userName,
                avatar: userAvatar,
                mainText: presentation.personalizedSummary,
                cta: presentation.suggestedAction,
                headline: presentation.headline,
                primaryActionLabel: presentation.primaryActionLabel,
                secondaryActionLabel: presentation.secondaryActionLabel,
                mutualIntentsLabel: presentation.mutualIntentsLabel,
                narratorChip,
                _cardIndex: cardIndex,
              } satisfies HomeCardItem;
            } catch (e) {
              logger.warn('HomeGraph presenter failed for opportunity', { opportunityId: opportunity.id, error: e });
              return fallbackCard();
            }
          })
        );
        cards.push(...chunkCards);
      }
      return {
        cards,
        meta: { totalOpportunities: state.opportunities.length, totalSections: 0 },
      };
    };

    const categorizeDynamicallyNode = async (state: typeof HomeGraphState.State) => {
      if (state.cards.length === 0) {
        return { sectionProposals: [] };
      }
      const categorizerInput = state.cards.map((c) => ({
        index: c._cardIndex,
        headline: c.headline,
        mainText: c.mainText,
        name: c.name,
        viewerRole:
          c.primaryActionLabel === 'Good match' && c.secondaryActionLabel === 'Pass'
            ? 'introducer'
            : undefined,
        opportunityStatus:
          c.primaryActionLabel === 'Good match' && c.secondaryActionLabel === 'Pass'
            ? 'pending'
            : undefined,
      }));
      const { sections } = await categorizer.categorize(categorizerInput);
      const proposals: HomeSectionProposal[] = sections.map((s) => ({
        ...s,
        itemIndices: s.itemIndices.filter((i) => i >= 0 && i < state.cards.length),
      }));
      return { sectionProposals: proposals };
    };

    const normalizeAndSortNode = async (state: typeof HomeGraphState.State) => {
      const cards = state.cards;
      const proposals = state.sectionProposals;
      if (cards.length === 0) {
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
      const meta = {
        totalOpportunities: state.opportunities.length,
        totalSections: sections.length,
      };
      return { sections, meta };
    };

    const graph = new StateGraph(HomeGraphState)
      .addNode('loadOpportunities', loadOpportunitiesNode)
      .addNode('generateCardText', generateCardTextNode)
      .addNode('categorizeDynamically', categorizeDynamicallyNode)
      .addNode('normalizeAndSort', normalizeAndSortNode)
      .addEdge(START, 'loadOpportunities')
      .addEdge('loadOpportunities', 'generateCardText')
      .addEdge('generateCardText', 'categorizeDynamically')
      .addEdge('categorizeDynamically', 'normalizeAndSort')
      .addEdge('normalizeAndSort', END);

    return graph.compile();
  }
}
