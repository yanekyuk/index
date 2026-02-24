import { describe, expect, it } from 'bun:test';

import { encryptKey, decryptKey, deriveDbEncryptionKey, generateWallet } from '../xmtp.crypto';

const masterKey = Buffer.from('a'.repeat(64), 'hex'); // 32-byte key

describe('encryptKey / decryptKey', () => {
  it('should round-trip a private key through encrypt and decrypt', () => {
    const original = '0xdeadbeef1234567890abcdef';
    const encrypted = encryptKey(original, masterKey);
    const decrypted = decryptKey(encrypted, masterKey);
    expect(decrypted).toBe(original);
  });

  it('should produce iv:tag:ciphertext format', () => {
    const encrypted = encryptKey('some-key', masterKey);
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    // IV is 12 bytes = 24 hex chars
    expect(parts[0]).toHaveLength(24);
    // Auth tag is 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // Ciphertext is non-empty
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it('should produce different ciphertexts for the same input (random IV)', () => {
    const key = '0xsomePrivateKey';
    const enc1 = encryptKey(key, masterKey);
    const enc2 = encryptKey(key, masterKey);
    expect(enc1).not.toBe(enc2);
    // Both should decrypt to the same value
    expect(decryptKey(enc1, masterKey)).toBe(key);
    expect(decryptKey(enc2, masterKey)).toBe(key);
  });

  it('should fail to decrypt with a different master key', () => {
    const encrypted = encryptKey('secret', masterKey);
    const wrongKey = Buffer.from('b'.repeat(64), 'hex');
    expect(() => decryptKey(encrypted, wrongKey)).toThrow();
  });

  it('should fail to decrypt a tampered ciphertext', () => {
    const encrypted = encryptKey('secret', masterKey);
    const parts = encrypted.split(':');
    // Tamper with last hex char of ciphertext
    const lastChar = parts[2].charAt(parts[2].length - 1);
    const tampered = parts[2].slice(0, -1) + (lastChar === '0' ? '1' : '0');
    const tamperedBlob = `${parts[0]}:${parts[1]}:${tampered}`;
    expect(() => decryptKey(tamperedBlob, masterKey)).toThrow();
  });
});

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

describe('generateWallet', () => {
  it('should return an address and encrypted key', () => {
    const wallet = generateWallet(masterKey);
    expect(wallet.address).toBeDefined();
    expect(wallet.encryptedKey).toBeDefined();
  });

  it('should return a valid Ethereum address (0x prefix, 42 chars)', () => {
    const wallet = generateWallet(masterKey);
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('should produce a decryptable encrypted key', () => {
    const wallet = generateWallet(masterKey);
    const privateKey = decryptKey(wallet.encryptedKey, masterKey);
    // Private keys from viem start with 0x
    expect(privateKey.startsWith('0x')).toBe(true);
  });

  it('should generate unique wallets on each call', () => {
    const w1 = generateWallet(masterKey);
    const w2 = generateWallet(masterKey);
    expect(w1.address).not.toBe(w2.address);
  });
});
