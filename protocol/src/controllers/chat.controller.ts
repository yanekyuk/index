import { z } from "zod";

import { AuthGuard, type AuthenticatedUser } from "../guards/auth.guard";
import { requestContext } from "../lib/request-context";
import { log } from "../lib/log";
import {
  Controller,
  Get,
  Post,
  UseGuards,
} from "../lib/router/router.decorators";
import { chatSessionService } from "../services/chat.service";
import { fileService } from "../services/file.service";
import { SuggestionGenerator } from "../lib/protocol/agents/suggestion.generator";
import {
  createDoneEvent,
  createErrorEvent,
  createStatusEvent,
  formatSSEEvent,
} from "../types/chat-streaming.types";

const logger = log.controller.from("chat");

const streamBodySchema = z.object({
  message: z.string().nullish(),
  sessionId: z.string().nullish(),
  useCheckpointer: z.boolean().optional(),
  fileIds: z.array(z.string()).optional(),
  indexId: z.string().nullish(),
  prefillMessages: z.array(z.object({
    role: z.enum(["assistant", "user"]),
    content: z.string().max(10000),
  })).max(10).optional(),
});

let suggestionGeneratorInstance: SuggestionGenerator | null = null;
function getSuggestionGenerator(): SuggestionGenerator {
  if (!suggestionGeneratorInstance) {
    suggestionGeneratorInstance = new SuggestionGenerator();
  }
  return suggestionGeneratorInstance;
}

@Controller("/chat")
export class ChatController {
  /**
   * Send a message to the chat graph for processing.
   * The graph routes to appropriate subgraphs based on intent analysis.
   *
   * @param req - The HTTP request object (body: { message: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with graph execution result including responseText
   */
  @Post("/message")
  @UseGuards(AuthGuard)
  async message(req: Request, user: AuthenticatedUser) {
    // 1. Parse request body for message
    let messageContent: string = "";
    try {
      const body = (await req.json()) as { message?: string };
      messageContent = body.message || "";
    } catch {
      // No body or invalid JSON
      return Response.json(
        { error: "Invalid request body. Expected { message: string }" },
        { status: 400 },
      );
    }

    if (!messageContent.trim()) {
      return Response.json(
        { error: "Message content is required" },
        { status: 400 },
      );
    }

    // 2. Process message through service
    const result = await chatSessionService.processMessage(
      user.id,
      messageContent,
    );

    // 3. Return response
    return Response.json({
      response: result.responseText,
      error: result.error,
    });
  }

  /**
   * SSE streaming endpoint for chat messages with context support.
   * Streams graph events and LLM tokens in real-time, loading previous conversation context.
   *
   * @param req - The HTTP request object (body: { message: string, sessionId?: string, useCheckpointer?: boolean, fileIds?: string[] })
   * @param user - The authenticated user from AuthGuard
   * @returns SSE Response stream
   */
  @Post("/stream")
  @UseGuards(AuthGuard)
  async messageStream(
    req: Request,
    user: AuthenticatedUser,
  ): Promise<Response> {
    // 1. Parse and validate request body
    let body: z.infer<typeof streamBodySchema>;
    try {
      const raw = await req.json();
      const parsed = streamBodySchema.safeParse(raw);
      if (!parsed.success) {
        return Response.json(
          {
            error:
              "Invalid request body. Expected { message?: string | null, sessionId?: string | null, useCheckpointer?: boolean, fileIds?: string[], indexId?: string | null }",
          },
          { status: 400 },
        );
      }
      body = parsed.data;
    } catch {
      return Response.json(
        {
          error: "Invalid JSON in request body",
        },
        { status: 400 },
      );
    }

    let messageContent = body.message?.trim() || "";
    const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
    if (fileIds.length > 0) {
      const fileContent = await fileService.loadAttachedFileContent(
        user.id,
        fileIds,
      );
      if (fileContent) {
        messageContent = messageContent
          ? `${messageContent}\n\n[Attached files]\n${fileContent}`
          : `[Attached files]\n${fileContent}`;
      }
    }
    if (!messageContent) {
      return Response.json(
        { error: "Message content or file attachments are required" },
        { status: 400 },
      );
    }

    // 2. Validate or create session
    const requestIndexId =
      typeof body.indexId === "string" && body.indexId.trim()
        ? body.indexId.trim()
        : undefined;
    if (requestIndexId) {
      const requestScopeValidation =
        await chatSessionService.validateIndexScope(user.id, requestIndexId);
      if (!requestScopeValidation.ok) {
        return Response.json(
          { error: requestScopeValidation.error },
          { status: requestScopeValidation.status },
        );
      }
    }

    let currentSessionId = body.sessionId;
    let session: Awaited<
      ReturnType<typeof chatSessionService.getSession>
    > | null = null;
    if (!currentSessionId) {
      currentSessionId = await chatSessionService.createSession(
        user.id,
        undefined,
        requestIndexId,
      );
    } else {
      session = await chatSessionService.getSession(
        currentSessionId,
        user.id,
      );
      if (!session) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }
      if (requestIndexId !== undefined) {
        await chatSessionService.updateSessionIndex(
          currentSessionId,
          user.id,
          requestIndexId,
        );
      }
    }

