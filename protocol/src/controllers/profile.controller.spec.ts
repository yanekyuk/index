/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ProfileController } from "./profile.controller";
import type { AuthenticatedUser } from "../guards/auth.guard";
import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { eq } from 'drizzle-orm';

// Integration test suite for ProfileController using actual DB
describe("ProfileController Integration", () => {
  const controller = new ProfileController();
  let testUserId: string;

  beforeAll(async () => {
    // Setup - Ensure we are in a clean state (cleanup if previous run failed)
    const email = "test-profile-controller@example.com";

    // Check if user exists, if so delete to start fresh
    const existingUser = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);

    if (existingUser.length > 0) {
      await db.delete(schema.users).where(eq(schema.users.email, email));
    }

    // Create a real user in the DB
    const [user] = await db.insert(schema.users).values({
      email: email,
      name: "Test Profile User",
      privyId: `privy:${Date.now()}`, // Unique Privy ID
      intro: "An engineer interested in agents.",
      location: "San Francisco, CA",
      socials: {
        x: "https://x.com/test",
      }
    }).returning();

    testUserId = user.id;
    console.log(`Created test user: ${testUserId}`);
  });

  afterAll(async () => {
    // Cleanup
    if (testUserId) {
      await db.delete(schema.users).where(eq(schema.users.id, testUserId));
    }
    // Do not close db: other integration specs may run in the same process.
  });

  test("sync should generate a profile for a new user", async () => {
    // 1. Run sync
    // This will trigger the graph: Check DB -> (Missing) -> Scrape -> Generate -> Embed -> Save -> HyDE -> Embed -> Save
    // Note: This relies on parallel scraper working or failing gracefully?
    // If we want to test "real" flows we need real external inputs OR we accept that scraper might return empty if URL inactive.
    // However, the user provided socials so the "objective" will be constructed.
    // The scraper interface is scraping "objective" text (implemented locally via Parallel adapter).

    console.log("Starting sync...");
    const mockRequest = {} as Request;
    const mockUser: AuthenticatedUser = {
      id: testUserId,
      privyId: `privy:${Date.now()}`,
      email: "test-profile-controller@example.com",
      name: "Test Profile User"
    };
    const result = await controller.sync(mockRequest, mockUser);
    console.log("Sync result:", result);

    // 2. Verify DB state - Profile should be created
    const profile = await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.userId, testUserId));

    expect(profile.length).toBe(1);
    expect(profile[0].identity?.name).toBeDefined();
    expect(profile[0].embedding).not.toBeNull();
    // Verify HyDE
    expect(profile[0].hydeDescription).not.toBeNull();
    expect(profile[0].hydeEmbedding).not.toBeNull();
  }, 120000); // Long timeout for LLM/Scraping calls

  test("sync should be idempotent (second run should just verify)", async () => {
    console.log("Starting idempotent sync...");
    const mockRequest = {} as Request;
    const mockUser: AuthenticatedUser = {
      id: testUserId,
      privyId: `privy:${Date.now()}`,
      email: "test-profile-controller@example.com",
      name: "Test Profile User"
    };
    const start = Date.now();
    await controller.sync(mockRequest, mockUser);
    const duration = Date.now() - start;

    // Second run should be much faster as it skips generation (if logic holds)
    // Though without detailed logs inspection, we mainly verify it doesn't crash 
    // and profile still exists.

    const profile = await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.userId, testUserId));
    expect(profile.length).toBe(1);

    // Optional: check if updatedAt changed? If it skips, it shouldn't update.
    // But graph might do slight updates.
    // Mainly we assert valid state.
  }, 60000);

});
