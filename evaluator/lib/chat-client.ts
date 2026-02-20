import { normalizeBlockquotes } from "./markdown";

export interface SendMessageResult {
  sessionId: string;
  response: string;
  error?: string;
}

function applyEvent(
  json: { type?: string; sessionId?: string; content?: string; response?: string; message?: string },
  state: { sessionId: string; response: string }
): { stop: boolean; error?: string } {
  switch (json.type) {
    case "status":
    case "routing":
    case "thinking":
    case "token":
      if (json.sessionId) state.sessionId = json.sessionId;
      if (json.type === "token" && json.content) state.response += json.content;
      break;
    case "done":
      if (json.sessionId) state.sessionId = json.sessionId;
      if (typeof json.response === "string") state.response = json.response;
      break;
    case "error":
      return {
        stop: true,
        error: json.message ?? "Unknown error",
      };
  }
  return { stop: false };
}

type SessionResponse = SendMessageResult;

function processLines(
  lines: string[],
  state: { sessionId: string; response: string }
): SessionResponse | null {
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const json = JSON.parse(line.slice(6)) as Parameters<typeof applyEvent>[0];
        const result = applyEvent(json, state);
        if (result.stop) {
          return {
            sessionId: json.sessionId ?? state.sessionId,
            response: normalizeBlockquotes(state.response),
            error: result.error,
          };
        }
      } catch {
        // Skip malformed lines
      }
    }
  }
  return null;
}

/**
 * Send a message to the protocol chat stream API and accumulate the response.
 * Parses SSE events: status (sessionId), token (content), done (response), error.
 * Uses the full response from the "done" event when present (streaming sends
 * the complete message there). Normalizes markdown the same way as the frontend
 * (e.g. blockquotes) so the evaluator sees the same content as the UI.
 *
 * Supports either Bearer token or cookie-based authentication.
 */
export async function sendMessage(
  apiUrl: string,
  token: string,
  options: { message: string; sessionId?: string; cookie?: string }
): Promise<SendMessageResult> {
  const url = `${apiUrl.replace(/\/$/, "")}/chat/stream`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.cookie) {
    headers["Cookie"] = options.cookie;
  } else {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: options.message,
      sessionId: options.sessionId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      sessionId: options.sessionId ?? "",
      response: "",
      error: `HTTP ${res.status}: ${text}`,
    };
  }

  const reader = res.body?.getReader();
  if (!reader) {
    return {
      sessionId: options.sessionId ?? "",
      response: "",
      error: "No response body",
    };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const state = { sessionId: options.sessionId ?? "", response: "" };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    const result = processLines(lines, state);
    if (result) return result;
  }

  // Flush remaining buffer: process every complete "data: " line so we don't miss the done event
  if (buffer) {
    const lines = buffer.split("\n");
    const flushed = processLines(lines, state);
    if (flushed) return flushed;
  }

  return {
    sessionId: state.sessionId,
    response: normalizeBlockquotes(state.response),
  };
}
