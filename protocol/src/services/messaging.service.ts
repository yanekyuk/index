import { MessagingAdapter, type MessagingAdapterConfig } from '../adapters/messaging.adapter';
import type { MessagingStore } from '../lib/xmtp';
import { extractText } from '../lib/xmtp';
import { log } from '../lib/log';

const logger = log.service.from('messaging');

export interface ConversationSummary {
  groupId: string;
  name: string;
  peerUserId: string | null;
  peerAvatar: string | null;
  lastMessage: { content: string; sentAt: string } | null;
  updatedAt: string | null;
}

export interface Message {
  id: string;
  senderInboxId: string;
  content: string;
  sentAt: string | undefined;
}

/**
 * Business logic for messaging.
 * Handles conversation listing, message filtering, send orchestration, and streaming.
 */
export class MessagingService {
  private readonly adapter: MessagingAdapter;

  constructor(store: MessagingStore, config: MessagingAdapterConfig) {
    this.adapter = new MessagingAdapter(store, config);
  }

  /** List conversations for a user with hidden-message filtering and peer resolution. */
  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const client = await this.adapter.getUserClient(userId);
    if (!client) throw new Error('XMTP client not available');

    const store = this.adapter.getStore();

    await client.conversations.syncAll();
    const dms = await client.conversations.listDms();

    const hiddenRows = await store.getHiddenConversations(userId);
    const hiddenMap = new Map(hiddenRows.map((r) => [r.conversationId, r.hiddenAt]));

    const allInboxIds = new Set<string>();
    const myInboxId = client.inboxId;

    const dmData: {
      dmId: string;
      peerInboxId: string | null;
      lastMessage: { content: string; sentAt: string } | null;
      updatedAt: string | null;
    }[] = [];

    for (const dm of dms) {
      const members = await dm.members();
      const peerMember = members.find((m) => m.inboxId !== myInboxId);
      const peerInboxId = peerMember?.inboxId ?? null;
      if (peerInboxId) allInboxIds.add(peerInboxId);

      const hiddenAt = hiddenMap.get(dm.id);
      const hiddenAtNs = hiddenAt ? BigInt(hiddenAt.getTime()) * BigInt(1_000_000) : null;

      const msgs = await dm.messages({ limit: 10 });
      const visibleMsgs = hiddenAtNs
        ? msgs.filter((m) => m.sentAtNs != null && BigInt(m.sentAtNs.toString()) > hiddenAtNs)
        : msgs;

      if (hiddenAt && visibleMsgs.length === 0) continue;

      const lastText = visibleMsgs.find((m) => extractText(m) !== '');
      dmData.push({
        dmId: dm.id,
        peerInboxId,
        lastMessage: lastText
          ? { content: extractText(lastText), sentAt: lastText.sentAtNs?.toString() ?? '' }
          : null,
        updatedAt: visibleMsgs[0]?.sentAtNs?.toString() ?? null,
      });
    }

    const inboxIdList = [...allInboxIds];
    const inboxToUser = inboxIdList.length
      ? await store.resolveUsersByInboxIds(inboxIdList)
      : new Map();

