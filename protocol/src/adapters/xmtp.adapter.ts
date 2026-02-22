import { Client, type Signer } from '@xmtp/node-sdk';
import { toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  getUserWalletKey, getUserDbEncryptionKey,
  getPublicXmtpInfo, setXmtpInboxId,
  ensureUserWallets,
} from '../services/wallet.service';
import { log } from '../lib/log';

const logger = log.lib.from('xmtp.adapter');

const XMTP_ENV = (process.env.XMTP_ENV as 'dev' | 'production' | 'local') || 'dev';

function createSignerFromKey(privateKey: `0x${string}`): Signer {
  const account = privateKeyToAccount(privateKey);
  return {
    type: 'EOA' as const,
    getIdentifier: () => ({
      identifier: account.address.toLowerCase(),
      identifierKind: 0 as const, // IdentifierKind.Ethereum
    }),
    signMessage: async (message: string) => {
      const sig = await account.signMessage({ message });
      return toBytes(sig);
    },
  };
}

// ─── Client cache ───────────────────────────────────────────────────────────

const userClients = new Map<string, Client>();

export async function getUserClient(userId: string): Promise<Client | null> {
  const cached = userClients.get(userId);
  if (cached) return cached;

  let keys = await getUserWalletKey(userId);
  if (!keys) {
    await ensureUserWallets(userId);
    keys = await getUserWalletKey(userId);
    if (!keys) {
      logger.warn('[getUserClient] No user wallet found after generation', { userId });
      return null;
    }
  }

  const signer = createSignerFromKey(keys.privateKey as `0x${string}`);
  const dbEncryptionKey = getUserDbEncryptionKey(userId);
  const client = await Client.create(signer, { env: XMTP_ENV, dbEncryptionKey });

  await setXmtpInboxId(userId, client.inboxId);
  userClients.set(userId, client);
  logger.info('[getUserClient] Created user client', { userId, inboxId: client.inboxId });
  return client;
}

export function evictUserClient(userId: string): void {
  userClients.delete(userId);
}

// ─── DM operations ──────────────────────────────────────────────────────────

export async function findExistingDm(
  userAId: string,
  userBId: string,
): Promise<string | null> {
  const peerInfo = await getPublicXmtpInfo(userBId);
  if (!peerInfo?.xmtpInboxId) return null;

  const client = await getUserClient(userAId);
  if (!client) return null;

  await client.conversations.syncAll();
  const dm = await client.conversations.getDmByInboxId(peerInfo.xmtpInboxId);
  return dm?.id ?? null;
}

export async function getOrCreateDm(
  userAId: string,
  userBId: string,
): Promise<string | null> {
  // Ensure peer has a wallet/client so their inboxId is populated
  await ensureUserWallets(userBId);
  let peerInfo = await getPublicXmtpInfo(userBId);
  if (!peerInfo?.xmtpInboxId) {
    const peerClient = await getUserClient(userBId);
    if (!peerClient) {
      logger.warn('[getOrCreateDm] Could not create peer client', { userBId });
      return null;
    }
    peerInfo = await getPublicXmtpInfo(userBId);
  }
  if (!peerInfo?.xmtpInboxId) {
    logger.warn('[getOrCreateDm] Peer has no inbox ID', { userBId });
    return null;
  }

  const client = await getUserClient(userAId);
  if (!client) return null;

  await client.conversations.syncAll();
  const dm = await client.conversations.createDm(peerInfo.xmtpInboxId);
  logger.info('[getOrCreateDm] DM ready', { dmId: dm.id, userAId, userBId });
  return dm.id;
}
