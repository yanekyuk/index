/**
 * Unit tests for opportunity discover: runDiscoverFromQuery with mocked opportunity graph.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect } from "bun:test";
import { runDiscoverFromQuery, selectStrategiesFromQuery } from "../opportunity.discover";
import type { ChatGraphCompositeDatabase } from "../../interfaces/database.interface";

describe("opportunity.discover", () => {
  describe("selectStrategiesFromQuery", () => {
    test("returns mirror and reciprocal for empty or generic query", () => {
      expect(selectStrategiesFromQuery("")).toEqual(["mirror", "reciprocal"]);
      expect(selectStrategiesFromQuery("   ")).toEqual(["mirror", "reciprocal"]);
      expect(selectStrategiesFromQuery("find someone")).toEqual([
        "mirror",
        "reciprocal",
      ]);
    });

    test('adds mentor for "find me a mentor" and guidance phrasing', () => {
      const strategies = selectStrategiesFromQuery("find me a mentor");
      expect(strategies).toContain("mirror");
      expect(strategies).toContain("reciprocal");
      expect(strategies).toContain("mentor");
    });

    test('adds mentor for "looking for guidance" and "learn from"', () => {
      expect(selectStrategiesFromQuery("I want to learn from an expert")).toContain("mentor");
      expect(selectStrategiesFromQuery("looking for guidance")).toContain("mentor");
    });

    test('adds hiree for "who needs a React developer" and hiring phrasing', () => {
      const strategies = selectStrategiesFromQuery("who needs a React developer");
      expect(strategies).toContain("hiree");
      expect(strategies).toContain("mirror");
      expect(strategies).toContain("reciprocal");
    });

    test('adds hiree for hiring/job/role phrases', () => {
      expect(selectStrategiesFromQuery("we are hiring a frontend engineer")).toContain("hiree");
      expect(selectStrategiesFromQuery("who is looking for a designer")).toContain("hiree");
      expect(selectStrategiesFromQuery("developer needed")).toContain("hiree");
    });

    test('adds investor for funding/raise phrases', () => {
      const strategies = selectStrategiesFromQuery("find investors for my startup");
      expect(strategies).toContain("investor");
      expect(selectStrategiesFromQuery("we need to raise seed")).toContain("investor");
    });

    test('adds collaborator for co-founder/partner phrases', () => {
      const strategies = selectStrategiesFromQuery("looking for a technical co-founder");
      expect(strategies).toContain("collaborator");
      expect(selectStrategiesFromQuery("find a partner to build together")).toContain(
        "collaborator"
      );
    });

    test("deduplicates strategies", () => {
      const strategies = selectStrategiesFromQuery(
        "find me a mentor and someone to learn from"
      );
      const mentorCount = strategies.filter((s) => s === "mentor").length;
      expect(mentorCount).toBe(1);
    });

    test("combines multiple strategy triggers", () => {
      const strategies = selectStrategiesFromQuery(
        "I need a mentor and want to raise funding"
      );
      expect(strategies).toContain("mentor");
      expect(strategies).toContain("investor");
      expect(strategies).toContain("mirror");
      expect(strategies).toContain("reciprocal");
    });
  });

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
  });
});
