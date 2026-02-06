/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { OpportunityController } from "./opportunity.controller";
import { OpportunityDatabaseAdapter } from "../adapters/database.adapter";
import type { AuthenticatedUser } from "../guards/auth.guard";
import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { eq } from 'drizzle-orm';

// ═══════════════════════════════════════════════════════════════════════════════
// OpportunityDatabaseAdapter Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("OpportunityDatabaseAdapter Integration", () => {
  let adapter: OpportunityDatabaseAdapter;
  let testUserId: string;
  const testEmail = `test-opportunity-adapter-${Date.now()}@example.com`;

  beforeAll(async () => {
    // Setup: Create test user with profile
    const existingUser = await db.select()
      .from(schema.users)
      .where(eq(schema.users.email, testEmail))
      .limit(1);

    if (existingUser.length > 0) {
      await db.delete(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, existingUser[0].id));
      await db.delete(schema.users)
        .where(eq(schema.users.email, testEmail));
    }

    const [user] = await db.insert(schema.users).values({
      email: testEmail,
      name: "Test Opportunity Adapter User",
      privyId: `privy:opp-adapter:${Date.now()}`,
      intro: "Test user for opportunity adapter tests",
      location: "Test City",
    }).returning();

    testUserId = user.id;
    console.log(`Created test user: ${testUserId}`);

    // Create a profile for the test user
    await db.insert(schema.userProfiles).values({
      userId: testUserId,
      identity: {
        name: "Test Opportunity Adapter User",
        bio: "Full-stack developer with focus on distributed systems",
        location: "Test City",
      },
      narrative: {
        context: "Building scalable applications and exploring new technologies",
      },
      attributes: {
        interests: ["distributed systems", "databases", "TypeScript"],
        skills: ["Node.js", "PostgreSQL", "Redis"],
      },
    });

    adapter = new OpportunityDatabaseAdapter();
  });

  afterAll(async () => {
    // Cleanup
    if (testUserId) {
      await db.delete(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, testUserId));
      await db.delete(schema.users)
        .where(eq(schema.users.id, testUserId));
    }
  });

  test("getProfile should return profile document for existing user", async () => {
    const profile = await adapter.getProfile(testUserId);

    expect(profile).not.toBeNull();
    expect(profile!.identity).toBeDefined();
    expect(profile!.identity.name).toBe("Test Opportunity Adapter User");
    expect(profile!.identity.bio).toBe("Full-stack developer with focus on distributed systems");
    expect(profile!.identity.location).toBe("Test City");
    expect(profile!.narrative).toBeDefined();
    expect(profile!.narrative.context).toBe("Building scalable applications and exploring new technologies");
    expect(profile!.attributes).toBeDefined();
    expect(profile!.attributes.interests).toContain("distributed systems");
    expect(profile!.attributes.skills).toContain("Node.js");
  });

  test("getProfile should return null for non-existent user", async () => {
    const fakeUserId = "00000000-0000-0000-0000-000000000000";
    const profile = await adapter.getProfile(fakeUserId);

    expect(profile).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OpportunityController Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("OpportunityController Integration", () => {
  const controller = new OpportunityController();
  let testUserId: string;
  let candidateUserId: string;
  const testEmail = `test-opportunity-ctrl-${Date.now()}@example.com`;
  const candidateEmail = `test-opportunity-candidate-${Date.now()}@example.com`;

  beforeAll(async () => {
    // Cleanup any existing test users
    for (const email of [testEmail, candidateEmail]) {
      const existingUser = await db.select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      if (existingUser.length > 0) {
        await db.delete(schema.userProfiles)
          .where(eq(schema.userProfiles.userId, existingUser[0].id));
        await db.delete(schema.users)
          .where(eq(schema.users.email, email));
      }
    }

    // Create main test user
    const [user] = await db.insert(schema.users).values({
      email: testEmail,
      name: "Test Opportunity Controller User",
      privyId: `privy:opp-ctrl:${Date.now()}`,
      intro: "CEO of an AI startup looking for technical talent",
      location: "San Francisco, CA",
      socials: {
        x: "https://x.com/testopp",
        linkedin: "https://linkedin.com/in/testopp",
      }
    }).returning();

    testUserId = user.id;
    console.log(`Created main test user: ${testUserId}`);

    // Create profile for main user
    await db.insert(schema.userProfiles).values({
      userId: testUserId,
      identity: {
        name: "Test Opportunity Controller User",
        bio: "Startup CEO focused on AI-powered products",
        location: "San Francisco, CA",
      },
      narrative: {
        context: "Building the next generation of AI tools for developers",
      },
      attributes: {
        interests: ["AI", "startups", "product development"],
        skills: ["leadership", "product strategy", "fundraising"],
      },
      // Add embedding so this user can be found in vector search
      embedding: Array(2000).fill(0.1),
    });

    // Create candidate user (potential match)
    const [candidate] = await db.insert(schema.users).values({
      email: candidateEmail,
      name: "Test Candidate User",
      privyId: `privy:opp-candidate:${Date.now()}`,
      intro: "Senior ML engineer with startup experience",
      location: "New York, NY",
    }).returning();

    candidateUserId = candidate.id;
    console.log(`Created candidate test user: ${candidateUserId}`);

    // Create profile for candidate user with embedding
    await db.insert(schema.userProfiles).values({
      userId: candidateUserId,
      identity: {
        name: "Test Candidate User",
        bio: "Machine learning engineer specializing in NLP and computer vision",
        location: "New York, NY",
      },
      narrative: {
        context: "Led ML teams at multiple startups, looking for new opportunities",
      },
      attributes: {
        interests: ["machine learning", "NLP", "computer vision", "startups"],
        skills: ["Python", "PyTorch", "TensorFlow", "MLOps"],
      },
      // Add embedding so candidate can be found in vector search
      embedding: Array(2000).fill(0.15),
    });
  });

  afterAll(async () => {
    // Cleanup
    if (testUserId) {
      await db.delete(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, testUserId));
      await db.delete(schema.users)
        .where(eq(schema.users.id, testUserId));
    }
    if (candidateUserId) {
      await db.delete(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, candidateUserId));
      await db.delete(schema.users)
        .where(eq(schema.users.id, candidateUserId));
    }
    // Do not close db: other specs may run in the same process.
  });

  test("discover should return 400 if query is missing", async () => {
    const mockRequest = new Request("http://localhost/opportunities/discover", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    const mockUser: AuthenticatedUser = {
      id: testUserId,
      privyId: `privy:opp-ctrl:${Date.now()}`,
      email: testEmail,
      name: "Test Opportunity Controller User",
    };

    const response = await controller.discover(mockRequest, mockUser);

    expect(response.status).toBe(400);
    const result = await response.json();
    expect((result as any).error).toContain("query");
  });

  test("discover should return 400 if query is not a string", async () => {
    const mockRequest = new Request("http://localhost/opportunities/discover", {
      method: "POST",
      body: JSON.stringify({ query: 123 }),
      headers: { "Content-Type": "application/json" },
    });

    const mockUser: AuthenticatedUser = {
      id: testUserId,
      privyId: `privy:opp-ctrl:${Date.now()}`,
      email: testEmail,
      name: "Test Opportunity Controller User",
    };

    const response = await controller.discover(mockRequest, mockUser);

    expect(response.status).toBe(400);
    const result = await response.json();
    expect((result as any).error).toContain("query");
  });

  test("discover should find opportunities based on query", async () => {
    console.log("Testing opportunity discovery...");

    const mockRequest = new Request("http://localhost/opportunities/discover", {
      method: "POST",
      body: JSON.stringify({ 
        query: "Looking for machine learning engineers with startup experience",
        limit: 5
      }),
      headers: { "Content-Type": "application/json" },
    });

    const mockUser: AuthenticatedUser = {
      id: testUserId,
      privyId: `privy:opp-ctrl:${Date.now()}`,
      email: testEmail,
      name: "Test Opportunity Controller User",
    };

    const response = await controller.discover(mockRequest, mockUser);
    const result = await response.json();

    console.log("Discovery result:", JSON.stringify(result, null, 2));

    expect(response.status).toBe(200);
    expect(result).toBeDefined();
    // The result should contain discovered candidates or be empty
    // (depending on embedding similarity thresholds)
    expect((result as any).sourceUserId).toBe(testUserId);
  }, 60000); // Extended timeout for embedding/search

  test("discover should respect limit parameter", async () => {
    console.log("Testing discover with limit...");

    const mockRequest = new Request("http://localhost/opportunities/discover", {
      method: "POST",
      body: JSON.stringify({ 
        query: "Full-stack developers",
        limit: 2
      }),
      headers: { "Content-Type": "application/json" },
    });

    const mockUser: AuthenticatedUser = {
      id: testUserId,
      privyId: `privy:opp-ctrl:${Date.now()}`,
      email: testEmail,
      name: "Test Opportunity Controller User",
    };

    const response = await controller.discover(mockRequest, mockUser);
    const result = await response.json() as any;

    console.log("Limited discovery result:", JSON.stringify(result, null, 2));

    expect(response.status).toBe(200);
    expect(result).toBeDefined();
    // If candidates are found, they should be at most 'limit' count
    if (result.candidates && Array.isArray(result.candidates)) {
      expect(result.candidates.length).toBeLessThanOrEqual(2);
    }
  }, 60000);

  test("discover should exclude requesting user from results", async () => {
    console.log("Testing self-exclusion...");

    const mockRequest = new Request("http://localhost/opportunities/discover", {
      method: "POST",
      body: JSON.stringify({ 
        query: "Startup CEO looking for AI products", // Query matching the user's own profile
        limit: 10
      }),
      headers: { "Content-Type": "application/json" },
    });

    const mockUser: AuthenticatedUser = {
      id: testUserId,
      privyId: `privy:opp-ctrl:${Date.now()}`,
      email: testEmail,
      name: "Test Opportunity Controller User",
    };

    const response = await controller.discover(mockRequest, mockUser);
    const result = await response.json() as any;

    console.log("Self-exclusion result:", JSON.stringify(result, null, 2));

    expect(response.status).toBe(200);
    // If candidates are returned, none should be the requesting user
    if (result.candidates && Array.isArray(result.candidates)) {
      const selfIncluded = result.candidates.some(
        (c: any) => c.userId === testUserId || c.id === testUserId
      );
      expect(selfIncluded).toBe(false);
    }
  }, 60000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// OpportunityController Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("OpportunityController Edge Cases", () => {
  const controller = new OpportunityController();
  let testUserIdNoProfile: string;
  const testEmailNoProfile = `test-opp-no-profile-${Date.now()}@example.com`;

  beforeAll(async () => {
    // Setup: Create test user WITHOUT profile
    const existingUser = await db.select()
      .from(schema.users)
      .where(eq(schema.users.email, testEmailNoProfile))
      .limit(1);

    if (existingUser.length > 0) {
      await db.delete(schema.users)
        .where(eq(schema.users.email, testEmailNoProfile));
    }

    const [user] = await db.insert(schema.users).values({
      email: testEmailNoProfile,
      name: "Test No Profile User",
      privyId: `privy:opp-noprofile:${Date.now()}`,
    }).returning();

    testUserIdNoProfile = user.id;
    console.log(`Created test user without profile: ${testUserIdNoProfile}`);
  });

  afterAll(async () => {
    if (testUserIdNoProfile) {
      await db.delete(schema.users)
        .where(eq(schema.users.id, testUserIdNoProfile));
    }
  });

  test("discover should handle user with no profile gracefully", async () => {
    console.log("Testing discover with no profile...");

    const mockRequest = new Request("http://localhost/opportunities/discover", {
      method: "POST",
      body: JSON.stringify({ 
        query: "Looking for developers",
        limit: 5
      }),
      headers: { "Content-Type": "application/json" },
    });

    const mockUser: AuthenticatedUser = {
      id: testUserIdNoProfile,
      privyId: `privy:opp-noprofile:${Date.now()}`,
      email: testEmailNoProfile,
      name: "Test No Profile User",
    };

    // The controller should still work even without a profile for the source user
    // (profile is used for context but not required for basic discovery)
    const response = await controller.discover(mockRequest, mockUser);
    const result = await response.json();

    console.log("No profile discover result:", JSON.stringify(result, null, 2));

    // Should succeed (profile is loaded but may be null in the graph)
    expect(response.status).toBe(200);
    expect(result).toBeDefined();
  }, 60000);
});
