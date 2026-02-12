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
        const options: { limit?: number; indexId?: string } = { limit: state.limit };
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
      const relevantActorIds = new Set<string>();
      for (const opp of state.opportunities) {
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

      for (let i = 0; i < state.opportunities.length; i += PRESENTATION_CONCURRENCY) {
        const chunk = state.opportunities.slice(i, i + PRESENTATION_CONCURRENCY);
        const chunkCards = await Promise.all(
          chunk.map(async (opp, offset) => {
            const cardIndex = i + offset;
            const otherActor = opp.actors.find((a) => a.userId !== state.userId && a.role !== 'introducer');
            const introducer = opp.actors.find((a) => a.role === 'introducer');
            const otherUser = otherActor ? userMap.get(otherActor.userId) ?? null : null;
            const userName = otherUser?.name ?? 'Unknown';
            const userAvatar = otherUser?.avatar ?? null;

            const fallbackCard = (): HomeCardItem => ({
              opportunityId: opp.id,
              userId: otherActor?.userId ?? '',
              name: userName,
              avatar: userAvatar,
              mainText: opp.interpretation?.reasoning?.slice(0, 300) ?? 'A connection opportunity.',
              cta: 'View opportunity and decide whether to reach out.',
              primaryActionLabel: 'Start Chat',
              secondaryActionLabel: 'Skip',
              mutualIntentsLabel: 'Shared interests',
              narratorChip: { name: 'Index', text: 'Worth a look.' },
              _cardIndex: cardIndex,
            });

            try {
              const ctx = await gatherPresenterContext(db, opp, state.userId);
              const mutualIntentCount = computeMutualIntentCount(ctx as unknown as Record<string, unknown>);
              const homeInput = { ...ctx, mutualIntentCount };
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
              return {
                opportunityId: opp.id,
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
              logger.warn('HomeGraph presenter failed for opportunity', { opportunityId: opp.id, error: e });
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
