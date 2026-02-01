import { eq, and, inArray, isNull } from 'drizzle-orm';
import * as schema from '../schemas/database.schema';
import db from '../lib/drizzle/drizzle';
import path from 'path';
import { getUploadsPath } from '../lib/paths';
import { loadFileContent } from '../lib/uploads';
import { HumanMessage } from '@langchain/core/messages';
import { IndexEmbedder } from '../lib/embedder';
import { ChatGraphFactory } from '../lib/protocol/graphs/chat/chat.graph';
import { getCheckpointer } from '../lib/protocol/graphs/chat/chat.checkpointer';
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { ChatGraphCompositeDatabase } from '../lib/protocol/interfaces/database.interface';
import type { Scraper } from '../lib/protocol/interfaces/scraper.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import { chatSessionService } from '../services/chat-session.service';
import {
  formatSSEEvent,
  createStatusEvent,
  createDoneEvent,
  createErrorEvent,
} from '../types/chat-streaming';
import { log } from '../lib/log';
import { ChatTitleGenerator } from '../lib/protocol/agents/chat/title.generator';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';

const logger = log.controller.from('chat.controller.ts');

import { Controller, Post, Get, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';

@Controller('/chat')
export class ChatController {
  private db: ChatGraphCompositeDatabase;
  private embedder: Embedder;
  private scraper: Scraper;
  private factory: ChatGraphFactory;

  constructor() {
    this.db = new ChatDatabaseAdapter();
    // IndexEmbedder (from ../lib/embedder) implements Embedder interface
    this.embedder = new IndexEmbedder();
    this.scraper = new ScraperAdapter();
    this.factory = new ChatGraphFactory(this.db, this.embedder, this.scraper);
  }

  /**
   * Send a message to the chat graph for processing.
   * The graph routes to appropriate subgraphs based on intent analysis.
   *
   * @param req - The HTTP request object (body: { message: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with graph execution result including responseText
   */
  @Post('/message')
  @UseGuards(AuthGuard)
  async message(req: Request, user: AuthenticatedUser) {
    // 1. Parse request body for message
    let messageContent: string = '';
    try {
      const body = await req.json() as { message?: string };
      messageContent = body.message || '';
    } catch {
      // No body or invalid JSON
      return Response.json(
        { error: 'Invalid request body. Expected { message: string }' },
        { status: 400 }
      );
    }

    if (!messageContent.trim()) {
      return Response.json(
        { error: 'Message content is required' },
        { status: 400 }
      );
    }

    // 2. Create graph and invoke with state
    const graph = this.factory.createGraph();
    const result = await graph.invoke({
      userId: user.id,
      messages: [new HumanMessage(messageContent)]
    });

    // 3. Return response with responseText from graph state (agent loop architecture)
    return Response.json({
      response: result.responseText || '',
      error: result.error
    });
  }

  /**
   * Load file content from user uploads by fileIds.
   * Returns concatenated content from supported files, or empty string if none.
   */
  private async loadAttachedFileContent(userId: string, fileIds: string[]): Promise<string> {
    if (!fileIds?.length) return '';
    const rows = await db
      .select({ id: schema.files.id, name: schema.files.name })
      .from(schema.files)
      .where(
        and(
          eq(schema.files.userId, userId),
          inArray(schema.files.id, fileIds),
          isNull(schema.files.deletedAt)
        )
      );
    if (rows.length === 0) return '';
    const targetDir = getUploadsPath('files', userId);
    const parts: string[] = [];
    for (const row of rows) {
      const ext = path.extname(row.name);
      const filePath = path.join(targetDir, row.id + ext);
      const result = await loadFileContent(filePath);
      if (result.content?.trim()) {
        parts.push(`=== ${row.name} ===\n${result.content.substring(0, 10000)}`);
      }
    }
    return parts.length ? parts.join('\n\n') : '';
  }

  /**
   * SSE streaming endpoint for chat messages with context support.
   * Streams graph events and LLM tokens in real-time, loading previous conversation context.
   *
   * @param req - The HTTP request object (body: { message: string, sessionId?: string, useCheckpointer?: boolean, fileIds?: string[] })
   * @param user - The authenticated user from AuthGuard
   * @returns SSE Response stream
   */
  @Post('/stream')
  @UseGuards(AuthGuard)
  async messageStream(req: Request, user: AuthenticatedUser): Promise<Response> {
    // 1. Parse request body
    let body: { message?: string; sessionId?: string; useCheckpointer?: boolean; fileIds?: string[] };
    try {
      body = await req.json() as { message?: string; sessionId?: string; useCheckpointer?: boolean; fileIds?: string[] };
    } catch {
      return Response.json(
        { error: 'Invalid request body. Expected { message: string, sessionId?: string, useCheckpointer?: boolean, fileIds?: string[] }' },
        { status: 400 }
      );
    }

    let messageContent = body.message?.trim() || '';
    const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
    if (fileIds.length > 0) {
      const fileContent = await this.loadAttachedFileContent(user.id, fileIds);
      if (fileContent) {
        messageContent = messageContent
          ? `${messageContent}\n\n[Attached files]\n${fileContent}`
          : `[Attached files]\n${fileContent}`;
      }
    }
    if (!messageContent) {
      return Response.json(
        { error: 'Message content or file attachments are required' },
        { status: 400 }
      );
    }

    // 2. Validate or create session
    let currentSessionId = body.sessionId;
    if (!currentSessionId) {
      currentSessionId = await chatSessionService.createSession(user.id);
    } else {
      const session = await chatSessionService.getSession(currentSessionId, user.id);
      if (!session) {
        return Response.json({ error: 'Session not found' }, { status: 404 });
      }
    }

    // Capture for closure
    const sessionId = currentSessionId;
    const factory = this.factory;
    const useCheckpointer = body.useCheckpointer ?? false;

    // 3. Save user message
    await chatSessionService.addMessage({
      sessionId,
      role: 'user',
      content: messageContent,
    });

    // 4. Get checkpointer if requested
    let checkpointer: PostgresSaver | undefined;
    if (useCheckpointer) {
      try {
        checkpointer = await getCheckpointer();
        logger.info('PostgresSaver checkpointer initialized', { sessionId });
      } catch (error) {
        logger.warn('Failed to initialize checkpointer, proceeding without', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 5. Create SSE stream
    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial status
          controller.enqueue(encoder.encode(
            formatSSEEvent(createStatusEvent(sessionId, 'Processing message...'))
          ));

          // Stream chat graph events with context
          let fullResponse = '';
          let routingDecision: Record<string, unknown> | undefined;
          let subgraphResults: Record<string, unknown> | undefined;

          // Use context-aware streaming to load previous messages
          for await (const event of factory.streamChatEventsWithContext(
            {
              userId: user.id,
              message: messageContent,
              sessionId,
              maxContextMessages: 20,
            },
            checkpointer
          )) {
            if (event) {
              controller.enqueue(encoder.encode(formatSSEEvent(event)));

              // Accumulate response for persistence
              if (event.type === 'token') {
                fullResponse += event.content;
              } else if (event.type === 'routing') {
                routingDecision = { target: event.target, reasoning: event.reasoning };
              } else if (event.type === 'subgraph_result') {
                subgraphResults = { ...subgraphResults, [event.subgraph]: event.data };
              }
            }
          }

          // Save assistant response
          await chatSessionService.addMessage({
            sessionId,
            role: 'assistant',
            content: fullResponse,
            routingDecision,
            subgraphResults,
          });

          // Auto-name session with LLM when there is enough context (at least one user + one assistant message)
          const sessionForTitle = await chatSessionService.getSession(sessionId, user.id);
          if (sessionForTitle && !sessionForTitle.title?.trim()) {
            const messagesForTitle = await chatSessionService.getSessionMessages(sessionId, 10);
            const hasUser = messagesForTitle.some((m) => m.role === 'user');
            const hasAssistant = messagesForTitle.some((m) => m.role === 'assistant');
            if (hasUser && hasAssistant) {
              try {
                const titleGenerator = new ChatTitleGenerator();
                const title = await titleGenerator.invoke({
                  messages: messagesForTitle.map((m) => ({ role: m.role, content: m.content })),
                });
                await chatSessionService.updateSessionTitle(sessionId, user.id, title);
                logger.info('Session title set', { sessionId, title });
              } catch (err) {
                logger.warn('Failed to set session title', {
                  sessionId,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }

          // Send done event
          controller.enqueue(encoder.encode(
            formatSSEEvent(createDoneEvent(sessionId, fullResponse, routingDecision, subgraphResults))
          ));

        } catch (error) {
          controller.enqueue(encoder.encode(
            formatSSEEvent(createErrorEvent(
              sessionId,
              error instanceof Error ? error.message : 'Unknown error',
              'STREAM_ERROR'
            ))
          ));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Session-Id': sessionId,
      },
    });
  }

  /**
   * Get all chat sessions for the authenticated user.
   *
   * @param req - The HTTP request object
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with list of sessions
   */
  @Get('/sessions')
  @UseGuards(AuthGuard)
  async getSessions(req: Request, user: AuthenticatedUser) {
    const sessions = await chatSessionService.getUserSessions(user.id);
    return Response.json({ sessions });
  }

  /**
   * Get a specific session with its messages.
   * Uses POST with sessionId in body due to router limitations with path params.
   *
   * @param req - The HTTP request object (body: { sessionId: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with session and messages
   */
  @Post('/session')
  @UseGuards(AuthGuard)
  async getSession(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string };
    try {
      body = await req.json() as { sessionId?: string };
    } catch {
      return Response.json(
        { error: 'Invalid request body. Expected { sessionId: string }' },
        { status: 400 }
      );
    }

    if (!body.sessionId) {
      return Response.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    const session = await chatSessionService.getSession(body.sessionId, user.id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const messages = await chatSessionService.getSessionMessages(body.sessionId);
    return Response.json({ session, messages });
  }

  /**
   * Delete a chat session.
   * Uses POST with sessionId in body due to router limitations with path params.
   *
   * @param req - The HTTP request object (body: { sessionId: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with success status
   */
  @Post('/session/delete')
  @UseGuards(AuthGuard)
  async deleteSession(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string };
    try {
      body = await req.json() as { sessionId?: string };
    } catch {
      return Response.json(
        { error: 'Invalid request body. Expected { sessionId: string }' },
        { status: 400 }
      );
    }

    if (!body.sessionId) {
      return Response.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    const deleted = await chatSessionService.deleteSession(body.sessionId, user.id);
    if (!deleted) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    return Response.json({ success: true });
  }

  /**
   * Update a chat session title (rename).
   *
   * @param req - The HTTP request object (body: { sessionId: string, title: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with updated session or error
   */
  @Post('/session/title')
  @UseGuards(AuthGuard)
  async updateSessionTitle(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string; title?: string };
    try {
      body = await req.json() as { sessionId?: string; title?: string };
    } catch {
      return Response.json(
        { error: 'Invalid request body. Expected { sessionId: string, title: string }' },
        { status: 400 }
      );
    }

    if (!body.sessionId || body.title === undefined) {
      return Response.json(
        { error: 'sessionId and title are required' },
        { status: 400 }
      );
    }

    const title = String(body.title).trim();
    if (!title) {
      return Response.json(
        { error: 'title cannot be empty' },
        { status: 400 }
      );
    }

    const updated = await chatSessionService.updateSessionTitle(body.sessionId, user.id, title);
    if (!updated) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    return Response.json({ success: true, title });
  }
}
