import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';
import { eq } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { users } from '../schemas/database.schema';
import { log } from '../lib/log';

const logger = log.lib.from('wallet.service');

function getMasterKey(): Buffer {
  const hex = process.env.WALLET_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('WALLET_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptKey(privateKey: string): string {
  const master = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', master, iv);
  const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptKey(blob: string): string {
  const master = getMasterKey();
  const [ivHex, tagHex, encHex] = blob.split(':');
  const decipher = createDecipheriv('aes-256-gcm', master, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}

export function deriveDbEncryptionKey(userId: string, context: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', getMasterKey(), userId, context, 32));
}

export function getUserDbEncryptionKey(userId: string): Uint8Array {
  return deriveDbEncryptionKey(userId, 'user-xmtp-db');
}

interface GeneratedWallet {
  address: string;
  encryptedKey: string;
}

function generateWallet(): GeneratedWallet {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    encryptedKey: encryptKey(privateKey),
  };
}

export async function ensureUserWallets(userId: string): Promise<void> {
  const [user] = await db.select({
    walletAddress: users.walletAddress,
  }).from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    logger.warn('[ensureUserWallets] User not found', { userId });
    return;
  }

  if (user.walletAddress) return;

  const w = generateWallet();
  await db.update(users).set({
    walletAddress: w.address,
    walletEncryptedKey: w.encryptedKey,
  }).where(eq(users.id, userId));
  logger.info('[ensureUserWallets] Wallet generated', { userId });
}

export async function getUserWalletKey(userId: string): Promise<{
  privateKey: string;
  walletAddress: string;
} | null> {
  const [user] = await db.select({
    walletEncryptedKey: users.walletEncryptedKey,
    walletAddress: users.walletAddress,
  }).from(users).where(eq(users.id, userId)).limit(1);

  if (!user?.walletEncryptedKey || !user.walletAddress) return null;

  return {
    privateKey: decryptKey(user.walletEncryptedKey),
    walletAddress: user.walletAddress,
  };
}

export async function getPublicXmtpInfo(userId: string): Promise<{
  walletAddress: string | null;
  xmtpInboxId: string | null;
} | null> {
  const [user] = await db.select({
    walletAddress: users.walletAddress,
    xmtpInboxId: users.xmtpInboxId,
  }).from(users).where(eq(users.id, userId)).limit(1);

  return user ?? null;
}

export async function setXmtpInboxId(userId: string, inboxId: string): Promise<void> {
  await db.update(users).set({ xmtpInboxId: inboxId }).where(eq(users.id, userId));
}
