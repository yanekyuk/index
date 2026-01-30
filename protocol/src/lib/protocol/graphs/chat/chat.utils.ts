/**
 * Token Utilities for Context Window Management
 *
 * Provides utilities for estimating token counts and managing context windows
 * to ensure messages fit within model token limits.
 *
 * CONTEXT:
 * - Most LLMs have context window limits (e.g., 8k, 16k, 128k tokens)
 * - We need to truncate old messages to fit new conversation within limits
 * - Uses a simple heuristic estimate (~4 chars per token for English text)
 *
 * NOTE: For more accurate token counting, consider using tiktoken:
 *   import { encodingForModel } from "js-tiktoken";
 *   const enc = encodingForModel("gpt-4");
 *   const tokens = enc.encode(text).length;
 */

import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";

/**
 * Default maximum tokens to allow for context.
 * Reserves space for system prompt and response generation.
 */
export const MAX_CONTEXT_TOKENS = 8000;

/**
 * Minimum tokens to reserve for the model's response.
 */
export const RESERVED_RESPONSE_TOKENS = 2000;

/**
 * Estimate token count for a string using a simple heuristic.
 *
 * This uses a rough estimate of ~4 characters per token, which works
 * reasonably well for English text. For more accuracy with specific
 * models, use tiktoken or the model's native tokenizer.
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  // Rough estimate: ~4 characters per token for English
  // This tends to slightly overestimate, which is safer for truncation
  return Math.ceil(text.length / 4);
}

/**
 * Estimate token count for a message, including role overhead.
 *
 * @param message - The LangChain message to estimate
 * @returns Estimated token count including message overhead
 */
export function estimateMessageTokens(message: BaseMessage): number {
  const content =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);

  // Add ~4 tokens overhead per message for role and formatting
  return estimateTokenCount(content) + 4;
}

/**
 * Truncate messages to fit within token limit, keeping most recent messages.
 *
 * Messages are processed from newest to oldest, accumulating until the
 * token limit is reached. The first message (usually system) is always
 * kept if present.
 *
 * @param messages - Array of messages to truncate
 * @param maxTokens - Maximum total tokens allowed (default: MAX_CONTEXT_TOKENS)
 * @returns Array of messages that fit within the token limit
 */
export function truncateToTokenLimit(
  messages: BaseMessage[],
  maxTokens: number = MAX_CONTEXT_TOKENS
): BaseMessage[] {
  if (messages.length === 0) return [];

  // Calculate available tokens (reserve space for response)
  const availableTokens = maxTokens - RESERVED_RESPONSE_TOKENS;

  // If only one message, return it (truncation within message not supported)
  if (messages.length === 1) {
    return messages;
  }

  let totalTokens = 0;
  const result: BaseMessage[] = [];

  // Check if first message is a system message (should always be kept)
  const firstMessage = messages[0];
  const hasSystemMessage = firstMessage._getType() === "system";

  if (hasSystemMessage) {
    const systemTokens = estimateMessageTokens(firstMessage);
    totalTokens += systemTokens;
    result.push(firstMessage);
  }

  // Process remaining messages from newest to oldest
  const remainingMessages = hasSystemMessage ? messages.slice(1) : messages;
  const recentMessages: BaseMessage[] = [];

  for (let i = remainingMessages.length - 1; i >= 0; i--) {
    const msg = remainingMessages[i];
    const msgTokens = estimateMessageTokens(msg);

    if (totalTokens + msgTokens > availableTokens) {
      // Stop adding more messages
      break;
    }

    recentMessages.unshift(msg);
    totalTokens += msgTokens;
  }

  // Combine system message (if any) with recent messages
  return hasSystemMessage ? [firstMessage, ...recentMessages] : recentMessages;
}

/**
 * Configuration options for context window management.
 */
export interface ContextWindowConfig {
  /** Maximum total tokens for the context window */
  maxTokens: number;
  /** Tokens to reserve for the model's response */
  reserveTokens: number;
  /** Strategy for handling overflow: 'oldest_first' removes oldest, 'summarize' (future) */
  truncationStrategy: "oldest_first" | "summarize";
}

/**
 * Default context window configuration.
 */
export const DEFAULT_CONTEXT_CONFIG: ContextWindowConfig = {
  maxTokens: MAX_CONTEXT_TOKENS,
  reserveTokens: RESERVED_RESPONSE_TOKENS,
  truncationStrategy: "oldest_first",
};

/**
 * Prepare messages for a context window with the given configuration.
 *
 * This function handles truncation while respecting:
 * - Maximum token limits
 * - Reserved tokens for response
 * - System message preservation
 *
 * @param messages - Array of messages to prepare
 * @param config - Context window configuration
 * @returns Array of messages that fit within the configured limits
 */
export function prepareContextWindow(
  messages: BaseMessage[],
  config: ContextWindowConfig = DEFAULT_CONTEXT_CONFIG
): BaseMessage[] {
  const { maxTokens, reserveTokens, truncationStrategy } = config;

  if (truncationStrategy === "summarize") {
    // TODO: Implement summarization strategy
    // For now, fall back to oldest_first
    console.warn(
      "[token-utils] 'summarize' strategy not yet implemented, using 'oldest_first'"
    );
  }

  const effectiveMax = maxTokens - reserveTokens;
  return truncateToTokenLimit(messages, effectiveMax + reserveTokens);
}

/**
 * Convert database chat messages to LangChain message format.
 *
 * @param dbMessages - Messages from database with role and content
 * @returns Array of LangChain BaseMessage objects
 */
export function toLangChainMessages(
  dbMessages: Array<{ role: string; content: string }>
): BaseMessage[] {
  return dbMessages.map((msg) => {
    switch (msg.role) {
      case "user":
        return new HumanMessage(msg.content);
      case "assistant":
        return new AIMessage(msg.content);
      case "system":
        return new SystemMessage(msg.content);
      default:
        // Default to human message for unknown roles
        return new HumanMessage(msg.content);
    }
  });
}

/**
 * Calculate total estimated tokens for an array of messages.
 *
 * @param messages - Array of messages to count
 * @returns Total estimated token count
 */
export function calculateTotalTokens(messages: BaseMessage[]): number {
  return messages.reduce((total, msg) => total + estimateMessageTokens(msg), 0);
}

/**
 * Check if a set of messages exceeds the token limit.
 *
 * @param messages - Array of messages to check
 * @param maxTokens - Maximum allowed tokens
 * @returns True if messages exceed the limit
 */
export function exceedsTokenLimit(
  messages: BaseMessage[],
  maxTokens: number = MAX_CONTEXT_TOKENS
): boolean {
  return calculateTotalTokens(messages) > maxTokens;
}
