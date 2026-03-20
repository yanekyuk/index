/**
 * Unit tests for IntegrationController.
 * Tests ownership verification on disconnect and basic list/connect flows.
 */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect } from "bun:test";
import { IntegrationController } from "../integration.controller";
import type { AuthenticatedUser } from "../../guards/auth.guard";
import type { IntegrationAdapter, IntegrationConnection, IntegrationSession } from "../../lib/protocol/interfaces/integration.interface";

const USER_A: AuthenticatedUser = { id: "user-a", email: "a@test.com", name: "User A" };
const USER_B: AuthenticatedUser = { id: "user-b", email: "b@test.com", name: "User B" };

const CONNECTIONS: Record<string, IntegrationConnection[]> = {
  "user-a": [
    { id: "conn-1", toolkit: "gmail", status: "active", createdAt: "2026-01-01T00:00:00Z" },
    { id: "conn-2", toolkit: "slack", status: "active", createdAt: "2026-01-02T00:00:00Z" },
  ],
  "user-b": [
    { id: "conn-3", toolkit: "gmail", status: "active", createdAt: "2026-01-03T00:00:00Z" },
  ],
};

const disconnected: string[] = [];

const mockAdapter: IntegrationAdapter = {
  async createSession() {
    return {} as IntegrationSession;
  },
  async executeToolAction() {
    return { successful: true };
  },
  async listConnections(userId: string) {
    return CONNECTIONS[userId] ?? [];
  },
  async getAuthUrl(_userId: string, _toolkit: string, _callbackUrl?: string) {
    return { redirectUrl: "https://oauth.example.com/auth" };
  },
  async disconnect(connectedAccountId: string) {
    disconnected.push(connectedAccountId);
    return { success: true };
  },
};

describe("IntegrationController", () => {
  const controller = new IntegrationController(mockAdapter);

  describe("GET / (list)", () => {
    test("should return connections for the authenticated user", async () => {
      const req = new Request("http://test/api/integrations");
      const result = await controller.list(req, USER_A);

      const data = result as { connections: IntegrationConnection[] };
      expect(data.connections).toHaveLength(2);
      expect(data.connections[0].id).toBe("conn-1");
    });

    test("should return empty list for user with no connections", async () => {
      const req = new Request("http://test/api/integrations");
      const noConnectionsUser: AuthenticatedUser = { id: "user-none", email: "none@test.com", name: "No Connections" };
      const result = await controller.list(req, noConnectionsUser);

      const data = result as { connections: IntegrationConnection[] };
      expect(data.connections).toHaveLength(0);
    });
  });

  describe("POST /connect/:toolkit (connect)", () => {
    test("should return a redirect URL for allowed toolkit", async () => {
      const req = new Request("http://test/api/integrations/connect/gmail", {
        method: "POST",
        headers: { origin: "http://localhost:5173" },
      });
      const result = await controller.connect(req, USER_A, { toolkit: "gmail" });

      const data = result as { redirectUrl: string };
      expect(data.redirectUrl).toBe("https://oauth.example.com/auth");
    });

    test("should return 400 for unsupported toolkit", async () => {
      const req = new Request("http://test/api/integrations/connect/evilkit", {
        method: "POST",
      });
      const result = await controller.connect(req, USER_A, { toolkit: "evilkit" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Unsupported toolkit");
    });
  });

  describe("DELETE /:id (disconnect)", () => {
    test("should disconnect own connection", async () => {
      disconnected.length = 0;
      const req = new Request("http://test/api/integrations/conn-1", { method: "DELETE" });
      const result = await controller.disconnect(req, USER_A, { id: "conn-1" });

      expect(result).not.toBeInstanceOf(Response);
      const data = result as { success: boolean };
      expect(data.success).toBe(true);
      expect(disconnected).toContain("conn-1");
    });

    test("should return 404 when disconnecting another user's connection", async () => {
      disconnected.length = 0;
      const req = new Request("http://test/api/integrations/conn-1", { method: "DELETE" });
      const result = await controller.disconnect(req, USER_B, { id: "conn-1" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(404);
      expect(disconnected).toHaveLength(0);
    });

    test("should return 404 for non-existent connection", async () => {
      disconnected.length = 0;
      const req = new Request("http://test/api/integrations/conn-999", { method: "DELETE" });
      const result = await controller.disconnect(req, USER_A, { id: "conn-999" });

      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(404);
      expect(disconnected).toHaveLength(0);
    });
  });
});
