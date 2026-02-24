import { Client } from '@xmtp/node-sdk';
import { mkdirSync } from 'fs';
import path from 'path';

import { createSigner, createXmtpClient, findDm, createDm, deriveDbEncryptionKey, type XmtpEnv } from '../lib/xmtp';
import type { MessagingStore } from '../lib/xmtp';
import { log } from '../lib/log';

const logger = log.lib.from('messaging.adapter');

export interface MessagingAdapterConfig {
  xmtpEnv: XmtpEnv;
  xmtpDbDir: string;
  walletMasterKey: Buffer;
}

/**
 * Messaging adapter wrapping XMTP SDK operations.
 * Receives a MessagingStore for database access via constructor injection.
 */
export class MessagingAdapter {
  private readonly userClients = new Map<string, Client>();

  constructor(
    private readonly store: MessagingStore,
    private readonly config: MessagingAdapterConfig,
  ) {
    mkdirSync(config.xmtpDbDir, { recursive: true });
  }

  /** Get the MessagingStore (for service-layer access to store methods). */
  getStore(): MessagingStore {
    return this.store;
  }

  /**
   * Get or create an XMTP client for a user. Caches per userId.
   * @param userId - The user to get or create a client for.
   * @returns The XMTP Client, or null if no wallet could be obtained.
   */
  async getUserClient(userId: string): Promise<Client | null> {
    const cached = this.userClients.get(userId);
    if (cached) return cached;

    let keys = await this.store.getWalletKey(userId);
    if (!keys) {
      await this.store.ensureWallet(userId);
      keys = await this.store.getWalletKey(userId);
      if (!keys) {
        logger.warn('[getUserClient] No wallet found after generation', { userId });
        return null;
      }
    }

    const signer = createSigner(keys.privateKey as `0x${string}`);
    const dbEncryptionKey = deriveDbEncryptionKey(userId, this.config.walletMasterKey);
    const { xmtpEnv, xmtpDbDir } = this.config;

    const client = await createXmtpClient(
      signer,
      dbEncryptionKey,
      xmtpEnv,
      (inboxId) => path.join(xmtpDbDir, `${xmtpEnv}-${inboxId}`),
    );

    await this.store.setInboxId(userId, client.inboxId);
    this.userClients.set(userId, client);
    logger.info('[getUserClient] Created client', { userId, inboxId: client.inboxId });
    return client;
  }

  /**
   * Evict a cached XMTP client.
   * @param userId - The user whose client should be evicted from the cache.
   */
  evictUserClient(userId: string): void {
    this.userClients.delete(userId);
  }

  /**
   * Find an existing DM between two users.
   * @param userAId - The initiating user.
   * @param userBId - The peer user.
   * @returns Conversation ID or null if no DM exists.
   */
  async findExistingDm(userAId: string, userBId: string): Promise<string | null> {
    const peerInfo = await this.store.getPublicInfo(userBId);
    if (!peerInfo?.xmtpInboxId) return null;

    const client = await this.getUserClient(userAId);
    if (!client) return null;

    return findDm(client, peerInfo.xmtpInboxId);
  }

  /**
   * Get or create a DM between two users. Ensures peer has a wallet.
   * @param userAId - The initiating user.
   * @param userBId - The peer user.
   * @returns Conversation ID or null if DM could not be created.
   */
  async getOrCreateDm(userAId: string, userBId: string): Promise<string | null> {
    await this.store.ensureWallet(userBId);
    let peerInfo = await this.store.getPublicInfo(userBId);

    if (!peerInfo?.xmtpInboxId) {
      const peerClient = await this.getUserClient(userBId);
      if (!peerClient) {
        logger.warn('[getOrCreateDm] Could not create peer client', { userBId });
        return null;
      }
      peerInfo = await this.store.getPublicInfo(userBId);
    }

    if (!peerInfo?.xmtpInboxId) {
      logger.warn('[getOrCreateDm] Peer has no inbox ID', { userBId });
      return null;
    }

    const client = await this.getUserClient(userAId);
    if (!client) return null;

    const dmId = await createDm(client, peerInfo.xmtpInboxId);
    logger.info('[getOrCreateDm] DM ready', { dmId, userAId, userBId });
    return dmId;
  }
}
