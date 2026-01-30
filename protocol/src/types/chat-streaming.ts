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
  | 'error';

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
  | ErrorEvent;

/**
 * Formats a chat stream event as an SSE message.
 * 
 * @param event - The event to format
 * @returns SSE-formatted string with "data: " prefix and double newline
 * 
 * @example
 * ```ts
 * const event: TokenEvent = {
 *   type: 'token',
 *   sessionId: 'abc-123',
 *   timestamp: new Date().toISOString(),
 *   content: 'Hello'
 * };
 * res.write(formatSSEEvent(event));
 * // Output: "data: {"type":"token","sessionId":"abc-123","timestamp":"...","content":"Hello"}\n\n"
 * ```
 */
export function formatSSEEvent(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
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
  subgraphResults?: Record<string, unknown>
): DoneEvent {
  return createStreamEvent<DoneEvent>('done', sessionId, { 
    response, 
    routingDecision, 
    subgraphResults 
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
