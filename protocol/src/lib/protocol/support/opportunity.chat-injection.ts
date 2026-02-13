/**
 * Injects new opportunity messages into existing Stream Chat channels
 * when an opportunity is created or sent between users who already have a chat.
 * Standalone utility to avoid circular dependency between opportunity graph and service.
 */

import type { Opportunity } from '../interfaces/database.interface';
import {
  getDirectChannelId,
  getStreamServerClient,
  ensureIndexBotUser,
  sendBotMessage,
  getChannelIntroOpportunityIds,
  addChannelIntroOpportunityId,
} from './stream-chat.utils';
import { protocolLogger } from './protocol.logger';

const logger = protocolLogger('OpportunityChatInjection');

/**
 * Get the two user IDs that define the direct channel for this opportunity.
 * Prefers non-introducer actors; if only one or zero, falls back to any two distinct actors.
 */
function getActorPairUserIds(opportunity: Opportunity): [string, string] | null {
  const nonIntroducers = opportunity.actors.filter((a) => a.role !== 'introducer');
  const ids = new Set<string>(
    (nonIntroducers.length >= 2 ? nonIntroducers : opportunity.actors).map((a) => a.userId)
  );
  const arr = [...ids];
  if (arr.length < 2) return null;
  return [arr[0], arr[1]];
}

/**
 * If the two users already have an active Stream channel (from a previous accepted opportunity),
 * send a system message about this new opportunity. Idempotent: skips if channel metadata
 * (introOpportunityIds) already records this opportunityId, so prior intros/updates are detected
 * without relying on a fixed message window.
 */
export async function injectOpportunityIntoExistingChat(opportunity: Opportunity): Promise<void> {
  const streamClient = getStreamServerClient();
  if (!streamClient) {
    logger.debug('[injectOpportunityIntoExistingChat] Stream not configured; skipping');
    return;
  }

  const pair = getActorPairUserIds(opportunity);
  if (!pair) {
    logger.debug('[injectOpportunityIntoExistingChat] Opportunity has no pair of users; skipping', {
      opportunityId: opportunity.id,
    });
    return;
  }

  const [userId1, userId2] = pair;
  const channelId = getDirectChannelId(userId1, userId2);
  const channel = streamClient.channel('messaging', channelId, { members: [userId1, userId2] });

  try {
    const queryResult = await channel.query({ state: true, watch: false, messages: { limit: 1 } });
    const messages = queryResult.messages ?? [];

    if (messages.length === 0) {
      logger.debug('[injectOpportunityIntoExistingChat] Channel has no messages; skipping', {
        opportunityId: opportunity.id,
        channelId,
      });
      return;
    }

    const introOpportunityIds = getChannelIntroOpportunityIds(channel);
    if (introOpportunityIds.includes(opportunity.id)) {
      logger.debug('[injectOpportunityIntoExistingChat] Intro/update for this opportunity already recorded; skipping', {
        opportunityId: opportunity.id,
        channelId,
      });
      return;
    }

    await ensureIndexBotUser(streamClient);

    const reasoning = opportunity.interpretation?.reasoning ?? 'A new connection opportunity was detected.';
    await sendBotMessage(channel, {
      type: 'system',
      text: `**New opportunity detected**\n\n${reasoning}`,
      introType: 'opportunity_update',
      opportunityId: opportunity.id,
    });
    await addChannelIntroOpportunityId(channel, opportunity.id);

    logger.info('[injectOpportunityIntoExistingChat] Injected opportunity into existing chat', {
      opportunityId: opportunity.id,
      channelId,
    });
  } catch (error) {
    logger.warn('[injectOpportunityIntoExistingChat] Failed to inject', {
      error,
      opportunityId: opportunity.id,
      channelId,
    });
  }
}
