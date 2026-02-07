/**
 * SSE Event types for Chat Graph streaming.
 *
 * These types define the structure of events sent during streaming chat responses.
 * Events are sent as Server-Sent Events (SSE) with JSON payloads.
 */

// Event type discriminator
export type ChatStreamEventType =
  | 'status'
  | 'routing'
  | 'thinking'
  | 'subgraph_start'
  | 'subgraph_result'
  | 'token'
  | 'done'
  | 'error'
  // Agent Loop Architecture events
  | 'tool_start'
  | 'tool_end'
  | 'agent_thinking';

/**
 * Base interface for all chat stream events.
 */
export interface ChatStreamEventBase {
  /** Event type discriminator */
  type: ChatStreamEventType;
  /** Session ID for the chat session */
  sessionId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Status event - sent to indicate processing state changes.
 */
export interface StatusEvent extends ChatStreamEventBase {
  type: 'status';
  /** Human-readable status message */
  message: string;
}

/**
 * Routing event - sent when the router determines which subgraph to use.
 */
export interface RoutingEvent extends ChatStreamEventBase {
  type: 'routing';
  /** Target subgraph name */
  target: string;
  /** Optional reasoning for the routing decision */
  reasoning?: string;
}

/**
 * Thinking event - sent to stream the model's reasoning and decision-making process.
 */
export interface ThinkingEvent extends ChatStreamEventBase {
  type: 'thinking';
  /** The thinking/reasoning content */
  content: string;
  /** Optional step identifier (e.g., 'router', 'inference', 'verification') */
  step?: string;
}

/**
 * Subgraph start event - sent when a subgraph begins processing.
 */
export interface SubgraphStartEvent extends ChatStreamEventBase {
  type: 'subgraph_start';
  /** Name of the subgraph being executed */
  subgraph: string;
}

/**
 * Subgraph result event - sent when a subgraph completes with results.
 */
export interface SubgraphResultEvent extends ChatStreamEventBase {
  type: 'subgraph_result';
  /** Name of the subgraph that completed */
  subgraph: string;
  /** Result data from the subgraph */
  data: Record<string, unknown>;
}

/**
 * Token event - sent for each token during streaming response.
 */
export interface TokenEvent extends ChatStreamEventBase {
  type: 'token';
  /** Token content (partial text) */
  content: string;
}

/**
 * Done event - sent when the response is complete.
 */
export interface DoneEvent extends ChatStreamEventBase {
  type: 'done';
  /** Complete response text */
  response: string;
  /** Optional routing decision metadata */
  routingDecision?: Record<string, unknown>;
  /** Optional subgraph results metadata */
  subgraphResults?: Record<string, unknown>;
  /** Optional session title (auto-generated or existing) */
  title?: string;
}

/**
 * Error event - sent when an error occurs.
 */
export interface ErrorEvent extends ChatStreamEventBase {
  type: 'error';
  /** Human-readable error message */
  message: string;
  /** Optional error code for programmatic handling */
  code?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT LOOP ARCHITECTURE EVENTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Tool start event - sent when a tool begins executing.
 */
export interface ToolStartEvent extends ChatStreamEventBase {
  type: 'tool_start';
  /** Name of the tool being executed */
  toolName: string;
  /** Arguments passed to the tool */
  toolArgs: Record<string, unknown>;
}

/**
 * Tool end event - sent when a tool finishes executing.
 */
export interface ToolEndEvent extends ChatStreamEventBase {
  type: 'tool_end';
  /** Name of the tool that completed */
  toolName: string;
  /** Whether the tool execution succeeded */
  success: boolean;
  /** Brief summary of the result */
  resultSummary?: string;
}

/**
 * Agent thinking event - sent between agent iterations.
 */
export interface AgentThinkingEvent extends ChatStreamEventBase {
  type: 'agent_thinking';
  /** Current iteration number */
  iteration: number;
  /** Tools used in this iteration */
  toolsUsed: string[];
}

/**
 * Union type of all chat stream events.
 */
export type ChatStreamEvent =
  | StatusEvent
  | RoutingEvent
  | ThinkingEvent
  | SubgraphStartEvent
  | SubgraphResultEvent
  | TokenEvent
  | DoneEvent
  | ErrorEvent
  // Agent Loop Architecture events
  | ToolStartEvent
  | ToolEndEvent
  | AgentThinkingEvent;

/**
 * Formats a chat stream event as an SSE message. If JSON.stringify throws (e.g. circular ref,
 * non-serializable value), returns a minimal error event so the stream stays valid.
 *
 * @param event - The event to format
 * @returns SSE-formatted string with "data: " prefix and double newline
 */
export function formatSSEEvent(event: ChatStreamEvent): string {
  try {
    return `data: ${JSON.stringify(event)}\n\n`;
  } catch (serializeError) {
    const fallback: ErrorEvent = {
      type: "error",
      sessionId: typeof (event as ChatStreamEventBase).sessionId === "string" ? (event as ChatStreamEventBase).sessionId : "unknown",
      timestamp: new Date().toISOString(),
      message: "Response could not be serialized. Please try again.",
      code: "SERIALIZATION_ERROR",
    };
    return `data: ${JSON.stringify(fallback)}\n\n`;
  }
}

/**
 * Creates a chat stream event with common fields populated.
 *
 * @param type - Event type
 * @param sessionId - Session ID
 * @param data - Event-specific data (excluding type, sessionId, timestamp)
 * @returns Complete event object
 *
 * @example
 * ```ts
 * const statusEvent = createStreamEvent<StatusEvent>('status', 'session-123', {
 *   message: 'Processing your request...'
 * });
 * ```
 */
export function createStreamEvent<T extends ChatStreamEvent>(
  type: T['type'],
  sessionId: string,
  data: Omit<T, 'type' | 'sessionId' | 'timestamp'>
): T {
  return {
    type,
    sessionId,
    timestamp: new Date().toISOString(),
    ...data,
  } as T;
}

/**
 * Type guard to check if an event is a specific type.
 */
export function isEventType<T extends ChatStreamEvent>(
  event: ChatStreamEvent,
  type: T['type']
): event is T {
  return event.type === type;
}

/**
 * Creates a formatted status event.
 */
export function createStatusEvent(sessionId: string, message: string): StatusEvent {
  return createStreamEvent<StatusEvent>('status', sessionId, { message });
}

/**
 * Creates a formatted routing event.
 */
export function createRoutingEvent(sessionId: string, target: string, reasoning?: string): RoutingEvent {
  return createStreamEvent<RoutingEvent>('routing', sessionId, { target, reasoning });
}

/**
 * Creates a formatted subgraph start event.
 */
export function createSubgraphStartEvent(sessionId: string, subgraph: string): SubgraphStartEvent {
  return createStreamEvent<SubgraphStartEvent>('subgraph_start', sessionId, { subgraph });
}

/**
 * Creates a formatted subgraph result event.
 */
export function createSubgraphResultEvent(
  sessionId: string,
  subgraph: string,
  data: Record<string, unknown>
): SubgraphResultEvent {
  return createStreamEvent<SubgraphResultEvent>('subgraph_result', sessionId, { subgraph, data });
}

/**
 * Creates a formatted token event.
 */
export function createTokenEvent(sessionId: string, content: string): TokenEvent {
  return createStreamEvent<TokenEvent>('token', sessionId, { content });
}

/**
 * Creates a formatted done event.
 */
export function createDoneEvent(
  sessionId: string,
  response: string,
  routingDecision?: Record<string, unknown>,
  subgraphResults?: Record<string, unknown>,
  title?: string
): DoneEvent {
  return createStreamEvent<DoneEvent>('done', sessionId, {
    response,
    routingDecision,
    subgraphResults,
    title
  });
}

/**
 * Creates a formatted error event.
 */
export function createErrorEvent(sessionId: string, message: string, code?: string): ErrorEvent {
  return createStreamEvent<ErrorEvent>('error', sessionId, { message, code });
}

/**
 * Creates a formatted thinking event.
 */
export function createThinkingEvent(sessionId: string, content: string, step?: string): ThinkingEvent {
  return createStreamEvent<ThinkingEvent>('thinking', sessionId, { content, step });
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT LOOP EVENT CREATORS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Creates a formatted tool start event.
 */
export function createToolStartEvent(
  sessionId: string,
  toolName: string,
  toolArgs: Record<string, unknown>
): ToolStartEvent {
  return createStreamEvent<ToolStartEvent>('tool_start', sessionId, { toolName, toolArgs });
}

/**
 * Creates a formatted tool end event.
 */
export function createToolEndEvent(
  sessionId: string,
  toolName: string,
  success: boolean,
  resultSummary?: string
): ToolEndEvent {
  return createStreamEvent<ToolEndEvent>('tool_end', sessionId, { toolName, success, resultSummary });
}

/**
 * Creates a formatted agent thinking event.
 */
export function createAgentThinkingEvent(
  sessionId: string,
  iteration: number,
  toolsUsed: string[]
): AgentThinkingEvent {
  return createStreamEvent<AgentThinkingEvent>('agent_thinking', sessionId, { iteration, toolsUsed });
}
