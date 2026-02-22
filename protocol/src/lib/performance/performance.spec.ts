import { beforeEach, describe, expect, it } from "bun:test";
import { getStats, recordTiming, resetStats } from "./performance.aggregator";
import { timed } from "./performance.wrapper";

describe("performance aggregator", () => {
  beforeEach(() => {
    resetStats();
  });

  it("returns empty stats when nothing recorded", () => {
    const stats = getStats();
    expect(Object.keys(stats).length).toBe(0);
  });

  it("records durations and returns count and percentiles", () => {
    recordTiming("foo", 100);
    recordTiming("foo", 200);
    recordTiming("foo", 300);
    recordTiming("bar", 50);

    const stats = getStats();

    expect(stats.foo.count).toBe(3);
    expect(stats.foo.p50).toBe(200);
    expect(stats.foo.p95).toBeGreaterThanOrEqual(200);
    expect(stats.bar.count).toBe(1);
    expect(stats.bar.p50).toBe(50);
  });

  it("evicts oldest samples when exceeding max", () => {
    for (let i = 0; i < 510; i++) {
      recordTiming("capped", i);
    }
    const stats = getStats();
    expect(stats.capped.count).toBe(500);
  });

  it("resetStats clears all data", () => {
    recordTiming("foo", 100);
    resetStats();
    const stats = getStats();
    expect(Object.keys(stats).length).toBe(0);
  });
});

describe("timed wrapper", () => {
  beforeEach(() => {
    resetStats();
  });

  it("records duration and returns result", async () => {
    const result = await timed("test.op", async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 42;
    });

    expect(result).toBe(42);
    const stats = getStats();
    expect(stats["test.op"].count).toBe(1);
    expect(stats["test.op"].p50).toBeGreaterThanOrEqual(40);
  });

  it("records duration and rethrows on error", async () => {
    const err = new Error("boom");
    try {
      await timed("test.fail", async () => {
        throw err;
      });
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBe(err);
    }
    const stats = getStats();
    expect(stats["test.fail"].count).toBe(1);
  });
});
