import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { ProfileDocument } from "../../agents/profile/profile.generator";
import type { SubgraphResults } from "../../agents/chat/response.generator";
import type { RouteTarget } from "../../agents/chat/router.agent";

// ──────────────────────────────────────────────────────────────
// 1. ROUTING DECISION TYPES
// ──────────────────────────────────────────────────────────────

/**
 * Routing decision structure returned by the RouterAgent.
 */
export interface RoutingDecision {
  target: RouteTarget;
  confidence: number;
  reasoning: string;
  extractedContext?: string;
}

// ──────────────────────────────────────────────────────────────
// 2. STATE ANNOTATION
// ──────────────────────────────────────────────────────────────

/**
 * The Chat Graph State using LangGraph Annotations.
 * This serves as the central state bus for data flowing through the chat graph.
 * 
 * Design Principles:
 * - Uses messagesStateReducer for proper chat history management
 * - Intermediate states use merge reducers for accumulated updates
 * - Output states overwrite per conversation turn
 */
export const ChatGraphState = Annotation.Root({
  // === Messages (Chat History) ===
  /**
   * Conversation history using LangGraph's built-in message reducer.
   * Automatically handles message appending, ID management, and ordering.
   */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // === User Context ===
  /**
   * The User ID - required input for all DB operations.
   */
  userId: Annotation<string>,
  
  /**
   * Cached user profile for context enrichment.
   * Loaded at the start of each conversation turn.
   */
  userProfile: Annotation<ProfileDocument | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  
  /**
   * Formatted string of currently active intents.
   * Used by RouterAgent for context-aware routing decisions.
   */
  activeIntents: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => "",
  }),

  // === Routing State ===
  /**
   * The routing decision from RouterAgent.
   * Determines which subgraph or action path to follow.
   */
  routingDecision: Annotation<RoutingDecision | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  // === Subgraph Outputs ===
  /**
   * Accumulated outputs from subgraph processing.
   * Uses merge reducer to combine results from different subgraphs.
   */
  subgraphResults: Annotation<SubgraphResults>({
    reducer: (curr, next) => ({ ...curr, ...next }),
    default: () => ({}),
  }),

  // === Response Generation ===
  /**
   * The final generated response text.
   * Overwrites per conversation turn.
   */
  responseText: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /**
   * Suggested follow-up actions for the user.
   * Generated after the main response is streamed.
   */
  suggestedActions: Annotation<string[] | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  // === Error Handling ===
  /**
   * Error message if any step fails.
   * Used for graceful degradation and error reporting.
   */
  error: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),
});

// ──────────────────────────────────────────────────────────────
// 3. TYPE EXPORTS
// ──────────────────────────────────────────────────────────────

/**
 * The full state type for the Chat Graph.
 * Use this for typing node functions and graph invocations.
 */
export type ChatGraphStateType = typeof ChatGraphState.State;

/**
 * Re-export SubgraphResults for convenience.
 */
export type { SubgraphResults };
