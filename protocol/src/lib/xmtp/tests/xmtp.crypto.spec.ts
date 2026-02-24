import { describe, expect, it } from 'bun:test';

import { deriveDbEncryptionKey } from '../xmtp.crypto';

const masterKey = Buffer.from('a'.repeat(64), 'hex'); // 32-byte key

describe('deriveDbEncryptionKey', () => {
  it('should return a 32-byte Uint8Array', () => {
    const key = deriveDbEncryptionKey('user-123', masterKey);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('should produce deterministic output for the same inputs', () => {
    const key1 = deriveDbEncryptionKey('user-123', masterKey);
    const key2 = deriveDbEncryptionKey('user-123', masterKey);
    expect(key1).toEqual(key2);
  });

  it('should produce different keys for different user IDs', () => {
    const key1 = deriveDbEncryptionKey('user-a', masterKey);
    const key2 = deriveDbEncryptionKey('user-b', masterKey);
    expect(key1).not.toEqual(key2);
  });

  it('should produce different keys for different master keys', () => {
    const otherMaster = Buffer.from('c'.repeat(64), 'hex');
    const key1 = deriveDbEncryptionKey('user-123', masterKey);
    const key2 = deriveDbEncryptionKey('user-123', otherMaster);
    expect(key1).not.toEqual(key2);
  });
});
