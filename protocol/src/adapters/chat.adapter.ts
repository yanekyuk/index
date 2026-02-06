/**
 * Chat Session Database Adapter
 * 
 * Provides database operations for chat sessions and messages.
 * Used by ChatSessionService to abstract database access.
 */

import { eq, desc } from 'drizzle-orm';
import { chatSessions, chatMessages } from '../schemas/database.schema';
import db from '../lib/drizzle/drizzle';

export interface ChatSession {
  id: string;
  userId: string;
  title: string | null;
  indexId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  routingDecision: Record<string, unknown> | null;
  subgraphResults: Record<string, unknown> | null;
  tokenCount: number | null;
  createdAt: Date;
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  title?: string;
  indexId?: string;
}

export interface CreateMessageInput {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  routingDecision?: Record<string, unknown>;
  subgraphResults?: Record<string, unknown>;
  tokenCount?: number;
}

/**
 * ChatDatabaseAdapter
 * 
 * Wraps all database operations for chat_sessions and chat_messages tables.
 */
export class ChatDatabaseAdapter {
  /**
   * Create a new chat session
   */
  async createSession(data: CreateSessionInput): Promise<void> {
    await db.insert(chatSessions).values({
      id: data.id,
      userId: data.userId,
      title: data.title || null,
      indexId: data.indexId?.trim() || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    const [session] = await db.select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);
    
    return session || null;
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string, limit: number): Promise<ChatSession[]> {
    return db.select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(limit);
  }

  /**
   * Update session index
   */
  async updateSessionIndex(sessionId: string, indexId: string | null): Promise<void> {
    await db
      .update(chatSessions)
      .set({ indexId, updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
  }

  /**
   * Update session title
   */
  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    await db.update(chatSessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
  }

  /**
   * Update session timestamp
   */
  async updateSessionTimestamp(sessionId: string): Promise<void> {
    await db.update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await db.delete(chatSessions)
      .where(eq(chatSessions.id, sessionId));
  }

  /**
   * Create a message
   */
  async createMessage(data: CreateMessageInput): Promise<void> {
    await db.insert(chatMessages).values({
      id: data.id,
      sessionId: data.sessionId,
      role: data.role,
      content: data.content,
      routingDecision: data.routingDecision || null,
      subgraphResults: data.subgraphResults || null,
      tokenCount: data.tokenCount || null,
      createdAt: new Date(),
    });
  }

  /**
   * Get messages for a session
   */
  async getSessionMessages(sessionId: string, limit: number): Promise<ChatMessage[]> {
    return db.select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt)
      .limit(limit);
  }
}

export const chatDatabaseAdapter = new ChatDatabaseAdapter();
