import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import * as welcomeWatcher from '../polling/welcome/welcome.watcher.js';
import { _resetForTesting as _resetOnboardingStatus } from '../polling/onboarding/onboarding.status.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

const OPP_1 = '11111111-1111-1111-1111-111111111111';
const OPP_2 = '22222222-2222-2222-2222-222222222222';

interface FetchSink {
  pendingUrls: string[];
  hookCalls: Array<{ url: string; body?: Record<string, unknown> }>;
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

function mockBackend(
  onboardingComplete: boolean,
  opportunities: unknown[],
  hookStatus = 200,
): FetchSink {
  const sink: FetchSink = { pendingUrls: [], hookCalls: [] };
  global.fetch = mock(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/agents/me')) {
      return new Response(
        JSON.stringify({
          agent: {},
          onboardingCompletedAt: onboardingComplete ? '2026-05-05T10:00:00.000Z' : null,
        }),
        { status: 200 },
      );
    }
    if (url.includes('/connect-token')) {
      return new Response(JSON.stringify({ token: 'mock-jwt-token' }), { status: 200 });
    }
    if (url.includes('/opportunities/pending')) {
      sink.pendingUrls.push(url);
      return new Response(JSON.stringify({ opportunities }), { status: 200 });
    }
    if (url.includes('/hooks/agent')) {
      const body = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : undefined;
      sink.hookCalls.push({ url, body });
      return new Response(JSON.stringify({ ok: true, runId: 'r1' }), { status: hookStatus });
    }
    return new Response('not-found', { status: 404 });
  }) as unknown as typeof fetch;
  return sink;
}

const cfg = {
  baseUrl: 'https://test.example.com',
  agentId: 'agent-123',
  apiKey: 'k',
  frontendUrl: 'https://test.index.network',
};

describe('welcome watcher', () => {
  let mockApi: OpenClawPluginApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    _resetOnboardingStatus();
    mockApi = makeApi();
    welcomeWatcher._resetForTesting();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    _resetOnboardingStatus();
    welcomeWatcher._resetForTesting();
  });

  it('starts polling unconditionally', async () => {
    mockBackend(false, []);

    await welcomeWatcher.start(mockApi, cfg);

    const debugCalls = mockApi.logger.debug.mock.calls.map((c) => c[0]);
    expect(debugCalls.some((c) => typeof c === 'string' && c.includes('welcome watcher'))).toBe(true);
  });

  it('tick does nothing when onboarding is not complete', async () => {
    mockBackend(false, []);

    await welcomeWatcher._tick(mockApi, cfg);

    const debugCalls = mockApi.logger.debug.mock.calls.map((c) => c[0]);
    expect(debugCalls.some((c) => typeof c === 'string' && c.includes('not yet complete'))).toBe(true);
  });

  it('dispatches welcome with zero candidates', async () => {
    const sink = mockBackend(true, []);

    await welcomeWatcher._tick(mockApi, cfg);

    expect(sink.pendingUrls).toHaveLength(1);
    expect(sink.pendingUrls[0]).toContain('/opportunities/pending');
    expect(sink.hookCalls).toHaveLength(1);
    const msg = sink.hookCalls[0].body?.message;
    expect(typeof msg).toBe('string');
    expect(msg as string).toContain('WELCOME');
  });

  it('dispatches welcome with candidates including connect tokens', async () => {
    const opportunities = [
      {
        opportunityId: OPP_1,
        counterpartUserId: 'user-alice',
        rendered: {
          headline: 'Alice works on AI',
          personalizedSummary: 'You both care about AI safety',
          suggestedAction: 'discuss AI safety',
          narratorRemark: 'strong alignment',
        },
      },
      {
        opportunityId: OPP_2,
        counterpartUserId: 'user-bob',
        rendered: {
          headline: 'Bob does ML',
          personalizedSummary: 'Shared ML interest',
          suggestedAction: 'chat about ML',
          narratorRemark: 'good fit',
        },
      },
    ];
    const sink = mockBackend(true, opportunities);

    await welcomeWatcher._tick(mockApi, cfg);

    expect(sink.hookCalls).toHaveLength(1);
    const msg = sink.hookCalls[0].body?.message as string;
    expect(msg).toContain('Alice works on AI');
    expect(msg).toContain('Bob does ML');
    expect(msg).toContain('mock-jwt-token');
    expect(msg).toContain('/u/user-alice');
    expect(msg).toContain('/u/user-bob');
  });

  it('filters out opportunities without counterpartUserId', async () => {
    const opportunities = [
      {
        opportunityId: OPP_1,
        counterpartUserId: null,
        rendered: {
          headline: 'No counterpart',
          personalizedSummary: 'skip',
          suggestedAction: 'skip',
          narratorRemark: 'skip',
        },
      },
      {
        opportunityId: OPP_2,
        counterpartUserId: 'user-bob',
        rendered: {
          headline: 'Bob does ML',
          personalizedSummary: 'Shared ML interest',
          suggestedAction: 'chat about ML',
          narratorRemark: 'good fit',
        },
      },
    ];
    const sink = mockBackend(true, opportunities);

    await welcomeWatcher._tick(mockApi, cfg);

    expect(sink.hookCalls).toHaveLength(1);
    const msg = sink.hookCalls[0].body?.message as string;
    expect(msg).toContain('Bob does ML');
    expect(msg).not.toContain('No counterpart');
  });

  it('logs a warning when hook dispatch returns non-2xx', async () => {
    mockBackend(true, [], 500);

    await welcomeWatcher._tick(mockApi, cfg);

    const warnCalls = mockApi.logger.warn.mock.calls.map((c) => c[0]);
    expect(warnCalls.some((c) => typeof c === 'string' && c.includes('dispatch failed'))).toBe(true);
  });
});