    // Effective index for this run: request body overrides; otherwise use session's persisted index
    const effectiveIndexId = requestIndexId ?? session?.indexId ?? undefined;
    if (effectiveIndexId) {
      const effectiveScopeValidation =
        await chatSessionService.validateIndexScope(user.id, effectiveIndexId);
      if (!effectiveScopeValidation.ok) {
        return Response.json(
          { error: effectiveScopeValidation.error },
          { status: effectiveScopeValidation.status },
        );
      }
    }

    // Capture for closure
    const sessionId = currentSessionId;
    const factory = chatSessionService.getGraphFactory();
    const useCheckpointer = body.useCheckpointer ?? true;
    const indexIdForStream = effectiveIndexId;

    // User message is persisted after the stream completes (with the assistant response) so that
    // loadSessionContext during streaming does not include it and the current message is not
    // duplicated in the conversation context (which caused "You've listed the same project twice!").

    // 3. Get checkpointer if requested
    const checkpointer = useCheckpointer
      ? await chatSessionService.getCheckpointer()
      : undefined;
    if (useCheckpointer && checkpointer) {
      logger.verbose("PostgresSaver checkpointer initialized", { sessionId });
    }

    // 4. Create SSE stream
    const encoder = new TextEncoder();
    const rawOrigin = req.headers.get("origin");
    const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? "").split(",").map(o => o.trim()).filter(Boolean);
    const originUrl = rawOrigin && trustedOrigins.includes(rawOrigin) ? rawOrigin : undefined;

    const stream = new ReadableStream({
      start(controller) {
        return requestContext.run({ originUrl }, async () => {
        try {
          // Send initial status
          controller.enqueue(
            encoder.encode(
              formatSSEEvent(
                createStatusEvent(sessionId, "Processing message..."),
              ),
            ),
          );

          // Stream chat graph events with context
          let fullResponse = "";
          let routingDecision: Record<string, unknown> | undefined;
          let subgraphResults: Record<string, unknown> | undefined;

          // Use context-aware streaming to load previous messages
          for await (const event of factory.streamChatEventsWithContext(
            {
              userId: user.id,
              message: messageContent,
              sessionId,
              maxContextMessages: 20,
              indexId: indexIdForStream,
              prefillMessages: body.prefillMessages,
            },
            checkpointer,
            req.signal,
          )) {
            if (event) {
              // response_complete is an internal event carrying the agent's
              // authoritative final text — don't forward it to the SSE client.
              if (event.type === "response_complete") {
                fullResponse = event.response;
              } else {
                controller.enqueue(encoder.encode(formatSSEEvent(event)));
              }

              if (event.type === "routing") {
                routingDecision = {
                  target: event.target,
                  reasoning: event.reasoning,
                };
              } else if (event.type === "subgraph_result") {
                subgraphResults = {
                  ...subgraphResults,
                  [event.subgraph]: event.data,
                };
              }
            }
          }

          // Persist prefill messages (e.g. onboarding greeting) only for newly created sessions
          if (body.prefillMessages?.length && !body.sessionId) {
            for (const pm of body.prefillMessages) {
              await chatSessionService.addMessage({
                sessionId,
                role: pm.role,
                content: pm.content,
              });
            }
          }

          // Persist user message and assistant response
          await chatSessionService.addMessage({
            sessionId,
            role: "user",
            content: messageContent,
          });
          if (fullResponse) {
            await chatSessionService.addMessage({
              sessionId,
              role: "assistant",
              content: fullResponse,
              routingDecision,
              subgraphResults,
            });
          }

          // Skip title/suggestions generation if client disconnected
          if (!req.signal.aborted) {
            // Generate session title and suggestions in parallel
            const [sessionTitle, suggestions] = await Promise.all([
              chatSessionService.generateSessionTitle(sessionId, user.id),
              getSuggestionGenerator()
                .generate({
                  messages: [
                    { role: "user", content: messageContent },
                    { role: "assistant", content: fullResponse },
                  ],
                })
                .catch(() => []),
            ]);

            // Send done event with title and suggestions
            controller.enqueue(
              encoder.encode(
                formatSSEEvent(
                  createDoneEvent(sessionId, fullResponse, {
                    routingDecision,
                    subgraphResults,
                    title: sessionTitle,
                    suggestions,
                  }),
                ),
              ),
            );
          }
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              formatSSEEvent(
                createErrorEvent(
                  sessionId,
                  error instanceof Error ? error.message : "Unknown error",
                  "STREAM_ERROR",
                ),
              ),
            ),
          );
        } finally {
          controller.close();
        }
        }); // requestContext.run
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Session-Id": sessionId,
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
  @Get("/sessions")
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
  @Post("/session")
  @UseGuards(AuthGuard)
  async getSession(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string };
    try {
      body = (await req.json()) as { sessionId?: string };
    } catch {
      return Response.json(
        { error: "Invalid request body. Expected { sessionId: string }" },
        { status: 400 },
      );
    }

    if (!body.sessionId) {
      return Response.json({ error: "sessionId is required" }, { status: 400 });
    }

    const session = await chatSessionService.getSession(
      body.sessionId,
      user.id,
    );
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const messages = await chatSessionService.getSessionMessages(
      body.sessionId,
    );
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
  @Post("/session/delete")
  @UseGuards(AuthGuard)
  async deleteSession(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string };
    try {
      body = (await req.json()) as { sessionId?: string };
    } catch {
      return Response.json(
        { error: "Invalid request body. Expected { sessionId: string }" },
        { status: 400 },
      );
    }

    if (!body.sessionId) {
      return Response.json({ error: "sessionId is required" }, { status: 400 });
    }

    const deleted = await chatSessionService.deleteSession(
      body.sessionId,
      user.id,
    );
    if (!deleted) {
      return Response.json({ error: "Session not found" }, { status: 404 });
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
  @Post("/session/title")
  @UseGuards(AuthGuard)
  async updateSessionTitle(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string; title?: string };
    try {
      body = (await req.json()) as { sessionId?: string; title?: string };
    } catch {
      return Response.json(
        {
          error:
            "Invalid request body. Expected { sessionId: string, title: string }",
        },
        { status: 400 },
      );
    }

    if (!body.sessionId || body.title === undefined) {
      return Response.json(
        { error: "sessionId and title are required" },
        { status: 400 },
      );
    }

    const title = String(body.title).trim();
    if (!title) {
      return Response.json({ error: "title cannot be empty" }, { status: 400 });
    }

    const updated = await chatSessionService.updateSessionTitle(
      body.sessionId,
      user.id,
      title,
    );
    if (!updated) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    return Response.json({ success: true, title });
  }

  @Post("/session/share")
  @UseGuards(AuthGuard)
  async shareSession(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string };
    try {
      body = (await req.json()) as { sessionId?: string };
    } catch {
      return Response.json(
        { error: "Invalid request body. Expected { sessionId: string }" },
        { status: 400 },
      );
    }

    if (!body.sessionId) {
      return Response.json({ error: "sessionId is required" }, { status: 400 });
    }

    const shareToken = await chatSessionService.shareSession(
      body.sessionId,
      user.id,
    );
    if (!shareToken) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    return Response.json({ shareToken });
  }

  @Post("/session/unshare")
  @UseGuards(AuthGuard)
  async unshareSession(req: Request, user: AuthenticatedUser) {
    let body: { sessionId?: string };
    try {
      body = (await req.json()) as { sessionId?: string };
    } catch {
      return Response.json(
        { error: "Invalid request body. Expected { sessionId: string }" },
        { status: 400 },
      );
    }

    if (!body.sessionId) {
      return Response.json({ error: "sessionId is required" }, { status: 400 });
    }

    const unshared = await chatSessionService.unshareSession(
      body.sessionId,
      user.id,
    );
    if (!unshared) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    return Response.json({ success: true });
  }

  @Get("/shared/:token")
  async getSharedSession(
    _req: Request,
    _user: unknown,
    params: { token: string },
  ) {
    const result = await chatSessionService.getSharedSession(params.token);
    if (!result) {
      return Response.json(
        { error: "Shared session not found" },
        { status: 404 },
      );
    }

    return Response.json({
      session: {
        id: result.session.id,
        title: result.session.title,
        createdAt: result.session.createdAt,
      },
      messages: result.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
  }
}
