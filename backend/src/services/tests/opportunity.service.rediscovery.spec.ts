/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, mock, beforeEach } from "bun:test";

import type { OpportunityCache } from '@indexnetwork/protocol';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — must be set up before importing OpportunityService
// ─────────────────────────────────────────────────────────────────────────────

const mockAddJob = mock(() => Promise.resolve({ id: "job-1" }));

mock.module("../../queues/opportunity.queue", () => ({
  opportunityQueue: { addJob: mockAddJob },
}));

mock.module("../../adapters/database.adapter", () => ({
  ChatDatabaseAdapter: class {
    getHydeDocument() { return null; }
  },
}));
mock.module("../../adapters/embedder.adapter", () => ({
  EmbedderAdapter: class {},
}));
mock.module("../../adapters/cache.adapter", () => ({
  RedisCacheAdapter: class {
    get = mock(() => Promise.resolve(null));
    set = mock(() => Promise.resolve());
    mget = mock(() => Promise.resolve([]));
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import service AFTER mocks
// ─────────────────────────────────────────────────────────────────────────────

const { OpportunityService } = await import("../opportunity.service");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const USER_ID = "user-rediscovery-001";

const activeIntents = [
  { id: "intent-1", payload: "Looking for ML engineers", summary: "ML engineers", createdAt: new Date() },
  { id: "intent-2", payload: "Seeking co-founders", summary: "Co-founders", createdAt: new Date() },
];

function createMockCache(overrides?: { getReturn?: unknown; getThrows?: boolean }): OpportunityCache {
  return {
    get: mock((_key: string) =>
      overrides?.getThrows ? Promise.reject(new Error("Redis connection lost")) : Promise.resolve(overrides?.getReturn ?? null)
    ) as unknown as OpportunityCache['get'],
    set: mock((_key: string, _value: unknown, _options?: { ttl?: number }) =>
      Promise.resolve()
    ) as unknown as OpportunityCache['set'],
    mget: mock((_keys: string[]) =>
      Promise.resolve([])
    ) as unknown as OpportunityCache['mget'],
  };
}

function createService(opts: {
  homeGraphResult?: Record<string, unknown>;
  activeIntents?: typeof activeIntents;
  cache?: OpportunityCache;
}) {
  const cache: OpportunityCache = opts.cache ?? createMockCache();
  const service = new OpportunityService(undefined, cache);

  // Override db with mock methods
  const mockGetActiveIntents = mock(() => Promise.resolve(opts.activeIntents ?? []));
  (service as unknown as Record<string, unknown>).db = {
    getActiveIntents: mockGetActiveIntents,
  };

  // Override homeGraph with a mock that returns the specified result
  const graphResult = opts.homeGraphResult ?? { sections: [], meta: { totalOpportunities: 0, totalSections: 0 } };
  (service as unknown as Record<string, unknown>).homeGraph = {
    invoke: mock(() => Promise.resolve(graphResult)),
  };

  return { service, cache, mockGetActiveIntents };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("OpportunityService.getHomeView — rediscovery trigger", () => {
  beforeEach(() => {
    mockAddJob.mockReset();
    mockAddJob.mockImplementation(() => Promise.resolve({ id: "job-1" }));
  });

  it("triggers rediscovery when home view returns 0 items and user has active intents", async () => {
    const { service } = createService({
      homeGraphResult: { sections: [], meta: { totalOpportunities: 0, totalSections: 0 } },
      activeIntents,
    });

    await service.getHomeView(USER_ID);
    // Allow fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(mockAddJob).toHaveBeenCalledTimes(2);
    // Verify job data
    const calls = mockAddJob.mock.calls as unknown as Array<[{ intentId: string; userId: string }, { priority: number; jobId: string }]>;
    expect(calls[0][0]).toEqual({ intentId: "intent-1", userId: USER_ID });
    expect(calls[0][1].priority).toBe(10);
    // Verify jobId includes 6h bucket
    expect(calls[0][1].jobId).toMatch(/^rediscovery:user-rediscovery-001:intent-1:\d+$/);
  });

  it("does NOT trigger rediscovery when home view returns items", async () => {
    const { service } = createService({
      homeGraphResult: {
        sections: [{ id: "s1", title: "For You", iconName: "sparkles", items: [{ id: "opp-1" }] }],
        meta: { totalOpportunities: 1, totalSections: 1 },
      },
      activeIntents,
    });

    await service.getHomeView(USER_ID);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it("does NOT trigger rediscovery when user has no active intents", async () => {
    const { service } = createService({
      homeGraphResult: { sections: [], meta: { totalOpportunities: 0, totalSections: 0 } },
      activeIntents: [],
    });

    await service.getHomeView(USER_ID);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it("throttles rediscovery via cache — does not trigger if cooldown is active", async () => {
    const cache = createMockCache({ getReturn: { triggeredAt: new Date().toISOString() } });
    const { service } = createService({
      homeGraphResult: { sections: [], meta: { totalOpportunities: 0, totalSections: 0 } },
      activeIntents,
      cache,
    });

    await service.getHomeView(USER_ID);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it("sets cooldown cache key only after at least one job is enqueued", async () => {
    const { service, cache } = createService({
      homeGraphResult: { sections: [], meta: { totalOpportunities: 0, totalSections: 0 } },
      activeIntents,
    });

    await service.getHomeView(USER_ID);
    await new Promise((r) => setTimeout(r, 50));

    // Cooldown should be set with 6h TTL
    expect(cache.set).toHaveBeenCalledTimes(1);
    const setCalls = (cache.set as ReturnType<typeof mock>).mock.calls as Array<[string, unknown, { ttl: number }]>;
    expect(setCalls[0][0]).toBe(`rediscovery:throttle:${USER_ID}`);
    expect(setCalls[0][2]).toEqual({ ttl: 6 * 60 * 60 });
  });

  it("does NOT set cooldown when all enqueues fail", async () => {
    mockAddJob.mockImplementation(() => Promise.reject(new Error("Redis down")));

    const { service, cache } = createService({
      homeGraphResult: { sections: [], meta: { totalOpportunities: 0, totalSections: 0 } },
      activeIntents,
    });

    await service.getHomeView(USER_ID);
    await new Promise((r) => setTimeout(r, 50));

    // Jobs were attempted
    expect(mockAddJob).toHaveBeenCalledTimes(2);
    // But cooldown should NOT be set since all failed
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("does NOT set cooldown on partial failure — allows retry for failed intents", async () => {
    // First intent succeeds, second fails
    let callCount = 0;
    mockAddJob.mockImplementation(() => {
      callCount++;
      return callCount === 1
        ? Promise.resolve({ id: "job-1" })
        : Promise.reject(new Error("Queue full"));
    });

    const { service, cache } = createService({
      homeGraphResult: { sections: [], meta: { totalOpportunities: 0, totalSections: 0 } },
      activeIntents,
    });

    await service.getHomeView(USER_ID);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockAddJob).toHaveBeenCalledTimes(2);
    // Cooldown should NOT be set — partial failure means retry is needed
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("still triggers rediscovery when cache.get throws (Redis down)", async () => {
    const cache = createMockCache({ getThrows: true });
    const { service } = createService({
      homeGraphResult: { sections: [], meta: { totalOpportunities: 0, totalSections: 0 } },
      activeIntents,
      cache,
    });

    await service.getHomeView(USER_ID);
    await new Promise((r) => setTimeout(r, 50));

    // Should proceed past the failed cache read and enqueue jobs
    expect(mockAddJob).toHaveBeenCalledTimes(2);
  });
});
