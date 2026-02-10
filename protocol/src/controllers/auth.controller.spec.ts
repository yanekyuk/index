/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { AuthController } from "./auth.controller";
import { UserDatabaseAdapter } from "../adapters/database.adapter";
import type { AuthenticatedUser } from "../guards/auth.guard";

describe("AuthController Integration", () => {
  const controller = new AuthController();
  const userAdapter = new UserDatabaseAdapter();
  let testUserId: string;
  const testEmail = `test-auth-controller-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) await userAdapter.deleteByEmail(testEmail);

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Auth User",
      privyId: `privy:auth:${Date.now()}`,
      intro: "Test intro",
      location: "Test City",
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    if (testUserId) await userAdapter.deleteById(testUserId);
  });

  const mockUser = (): AuthenticatedUser => ({
    id: testUserId,
    privyId: `privy:auth:${Date.now()}`,
    email: testEmail,
    name: "Test Auth User",
  });

  describe("GET /me", () => {
    test("should return 200 and user when user exists", async () => {
      const req = new Request("http://localhost/auth/me");
      const res = await controller.me(req, mockUser());
      const data = await res.json() as { user?: unknown; error?: string };

      expect(res.status).toBe(200);
      expect(data.user).toBeDefined();
      expect((data.user as { id: string }).id).toBe(testUserId);
      expect((data.user as { name: string }).name).toBe("Test Auth User");
      expect((data.user as { email: string }).email).toBe(testEmail);
    });

    test("should return 404 when user not found in DB", async () => {
      const req = new Request("http://localhost/auth/me");
      const fakeUser: AuthenticatedUser = {
        id: "00000000-0000-0000-0000-000000000000",
        privyId: "privy:fake",
        email: "fake@example.com",
        name: "Fake",
      };
      const res = await controller.me(req, fakeUser);
      const data = await res.json() as { error?: string };

      expect(res.status).toBe(404);
      expect(data.error).toBe("User not found");
    });
  });

  describe("PATCH /profile/update", () => {
    test("should return 200 and updated user when body has name", async () => {
      const req = new Request("http://localhost/auth/profile/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Auth User" }),
      });
      const res = await controller.updateProfile(req, mockUser());
      const data = await res.json() as { user?: { name: string }; error?: string };

      expect(res.status).toBe(200);
      expect(data.user).toBeDefined();
      expect(data.user!.name).toBe("Updated Auth User");
    });

    test("should return 200 when body is empty (no changes)", async () => {
      const req = new Request("http://localhost/auth/profile/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await controller.updateProfile(req, mockUser());
      expect(res.status).toBe(200);
      const data = await res.json() as { user?: unknown };
      expect(data.user).toBeDefined();
    });
  });
});
