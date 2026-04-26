import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handle as handleDailyDigest } from '../polling/daily-digest/daily-digest.poller.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

const OPP_1 = '11111111-1111-1111-1111-111111111111';
const OPP_2 = '22222222-2222-2222-2222-222222222222';

interface FetchSink {
  pendingUrls: string[];
  hookCalls: Array<{ url: string; body?: unknown }>;
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
      sink.hookCalls.push({ url, body });
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

describe('handleDailyDigest (hooks-only path)', () => {
  let mockApi: OpenClawPluginApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockApi = makeApi();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const cfg = {
    baseUrl: 'https://test.example.com',
    agentId: 'agent-123',
    apiKey: 'k',
    frontendUrl: 'https://test.index.network',
    maxCount: 20,
  };

  it('fetches /pending with ?limit=20 (digest cap)', async () => {
    const sink = mockBackend([]);
    await handleDailyDigest(mockApi, cfg);
    expect(sink.pendingUrls).toHaveLength(1);
    expect(sink.pendingUrls[0]).toContain('limit=20');
  });

  it('returns false when /pending is empty', async () => {
    const sink = mockBackend([]);
    const result = await handleDailyDigest(mockApi, cfg);
    expect(result).toBe(false);
    expect(sink.hookCalls).toHaveLength(0);
  });

  it('dispatches via /hooks/agent with digest prompt and confirms ALL batch IDs', async () => {
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
      { opportunityId: OPP_2, counterpartUserId: 'user-2', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);

    const result = await handleDailyDigest(mockApi, cfg);
    expect(result).toBe(true);
    expect(sink.hookCalls).toHaveLength(1);
    const body = sink.hookCalls[0].body as { message: string };
    expect(body.message.toLowerCase()).toContain('rank');

    expect(sink.confirmCalls).toHaveLength(1);
    const confirmBody = sink.confirmCalls[0].body as { opportunityIds: string[] };
    expect(confirmBody.opportunityIds.sort()).toEqual([OPP_1, OPP_2].sort());
  });

  it('returns false when dispatch fails', async () => {
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ], 500);

    const result = await handleDailyDigest(mockApi, cfg);
    expect(result).toBe(false);
    expect(sink.confirmCalls).toHaveLength(0);
  });

  it('returns true (with warning) when confirm fails after successful dispatch', async () => {
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ], 200, 500);

    const result = await handleDailyDigest(mockApi, cfg);
    expect(result).toBe(true);
    expect(sink.hookCalls).toHaveLength(1);
    expect(sink.confirmCalls).toHaveLength(1);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });

  it('skips opportunities with null counterpartUserId', async () => {
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: null, rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    const result = await handleDailyDigest(mockApi, cfg);
    expect(result).toBe(false);
    expect(sink.hookCalls).toHaveLength(0);
  });

  it('caps maxToSurface at config.maxCount and at candidate count', async () => {
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
      { opportunityId: OPP_2, counterpartUserId: 'user-2', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    await handleDailyDigest(mockApi, { ...cfg, maxCount: 1 });
    const body = sink.hookCalls[0].body as { message: string };
    // Prompt template uses maxToSurface in the wording — make sure it's clamped to 1
    expect(body.message).toContain('pick up to 1');
  });
});
