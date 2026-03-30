import { describe, it, expect, beforeAll, afterAll } from "bun:test";

import { parseArgs } from "../src/args.parser";
import { ApiClient } from "../src/api.client";
import { handleConversation } from "../src/conversation.command";

// ── Argument parsing tests ────────────────────────────────────────

describe("parseArgs — conversation command", () => {
  it("parses 'conversation' with no subcommand as conversation-help", () => {
    const result = parseArgs(["conversation"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBeUndefined();
  });

  it("parses 'conversation list'", () => {
    const result = parseArgs(["conversation", "list"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("list");
  });

  it("parses 'conversation with <user-id>'", () => {
    const result = parseArgs(["conversation", "with", "user-abc-123"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("with");
    expect(result.positionals).toEqual(["user-abc-123"]);
  });

  it("parses 'conversation show <id>'", () => {
    const result = parseArgs(["conversation", "show", "conv-abc-123"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("show");
    expect(result.positionals).toEqual(["conv-abc-123"]);
  });

  it("parses 'conversation show <id> --limit 5'", () => {
    const result = parseArgs(["conversation", "show", "conv-abc-123", "--limit", "5"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("show");
    expect(result.positionals).toEqual(["conv-abc-123"]);
    expect(result.limit).toBe(5);
  });

  it("parses 'conversation send <id> <message>'", () => {
    const result = parseArgs(["conversation", "send", "conv-abc-123", "Hello", "there"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("send");
    expect(result.positionals).toEqual(["conv-abc-123", "Hello", "there"]);
  });

  it("parses 'conversation stream'", () => {
    const result = parseArgs(["conversation", "stream"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("stream");
  });

  it("parses 'conversation list --api-url <url>'", () => {
    const result = parseArgs(["conversation", "list", "--api-url", "http://localhost:4000"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("list");
    expect(result.apiUrl).toBe("http://localhost:4000");
  });
});

// ── Mock server helper ────────────────────────────────────────────

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

// ── API client conversation methods ───────────────────────────────

describe("ApiClient — conversation methods", () => {
  let mock: ReturnType<typeof createMockServer>;
  let client: ApiClient;

  beforeAll(() => {
    mock = createMockServer();
    client = new ApiClient(mock.url, "test-token");
  });

  afterAll(() => {
    mock.stop();
  });

  it("listConversations returns conversations array", async () => {
    mock.on("GET", "/api/conversations", () =>
      Response.json({
        conversations: [
          { id: "c1", createdAt: "2026-01-01", participants: [] },
          { id: "c2", createdAt: "2026-01-02", participants: [] },
        ],
      }),
    );

    const conversations = await client.listConversations();
    expect(conversations).toHaveLength(2);
    expect(conversations[0].id).toBe("c1");
  });

  it("getOrCreateDM sends peerUserId and returns conversation", async () => {
    let receivedBody: Record<string, unknown> = {};
    mock.on("POST", "/api/conversations/dm", async (req) => {
      receivedBody = (await req.json()) as Record<string, unknown>;
      return Response.json({
        conversation: { id: "dm-1", createdAt: "2026-01-01", participants: [] },
      });
    });

    const conversation = await client.getOrCreateDM("peer-user-id");
    expect(receivedBody.peerUserId).toBe("peer-user-id");
    expect(conversation.id).toBe("dm-1");
  });

  it("getMessages returns messages array", async () => {
    mock.on("GET", "/api/conversations/c1/messages", () =>
      Response.json({
        messages: [
          { id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }], createdAt: "2026-01-01" },
        ],
      }),
    );

    const messages = await client.getMessages("c1");
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("m1");
  });

  it("sendMessage sends parts and returns message", async () => {
    let receivedBody: Record<string, unknown> = {};
    mock.on("POST", "/api/conversations/c1/messages", async (req) => {
      receivedBody = (await req.json()) as Record<string, unknown>;
      return Response.json(
        { message: { id: "m1", role: "user", parts: [{ type: "text", text: "Hi" }], createdAt: "2026-01-01" } },
        { status: 201 },
      );
    });

    const msg = await client.sendMessage("c1", "Hi there");
    expect(receivedBody.parts).toEqual([{ type: "text", text: "Hi there" }]);
    expect(msg.id).toBe("m1");
  });

  it("hideConversation calls DELETE", async () => {
    let called = false;
    mock.on("DELETE", "/api/conversations/c1", () => {
      called = true;
      return Response.json({ success: true });
    });

    await client.hideConversation("c1");
    expect(called).toBe(true);
  });
});

// ── handleConversation integration tests ──────────────────────────

describe("handleConversation", () => {
  let mock: ReturnType<typeof createMockServer>;
  let client: ApiClient;

  beforeAll(() => {
    mock = createMockServer();
    client = new ApiClient(mock.url, "test-token");
  });

  afterAll(() => {
    mock.stop();
  });

  it("lists conversations", async () => {
    mock.on("GET", "/api/conversations", () =>
      Response.json({
        conversations: [
          {
            id: "c1",
            createdAt: "2026-01-01",
            participants: [
              { participantId: "u1", participantType: "user", user: { name: "Alice" } },
              { participantId: "u2", participantType: "user", user: { name: "Bob" } },
            ],
          },
        ],
      }),
    );

    await handleConversation(client, "list", []);
  });

  it("opens a DM with a user", async () => {
    mock.on("POST", "/api/conversations/dm", () =>
      Response.json({
        conversation: {
          id: "dm-1",
          createdAt: "2026-01-01",
          participants: [
            { participantId: "u1", participantType: "user", user: { name: "Alice" } },
            { participantId: "u2", participantType: "user", user: { name: "Bob" } },
          ],
        },
      }),
    );

    await handleConversation(client, "with", ["u2"]);
  });

  it("shows messages in a conversation", async () => {
    mock.on("GET", "/api/conversations/c1/messages", () =>
      Response.json({
        messages: [
          { id: "m1", role: "user", senderId: "u1", parts: [{ type: "text", text: "Hello" }], createdAt: "2026-01-01T10:00:00Z" },
          { id: "m2", role: "user", senderId: "u2", parts: [{ type: "text", text: "Hi there!" }], createdAt: "2026-01-01T10:01:00Z" },
        ],
      }),
    );

    await handleConversation(client, "show", ["c1"]);
  });

  it("sends a message", async () => {
    mock.on("POST", "/api/conversations/c1/messages", () =>
      Response.json(
        { message: { id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }], createdAt: "2026-01-01" } },
        { status: 201 },
      ),
    );

    await handleConversation(client, "send", ["c1", "Hello"]);
  });

  it("prints help when no subcommand given", async () => {
    // Should not throw — prints help text
    await handleConversation(client, undefined, []);
  });
});
