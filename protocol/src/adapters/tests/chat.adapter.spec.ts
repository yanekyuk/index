/**
 * Unit tests for StreamChatAdapter (ChatProvider interface implementation).
 * Uses mocked StreamChat; no real Stream server required.
 */
/** Config */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it } from 'bun:test';
import { StreamChatAdapter, createChatAdapter, getChatProvider } from '../chat.adapter';

describe('StreamChatAdapter', () => {
  describe('createChatAdapter with credentials', () => {
    it('should return a non-null adapter when apiKey and secret are provided', () => {
      const adapter = createChatAdapter('test-key', 'test-secret');
      expect(adapter).not.toBeNull();
      expect(typeof adapter.createToken).toBe('function');
      expect(typeof adapter.upsertUsers).toBe('function');
      expect(typeof adapter.queryChannels).toBe('function');
      expect(typeof adapter.channel).toBe('function');
    });

    it('should return createToken as a string', () => {
      const adapter = createChatAdapter('test-key', 'test-secret');
      const token = adapter.createToken('user-123');
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should no-op upsertUsers without throwing', async () => {
      const adapter = createChatAdapter('test-key', 'test-secret');
      const users = [{ id: 'u1', name: 'Alice', image: 'https://example.com/a.png' }];
      await expect(adapter.upsertUsers(users)).resolves.toBeUndefined();
    });

    it('should return empty array from queryChannels when client is null (no-op)', async () => {
      const adapter = new StreamChatAdapter('', '');
      const channels = await adapter.queryChannels(
        { type: 'messaging', id: 'nonexistent' },
        {},
        { state: true, watch: false }
      );
      expect(channels).toEqual([]);
    });

    it('should return a channel wrapper from channel()', () => {
      const adapter = createChatAdapter('test-key', 'test-secret');
      const ch = adapter.channel('messaging', 'dm-1', { members: ['u1', 'u2'] });
      expect(ch).not.toBeNull();
      expect(ch.id).toBe('dm-1');
      expect(typeof ch.sendMessage).toBe('function');
      expect(typeof ch.query).toBe('function');
      expect(typeof ch.updatePartial).toBe('function');
      expect(typeof ch.create).toBe('function');
    });
  });

  describe('createChatAdapter without credentials (no-op mode)', () => {
    it('should return empty string from createToken when credentials missing', () => {
      const adapter = new StreamChatAdapter('', '');
      expect(adapter.createToken('user-1')).toBe('');
    });

    it('should return empty array from queryChannels when client is null', async () => {
      const adapter = new StreamChatAdapter('', '');
      const channels = await adapter.queryChannels({ type: 'messaging' });
      expect(channels).toEqual([]);
    });

    it('should return no-op channel from channel() when client is null', () => {
      const adapter = new StreamChatAdapter('', '');
      const ch = adapter.channel('messaging', 'dm-2');
      expect(ch.id).toBe('dm-2');
      expect(ch.sendMessage({ text: 'hi' })).resolves.toBeUndefined();
      expect(ch.query({})).resolves.toEqual({ messages: [] });
      expect(ch.updatePartial({ set: {} })).resolves.toBeUndefined();
    });
  });

  describe('getChatProvider', () => {
    it('should return null when STREAM_API_KEY or STREAM_SECRET are unset', () => {
      const origKey = process.env.STREAM_API_KEY;
      const origSecret = process.env.STREAM_SECRET;
      delete process.env.STREAM_API_KEY;
      delete process.env.STREAM_SECRET;
      const provider = getChatProvider();
      expect(provider).toBeNull();
      if (origKey !== undefined) process.env.STREAM_API_KEY = origKey;
      if (origSecret !== undefined) process.env.STREAM_SECRET = origSecret;
    });
  });
});
