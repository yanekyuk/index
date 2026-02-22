import { beforeEach, describe, expect, it } from "bun:test";
import { getStats, recordTiming, resetStats } from "./performance.aggregator";
import { timed } from "./performance.wrapper";
import { Timed } from "./performance.decorator";

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

describe("Timed decorator", () => {
  beforeEach(() => {
    resetStats();
  });

  it("records as ClassName.methodName and preserves return value", async () => {
    class TestAgent {
      @Timed()
      async invoke(x: number): Promise<number> {
        return x * 2;
      }
    }

    const agent = new TestAgent();
    const result = await agent.invoke(5);

    expect(result).toBe(10);
    const stats = getStats();
    expect(stats["TestAgent.invoke"]).toBeDefined();
    expect(stats["TestAgent.invoke"].count).toBe(1);
  });

  it("preserves this context", async () => {
    class TestService {
      private multiplier = 3;

      @Timed()
      async compute(x: number): Promise<number> {
        return x * this.multiplier;
      }
    }

    const svc = new TestService();
    const result = await svc.compute(4);

    expect(result).toBe(12);
    const stats = getStats();
    expect(stats["TestService.compute"].count).toBe(1);
  });

  it("records on error and rethrows", async () => {
    class Failing {
      @Timed()
      async run(): Promise<void> {
        throw new Error("fail");
      }
    }

    const f = new Failing();
    try {
      await f.run();
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toBe("fail");
    }
    const stats = getStats();
    expect(stats["Failing.run"].count).toBe(1);
  });
});
