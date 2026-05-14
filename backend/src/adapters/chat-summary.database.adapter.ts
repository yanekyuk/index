/**
 * Drizzle-backed I/O for the chat_session_summaries table. Pure persistence;
 * no business logic. Wrapped by ChatSummaryService.
 */
import { and, asc, desc, eq, gt, ne } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';

/**
 * The digest payload shape stored in the `digest` jsonb column. Mirrors
 * the protocol-side `ChatContextDigest` but is declared locally per the
 * layering rule (adapters do not import protocol types).
 */
export interface SummaryDigestRow {
  statedFacts: string[];
  openQuestions: string[];
  rejectionReasons: string[];
  surfacedFindings: string[];
}

/** Adapter-side message shape; the protocol-side ChatSummarizerMessage maps onto this 1:1. */
export interface SummarizerMessageRow {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSummaryRow {
  id: string;
  conversationId: string;
  fromMessageId: string;
  toMessageId: string;
  digest: SummaryDigestRow;
  model: string;
  createdAt: Date;
}

export interface MessageForSummarizer extends SummarizerMessageRow {
  id: string;
  createdAt: Date;
}

export interface InsertChatSummaryInput {
  sessionId: string;
  fromMessageId: string;
  toMessageId: string;
  digest: SummaryDigestRow;
  model: string;
}

/**
 * Drizzle-backed adapter for chat session summary rows. Pure I/O over the
 * `chat_session_summaries` table; consumed by ChatSummaryService.
 */
export class ChatSummaryDatabaseAdapter {
  /**
   * Returns the most recent summary for a session, or null if none exists.
   *
   * @param sessionId - The conversation (chat session) id.
   * @returns The latest row (ordered by createdAt desc) or null.
   */
  async getLatest(sessionId: string): Promise<ChatSummaryRow | null> {
    const rows = await db
      .select()
      .from(schema.chatSessionSummaries)
      .where(eq(schema.chatSessionSummaries.conversationId, sessionId))
      // Order by createdAt (not toMessageId): toMessageId is a text UUID, so DESC sorts
      // lexicographically rather than chronologically.
      .orderBy(desc(schema.chatSessionSummaries.createdAt))
      .limit(1);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      conversationId: r.conversationId,
      fromMessageId: r.fromMessageId,
      toMessageId: r.toMessageId,
      digest: r.digest as SummaryDigestRow,
      model: r.model,
      createdAt: r.createdAt,
    };
  }

  /**
   * Returns session messages strictly after a cursor message (ordered by createdAt asc).
   *
   * @param sessionId - The conversation (chat session) id.
   * @param cursorMessageId - Cursor message id (exclusive). Null returns all session messages.
   * @returns Ordered messages with role normalized to `'user' | 'assistant'`.
   */
  async getMessagesAfter(sessionId: string, cursorMessageId: string | null): Promise<MessageForSummarizer[]> {
    let cursorCreatedAt: Date | null = null;
    if (cursorMessageId) {
      const cursorRow = await db
        .select({ createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(eq(schema.messages.id, cursorMessageId))
        .limit(1);
      cursorCreatedAt = cursorRow[0]?.createdAt ?? null;
    }

    const baseConds = [eq(schema.messages.conversationId, sessionId)];
    if (cursorCreatedAt && cursorMessageId) {
      // gt() compares Postgres microsecond timestamps against a JS Date (ms precision),
      // so the cursor row itself can slip through when its sub-millisecond fraction is
      // non-zero. Exclude by id to guarantee strict-after semantics.
      baseConds.push(gt(schema.messages.createdAt, cursorCreatedAt));
      baseConds.push(ne(schema.messages.id, cursorMessageId));
    }

    const rows = await db
      .select()
      .from(schema.messages)
      .where(and(...baseConds))
      .orderBy(asc(schema.messages.createdAt));

    return rows.map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      role: m.role === 'agent' ? 'assistant' : 'user',
      content: extractTextContent(m.parts as Array<{ type?: string; text?: string }>),
    }));
  }

  /**
   * Inserts a new chat summary row and returns the persisted shape.
   *
   * @param input - Summary fields. `sessionId` maps to the `conversation_id` column.
   * @returns The inserted row, including server-generated id and createdAt.
   */
  async insertSummary(input: InsertChatSummaryInput): Promise<ChatSummaryRow> {
    const [inserted] = await db
      .insert(schema.chatSessionSummaries)
      .values({
        conversationId: input.sessionId,
        fromMessageId: input.fromMessageId,
        toMessageId: input.toMessageId,
        digest: input.digest,
        model: input.model,
      })
      .returning();
    return {
      id: inserted.id,
      conversationId: inserted.conversationId,
      fromMessageId: inserted.fromMessageId,
      toMessageId: inserted.toMessageId,
      digest: inserted.digest as SummaryDigestRow,
      model: inserted.model,
      createdAt: inserted.createdAt,
    };
  }
}

function extractTextContent(parts: Array<{ type?: string; text?: string }> | null | undefined): string {
  if (!parts) return '';
  const text = parts.find((p) => p?.type === 'text' && typeof p.text === 'string')?.text
    ?? parts.find((p) => typeof p?.text === 'string')?.text
    ?? '';
  return text ?? '';
}
