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

const normalizeReasoningSnippet = (reasoning: unknown): string | null => {
  if (typeof reasoning !== 'string') {
    return null;
  }
  const cleaned = reasoning.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return null;
  }
  return cleaned.length > MAX_REASONING_SNIPPET_LENGTH
    ? `${cleaned.slice(0, MAX_REASONING_SNIPPET_LENGTH).trimEnd()}...`
    : cleaned;
};

const buildGroupedReasoning = (opportunities: typeof HomeGraphState.State['opportunities']): string => {
  const snippets = opportunities
    .map((opportunity) => normalizeReasoningSnippet(opportunity.interpretation?.reasoning))
    .filter((snippet): snippet is string => !!snippet);
  if (snippets.length === 0) {
    return 'Multiple opportunities were identified for this connection.';
  }
  return snippets.map((snippet, index) => `Opportunity ${index + 1}: ${snippet}`).join('\n');
};

const buildActorGroupingKey = (opportunity: typeof HomeGraphState.State['opportunities'][number], viewerId: string): string => {
  const otherParticipantIds = opportunity.actors
    .filter((actor) => actor.userId !== viewerId && actor.role !== 'introducer')
    .map((actor) => actor.userId)
    .sort();

  if (otherParticipantIds.length > 0) {
    return `participants:${otherParticipantIds.join('|')}`;
  }

  const fallbackActorIds = opportunity.actors
    .filter((actor) => actor.userId !== viewerId)
    .map((actor) => actor.userId)
    .sort();
  return `actors:${fallbackActorIds.join('|')}`;
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
        const options: { limit?: number; indexId?: string } = {
          limit: state.limit,
        };
        if (state.indexId) options.indexId = state.indexId;
        const raw = await this.database.getOpportunitiesForUser(state.userId, options);
        const visible = raw.filter(
          (opp) => canUserSeeOpportunity(opp.actors, opp.status, state.userId)
        );
        const expired = raw.filter(
          (opp) =>
            opp.status === 'expired' && canUserSeeOpportunity(opp.actors, opp.status, state.userId)
        );
        return { opportunities: visible, expired };
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
      const groupedByCounterpartUser = new Map<string, typeof state.opportunities>();
      for (const opportunity of state.opportunities) {
        const displayCounterpart = pickDisplayCounterpartActor(opportunity, state.userId);
        const fallbackActorKey = buildActorGroupingKey(opportunity, state.userId);
        const key = displayCounterpart?.userId
          ? `counterpart:${displayCounterpart.userId}`
          : `fallback:${fallbackActorKey}`;
        const existing = groupedByCounterpartUser.get(key);
        if (existing) {
          existing.push(opportunity);
        } else {
          groupedByCounterpartUser.set(key, [opportunity]);
        }
      }
      const groupedOpportunities = Array.from(groupedByCounterpartUser.values()).map((group) =>
        [...group].sort((a, b) => {
          const aTime = a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt).getTime();
          const bTime = b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt).getTime();
          return bTime - aTime;
        })
      );
      const relevantActorIds = new Set<string>();
      for (const oppGroup of groupedOpportunities) {
        const opp = oppGroup[0];
        const otherActor = opp.actors.find((a) => a.userId !== state.userId && a.role !== 'introducer');
        const introducer = opp.actors.find((a) => a.role === 'introducer');
        if (otherActor?.userId) relevantActorIds.add(otherActor.userId);
        if (introducer?.userId) relevantActorIds.add(introducer.userId);
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

      for (let i = 0; i < groupedOpportunities.length; i += PRESENTATION_CONCURRENCY) {
        const chunk = groupedOpportunities.slice(i, i + PRESENTATION_CONCURRENCY);
        const chunkCards = await Promise.all(
          chunk.map(async (grouped, offset) => {
            const primaryOpportunity = grouped[0];
            const groupedCount = grouped.length;
            const cardIndex = i + offset;
            const otherActor = pickDisplayCounterpartActor(primaryOpportunity, state.userId)
              ?? primaryOpportunity.actors.find((a) => a.userId !== state.userId && a.role !== 'introducer');
            const introducer = primaryOpportunity.actors.find((a) => a.role === 'introducer');
            const otherUser = otherActor ? userMap.get(otherActor.userId) ?? null : null;
            const userName = otherUser?.name ?? 'Unknown';
            const userAvatar = otherUser?.avatar ?? null;
            const groupedReasoning = groupedCount > 1
              ? buildGroupedReasoning(grouped)
              : (primaryOpportunity.interpretation?.reasoning ?? 'A connection opportunity.');

            const fallbackCard = (): HomeCardItem => ({
              opportunityId: primaryOpportunity.id,
              userId: otherActor?.userId ?? '',
              name: userName,
              avatar: userAvatar,
              mainText: groupedCount > 1
                ? `Index found ${groupedCount} opportunities between you and ${userName}. ${groupedReasoning}`
                : groupedReasoning.slice(0, 300),
              cta: 'View opportunity and decide whether to reach out.',
              primaryActionLabel: 'Start Chat',
              secondaryActionLabel: 'Skip',
              mutualIntentsLabel: 'Shared interests',
              narratorChip: { name: 'Index', text: 'Worth a look.' },
              _cardIndex: cardIndex,
            });

            try {
              const ctx = await gatherPresenterContext(db, primaryOpportunity, state.userId);
              const mutualIntentCount = computeMutualIntentCount(ctx as unknown as Record<string, unknown>);
              const homeInput = {
                ...ctx,
                mutualIntentCount,
                matchReasoning: groupedReasoning,
                signalsSummary: groupedCount > 1
                  ? `${ctx.signalsSummary}; groupedOpportunities=${groupedCount}`
                  : ctx.signalsSummary,
              };
              const presentation = await presenter.presentHomeCard(homeInput);
              let narratorChip: { name: string; text: string; avatar?: string | null } | undefined;
              if (introducer) {
                const introUser = userMap.get(introducer.userId) ?? null;
                narratorChip = {
                  name: introUser?.name ?? 'Someone',
                  text: presentation.narratorRemark,
                  avatar: introUser?.avatar ?? null,
                };
              } else {
                narratorChip = { name: 'Index', text: presentation.narratorRemark };
              }
              const mainText = groupedCount > 1
                ? `Index found ${groupedCount} opportunities between you and ${userName}. ${presentation.personalizedSummary}`
                : presentation.personalizedSummary;
              return {
                opportunityId: primaryOpportunity.id,
                userId: otherActor?.userId ?? '',
                name: userName,
                avatar: userAvatar,
                mainText,
                cta: presentation.suggestedAction,
                headline: presentation.headline,
                primaryActionLabel: presentation.primaryActionLabel,
                secondaryActionLabel: presentation.secondaryActionLabel,
                mutualIntentsLabel: presentation.mutualIntentsLabel,
                narratorChip,
                _cardIndex: cardIndex,
              } satisfies HomeCardItem;
            } catch (e) {
              logger.warn('HomeGraph presenter failed for opportunity group', { opportunityId: primaryOpportunity.id, groupedCount, error: e });
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
