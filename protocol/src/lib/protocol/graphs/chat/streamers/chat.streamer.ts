import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { protocolLogger } from "../../../protocol.log";
import type { ChatStreamEvent } from "../../../../../types/chat-streaming.types";
import { createErrorEvent, createStatusEvent } from "../../../../../types/chat-streaming.types";
import { MetadataStreamer } from "./metadata.streamer";
import { ResponseStreamer } from "./response.streamer";

const logger = protocolLogger("ChatStreamer");

// ══════════════════════════════════════════════════════════════════════════════
// CHAT STREAMER (Agent Loop Architecture)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Top-level streaming service for Chat Graph events.
 * Handles SSE event streaming for real-time chat interactions.
 *
 * Orchestrates two streamer modules:
 * - {@link MetadataStreamer} — tool execution tracking, agent iterations,
 *   user-friendly status updates
 * - {@link ResponseStreamer} — final agent response and error handling
 */
export class ChatStreamer {
  constructor(
    private loadSessionContext: (sessionId: string, maxMessages: number) => Promise<BaseMessage[]>,
    private createStreamingGraph: (checkpointer?: MemorySaver | PostgresSaver) => any
  ) {}

  /**
   * Streams chat events with full session context.
   * Loads previous conversation history and optionally uses a checkpointer for state persistence.
   *
   * @param input - Configuration for context-aware streaming
   * @param checkpointer - Optional checkpointer for state persistence
   * @yields ChatStreamEvent objects
   */
  public async *streamChatEventsWithContext(
    input: {
      userId: string;
      message: string;
      sessionId: string;
      maxContextMessages?: number;
      indexId?: string;
    },
    checkpointer?: MemorySaver | PostgresSaver
  ): AsyncGenerator<ChatStreamEvent> {
    const { userId, message, sessionId, maxContextMessages = 20, indexId } = input;
    logger.info("Starting context-aware streaming", {
      userId,
      sessionId,
      maxContextMessages,
      hasCheckpointer: !!checkpointer,
      hasIndexId: !!indexId,
      indexId: indexId ?? undefined,
    });

    try {
      // Load previous conversation context
      const previousMessages = await this.loadSessionContext(sessionId, maxContextMessages);

      // Add current message
      const allMessages = [...previousMessages, new HumanMessage(message)];

      logger.info("Context prepared", {
        previousCount: previousMessages.length,
        totalCount: allMessages.length,
      });

      // Stream with context using the optional checkpointer
      yield* this.streamChatEvents(
        { userId, messages: allMessages, indexId },
        sessionId,
        checkpointer
      );
    } catch (error) {
      logger.error("Stream error", {
        error: error instanceof Error ? error.message : String(error),
      });
      yield createErrorEvent(
        sessionId,
        error instanceof Error ? error.message : "Unknown error during context-aware streaming",
        "CONTEXT_STREAM_ERROR"
      );
    }
  }

  /**
   * Streams chat events from the graph execution.
   * Yields SSE-formatted events for status, tool calls, and token streaming.
   *
   * Delegates event processing to {@link MetadataStreamer} and
   * {@link ResponseStreamer}.
   *
   * @param input - The input state for the graph (userId and messages)
   * @param sessionId - The session ID for event attribution
   * @param checkpointer - Optional checkpointer for persistence
   * @yields ChatStreamEvent objects
   */
  public async *streamChatEvents(
    input: { userId: string; messages: BaseMessage[]; indexId?: string },
    sessionId: string,
    checkpointer?: MemorySaver | PostgresSaver
  ): AsyncGenerator<ChatStreamEvent> {
    const graph = this.createStreamingGraph(checkpointer);

    // Per-stream handler instances (they hold per-stream state)
    const metadataStreamer = new MetadataStreamer();
    const responseStreamer = new ResponseStreamer();

    try {
      // Stream events from the graph (include indexId in initial state when chat is index-scoped)
      const initialState: { userId: string; messages: BaseMessage[]; indexId?: string } = {
        userId: input.userId,
        messages: input.messages,
      };
      if (input.indexId) initialState.indexId = input.indexId;
      const eventStream = graph.streamEvents(
        initialState,
        {
          version: "v2",
          configurable: { thread_id: sessionId }
        }
      );

      // Emit initial status
      yield createStatusEvent(sessionId, "Processing your message...");

      for await (const event of eventStream) {
        // ─────────────────────────────────────────────────────────────────────
        // METADATA: Tool events
        // ─────────────────────────────────────────────────────────────────────

        if (event.event === "on_tool_start") {
          for (const e of metadataStreamer.handleToolStart(sessionId, event)) {
            yield e;
          }
        }

        if (event.event === "on_tool_end") {
          for (const e of metadataStreamer.handleToolEnd(sessionId, event)) {
            yield e;
          }
        }

        // ─────────────────────────────────────────────────────────────────────
        // METADATA: Agent iteration events
        // ─────────────────────────────────────────────────────────────────────

        if (event.event === "on_chat_model_end") {
          const result = metadataStreamer.handleChatModelEnd(sessionId, event);
          for (const e of result.events) {
            yield e;
          }
        }

        // ─────────────────────────────────────────────────────────────────────
        // RESPONSE: Agent loop completion
        // ─────────────────────────────────────────────────────────────────────

        if (event.event === "on_chain_end" && event.name === "agent_loop") {
          const result = responseStreamer.handleAgentLoopEnd(sessionId, event);
          for (const e of result.events) {
            yield e;
          }
          logger.info("Agent loop complete", {
            iterations: metadataStreamer.iterations,
            responseLength: result.responseText.length,
            hadError: result.hadError,
          });
        }
      }
    } catch (error) {
      logger.error("Stream error", {
        error: error instanceof Error ? error.message : String(error)
      });
      yield createErrorEvent(
        sessionId,
        error instanceof Error ? error.message : "Unknown error during streaming",
        "STREAM_ERROR"
      );
    }
  }
}
