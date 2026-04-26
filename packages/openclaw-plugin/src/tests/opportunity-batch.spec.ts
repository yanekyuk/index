import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handle as handleAmbientDiscovery, _resetForTesting } from '../polling/ambient-discovery/ambient-discovery.poller.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

const OPP_1 = '11111111-1111-1111-1111-111111111111';
const OPP_2 = '22222222-2222-2222-2222-222222222222';

interface FetchSink {
  pendingUrls: string[];
  hookCalls: Array<{ url: string; headers?: Record<string, string>; body?: unknown }>;
  confirmCalls: Array<{ url: string; body?: unknown }>;
}

function makeApi(): OpenClawPluginApi {
  return {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: { mainAgentToolUse: 'disabled' },
    config: {
      gateway: { port: 18789 },
      hooks: { enabled: true, token: 'hooks-tok', path: '/hooks' },
    },
    runtime: {
      subagent: {
        run: mock(async () => ({ runId: 'unused' })),
        waitForRun: mock(async () => ({ result: null })),
        getSessionMessages: mock(async () => ({ messages: [] })),
      },
    },
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
    registerHttpRoute: mock(() => {}),
  };
}

function mockBackend(opportunities: unknown[], hookStatus = 200, confirmStatus = 200): FetchSink {
  const sink: FetchSink = { pendingUrls: [], hookCalls: [], confirmCalls: [] };
  global.fetch = mock(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/opportunities/pending')) {
      sink.pendingUrls.push(url);
      return new Response(JSON.stringify({ opportunities }), { status: 200 });
    }
    if (url.includes('/hooks/agent')) {
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      const headers = init?.headers as Record<string, string> | undefined;
      sink.hookCalls.push({ url, headers, body });
      return new Response(JSON.stringify({ status: 'sent' }), { status: hookStatus });
    }
    if (url.includes('/confirm-batch')) {
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      sink.confirmCalls.push({ url, body });
      return new Response(
        JSON.stringify({ confirmed: 1, alreadyDelivered: 0 }),
        { status: confirmStatus },
      );
    }
    return new Response('not-found', { status: 404 });
  }) as unknown as typeof fetch;
  return sink;
}

describe('handleAmbientDiscovery (hooks-only path)', () => {
  let mockApi: OpenClawPluginApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    _resetForTesting();
    mockApi = makeApi();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    _resetForTesting();
  });

  const cfg = {
    baseUrl: 'https://test.example.com',
    agentId: 'agent-123',
    apiKey: 'k',
    frontendUrl: 'https://test.index.network',
  };

  it('fetches /pending with ?limit=10 (ambient cap)', async () => {
    const sink = mockBackend([]);
    await handleAmbientDiscovery(mockApi, cfg);
    expect(sink.pendingUrls).toHaveLength(1);
    expect(sink.pendingUrls[0]).toContain('limit=10');
  });

  it('returns "empty" when /pending is empty (no hook dispatch, no backoff)', async () => {
    const sink = mockBackend([]);
    const result = await handleAmbientDiscovery(mockApi, cfg);
    expect(result).toBe('empty');
    expect(sink.hookCalls).toHaveLength(0);
  });

  it('dispatches via /hooks/agent with bearer token and ambient prompt', async () => {
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    const result = await handleAmbientDiscovery(mockApi, cfg);
    expect(result).toBe('dispatched');
    expect(sink.hookCalls).toHaveLength(1);
    const hookCall = sink.hookCalls[0];
    expect(hookCall.headers?.authorization).toBe('Bearer hooks-tok');
    const body = hookCall.body as { message: string; deliver: boolean; channel: string };
    expect(body.message).toContain('Real-time alert');
    expect(body.deliver).toBe(true);
    // `channel` resolves either to a chat-bound channel (when a real
    // sessions.json exists on the machine running the test) or to 'last'
    // (the unbound fallback). Both are acceptable here — channel routing
    // is verified in `main-agent.dispatcher.spec.ts`.
    expect(typeof body.channel).toBe('string');
  });

  it('confirms ALL batch IDs after successful dispatch (no scrape)', async () => {
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
      { opportunityId: OPP_2, counterpartUserId: 'user-2', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    await handleAmbientDiscovery(mockApi, cfg);
    expect(sink.confirmCalls).toHaveLength(1);
    const confirmBody = sink.confirmCalls[0].body as { opportunityIds: string[] };
    expect(confirmBody.opportunityIds.sort()).toEqual([OPP_1, OPP_2].sort());
  });

  it('skips opportunities with null counterpartUserId', async () => {
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: null, rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    const result = await handleAmbientDiscovery(mockApi, cfg);
    expect(result).toBe('empty');
    expect(sink.hookCalls).toHaveLength(0);
  });

  it('returns "error" when dispatch fails (config_error)', async () => {
    mockApi.config = { gateway: { port: 18789 } };
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    const result = await handleAmbientDiscovery(mockApi, cfg);
    expect(result).toBe('error');
    expect(sink.hookCalls).toHaveLength(0);
    expect(sink.confirmCalls).toHaveLength(0);
  });

  it('does not advance dedup hash when confirm fails', async () => {
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ], 200, 500);

    await handleAmbientDiscovery(mockApi, cfg);
    expect(sink.hookCalls).toHaveLength(1);
    expect(sink.confirmCalls).toHaveLength(1);

    // Same batch on next cycle — should re-dispatch since confirm failed.
    await handleAmbientDiscovery(mockApi, cfg);
    expect(sink.hookCalls).toHaveLength(2);
  });

  it('dedups: identical batch on second cycle does NOT re-dispatch', async () => {
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    await handleAmbientDiscovery(mockApi, cfg);
    expect(sink.hookCalls).toHaveLength(1);

    await handleAmbientDiscovery(mockApi, cfg);
    expect(sink.hookCalls).toHaveLength(1);
  });
});
