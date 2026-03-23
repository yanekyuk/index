import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect } from "bun:test";
import { callJudge } from "../judge";

describe("callJudge", () => {
  it("scores criteria and returns structured results", async () => {
    const result = await callJudge({
      value: "Bob is an expert Laravel developer who builds backend APIs. Alice needs a frontend Vue developer.",
      criteria: [
        "mentions Laravel or backend expertise",
        "mentions Vue or frontend need",
        "explains complementarity between the two",
      ],
      context: "Evaluating an opportunity match reasoning between Alice (Vue dev) and Bob (Laravel dev)",
    });

    expect(result.scores).toHaveLength(3);
    for (const score of result.scores) {
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(1);
      expect(typeof score.reasoning).toBe("string");
      expect(typeof score.criterion).toBe("string");
    }
    // First two criteria should score high on this obvious input
    const laravelScore = result.scores.find(s => s.criterion.includes("Laravel"));
    expect(laravelScore?.score).toBeGreaterThan(0.5);
    const vueScore = result.scores.find(s => s.criterion.includes("Vue"));
    expect(vueScore?.score).toBeGreaterThan(0.5);
  }, 30_000);

  it("handles missing OPENROUTER_API_KEY gracefully", async () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      await expect(callJudge({
        value: "test",
        criteria: ["test criterion"],
      })).rejects.toThrow("OPENROUTER_API_KEY");
    } finally {
      process.env.OPENROUTER_API_KEY = originalKey;
    }
  });
});
