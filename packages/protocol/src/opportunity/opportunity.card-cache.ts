/**
 * Cache-aside home-card presentation: same Redis keys as the home feed
 * (`home:card:{opportunityId}:{status}:{viewerUserId}`) so any surface can
 * reuse presenter output without duplicate LLM work.
 */

import type {
  ChatGraphCompositeDatabase,
  Opportunity,
  OpportunityStatus,
} from "../shared/interfaces/database.interface.js";
import type { OpportunityCache } from "../shared/interfaces/cache.interface.js";
import type { DebugMetaAgent } from "../chat/chat-streaming.types.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { HomeCardItem } from "./feed/feed.state.js";
import {
  OpportunityPresenter,
  gatherPresenterContext,
  type PresenterDatabase,
} from "./opportunity.presenter.js";
import { loadNegotiationContext } from "./negotiation-context.loader.js";
import { getPrimaryActionLabel, SECONDARY_ACTION_LABEL } from "./opportunity.labels.js";
import { requestContext } from "../shared/observability/request-context.js";

const logger = protocolLogger("OpportunityCardCache");

/** Same TTL as home feed ([feed.graph.ts](feed.graph.ts)). */
export const HOME_CARD_CACHE_TTL_SEC = 24 * 60 * 60;

const MAX_REASONING_SNIPPET_LENGTH = 240;
const PRESENTATION_CONCURRENCY = 10;

/**
 * Redis key for a cached home-card row (must stay aligned with home graph).
 */
export function homeCardCacheKey(
  opportunityId: string,
  status: OpportunityStatus,
  viewerUserId: string,
): string {
  return `home:card:${opportunityId}:${status}:${viewerUserId}`;
}

/**
 * Strip leading narrator name from remark when the UI already prepends "Name: " to the chip.
 * (Moved from feed.graph for shared use with home-card cache.)
 */
export function stripLeadingNarratorName(remark: string, narratorName: string): string {
  let t = remark.trim();
  if (!t || !narratorName.trim()) return remark;
  const name = narratorName.trim();
  const nameLower = name.toLowerCase();
  for (;;) {
    const lower = t.toLowerCase();
    if (!lower.startsWith(nameLower)) break;
    const rest = t.slice(name.length).replace(/^\s*[:,\-–—]\s*/i, "").trim();
    if (rest.length === 0 || rest === t) break;
    t = rest;
  }
  return t;
}

function pickDisplayCounterpartActor(
  opportunity: Opportunity,
  viewerId: string,
): { userId: string; role: string } | null {
  const candidates = opportunity.actors.filter(
    (actor) => actor.userId !== viewerId && actor.role !== "introducer",
  );
  if (candidates.length === 0) {
    return null;
  }
  const rolePriority = new Map<string, number>([
    ["patient", 0],
    ["party", 1],
    ["agent", 2],
    ["peer", 3],
  ]);
  const sorted = [...candidates].sort((a, b) => {
    const aPriority = rolePriority.get(a.role ?? "") ?? 99;
    const bPriority = rolePriority.get(b.role ?? "") ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.userId.localeCompare(b.userId);
  });
  return sorted[0] ?? null;
}

function getUniqueCounterpartUserIds(opp: Opportunity, viewerId: string): Set<string> {
  const ids = new Set<string>();
  for (const a of opp.actors) {
    if (a.role !== "introducer" && a.userId !== viewerId && a.userId) {
      ids.add(a.userId);
    }
  }
  return ids;
}

async function buildUserMap(
  database: ChatGraphCompositeDatabase,
  opportunities: Opportunity[],
  viewerUserId: string,
): Promise<Map<string, Awaited<ReturnType<ChatGraphCompositeDatabase["getUser"]>> | null>> {
  const ids = new Set<string>();
  ids.add(viewerUserId);
  for (const opp of opportunities) {
    for (const a of opp.actors) {
      if (a.userId) ids.add(a.userId);
    }
  }
  const entries = await Promise.all(
    [...ids].map(async (id) => {
      try {
        const u = await database.getUser(id);
        return [id, u] as const;
      } catch {
        return [id, null] as const;
      }
    }),
  );
  return new Map(entries);
}

/**
 * Materialize one home card: presenter + narrator assembly (same contract as home feed).
 */
