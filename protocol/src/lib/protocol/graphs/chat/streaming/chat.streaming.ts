import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import type { ChatStreamEvent, ToolStartEvent, ToolEndEvent, AgentThinkingEvent } from "../../../../../types/chat-streaming";
import {
  createStatusEvent,
  createThinkingEvent,
  createTokenEvent,
  createErrorEvent,
  createToolStartEvent,
  createToolEndEvent,
  createAgentThinkingEvent,
} from "../../../../../types/chat-streaming";
import { log } from "../../../../log";

const logger = log.graph.from("chat.streaming.ts");

// ══════════════════════════════════════════════════════════════════════════════
// TOOL DESCRIPTIONS (for user-friendly display)
// ══════════════════════════════════════════════════════════════════════════════

const TOOL_DESCRIPTIONS: Record<string, string> = {
  get_user_profile: "Checking your profile...",
  update_user_profile: "Updating your profile...",
  get_active_intents: "Fetching your intents...",
  get_intents_in_index: "Fetching intents in that index...",
  create_intent: "Creating new intent...",
  update_intent: "Updating intent...",
  delete_intent: "Removing intent...",
  get_index_memberships: "Checking your indexes...",
  update_index_settings: "Updating index settings...",
  find_opportunities: "Searching for opportunities...",
  scrape_url: "Reading web content..."
};

// ══════════════════════════════════════════════════════════════════════════════
// STREAMING SERVICE (Agent Loop Architecture)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Streaming service for Chat Graph events.
 * Handles SSE event streaming for real-time chat interactions.
 * 
 * Updated for Agent Loop Architecture:
 * - Emits tool_start/tool_end events instead of node-based events
 * - Tracks agent iterations
 * - Streams final response tokens
 */
