import { Client, type Signer, isText } from '@xmtp/node-sdk';
import { toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export type XmtpEnv = 'dev' | 'production' | 'local';

/**
 * Create an XMTP Signer from an Ethereum private key.
 * @param privateKey - Hex-encoded Ethereum private key (0x-prefixed).
 * @returns A Signer compatible with the XMTP SDK.
 */
export function createSigner(privateKey: `0x${string}`): Signer {
  const account = privateKeyToAccount(privateKey);
  return {
    type: 'EOA' as const,
    getIdentifier: () => ({
      identifier: account.address.toLowerCase(),
      identifierKind: 0 as const,
    }),
    signMessage: async (message: string) => {
      const sig = await account.signMessage({ message });
      return toBytes(sig);
    },
  };
}

/**
 * Create and return an XMTP Client instance.
 * @param signer - XMTP-compatible signer for the user's wallet.
 * @param dbEncryptionKey - 32-byte key for encrypting the local XMTP database.
 * @param env - XMTP network environment.
 * @param dbPath - Function that maps an inbox ID to a local database file path.
 * @returns A fully initialized XMTP Client.
 */
export async function createXmtpClient(
  signer: Signer,
  dbEncryptionKey: Uint8Array,
  env: XmtpEnv,
  dbPath: (inboxId: string) => string,
): Promise<Client> {
  return Client.create(signer, { env, dbEncryptionKey, dbPath });
}

/**
 * Find an existing DM conversation by peer inbox ID.
 * @param client - An initialized XMTP Client.
 * @param peerInboxId - The XMTP inbox ID of the peer.
 * @returns The conversation ID if found, or null.
 */
export async function findDm(client: Client, peerInboxId: string): Promise<string | null> {
  await client.conversations.syncAll();
  const dm = await client.conversations.getDmByInboxId(peerInboxId);
  return dm?.id ?? null;
}

/**
 * Create a DM conversation with a peer.
 * @param client - An initialized XMTP Client.
 * @param peerInboxId - The XMTP inbox ID of the peer.
 * @returns The newly created conversation ID.
 */
export async function createDm(client: Client, peerInboxId: string): Promise<string> {
  await client.conversations.syncAll();
  const dm = await client.conversations.createDm(peerInboxId);
  return dm.id;
}

/**
 * Extract text content from an XMTP message.
 * @param msg - A decoded XMTP message object.
 * @returns The text content, or an empty string if not a text message.
 */
export function extractText(msg: { content: unknown }): string {
  if (isText(msg as any)) return msg.content as string;
  if (typeof msg.content === 'string') return msg.content;
  return '';
}
