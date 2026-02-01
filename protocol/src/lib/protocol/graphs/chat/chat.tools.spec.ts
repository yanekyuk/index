/**
 * Unit tests for chat tools (createChatTools, get_intents_in_index).
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { createChatTools, type ToolContext } from "./chat.tools";
import type { ChatGraphCompositeDatabase } from "../../interfaces/database.interface";
import type { ActiveIntent } from "../../interfaces/database.interface";
import type { Embedder } from "../../interfaces/embedder.interface";
import type { Scraper } from "../../interfaces/scraper.interface";

const testUserId = "test-user-id-for-tools";

/**
 * Minimal mock database that implements only getIntentsInIndexForMember for get_intents_in_index tests.
 * Other methods are stubbed so createChatTools can build subgraphs (they are not invoked when we only call get_intents_in_index).
 */
function createMockDatabase(getIntentsInIndexForMemberImpl: (userId: string, indexNameOrId: string) => Promise<ActiveIntent[]>): ChatGraphCompositeDatabase {
  const noop = async () => undefined;
  const noopNull = async () => null;
  const noopArray = async () => [];
  const noopBool = async () => false;
  return {
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
    getIndexIntentsForOwner: noopArray,
    updateIndexSettings: async () => ({ id: "", title: "", prompt: null, permissions: {} as any, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, memberCount: 0, intentCount: 0 }),
  } as unknown as ChatGraphCompositeDatabase;
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
} as unknown as Scraper;

describe("createChatTools", () => {
  test("returns an array that includes a tool named get_intents_in_index", () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper };
    const tools = createChatTools(context);
    expect(tools).toBeArray();
    const getIntentsInIndexTool = tools.find((t: { name: string }) => t.name === "get_intents_in_index");
    expect(getIntentsInIndexTool).toBeDefined();
    expect(getIntentsInIndexTool!.name).toBe("get_intents_in_index");
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
    const tool = tools.find((t: { name: string }) => t.name === "get_intents_in_index") as { invoke: (args: { indexNameOrId: string }) => Promise<string> };
    await tool.invoke({ indexNameOrId: "My Community" });
    expect(capturedUserId).toBe(testUserId);
    expect(capturedIndexNameOrId).toBe("My Community");
  });
});
