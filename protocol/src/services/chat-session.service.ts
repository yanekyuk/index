import db from '../lib/drizzle/drizzle';
import { chatSessions, chatMessages } from '../schemas/database.schema';
import { eq, desc } from 'drizzle-orm';
import { log } from '../lib/log';

const logger = log.service.from("ChatSessionService");

/**
 * Generates a Snowflake-like ID for chat messages.
 * Uses timestamp + random component for sortable, unique IDs.
 * Format: timestamp (42 bits) + random (22 bits)
 */
function generateSnowflakeId(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 4194304); // 2^22
  const snowflake = BigInt(timestamp) * BigInt(4194304) + BigInt(random);
  return snowflake.toString();
}

/**
 * ChatSessionService
 * 
 * Manages chat sessions and messages for the Chat Graph streaming infrastructure.
 * 
 * CONTEXT:
 * - Chat sessions are persistent conversations between a user and the system
 * - Each session contains multiple messages with role-based attribution
 * - Messages can store routing decisions and subgraph results for debugging
 */
export class ChatSessionService {
  /**
   * Create a new chat session for a user.
   *
   * @param userId - The user's UUID
   * @param title - Optional title for the session
   * @param indexId - Optional index (community) ID to scope the conversation
   * @returns The created session ID
   */
  async createSession(userId: string, title?: string, indexId?: string): Promise<string> {
    logger.info('Creating new session', { userId, title, indexId: indexId ?? undefined });

    const id = crypto.randomUUID();
    await db.insert(chatSessions).values({
      id,
      userId,
      title,
      indexId: indexId?.trim() || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return id;
  }

  /**
   * Update the index scope for a session. Validates ownership.
   *
   * @param sessionId - The session ID
   * @param userId - The user ID to validate ownership
   * @param indexId - The index ID to set, or undefined to clear
   * @returns True if updated, false if not found or unauthorized
   */
  async updateSessionIndex(sessionId: string, userId: string, indexId: string | undefined): Promise<boolean> {
    const session = await this.getSession(sessionId, userId);
    if (!session) {
      return false;
    }

    await db
      .update(chatSessions)
      .set({ indexId: indexId?.trim() || null, updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));

    logger.info('Session index updated', { sessionId, indexId: indexId ?? null });
    return true;
  }

  /**
   * Get a session by ID, validating ownership.
   * 
   * @param sessionId - The session ID
   * @param userId - The user ID to validate ownership
   * @returns The session if found and owned by user, null otherwise
   */
  async getSession(sessionId: string, userId: string) {
    logger.info('Getting session', { sessionId, userId });
    
    const [session] = await db.select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);
    
    if (!session || session.userId !== userId) {
      logger.warn('Session not found or unauthorized', { sessionId, userId });
      return null;
    }
    
    return session;
  }

  /**
   * Get all sessions for a user, ordered by most recent.
   * 
   * @param userId - The user's UUID
   * @param limit - Maximum number of sessions to return (default: 20)
   * @returns List of sessions
   */
  async getUserSessions(userId: string, limit = 20) {
    logger.info('Getting user sessions', { userId, limit });
    
    return db.select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(limit);
  }

  /**
   * Add a message to a session.
   * 
   * @param params - Message parameters
   * @returns The created message ID (snowflake format)
   */
  async addMessage(params: {
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    routingDecision?: Record<string, unknown>;
    subgraphResults?: Record<string, unknown>;
    tokenCount?: number;
  }): Promise<string> {
    logger.info('Adding message', {
      sessionId: params.sessionId,
      role: params.role,
      contentLength: params.content.length,
    });
    
    const id = generateSnowflakeId();
    
    await db.insert(chatMessages).values({
      id,
      sessionId: params.sessionId,
      role: params.role,
      content: params.content,
      routingDecision: params.routingDecision,
      subgraphResults: params.subgraphResults,
      tokenCount: params.tokenCount,
      createdAt: new Date(),
    });
    
    // Update session timestamp
    await db.update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, params.sessionId));
    
    return id;
  }

  /**
   * Get messages for a session in chronological order.
   * 
   * @param sessionId - The session ID
   * @param limit - Maximum number of messages to return (default: 50)
   * @returns List of messages
   */
  async getSessionMessages(sessionId: string, limit = 50) {
    logger.info('Getting session messages', { sessionId, limit });
    
    return db.select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt)
      .limit(limit);
  }

  /**
   * Delete a session and all its messages (cascade).
   * 
   * @param sessionId - The session ID to delete
   * @param userId - The user ID to validate ownership
   * @returns True if deleted, false if not found or unauthorized
   */
  async deleteSession(sessionId: string, userId: string): Promise<boolean> {
    logger.info('Deleting session', { sessionId, userId });
    
    const session = await this.getSession(sessionId, userId);
    if (!session) {
      logger.warn('Cannot delete: session not found or unauthorized', { sessionId, userId });
      return false;
    }
    
    await db.delete(chatSessions)
      .where(eq(chatSessions.id, sessionId));
    
    logger.info('Session deleted', { sessionId });
    return true;
  }

  /**
   * Update session title.
   * 
   * @param sessionId - The session ID
   * @param userId - The user ID to validate ownership
   * @param title - The new title
   * @returns True if updated, false if not found or unauthorized
   */
  async updateSessionTitle(sessionId: string, userId: string, title: string): Promise<boolean> {
    logger.info('Updating session title', { sessionId, userId, title });
    
    const session = await this.getSession(sessionId, userId);
    if (!session) {
      return false;
    }
    
    await db.update(chatSessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
    
    return true;
  }
}

export const chatSessionService = new ChatSessionService();
