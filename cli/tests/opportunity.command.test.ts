import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";

import { parseArgs } from "../src/args.parser";
import { ApiClient } from "../src/api.client";
import * as output from "../src/output";
import type { Opportunity } from "../src/api.client";

describe("opportunity argument parsing", () => {
  it("parses 'opportunity list' subcommand", () => {
    const result = parseArgs(["opportunity", "list"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("list");
  });

  it("parses 'opportunity list --status pending'", () => {
    const result = parseArgs(["opportunity", "list", "--status", "pending"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("list");
    expect(result.status).toBe("pending");
  });

  it("parses 'opportunity list --limit 5'", () => {
    const result = parseArgs(["opportunity", "list", "--limit", "5"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("list");
    expect(result.limit).toBe(5);
  });

  it("parses 'opportunity list --status accepted --limit 10'", () => {
    const result = parseArgs(["opportunity", "list", "--status", "accepted", "--limit", "10"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("list");
    expect(result.status).toBe("accepted");
    expect(result.limit).toBe(10);
  });

  it("parses 'opportunity show <id>'", () => {
    const result = parseArgs(["opportunity", "show", "opp-123"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("show");
    expect(result.targetId).toBe("opp-123");
  });

  it("parses 'opportunity accept <id>'", () => {
    const result = parseArgs(["opportunity", "accept", "opp-456"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("accept");
    expect(result.targetId).toBe("opp-456");
  });

  it("parses 'opportunity reject <id>'", () => {
    const result = parseArgs(["opportunity", "reject", "opp-789"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("reject");
    expect(result.targetId).toBe("opp-789");
  });

  it("parses bare 'opportunity' with no subcommand", () => {
    const result = parseArgs(["opportunity"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBeUndefined();
  });

  it("parses 'opportunity show' without id", () => {
    const result = parseArgs(["opportunity", "show"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("show");
    expect(result.targetId).toBeUndefined();
  });

  it("parses 'opportunity list' with --api-url", () => {
    const result = parseArgs(["opportunity", "list", "--api-url", "http://example.com"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("list");
    expect(result.apiUrl).toBe("http://example.com");
  });
});

// ── API client tests ──────────────────────────────────────────────

/** Minimal mock server for opportunity API tests. */
function createMockServer() {
  const handlers: Record<string, (req: Request) => Response | Promise<Response>> = {};

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      // Match method + pathname (strip query params for matching)
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

describe("opportunity API client", () => {
  let mock: ReturnType<typeof createMockServer>;
  let client: ApiClient;

  beforeAll(() => {
    mock = createMockServer();
    client = new ApiClient(mock.url, "test-token");
  });

  afterAll(() => {
    mock.stop();
  });

  describe("listOpportunities", () => {
    it("returns opportunities from the API", async () => {
      mock.on("GET", "/api/opportunities", () =>
        Response.json({
          opportunities: [
            { id: "o1", status: "pending", interpretation: { category: "Collaboration", confidence: 85 } },
            { id: "o2", status: "accepted", interpretation: { category: "Mentoring", confidence: 92 } },
          ],
        }),
      );

      const result = await client.listOpportunities();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("o1");
    });

    it("passes status and limit query params", async () => {
      let receivedUrl = "";
      mock.on("GET", "/api/opportunities", (req) => {
        receivedUrl = req.url;
        return Response.json({ opportunities: [] });
      });

      await client.listOpportunities({ status: "pending", limit: 5 });
      expect(receivedUrl).toContain("status=pending");
      expect(receivedUrl).toContain("limit=5");
    });
  });

  describe("getOpportunity", () => {
    it("returns a single opportunity", async () => {
      mock.on("GET", "/api/opportunities/opp-123", () =>
        Response.json({
          id: "opp-123",
          status: "pending",
          interpretation: { reasoning: "Good match", category: "Hiring", confidence: 88 },
          actors: [],
        }),
      );

      const result = await client.getOpportunity("opp-123");
      expect(result.id).toBe("opp-123");
      expect(result.interpretation.reasoning).toBe("Good match");
    });
  });

  describe("updateOpportunityStatus", () => {
    it("sends PATCH with status body", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("PATCH", "/api/opportunities/opp-456/status", async (req) => {
        receivedBody = (await req.json()) as Record<string, unknown>;
        return Response.json({ id: "opp-456", status: "accepted" });
      });

      const result = await client.updateOpportunityStatus("opp-456", "accepted");
      expect(receivedBody.status).toBe("accepted");
      expect(result.status).toBe("accepted");
    });
  });
});

// ── Output renderer tests ─────────────────────────────────────────

describe("opportunity output renderers", () => {
  let captured: string;

  beforeEach(() => {
    captured = "";
    // Intercept stdout and console.log to capture output
    process.stdout.write = ((chunk: string | Uint8Array) => {
      captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      captured += args.map(String).join(" ") + "\n";
    };
  });

  describe("opportunityTable", () => {
    it("renders a table with opportunity data", () => {
      const opportunities: Opportunity[] = [
        {
          id: "o1",
          status: "pending",
          counterpartName: "Alice",
          interpretation: { category: "Collaboration", confidence: 85 },
          createdAt: "2026-03-30T10:00:00Z",
        },
      ];

      output.opportunityTable(opportunities);
      expect(captured).toContain("Alice");
      expect(captured).toContain("Collaboration");
      expect(captured).toContain("pending");
      expect(captured).toContain("85%");
    });

    it("shows empty message when no opportunities", () => {
      output.opportunityTable([]);
      expect(captured).toContain("No opportunities found");
    });
  });

  describe("opportunityCard", () => {
    it("renders a detailed card with parties and roles", () => {
      const opportunity: Opportunity = {
        id: "o2",
        status: "pending",
        actors: [
          { userId: "u1", name: "Bob", role: "patient" },
          { userId: "u2", name: "Carol", role: "agent" },
        ],
        interpretation: {
          category: "Mentoring",
          reasoning: "Bob needs a mentor and Carol has mentoring experience.",
          confidence: 90,
        },
        presentation: "A great opportunity for mentoring.",
        createdAt: "2026-03-30T10:00:00Z",
      };

      output.opportunityCard(opportunity);
      expect(captured).toContain("Bob");
      expect(captured).toContain("Carol");
      expect(captured).toContain("Seeker");  // patient -> Seeker
      expect(captured).toContain("Helper");  // agent -> Helper
      expect(captured).toContain("Mentoring");
      expect(captured).toContain("Bob needs a mentor");
    });

    it("renders peer role correctly", () => {
      const opportunity: Opportunity = {
        id: "o3",
        status: "pending",
        actors: [
          { userId: "u1", name: "Dan", role: "peer" },
          { userId: "u2", name: "Eve", role: "peer" },
        ],
        interpretation: { category: "Partnership", confidence: 75 },
        createdAt: "2026-03-30T10:00:00Z",
      };

      output.opportunityCard(opportunity);
      expect(captured).toContain("Peer");
    });
  });
});