export async function materializeHomeCardItem(params: {
  presenter: OpportunityPresenter;
  database: ChatGraphCompositeDatabase;
  opportunity: Opportunity;
  viewerUserId: string;
  cardIndex: number;
  userMap: Map<string, Awaited<ReturnType<ChatGraphCompositeDatabase["getUser"]>> | null>;
}): Promise<{ card: HomeCardItem; agentTiming?: DebugMetaAgent }> {
  const { presenter, database, opportunity, viewerUserId, cardIndex, userMap } = params;
  const db = database as unknown as PresenterDatabase &
    Parameters<typeof loadNegotiationContext>[0];

  const viewerActor = opportunity.actors.find((a) => a.userId === viewerUserId);
  const viewerRole = viewerActor?.role ?? "party";
  const isIntroducer = viewerRole === "introducer";
  const preferredActor = pickDisplayCounterpartActor(opportunity, viewerUserId);
  const actorWithProfile = opportunity.actors.find(
    (a) => a.userId !== viewerUserId && a.role !== "introducer" && !!userMap.get(a.userId),
  );
  const introducer = opportunity.actors.find((a) => a.role === "introducer");
  let otherActor =
    preferredActor && userMap.get(preferredActor.userId)
      ? preferredActor
      : (actorWithProfile ?? preferredActor);
  if (!otherActor && introducer && introducer.userId !== viewerUserId && introducer.userId) {
    otherActor = { userId: introducer.userId, role: introducer.role ?? "introducer" };
  }
  const otherUser = otherActor ? userMap.get(otherActor.userId) ?? null : null;
  const introducerCounterparts = opportunity.actors.filter(
    (a) => a.userId !== viewerUserId && a.role !== "introducer",
  );
  const uniqueCounterpartIds = [...new Set(introducerCounterparts.map((a) => a.userId))];
  const participantNames = uniqueCounterpartIds
    .map((uid) => userMap.get(uid)?.name ?? "Unknown")
    .sort();
  const willHaveSecondParty = isIntroducer && uniqueCounterpartIds.length > 1;
  let userName =
    isIntroducer && participantNames.length > 0 && !willHaveSecondParty
      ? participantNames.join(" ↔ ")
      : (otherUser?.name ?? "Unknown");
  if ((userName === "Unknown" || !userName?.trim()) && otherActor?.userId && database.getProfile) {
    const profile = await database.getProfile(otherActor.userId).catch(() => null);
    const profileName = profile?.identity?.name?.trim();
    if (profileName) userName = profileName;
  }
  const userAvatar = otherUser?.avatar ?? null;
  const reasoningSnippet =
    (typeof opportunity.interpretation?.reasoning === "string"
      ? opportunity.interpretation.reasoning.replace(/\s+/g, " ").trim().slice(0, MAX_REASONING_SNIPPET_LENGTH)
      : "") || "A promising connection.";

  let secondPartyData: { name: string; avatar?: string | null; userId?: string } | undefined;
  if (isIntroducer && introducerCounterparts.length > 1 && otherActor) {
    const secondActor = introducerCounterparts.find((a) => a.userId !== otherActor.userId);
    if (secondActor) {
      const secondUser = userMap.get(secondActor.userId) ?? null;
      secondPartyData = {
        name: secondUser?.name ?? "Unknown",
        avatar: secondUser?.avatar ?? null,
        userId: secondActor.userId,
      };
    }
  }

  const isCounterpartGhost = otherUser?.isGhost ?? false;
  const fallbackCard = (): HomeCardItem => ({
    opportunityId: opportunity.id,
    userId: otherActor?.userId ?? "",
    name: userName,
    avatar: userAvatar,
    mainText: reasoningSnippet.slice(0, 300),
    cta: isIntroducer
      ? "Share this introduction to get things started."
      : "Take a look and decide whether to reach out.",
    primaryActionLabel: getPrimaryActionLabel(viewerRole),
    secondaryActionLabel: SECONDARY_ACTION_LABEL,
    mutualIntentsLabel: isIntroducer ? "Connector match" : "Shared interests",
    narratorChip: isIntroducer
      ? { name: "You", text: "Worth a look.", userId: viewerUserId }
      : { name: "Index", text: "Worth a look." },
    viewerRole,
    isGhost: isCounterpartGhost,
    ...(secondPartyData ? { secondParty: secondPartyData } : {}),
    _cardIndex: cardIndex,
  });

  try {
    const [ctx, negotiationContext] = await Promise.all([
      gatherPresenterContext(db, opportunity, viewerUserId, otherActor?.userId),
      loadNegotiationContext(db, opportunity.id, opportunity.status),
    ]);
    const homeInput = {
      ...ctx,
      mutualIntentCount: undefined,
      opportunityStatus: opportunity.status,
      ...(negotiationContext ? { negotiationContext } : {}),
    };
    const traceEmitter = requestContext.getStore()?.traceEmitter;
    const presenterStart = Date.now();
    traceEmitter?.({ type: "agent_start", name: "opportunity-presenter" });
    const presentation = await presenter.presentHomeCard(homeInput);
    const durationMs = Date.now() - presenterStart;
    traceEmitter?.({
      type: "agent_end",
      name: "opportunity-presenter",
      durationMs,
      summary: `Presented: ${userName}`,
    });

    const introducerIsCounterpart =
      introducer && otherActor && introducer.userId === otherActor.userId;
    let narratorChip: { name: string; text: string; avatar?: string | null; userId?: string } | undefined;
    if (introducer && introducer.userId !== viewerUserId && !introducerIsCounterpart) {
      const introUser = userMap.get(introducer.userId) ?? null;
      const narratorName = introUser?.name ?? "Someone";
      narratorChip = {
        name: narratorName,
        text: stripLeadingNarratorName(presentation.narratorRemark, narratorName),
        avatar: introUser?.avatar ?? null,
        userId: introducer.userId,
      };
    } else if (introducer?.userId === viewerUserId) {
      narratorChip = { name: "You", text: presentation.narratorRemark, userId: viewerUserId };
    } else {
      narratorChip = { name: "Index", text: presentation.narratorRemark };
    }

    const card: HomeCardItem = {
      opportunityId: opportunity.id,
      userId: otherActor?.userId ?? "",
      name: userName,
      avatar: userAvatar,
      mainText: presentation.personalizedSummary,
      cta: presentation.suggestedAction,
      headline: presentation.headline,
      primaryActionLabel: getPrimaryActionLabel(viewerRole),
      secondaryActionLabel: SECONDARY_ACTION_LABEL,
      mutualIntentsLabel: presentation.mutualIntentsLabel,
      narratorChip,
      viewerRole,
      isGhost: isCounterpartGhost,
      ...(secondPartyData ? { secondParty: secondPartyData } : {}),
      _cardIndex: cardIndex,
    };
    return { card, agentTiming: { name: "opportunity.presenter", durationMs } };
  } catch (e) {
    logger.warn("materializeHomeCardItem presenter failed", {
      opportunityId: opportunity.id,
      error: e,
    });
    return { card: fallbackCard() };
  }
}

