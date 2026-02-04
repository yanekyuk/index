/**
 * Chat Graph: Smartest-driven invoke scenarios.
 * Tests graph invocation with schema and LLM verification for:
 * - Simple conversational message (response shape and semantics)
 * - No internal pipeline JSON leak in responseText
 * - Agent error path returns fallback message and error state
 */
import { config } from "dotenv";
config({ path: ".env.development", override: true });

import { describe, test, expect, spyOn, beforeAll } from "bun:test";
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
import { runScenario, defineScenario, expectSmartest } from "../../../../smartest";
import { ChatGraphFactory } from "../chat.graph";
import type { ChatGraphCompositeDatabase, CreateIntentData } from "../../../interfaces/database.interface";
import type { Embedder } from "../../../interfaces/embedder.interface";
import type { Scraper } from "../../../interfaces/scraper.interface";
import { ChatAgent } from "../chat.agent";

const testUserId = "test-chat-invoke-user";

// ─── Output schema for graph invoke ───────────────────────────────────────

const chatGraphOutputSchema = z.object({
  messages: z.array(z.unknown()),
  responseText: z.string().optional(),
  iterationCount: z.number().optional(),
  shouldContinue: z.boolean().optional(),
  error: z.string().optional(),
});

// ─── Mock dependencies (shared) ──────────────────────────────────────────────

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

const mockEmbedder: Embedder = {
  generate: async () => [],
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

const mockScraper: Scraper = {
  scrape: async () => "",
  extractUrlContent: async () => "",
} as unknown as Scraper;

describe("Chat Graph invoke (Smartest)", () => {
  let factory: ChatGraphFactory;
  let mockDatabase: ChatGraphCompositeDatabase;

  beforeAll(() => {
    mockDatabase = createMockDatabase();
    factory = new ChatGraphFactory(mockDatabase, mockEmbedder, mockScraper);
  });

  describe("Simple conversational message", () => {
    test("given a simple greeting, graph returns valid output shape and coherent response", async () => {
      const compiledGraph = factory.createGraph();

      const result = await runScenario(
        defineScenario({
          name: "chat-simple-greeting",
          description: "User sends a simple greeting; graph returns responseText and messages with valid shape.",
          fixtures: {
            userId: testUserId,
            message: "Hello, how are you?",
          },
          sut: {
            type: "graph",
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as { userId: string; message: string };
              return await (instance as ReturnType<ChatGraphFactory["createGraph"]>).invoke({
                userId: input.userId,
                messages: [new HumanMessage(input.message)],
              });
            },
            input: {
              userId: "@fixtures.userId",
              message: "@fixtures.message",
            },
          },
          verification: {
            schema: chatGraphOutputSchema,
            criteria:
              "The responseText must be a friendly, coherent reply to the greeting. It must not contain raw JSON, classification fields, or internal pipeline data.",
            llmVerify: true,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as { responseText?: string; messages?: unknown[]; shouldContinue?: boolean };
      expect(output.responseText).toBeDefined();
      expect(typeof output.responseText).toBe("string");
      expect(output.responseText!.length).toBeGreaterThan(0);
      expect(output.shouldContinue).toBe(false);
    }, 130000);
  });

  describe("No internal JSON leak", () => {
    test("response must not contain internal pipeline JSON markers", async () => {
      const compiledGraph = factory.createGraph();

      const result = await runScenario(
        defineScenario({
          name: "chat-no-internal-json",
          description:
            "User message that could trigger intent/subgraph path; response must not leak classification, felicity_scores, actions, indexScore, etc.",
          fixtures: {
            userId: testUserId,
            message:
              "I want to hire developers for an open-source intent-driven discovery protocol. More details at https://example.com/repo",
          },
          sut: {
            type: "graph",
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as { userId: string; message: string };
              return await (instance as ReturnType<ChatGraphFactory["createGraph"]>).invoke({
                userId: input.userId,
                messages: [new HumanMessage(input.message)],
              });
            },
            input: {
              userId: "@fixtures.userId",
              message: "@fixtures.message",
            },
          },
          verification: {
            schema: chatGraphOutputSchema,
            criteria:
              "responseText must NOT contain any of: classification, felicity_scores, actions, indexScore, memberScore, semantic_entropy, referential_anchor, intentMode, referentialAnchor. It should be natural language only.",
            llmVerify: true,
          },
        })
      );

      expectSmartest(result);
      const response = (result.output as { responseText?: string }).responseText ?? "";
      const internalMarkers = [
        "classification",
        "felicity_scores",
        "actions",
        "indexScore",
        "memberScore",
        "semantic_entropy",
        "referential_anchor",
        "intentMode",
        "referentialAnchor",
      ];
      for (const marker of internalMarkers) {
        expect(response).not.toContain(marker);
      }
    }, 130000);
  });

  describe("Error path", () => {
    test("when agent loop throws, graph returns fallback responseText and error in state", async () => {
      const runSpy = spyOn(ChatAgent.prototype, "run").mockRejectedValue(new Error("Agent run failed"));

      const compiledGraph = factory.createGraph();
      const result = await runScenario(
        defineScenario({
          name: "chat-agent-error-fallback",
          description: "When the agent loop fails (agent.run throws), graph returns error and fallback responseText.",
          fixtures: {
            userId: testUserId,
            message: "Hello",
          },
          sut: {
            type: "graph",
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as { userId: string; message: string };
              return await (instance as ReturnType<ChatGraphFactory["createGraph"]>).invoke({
                userId: input.userId,
                messages: [new HumanMessage(input.message)],
              });
            },
            input: {
              userId: "@fixtures.userId",
              message: "@fixtures.message",
            },
          },
          verification: {
            schema: chatGraphOutputSchema,
            criteria:
              "Output must contain an error string and responseText must be a polite fallback message. shouldContinue must be false.",
            llmVerify: false,
          },
        })
      );

      runSpy.mockRestore();

      expectSmartest(result);
      const output = result.output as { error?: string; responseText?: string; shouldContinue?: boolean };
      expect(output.error).toBeDefined();
      expect(output.responseText).toBeDefined();
      expect(typeof output.responseText).toBe("string");
      expect(output.responseText!.length).toBeGreaterThan(0);
      expect(output.shouldContinue).toBe(false);
    }, 10000);
  });
});