    return dmData.map((d) => {
      const peer = d.peerInboxId ? inboxToUser.get(d.peerInboxId) : null;
      return {
        groupId: d.dmId,
        name: peer?.name ?? 'Conversation',
        peerUserId: peer?.id ?? null,
        peerAvatar: peer?.avatar ?? null,
        lastMessage: d.lastMessage,
        updatedAt: d.updatedAt,
      };
    });
  }

  /** Get messages for a conversation, filtered by hidden timestamp. */
  async getMessages(userId: string, conversationId: string, limit = 50): Promise<Message[]> {
    const client = await this.adapter.getUserClient(userId);
    if (!client) throw new Error('XMTP client not available');

    const store = this.adapter.getStore();

    await client.conversations.syncAll();
    const conversation = await client.conversations.getConversationById(conversationId);
    if (!conversation) throw new Error('Conversation not found');

    await conversation.sync();
    const allMessages = await conversation.messages({ limit });

    const hiddenAt = await store.getHiddenAt(userId, conversationId);
    const hiddenAtNs = hiddenAt ? BigInt(hiddenAt.getTime()) * BigInt(1_000_000) : null;

    const messages = hiddenAtNs
      ? allMessages.filter((m) => m.sentAtNs != null && BigInt(m.sentAtNs.toString()) > hiddenAtNs)
      : allMessages;

    return messages
      .map((m) => ({
        id: m.id,
        senderInboxId: m.senderInboxId,
        content: extractText(m),
        sentAt: m.sentAtNs?.toString(),
      }))
      .filter((m) => m.content.trim() !== '');
  }

  /** Send a message. Creates DM if needed. Returns conversation ID. */
  async sendMessage(
    userId: string,
    params: { groupId?: string; peerUserId?: string; text: string },
  ): Promise<string> {
    const client = await this.adapter.getUserClient(userId);
    if (!client) throw new Error('XMTP client not available');

    let resolvedGroupId = params.groupId ?? null;

    if (!resolvedGroupId && params.peerUserId) {
      resolvedGroupId = await this.adapter.getOrCreateDm(userId, params.peerUserId);
      if (!resolvedGroupId) throw new Error('Could not create DM');
    }

    if (!resolvedGroupId) throw new Error('groupId or peerUserId is required');

    await client.conversations.syncAll();
    const conversation = await client.conversations.getConversationById(resolvedGroupId);
    if (!conversation) throw new Error('Conversation not found');

    await conversation.sendText(params.text.trim());
    return resolvedGroupId;
  }

  /** Find an existing DM conversation with a peer (read-only, no creation). */
  async findExistingDm(userId: string, peerUserId: string): Promise<string | null> {
    try {
      return await this.adapter.findExistingDm(userId, peerUserId);
    } catch {
      return null;
    }
  }

  /** Hide a conversation for a user. */
  async hideConversation(userId: string, conversationId: string): Promise<void> {
    const store = this.adapter.getStore();
    await store.hideConversation(userId, conversationId);
  }

  /** Get public XMTP info for a peer user. */
  async getPeerInfo(userId: string): Promise<{ walletAddress: string | null; xmtpInboxId: string | null } | null> {
    const store = this.adapter.getStore();
    return store.getPublicInfo(userId);
  }

  /** Create an SSE ReadableStream for real-time messages. */
  async streamMessages(userId: string): Promise<{ stream: ReadableStream; inboxId: string }> {
    const client = await this.adapter.getUserClient(userId);
    if (!client) throw new Error('XMTP client not available');

    try {
      await client.conversations.syncAll();
    } catch (err) {
      logger.warn('[streamMessages] syncAll failed, continuing', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const encoder = new TextEncoder();
    const keepAlive = `: keepalive\n\n`;

    const stream = new ReadableStream({
      start(controller) {
        const tryEnqueue = (chunk: Uint8Array) => { try { controller.enqueue(chunk); } catch {} };
        const tryClose = () => { try { controller.close(); } catch {} };

        const interval = setInterval(() => {
          try { tryEnqueue(encoder.encode(keepAlive)); } catch { clearInterval(interval); }
        }, 15_000);

        client.conversations
          .streamAllMessages({
            onError: (error) => {
              logger.warn('[streamMessages] Stream onError', {
                userId,
                error: error instanceof Error ? error.message : String(error),
              });
            },
            onFail: () => {
              logger.warn('[streamMessages] Stream onFail — exhausted retries', { userId });
              clearInterval(interval);
              tryEnqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`));
              tryClose();
            },
          })
          .then(async (messageStream) => {
            try {
              for await (const message of messageStream) {
                const content = extractText(message);
                if (!content.trim()) continue;
                const event = {
                  type: 'message',
                  id: message.id,
                  groupId: message.conversationId,
                  senderInboxId: message.senderInboxId,
                  content,
                  sentAt: message.sentAtNs?.toString(),
                };
                tryEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              }
            } catch (err) {
              logger.error('[streamMessages] for-await error', {
                userId,
                error: err instanceof Error ? err.message : String(err),
              });
            } finally {
              clearInterval(interval);
              tryClose();
            }
          })
          .catch((err) => {
            logger.error('[streamMessages] streamAllMessages creation failed', {
              userId,
              error: err instanceof Error ? err.message : String(err),
            });
            clearInterval(interval);
            tryEnqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream init failed' })}\n\n`));
            tryClose();
          });
      },
    });

    return { stream, inboxId: client.inboxId };
  }
}
