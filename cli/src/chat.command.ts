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

/**
 * Read an SSE Response body, dispatch token content to `onToken`, and
 * return a summary result once the stream ends.
 *
 * The protocol server emits `data: {JSON}\n\n` events where the JSON
 * payload contains a `type` field. The key event types for CLI rendering:
 *
 * - `token`          — incremental text; `content` is appended to output
 * - `status`         — processing status; forwarded to `onStatus`
 * - `tool_activity`  — tool narration; forwarded to `onStatus`
 * - `response_reset` — discard accumulated tokens (hallucination recovery)
 * - `done`           — final event with `sessionId`, `response`, `title`
 * - `error`          — error event with `message`
 *
 * @param response - The raw fetch Response with SSE body.
 * @param onToken - Called for each text token (for real-time rendering).
 * @param onStatus - Optional callback for status/activity messages.
 * @returns A summary of the completed stream.
 */
export async function renderSSEStream(
  response: Response,
  onToken: (text: string) => void,
  onStatus?: (message: string) => void,
): Promise<StreamResult> {
  const result: StreamResult = {};

  if (!response.body) {
    result.error = "No response body";
    return result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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

        // Each line should be "data: {JSON}"
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data:")) continue;

          const jsonStr = line.slice("data:".length).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr) as Record<string, unknown>;
            const type = event.type as string;

            switch (type) {
              case "token":
                if (typeof event.content === "string") {
                  onToken(event.content);
                }
                break;

              case "status":
                if (onStatus && typeof event.message === "string") {
                  onStatus(event.message);
                }
                break;

              case "tool_activity":
                if (onStatus && typeof event.description === "string") {
                  onStatus(event.description);
                }
                break;

              case "response_reset":
                // The agent detected a hallucination and is retrying.
                // Clear accumulated response — new tokens will follow.
                result.response = undefined;
                if (onStatus && typeof event.reason === "string") {
                  onStatus(`Retrying: ${event.reason}`);
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

              // Ignore all other event types (routing, debug_meta, etc.)
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
