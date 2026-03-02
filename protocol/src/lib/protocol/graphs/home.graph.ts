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
import { OpportunityPresenter, gatherPresenterContext, type PresenterDatabase } from '../agents/opportunity.presenter';
import { HomeCategorizerAgent } from '../agents/home.categorizer';
import { canUserSeeOpportunity, isActionableForViewer } from '../support/opportunity.utils';
import { resolveHomeSectionIcon, DEFAULT_HOME_SECTION_ICON } from '../support/lucide.icon-catalog';
import { protocolLogger } from '../support/protocol.logger';
import { timed } from '../../performance';

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
const PRESENTATION_CONCURRENCY = 50;
const MAX_REASONING_SNIPPET_LENGTH = 240;

/**
 * Strip leading narrator name from remark when the UI already prepends "Name: " to the chip.
 * Avoids duplication like "Yankı Ekin Yüksel: Yankı Ekin Yüksel introduced you two..."
 * Repeats until no leading name (handles "Name: Name rest").
 */
export function stripLeadingNarratorName(remark: string, narratorName: string): string {
  let t = remark.trim();
  if (!t || !narratorName.trim()) return remark;
  const name = narratorName.trim();
  const nameLower = name.toLowerCase();
  for (;;) {
    const lower = t.toLowerCase();
    if (!lower.startsWith(nameLower)) break;
    const rest = t.slice(name.length).replace(/^\s*[:,\-–—]\s*/i, '').trim();
    if (rest.length === 0 || rest === t) break;
    t = rest;
  }
  return t;
}

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
      return timed("HomeGraph.loadOpportunities", async () => {
        if (!state.userId) {
          return { error: 'userId is required' };
        }
        try {
          const fetchLimit = Math.min(150, Math.max(state.limit * 3, state.limit));
          const options: { limit?: number; indexId?: string } = {
            limit: fetchLimit,
          };
          if (state.indexId) options.indexId = state.indexId;
          // Do not pass conversationId: home view excludes draft opportunities (chat-only drafts).
          const raw = await this.database.getOpportunitiesForUser(state.userId, options);
          const visible = raw.filter((opp) =>
            canUserSeeOpportunity(opp.actors, opp.status, state.userId)
          );
          const visibleForFeed = visible.filter((opp) =>
            isActionableForViewer(opp.actors, opp.status, state.userId)
          );
          const expired = raw.filter(
            (opp) =>
              opp.status === 'expired' && canUserSeeOpportunity(opp.actors, opp.status, state.userId)
          );
          const sorted = [...visibleForFeed].sort((a, b) => {
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
          const opportunities = deduped.slice(0, state.limit);
          return { opportunities, expired };
        } catch (e) {
          logger.error('HomeGraph loadOpportunities failed', { error: e });
          return { error: 'Failed to load opportunities', opportunities: [], expired: [] };
        }
      });
    };

    const generateCardTextNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.generateCardText", async () => {
      logger.verbose('[HomeGraph:generateCardText] entry', { opportunitiesLength: state.opportunities.length, userId: state.userId });
      if (state.opportunities.length === 0) {
        logger.verbose('[HomeGraph:generateCardText] exit', { totalOpportunities: 0, totalSections: 0 });
        return { cards: [], meta: { totalOpportunities: 0, totalSections: 0 } };
      }
      const db = this.database as PresenterDatabase;
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
            const isIntroducer = viewerRole === 'introducer';
            const isPendingIntroducer = isIntroducer && opportunity.status === 'pending';
            const preferredActor = pickDisplayCounterpartActor(opportunity, state.userId)
              ?? opportunity.actors.find((a) => a.userId !== state.userId && a.role !== 'introducer');
            const actorWithProfile = opportunity.actors.find(
              (a) => a.userId !== state.userId && a.role !== 'introducer' && !!userMap.get(a.userId)
            );
            const introducer = opportunity.actors.find((a) => a.role === 'introducer');
            let otherActor = (preferredActor && userMap.get(preferredActor.userId))
              ? preferredActor
              : (actorWithProfile ?? preferredActor);
            // When the only other participant is the introducer (no separate party), use introducer as display counterpart so the card shows a name instead of "Unknown"
            if (!otherActor && introducer && introducer.userId !== state.userId && introducer.userId) {
              otherActor = { userId: introducer.userId, role: introducer.role };
            }
            const otherUser = otherActor ? userMap.get(otherActor.userId) ?? null : null;
            const introducerCounterparts = opportunity.actors.filter(
              (a) => a.userId !== state.userId && a.role !== 'introducer'
            );
            const participantNames = introducerCounterparts
              .map((actor) => userMap.get(actor.userId)?.name ?? 'Unknown')
              .sort();
            // Introducer always sees both party names (e.g. "Alice ↔ Bob"), regardless of status
            let userName = isIntroducer && participantNames.length > 0
              ? participantNames.join(' ↔ ')
              : (otherUser?.name ?? 'Unknown');
            // Fallback to profile identity name when users.name is missing (e.g. profile has display name, users row does not)
            if ((userName === 'Unknown' || !userName?.trim()) && otherActor?.userId && db.getProfile) {
              const profile = await db.getProfile(otherActor.userId).catch((err) => {
                logger.debug('[HomeGraph] getProfile fallback failed', { otherActorUserId: otherActor.userId, error: err });
                return null;
              });
              const profileName = profile?.identity?.name?.trim();
              if (profileName) userName = profileName;
            }
            const userAvatar = otherUser?.avatar ?? null;
            const reasoningSnippet =
              (typeof opportunity.interpretation?.reasoning === 'string'
                ? opportunity.interpretation.reasoning.replace(/\s+/g, ' ').trim().slice(0, MAX_REASONING_SNIPPET_LENGTH)
                : '') || 'A promising connection.';

            const fallbackCard = (): HomeCardItem => ({
              opportunityId: opportunity.id,
              userId: otherActor?.userId ?? '',
              name: userName,
              avatar: userAvatar,
              mainText: reasoningSnippet.slice(0, 300),
              cta: isIntroducer
                ? 'Share this introduction to get things started.'
                : 'Take a look and decide whether to reach out.',
              primaryActionLabel: isIntroducer ? 'Good match' : 'Start Chat',
              secondaryActionLabel: isIntroducer ? 'Pass' : 'Skip',
              mutualIntentsLabel: isIntroducer ? 'Connector match' : 'Shared interests',
              narratorChip: { name: 'Index', text: 'Worth a look.' },
              viewerRole,
              _cardIndex: cardIndex,
            });

            try {
              const ctx = await gatherPresenterContext(
                db,
                opportunity,
                state.userId,
                otherActor?.userId,
              );
              const mutualIntentCount = computeMutualIntentCount(ctx as unknown as Record<string, unknown>);
              const homeInput = {
                ...ctx,
                mutualIntentCount,
                opportunityStatus: opportunity.status,
              };
              const presentation = await presenter.presentHomeCard(homeInput);
              let narratorChip: { name: string; text: string; avatar?: string | null; userId?: string } | undefined;
              // Only show a person as narrator when they are the introducer and not the display counterpart
              // (bad data can have same user as introducer and party, e.g. "Amina introduced you to Amina")
              const introducerIsCounterpart = introducer && otherActor && introducer.userId === otherActor.userId;
              if (introducer && introducer.userId !== state.userId && !introducerIsCounterpart) {
                const introUser = userMap.get(introducer.userId) ?? null;
                const narratorName = introUser?.name ?? 'Someone';
                narratorChip = {
                  name: narratorName,
                  text: stripLeadingNarratorName(presentation.narratorRemark, narratorName),
                  avatar: introUser?.avatar ?? null,
                  userId: introducer.userId,
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
                viewerRole,
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
      logger.verbose('[HomeGraph:generateCardText] exit', { totalOpportunities: state.opportunities.length, totalSections: 0 });
      return {
        cards,
        meta: { totalOpportunities: state.opportunities.length, totalSections: 0 },
      };
      });
    };

    const categorizeDynamicallyNode = async (state: typeof HomeGraphState.State) => {
      return timed("HomeGraph.categorizeDynamically", async () => {
        logger.verbose('[HomeGraph:categorizeDynamically] entry', { cardsLength: state.cards.length });
        if (state.cards.length === 0) {
          logger.verbose('[HomeGraph:categorizeDynamically] exit', { sectionProposalsCount: 0 });
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
        logger.verbose('[HomeGraph:categorizeDynamically] exit', { sectionProposalsCount: proposals.length });
        return { sectionProposals: proposals };
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
