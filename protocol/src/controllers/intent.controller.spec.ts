/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { IntentController } from "./intent.controller";
import { IntentDatabaseAdapter } from "../adapters/database.adapter";
import type { AuthenticatedUser } from "../guards/auth.guard";
import db, { closeDb } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { eq } from 'drizzle-orm';

// ═══════════════════════════════════════════════════════════════════════════════
// IntentDatabaseAdapter Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("IntentDatabaseAdapter Integration", () => {
  let adapter: IntentDatabaseAdapter;
  let testUserId: string;
  let testIntentId: string;
  const testEmail = `test-intent-adapter-${Date.now()}@example.com`;

  beforeAll(async () => {
    // Setup: Create test user
    const existingUser = await db.select()
      .from(schema.users)
      .where(eq(schema.users.email, testEmail))
      .limit(1);

    if (existingUser.length > 0) {
      // Clean up intents first
      await db.delete(schema.intents)
        .where(eq(schema.intents.userId, existingUser[0].id));
      await db.delete(schema.users)
        .where(eq(schema.users.email, testEmail));
    }

    const [user] = await db.insert(schema.users).values({
      email: testEmail,
      name: "Test Intent Adapter User",
      privyId: `privy:intent-adapter:${Date.now()}`,
      intro: "Test user for intent adapter tests",
      location: "Test City",
    }).returning();

    testUserId = user.id;
    console.log(`Created test user: ${testUserId}`);

    adapter = new IntentDatabaseAdapter();
  });

  afterAll(async () => {
    // Cleanup: Remove test data
    if (testUserId) {
      // Delete intents first (foreign key constraint)
      await db.delete(schema.intents)
        .where(eq(schema.intents.userId, testUserId));
      await db.delete(schema.users)
        .where(eq(schema.users.id, testUserId));
    }
  });

  test("getActiveIntents should return empty array for user with no intents", async () => {
    const intents = await adapter.getActiveIntents(testUserId);
    expect(intents).toEqual([]);
  });

  test("createIntent should create a new intent", async () => {
    const intentData = {
      userId: testUserId,
      payload: "Looking for AI/ML engineers for a startup project",
      summary: "AI/ML engineer search",
      confidence: 0.9,
      inferenceType: 'explicit' as const,
    };

    const created = await adapter.createIntent(intentData);

    expect(created).toBeDefined();
    expect(created.id).toBeDefined();
    expect(created.payload).toBe(intentData.payload);
    expect(created.summary).toBe(intentData.summary);
    expect(created.userId).toBe(testUserId);
    expect(created.isIncognito).toBe(false);
    expect(created.createdAt).toBeDefined();

    testIntentId = created.id;
    console.log(`Created test intent: ${testIntentId}`);
  });

  test("getActiveIntents should return active intents for user", async () => {
    // Should now find the intent we just created
    const intents = await adapter.getActiveIntents(testUserId);

    expect(intents.length).toBe(1);
    expect(intents[0].id).toBe(testIntentId);
    expect(intents[0].payload).toBe("Looking for AI/ML engineers for a startup project");
    expect(intents[0].summary).toBe("AI/ML engineer search");
    expect(intents[0].createdAt).toBeDefined();
  });

  test("updateIntent should update an existing intent", async () => {
    const updatedPayload = "Looking for senior AI/ML engineers with 5+ years experience";
    const updatedSummary = "Senior AI/ML engineer search";

    const updated = await adapter.updateIntent(testIntentId, {
      payload: updatedPayload,
      summary: updatedSummary,
    });

    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(testIntentId);
    expect(updated!.payload).toBe(updatedPayload);
    expect(updated!.summary).toBe(updatedSummary);
    expect(updated!.updatedAt).toBeDefined();
  });

  test("updateIntent should return null for non-existent intent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const updated = await adapter.updateIntent(fakeId, {
      payload: "This should not work",
    });

    expect(updated).toBeNull();
  });

  test("archiveIntent should set archivedAt timestamp", async () => {
    const result = await adapter.archiveIntent(testIntentId);

    expect(result.success).toBe(true);

    // Verify intent is now archived (not returned by getActiveIntents)
    const activeIntents = await adapter.getActiveIntents(testUserId);
    expect(activeIntents.length).toBe(0);

    // Verify the intent still exists but has archivedAt set
    const archivedIntent = await db.select()
      .from(schema.intents)
      .where(eq(schema.intents.id, testIntentId))
      .limit(1);

    expect(archivedIntent.length).toBe(1);
    expect(archivedIntent[0].archivedAt).not.toBeNull();
  });

  test("archiveIntent should return error for non-existent intent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const result = await adapter.archiveIntent(fakeId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Intent not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// IntentController Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("IntentController Integration", () => {
  const controller = new IntentController();
  let testUserId: string;
  const testEmail = `test-intent-controller-${Date.now()}@example.com`;

  beforeAll(async () => {
    // Setup: Create test user with profile (required for process)
    const existingUser = await db.select()
      .from(schema.users)
      .where(eq(schema.users.email, testEmail))
      .limit(1);

    if (existingUser.length > 0) {
      // Clean up related data first
      await db.delete(schema.intents)
        .where(eq(schema.intents.userId, existingUser[0].id));
      await db.delete(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, existingUser[0].id));
      await db.delete(schema.users)
        .where(eq(schema.users.email, testEmail));
    }

    const [user] = await db.insert(schema.users).values({
      email: testEmail,
      name: "Test Intent Controller User",
      privyId: `privy:intent-ctrl:${Date.now()}`,
      intro: "A software engineer interested in AI and distributed systems",
      location: "San Francisco, CA",
      socials: {
        x: "https://x.com/testintent",
        github: "https://github.com/testintent",
      }
    }).returning();

    testUserId = user.id;
    console.log(`Created test user: ${testUserId}`);

    // Create a profile for the user (required for process endpoint)
    await db.insert(schema.userProfiles).values({
      userId: testUserId,
      identity: {
        name: "Test Intent Controller User",
        bio: "Software engineer specializing in AI systems",
        location: "San Francisco, CA",
      },
      narrative: {
        context: "Building AI-powered applications and exploring distributed systems",
      },
      attributes: {
        interests: ["AI", "distributed systems", "machine learning"],
        skills: ["Python", "TypeScript", "Go"],
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    if (testUserId) {
      await db.delete(schema.intents)
        .where(eq(schema.intents.userId, testUserId));
      await db.delete(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, testUserId));
      await db.delete(schema.users)
        .where(eq(schema.users.id, testUserId));
    }
    await closeDb();
  });

  test("process should handle explicit intent content", async () => {
    console.log("Testing explicit intent processing...");
    
    // Create a mock request with JSON body containing explicit content
    const mockBody = JSON.stringify({ 
      content: "I'm looking for a co-founder for an AI startup" 
    });
    const mockRequest = new Request("http://localhost/intents/process", {
      method: "POST",
      body: mockBody,
      headers: { "Content-Type": "application/json" },
    });

    const mockUser: AuthenticatedUser = {
      id: testUserId,
      privyId: `privy:intent-ctrl:${Date.now()}`,
      email: testEmail,
      name: "Test Intent Controller User",
    };

    const response = await controller.process(mockRequest, mockUser);
    const result = await response.json();

    console.log("Process result:", JSON.stringify(result, null, 2));

    expect(result).toBeDefined();
    // The graph should return actions or some result structure
    expect((result as any).userId).toBe(testUserId);
  }, 120000); // Extended timeout for LLM calls

  test("process should handle implicit intent (no content)", async () => {
    console.log("Testing implicit intent processing...");
    
    // Create a mock request with empty body (implicit intent inference from profile)
    const mockRequest = {} as Request;
    
    // Override json to throw (simulating no content)
    (mockRequest as any).json = async () => {
      throw new Error("No body");
    };

    const mockUser: AuthenticatedUser = {
      id: testUserId,
      privyId: `privy:intent-ctrl:${Date.now()}`,
      email: testEmail,
      name: "Test Intent Controller User",
    };

    const response = await controller.process(mockRequest, mockUser);
    const result = await response.json();

    console.log("Implicit process result:", JSON.stringify(result, null, 2));

    expect(result).toBeDefined();
    expect((result as any).userId).toBe(testUserId);
    // Implicit intents are inferred from profile
  }, 120000); // Extended timeout for LLM calls
});