export interface GetOrCreateHomeCardBatchParams {
  presenter: OpportunityPresenter;
  database: ChatGraphCompositeDatabase;
  cache: OpportunityCache;
  opportunities: Opportunity[];
  viewerUserId: string;
  /** When true, skip cache read and write (home feed `noCache`). */
  noCache?: boolean;
}

/**
 * Load or generate home cards for the given opportunities, using Redis cache-aside.
 * Order matches `opportunities` input; `_cardIndex` is set to each item's index.
 */
export async function getOrCreateHomeCardItemBatch(
  params: GetOrCreateHomeCardBatchParams,
): Promise<{ cards: HomeCardItem[]; agentTimings: DebugMetaAgent[] }> {
  const { presenter, database, cache, opportunities, viewerUserId, noCache } = params;
  if (opportunities.length === 0) {
    return { cards: [], agentTimings: [] };
  }

  const oppIndexMap = new Map(opportunities.map((opp, idx) => [opp.id, idx]));
  const userMap = await buildUserMap(database, opportunities, viewerUserId);

  const agentTimings: DebugMetaAgent[] = [];
  const results: (HomeCardItem | null)[] = new Array(opportunities.length).fill(null);

  const cacheableIndices: number[] = [];
  const cacheKeys: string[] = [];
  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    if (!noCache && opp.status !== "negotiating") {
      cacheableIndices.push(i);
      cacheKeys.push(homeCardCacheKey(opp.id, opp.status, viewerUserId));
    }
  }

  let cachedValues: (HomeCardItem | null)[] = [];
  if (cacheKeys.length > 0 && !noCache) {
    try {
      cachedValues = await cache.mget<HomeCardItem>(cacheKeys);
    } catch (e) {
      logger.warn("[getOrCreateHomeCardItemBatch] mget failed; regenerating all", { error: e });
      cachedValues = cacheKeys.map(() => null);
    }
  } else {
    cachedValues = cacheKeys.map(() => null);
  }

  let cacheReadIdx = 0;
  for (const i of cacheableIndices) {
    const cached = cachedValues[cacheReadIdx++];
    const opp = opportunities[i];
    if (cached) {
      results[i] = { ...cached, _cardIndex: oppIndexMap.get(opp.id) ?? i };
    }
  }

  const missIndices: number[] = [];
  for (let i = 0; i < opportunities.length; i++) {
    if (results[i] == null) missIndices.push(i);
  }

  for (let i = 0; i < missIndices.length; i += PRESENTATION_CONCURRENCY) {
    const chunk = missIndices.slice(i, i + PRESENTATION_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (idx) => {
        const opp = opportunities[idx];
        const cardIndex = oppIndexMap.get(opp.id) ?? idx;
        const { card, agentTiming } = await materializeHomeCardItem({
          presenter,
          database,
          opportunity: opp,
          viewerUserId,
          cardIndex,
          userMap,
        });
        if (agentTiming) agentTimings.push(agentTiming);

        if (!noCache && opp.status !== "negotiating") {
          try {
            await cache.set(homeCardCacheKey(opp.id, opp.status, viewerUserId), card, {
              ttl: HOME_CARD_CACHE_TTL_SEC,
            });
          } catch (e) {
            logger.warn("[getOrCreateHomeCardItemBatch] cache set failed", {
              opportunityId: opp.id,
              error: e,
            });
          }
        }
        return { idx, card };
      }),
    );
    for (const { idx, card } of chunkResults) {
      results[idx] = card;
    }
  }

  const cards = results.map((c, i) => {
    if (!c) {
      logger.error("[getOrCreateHomeCardItemBatch] missing card", { index: i });
      throw new Error(`Home card generation failed for opportunity at index ${i}`);
    }
    return c;
  });

  return { cards, agentTimings };
}
