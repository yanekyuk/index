import { Client } from '@xmtp/node-sdk';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';

import { createSigner, createXmtpClient, findDm, createDm, deriveDbEncryptionKey, type XmtpEnv } from '../lib/xmtp';
import type { MessagingStore } from '../lib/xmtp';
import { log } from '../lib/log';

const logger = log.lib.from('messaging.adapter');

/** SQLCipher error when DB was created with a different key (e.g. WALLET_ENCRYPTION_KEY or userId changed). */
const PRAGMA_KEY_ERROR = 'PRAGMA key or salt has incorrect value';

/** XMTP network error when inbox has 10/10 installations and a new one cannot be registered. */
const INSTALLATION_LIMIT_ERROR = 'already registered 10/10 installations';

function isPragmaKeyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes(PRAGMA_KEY_ERROR);
}

function isInstallationLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes(INSTALLATION_LIMIT_ERROR) || msg.includes('Please revoke existing installations');
}

/** Extract inbox ID from the installation-limit error message if present (e.g. "InboxID <hex> has already..."). */
function parseInboxIdFromError(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/InboxID\s+([a-fA-F0-9]{64})\s+has\s+already/);
  return match?.[1] ?? null;
}

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
   * Create XMTP client; on 10/10 installation limit, revoke all installations and retry once.
   *
   * @remarks We revoke every installation (not just surplus) because client creation has already
   * failed—there is no active client to preserve. Revoking all plus deleting the local DB ensures
   * the retry creates a new installation ID and avoids "Replay detected" from re-publishing the
   * same identity update. In multi-instance deployments this invalidates all other active clients
   * for this inbox until they re-register; that trade-off is accepted for single-server and
   * dev flows.
   *
   * @param signer - Signer for the user's wallet.
   * @param dbEncryptionKey - Derived DB encryption key.
   * @param xmtpEnv - XMTP environment.
   * @param dbPathForInbox - DB path function.
   * @param userId - User ID (used to resolve inboxId for static revoke).
   */
  private async createClientWithInstallationRecovery(
    signer: ReturnType<typeof createSigner>,
    dbEncryptionKey: Uint8Array,
    xmtpEnv: XmtpEnv,
    dbPathForInbox: (inboxId: string) => string,
    userId: string,
  ): Promise<Client> {
    try {
      return await createXmtpClient(signer, dbEncryptionKey, xmtpEnv, dbPathForInbox);
    } catch (err) {
      if (!isInstallationLimitError(err)) throw err;

      const publicInfo = await this.store.getPublicInfo(userId);
      const inboxId = publicInfo?.xmtpInboxId ?? parseInboxIdFromError(err);
      if (!inboxId) {
        logger.error('[getUserClient] Installation limit and could not resolve inboxId', {
          userId,
        });
        throw new Error(
          'Messaging unavailable: XMTP installation limit reached. Please revoke existing installations at xmtp.chat/inbox-tools or contact support.',
        );
      }

      const states = await Client.fetchInboxStates([inboxId], xmtpEnv);
      if (!states[0]?.installations?.length) {
        throw err;
      }
      const toRevoke = states[0].installations.map((i) => i.bytes);
      await Client.revokeInstallations(signer, inboxId, toRevoke, xmtpEnv);
      logger.info('[getUserClient] Revoked all XMTP installations after limit hit', {
        userId,
        inboxId,
        count: toRevoke.length,
      });

      // Remove local DB so the next create generates a new installation ID. Otherwise the SDK
      // reopens the same DB, reuses the same installation, and PublishIdentityUpdate is rejected
      // as "Replay detected".
      const dbPath = dbPathForInbox(inboxId);
      const saltPath = `${dbPath}.sqlcipher_salt`;
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
        logger.info('[getUserClient] Removed local XMTP DB after revoke to avoid replay', {
          userId,
          dbPath,
        });
      }
      if (existsSync(saltPath)) {
        unlinkSync(saltPath);
      }

      return await createXmtpClient(signer, dbEncryptionKey, xmtpEnv, dbPathForInbox);
    }
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
    const dbPathForInbox = (inboxId: string) => path.join(xmtpDbDir, `${xmtpEnv}-${inboxId}`);

    let client: Client;
    try {
      client = await this.createClientWithInstallationRecovery(
        signer,
        dbEncryptionKey,
        xmtpEnv,
        dbPathForInbox,
        userId,
      );
    } catch (err) {
      if (!isPragmaKeyError(err)) throw err;

      const publicInfo = await this.store.getPublicInfo(userId);
      const inboxId = publicInfo?.xmtpInboxId ?? null;
      if (!inboxId) {
        logger.error('[getUserClient] XMTP DB key mismatch and no stored inboxId', { userId });
        throw new Error(
          'Messaging unavailable: XMTP database was created with a different encryption key. ' +
            'Ensure WALLET_ENCRYPTION_KEY has not changed, or contact support.',
        );
      }

      const dbPath = dbPathForInbox(inboxId);
      const saltPath = `${dbPath}.sqlcipher_salt`;
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
        logger.info('[getUserClient] Removed stale XMTP DB after key mismatch', { userId, dbPath });
      }
      if (existsSync(saltPath)) {
        unlinkSync(saltPath);
      }

      client = await this.createClientWithInstallationRecovery(
        signer,
        dbEncryptionKey,
        xmtpEnv,
        dbPathForInbox,
        userId,
      );
    }

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
