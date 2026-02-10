/**
 * Unit tests for chat tools (createChatTools, read_intents, read_indexes, read_users, create_opportunities, send_opportunity, etc.).
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { mock } from "bun:test";
mock.module("../../../../queues/notification.queue", () => ({
  queueOpportunityNotification: async () =>
    ({ id: "mock-job" } as unknown as Awaited<ReturnType<typeof import("../../../../queues/notification.queue").queueOpportunityNotification>>),
}));
mock.module("../../graphs/intent.graph", () => ({
  IntentGraphFactory: class {
    private database: ChatGraphCompositeDatabase;
    constructor(database: ChatGraphCompositeDatabase) {
      this.database = database;
    }
    createGraph() {
      const db = this.database;
      return {
        invoke: async (input: {
          userId: string;
          operationMode: string;
          indexId?: string;
          queryUserId?: string;
          allUserIntents?: boolean;
        }) => {
          // For read operations, replicate the real queryNode logic using the database
          if (input.operationMode === "read") {
            const effectiveIndexId = input.allUserIntents ? undefined : input.indexId;

            if (effectiveIndexId) {
              const isMember = await db.isIndexMember(effectiveIndexId, input.userId);
              if (!isMember) {
                return {
                  readResult: {
                    count: 0,
                    intents: [],
                    message: "Index not found or you are not a member.",
                  },
                };
              }

              if (!input.queryUserId) {
                const intents = await db.getIndexIntentsForMember(effectiveIndexId, input.userId);
                return {
                  readResult: {
                    count: intents.length,
                    indexId: effectiveIndexId,
                    intents: intents.map((i: any) => ({
                      id: i.id,
                      description: i.payload,
                      summary: i.summary,
                      createdAt: i.createdAt,
                      userId: i.userId,
                      userName: i.userName,
                    })),
                    ...(intents.length === 0 && { message: "No intents in this index yet." }),
                  },
                };
              }

              const intents = await db.getIntentsInIndexForMember(input.queryUserId, effectiveIndexId);
              const user = await db.getUser(input.queryUserId);
              const userName = user?.name ?? null;
              return {
                readResult: {
                  count: intents.length,
                  indexId: effectiveIndexId,
                  intents: intents.map((i: any) => ({
                    id: i.id,
                    description: i.payload,
                    summary: i.summary,
                    createdAt: i.createdAt,
                    userId: input.queryUserId,
                    userName,
                  })),
                },
              };
            }

            // No index scope: return user's own active intents
            const intents = await db.getActiveIntents(input.userId);
            return {
              readResult: {
                count: intents.length,
                intents: intents.map((i: any) => ({
                  id: i.id,
                  description: i.payload,
                  summary: i.summary,
                  createdAt: i.createdAt,
                })),
              },
            };
          }

          // For non-read operations, return default empty results
          return {
            executionResults: [],
            actions: [],
            inferredIntents: [],
          };
        },
      };
    }
  },
}));

import { describe, test, expect, beforeAll } from "bun:test";
import { createChatTools, type ToolContext } from "..";
import type { ChatGraphCompositeDatabase } from "../../interfaces/database.interface";
import type { ActiveIntent, IndexMemberDetails, IndexedIntentDetails } from "../../interfaces/database.interface";
import type { Embedder } from "../../interfaces/embedder.interface";
import type { Scraper } from "../../interfaces/scraper.interface";

const testUserId = "test-user-id-for-tools";

type MockOverrides = Partial<Pick<
  ChatGraphCompositeDatabase,
  "getUser" | "getIndex" | "getOwnedIndexes" | "isIndexOwner" | "isIndexMember" | "getIndexMembersForOwner" | "getIndexMembersForMember" | "getIndexIntentsForOwner" | "getIndexMemberships" | "getIndexIntentsForMember" | "getIndexWithPermissions" | "getOpportunity" | "updateOpportunityStatus" | "getActiveIntents" | "getIntentsInIndexForMember"
>>;

/**
 * Minimal mock database. getIntentsInIndexForMemberImpl is required for read_intents.
 * Optional overrides for index tools.
 */
