/**
 * Chat discovery: Smartest E2E tests for Step 11 (Chat Integration).
 *
 * Verifies discovery via chat interface:
 * - Chat query "find me a mentor" → coherent response (mentor/discovery or join index)
 * - Query "who needs a React developer" → coherent response (matches/opportunities or join index)
 * - Results formatted appropriately for chat (no raw JSON; table or list when listing people)
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll } from "bun:test";
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
import { runScenario, defineScenario, expectSmartest } from "../../../../smartest";
import { ChatGraphFactory } from "../chat.graph";
import type {
  ChatGraphCompositeDatabase,
  CreateIntentData,
} from "../../../interfaces/database.interface";
import type { Embedder } from "../../../interfaces/embedder.interface";
import type { Scraper } from "../../../interfaces/scraper.interface";

const testUserId = "test-chat-discover-user";

const chatGraphOutputSchema = z.object({
  messages: z.array(z.unknown()),
  responseText: z.string().optional(),
  iterationCount: z.number().optional(),
  shouldContinue: z.boolean().optional(),
  error: z.string().optional(),
});

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

describe("Chat discovery (Step 11 – Smartest E2E)", () => {
  let factory: ChatGraphFactory;
  let mockDatabase: ChatGraphCompositeDatabase;

  beforeAll(() => {
    mockDatabase = createMockDatabase();
    factory = new ChatGraphFactory(mockDatabase, mockEmbedder, mockScraper);
  });

  describe("Discovery query: find me a mentor", () => {
    test("chat returns coherent response and matching profiles or join-index guidance", async () => {
      const compiledGraph = factory.createGraph();

      const result = await runScenario(
        defineScenario({
          name: "discover-mentor",
          description:
            "User asks to find a mentor; response must be coherent, mention discovery/mentors or suggest joining a community; no raw JSON.",
          fixtures: {
            userId: testUserId,
            message: "find me a mentor",
          },
          sut: {
            type: "graph",
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as { userId: string; message: string };
              return await (
                instance as ReturnType<ChatGraphFactory["createGraph"]>
              ).invoke({
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
              "The responseText must be a coherent, helpful reply to a request to find a mentor. " +
              "It may suggest joining a community/index, mention mentors or discovery, or explain that no matches were found. " +
              "It must NOT contain raw JSON, internal pipeline fields (classification, indexScore, actions), or structured data dumps. " +
              "If it lists people or opportunities, they must be in natural language (e.g. table or list), not JSON.",
            llmVerify: true,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as {
        responseText?: string;
        shouldContinue?: boolean;
      };
      expect(output.responseText).toBeDefined();
      expect(typeof output.responseText).toBe("string");
      expect(output.responseText!.length).toBeGreaterThan(0);
      expect(output.shouldContinue).toBe(false);
    }, 180000);
  });

  describe("Discovery query: who needs a React developer", () => {
    test("chat returns coherent response and matching intents or guidance", async () => {
      const compiledGraph = factory.createGraph();

      const result = await runScenario(
        defineScenario({
          name: "discover-react-developer",
          description:
            "User asks who needs a React developer; response must be coherent, mention opportunities/matches or suggest joining a community; no raw JSON.",
          fixtures: {
            userId: testUserId,
            message: "who needs a React developer?",
          },
          sut: {
            type: "graph",
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as { userId: string; message: string };
              return await (
                instance as ReturnType<ChatGraphFactory["createGraph"]>
              ).invoke({
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
              "The responseText must be a coherent, helpful reply to a request about who needs a React developer. " +
              "It may suggest joining a community, mention opportunities or intents, or explain that no matches were found. " +
              "It must NOT contain raw JSON or internal pipeline data. " +
              "If it lists intents or opportunities, they must be in natural language (e.g. table or list), not JSON.",
            llmVerify: true,
          },
        })
      );

      expectSmartest(result);
      const output = result.output as {
        responseText?: string;
        shouldContinue?: boolean;
      };
      expect(output.responseText).toBeDefined();
      expect(output.responseText).not.toContain("classification");
      expect(output.responseText).not.toContain("indexScore");
      expect(output.responseText).not.toContain('"opportunities"');
    }, 180000);
  });

  describe("Discovery results formatting", () => {
    test("response suitable for chat: no raw JSON, human-readable only", async () => {
      const compiledGraph = factory.createGraph();

      const result = await runScenario(
        defineScenario({
          name: "discover-formatting",
          description:
            "Discovery-style query; response must be formatted for chat: natural language only, no raw JSON; any list/table must be human-readable.",
          fixtures: {
            userId: testUserId,
            message: "show me people I could connect with",
          },
          sut: {
            type: "graph",
            factory: () => compiledGraph,
            invoke: async (instance: unknown, resolvedInput: unknown) => {
              const input = resolvedInput as { userId: string; message: string };
              return await (
                instance as ReturnType<ChatGraphFactory["createGraph"]>
              ).invoke({
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
              "The responseText must be appropriate for a chat UI: natural language only, no raw JSON objects. " +
              "If the response includes discovery results (people, opportunities, or intents), they must be presented as a Markdown table or bullet list, not as a JSON blob. " +
              "No internal fields like opportunityId, userId as raw IDs in user-facing text, classification, or felicity_scores.",
            llmVerify: true,
          },
        })
      );

      expectSmartest(result);
      const response = (result.output as { responseText?: string }).responseText ?? "";
      expect(response).not.toMatch(/\{\s*"[^"]+"\s*:/);
      expect(response).not.toContain("felicity_scores");
      expect(response).not.toContain("referentialAnchor");
    }, 180000);
  });
});
