import { log } from '../lib/log';
import { chatDatabaseAdapter, ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { ChatGraphFactory } from '../lib/protocol/graphs/chat/chat.graph';
import { getCheckpointer } from '../lib/protocol/graphs/chat/chat.checkpointer';
import { ChatTitleGenerator } from '../lib/protocol/agents/chat/title.generator';
import { HumanMessage } from '@langchain/core/messages';
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { ChatGraphCompositeDatabase } from '../lib/protocol/interfaces/database.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import type { Scraper } from '../lib/protocol/interfaces/scraper.interface';

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
 * Manages chat sessions, messages, and chat graph invocation.
 * Uses ChatDatabaseAdapter for database operations.
 * Uses protocol adapters for graph invocation.
 * 
 * CONTEXT:
 * - Chat sessions are persistent conversations between a user and the system
 * - Each session contains multiple messages with role-based attribution
 * - Messages can store routing decisions and subgraph results for debugging
 * - Graph processing for AI-powered chat responses
 */
export class ChatSessionService {
  private graphDb: ChatGraphCompositeDatabase;
  private embedder: Embedder;
  private scraper: Scraper;
  private factory: ChatGraphFactory;

  constructor(private db = chatDatabaseAdapter) {
    // Initialize protocol adapters for graph processing
    this.graphDb = new ChatDatabaseAdapter();
    this.embedder = new EmbedderAdapter();
    this.scraper = new ScraperAdapter();
    this.factory = new ChatGraphFactory(this.graphDb, this.embedder, this.scraper);
  }
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
    await this.db.createSession({ id, userId, title, indexId });

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

    await this.db.updateSessionIndex(sessionId, indexId?.trim() || null);

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
    
    const session = await this.db.getSession(sessionId);
    
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
    
    return this.db.getUserSessions(userId, limit);
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
    
    await this.db.createMessage({
      id,
      sessionId: params.sessionId,
      role: params.role,
      content: params.content,
      routingDecision: params.routingDecision,
      subgraphResults: params.subgraphResults,
      tokenCount: params.tokenCount,
    });
    
    // Update session timestamp
    await this.db.updateSessionTimestamp(params.sessionId);
    
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
    
    return this.db.getSessionMessages(sessionId, limit);
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
    
    await this.db.deleteSession(sessionId);
    
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
    
    await this.db.updateSessionTitle(sessionId, title);
    
    return true;
  }

  /**
   * Process a message through the chat graph (non-streaming).
   * 
   * @param userId - The user ID
   * @param messageContent - The message content
   * @returns Graph execution result with response text
   */
  async processMessage(userId: string, messageContent: string): Promise<{
    responseText: string;
    error?: string;
  }> {
    logger.info('Processing message', { userId });

    const graph = this.factory.createGraph();
    const result = await graph.invoke({
      userId,
      messages: [new HumanMessage(messageContent)]
    });

    return {
      responseText: result.responseText || '',
      error: result.error
    };
  }

  /**
   * Get checkpointer for streaming (if needed).
   * 
   * @returns PostgresSaver checkpointer or undefined
   */
  async getCheckpointer(): Promise<PostgresSaver | undefined> {
    try {
      return await getCheckpointer();
    } catch (error) {
      logger.warn('Failed to initialize checkpointer', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Get the chat graph factory for streaming operations.
   * This is used by controllers that need to stream chat events.
   * 
   * @returns The ChatGraphFactory instance
   */
  getGraphFactory(): ChatGraphFactory {
    return this.factory;
  }

  /**
   * Get pending connection requests for a user (where they are the receiver).
   */
  async getPendingRequests(userId: string) {
    const rows = await this.db.getPendingConnectionRequests(userId);
    return rows.map(r => ({
      channelId: `messaging:${[userId, r.initiatorUserId].sort().join('_')}`,
      requester: {
        id: r.initiatorUserId,
        name: r.initiatorName ?? 'Unknown',
        avatar: r.initiatorAvatar ?? undefined,
      },
      firstMessage: null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Auto-generate a session title based on conversation history.
   * 
   * @param sessionId - The session ID
   * @param userId - The user ID
   * @returns The generated title or undefined if generation fails
   */
  async generateSessionTitle(sessionId: string, userId: string): Promise<string | undefined> {
    logger.info('Generating session title', { sessionId });

    const session = await this.getSession(sessionId, userId);
    if (!session) {
      return undefined;
    }

    // Only generate if there's no title yet
    if (session.title?.trim()) {
      return session.title;
    }

    const messages = await this.getSessionMessages(sessionId, 10);
    const hasUser = messages.some((m) => m.role === 'user');
    const hasAssistant = messages.some((m) => m.role === 'assistant');

    if (!hasUser || !hasAssistant) {
      return undefined;
    }

    try {
      const titleGenerator = new ChatTitleGenerator();
      const title = await titleGenerator.invoke({
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      await this.updateSessionTitle(sessionId, userId, title);
      logger.info('Session title generated', { sessionId, title });

      return title;
    } catch (err) {
      logger.warn('Failed to generate session title', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }
}

export const chatSessionService = new ChatSessionService();
