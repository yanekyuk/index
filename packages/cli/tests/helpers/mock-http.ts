import { spyOn } from "bun:test";

export type MockHandler = (req: Request) => Response | Promise<Response>;
export type PatternHandler = (req: Request, match: RegExpMatchArray) => Response | Promise<Response>;

export function createMockServer() {
  const handlers: Record<string, MockHandler> = {};
  const patterns: Array<{ method: string; pattern: RegExp; handler: PatternHandler }> = [];

  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const key = `${req.method} ${url.pathname}`;

    const exact = handlers[key];
    if (exact) {
      return await exact(req);
    }

    for (const route of patterns) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.pattern);
      if (match) {
        return await route.handler(req, match);
      }
    }

    return new Response("Not Found", { status: 404 });
  });

  return {
    url: "http://mock.local",
    on(method: string, path: string, handler: MockHandler) {
      handlers[`${method} ${path}`] = handler;
    },
    onPattern(method: string, pattern: RegExp, handler: PatternHandler) {
      patterns.push({ method, pattern, handler });
    },
    stop() {
      fetchSpy.mockRestore();
    },
  };
}

export function createMockSSEServer(events: string[]) {
  const server = createMockServer();
  server.on("POST", "/api/chat/stream", () =>
    new Response(events.join(""), {
      headers: {
        "Content-Type": "text/event-stream",
        "X-Session-Id": "test-session-id",
      },
    }),
  );

  return server;
}