function createMockDatabase(
  getIntentsInIndexForMemberImpl: (userId: string, indexId: string) => Promise<ActiveIntent[]>,
  overrides?: MockOverrides
): ChatGraphCompositeDatabase {
  const noop = async () => undefined;
  const noopNull = async () => null;
  const noopArray = async () => [];
  const noopBool = async () => false;
  const base = {
    getProfile: noopNull,
    getProfileByUserId: noopNull,
    getActiveIntents: noopArray,
    getIntentsInIndexForMember: getIntentsInIndexForMemberImpl,
    getUser: async (uid: string) => ({ id: uid, name: "Test User", email: "test@example.com" }),
    getIndex: async () => null,
    saveProfile: noop,
    saveHydeProfile: noop,
    createIntent: async () => ({ id: "", payload: "", summary: null, isIncognito: false, createdAt: new Date(), updatedAt: new Date(), userId: "" }),
    updateIntent: noopNull,
    updateUser: noopNull,
    archiveIntent: async () => ({ success: true }),
    getUserIndexIds: noopArray,
    getIndexMemberships: noopArray,
    getIndexWithPermissions: async () => null,
    getIntentForIndexing: noopNull,
    getIndexMemberContext: noopNull,
    isIntentAssignedToIndex: noopBool,
    assignIntentToIndex: noop,
    unassignIntentFromIndex: noop,
    getIndexIdsForIntent: noopArray,
    getOwnedIndexes: noopArray,
    isIndexOwner: noopBool,
    isIndexMember: noopBool,
    getIndexMembersForOwner: noopArray,
    getIndexMembersForMember: noopArray,
    getIndexIntentsForOwner: noopArray,
    getIndexIntentsForMember: noopArray,
    updateIndexSettings: async () => ({
      id: "",
      title: "",
      prompt: null,
      permissions: { joinPolicy: "invite_only" as const, invitationLink: null, allowGuestVibeCheck: false },
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      memberCount: 0,
      intentCount: 0,
    }),
    softDeleteIndex: noop,
    deleteProfile: noop,
    getIndexMemberCount: async () => 0,
    createIndex: async () => ({ id: "", title: "", prompt: null, permissions: { joinPolicy: "invite_only" as const, invitationLink: null, allowGuestVibeCheck: false } }),
    addMemberToIndex: async () => ({ success: true }),
    getOpportunity: noopNull,
    updateOpportunityStatus: noopNull,
  };
  return { ...base, ...overrides } as unknown as ChatGraphCompositeDatabase;
}

/** Stub embedder for tool creation (not invoked by read_intents). */
const mockEmbedder = {
  generate: async () => [] as number[],
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

/** Stub scraper for tool creation (not invoked by read_intents). */
const mockScraper = {
  scrape: async () => "",
  extractUrlContent: async (_url: string, _options?: { objective?: string }) => "",
} as unknown as Scraper;

describe("createChatTools", () => {
  test("returns an array that includes read_intents, read_indexes, read_users", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    expect(tools).toBeArray();
    expect(tools.find((t: { name: string }) => t.name === "read_intents")).toBeDefined();
    expect(tools.find((t: { name: string }) => t.name === "read_indexes")).toBeDefined();
    expect(tools.find((t: { name: string }) => t.name === "read_users")).toBeDefined();
  });
});

const testIndexId = "a1b2c3d4-0000-4000-8000-000000000001";

