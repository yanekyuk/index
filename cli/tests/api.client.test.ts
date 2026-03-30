import { describe, it, expect, beforeAll, afterAll } from "bun:test";

import { ApiClient } from "../src/api.client";

/** Minimal mock server for API client tests. */
function createMockServer() {
  const handlers: Record<string, (req: Request) => Response | Promise<Response>> = {};

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const key = `${req.method} ${url.pathname}`;
      const handler = handlers[key];
      if (handler) return handler(req);
      return new Response("Not Found", { status: 404 });
    },
  });

  return {
    server,
    url: `http://localhost:${server.port}`,
    on(method: string, path: string, handler: (req: Request) => Response | Promise<Response>) {
      handlers[`${method} ${path}`] = handler;
    },
    stop() {
      server.stop(true);
    },
  };
}

describe("ApiClient", () => {
  let mock: ReturnType<typeof createMockServer>;
  let client: ApiClient;

  beforeAll(() => {
    mock = createMockServer();
    client = new ApiClient(mock.url, "test-token-123");
  });

  afterAll(() => {
    mock.stop();
  });

  describe("listSessions", () => {
    it("returns sessions from the API", async () => {
      mock.on("GET", "/api/chat/sessions", () =>
        Response.json({
          sessions: [
            { id: "s1", title: "First", createdAt: "2026-01-01" },
            { id: "s2", title: "Second", createdAt: "2026-01-02" },
          ],
        }),
      );

      const sessions = await client.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe("s1");
      expect(sessions[1].title).toBe("Second");
    });

    it("sends the authorization header", async () => {
      let receivedAuth = "";
      mock.on("GET", "/api/chat/sessions", (req) => {
        receivedAuth = req.headers.get("authorization") ?? "";
        return Response.json({ sessions: [] });
      });

      await client.listSessions();
      expect(receivedAuth).toBe("Bearer test-token-123");
    });

    it("throws on 401 with an auth error", async () => {
      mock.on("GET", "/api/chat/sessions", () =>
        Response.json({ error: "Invalid or expired access token" }, { status: 401 }),
      );

      try {
        await client.listSessions();
        expect(true).toBe(false); // should not reach
      } catch (e: unknown) {
        expect((e as Error).message).toContain("expired");
      }
    });
  });

  describe("getMe", () => {
    it("returns the current user", async () => {
      mock.on("GET", "/api/auth/me", () =>
        Response.json({
          user: { id: "u1", name: "Test User", email: "test@example.com" },
        }),
      );

      const user = await client.getMe();
      expect(user.name).toBe("Test User");
      expect(user.email).toBe("test@example.com");
    });
  });

  describe("listIntents", () => {
    it("sends a POST to /api/intents/list and returns intents", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/intents/list", async (req) => {
        receivedBody = await req.json() as Record<string, unknown>;
        return Response.json({
          intents: [
            { id: "i1", payload: "Looking for a co-founder", summary: "Co-founder search", status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", archivedAt: null },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      });

      const result = await client.listIntents();
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].id).toBe("i1");
      expect(result.pagination.total).toBe(1);
      expect(receivedBody).toEqual({});
    });

    it("passes pagination and filter options in the request body", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/intents/list", async (req) => {
        receivedBody = await req.json() as Record<string, unknown>;
        return Response.json({ intents: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 0 } });
      });

      await client.listIntents({ limit: 5, archived: true });
      expect(receivedBody.limit).toBe(5);
      expect(receivedBody.archived).toBe(true);
    });
  });

  describe("getIntent", () => {
    it("fetches a single intent by ID", async () => {
      mock.on("GET", "/api/intents/i1", () =>
        Response.json({
          intent: { id: "i1", payload: "Looking for a co-founder", summary: "Co-founder search", status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", archivedAt: null },
        }),
      );

      const intent = await client.getIntent("i1");
      expect(intent.id).toBe("i1");
      expect(intent.payload).toBe("Looking for a co-founder");
    });
  });

  describe("processIntent", () => {
    it("sends content to POST /api/intents/process", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/intents/process", async (req) => {
        receivedBody = await req.json() as Record<string, unknown>;
        return Response.json({ success: true, message: "Intent processed" });
      });

      const result = await client.processIntent("Looking for a co-founder");
      expect(receivedBody.content).toBe("Looking for a co-founder");
      expect(result).toHaveProperty("success");
    });
  });

  describe("archiveIntent", () => {
    it("sends PATCH to /api/intents/:id/archive", async () => {
      mock.on("PATCH", "/api/intents/i1/archive", () =>
        Response.json({ success: true }),
      );

      const result = await client.archiveIntent("i1");
      expect(result.success).toBe(true);
    });
  });

  describe("streamChat", () => {
    it("returns a readable response for SSE streaming", async () => {
      mock.on("POST", "/api/chat/stream", async (req) => {
        const body = await req.json();
        expect(body.message).toBe("hello");

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('event: status\ndata: {"message":"Processing..."}\n\n'));
            controller.enqueue(encoder.encode('event: done\ndata: {"sessionId":"s1","response":"Hi there"}\n\n'));
            controller.close();
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      const response = await client.streamChat({ message: "hello" });
      expect(response.ok).toBe(true);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      // Read the full body
      const text = await response.text();
      expect(text).toContain("event: status");
      expect(text).toContain("event: done");
    });

    it("includes sessionId when provided", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/chat/stream", async (req) => {
        receivedBody = await req.json() as Record<string, unknown>;
        return new Response("event: done\ndata: {}\n\n", {
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      await client.streamChat({ message: "hi", sessionId: "abc" });
      expect(receivedBody.sessionId).toBe("abc");
    });
  });
});
