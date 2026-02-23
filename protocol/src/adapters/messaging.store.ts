import { eq, and, inArray } from 'drizzle-orm';

import type { MessagingStore } from '../lib/xmtp';
import { generateWallet, decryptKey } from '../lib/xmtp';
import db from '../lib/drizzle/drizzle';
import { users, hiddenConversations } from '../schemas/database.schema';
import { log } from '../lib/log';

const logger = log.lib.from('messaging.store');

/** Create a Drizzle-backed MessagingStore implementation. */
export function createMessagingStore(masterKey: Buffer): MessagingStore {
  return {
    async getWalletKey(userId) {
      const [user] = await db.select({
        walletEncryptedKey: users.walletEncryptedKey,
        walletAddress: users.walletAddress,
      }).from(users).where(eq(users.id, userId)).limit(1);

      if (!user?.walletEncryptedKey || !user.walletAddress) return null;
      return {
        privateKey: decryptKey(user.walletEncryptedKey, masterKey),
        walletAddress: user.walletAddress,
      };
    },

    async ensureWallet(userId) {
      const [user] = await db.select({ walletAddress: users.walletAddress })
        .from(users).where(eq(users.id, userId)).limit(1);
      if (!user) { logger.warn('[ensureWallet] User not found', { userId }); return; }
      if (user.walletAddress) return;

      const w = generateWallet(masterKey);
      await db.update(users).set({
        walletAddress: w.address,
        walletEncryptedKey: w.encryptedKey,
      }).where(eq(users.id, userId));
      logger.info('[ensureWallet] Wallet generated', { userId });
    },

    async setInboxId(userId, inboxId) {
      await db.update(users).set({ xmtpInboxId: inboxId }).where(eq(users.id, userId));
    },

    async getPublicInfo(userId) {
      const [user] = await db.select({
        walletAddress: users.walletAddress,
        xmtpInboxId: users.xmtpInboxId,
      }).from(users).where(eq(users.id, userId)).limit(1);
      return user ?? null;
    },

    async getHiddenConversations(userId) {
      return db.select({
        conversationId: hiddenConversations.conversationId,
        hiddenAt: hiddenConversations.hiddenAt,
      }).from(hiddenConversations).where(eq(hiddenConversations.userId, userId));
    },

    async getHiddenAt(userId, conversationId) {
      const [row] = await db.select({ hiddenAt: hiddenConversations.hiddenAt })
        .from(hiddenConversations)
        .where(and(
          eq(hiddenConversations.userId, userId),
          eq(hiddenConversations.conversationId, conversationId),
        ))
        .limit(1);
      return row?.hiddenAt ?? null;
    },

    async hideConversation(userId, conversationId) {
      await db.insert(hiddenConversations)
        .values({ userId, conversationId })
        .onConflictDoUpdate({
          target: [hiddenConversations.userId, hiddenConversations.conversationId],
          set: { hiddenAt: new Date() },
        });
    },

    async resolveUsersByInboxIds(inboxIds) {
      const matched = await db.select({
        id: users.id,
        name: users.name,
        avatar: users.avatar,
        xmtpInboxId: users.xmtpInboxId,
      }).from(users).where(inArray(users.xmtpInboxId, inboxIds));

      const map = new Map<string, { id: string; name: string; avatar: string | null }>();
      for (const u of matched) {
        if (u.xmtpInboxId) map.set(u.xmtpInboxId, { id: u.id, name: u.name, avatar: u.avatar });
      }
      return map;
    },
  };
}
