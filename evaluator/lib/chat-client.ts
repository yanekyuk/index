export interface SendMessageResult {
  sessionId: string;
  response: string;
  error?: string;
}

/**
 * Send a message to the protocol chat stream API and accumulate the response.
 * Parses SSE events: status (sessionId), token (content), done (response), error.
 */
export async function sendMessage(
  apiUrl: string,
  token: string,
  options: { message: string; sessionId?: string }
): Promise<SendMessageResult> {
  const url = `${apiUrl.replace(/\/$/, "")}/chat/stream`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
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
  let sessionId = options.sessionId ?? "";
  let response = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const json = JSON.parse(line.slice(6));
          switch (json.type) {
            case "status":
            case "routing":
            case "thinking":
            case "token":
              if (json.sessionId) sessionId = json.sessionId;
              if (json.type === "token" && json.content) response += json.content;
              break;
            case "done":
              if (json.sessionId) sessionId = json.sessionId;
              if (typeof json.response === "string") response = json.response;
              break;
            case "error":
              return {
                sessionId: json.sessionId ?? sessionId,
                response,
                error: json.message ?? "Unknown error",
              };
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  }

  // Flush remaining buffer
  if (buffer) {
    const line = buffer.split("\n")[0];
    if (line?.startsWith("data: ")) {
      try {
        const json = JSON.parse(line.slice(6));
        if (json.type === "done" && typeof json.response === "string") {
          response = json.response;
        }
        if (json.sessionId) sessionId = json.sessionId;
      } catch {
        // ignore
      }
    }
  }

  return { sessionId, response };
}
