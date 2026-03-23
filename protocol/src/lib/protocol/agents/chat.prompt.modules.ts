import type { BaseMessage, AIMessage } from "@langchain/core/messages";

import type { ResolvedToolContext } from "../tools";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A conditional prompt section injected into the system prompt based on triggers.
 */
export interface PromptModule {
  /** Unique module identifier. */
  id: string;
  /** Tool names that activate this module. */
  triggers: string[];
  /** Module IDs to suppress when this module activates (unidirectional). */
  excludes?: string[];
  /** Optional filter applied after tool trigger match. Return false to skip despite trigger match. */
  triggerFilter?: (iterCtx: IterationContext) => boolean;
  /** User message pattern that activates this module (secondary trigger). */
  regex?: RegExp;
  /** Context predicate that activates this module (tertiary trigger). */
  context?: (ctx: ResolvedToolContext) => boolean;
  /** Returns the prompt text to inject. */
  content: (ctx: ResolvedToolContext) => string;
}

/**
 * State available to module resolution at each iteration.
 */
export interface IterationContext {
  /** Tool calls from all iterations since the last user message. */
  recentTools: Array<{ name: string; args: Record<string, unknown> }>;
  /** Text of the latest user message (for regex matching). */
  currentMessage?: string;
  /** Resolved tool context (user, profile, indexes, etc.). */
  ctx: ResolvedToolContext;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extracts tool calls from all AI messages since the last HumanMessage.
 *
 * Scans backwards to find the last HumanMessage, then collects all tool calls
 * from AIMessages after that point. This ensures multi-iteration tool history
 * is available for module resolution within a single user turn.
 *
 * @param messages - The current conversation message array
 * @returns Flattened array of tool name + args from the current agent turn
 */
export function extractRecentToolCalls(
  messages: BaseMessage[],
): Array<{ name: string; args: Record<string, unknown> }> {
  // Find the index of the last HumanMessage
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]._getType() === "human") {
      lastHumanIdx = i;
      break;
    }
  }

  // Collect tool calls from all AIMessages after the last HumanMessage
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const startIdx = lastHumanIdx + 1;

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i];
    if (msg._getType() === "ai") {
      const aiMsg = msg as AIMessage;
      const calls = aiMsg.tool_calls ?? [];
      for (const tc of calls) {
        toolCalls.push({
          name: tc.name,
          args: (tc.args ?? {}) as Record<string, unknown>,
        });
      }
    }
  }

  return toolCalls;
}
