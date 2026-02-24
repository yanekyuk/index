import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';

/**
 * Encrypt a private key with AES-256-GCM.
 * @param privateKey - The raw private key string to encrypt.
 * @param masterKey - 32-byte master encryption key.
 * @returns `iv:tag:ciphertext` hex string.
 */
export function encryptKey(privateKey: string, masterKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an `iv:tag:ciphertext` blob back to the private key.
 * @param blob - The encrypted blob in `iv:tag:ciphertext` hex format.
 * @param masterKey - 32-byte master encryption key (must match the one used for encryption).
 * @returns The decrypted private key string.
 */
export function decryptKey(blob: string, masterKey: Buffer): string {
  const [ivHex, tagHex, encHex] = blob.split(':');
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}

/**
 * Derive a 32-byte XMTP DB encryption key via HKDF-SHA256.
 * @param userId - User identifier used as the HKDF salt.
 * @param masterKey - 32-byte master encryption key.
 * @returns A 32-byte derived key as Uint8Array.
 */
export function deriveDbEncryptionKey(userId: string, masterKey: Buffer): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', masterKey, userId, 'user-xmtp-db', 32));
}

/**
 * Generate a new Ethereum wallet.
 * @param masterKey - 32-byte master encryption key used to encrypt the generated private key.
 * @returns The wallet address and the encrypted private key.
 */
export function generateWallet(masterKey: Buffer): { address: string; encryptedKey: string } {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    encryptedKey: encryptKey(privateKey, masterKey),
  };
}