describe("read_intents tool", () => {
  let readIntentsTool: { invoke: (args: { indexId?: string; userId?: string }) => Promise<string> };

  beforeAll(async () => {
    const mockIntents: ActiveIntent[] = [
      { id: "intent-1", payload: "Find ML collaborators", summary: "ML collab", createdAt: new Date("2025-01-01") },
      { id: "intent-2", payload: "Learn Rust", summary: "Rust", createdAt: new Date("2025-01-02") },
    ];
    const indexIntentsForMember: IndexedIntentDetails[] = mockIntents.map((i) => ({
      ...i,
      userId: testUserId,
      userName: "Test User",
    }));
    const mockDb = createMockDatabase(async (userId, indexId) => {
      if (userId !== testUserId) return [];
      if (indexId === testIndexId) return mockIntents;
      return [];
    }, {
      isIndexMember: async () => true,
      getIndexIntentsForMember: async (_indexId, _requestingUserId) =>
        _indexId === testIndexId ? indexIntentsForMember : [],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents");
    if (!tool || typeof (tool as { invoke?: (args: unknown) => Promise<unknown> }).invoke !== "function") {
      throw new Error("read_intents tool not found or missing invoke");
    }
    readIntentsTool = tool as { invoke: (args: { indexId?: string; userId?: string }) => Promise<string> };
  });

  test("invoke returns success with intents and count when index has intents", async () => {
    const result = await readIntentsTool.invoke({ indexId: testIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.intents).toBeArray();
    expect(parsed.data.intents.length).toBe(2);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.intents[0]).toMatchObject({ id: "intent-1", description: "Find ML collaborators", summary: "ML collab" });
    expect(parsed.data.intents[1]).toMatchObject({ id: "intent-2", description: "Learn Rust", summary: "Rust" });
    expect(new Date(parsed.data.intents[0].createdAt).getTime()).toBe(new Date("2025-01-01").getTime());
  });

  test("invoke returns success with empty intents when user has no intents in that index", async () => {
    const otherIndexId = "a1b2c3d4-0000-4000-8000-000000000002";
    const result = await readIntentsTool.invoke({ indexId: otherIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.intents).toBeArray();
    expect(parsed.data.intents.length).toBe(0);
    expect(parsed.data.count).toBe(0);
  });

  test("invoke with indexId and no userId calls getIndexIntentsForMember with indexId and requesting userId", async () => {
    let capturedIndexId = "";
    let capturedRequestingUserId = "";
    const mockDb = createMockDatabase(async () => [], {
      isIndexMember: async () => true,
      getIndexIntentsForMember: async (indexId, requestingUserId) => {
        capturedIndexId = indexId;
        capturedRequestingUserId = requestingUserId;
        return [];
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { indexId?: string }) => Promise<string> };
    await tool.invoke({ indexId: testIndexId });
    expect(capturedIndexId).toBe(testIndexId);
    expect(capturedRequestingUserId).toBe(testUserId);
  });

  test("when context.indexId is set, omit indexId to use context index", async () => {
    let capturedIndex = "";
    const mockDb = createMockDatabase(async () => [], {
      isIndexMember: async () => true,
      getIndexIntentsForMember: async (indexId) => {
        capturedIndex = indexId;
        return [{ id: "i1", payload: "In index", summary: "X", createdAt: new Date(), userId: testUserId, userName: "Test" }];
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, indexId: testIndexId };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { indexId?: string }) => Promise<string> };
    const result = await tool.invoke({});
    expect(capturedIndex).toBe(testIndexId);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
  });

  test("when indexId is invalid UUID returns error", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { indexId?: string }) => Promise<string> };
    const result = await tool.invoke({ indexId: "not-a-uuid" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/Invalid index ID/i);
  });
});

describe("read_intents tool (index-scoped: owner vs member)", () => {
  const indexId = testIndexId;
  const allIndexIntents: IndexedIntentDetails[] = [
    { id: "ix-1", payload: "Intent from Alice", summary: "Alice", userId: "user-alice", userName: "Alice", createdAt: new Date("2025-01-01") },
    { id: "ix-2", payload: "Intent from Bob", summary: "Bob", userId: "user-bob", userName: "Bob", createdAt: new Date("2025-01-02") },
  ];
  const memberIntents: ActiveIntent[] = [
    { id: "mine-1", payload: "My intent in index", summary: "Mine", createdAt: new Date("2025-01-03") },
  ];

  test("when userId is omitted, getIndexIntentsForMember is called and returns all intents in index (shared network)", async () => {
    let getIndexIntentsForMemberCalled = false;
    const mockDb = createMockDatabase(async () => [], {
      isIndexMember: async () => true,
      getIndexIntentsForMember: async (idx, uid) => {
        getIndexIntentsForMemberCalled = true;
        expect(idx).toBe(indexId);
        expect(uid).toBe(testUserId);
        return allIndexIntents;
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { indexId?: string; userId?: string }) => Promise<string> };
    const result = await tool.invoke({ indexId });
    expect(getIndexIntentsForMemberCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.indexId).toBe(indexId);
    expect(parsed.data.intents).toHaveLength(2);
    expect(parsed.data.intents[0]).toMatchObject({ id: "ix-1", description: "Intent from Alice", userId: "user-alice", userName: "Alice" });
    expect(parsed.data.intents[1]).toMatchObject({ id: "ix-2", description: "Intent from Bob", userId: "user-bob", userName: "Bob" });
  });

  test("when userId is provided, getIntentsInIndexForMember is called for that user", async () => {
    const otherUserId = "00000000-0000-0000-0000-000000000002";
    let getIntentsInIndexForMemberCalledWith: { userId: string; indexId: string } | null = null;
    const mockDb = createMockDatabase(async (uid, idx) => {
      getIntentsInIndexForMemberCalledWith = { userId: uid, indexId: idx };
      if (uid === otherUserId && idx === indexId) return [{ id: "bob-1", payload: "Bob intent", summary: "B", createdAt: new Date() }];
      return [];
    }, { isIndexMember: async () => true });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { indexId?: string; userId?: string }) => Promise<string> };
    const result = await tool.invoke({ indexId, userId: otherUserId });
    expect(getIntentsInIndexForMemberCalledWith).toMatchObject({
      userId: otherUserId,
      indexId,
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
    expect(parsed.data.intents[0]).toMatchObject({ id: "bob-1", description: "Bob intent" });
  });

  test("when isIndexMember and userId omitted, getIndexIntentsForMember is called (shared network: all intents)", async () => {
    let getIndexIntentsForMemberCalled = false;
    const allIntentsInIndex: IndexedIntentDetails[] = [
      { id: "mine-1", payload: "My intent in index", summary: "Mine", createdAt: new Date(), userId: testUserId, userName: "Test User" },
    ];
    const mockDb = createMockDatabase(async () => [], {
      isIndexMember: async () => true,
      getIndexIntentsForMember: async (idx, requestingUserId) => {
        getIndexIntentsForMemberCalled = true;
        expect(idx).toBe(indexId);
        expect(requestingUserId).toBe(testUserId);
        return allIntentsInIndex;
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { indexId?: string }) => Promise<string> };
    const result = await tool.invoke({ indexId });
    expect(getIndexIntentsForMemberCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
    expect(parsed.data.intents[0]).toMatchObject({ id: "mine-1", description: "My intent in index", userId: testUserId, userName: "Test User" });
  });

  test("when userId is provided, response includes userId and userName for each intent", async () => {
    const otherUserId = "00000000-0000-0000-0000-000000000002";
    const mockDb = createMockDatabase(async (uid, idx) => {
      if (uid === otherUserId && idx === indexId) return [{ id: "bob-1", payload: "Bob's goal", summary: "B", createdAt: new Date() }];
      return [];
    }, {
      isIndexMember: async () => true,
      getUser: async (uid: string) =>
        uid === otherUserId ? { id: uid, name: "Bob", email: "bob@example.com" } : null,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { indexId?: string; userId?: string }) => Promise<string> };
    const result = await tool.invoke({ indexId, userId: otherUserId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.intents).toHaveLength(1);
    expect(parsed.data.intents[0]).toMatchObject({
      id: "bob-1",
      description: "Bob's goal",
      userId: otherUserId,
      userName: "Bob",
    });
  });

  test("when indexId is set but user is not a member, returns error", async () => {
    const mockDb = createMockDatabase(async () => [], {
      isIndexOwner: async () => false,
      isIndexMember: async () => false,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { indexId?: string }) => Promise<string> };
    const result = await tool.invoke({ indexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/not a member|Index not found/i);
  });
});

describe("read_intents tool (no indexId)", () => {
  const globalIntents: ActiveIntent[] = [
    { id: "g1", payload: "Global intent A", summary: "A", createdAt: new Date("2025-01-01") },
    { id: "g2", payload: "Global intent B", summary: "B", createdAt: new Date("2025-01-02") },
  ];
  const indexScopedIntents: ActiveIntent[] = [
    { id: "i1", payload: "Intent in index only", summary: "Index", createdAt: new Date("2025-01-03") },
  ];

  test("without indexId calls getActiveIntents and returns all intents", async () => {
    let getActiveIntentsCalled = false;
    const mockDb = createMockDatabase(async () => []);
    const dbWithSpy = {
      ...mockDb,
      getActiveIntents: async (uid: string) => {
        getActiveIntentsCalled = true;
        expect(uid).toBe(testUserId);
        return globalIntents;
      },
    };
    const context: ToolContext = { userId: testUserId, database: dbWithSpy, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { indexId?: string }) => Promise<string> };
    const result = await tool.invoke({});
    expect(getActiveIntentsCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.intents).toHaveLength(2);
    expect(parsed.data.intents[0]).toMatchObject({ id: "g1", description: "Global intent A" });
  });

  test("with context.indexId and no indexId arg calls getIndexIntentsForMember and returns index-scoped intents", async () => {
    const indexId = testIndexId;
    const indexScopedWithUser: IndexedIntentDetails[] = indexScopedIntents.map((i) => ({ ...i, userId: testUserId, userName: "Test User" }));
    let getIndexIntentsForMemberCalled = false;
    const mockDb = createMockDatabase(async () => [], {
      isIndexMember: async () => true,
      getIndexIntentsForMember: async (idxId, uid) => {
        getIndexIntentsForMemberCalled = true;
        expect(uid).toBe(testUserId);
        expect(idxId).toBe(indexId);
        return indexScopedWithUser;
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, indexId };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { indexId?: string }) => Promise<string> };
    const result = await tool.invoke({});
    expect(getIndexIntentsForMemberCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
    expect(parsed.data.intents[0]).toMatchObject({ id: "i1", description: "Intent in index only" });
  });

  test("with context.indexId, allUserIntents: true returns all user intents (getActiveIntents) and does not use index", async () => {
    const indexId = testIndexId;
    let getActiveIntentsCalled = false;
    let getIntentsInIndexForMemberCalled = false;
    const mockDb = createMockDatabase(async () => {
      getIntentsInIndexForMemberCalled = true;
      return [];
    }, {
      isIndexMember: async () => true,
      getActiveIntents: async (uid: string) => {
        getActiveIntentsCalled = true;
        return globalIntents;
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, indexId };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { allUserIntents?: boolean }) => Promise<string> };
    const result = await tool.invoke({ allUserIntents: true });
    expect(getActiveIntentsCalled).toBe(true);
    expect(getIntentsInIndexForMemberCalled).toBe(false);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.intents).toHaveLength(2);
  });

  test("without indexId, when userId arg is another user, returns error (no viewing other users' global intents)", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { userId?: string }) => Promise<string> };
    const result = await tool.invoke({ userId: "other-user-id" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/Not authorized|other users' global intents/i);
  });
});

describe("read_users tool", () => {
  const memberIndexId = testIndexId;
  const mockMembers: IndexMemberDetails[] = [
    { userId: "u1", name: "Alice", avatar: null, email: "alice@example.com", permissions: ["member"], memberPrompt: null, autoAssign: true, joinedAt: new Date("2025-01-01"), intentCount: 2 },
    { userId: "u2", name: "Bob", avatar: null, email: "bob@example.com", permissions: ["member"], memberPrompt: null, autoAssign: false, joinedAt: new Date("2025-01-02"), intentCount: 1 },
  ];

  test("invoke returns success with members when member and indexId is UUID", async () => {
    const mockDb = createMockDatabase(async () => [], {
      isIndexMember: async () => true,
      getIndexMembersForMember: async (indexId, uid) => {
        if (indexId === memberIndexId && uid === testUserId) return mockMembers;
        throw new Error("Access denied: Not a member of this index");
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_users") as { invoke: (args: { indexId: string }) => Promise<string> };
    const result = await tool.invoke({ indexId: memberIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.indexId).toBe(memberIndexId);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.members).toBeArray();
    expect(parsed.data.members[0]).toMatchObject({ name: "Alice", intentCount: 2 });
    expect(parsed.data.members[1]).toMatchObject({ name: "Bob", intentCount: 1 });
  });

  test("invoke returns error when not member", async () => {
    const mockDb = createMockDatabase(async () => [], {
      isIndexMember: async () => false,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_users") as { invoke: (args: { indexId: string }) => Promise<string> };
    const result = await tool.invoke({ indexId: memberIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain("not a member");
  });

  test("invoke returns error when indexId is not a valid UUID", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_users") as { invoke: (args: { indexId: string }) => Promise<string> };
    const result = await tool.invoke({ indexId: "not-a-uuid" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/Invalid index ID/i);
  });
});

describe("create_intent tool (Phase 2 index scope)", () => {
  test("create_intent tool schema includes optional indexId", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const createIntentTool = tools.find((t: { name: string }) => t.name === "create_intent");
    expect(createIntentTool).toBeDefined();
    const schema = (createIntentTool as { schema?: { shape?: Record<string, unknown> } }).schema;
    expect(schema?.shape?.indexId ?? (createIntentTool as { schema?: { schema?: { shape?: Record<string, unknown> } } }).schema?.schema?.shape?.indexId).toBeDefined();
  });

});

describe("scrape_url tool", () => {
  test("returns a tool named scrape_url", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "scrape_url");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("scrape_url");
  });

  test("invoke calls scraper.extractUrlContent with url and no objective when objective omitted", async () => {
    let capturedUrl: string | null = null;
    let capturedOptions: { objective?: string } | undefined = undefined;
    const scraperWithSpy = {
      scrape: async () => "",
      extractUrlContent: async (url: string, options?: { objective?: string }) => {
        capturedUrl = url;
        capturedOptions = options;
        return "Some scraped content";
      },
    } as unknown as Scraper;
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: scraperWithSpy };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "scrape_url") as { invoke: (args: { url: string; objective?: string }) => Promise<string> };
    await tool.invoke({ url: "https://example.com/page" });
    expect(capturedUrl as unknown as string).toBe("https://example.com/page");
    expect((capturedOptions as { objective?: string } | undefined)?.objective).toBeUndefined();
  });

  test("invoke calls scraper.extractUrlContent with url and objective when provided", async () => {
    let capturedUrl: string | null = null;
    let capturedOptions: { objective?: string } | undefined = undefined;
    const scraperWithSpy = {
      scrape: async () => "",
      extractUrlContent: async (url: string, options?: { objective?: string }) => {
        capturedUrl = url;
        capturedOptions = options;
        return "Intent-focused content";
      },
    } as unknown as Scraper;
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: scraperWithSpy };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "scrape_url") as { invoke: (args: { url: string; objective?: string }) => Promise<string> };
    const objective = "User wants to create an intent from this link (project/repo or similar).";
    await tool.invoke({ url: "https://github.com/org/repo", objective });
    expect(capturedUrl as unknown as string).toBe("https://github.com/org/repo");
    expect((capturedOptions as { objective?: string } | undefined)?.objective).toBe(objective);
  });

  test("invoke returns success with content when scraper returns content", async () => {
    const scraperReturningContent = {
      scrape: async () => "",
      extractUrlContent: async () => "Scraped page text for example.com",
    } as unknown as Scraper;
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: scraperReturningContent };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "scrape_url") as { invoke: (args: { url: string; objective?: string }) => Promise<string> };
    const result = await tool.invoke({ url: "https://example.com" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.url).toBe("https://example.com");
    expect(parsed.data.content).toBe("Scraped page text for example.com");
    expect(parsed.data.contentLength).toBe("Scraped page text for example.com".length);
  });

  test("invoke returns error for invalid URL", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "scrape_url") as { invoke: (args: { url: string }) => Promise<string> };
    const result = await tool.invoke({ url: "not-a-valid-url" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain("Invalid URL");
  });
});

describe("read_indexes (Phase 3 index-scoped)", () => {
  const scopedIndexId = "a1b2c3d4-0000-4000-8000-000000000010";

  test("when context.indexId is set and showAll not true, returns only current index membership with scopeNote", async () => {
    const oneMembership = [{ indexId: scopedIndexId, indexTitle: "Current Index", indexPrompt: null, permissions: [], memberPrompt: null, autoAssign: true, joinedAt: new Date() }];
    const mockDb = createMockDatabase(async () => [], {
      getIndexMemberships: async (uid) => (uid === testUserId ? oneMembership : []),
      getOwnedIndexes: async () => [],
      isIndexMember: async () => true,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, indexId: scopedIndexId };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_indexes") as { invoke: (args: { showAll?: boolean }) => Promise<string> };
    const result = await tool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.memberOf).toHaveLength(1);
    expect(parsed.data.memberOf[0].indexId).toBe(scopedIndexId);
    expect(parsed.data.summary.scopeNote).toContain("Showing current index");
  });

  test("when context.indexId is set and showAll true, returns all memberships", async () => {
    const allMemberships = [
      { indexId: scopedIndexId, indexTitle: "Index A", indexPrompt: null, permissions: [], memberPrompt: null, autoAssign: true, joinedAt: new Date() },
      { indexId: "b2c3d4e5-0000-4000-8000-000000000011", indexTitle: "Index B", indexPrompt: null, permissions: [], memberPrompt: null, autoAssign: false, joinedAt: new Date() },
    ];
    const mockDb = createMockDatabase(async () => [], {
      getIndexMemberships: async (uid) => (uid === testUserId ? allMemberships : []),
      getOwnedIndexes: async () => [],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, indexId: scopedIndexId };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_indexes") as { invoke: (args: { showAll?: boolean }) => Promise<string> };
    const result = await tool.invoke({ showAll: true });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.memberOf).toHaveLength(2);
    expect(parsed.data.summary.scopeNote).toBeUndefined();
  });
});

describe("update_intent and delete_intent (Phase 3 index-scoping)", () => {
  const indexId = "a1b2c3d4-0000-4000-8000-000000000020";
  const intentInIndex = { id: "c2505011-2e45-426e-81dd-b9abb9b72001", payload: "In scope", summary: "X", createdAt: new Date() };
  const intentNotInIndex = "c2505011-2e45-426e-81dd-b9abb9b72099"; // Valid UUID but not in index

  test("update_intent when context.indexId set and intent not in that index returns error", async () => {
    const mockDb = createMockDatabase(async (uid, idx) => {
      if (uid === testUserId && idx === indexId) return [intentInIndex];
      return [];
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, indexId };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "update_intent") as { invoke: (args: { intentId: string; newDescription: string }) => Promise<string> };
    const result = await tool.invoke({ intentId: intentNotInIndex, newDescription: "Updated" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("not in the current index");
  });

  test("delete_intent when context.indexId set and intent not in that index returns error", async () => {
    const mockDb = createMockDatabase(async (uid, idx) => {
      if (uid === testUserId && idx === indexId) return [intentInIndex];
      return [];
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, indexId };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "delete_intent") as { invoke: (args: { intentId: string }) => Promise<string> };
    const result = await tool.invoke({ intentId: intentNotInIndex });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("not in the current index");
  });
});

describe("create_opportunities tool", () => {
  test("returns a tool named create_opportunities with schema containing searchQuery and optional indexId", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities");
    expect(tool).toBeDefined();
    const schema = (tool as { schema?: { shape?: Record<string, unknown> } }).schema;
    const shape = schema?.shape ?? (tool as { schema?: { schema?: { shape?: Record<string, unknown> } } }).schema?.schema?.shape;
    expect(shape?.searchQuery).toBeDefined();
    expect(shape?.indexId).toBeDefined();
  });

  test("when user has no index memberships (getIndexMemberships returns []), returns found false with message about joining an index", async () => {
    const mockDb = createMockDatabase(async () => [], {
      getIndexMemberships: async () => [],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as { invoke: (args: { searchQuery: string; indexId?: string }) => Promise<string> };
    const result = await tool.invoke({ searchQuery: "Find a co-founder" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.found).toBe(false);
    expect(parsed.data.message).toMatch(/join|index|community/i);
  });
});

describe("send_opportunity tool", () => {
  const opportunityId = "opp-123";

  test("when opportunity is latent and user is actor, promotes to pending and returns sent true", async () => {
    const latentOpportunity = {
      id: opportunityId,
      status: "latent" as const,
      actors: [
        { role: "party" as const, identityId: testUserId, intents: [], profile: true },
        { role: "party" as const, identityId: "other-user-id", intents: [], profile: true },
      ],
      detection: { source: "opportunity_graph" as const, timestamp: new Date().toISOString() },
      interpretation: { category: "collaboration", summary: "Match", confidence: 0.8 },
      context: { indexId: "idx-1" },
      indexId: "idx-1",
      confidence: "0.8",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const updateStatusSpy = mock(async () => null);
    const mockDb = createMockDatabase(async () => [], {
      getOpportunity: async () => latentOpportunity,
      updateOpportunityStatus: updateStatusSpy,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "send_opportunity") as { invoke: (args: { opportunityId: string }) => Promise<string> };
    const result = await tool.invoke({ opportunityId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.sent).toBe(true);
    expect(parsed.data.opportunityId).toBe(opportunityId);
    expect(parsed.data.notified).toContain("other-user-id");
    expect(updateStatusSpy).toHaveBeenCalledWith(opportunityId, "pending");
  });

  test("when opportunity not found, returns error", async () => {
    const mockDb = createMockDatabase(async () => [], {
      getOpportunity: async () => null,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "send_opportunity") as { invoke: (args: { opportunityId: string }) => Promise<string> };
    const result = await tool.invoke({ opportunityId: "non-existent" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Opportunity not found");
  });

  test("when opportunity status is not latent, returns error", async () => {
    const pendingOpportunity = {
      id: opportunityId,
      status: "pending" as const,
      actors: [
        { role: "party" as const, identityId: testUserId, intents: [], profile: true },
        { role: "party" as const, identityId: "other-user-id", intents: [], profile: true },
      ],
      detection: { source: "opportunity_graph" as const, timestamp: new Date().toISOString() },
      interpretation: { category: "collaboration", summary: "Match", confidence: 0.8 },
      context: { indexId: "idx-1" },
      indexId: "idx-1",
      confidence: "0.8",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const mockDb = createMockDatabase(async () => [], {
      getOpportunity: async () => pendingOpportunity,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "send_opportunity") as { invoke: (args: { opportunityId: string }) => Promise<string> };
    const result = await tool.invoke({ opportunityId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/already|draft|latent/i);
  });

  test("when user is not part of the opportunity, returns error", async () => {
    const opportunityWithoutUser = {
      id: opportunityId,
      status: "latent" as const,
      actors: [
        { role: "party" as const, identityId: "user-a", intents: [], profile: true },
        { role: "party" as const, identityId: "user-b", intents: [], profile: true },
      ],
      detection: { source: "opportunity_graph" as const, timestamp: new Date().toISOString() },
      interpretation: { category: "collaboration", summary: "Match", confidence: 0.8 },
      context: { indexId: "idx-1" },
      indexId: "idx-1",
      confidence: "0.8",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const mockDb = createMockDatabase(async () => [], {
      getOpportunity: async () => opportunityWithoutUser,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "send_opportunity") as { invoke: (args: { opportunityId: string }) => Promise<string> };
    const result = await tool.invoke({ opportunityId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("not part of this opportunity");
  });
});
