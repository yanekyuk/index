/**
 * Chat Graph: Smartest-driven invoke scenarios.
 * Tests graph invocation with schema and LLM verification for:
 * - Simple conversational message (response shape and semantics)
 * - No internal pipeline JSON leak in responseText
 * - Agent error path returns fallback message and error state
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

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
    softDeleteIndex: noop,
    deleteProfile: noop,
    updateOpportunityStatus: noopNull,
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
    }, 180000);
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
    }, 180000);
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

  describe("Confirmation flow", () => {
    test("when user requests a destructive action, response asks for confirmation or references confirm", async () => {
      const compiledGraph = factory.createGraph();

      const result = await runScenario(
        defineScenario({
          name: "chat-confirmation-flow",
          description:
            "User asks to delete an intent or perform an update; graph should respond by asking for confirmation or indicating the user must confirm before the action is applied.",
          fixtures: {
            userId: testUserId,
            message: "Delete my intent about hiring developers.",
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
              "The responseText must either ask the user to confirm the action, mention confirmation, or explain that the action will be applied after confirmation. It must not imply the destructive action was already performed without confirmation.",
            llmVerify: true,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as { responseText?: string };
      expect(output.responseText).toBeDefined();
      expect(typeof output.responseText).toBe("string");
    }, 180000);
  });

  describe("Tool choice", () => {
    test("when user asks for their intents, response is coherent and reflects list/query behavior", async () => {
      const compiledGraph = factory.createGraph();

      const result = await runScenario(
        defineScenario({
          name: "chat-tool-choice-intents",
          description:
            "User asks what intents they have or to list intents; graph should return a coherent response consistent with having queried intents (e.g. list or empty list).",
          fixtures: {
            userId: testUserId,
            message: "What intents do I have? List my intents.",
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
              "The responseText must be a natural-language reply about the user's intents (e.g. listing them, saying there are none, or summarizing). It must not contain raw JSON or internal tool payloads.",
            llmVerify: true,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as { responseText?: string };
      expect(output.responseText).toBeDefined();
      expect(typeof output.responseText).toBe("string");
    }, 180000);
  });

  describe("Clarification", () => {
    test("when user tries to create something without required info, response asks for missing details", async () => {
      const compiledGraph = factory.createGraph();

      const result = await runScenario(
        defineScenario({
          name: "chat-clarification-create",
          description:
            "User attempts to create an intent or resource without providing required details; graph should ask for the missing information rather than failing silently or returning a generic error.",
          fixtures: {
            userId: testUserId,
            message: "I want to create an intent.",
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
              "The responseText must ask the user for more details, such as what the intent is about, a description, or other required information. It must not be a generic error only; it should guide the user to provide the missing data.",
            llmVerify: true,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as { responseText?: string };
      expect(output.responseText).toBeDefined();
      expect(typeof output.responseText).toBe("string");
    }, 180000);
  });
});