export class ChatGraphStreamingService {
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
    },
    checkpointer?: MemorySaver | PostgresSaver
  ): AsyncGenerator<ChatStreamEvent> {
    const { userId, message, sessionId, maxContextMessages = 20 } = input;

    logger.info("Starting context-aware streaming", {
      userId,
      sessionId,
      maxContextMessages,
      hasCheckpointer: !!checkpointer,
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
        { userId, messages: allMessages },
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
   * @param input - The input state for the graph (userId and messages)
   * @param sessionId - The session ID for event attribution
   * @param checkpointer - Optional checkpointer for persistence
   * @yields ChatStreamEvent objects
   */
  public async *streamChatEvents(
    input: { userId: string; messages: BaseMessage[] },
    sessionId: string,
    checkpointer?: MemorySaver | PostgresSaver
  ): AsyncGenerator<ChatStreamEvent> {
    const graph = this.createStreamingGraph(checkpointer);

    try {
      // Stream events from the graph
      const eventStream = graph.streamEvents(
        {
          userId: input.userId,
          messages: input.messages
        },
        {
          version: "v2",
          configurable: { thread_id: sessionId }
        }
      );

      // Track state for event emission
      let currentIteration = 0;
      let toolsInCurrentIteration: string[] = [];
      let isGeneratingResponse = false;

      // Emit initial status
      yield createStatusEvent(sessionId, "Processing your message...");

      for await (const event of eventStream) {
        // #region agent log
        if (event.event === "on_chat_model_stream" || (event.event === "on_chain_end" && event.name === "agent_loop")) {
          const chunkContent = event.event === "on_chat_model_stream" ? (event.data?.chunk?.content ?? "") : (typeof event.data?.output?.responseText === "string" ? event.data.output.responseText : "");
          fetch('http://127.0.0.1:7242/ingest/9e8c82c7-69e7-439d-9a66-0d60a0032c44',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.streaming.ts:event',message:'H3/H4: streamEvents token source',data:{event:event.event,eventName:event.name,isGeneratingResponse,contentPreview:String(chunkContent).substring(0,300),hasClassification:String(chunkContent).includes('"classification"')},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
        }
        // #endregion
        // ─────────────────────────────────────────────────────────────────────
        // TOOL EVENTS
        // ─────────────────────────────────────────────────────────────────────

        if (event.event === "on_tool_start") {
          const toolName = event.name || "unknown_tool";
          const toolArgs = event.data?.input || {};

          logger.info("Tool starting", { toolName, args: toolArgs });

          // Emit tool start event
          yield createToolStartEvent(sessionId, toolName, toolArgs);

          // Emit user-friendly thinking event
          const description = TOOL_DESCRIPTIONS[toolName] || `Running ${toolName}...`;
          yield createThinkingEvent(sessionId, description, toolName);

          toolsInCurrentIteration.push(toolName);
        }

        if (event.event === "on_tool_end") {
          const toolName = event.name || "unknown_tool";
          const output = event.data?.output;
          logger.debug("Tool response (streaming)", { toolName, output: typeof output === "string" ? output : JSON.stringify(output) });

          // Parse output to determine success
          let success = true;
          let resultSummary: string | undefined;

          if (typeof output === "string") {
            try {
              const parsed = JSON.parse(output);
              success = parsed.success !== false;
              if (parsed.data) {
                // Create a brief summary of the result
                if (parsed.data.profile) {
                  resultSummary = `Profile: ${parsed.data.profile.name || 'loaded'}`;
                } else if (parsed.data.intents) {
                  resultSummary = `${parsed.data.intents.length} intent(s) found`;
                } else if (parsed.data.created) {
                  resultSummary = "Created successfully";
                } else if (parsed.data.updated) {
                  resultSummary = "Updated successfully";
                } else if (parsed.data.deleted) {
                  resultSummary = "Deleted successfully";
                } else if (parsed.data.opportunities) {
                  resultSummary = `${parsed.data.opportunities.length} opportunity(ies) found`;
                }
              }
              if (parsed.error) {
                resultSummary = parsed.error;
              }
            } catch {
              resultSummary = "Completed";
            }
          }

          logger.info("Tool completed", { toolName, success, resultSummary });

          yield createToolEndEvent(sessionId, toolName, success, resultSummary);
        }

        // ─────────────────────────────────────────────────────────────────────
        // AGENT ITERATION EVENTS
        // ─────────────────────────────────────────────────────────────────────

        // Detect when agent loop makes a decision (AIMessage without tool calls = responding)
        if (event.event === "on_chat_model_end") {
          const response = event.data?.output;

          // Check if this is a tool-calling response or final response
          const hasToolCalls = response?.tool_calls && response.tool_calls.length > 0;

          if (hasToolCalls) {
            // Agent is continuing with more tools
            currentIteration++;
            
            yield createAgentThinkingEvent(sessionId, currentIteration, toolsInCurrentIteration);
            
            // Reset for next iteration
            toolsInCurrentIteration = [];
          } else {
            // Agent is generating final response
            isGeneratingResponse = true;
            yield createStatusEvent(sessionId, "Generating response...");
          }
        }

        // ─────────────────────────────────────────────────────────────────────
        // TOKEN STREAMING
        // Do NOT emit from on_chat_model_stream: streamEvents yields events from
        // ALL model invocations, including nested ones (ExplicitIntentInferrer,
        // SemanticVerifier, IntentReconciler, IntentIndexer) inside tools. Those
        // emit structured JSON (classification, felicity_scores, actions, etc.)
        // which must not reach the user. The chat agent uses model.invoke() so we
        // don't get token-by-token stream anyway. We only emit the clean final
        // response from on_chain_end (agent_loop output).
        // ─────────────────────────────────────────────────────────────────────

        // ─────────────────────────────────────────────────────────────────────
        // GRAPH COMPLETION (Agent loop architecture)
        // The agent runs inside the node with model.invoke() (non-streaming), so
        // we never get on_chat_model_stream. Emit the final responseText from the
        // node output so the controller can persist it and the client can display it.
        // ─────────────────────────────────────────────────────────────────────

        if (event.event === "on_chain_end" && event.name === "agent_loop") {
          const output = event.data?.output;
          const responseText = typeof output?.responseText === "string" ? output.responseText : "";
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/9e8c82c7-69e7-439d-9a66-0d60a0032c44',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat.streaming.ts:emit_token',message:'H4: Emitting token from on_chain_end',data:{responsePreview:responseText.substring(0,400),hasClassification:responseText.includes('"classification"'),willEmit:!!responseText},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H4'})}).catch(()=>{});
          // #endregion
          logger.debug("Agent loop output", { output: JSON.stringify(output), responseText });
          if (responseText) {
            yield createTokenEvent(sessionId, responseText);
          }
          logger.info("Agent loop complete", {
            iterations: currentIteration,
            totalTools: toolsInCurrentIteration.length,
            responseLength: responseText.length
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
