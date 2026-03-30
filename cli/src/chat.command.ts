/**
 * Chat command implementation — renders SSE streams from the protocol
 * server to the terminal and manages interactive REPL sessions.
 */

/** Result of processing one SSE stream. */
export interface StreamResult {
  sessionId?: string;
  response?: string;
  title?: string;
  error?: string;
}

/** Callbacks for stream rendering. */
export interface StreamCallbacks {
  onToken: (text: string) => void;
  onStatus?: (message: string) => void;
  /**
   * Tool activity from the protocol — uses the server's own human-friendly
   * description string. Phase is "start" or "end".
   */
  onToolActivity?: (description: string, phase: "start" | "end", success?: boolean) => void;
  /** Called when the agent detects a hallucination and resets its response. */
  onResponseReset?: (reason?: string) => void;
}

/**
 * Read an SSE Response body, dispatch token content to callbacks, and
 * return a summary result once the stream ends.
 *
 * The protocol emits `tool_activity` events with human-friendly descriptions
 * (e.g. "Proposing a new signal for game development"). These are the
 * canonical tool call indicators — `tool_start`/`tool_end` events are only
 * used to track the insideToolCall state for token suppression, not displayed.
 */
export async function renderSSEStream(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<StreamResult> {
  const { onToken, onStatus, onToolActivity, onResponseReset } = callbacks;
  const result: StreamResult = {};

  if (!response.body) {
    result.error = "No response body";
    return result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /** Tracks whether we're inside a tool call (suppress tool-name tokens). */
  let insideToolCall = false;
  /** Maps toolName -> human-friendly description from the start event. */
  const toolDescriptions = new Map<string, string>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete events (delimited by double newline)
      while (buffer.includes("\n\n")) {
        const idx = buffer.indexOf("\n\n");
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of raw.split("\n")) {
          if (!line.startsWith("data:")) continue;

          const jsonStr = line.slice("data:".length).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr) as Record<string, unknown>;
            const type = event.type as string;

            switch (type) {
              case "token": {
                if (typeof event.content !== "string") break;
                if (insideToolCall) break;
                onToken(event.content);
                break;
              }

              case "status":
                if (onStatus && typeof event.message === "string") {
                  onStatus(event.message);
                }
                break;

              case "tool_activity": {
                const phase = event.phase as string;
                const toolName = typeof event.toolName === "string" ? event.toolName : "";
                const desc = typeof event.description === "string" ? event.description : undefined;

                if (phase === "start") {
                  insideToolCall = true;
                  // Store the human-friendly description from the start event
                  if (desc && toolName) {
                    toolDescriptions.set(toolName, desc);
                  }
                  if (onToolActivity && desc) {
                    onToolActivity(desc, "start");
                  }
                } else if (phase === "end") {
                  insideToolCall = false;
                  // Reuse the start description — end events often have the raw tool name
                  const startDesc = toolName ? toolDescriptions.get(toolName) : undefined;
                  if (onToolActivity) {
                    onToolActivity(startDesc ?? desc ?? toolName, "end", event.success !== false);
                  }
                  if (toolName) toolDescriptions.delete(toolName);
                }
                break;
              }

              case "tool_start":
                // Only used for token suppression — tool_activity handles display.
                insideToolCall = true;
                break;

              case "tool_end":
                insideToolCall = false;
                break;

              case "llm_start":
                insideToolCall = false;
                break;

              case "response_reset":
                result.response = undefined;
                if (onResponseReset) {
                  onResponseReset(typeof event.reason === "string" ? event.reason : undefined);
                }
                break;

              case "done":
                result.sessionId =
                  typeof event.sessionId === "string"
                    ? event.sessionId
                    : undefined;
                result.response =
                  typeof event.response === "string"
                    ? event.response
                    : undefined;
                result.title =
                  typeof event.title === "string" ? event.title : undefined;
                break;

              case "error":
                result.error =
                  typeof event.message === "string"
                    ? event.message
                    : "Unknown stream error";
                break;

              default:
                break;
            }
          } catch {
            // Malformed JSON line — skip.
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return result;
}
