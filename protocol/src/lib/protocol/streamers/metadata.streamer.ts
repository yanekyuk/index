import type { ChatStreamEvent } from "../../../types/chat-streaming.types";
import {
  createStatusEvent,
  createThinkingEvent,
  createToolStartEvent,
  createToolEndEvent,
  createAgentThinkingEvent,
} from "../../../types/chat-streaming.types";
import { protocolLogger } from "../support/protocol.logger";

const logger = protocolLogger("MetadataStreamer");

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
  create_intent_index: "Saving intent to index...",
  read_intent_indexes: "Fetching intents in index...",
  delete_intent_index: "Removing intent from index...",
  read_indexes: "Checking your indexes...",
  create_index: "Creating index...",
  update_index: "Updating index...",
  delete_index: "Deleting index...",
  create_index_membership: "Adding member...",
  read_index_memberships: "Fetching memberships...",
  create_opportunities: "Creating draft opportunities...",
  list_my_opportunities: "Listing your opportunities...",
  update_opportunity: "Updating opportunity...",
  scrape_url: "Reading web content...",
  read_docs: "Looking up protocol docs...",
};

// ══════════════════════════════════════════════════════════════════════════════
// PARAM FORMATTING
// ══════════════════════════════════════════════════════════════════════════════

/** Max characters for a single parameter value before truncating. */
const PARAM_VALUE_MAX = 120;

/**
 * Formats tool arguments into a compact, human-readable string for the thinking panel.
 * Skips empty/undefined values. Truncates long strings. Returns empty string when no args.
 */
function formatToolParams(args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  if (entries.length === 0) return "";

  const parts = entries.map(([key, value]) => {
    let display: string;
    if (typeof value === "string") {
      display = value.length > PARAM_VALUE_MAX
        ? value.slice(0, PARAM_VALUE_MAX) + "…"
        : value;
    } else if (Array.isArray(value)) {
      display = `[${value.length} item${value.length !== 1 ? "s" : ""}]`;
    } else if (typeof value === "object") {
      display = JSON.stringify(value);
      if (display.length > PARAM_VALUE_MAX) {
        display = display.slice(0, PARAM_VALUE_MAX) + "…";
      }
    } else {
      display = String(value);
    }
    return `  ${key}: ${display}`;
  });

  return parts.join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
// METADATA STREAMER
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Streams metadata events: tool execution tracking, agent iteration events,
 * and user-friendly status updates.
 *
 * Maintains per-stream state (iteration count, tools used in the current
 * iteration) so callers can create one instance per stream and feed graph
 * events into it.
 */
export class MetadataStreamer {
  private currentIteration = 0;
  private toolsInCurrentIteration: string[] = [];

  /**
   * Total tools invoked across all iterations (for summary logging).
   */
  get totalToolsUsed(): number {
    return this.currentIteration === 0
      ? this.toolsInCurrentIteration.length
      : this.toolsInCurrentIteration.length; // current batch; caller tracks total via events
  }

  get iterations(): number {
    return this.currentIteration;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Tool events
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Processes an `on_tool_start` graph event.
   * Returns tool_start + thinking (user-friendly description + params) stream events.
   */
  handleToolStart(sessionId: string, event: { name?: string; data?: { input?: Record<string, unknown> } }): ChatStreamEvent[] {
    const toolName = event.name || "unknown_tool";
    const toolArgs = event.data?.input || {};
    logger.info("Tool starting", { toolName, args: toolArgs });

    const description = TOOL_DESCRIPTIONS[toolName] || `Running ${toolName}...`;
    const paramsSummary = formatToolParams(toolArgs);
    const thinkingContent = paramsSummary
      ? `${description}\n${paramsSummary}`
      : description;

    this.toolsInCurrentIteration.push(toolName);

    return [
      createToolStartEvent(sessionId, toolName, toolArgs),
      createThinkingEvent(sessionId, thinkingContent, toolName),
    ];
  }

  /**
   * Processes an `on_tool_end` graph event.
   * Returns a tool_end stream event with a brief result summary.
   */
  handleToolEnd(sessionId: string, event: { name?: string; data?: { output?: unknown } }): ChatStreamEvent[] {
    const toolName = event.name || "unknown_tool";
    const output = event.data?.output;
    logger.debug("Tool response (streaming)", {
      toolName,
      output: typeof output === "string" ? output : output,
    });

    // Parse output to determine success
    let success = true;
    let resultSummary: string | undefined;

    if (typeof output === "string") {
      try {
        const parsed = JSON.parse(output);
        success = parsed.success !== false;
        if (parsed.data) {
          if (parsed.data.profile) {
            resultSummary = `Profile: ${parsed.data.profile.name || "loaded"}`;
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

    return [createToolEndEvent(sessionId, toolName, success, resultSummary)];
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Agent iteration events
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Processes an `on_chat_model_end` graph event.
   *
   * If the model produced tool calls, this is an intermediate iteration →
   * returns an `agent_thinking` event and resets per-iteration tool tracking.
   *
   * If no tool calls, the agent is about to emit its final response →
   * returns a `status` event and signals that the response phase has begun.
   *
   * @returns An object with the events to yield and a flag indicating whether
   *          the agent is now generating its final response.
   */
  handleChatModelEnd(
    sessionId: string,
    event: { data?: { output?: { tool_calls?: unknown[] } } }
  ): { events: ChatStreamEvent[]; isGeneratingResponse: boolean } {
    const response = event.data?.output;
    const hasToolCalls = response?.tool_calls && response.tool_calls.length > 0;

    if (hasToolCalls) {
      this.currentIteration++;
      const events = [createAgentThinkingEvent(sessionId, this.currentIteration, this.toolsInCurrentIteration)];
      // Reset for next iteration
      this.toolsInCurrentIteration = [];
      return { events, isGeneratingResponse: false };
    }

    // Agent is generating final response
    return {
      events: [createStatusEvent(sessionId, "Generating response...")],
      isGeneratingResponse: true,
    };
  }
}
