/**
 * Chat Graph Module
 *
 * Exports the Chat Graph factory, state definitions, checkpointer utilities,
 * and token management functions.
 */

// Chat Graph Factory
export { ChatGraphFactory } from "./chat.graph";

// State definitions
export { ChatGraphState } from "./chat.graph.state";
export type {
  ChatGraphStateType,
  RoutingDecision,
  SubgraphResults
} from "./chat.graph.state";

// Router types (re-exported for convenience)
export type { RouteTarget } from "../../agents/chat/router.agent";

// Checkpointer utilities for conversation persistence
export {
  getCheckpointer,
  createCheckpointer,
  resetCheckpointer
} from "./checkpointer";

// Token utilities for context window management
export {
  estimateTokenCount,
  estimateMessageTokens,
  truncateToTokenLimit,
  prepareContextWindow,
  toLangChainMessages,
  calculateTotalTokens,
  exceedsTokenLimit,
  MAX_CONTEXT_TOKENS,
  RESERVED_RESPONSE_TOKENS,
  DEFAULT_CONTEXT_CONFIG,
} from "./token-utils";
export type { ContextWindowConfig } from "./token-utils";
