import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { assertMatchesSchema, assertLLMEvaluate } from "../assertions";

describe("assertMatchesSchema", () => {
  it("passes for valid data", () => {
    const schema = z.object({
      name: z.string(),
      score: z.number().min(0).max(100),
    });
    assertMatchesSchema({ name: "test", score: 50 }, schema);
  });

  it("throws with Zod error paths for invalid data", () => {
    const schema = z.object({
      name: z.string(),
      score: z.number(),
    });
    expect(() => assertMatchesSchema({ name: 123, score: "bad" }, schema)).toThrow();
  });
});

describe("assertLLMEvaluate", () => {
  it("passes when all criteria are met", async () => {
    const result = await assertLLMEvaluate(
      "Bob is a Laravel expert building backend APIs. Alice needs a Vue frontend developer. Their skills are complementary for a full-stack project.",
      {
        criteria: [
          { text: "mentions Laravel or backend expertise", required: true },
          { text: "mentions Vue or frontend need", required: true },
          { text: "explains complementarity" },
        ],
        minScore: 0.6,
        context: "Opportunity match reasoning between Alice and Bob",
      }
    );
    expect(result.passed).toBe(true);
    expect(result.criteria.length).toBe(3);
    expect(result.overallScore).toBeGreaterThan(0.5);
  }, 30_000);

  it("fails when a required criterion is not met", async () => {
    try {
      await assertLLMEvaluate(
        "Bob likes cooking Italian food.",
        {
          criteria: [
            { text: "mentions Laravel or backend expertise", required: true },
            { text: "mentions cooking", required: true },
          ],
          minScore: 0.5,
        }
      );
      throw new Error("Should have thrown");
    } catch (e: unknown) {
      const error = e as Error;
      expect(error.message).toContain("required criterion");
    }
  }, 30_000);
});
