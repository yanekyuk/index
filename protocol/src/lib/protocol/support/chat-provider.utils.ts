/**
 * Chat provider utilities for the protocol layer.
 * Pure helpers and provider/channel-based helpers that use the ChatProvider interface only.
 */

import { createHash } from 'node:crypto';
import {
  INDEX_BOT_USER_ID,
  INDEX_BOT_NAME,
  type ChatChannel,
  type ChatMessage,
  type ChatProvider,
  type ChatUser,
} from '../interfaces/chat.interface';
import { protocolLogger } from './protocol.logger';

const logger = protocolLogger('ChatProviderUtils');

// ──────────────────────────────────────────────────────────────
// CHANNEL-ID DERIVATION (pure)
// ──────────────────────────────────────────────────────────────

/**
 * Deterministic channel id for a direct conversation between two users.
 * Sorts the ids so that the same pair always produces the same channel id.
 * When concatenated length exceeds Stream's 64-char limit, uses SHA-256 (first 64 hex chars)
 * for collision-resistant, deterministic channel IDs.
 */
export function getDirectChannelId(firstUserId: string, secondUserId: string): string {
  const sortedIds = [firstUserId, secondUserId].sort().join('_');
  if (sortedIds.length <= 64) return sortedIds;
  return createHash('sha256').update(sortedIds, 'utf8').digest('hex').slice(0, 64);
}

// ──────────────────────────────────────────────────────────────
// MESSAGE HELPERS (pure)
// ──────────────────────────────────────────────────────────────

/**
 * Check whether any message in `messages` already references the given
 * `opportunityId` via an `introType` of `opportunity_intro` or
 * `opportunity_update`.
 * Supports both top-level and message.custom for SDK message shape.
 * Accepts readonly unknown[] so it can be used with channel.state.messages.
 */
export function channelHasMessageForOpportunity(
  messages: readonly unknown[],
  opportunityId: string,
): boolean {
  return messages.some((raw) => {
    const message = raw as { introType?: string; opportunityId?: string; custom?: { introType?: string; opportunityId?: string } };
    const introType = message.introType ?? message.custom?.introType;
    const msgOppId = message.opportunityId ?? message.custom?.opportunityId;
    return (
      (introType === 'opportunity_intro' || introType === 'opportunity_update') &&
      msgOppId === opportunityId
    );
  });
}

// ──────────────────────────────────────────────────────────────
// CHANNEL METADATA (intro deduplication) — use ChatChannel interface
// ──────────────────────────────────────────────────────────────

/**
 * Read the list of opportunity IDs that already have an intro or update message in this channel.
 * Stored as channel-level metadata (channel.data.introOpportunityIds).
 */
export function getChannelIntroOpportunityIds(channel: ChatChannel): string[] {
  const data = channel.data;
  const ids = data?.introOpportunityIds;
  return Array.isArray(ids) ? ids : [];
}

/**
 * Record that an intro or update was sent for `opportunityId` by appending to channel metadata.
 * Call after successfully sending opportunity_intro (creation) or opportunity_update (reinjection).
 */
export async function addChannelIntroOpportunityId(
  channel: ChatChannel,
  opportunityId: string,
): Promise<void> {
  const current = getChannelIntroOpportunityIds(channel);
  if (current.includes(opportunityId)) return;
  const next = [...current, opportunityId];
  try {
    await channel.updatePartial({ set: { introOpportunityIds: next } as Record<string, unknown> });
  } catch (error) {
    logger.warn('[addChannelIntroOpportunityId] Failed to update channel metadata', {
      opportunityId,
      error,
    });
  }
}

// ──────────────────────────────────────────────────────────────
// USER MANAGEMENT — use ChatProvider interface
// ──────────────────────────────────────────────────────────────

/**
 * Upsert one or more users via the chat provider so they exist before creating channels or sending messages.
 * Logs and continues on partial failure.
 * Accepts any provider that has upsertUsers (e.g. ChatProvider or OpportunityChatProvider).
 */
export async function ensureStreamUsers(
  provider: Pick<ChatProvider, 'upsertUsers'>,
  users: ChatUser[],
): Promise<void> {
  if (users.length === 0) return;
  const payload: ChatUser[] = users.map((u) => ({
    id: u.id,
    name: u.name?.trim() || 'Unknown',
    image: u.image?.trim() || undefined,
  }));
  try {
    await provider.upsertUsers(payload);
  } catch (error) {
    logger.warn('[ensureStreamUsers] Failed to upsert users', { userIds: users.map((u) => u.id), error });
  }
}

/**
 * Upsert the Index bot user via the chat provider so it can send messages.
 * Silently logs and continues on failure.
 * Accepts any provider that has upsertUsers (e.g. ChatProvider or OpportunityChatProvider).
 */
export async function ensureIndexBotUser(
  provider: Pick<ChatProvider, 'upsertUsers'>,
): Promise<void> {
  try {
    await provider.upsertUsers([{ id: INDEX_BOT_USER_ID, name: INDEX_BOT_NAME }]);
  } catch (error) {
    logger.warn('[ensureIndexBotUser] Failed to upsert Index bot user', { error });
  }
}

// ──────────────────────────────────────────────────────────────
// MESSAGE HELPERS — use ChatChannel interface
// ──────────────────────────────────────────────────────────────

/**
 * Send a message from the Index bot on `channel`.
 * With server-side auth, the sender is set in the message object (user_id).
 */
export async function sendBotMessage(
  channel: ChatChannel,
  message: Record<string, unknown>,
): Promise<void> {
  const fullMessage: ChatMessage = { ...message, user_id: INDEX_BOT_USER_ID } as ChatMessage;
  await channel.sendMessage(fullMessage);
}
