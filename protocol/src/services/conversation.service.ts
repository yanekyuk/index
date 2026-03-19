import { conversationDatabaseAdapter, ConversationDatabaseAdapter } from '../adapters/database.adapter';

/**
 * Manages conversation lifecycle, messaging, and DM deduplication.
 * @remarks Delegates all persistence to ConversationDatabaseAdapter. Does not call other services.
 */
export class ConversationService {
  constructor(private db: ConversationDatabaseAdapter = conversationDatabaseAdapter) {}

  /**
   * Creates a new conversation with the given participants.
   * @param participants - List of participant descriptors (user or agent)
   * @returns The newly created conversation
   */
  async createConversation(participants: { participantId: string; participantType: 'user' | 'agent' }[]) {
    return this.db.createConversation(participants);
  }

  /**
   * Retrieves a conversation by ID, including its participants.
   * @param conversationId - Conversation ID
   * @returns The conversation with participants, or null if not found
   */
  async getConversation(conversationId: string) {
    return this.db.getConversation(conversationId);
  }

  /**
   * Lists all visible conversations for a user, ordered by most recent message.
   * @param userId - The user whose conversations to list
   * @returns Summaries with participant lists
   */
  async getConversations(userId: string) {
    return this.db.getConversationsForUser(userId);
  }

  /**
   * Finds an existing DM between two users, or creates one if none exists.
   * @param userA - First user ID
   * @param userB - Second user ID
   * @returns The existing or newly created conversation
   */
  async getOrCreateDM(userA: string, userB: string) {
    return this.db.getOrCreateDM(userA, userB);
  }

  /**
   * Sends a message in a conversation.
   * @param conversationId - Conversation ID
   * @param senderId - ID of the sender
   * @param role - Role of the sender ('user' or 'agent')
   * @param parts - Message content parts
   * @param opts - Optional task association and metadata
   * @returns The created message
   */
  async sendMessage(
    conversationId: string,
    senderId: string,
    role: 'user' | 'agent',
    parts: unknown[],
    opts?: { taskId?: string; metadata?: Record<string, unknown> },
  ) {
    return this.db.createMessage({
      conversationId,
      senderId,
      role,
      parts,
      taskId: opts?.taskId,
      metadata: opts?.metadata,
    });
  }

  /**
   * Retrieves messages for a conversation.
   * @param conversationId - Conversation ID
   * @param opts - Optional limit, cursor (before), or taskId filter
   * @returns Ordered list of messages
   */
  async getMessages(conversationId: string, opts?: { limit?: number; before?: string; taskId?: string }) {
    return this.db.getMessages(conversationId, opts);
  }

  /**
   * Hides a conversation for a specific user by setting hiddenAt.
   * @param userId - The user hiding the conversation
   * @param conversationId - Conversation ID
   */
  async hideConversation(userId: string, conversationId: string) {
    return this.db.hideConversation(userId, conversationId);
  }

  /**
   * Upserts arbitrary JSON metadata on a conversation.
   * @param conversationId - Conversation ID
   * @param metadata - Metadata to store
   */
  async updateMetadata(conversationId: string, metadata: Record<string, unknown>) {
    return this.db.upsertMetadata(conversationId, metadata);
  }
}
