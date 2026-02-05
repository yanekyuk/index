/**
 * Unit tests for chat tools (createChatTools, get_intents_in_index, list_index_members, list_index_intents).
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll } from "bun:test";
import { createChatTools, type ToolContext } from "./chat.tools";
import type { ChatGraphCompositeDatabase } from "../../interfaces/database.interface";
import type { ActiveIntent, IndexMemberDetails, IndexedIntentDetails, OwnedIndex } from "../../interfaces/database.interface";
import type { Embedder } from "../../interfaces/embedder.interface";
import type { Scraper } from "../../interfaces/scraper.interface";

const testUserId = "test-user-id-for-tools";

type MockOverrides = Partial<Pick<
  ChatGraphCompositeDatabase,
  "getOwnedIndexes" | "isIndexOwner" | "getIndexMembersForOwner" | "getIndexMembersForMember" | "getIndexIntentsForOwner" | "getIndexMemberships" | "getIndexIntentsForMember"
>>;

/**
 * Minimal mock database. getIntentsInIndexForMemberImpl is required for get_intents_in_index.
 * Optional overrides for index tools (getIndexMemberships, getIndexIntentsForMember, getOwnedIndexes, isIndexOwner, etc.).
 */
function createMockDatabase(
  getIntentsInIndexForMemberImpl: (userId: string, indexNameOrId: string) => Promise<ActiveIntent[]>,
  overrides?: MockOverrides
): ChatGraphCompositeDatabase {
  const noop = async () => undefined;
  const noopNull = async () => null;
  const noopArray = async () => [];
  const noopBool = async () => false;
  const base = {
    getProfile: noopNull,
    getActiveIntents: noopArray,
    getIntentsInIndexForMember: getIntentsInIndexForMemberImpl,
    getUser: noopNull,
    saveProfile: noop,
    saveHydeProfile: noop,
    createIntent: async () => ({ id: "", payload: "", summary: null, isIncognito: false, createdAt: new Date(), updatedAt: new Date(), userId: "" }),
    updateIntent: noopNull,
    archiveIntent: async () => ({ success: true }),
    getUserIndexIds: noopArray,
    getIndexMemberships: noopArray,
    getIntentForIndexing: noopNull,
    getIndexMemberContext: noopNull,
    isIntentAssignedToIndex: noopBool,
    assignIntentToIndex: noop,
    unassignIntentFromIndex: noop,
    getOwnedIndexes: noopArray,
    isIndexOwner: noopBool,
    getIndexMembersForOwner: noopArray,
    getIndexMembersForMember: noopArray,
    getIndexIntentsForOwner: noopArray,
    getIndexIntentsForMember: noopArray,
    updateIndexSettings: async () => ({ id: "", title: "", prompt: null, permissions: {} as any, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, memberCount: 0, intentCount: 0 }),
    softDeleteIndex: noop,
    deleteProfile: noop,
    updateOpportunityStatus: noopNull,
  };
  return { ...base, ...overrides } as unknown as ChatGraphCompositeDatabase;
}

/** Stub embedder for tool creation (not invoked by get_intents_in_index). */
const mockEmbedder = {
  generate: async () => [] as number[],
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

/** Stub scraper for tool creation (not invoked by get_intents_in_index). */
const mockScraper = {
  scrape: async () => "",
  extractUrlContent: async (_url: string, _options?: { objective?: string }) => "",
} as unknown as Scraper;

describe("createChatTools", () => {
  test("returns an array that includes get_intents and get_intents_in_index", () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    expect(tools).toBeArray();
    expect(tools.find((t: { name: string }) => t.name === "get_intents")).toBeDefined();
    expect(tools.find((t: { name: string }) => t.name === "get_intents_in_index")).toBeDefined();
  });

  test("returns tools list_index_members and list_index_intents", () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    expect(tools.find((t: { name: string }) => t.name === "list_index_members")).toBeDefined();
    expect(tools.find((t: { name: string }) => t.name === "list_index_intents")).toBeDefined();
  });
});

