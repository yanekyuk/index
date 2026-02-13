/**
 * Shared Stream Chat utilities.
 *
 * Centralises constants, channel-id derivation, server-client creation,
 * bot-user management, and message helpers so that every call-site
 * (opportunity.service, opportunity.chat-injection, etc.) shares a single
 * implementation and all Stream SDK type workarounds live in one place.
 */

import { createHash } from 'node:crypto';
import { StreamChat } from 'stream-chat';
import type { Channel } from 'stream-chat';
import { protocolLogger } from './protocol.logger';

const logger = protocolLogger('StreamChatUtils');

// ──────────────────────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────────────────────

export const INDEX_BOT_USER_ID = 'index_bot';
export const INDEX_BOT_NAME = 'Index';

// ──────────────────────────────────────────────────────────────
// CHANNEL-ID DERIVATION
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
// SERVER CLIENT
// ──────────────────────────────────────────────────────────────

/**
 * Returns the singleton Stream server-side client, or `null` when
 * `STREAM_API_KEY` / `STREAM_SECRET` are not configured.
 */
export function getStreamServerClient(): StreamChat | null {
  const apiKey = process.env.STREAM_API_KEY;
  const secret = process.env.STREAM_SECRET;
  if (!apiKey || !secret) return null;
  return StreamChat.getInstance(apiKey, secret);
}

// ──────────────────────────────────────────────────────────────
// USER MANAGEMENT
// ──────────────────────────────────────────────────────────────

/**
 * Payload for upserting a user to Stream (id required; name and image optional).
 * Stream uses `image` for the avatar URL.
 */
export type StreamUserUpsert = {
  id: string;
  name?: string;
  image?: string;
};

/**
 * Upsert one or more users to Stream so they exist before creating channels or sending messages.
 * Uses name and image (avatar) when provided. Logs and continues on partial failure.
 */
export async function ensureStreamUsers(
  streamClient: StreamChat,
  users: StreamUserUpsert[],
): Promise<void> {
  if (users.length === 0) return;
  const payload = users.map((u) => ({
    id: u.id,
    name: u.name?.trim() || 'Unknown',
    image: u.image?.trim() || undefined,
  }));
  try {
    await streamClient.upsertUsers(payload);
  } catch (error) {
    logger.warn('[ensureStreamUsers] Failed to upsert users', { userIds: users.map((u) => u.id), error });
  }
}

/**
 * Upsert the Index bot user so it can send messages.
 * Silently logs and continues on failure.
 */
export async function ensureIndexBotUser(streamClient: StreamChat): Promise<void> {
  try {
    await streamClient.upsertUsers([{ id: INDEX_BOT_USER_ID, name: INDEX_BOT_NAME }]);
  } catch (error) {
    logger.warn('[ensureIndexBotUser] Failed to upsert Index bot user', { error });
  }
}

// ──────────────────────────────────────────────────────────────
// MESSAGE HELPERS
// ──────────────────────────────────────────────────────────────

/**
 * Send a message from the Index bot on `channel`.
 *
 * With server-side auth, Stream v9 expects the sender in the message object (user_id).
 */
export async function sendBotMessage(
  channel: Channel,
  message: Record<string, unknown>,
): Promise<void> {
  await channel.sendMessage({ ...message, user_id: INDEX_BOT_USER_ID } as Parameters<Channel['sendMessage']>[0]);
}

/**
 * Check whether any message in `messages` already references the given
 * `opportunityId` via an `introType` of `opportunity_intro` or
 * `opportunity_update`.
 * Supports both top-level and message.custom for Stream SDK message shape.
 */
export function channelHasMessageForOpportunity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: readonly any[],
  opportunityId: string,
): boolean {
  return messages.some((message) => {
    const m = message as {
      introType?: string;
      opportunityId?: string;
      custom?: { introType?: string; opportunityId?: string };
    };
    const introType = m.introType ?? m.custom?.introType;
    const msgOppId = m.opportunityId ?? m.custom?.opportunityId;
    return (
      (introType === 'opportunity_intro' || introType === 'opportunity_update') &&
      msgOppId === opportunityId
    );
  });
}

// ──────────────────────────────────────────────────────────────
// CHANNEL METADATA (intro deduplication)
// ──────────────────────────────────────────────────────────────

/** Channel-like object with optional custom data for intro tracking. */
type ChannelWithIntroMeta = Channel & {
  data?: { introOpportunityIds?: string[] };
};

/**
 * Read the list of opportunity IDs that already have an intro or update message in this channel.
 * Stored as channel-level metadata (channel.data.introOpportunityIds) so creation and reinjection
 * flows can reliably detect prior intros without scanning a fixed message window.
 */
export function getChannelIntroOpportunityIds(channel: Channel): string[] {
  const data = (channel as ChannelWithIntroMeta).data;
  const ids = data?.introOpportunityIds;
  return Array.isArray(ids) ? ids : [];
}

/**
 * Record that an intro or update was sent for `opportunityId` by appending to channel metadata.
 * Call after successfully sending opportunity_intro (creation) or opportunity_update (reinjection)
 * so both flows share the same idempotency signal.
 */
export async function addChannelIntroOpportunityId(channel: Channel, opportunityId: string): Promise<void> {
  const current = getChannelIntroOpportunityIds(channel);
  if (current.includes(opportunityId)) return;
  const next = [...current, opportunityId];
  try {
    await (
      channel as unknown as { updatePartial: (arg: { set?: Record<string, unknown> }) => Promise<unknown> }
    ).updatePartial({ set: { introOpportunityIds: next } as Record<string, unknown> });
  } catch (error) {
    logger.warn('[addChannelIntroOpportunityId] Failed to update channel metadata', {
      opportunityId,
      error,
    });
  }
}
