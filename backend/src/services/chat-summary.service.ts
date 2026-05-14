/**
 * ChatSummaryService — implements the protocol's ChatSummaryReader contract.
 * Orchestrates read-from-DB → summarize → write-to-DB on every call so callers
 * always get an up-to-date digest (or null if the session has no content yet).
 */
import { ChatSummarizer, getModelName } from '@indexnetwork/protocol';
import type { ChatContextDigest, ChatSummaryReader } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { ChatSummaryDatabaseAdapter, type ChatSummaryRow } from '../adapters/chat-summary.database.adapter';

const logger = log.service.from('ChatSummaryService');

/** Minimal summarizer shape — used as the constructor type so tests can inject a fake. */
export interface ChatSummarizerLike {
  summarize(input: {
    previousDigest: ChatContextDigest | null;
    newMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<ChatContextDigest | null>;
}

/**
 * Backend implementation of {@link ChatSummaryReader}. Reads the latest persisted
 * digest for a session, runs incremental summarization over any new messages,
 * and appends a fresh row when summarization succeeds.
 *
 * @remarks Constructing this service with the default summarizer instantiates
 * {@link ChatSummarizer}, which validates `OPENROUTER_API_KEY` at construction
 * time. Importers of the composition root (`mcp.controller.ts`) therefore
 * inherit a boot-time dependency on that env var. Inject a fake summarizer in
 * tests or in environments where the LLM client must not be constructed.
 */
export class ChatSummaryService implements ChatSummaryReader {
  constructor(
    private readonly adapter: ChatSummaryDatabaseAdapter,
    private readonly summarizer: ChatSummarizerLike = new ChatSummarizer(),
  ) {}

  /**
   * Returns the freshest digest for a session, running summarization if needed.
   *
   * @param sessionId - The conversation (chat session) id.
   * @returns The up-to-date digest, the previous digest when no new content
   *   warrants an update, or `null` when there is nothing to summarize.
   */
  async getDigest(sessionId: string): Promise<ChatContextDigest | null> {
    let prev: ChatSummaryRow | null = null;
    try {
      prev = await this.adapter.getLatest(sessionId);
    } catch (err) {
      logger.warn('chat-summary getLatest failed', { sessionId, error: errString(err) });
      return null;
    }

    let newMessages: Awaited<ReturnType<ChatSummaryDatabaseAdapter['getMessagesAfter']>>;
    try {
      newMessages = await this.adapter.getMessagesAfter(sessionId, prev?.toMessageId ?? null);
    } catch (err) {
      logger.warn('chat-summary getMessagesAfter failed', { sessionId, error: errString(err) });
      return digestOf(prev);
    }

    if (newMessages.length === 0) {
      return digestOf(prev);
    }

    const digest = await this.summarizer.summarize({
      previousDigest: digestOf(prev),
      newMessages: newMessages.map((m) => ({ role: m.role, content: m.content })),
    });

    if (!digest) {
      return digestOf(prev);
    }

    try {
      await this.adapter.insertSummary({
        sessionId,
        fromMessageId: prev?.fromMessageId ?? newMessages[0].id,
        toMessageId: newMessages[newMessages.length - 1].id,
        digest,
        model: getModelName('chatContextSummarizer'),
      });
    } catch (err) {
      logger.warn('chat-summary insertSummary failed', { sessionId, error: errString(err) });
      // Still return the fresh digest — caller benefits even if persistence fails.
    }

    return digest;
  }
}

function errString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Bridge the adapter's local `SummaryDigestRow` type to the protocol's
 * `ChatContextDigest`. Adapters cannot import protocol types (layering rule),
 * so we declare them as structurally identical and cast at this boundary.
 */
function digestOf(row: ChatSummaryRow | null): ChatContextDigest | null {
  return (row?.digest as ChatContextDigest | undefined) ?? null;
}