// ═══════════════════════════════════════════════════════════════════════════════
// IntentController Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("IntentController Edge Cases", () => {
  const controller = new IntentController();
  let testUserIdNoProfile: string;
  const testEmailNoProfile = `test-intent-no-profile-${Date.now()}@example.com`;

  beforeAll(async () => {
    // Setup: Create test user WITHOUT profile
    const existingUser = await db.select()
      .from(schema.users)
      .where(eq(schema.users.email, testEmailNoProfile))
      .limit(1);

    if (existingUser.length > 0) {
      await db.delete(schema.intents)
        .where(eq(schema.intents.userId, existingUser[0].id));
      await db.delete(schema.users)
        .where(eq(schema.users.email, testEmailNoProfile));
    }

    const [user] = await db.insert(schema.users).values({
      email: testEmailNoProfile,
      name: "Test No Profile User",
      privyId: `privy:intent-noprofile:${Date.now()}`,
    }).returning();

    testUserIdNoProfile = user.id;
    console.log(`Created test user without profile: ${testUserIdNoProfile}`);
  });

  afterAll(async () => {
    if (testUserIdNoProfile) {
      await db.delete(schema.intents)
        .where(eq(schema.intents.userId, testUserIdNoProfile));
      await db.delete(schema.users)
        .where(eq(schema.users.id, testUserIdNoProfile));
    }
  });

  test("process should work with empty profile (userProfile defaults to '{}')", async () => {
    console.log("Testing process with no profile...");

    const mockBody = JSON.stringify({ 
      content: "Looking for React developers" 
    });
    const mockRequest = new Request("http://localhost/intents/process", {
      method: "POST",
      body: mockBody,
      headers: { "Content-Type": "application/json" },
    });

    const mockUser: AuthenticatedUser = {
      id: testUserIdNoProfile,
      privyId: `privy:intent-noprofile:${Date.now()}`,
      email: testEmailNoProfile,
      name: "Test No Profile User",
    };

    // The controller handles missing profile by using '{}' as userProfile
    // This test verifies the graph still runs (with empty profile context)
    const response = await controller.process(mockRequest, mockUser);
    const result = await response.json();

    console.log("No profile process result:", JSON.stringify(result, null, 2));

    expect(result).toBeDefined();
    expect((result as any).userId).toBe(testUserIdNoProfile);
  }, 120000);
});
