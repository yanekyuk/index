import { beforeEach, describe, expect, it } from "bun:test";
import { getStats, recordTiming, resetStats, setMaxSamplesForTesting } from "./performance";

describe("performance aggregator", () => {
  beforeEach(() => {
    resetStats();
  });

  it("records durations and getStats returns count and percentiles", () => {
    recordTiming("foo", 100);
    recordTiming("foo", 200);
    recordTiming("foo", 300);
    recordTiming("bar", 50);

    const stats = getStats();

    expect(stats.foo.count).toBe(3);
    expect(stats.bar.count).toBe(1);
    expect(stats.foo.p50).toBe(200);
    expect(stats.foo.p95).toBeGreaterThanOrEqual(200);
    expect(stats.bar.p50).toBe(50);
  });

  it("respects max samples per name", () => {
    const max = 10;
    setMaxSamplesForTesting(max);
    for (let i = 0; i < max + 5; i++) {
      recordTiming("baz", i);
    }
    setMaxSamplesForTesting(null);

    const stats = getStats();
    expect(stats.baz.count).toBe(max);
  });
});
