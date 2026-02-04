/**
 * Unit tests for discover node: runDiscoverFromQuery with mocked opportunity graph.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect } from "bun:test";
import { runDiscoverFromQuery } from "./discover.nodes";
import type { ChatGraphCompositeDatabase } from "../../../interfaces/database.interface";

describe("discover.nodes", () => {
  const mockDatabase: ChatGraphCompositeDatabase = {
    getProfile: async () => null,
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
                { role: "patient", identityId: "u1", intents: [], profile: false },
                { role: "agent", identityId: candidateId, intents: [], profile: true },
              ],
              interpretation: {
                summary: "Strong match for mentorship.",
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
  });
});
