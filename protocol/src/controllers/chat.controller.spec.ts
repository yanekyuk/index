import { describe, test, expect, beforeAll, afterAll } from "bun:test";

import { config } from "dotenv";
config({ path: '.env.development', override: true });

import { ChatController } from "./chat.controller";
import { ChatDatabaseAdapter } from "../adapters/database.adapter";
import type { AuthenticatedUser } from "../guards/auth.guard";
import db, { closeDb } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { eq } from 'drizzle-orm';

// Response type for chat controller
interface ChatResponse {
  response?: string;
  routingDecision?: any;
  subgraphResults?: any;
  error?: string;
}

// Integration test suite for ChatController using actual DB
describe("ChatController Integration", () => {
  let controller: ChatController;
  let testUserId: string;
  /** Index IDs created for getIntentsInIndexForMember tests; cleaned in afterAll */
  let testIndexId: string | null = null;
  let testIndexIdOther: string | null = null;

  beforeAll(async () => {
    // Setup - Ensure we are in a clean state (cleanup if previous run failed)
    const email = "test-chat-controller@example.com";

    // Check if user exists, if so delete to start fresh
    const existingUser = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);

    if (existingUser.length > 0) {
      // Clean up any intents first
      await db.delete(schema.intents).where(eq(schema.intents.userId, existingUser[0].id));
      await db.delete(schema.users).where(eq(schema.users.email, email));
    }

    // Create a real user in the DB
    const [user] = await db.insert(schema.users).values({
      email: email,
      name: "Test Chat User",
      privyId: `privy:chat:${Date.now()}`, // Unique Privy ID
      intro: "A software developer interested in AI and distributed systems.",
      location: "New York, NY",
      socials: {
        x: "https://x.com/testchat",
      }
    }).returning();

    testUserId = user.id;
    console.log(`Created test user: ${testUserId}`);

    // Create a user profile for the test user
    await db.insert(schema.userProfiles).values({
      userId: testUserId,
      identity: {
        name: "Test Chat User",
        bio: "A software developer interested in AI and distributed systems.",
        location: "New York, NY"
      },
      narrative: {
        context: "Software developer with 5 years of experience, building AI-powered applications"
      },
      attributes: {
        skills: ["TypeScript", "Python", "Machine Learning"],
        interests: ["AI", "Distributed Systems", "Open Source"]
      },
      embedding: Array(2000).fill(0.01) // Placeholder embedding
    });

    console.log(`Created test user profile for: ${testUserId}`);

    // Initialize controller
    controller = new ChatController();
  });

  afterAll(async () => {
    // Clean up indexes created for getIntentsInIndexForMember tests
    for (const indexId of [testIndexId, testIndexIdOther]) {
      if (indexId) {
        await db.delete(schema.intentIndexes).where(eq(schema.intentIndexes.indexId, indexId));
        await db.delete(schema.indexMembers).where(eq(schema.indexMembers.indexId, indexId));
        await db.delete(schema.indexes).where(eq(schema.indexes.id, indexId));
      }
    }
    if (testUserId) {
      // Clean up intents first
      await db.delete(schema.intents).where(eq(schema.intents.userId, testUserId));
      // Clean up user (cascading delete should handle profile)
      await db.delete(schema.users).where(eq(schema.users.id, testUserId));
    }
    await closeDb();
  });

  describe("ChatDatabaseAdapter", () => {
    let adapter: ChatDatabaseAdapter;

    beforeAll(() => {
      adapter = new ChatDatabaseAdapter();
    });

    test("getProfile should return null for non-existent user", async () => {
      const profile = await adapter.getProfile("00000000-0000-0000-0000-000000000000");
      expect(profile).toBeNull();
    });

    test("getProfile should return profile for existing user", async () => {
      const profile = await adapter.getProfile(testUserId);
      expect(profile).not.toBeNull();
      expect(profile?.identity?.name).toBe("Test Chat User");
    });

    test("getUser should return null for non-existent user", async () => {
      const user = await adapter.getUser("00000000-0000-0000-0000-000000000000");
      expect(user).toBeNull();
    });

    test("getUser should return user for existing user", async () => {
      const user = await adapter.getUser(testUserId);
      expect(user).not.toBeNull();
      expect(user?.name).toBe("Test Chat User");
      expect(user?.email).toBe("test-chat-controller@example.com");
    });

    test("getActiveIntents should return empty array for user with no intents", async () => {
      const intents = await adapter.getActiveIntents(testUserId);
      expect(intents).toBeArray();
      expect(intents.length).toBe(0);
    });

    test("createIntent should create and return a new intent", async () => {
      const intentData = {
        userId: testUserId,
        payload: "Looking for collaborators on an AI project",
        summary: "AI collaboration",
        confidence: 0.9,
        inferenceType: 'explicit' as const,
        sourceType: 'discovery_form' as const,
      };

      const created = await adapter.createIntent(intentData);
      
      expect(created).not.toBeNull();
      expect(created.id).toBeDefined();
      expect(created.payload).toBe(intentData.payload);
      expect(created.summary).toBe(intentData.summary);
      expect(created.userId).toBe(testUserId);
    });

    test("getActiveIntents should return intents after creation", async () => {
      const intents = await adapter.getActiveIntents(testUserId);
      expect(intents).toBeArray();
      expect(intents.length).toBeGreaterThan(0);
      expect(intents[0].payload).toBe("Looking for collaborators on an AI project");
    });

    test("updateIntent should update an existing intent", async () => {
      // Get the intent we created
      const intents = await adapter.getActiveIntents(testUserId);
      expect(intents.length).toBeGreaterThan(0);
      
      const intentId = intents[0].id;
      const updated = await adapter.updateIntent(intentId, {
        payload: "Looking for collaborators on a machine learning project",
        summary: "ML collaboration"
      });

      expect(updated).not.toBeNull();
      expect(updated?.payload).toBe("Looking for collaborators on a machine learning project");
      expect(updated?.summary).toBe("ML collaboration");
    });

    test("archiveIntent should soft-delete an intent", async () => {
      // Get the intent we created
      const intents = await adapter.getActiveIntents(testUserId);
      expect(intents.length).toBeGreaterThan(0);
      
      const intentId = intents[0].id;
      const result = await adapter.archiveIntent(intentId);

      expect(result.success).toBe(true);

      // Verify intent no longer appears in active intents
      const activeIntents = await adapter.getActiveIntents(testUserId);
      const archivedIntent = activeIntents.find((i: { id: string }) => i.id === intentId);
      expect(archivedIntent).toBeUndefined();
    });

    test("archiveIntent should return error for non-existent intent", async () => {
      const result = await adapter.archiveIntent("00000000-0000-0000-0000-000000000001");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("getIntentsInIndexForMember should return empty for unknown index name", async () => {
      const intents = await adapter.getIntentsInIndexForMember(testUserId, "NonExistent Index Name");
      expect(intents).toBeArray();
      expect(intents.length).toBe(0);
    });

    test("getIntentsInIndexForMember should return intents when queried by index name", async () => {
      const [index] = await db.insert(schema.indexes).values({
        title: "Open Mock Network",
        prompt: "Test index for chat adapter",
      }).returning({ id: schema.indexes.id });
      if (!index) throw new Error("Failed to create index");
      testIndexId = index.id;

      await db.insert(schema.indexMembers).values({
        indexId: testIndexId,
        userId: testUserId,
        permissions: [],
        autoAssign: false,
      });

      const activeIntents = await adapter.getActiveIntents(testUserId);
      expect(activeIntents.length).toBeGreaterThan(0);
      await adapter.assignIntentToIndex(activeIntents[0].id, testIndexId);

      const intents = await adapter.getIntentsInIndexForMember(testUserId, "Open Mock Network");
      expect(intents).toBeArray();
      expect(intents.length).toBe(1);
      expect(intents[0].payload).toBe("Looking for collaborators on a machine learning project");
    });

    test("getIntentsInIndexForMember should return intents when queried by index ID", async () => {
      expect(testIndexId).not.toBeNull();
      const intents = await adapter.getIntentsInIndexForMember(testUserId!, testIndexId!);
      expect(intents).toBeArray();
      expect(intents.length).toBe(1);
      expect(intents[0].id).toBeDefined();
      expect(intents[0].payload).toBeDefined();
      expect(intents[0].summary).toBeDefined();
      expect(intents[0].createdAt).toBeInstanceOf(Date);
    });

    test("getIntentsInIndexForMember should return empty when user is not a member of the index", async () => {
      const [index] = await db.insert(schema.indexes).values({
        title: "Other Index User Not In",
        prompt: "Index without test user",
      }).returning({ id: schema.indexes.id });
      if (!index) throw new Error("Failed to create index");
      testIndexIdOther = index.id;

      const intents = await adapter.getIntentsInIndexForMember(testUserId, "Other Index User Not In");
      expect(intents).toBeArray();
      expect(intents.length).toBe(0);
    });
  });

  describe("ChatController.message endpoint", () => {
    test("should return error for missing message", async () => {
      const mockRequest = {
        json: async () => ({})
      } as unknown as Request;
      
      const mockUser: AuthenticatedUser = {
        id: testUserId,
        privyId: `privy:chat:${Date.now()}`,
        email: "test-chat-controller@example.com",
        name: "Test Chat User"
      };

      const response = await controller.message(mockRequest, mockUser);
      const data = await response.json() as ChatResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Message content is required');
    });

    test("should return error for invalid JSON body", async () => {
      const mockRequest = {
        json: async () => { throw new Error('Invalid JSON'); }
      } as unknown as Request;
      
      const mockUser: AuthenticatedUser = {
        id: testUserId,
        privyId: `privy:chat:${Date.now()}`,
        email: "test-chat-controller@example.com",
        name: "Test Chat User"
      };

      const response = await controller.message(mockRequest, mockUser);
      const data = await response.json() as ChatResponse;
      
      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request body. Expected { message: string }');
    });

    test("should process a simple greeting message", async () => {
      const mockRequest = {
        json: async () => ({ message: "Hello, how are you?" })
      } as unknown as Request;
      
      const mockUser: AuthenticatedUser = {
        id: testUserId,
        privyId: `privy:chat:${Date.now()}`,
        email: "test-chat-controller@example.com",
        name: "Test Chat User"
      };

      console.log("Starting chat message processing...");
      const response = await controller.message(mockRequest, mockUser);
      const data = await response.json() as ChatResponse;
      console.log("Chat response:", data);

      expect(response.status).toBe(200);
      expect(data.response).toBeDefined();
      expect(typeof data.response).toBe('string');
      expect(data.response!.length).toBeGreaterThan(0);
      expect(data.routingDecision).toBeDefined();
    }, 120000); // Long timeout for LLM calls

    test("should process an intent-related message", async () => {
      const mockRequest = {
        json: async () => ({ message: "I'm looking for people who are interested in building AI agents" })
      } as unknown as Request;
      
      const mockUser: AuthenticatedUser = {
        id: testUserId,
        privyId: `privy:chat:${Date.now()}`,
        email: "test-chat-controller@example.com",
        name: "Test Chat User"
      };

      console.log("Starting intent-related message processing...");
      const response = await controller.message(mockRequest, mockUser);
      const data = await response.json() as ChatResponse;
      console.log("Chat response for intent message:", data);

      expect(response.status).toBe(200);
      expect(data.response).toBeDefined();
      expect(typeof data.response).toBe('string');
      expect(data.routingDecision).toBeDefined();
      // The router should identify this as intent-related
      // But we don't strictly enforce the routing target since it depends on LLM output
    }, 120000); // Long timeout for LLM calls

    test("should process a profile-related message", async () => {
      const mockRequest = {
        json: async () => ({ message: "Update my profile to include that I'm now focused on LLM applications" })
      } as unknown as Request;
      
      const mockUser: AuthenticatedUser = {
        id: testUserId,
        privyId: `privy:chat:${Date.now()}`,
        email: "test-chat-controller@example.com",
        name: "Test Chat User"
      };

      console.log("Starting profile-related message processing...");
      const response = await controller.message(mockRequest, mockUser);
      const data = await response.json() as ChatResponse;
      console.log("Chat response for profile message:", data);

      expect(response.status).toBe(200);
      expect(data.response).toBeDefined();
      expect(typeof data.response).toBe('string');
    }, 120000); // Long timeout for LLM calls

    test("should create intent from hiring message with URL without leaking internal JSON or URLs in intent", async () => {
      // Scenario: User wants to hire developers and provides a GitHub URL for context.
      // The response must NOT contain internal pipeline JSON (classification, felicity_scores,
      // actions, indexScore, etc.). Created intents must NOT contain "More details at [url]"
      // or raw URLs in the description.
      const mockRequest = {
        json: async () => ({
          message: "I want to hire developers who would be interested in the following project: https://github.com/indexnetwork/index"
        })
      } as unknown as Request;

      const mockUser: AuthenticatedUser = {
        id: testUserId,
        privyId: `privy:chat:${Date.now()}`,
        email: "test-chat-controller@example.com",
        name: "Test Chat User"
      };

      const response = await controller.message(mockRequest, mockUser);
      const data = await response.json() as ChatResponse;

      expect(response.status).toBe(200);
      expect(data.response).toBeDefined();
      expect(typeof data.response).toBe("string");

      // Must NOT contain internal pipeline JSON (streamEvents was emitting nested model output)
      const internalJsonMarkers = [
        '"classification"',
        '"felicity_scores"',
        '"actions"',
        '"indexScore"',
        '"memberScore"',
        '"semantic_entropy"',
        '"referential_anchor"',
        '"intentMode"',
        '"referentialAnchor"',
      ];
      for (const marker of internalJsonMarkers) {
        expect(data.response).not.toContain(marker);
      }

      // Created intents must NOT contain URLs or "More details at" in payload
      const adapter = new ChatDatabaseAdapter();
      const intents = await adapter.getActiveIntents(testUserId);
      for (const intent of intents) {
        expect(intent.payload).not.toMatch(/https?:\/\//);
        expect(intent.payload.toLowerCase()).not.toContain("more details at");
      }
    }, 120000); // Long timeout for LLM + scraping
  });
});
