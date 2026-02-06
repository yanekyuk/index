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

const logger = log.protocol.from("ChatGraphStreamingService");

// ══════════════════════════════════════════════════════════════════════════════
// TOOL DESCRIPTIONS (for user-friendly display)
// ══════════════════════════════════════════════════════════════════════════════

const TOOL_DESCRIPTIONS: Record<string, string> = {
  read_user_profiles: "Checking your profile...",
  create_user_profile: "Creating profile...",
  update_user_profile: "Updating your profile...",
  read_intents: "Fetching intents...",
  create_intent: "Creating new intent...",
  update_intent: "Updating intent...",
  delete_intent: "Removing intent...",
  read_indexes: "Checking your indexes...",
  create_index: "Creating index...",
  update_index: "Updating index...",
  delete_index: "Deleting index...",
  create_index_membership: "Adding member...",
  read_users: "Fetching members...",
  find_opportunities: "Searching for opportunities...",
  list_my_opportunities: "Listing your opportunities...",
  create_opportunity_between_members: "Creating suggested connection...",
  scrape_url: "Reading web content...",
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

      // Track state for event emission
      let currentIteration = 0;
      let toolsInCurrentIteration: string[] = [];
      let isGeneratingResponse = false;

      // Emit initial status
      yield createStatusEvent(sessionId, "Processing your message...");

      for await (const event of eventStream) {
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
          logger.debug("Tool response (streaming)", { toolName, output: typeof output === "string" ? output : output });

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
          const output = event.data?.output as { responseText?: string; error?: string } | undefined;
          const responseText = typeof output?.responseText === "string" ? output.responseText : "";
          const agentError = typeof output?.error === "string" ? output.error : undefined;
          logger.debug("Agent loop output", { output, responseText, agentError });
          if (agentError) {
            logger.warn("Agent loop returned error", { agentError });
            yield createErrorEvent(
              sessionId,
              agentError === "JSON error injected into SSE stream"
                ? "The response could not be sent correctly. Please try again."
                : agentError,
              "AGENT_ERROR"
            );
          }
          if (responseText) {
            yield createTokenEvent(sessionId, responseText);
          }
          logger.info("Agent loop complete", {
            iterations: currentIteration,
            totalTools: toolsInCurrentIteration.length,
            responseLength: responseText.length,
            hadError: !!agentError
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
