# Performance Decorator Library — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a decorator-based performance tracking library that records method/function execution durations and exposes aggregate stats via a dev-only API endpoint.

**Architecture:** Singleton module with three layers — an aggregator (in-memory store), a wrapper function (`timed`) for arbitrary async functions, and a method decorator (`Timed`) that builds on the wrapper. Stats exposed at `GET /dev/performance` in non-production environments.

**Tech Stack:** TypeScript, Bun test runner, `performance.now()` for timing.

---

### Task 1: Aggregator — Tests

**Files:**
- Create: `protocol/src/lib/performance/performance.spec.ts`

**Step 1: Write failing tests for recordTiming and getStats**

```typescript
import { beforeEach, describe, expect, it } from "bun:test";
import { getStats, recordTiming, resetStats } from "./performance.aggregator";

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
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/lib/performance/performance.spec.ts`
Expected: FAIL — module `./performance.aggregator` not found.

---

### Task 2: Aggregator — Implementation

**Files:**
- Create: `protocol/src/lib/performance/performance.aggregator.ts`

**Step 1: Implement the aggregator**

```typescript
const MAX_SAMPLES = 500;

const store = new Map<string, number[]>();

export function recordTiming(name: string, durationMs: number): void {
  let arr = store.get(name);
  if (!arr) {
    arr = [];
    store.set(name, arr);
  }
  arr.push(durationMs);
  if (arr.length > MAX_SAMPLES) {
    store.set(name, arr.slice(-MAX_SAMPLES));
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

export function getStats(): Record<string, { count: number; p50: number; p95: number }> {
  const out: Record<string, { count: number; p50: number; p95: number }> = {};
  for (const [name, arr] of store) {
    const sorted = [...arr].sort((a, b) => a - b);
    out[name] = {
      count: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
    };
  }
  return out;
}

export function resetStats(): void {
  store.clear();
}
```

**Step 2: Run aggregator tests**

Run: `cd protocol && bun test src/lib/performance/performance.spec.ts`
Expected: All 4 aggregator tests PASS.

**Step 3: Commit**

```bash
git add protocol/src/lib/performance/performance.aggregator.ts protocol/src/lib/performance/performance.spec.ts
git commit -m "feat(performance): add timing aggregator with tests"
```

---

### Task 3: Wrapper — Tests

**Files:**
- Modify: `protocol/src/lib/performance/performance.spec.ts`

**Step 1: Add failing tests for `timed` wrapper**

Append to `performance.spec.ts`:

```typescript
import { timed } from "./performance.wrapper";

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
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/lib/performance/performance.spec.ts`
Expected: FAIL — module `./performance.wrapper` not found.

---

### Task 4: Wrapper — Implementation

**Files:**
- Create: `protocol/src/lib/performance/performance.wrapper.ts`

**Step 1: Implement the wrapper**

```typescript
import { recordTiming } from "./performance.aggregator";

export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    recordTiming(name, performance.now() - start);
    return result;
  } catch (err) {
    recordTiming(name, performance.now() - start);
    throw err;
  }
}
```

**Step 2: Run wrapper tests**

Run: `cd protocol && bun test src/lib/performance/performance.spec.ts`
Expected: All 6 tests PASS (4 aggregator + 2 wrapper).

**Step 3: Commit**

```bash
git add protocol/src/lib/performance/performance.wrapper.ts protocol/src/lib/performance/performance.spec.ts
git commit -m "feat(performance): add timed() async wrapper with tests"
```

---

### Task 5: Decorator — Tests

**Files:**
- Modify: `protocol/src/lib/performance/performance.spec.ts`

**Step 1: Add failing tests for `Timed` decorator**

Append to `performance.spec.ts`:

```typescript
import { Timed } from "./performance.decorator";

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
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/lib/performance/performance.spec.ts`
Expected: FAIL — module `./performance.decorator` not found.

---

### Task 6: Decorator — Implementation

**Files:**
- Create: `protocol/src/lib/performance/performance.decorator.ts`

**Step 1: Implement the decorator**

```typescript
import { timed } from "./performance.wrapper";

export function Timed(): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void {
  return function (_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    descriptor.value = function (this: any, ...args: any[]) {
      const className = this.constructor.name;
      const name = `${className}.${propertyKey}`;
      return timed(name, () => original.apply(this, args));
    };
  };
}
```

**Step 2: Run all tests**

Run: `cd protocol && bun test src/lib/performance/performance.spec.ts`
Expected: All 9 tests PASS (4 aggregator + 2 wrapper + 3 decorator).

**Step 3: Commit**

```bash
git add protocol/src/lib/performance/performance.decorator.ts protocol/src/lib/performance/performance.spec.ts
git commit -m "feat(performance): add @Timed() method decorator with tests"
```

---

### Task 7: Barrel Export

**Files:**
- Create: `protocol/src/lib/performance/index.ts`

**Step 1: Create barrel export**

```typescript
export { recordTiming, getStats, resetStats } from "./performance.aggregator";
export { timed } from "./performance.wrapper";
export { Timed } from "./performance.decorator";
```

**Step 2: Commit**

```bash
git add protocol/src/lib/performance/index.ts
git commit -m "feat(performance): add barrel export"
```

---

### Task 8: Dev API Endpoint

**Files:**
- Modify: `protocol/src/main.ts` (add route near Bull Board block, ~line 103)

**Step 1: Add the `/dev/performance` endpoint**

Add this import at the top of `main.ts` with the other imports:

```typescript
import { getStats } from './lib/performance';
```

Add this block right after the Bull Board block (after line 108, before the Better Auth section):

```typescript
    // Performance stats at /dev/performance (dev only, alongside Bull Board)
    if (!IS_PRODUCTION && url.pathname === '/dev/performance') {
      return Response.json(getStats(), { headers: corsHeaders });
    }
```

**Step 2: Verify manually** (optional — no automated test needed for this dev-only route)

Run: `cd protocol && bun run dev`
Then: `curl http://localhost:3001/dev/performance`
Expected: `{}` (empty stats, no timings recorded yet).

**Step 3: Commit**

```bash
git add protocol/src/main.ts
git commit -m "feat(performance): expose GET /dev/performance stats endpoint"
```
