import { hkdfSync } from 'node:crypto';

/**
 * Derive a 32-byte XMTP DB encryption key via HKDF-SHA256.
 * @param userId - User identifier used as the HKDF salt.
 * @param masterKey - 32-byte master encryption key.
 * @returns A 32-byte derived key as Uint8Array.
 */
export function deriveDbEncryptionKey(userId: string, masterKey: Buffer): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', masterKey, userId, 'user-xmtp-db', 32));
}
