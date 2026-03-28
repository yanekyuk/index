/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { NetworkController } from "../network.controller";
import { UserDatabaseAdapter, ChatDatabaseAdapter, NetworkGraphDatabaseAdapter } from "../../adapters/database.adapter";
import type { AuthenticatedUser } from "../../guards/auth.guard";

describe("NetworkController Integration", () => {
  const controller = new NetworkController();
  const userAdapter = new UserDatabaseAdapter();
  const chatAdapter = new ChatDatabaseAdapter();
  const indexAdapter = new NetworkGraphDatabaseAdapter();
  let testUserId: string;
  let createdIndexId: string;
  const testEmail = `test-index-controller-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) await userAdapter.deleteByEmail(testEmail);

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Index User",
      intro: "Test",
      location: "City",
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    if (createdIndexId) await indexAdapter.deleteNetworkAndMembers(createdIndexId);
    if (testUserId) await userAdapter.deleteById(testUserId);
  });

  const mockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test Index User",
  });

  describe("GET '' (list)", () => {
    test("should return 200 with indexes array", async () => {
      const req = new Request("http://localhost/indexes");
      const res = await controller.list(req, mockUser());
      const data = (await res.json()) as { indexes?: unknown[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(data.indexes)).toBe(true);
    });
  });

  describe("POST '' (create)", () => {
    test("should return 400 when title is missing", async () => {
      const req = new Request("http://localhost/indexes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await controller.create(req, mockUser());
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toBe("title is required");
    });

    test("should return 200 and create index when title provided", async () => {
      const req = new Request("http://localhost/indexes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Test Index", prompt: "A test index" }),
      });
      const res = await controller.create(req, mockUser());
      const data = (await res.json()) as { index?: { id: string; title: string } };

      expect(res.status).toBe(200);
      expect(data.index).toBeDefined();
      expect(data.index!.title).toBe("Test Index");
      createdIndexId = data.index!.id;
    });
  });

  describe("GET /:id", () => {
    test("should return 200 and index when member", async () => {
      const req = new Request("http://localhost/indexes/" + createdIndexId);
      const res = await controller.get(req, mockUser(), { id: createdIndexId });
      const data = (await res.json()) as { index?: { id: string; title: string } };

      expect(res.status).toBe(200);
      expect(data.index).toBeDefined();
      expect(data.index!.id).toBe(createdIndexId);
      expect(data.index!.title).toBe("Test Index");
    });

    test("should return 404 when index id does not exist", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const req = new Request("http://localhost/indexes/" + fakeId);
      const res = await controller.get(req, mockUser(), { id: fakeId });
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(404);
      expect(data.error).toBe("Index not found");
    });
  });

  describe("GET /search-users", () => {
    test("should return 200 with users array", async () => {
      const req = new Request("http://localhost/indexes/search-users?q=test");
      const res = await controller.searchPersonalNetworkMembers(req, mockUser());
      const data = (await res.json()) as { users?: unknown[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(data.users)).toBe(true);
    });
  });

  describe("GET /discovery/public", () => {
    test("should return 200 with indexes array", async () => {
      const req = new Request("http://localhost/indexes/discovery/public");
      const res = await controller.getPublicNetworks(req, mockUser());
      const data = (await res.json()) as { indexes?: unknown[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(data.indexes)).toBe(true);
    });
  });

  describe("PUT /:id", () => {
    test("should return 200 and updated index when owner", async () => {
      const req = new Request("http://localhost/indexes/" + createdIndexId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated Test Index" }),
      });
      const res = await controller.update(req, mockUser(), { id: createdIndexId });
      const data = (await res.json()) as { index?: { title: string } };

      expect(res.status).toBe(200);
      expect(data.index).toBeDefined();
      expect(data.index!.title).toBe("Updated Test Index");
    });
  });

  describe("GET /:id/members", () => {
    test("should return 200 with members array when owner", async () => {
      const req = new Request("http://localhost/indexes/" + createdIndexId + "/members");
      const res = await controller.getMembers(req, mockUser(), { id: createdIndexId });
      const data = (await res.json()) as { members?: unknown[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(data.members)).toBe(true);
    });
  });

  describe("GET /:id/member-settings", () => {
    test("should return 200 with settings when member", async () => {
      const req = new Request("http://localhost/indexes/" + createdIndexId + "/member-settings");
      const res = await controller.getMemberSettings(req, mockUser(), { id: createdIndexId });
      const data = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(data).toBeDefined();
    });
  });

  describe("DELETE /:id", () => {
    test("should return 200 and success when owner", async () => {
      const req = new Request("http://localhost/indexes/" + createdIndexId, { method: "DELETE" });
      const res = await controller.delete(req, mockUser(), { id: createdIndexId });
      const data = (await res.json()) as { success?: boolean };

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      // Keep createdIndexId so afterAll can run deleteNetworkAndMembers (drops index_members), then deleteById(user) won't hit FK
    });
  });
});
