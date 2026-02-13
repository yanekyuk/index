/**
 * Stream Chat implementation of the ChatProvider interface.
 * This is the only file in the protocol that imports stream-chat.
 * No dependency on lib/protocol; local types align with chat.interface.ts for structural compatibility.
 */

import { StreamChat } from 'stream-chat';
import type { Channel } from 'stream-chat';
import { log } from '../lib/log';

const logger = log.lib.from('chat.adapter');

// ─────────────────────────────────────────────────────────────────────────────
// Local types (align with lib/protocol/interfaces/chat.interface.ts)
// ─────────────────────────────────────────────────────────────────────────────

interface ChatUser {
  id: string;
  name?: string;
  image?: string;
}

interface ChatMessage {
  text?: string;
  type?: string;
  user_id?: string;
  [key: string]: unknown;
}

interface ChatChannelData {
  members?: string[];
  pending?: boolean;
  created_by_id?: string;
  [key: string]: unknown;
}

interface ChatChannel {
  id: string;
  sendMessage(message: ChatMessage): Promise<void>;
  query(options: Record<string, unknown>): Promise<{ messages: ChatMessage[] }>;
  updatePartial(update: { set?: Record<string, unknown>; unset?: string[] }): Promise<void>;
  create?(): Promise<void>;
  data?: Record<string, unknown>;
  state?: { messages?: unknown[] };
}

/**
 * Wraps a Stream SDK Channel to implement the ChatChannel shape.
 */
class StreamChatChannelWrapper implements ChatChannel {
  constructor(private readonly streamChannel: Channel) {}

  get id(): string {
    return this.streamChannel.id ?? '';
  }

  get data(): Record<string, unknown> | undefined {
    return this.streamChannel.data as Record<string, unknown> | undefined;
  }

  get state(): { messages?: unknown[] } | undefined {
    const state = (this.streamChannel as { state?: { messages?: unknown[] } }).state;
    return state ? { messages: state.messages } : undefined;
  }

  async sendMessage(message: ChatMessage): Promise<void> {
    await this.streamChannel.sendMessage(message as Parameters<Channel['sendMessage']>[0]);
  }

  async query(options: Record<string, unknown>): Promise<{ messages: ChatMessage[] }> {
    const result = await this.streamChannel.query(options as Parameters<Channel['query']>[0]);
    const messages = (result.messages ?? []) as unknown as ChatMessage[];
    return { messages };
  }

  async updatePartial(update: {
    set?: Record<string, unknown>;
    unset?: string[];
  }): Promise<void> {
    await (this.streamChannel as { updatePartial: (arg: unknown) => Promise<unknown> }).updatePartial(
      update as { set?: Record<string, unknown>; unset?: string[] }
    );
  }

  async create(): Promise<void> {
    await (this.streamChannel as { create: () => Promise<unknown> }).create();
  }
}

/**
 * Stream Chat adapter. Structurally compatible with ChatProvider from chat.interface.ts.
 * When apiKey or secret are missing, methods no-op or return empty values.
 */
export class StreamChatAdapter {
  private readonly client: StreamChat | null;

  constructor(apiKey?: string, secret?: string) {
    const key = apiKey ?? process.env.STREAM_API_KEY;
    const sec = secret ?? process.env.STREAM_SECRET;
    if (key && sec) {
      this.client = StreamChat.getInstance(key, sec);
    } else {
      this.client = null;
    }
  }

  createToken(userId: string): string {
    if (!this.client) return '';
    return this.client.createToken(userId);
  }

  async upsertUsers(users: ChatUser[]): Promise<void> {
    if (!this.client || users.length === 0) return;
    const payload = users.map((u) => ({
      id: u.id,
      name: u.name?.trim() || 'Unknown',
      image: u.image?.trim() || undefined,
    }));
    try {
      await this.client.upsertUsers(payload);
    } catch (error) {
      logger.warn('[upsertUsers] Failed to upsert users', { userIds: users.map((u) => u.id), error });
    }
  }

  async queryChannels(
    filter: Record<string, unknown>,
    sort?: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<ChatChannel[]> {
    if (!this.client) return [];
    const channels = await this.client.queryChannels(
      filter as Parameters<StreamChat['queryChannels']>[0],
      sort ?? {},
      options ?? {}
    );
    return channels.map((c) => new StreamChatChannelWrapper(c as Channel));
  }

  channel(type: string, id: string, data?: ChatChannelData): ChatChannel {
    if (!this.client) {
      return new NoOpChatChannel(id);
    }
    const streamChannel = this.client.channel(
      type,
      id,
      data as Record<string, unknown>
    ) as Channel;
    return new StreamChatChannelWrapper(streamChannel);
  }
}

/**
 * No-op channel when Stream is not configured.
 */
class NoOpChatChannel implements ChatChannel {
  constructor(public readonly id: string) {}

  async sendMessage(): Promise<void> {
    logger.warn('[NoOpChatChannel] sendMessage called but Stream is not configured');
  }

  async query(): Promise<{ messages: ChatMessage[] }> {
    return { messages: [] };
  }

  async updatePartial(): Promise<void> {
    logger.warn('[NoOpChatChannel] updatePartial called but Stream is not configured');
  }
}

let _instance: StreamChatAdapter | null = null;

/**
 * Returns the singleton Stream Chat adapter, or null when STREAM_API_KEY / STREAM_SECRET are not set.
 * Return type is structurally compatible with ChatProvider (see chat.interface.ts).
 */
export function getChatProvider(): StreamChatAdapter | null {
  if (_instance !== null) return _instance;
  const apiKey = process.env.STREAM_API_KEY;
  const secret = process.env.STREAM_SECRET;
  if (!apiKey || !secret) return null;
  _instance = new StreamChatAdapter(apiKey, secret);
  return _instance;
}

/**
 * Create a ChatProvider instance (for tests or explicit wiring).
 * When credentials are omitted, reads from env; returns an adapter that may no-op when env is unset.
 */
export function createChatAdapter(apiKey?: string, secret?: string): StreamChatAdapter {
  return new StreamChatAdapter(apiKey, secret);
}
