/**
 * Chat provider interface for protocol layer.
 * Implementations live in src/adapters (e.g. Stream Chat).
 */

export const INDEX_BOT_USER_ID = 'index_bot';
export const INDEX_BOT_NAME = 'Index';

export interface ChatUser {
  id: string;
  name?: string;
  image?: string;
}

export interface ChatMessage {
  text?: string;
  type?: string;
  user_id?: string;
  [key: string]: unknown;
}

export interface ChatChannelData {
  members?: string[];
  pending?: boolean;
  created_by_id?: string;
  [key: string]: unknown;
}

export interface ChatChannel {
  id: string;
  sendMessage(message: ChatMessage): Promise<void>;
  query(options: Record<string, unknown>): Promise<{ messages: ChatMessage[] }>;
  updatePartial(update: { set?: Record<string, unknown>; unset?: string[] }): Promise<void>;
  /** Create the channel (e.g. when first creating a DM). No-op if already exists. */
  create?(): Promise<void>;
  /** Channel-level custom data (e.g. introOpportunityIds). Set when loaded with state. */
  data?: Record<string, unknown>;
  /** State (e.g. messages) when channel was loaded with state. */
  state?: { messages?: unknown[] };
}

export interface ChatProvider {
  /** Create an auth token for a user */
  createToken(userId: string): string;

  /** Upsert one or more users so they exist before channel creation */
  upsertUsers(users: ChatUser[]): Promise<void>;

  /** Query channels matching filters */
  queryChannels(
    filter: Record<string, unknown>,
    sort?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<ChatChannel[]>;

  /** Get or create a channel by type and id */
  channel(type: string, id: string, data?: ChatChannelData): ChatChannel;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NARROWED CHAT PROVIDER INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/** Chat provider for opportunity service (users, channels, no token). */
export type OpportunityChatProvider = Pick<
  ChatProvider,
  'upsertUsers' | 'queryChannels' | 'channel'
>;

/** Chat provider for chat controller (token, user upsert). */
export type ChatControllerChatProvider = Pick<ChatProvider, 'createToken' | 'upsertUsers'>;
