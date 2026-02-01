import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

// ══════════════════════════════════════════════════════════════════════════════
// CHAT GRAPH STATE (Agent Loop Architecture)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The Chat Graph State using LangGraph Annotations.
 * 
 * This is a simplified state for the agent loop architecture.
 * The agent handles all routing decisions internally via tool calling.
 * 
 * Design Principles:
 * - Messages accumulate through the conversation (includes tool calls/results)
 * - Iteration count tracks loop progress for soft/hard limits
 * - Final response is extracted at the end
 */
export const ChatGraphState = Annotation.Root({
  // ═══════════════════════════════════════════════════════════════════════════
  // CORE INPUTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * The User ID - required for all operations.
   */
  userId: Annotation<string>,

  /**
   * Conversation history using LangGraph's built-in message reducer.
   * Includes: HumanMessage, AIMessage, ToolMessage, SystemMessage
   * Automatically handles message appending, ID management, and ordering.
   */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOP CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Current iteration count in the agent loop.
   * Used for soft limit (nudge) and hard limit (force exit).
   */
  iterationCount: Annotation<number>({
    reducer: (curr, next) => next,
    default: () => 0,
  }),

  /**
   * Flag indicating whether the agent loop should continue.
   * Set to false when agent produces final response or hits hard limit.
   */
  shouldContinue: Annotation<boolean>({
    reducer: (curr, next) => next,
    default: () => true,
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // OUTPUTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * The final generated response text.
   * Set when the agent decides to stop and respond.
   */
  responseText: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /**
   * Error message if the agent loop fails.
   */
  error: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),
});

// ══════════════════════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The full state type for the Chat Graph.
 * Use this for typing node functions and graph invocations.
 */
export type ChatGraphStateType = typeof ChatGraphState.State;
