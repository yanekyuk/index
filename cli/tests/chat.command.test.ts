import { describe, it, expect } from "bun:test";

import { renderSSEStream } from "../src/chat.command";

/**
 * Creates a mock SSE server that emits the given raw SSE event strings.
 * The server format matches the protocol's formatSSEEvent: `data: {JSON}\n\n`.
 */
function createMockChatServer(events: string[]) {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/api/chat/stream") {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const event of events) {
              controller.enqueue(encoder.encode(event));
            }
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "X-Session-Id": "test-session-id",
          },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  return server;
}

/** Helper to build a `data: {JSON}\n\n` SSE event string. */
function sseEvent(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("renderSSEStream", () => {
  it("extracts text tokens from token events", async () => {
    const events = [
      sseEvent({ type: "status", sessionId: "s1", timestamp: "t", message: "Processing..." }),
      sseEvent({ type: "token", sessionId: "s1", timestamp: "t", content: "Hello " }),
      sseEvent({ type: "token", sessionId: "s1", timestamp: "t", content: "world!" }),
      sseEvent({ type: "done", sessionId: "s1", timestamp: "t", response: "Hello world!", title: "Test" }),
    ];

    const server = createMockChatServer(events);
    try {
      const response = await fetch(`http://localhost:${server.port}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });

      const output: string[] = [];
      const result = await renderSSEStream(response, (text) => output.push(text));

      expect(output.join("")).toBe("Hello world!");
      expect(result.sessionId).toBe("s1");
      expect(result.title).toBe("Test");
    } finally {
      server.stop(true);
    }
  });

  it("captures session ID from done event", async () => {
    const events = [
      sseEvent({ type: "done", sessionId: "abc-123", timestamp: "t", response: "Hi", title: "Chat" }),
    ];

    const server = createMockChatServer(events);
    try {
      const response = await fetch(`http://localhost:${server.port}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });

      const result = await renderSSEStream(response, () => {});
      expect(result.sessionId).toBe("abc-123");
    } finally {
      server.stop(true);
    }
  });

  it("reports errors from error events", async () => {
    const events = [
      sseEvent({ type: "error", sessionId: "s1", timestamp: "t", message: "Something went wrong", code: "STREAM_ERROR" }),
    ];

    const server = createMockChatServer(events);
    try {
      const response = await fetch(`http://localhost:${server.port}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });

      const result = await renderSSEStream(response, () => {});
      expect(result.error).toBe("Something went wrong");
    } finally {
      server.stop(true);
    }
  });

  it("shows tool activity in status callback", async () => {
    const events = [
      sseEvent({ type: "tool_activity", sessionId: "s1", timestamp: "t", toolName: "search", description: "Searching...", phase: "start" }),
      sseEvent({ type: "token", sessionId: "s1", timestamp: "t", content: "result" }),
      sseEvent({ type: "done", sessionId: "s1", timestamp: "t", response: "result" }),
    ];

    const server = createMockChatServer(events);
    try {
      const response = await fetch(`http://localhost:${server.port}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });

      const statuses: string[] = [];
      const output: string[] = [];
      await renderSSEStream(
        response,
        (text) => output.push(text),
        (status) => statuses.push(status),
      );

      expect(output.join("")).toBe("result");
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses.some((s) => s.includes("Searching"))).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  it("handles response_reset by clearing accumulated text", async () => {
    const events = [
      sseEvent({ type: "token", sessionId: "s1", timestamp: "t", content: "wrong answer" }),
      sseEvent({ type: "response_reset", sessionId: "s1", timestamp: "t", reason: "hallucination" }),
      sseEvent({ type: "token", sessionId: "s1", timestamp: "t", content: "correct answer" }),
      sseEvent({ type: "done", sessionId: "s1", timestamp: "t", response: "correct answer" }),
    ];

    const server = createMockChatServer(events);
    try {
      const response = await fetch(`http://localhost:${server.port}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });

      const result = await renderSSEStream(response, () => {});
      expect(result.response).toBe("correct answer");
    } finally {
      server.stop(true);
    }
  });
});