describe("get_intents_in_index tool", () => {
  let getIntentsInIndexTool: { invoke: (args: { indexNameOrId: string }) => Promise<string> };

  beforeAll(() => {
    const mockIntents: ActiveIntent[] = [
      { id: "intent-1", payload: "Find ML collaborators", summary: "ML collab", createdAt: new Date("2025-01-01") },
      { id: "intent-2", payload: "Learn Rust", summary: "Rust", createdAt: new Date("2025-01-02") },
    ];
    const mockDb = createMockDatabase(async (userId, indexNameOrId) => {
      if (userId !== testUserId) return [];
      if (indexNameOrId === "Open Mock Network" || indexNameOrId === "open mock network") return mockIntents;
      return [];
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "get_intents_in_index");
    if (!tool || typeof (tool as { invoke?: (args: unknown) => Promise<unknown> }).invoke !== "function") {
      throw new Error("get_intents_in_index tool not found or missing invoke");
    }
    getIntentsInIndexTool = tool as { invoke: (args: { indexNameOrId: string }) => Promise<string> };
  });

  test("invoke returns success with intents and count when index has intents", async () => {
    const result = await getIntentsInIndexTool.invoke({ indexNameOrId: "Open Mock Network" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.intents).toBeArray();
    expect(parsed.data.intents.length).toBe(2);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.intents[0]).toMatchObject({ id: "intent-1", payload: "Find ML collaborators", summary: "ML collab" });
    expect(parsed.data.intents[1]).toMatchObject({ id: "intent-2", payload: "Learn Rust", summary: "Rust" });
    expect(new Date(parsed.data.intents[0].createdAt).getTime()).toBe(new Date("2025-01-01").getTime());
  });

  test("invoke returns success with empty intents when user has no intents in that index", async () => {
    const result = await getIntentsInIndexTool.invoke({ indexNameOrId: "Other Index" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.intents).toBeArray();
    expect(parsed.data.intents.length).toBe(0);
    expect(parsed.data.count).toBe(0);
  });

  test("invoke calls database.getIntentsInIndexForMember with userId and indexNameOrId", async () => {
    let capturedUserId: string | null = null;
    let capturedIndexNameOrId: string | null = null;
    const mockDb = createMockDatabase(async (userId, indexNameOrId) => {
      capturedUserId = userId;
      capturedIndexNameOrId = indexNameOrId;
      return [];
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "get_intents_in_index") as { invoke: (args: { indexNameOrId?: string }) => Promise<string> };
    await tool.invoke({ indexNameOrId: "My Community" });
    expect(capturedUserId === testUserId).toBe(true);
    expect(capturedIndexNameOrId === "My Community").toBe(true);
  });

  test("when context.indexId is set, omit indexNameOrId to use context index", async () => {
    let capturedIndex: string | null = null;
    const mockDb = createMockDatabase(async (_uid, indexNameOrId) => {
      capturedIndex = indexNameOrId;
      return [{ id: "i1", payload: "In index", summary: "X", createdAt: new Date() }];
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, indexId: "idx-context" };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "get_intents_in_index") as { invoke: (args: { indexNameOrId?: string }) => Promise<string> };
    const result = await tool.invoke({});
    expect(capturedIndex === "idx-context").toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
  });

  test("when context.indexId is not set and indexNameOrId omitted, returns error", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "get_intents_in_index") as { invoke: (args: { indexNameOrId?: string }) => Promise<string> };
    const result = await tool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Index required");
  });
});

describe("get_intents tool", () => {
  const globalIntents: ActiveIntent[] = [
    { id: "g1", payload: "Global intent A", summary: "A", createdAt: new Date("2025-01-01") },
    { id: "g2", payload: "Global intent B", summary: "B", createdAt: new Date("2025-01-02") },
  ];
  const indexScopedIntents: ActiveIntent[] = [
    { id: "i1", payload: "Intent in index only", summary: "Index", createdAt: new Date("2025-01-03") },
  ];

  test("without context.indexId and no indexNameOrId calls getActiveIntents and returns all intents", async () => {
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
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "get_intents") as { invoke: (args: { indexNameOrId?: string }) => Promise<string> };
    const result = await tool.invoke({});
    expect(getActiveIntentsCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.intents).toHaveLength(2);
    expect(parsed.data.intents[0]).toMatchObject({ id: "g1", description: "Global intent A" });
  });

  test("with context.indexId and no indexNameOrId calls getIntentsInIndexForMember and returns index-scoped intents", async () => {
    const indexId = "idx-open-mock";
    let getIntentsInIndexForMemberCalled = false;
    const mockDb = createMockDatabase(async (uid, indexNameOrId) => {
      getIntentsInIndexForMemberCalled = true;
      expect(uid).toBe(testUserId);
      expect(indexNameOrId).toBe(indexId);
      return indexScopedIntents;
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, indexId };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "get_intents") as { invoke: (args: { indexNameOrId?: string }) => Promise<string> };
    const result = await tool.invoke({});
    expect(getIntentsInIndexForMemberCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
    expect(parsed.data.intents[0]).toMatchObject({ id: "i1", description: "Intent in index only" });
  });
});

describe("get_active_intents tool (deprecated alias)", () => {
  const globalIntents: ActiveIntent[] = [
    { id: "g1", payload: "Global intent A", summary: "A", createdAt: new Date("2025-01-01") },
    { id: "g2", payload: "Global intent B", summary: "B", createdAt: new Date("2025-01-02") },
  ];
  const indexScopedIntents: ActiveIntent[] = [
    { id: "i1", payload: "Intent in index only", summary: "Index", createdAt: new Date("2025-01-03") },
  ];

  test("without context.indexId calls getActiveIntents and returns all intents", async () => {
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
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "get_active_intents") as { invoke: (args: Record<string, never>) => Promise<string> };
    const result = await tool.invoke({});
    expect(getActiveIntentsCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.intents).toHaveLength(2);
    expect(parsed.data.intents[0]).toMatchObject({ id: "g1", description: "Global intent A" });
  });

  test("with context.indexId calls getIntentsInIndexForMember and returns index-scoped intents", async () => {
    const indexId = "idx-open-mock";
    let getIntentsInIndexForMemberCalled = false;
    const mockDb = createMockDatabase(async (uid, indexNameOrId) => {
      getIntentsInIndexForMemberCalled = true;
      expect(uid).toBe(testUserId);
      expect(indexNameOrId).toBe(indexId);
      return indexScopedIntents;
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, indexId };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "get_active_intents") as { invoke: (args: Record<string, never>) => Promise<string> };
    const result = await tool.invoke({});
    expect(getIntentsInIndexForMemberCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
    expect(parsed.data.intents[0]).toMatchObject({ id: "i1", description: "Intent in index only" });
  });
});

describe("list_index_members tool", () => {
  const memberIndexId = "a1b2c3d4-0000-4000-8000-000000000001";
  const mockMembers: IndexMemberDetails[] = [
    { userId: "u1", name: "Alice", avatar: null, email: "alice@example.com", permissions: ["member"], memberPrompt: null, autoAssign: true, joinedAt: new Date("2025-01-01"), intentCount: 2 },
    { userId: "u2", name: "Bob", avatar: null, email: "bob@example.com", permissions: ["member"], memberPrompt: null, autoAssign: false, joinedAt: new Date("2025-01-02"), intentCount: 1 },
  ];

  test("invoke returns success with members when member and index found by ID", async () => {
    const mockDb = createMockDatabase(async () => [], {
      getIndexMemberships: async (uid) =>
        uid === testUserId ? [{ indexId: memberIndexId, indexTitle: "Test Index", indexPrompt: null, permissions: [], memberPrompt: null, autoAssign: true, joinedAt: new Date() }] : [],
      getIndexMembersForMember: async (indexId, uid) => {
        if (indexId === memberIndexId && uid === testUserId) return mockMembers;
        throw new Error("Access denied: Not a member of this index");
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "list_index_members") as { invoke: (args: { indexNameOrId: string }) => Promise<string> };
    const result = await tool.invoke({ indexNameOrId: memberIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.indexId).toBe(memberIndexId);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.members).toBeArray();
    expect(parsed.data.members[0]).toMatchObject({ name: "Alice", intentCount: 2 });
    expect(parsed.data.members[1]).toMatchObject({ name: "Bob", intentCount: 1 });
  });

  test("invoke returns success with members when index resolved by name", async () => {
    const mockMemberships = [{ indexId: memberIndexId, indexTitle: "AI Founders", indexPrompt: null, permissions: [], memberPrompt: null, autoAssign: true, joinedAt: new Date() }];
    const mockDb = createMockDatabase(async () => [], {
      getIndexMemberships: async (uid) => (uid === testUserId ? mockMemberships : []),
      getIndexMembersForMember: async () => mockMembers,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "list_index_members") as { invoke: (args: { indexNameOrId: string }) => Promise<string> };
    const result = await tool.invoke({ indexNameOrId: "AI Founders" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.indexId).toBe(memberIndexId);
    expect(parsed.data.count).toBe(2);
  });

  test("invoke returns error when not member", async () => {
    const mockDb = createMockDatabase(async () => [], {
      getIndexMemberships: async () => [],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "list_index_members") as { invoke: (args: { indexNameOrId: string }) => Promise<string> };
    const result = await tool.invoke({ indexNameOrId: memberIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain("not a member");
  });
});

describe("list_index_intents tool", () => {
  const memberIndexId = "a1b2c3d4-0000-4000-8000-000000000002";
  const mockIntents: IndexedIntentDetails[] = [
    { id: "i1", payload: "Find ML collaborators", summary: "ML", userId: "u1", userName: "Alice", createdAt: new Date("2025-01-01") },
    { id: "i2", payload: "Learn Rust", summary: "Rust", userId: "u2", userName: "Bob", createdAt: new Date("2025-01-02") },
  ];

  test("invoke returns success with intents when member", async () => {
    const mockDb = createMockDatabase(async () => [], {
      getIndexMemberships: async (uid) =>
        uid === testUserId ? [{ indexId: memberIndexId, indexTitle: "Test Index", indexPrompt: null, permissions: [], memberPrompt: null, autoAssign: true, joinedAt: new Date() }] : [],
      getIndexIntentsForMember: async (indexId, uid) => {
        if (indexId === memberIndexId && uid === testUserId) return mockIntents;
        throw new Error("Access denied: Not a member of this index");
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "list_index_intents") as { invoke: (args: { indexNameOrId: string }) => Promise<string> };
    const result = await tool.invoke({ indexNameOrId: memberIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.indexId).toBe(memberIndexId);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.intents[0]).toMatchObject({ payload: "Find ML collaborators", summary: "ML", userName: "Alice" });
    expect(parsed.data.intents[1]).toMatchObject({ payload: "Learn Rust", summary: "Rust", userName: "Bob" });
  });

  test("invoke returns error when not member", async () => {
    const mockDb = createMockDatabase(async () => [], {
      getIndexMemberships: async () => [],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "list_index_intents") as { invoke: (args: { indexNameOrId: string }) => Promise<string> };
    const result = await tool.invoke({ indexNameOrId: memberIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain("not a member");
  });

  test("invoke passes limit and offset to getIndexIntentsForMember", async () => {
    let capturedOptions: { limit?: number; offset?: number } | undefined;
    const mockDb = createMockDatabase(async () => [], {
      getIndexMemberships: async (uid) =>
        uid === testUserId ? [{ indexId: memberIndexId, indexTitle: "Test Index", indexPrompt: null, permissions: [], memberPrompt: null, autoAssign: true, joinedAt: new Date() }] : [],
      getIndexIntentsForMember: async (_indexId, _uid, options) => {
        capturedOptions = options;
        return [];
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "list_index_intents") as { invoke: (args: { indexNameOrId: string; limit?: number; offset?: number }) => Promise<string> };
    await tool.invoke({ indexNameOrId: memberIndexId, limit: 10, offset: 5 });
    expect(capturedOptions).toBeDefined();
    expect(capturedOptions?.limit).toBe(10);
    expect(capturedOptions?.offset).toBe(5);
  });
});

describe("create_intent tool (Phase 2 index scope)", () => {
  test("create_intent tool schema includes optional indexId", () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    const createIntentTool = tools.find((t: { name: string }) => t.name === "create_intent");
    expect(createIntentTool).toBeDefined();
    const schema = (createIntentTool as { schema?: { shape?: Record<string, unknown> } }).schema;
    expect(schema?.shape?.indexId ?? (createIntentTool as { schema?: { schema?: { shape?: Record<string, unknown> } } }).schema?.schema?.shape?.indexId).toBeDefined();
  });
});

describe("scrape_url tool", () => {
  test("returns a tool named scrape_url", () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
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
    const tools = createChatTools(context);
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
    const tools = createChatTools(context);
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
    const tools = createChatTools(context);
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
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "scrape_url") as { invoke: (args: { url: string }) => Promise<string> };
    const result = await tool.invoke({ url: "not-a-valid-url" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain("Invalid URL");
  });
});

describe("get_index_memberships (Phase 3 index-scoped)", () => {
  const scopedIndexId = "a1b2c3d4-0000-4000-8000-000000000010";

  test("when context.indexId is set and showAll not true, returns only current index membership with scopeNote", async () => {
    const oneMembership = [{ indexId: scopedIndexId, indexTitle: "Current Index", indexPrompt: null, permissions: [], memberPrompt: null, autoAssign: true, joinedAt: new Date() }];
    const mockDb = createMockDatabase(async () => [], {
      getIndexMemberships: async (uid) => (uid === testUserId ? oneMembership : []),
      getOwnedIndexes: async () => [],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, indexId: scopedIndexId };
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "get_index_memberships") as { invoke: (args: { showAll?: boolean }) => Promise<string> };
    const result = await tool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.memberOf).toHaveLength(1);
    expect(parsed.data.memberOf[0].indexId).toBe(scopedIndexId);
    expect(parsed.data.summary.scopeNote).toContain("Showing membership for current index");
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
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "get_index_memberships") as { invoke: (args: { showAll?: boolean }) => Promise<string> };
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
    const tools = createChatTools(context);
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
    const tools = createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "delete_intent") as { invoke: (args: { intentId: string }) => Promise<string> };
    const result = await tool.invoke({ intentId: intentNotInIndex });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("not in the current index");
  });
});
