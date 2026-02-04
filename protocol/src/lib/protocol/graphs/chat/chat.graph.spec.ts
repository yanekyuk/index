/**
 * Tests for ChatGraph (agent loop architecture).
 * Quick smoke tests for creation and invoke. Comprehensive Smartest scenarios
 * and streaming tests live in ./tests/ (chat.graph.factory.spec.ts,
 * chat.graph.invoke.spec.ts, chat.graph.streaming.spec.ts).
 */
import { config } from "dotenv";
config({ path: ".env.development", override: true });

import { describe, expect, it, beforeAll } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import { ChatGraphFactory } from "./chat.graph";
import type { ChatGraphCompositeDatabase, CreateIntentData } from "../../interfaces/database.interface";
import type { Embedder } from "../../interfaces/embedder.interface";
import type { Scraper } from "../../interfaces/scraper.interface";

const testUserId = "test-chat-graph-user";

/**
 * Mock database for ChatGraph. Implements ChatGraphCompositeDatabase with in-memory storage.
 */
function createMockDatabase(): ChatGraphCompositeDatabase {
  const noop = async () => undefined;
  const noopNull = async () => null;
  const noopArray = async () => [];
  const noopBool = async () => false;

  return {
    getProfile: noopNull,
    getActiveIntents: noopArray,
    getIntentsInIndexForMember: async () => [],
    getUser: noopNull,
    saveProfile: noop,
    saveHydeProfile: noop,
    createIntent: async (data: CreateIntentData) => ({
      id: `intent-${Date.now()}`,
      payload: data.payload,
      summary: null,
      isIncognito: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: data.userId,
    }),
    updateIntent: noopNull,
    archiveIntent: async () => ({ success: true }),
    getUserIndexIds: noopArray,
    getIndexMemberships: noopArray,
    getIndex: noopNull,
    getIntentForIndexing: noopNull,
    getIndexMemberContext: noopNull,
    getOpportunitiesForUser: noopArray,
    isIntentAssignedToIndex: noopBool,
    assignIntentToIndex: noop,
    unassignIntentFromIndex: noop,
    getOwnedIndexes: noopArray,
    isIndexOwner: noopBool,
    getIndexMembersForOwner: noopArray,
    getIndexMembersForMember: noopArray,
    getIndexIntentsForOwner: noopArray,
    getIndexIntentsForMember: noopArray,
    updateIndexSettings: async () =>
      ({
        id: "",
        title: "",
        prompt: null,
        permissions: {} as any,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        memberCount: 0,
        intentCount: 0,
      }) as any,
  } as unknown as ChatGraphCompositeDatabase;
}

/** Stub embedder for ChatGraph. */
const mockEmbedder: Embedder = {
  generate: async () => [],
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

/** Stub scraper - returns placeholder content for URL extraction (used by create_intent when URLs present). */
const mockScraper: Scraper = {
  scrape: async () => "",
  extractUrlContent: async () => "Repository: indexnetwork/index. Intent-driven discovery protocol.",
} as unknown as Scraper;

describe("ChatGraphFactory", () => {
  let factory: ChatGraphFactory;
  let mockDatabase: ChatGraphCompositeDatabase;

  beforeAll(() => {
    mockDatabase = createMockDatabase();
    factory = new ChatGraphFactory(mockDatabase, mockEmbedder, mockScraper);
  });

  describe("Graph Creation", () => {
    it("should create and compile a graph with createGraph", () => {
      const graph = factory.createGraph();
      expect(graph).toBeDefined();
      expect(typeof graph.invoke).toBe("function");
    });

    it("should create a streaming graph with createStreamingGraph without checkpointer", () => {
      const graph = factory.createStreamingGraph();
      expect(graph).toBeDefined();
      expect(typeof graph.invoke).toBe("function");
      expect(typeof graph.streamEvents).toBe("function");
    });

    it("should create a streaming graph with createStreamingGraph with MemorySaver checkpointer", async () => {
      const { MemorySaver } = await import("@langchain/langgraph");
      const checkpointer = new MemorySaver();
      const graph = factory.createStreamingGraph(checkpointer as any);
      expect(graph).toBeDefined();
      expect(typeof graph.streamEvents).toBe("function");
    });
  });

  describe("Graph Invocation", () => {
    it("should invoke graph with a simple message and return responseText", async () => {
      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: testUserId,
        messages: [new HumanMessage("Hello, how are you?")],
      });

      expect(result).toBeDefined();
      expect(result.responseText).toBeDefined();
      expect(typeof result.responseText).toBe("string");
      expect(result.responseText!.length).toBeGreaterThan(0);
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.shouldContinue).toBe(false);
    }, 120000);

    it("should not leak internal pipeline JSON in response", async () => {
      // Regression: streamEvents was emitting nested model output (classification, felicity_scores,
      // actions, indexScore) to the user. The invoke path uses agent.run() directly, so it was
      // never affected - but we verify the graph output is clean for consistency.
      const graph = factory.createGraph();
      const result = await graph.invoke({
        userId: testUserId,
        messages: [
          new HumanMessage(
            "I want to hire developers for an open-source intent-driven discovery protocol. More details at https://example.com/repo"
          ),
        ],
      });

      expect(result.responseText).toBeDefined();
      const response = result.responseText!;

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
        expect(response).not.toContain(marker);
      }
    }, 120000);
  });
});
