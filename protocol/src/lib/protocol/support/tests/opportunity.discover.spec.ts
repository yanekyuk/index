/**
 * Unit tests for opportunity discover: runDiscoverFromQuery with mocked opportunity graph.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect } from "bun:test";
import { runDiscoverFromQuery } from "../opportunity.discover";
import type { ChatGraphCompositeDatabase } from "../../interfaces/database.interface";

describe("opportunity.discover", () => {
  const mockDatabase: ChatGraphCompositeDatabase = {
    getProfile: async () => null,
    getUser: async () => null,
  } as unknown as ChatGraphCompositeDatabase;

  describe("runDiscoverFromQuery", () => {
    test("returns message when query is empty", async () => {
      const mockGraph = {
        invoke: async () => ({ opportunities: [] }),
      };
      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "   ",
        indexScope: ["idx1"],
      });
      expect(result.found).toBe(false);
      expect(result.count).toBe(0);
      expect(result.message).toBeDefined();
    });

    test("returns message when indexScope is empty", async () => {
      const mockGraph = {
        invoke: async () => ({ opportunities: [] }),
      };
      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find me a mentor",
        indexScope: [],
      });
      expect(result.found).toBe(false);
      expect(result.count).toBe(0);
      expect(result.message).toContain("index");
    });

    test("returns found: false when graph returns no opportunities", async () => {
      const mockGraph = {
        invoke: async () => ({ opportunities: [] }),
      };
      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find me a mentor",
        indexScope: ["idx1"],
      });
      expect(result.found).toBe(false);
      expect(result.count).toBe(0);
      expect(result.message).toContain("No matching");
    });

    test("returns enriched opportunities when graph returns matches", async () => {
      const candidateId = "candidate-1";
      const mockGraph = {
        invoke: async () => ({
          opportunities: [
            {
              id: "opp-1",
              actors: [
                { indexId: "idx-1", userId: "u1", role: "patient" },
                { indexId: "idx-1", userId: candidateId, role: "agent" },
              ],
              interpretation: {
                reasoning: "Strong match for mentorship.",
                confidence: 0.85,
              },
            },
          ],
        }),
      };
      const dbWithProfile = {
        ...mockDatabase,
        getProfile: async (userId: string) =>
          userId === candidateId
            ? {
                identity: { name: "Jane Mentor", bio: "Experienced advisor." },
                attributes: {},
                narrative: {},
              }
            : null,
      } as unknown as ChatGraphCompositeDatabase;

      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: dbWithProfile,
        userId: "u1",
        query: "find me a mentor",
        indexScope: ["idx1"],
        limit: 5,
      });

      expect(result.found).toBe(true);
      expect(result.count).toBe(1);
      expect(result.opportunities).toHaveLength(1);
      expect(result.opportunities![0]).toMatchObject({
        opportunityId: "opp-1",
        userId: candidateId,
        name: "Jane Mentor",
        bio: "Experienced advisor.",
        matchReason: "Strong match for mentorship.",
        score: 0.85,
      });
    });

    test("on graph throw, returns found: false with generic message", async () => {
      const mockGraph = {
        invoke: async () => {
          throw new Error("Network error");
        },
      };
      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find me a mentor",
        indexScope: ["idx1"],
      });
      expect(result.found).toBe(false);
      expect(result.count).toBe(0);
      expect(result.message).toContain("Failed");
    });

    test("invokes opportunity graph with options.initialStatus: 'latent'", async () => {
      let capturedInvokeArg: Record<string, unknown> = {};
      const mockGraph = {
        invoke: async (arg: Record<string, unknown>) => {
          capturedInvokeArg = arg;
          return { opportunities: [] };
        },
      };
      await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find me a mentor",
        indexScope: ["idx1"],
      });
      expect(capturedInvokeArg.options).toBeDefined();
      expect((capturedInvokeArg.options as { initialStatus?: string }).initialStatus).toBe("latent");
    });

    test("invokes opportunity graph with initialStatus 'draft' and conversationId when chatSessionId provided", async () => {
      let capturedInvokeArg: Record<string, unknown> = {};
      const mockGraph = {
        invoke: async (arg: Record<string, unknown>) => {
          capturedInvokeArg = arg;
          return { opportunities: [] };
        },
      };
      await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find a co-founder",
        indexScope: ["idx1"],
        chatSessionId: "session-abc",
      });
      expect(capturedInvokeArg.options).toBeDefined();
      const options = capturedInvokeArg.options as { initialStatus?: string; conversationId?: string };
      expect(options.initialStatus).toBe("draft");
      expect(options.conversationId).toBe("session-abc");
    });

    test("passes triggerIntentId to graph when provided", async () => {
      let capturedInvokeArg: Record<string, unknown> = {};
      const mockGraph = {
        invoke: async (arg: Record<string, unknown>) => {
          capturedInvokeArg = arg;
          return { opportunities: [] };
        },
      };
      await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find a co-founder",
        indexScope: ["idx1"],
        triggerIntentId: "intent-123",
      });
      expect(capturedInvokeArg.triggerIntentId).toBe("intent-123");
    });

    test("falls back to user record name when profile has no identity.name", async () => {
      const candidateId = "candidate-no-profile-name";
      const mockGraph = {
        invoke: async () => ({
          opportunities: [
            {
              id: "opp-fallback",
              actors: [
                { indexId: "idx-1", userId: "u1", role: "patient" },
                { indexId: "idx-1", userId: candidateId, role: "agent" },
              ],
              interpretation: {
                reasoning: "Yuki Tanaka is a visual artist looking for clients.",
                confidence: 0.8,
              },
              detection: { source: "opportunity_graph", createdBy: "agent", timestamp: new Date().toISOString() },
              status: "latent",
            },
          ],
        }),
      };
      // Profile exists but has NO identity.name; user record has name
      const dbWithUserFallback = {
        ...mockDatabase,
        getProfile: async (userId: string) =>
          userId === candidateId
            ? { identity: { bio: "Visual artist and illustrator." }, attributes: {}, narrative: {} }
            : null,
        getUser: async (userId: string) =>
          userId === candidateId
            ? { name: "Yuki Tanaka", avatar: "https://example.com/yuki.jpg" }
            : null,
      } as unknown as ChatGraphCompositeDatabase;

      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: dbWithUserFallback,
        userId: "u1",
        query: "find designers",
        indexScope: ["idx1"],
        minimalForChat: true,
      });

      expect(result.found).toBe(true);
      expect(result.opportunities).toHaveLength(1);
      // Should use the user record name, not undefined/"Someone"
      expect(result.opportunities![0].name).toBe("Yuki Tanaka");
    });

    test("returns createIntentSuggested and suggestedIntentDescription when graph returns create-intent signal", async () => {
      const mockGraph = {
        invoke: async () => ({
          opportunities: [],
          createIntentSuggested: true,
          suggestedIntentDescription: "Looking for a technical co-founder",
        }),
      };
      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find a co-founder",
        indexScope: ["idx1"],
      });
      expect(result.found).toBe(false);
      expect(result.createIntentSuggested).toBe(true);
      expect(result.suggestedIntentDescription).toBe("Looking for a technical co-founder");
      expect(result.message).toBeDefined();
    });
  });
});
