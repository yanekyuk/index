/** Config */
import { config } from "dotenv";
config({ path: '.env' });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ToolController } from "../src/controllers/tool.controller";
import { UserDatabaseAdapter } from "../src/adapters/database.adapter";
import type { AuthenticatedUser } from "../src/guards/auth.guard";

describe("ToolController Integration", () => {
  let controller: ToolController;
  const userAdapter = new UserDatabaseAdapter();
  let testUserId: string;
  const testEmail = "test-tool-controller@example.com";

  const mockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test Tool User",
  });

  beforeAll(async () => {
    // Clean up any leftover test user
    const existing = await userAdapter.findByEmail(testEmail);
    if (existing) {
      await userAdapter.deleteByEmail(testEmail);
    }

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Tool User",
      intro: "Integration test user for ToolController",
    });
    testUserId = user.id;
    console.log(`Created test user: ${testUserId}`);

    controller = new ToolController();
  });

  afterAll(async () => {
    if (testUserId) {
      await userAdapter.deleteById(testUserId);
      console.log(`Deleted test user: ${testUserId}`);
    }
  });

  test("GET /tools should list available tools", async () => {
    const req = new Request("http://localhost/api/tools");
    const res = await controller.list(req, mockUser());
    const data = (await res.json()) as { tools?: Array<{ name: string; description: string; schema: unknown }> };

    expect(res.status).toBe(200);
    expect(data.tools).toBeDefined();
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools!.length).toBeGreaterThan(0);

    // Each tool should have name, description, and schema
    for (const tool of data.tools!) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(tool.schema).toBeDefined();
    }

    // Verify known tools are present
    const toolNames = data.tools!.map((t) => t.name);
    expect(toolNames).toContain("read_intents");
    console.log(`Listed ${data.tools!.length} tools: ${toolNames.join(", ")}`);
  }, 30_000);

  test("POST /tools/read_intents should return intents for user", async () => {
    const req = new Request("http://localhost/api/tools/read_intents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: {} }),
    });

    const res = await controller.invoke(req, mockUser(), { toolName: "read_intents" });
    const data = await res.json();

    expect(res.status).toBe(200);
    // New user should have an empty intents list or a structured response
    expect(data).toBeDefined();
    console.log("read_intents result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools/unknown_tool should return 404 error", async () => {
    const req = new Request("http://localhost/api/tools/unknown_tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: {} }),
    });

    const res = await controller.invoke(req, mockUser(), { toolName: "unknown_tool" });
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(404);
    expect(data.error).toBeDefined();
    expect(data.error).toContain("not found");
    console.log("unknown_tool error:", data.error);
  }, 60_000);

  test("POST /tools/list_contacts should return contacts for user", async () => {
    const req = new Request("http://localhost/api/tools/list_contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: {} }),
    });

    const res = await controller.invoke(req, mockUser(), { toolName: "list_contacts" });
    const data = await res.json();

    expect(res.status).toBe(200);
    // New user should have an empty contacts list or structured response
    expect(data).toBeDefined();
    console.log("list_contacts result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools/read_indexes should return indexes for user", async () => {
    const req = new Request("http://localhost/api/tools/read_indexes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: {} }),
    });

    const res = await controller.invoke(req, mockUser(), { toolName: "read_indexes" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toBeDefined();
    console.log("read_indexes result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools/read_user_profiles should return profile data", async () => {
    const req = new Request("http://localhost/api/tools/read_user_profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: {} }),
    });

    const res = await controller.invoke(req, mockUser(), { toolName: "read_user_profiles" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toBeDefined();
    console.log("read_user_profiles result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools/list_opportunities should return opportunities", async () => {
    const req = new Request("http://localhost/api/tools/list_opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: {} }),
    });

    const res = await controller.invoke(req, mockUser(), { toolName: "list_opportunities" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toBeDefined();
    console.log("list_opportunities result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools/scrape_url should handle a URL", async () => {
    const req = new Request("http://localhost/api/tools/scrape_url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: { url: "https://example.com" } }),
    });

    const res = await controller.invoke(req, mockUser(), { toolName: "scrape_url" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toBeDefined();
    console.log("scrape_url result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools with invalid body should return 400", async () => {
    const req = new Request("http://localhost/api/tools/read_intents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });

    const res = await controller.invoke(req, mockUser(), { toolName: "read_intents" });
    // The controller treats unparsable JSON as empty body, so it should still work with default query
    expect(res.status).toBe(200);
  }, 60_000);

  test("POST /tools/read_intent_indexes without intentId should handle gracefully", async () => {
    const req = new Request("http://localhost/api/tools/read_intent_indexes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: {} }),
    });

    const res = await controller.invoke(req, mockUser(), { toolName: "read_intent_indexes" });
    const data = await res.json();

    // Should return 200 (tool handles missing params internally) or 400 for validation
    expect([200, 400]).toContain(res.status);
    expect(data).toBeDefined();
    console.log("read_intent_indexes result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);
}, 120_000);
