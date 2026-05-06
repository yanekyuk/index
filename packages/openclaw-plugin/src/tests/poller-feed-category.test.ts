import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handle as handleDailyDigest } from '../polling/daily-digest/daily-digest.poller.js';
import { _resetForTesting as _resetOnboardingStatus } from '../polling/onboarding/onboarding.status.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

const OPP_CONNECTION = '11111111-1111-1111-1111-111111111111';
const OPP_CONNECTOR = '22222222-2222-2222-2222-222222222222';

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

interface HookCall {
  url: string;
  body?: { message?: string };
}

function mockBackendWithCategories(): { hookCalls: HookCall[] } {
  const hookCalls: HookCall[] = [];
  global.fetch = mock(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/agents/me')) {
      return new Response(
        JSON.stringify({ agent: {}, onboardingCompletedAt: '2026-05-05T10:00:00.000Z' }),
        { status: 200 },
      );
    }
    if (url.includes('/connect-token')) {
      return new Response(JSON.stringify({ token: 'mock-jwt-token' }), { status: 200 });
    }
    if (url.includes('/opportunities/pending')) {
      return new Response(
        JSON.stringify({
          opportunities: [
            {
              opportunityId: OPP_CONNECTION,
              counterpartUserId: 'user-1',
              feedCategory: 'connection',
              rendered: { headline: 'H1', personalizedSummary: 'S1', suggestedAction: 'A', narratorRemark: '' },
            },
            {
              opportunityId: OPP_CONNECTOR,
              counterpartUserId: 'user-2',
              feedCategory: 'connector-flow',
              rendered: { headline: 'H2', personalizedSummary: 'S2', suggestedAction: 'A', narratorRemark: '' },
            },
          ],
          totalPending: 5,
        }),
        { status: 200 },
      );
    }
    if (url.includes('/hooks/agent')) {
      const body = init?.body ? (JSON.parse(init.body as string) as HookCall['body']) : undefined;
      hookCalls.push({ url, body });
      return new Response(JSON.stringify({ status: 'sent' }), { status: 200 });
    }
    return new Response('not-found', { status: 404 });
  }) as unknown as typeof fetch;
  return { hookCalls };
}

describe('poller feedCategory & URL routing', () => {
  let mockApi: OpenClawPluginApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    _resetOnboardingStatus();
    mockApi = makeApi();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    _resetOnboardingStatus();
  });

  const cfg = {
    baseUrl: 'https://test.example.com',
    agentId: 'agent-123',
    apiKey: 'k',
    frontendUrl: 'https://test.index.network',
  };

  it('connector-flow candidates get /approve-introduction URLs', async () => {
    const { hookCalls } = mockBackendWithCategories();

    const result = await handleDailyDigest(mockApi, cfg);
    expect(result).toBe(true);
    expect(hookCalls).toHaveLength(1);

    const prompt = hookCalls[0].body?.message ?? '';

    // Parse the JSON payload from the prompt
    const inputMatch = prompt.match(/===== INPUT =====\n([\s\S]*?)\n===== END INPUT =====/);
    expect(inputMatch).not.toBeNull();
    const payload = JSON.parse(inputMatch![1]);

    // Connection candidate should use /connect
    const connectionCandidate = payload.candidates.find(
      (c: { opportunityId: string }) => c.opportunityId === OPP_CONNECTION,
    );
    expect(connectionCandidate.feedCategory).toBe('connection');
    expect(connectionCandidate.acceptUrl).toContain('/connect?');
    expect(connectionCandidate.acceptUrl).not.toContain('/approve-introduction');

    // Connector-flow candidate should use /approve-introduction
    const connectorCandidate = payload.candidates.find(
      (c: { opportunityId: string }) => c.opportunityId === OPP_CONNECTOR,
    );
    expect(connectorCandidate.feedCategory).toBe('connector-flow');
    expect(connectorCandidate.acceptUrl).toContain('/approve-introduction?');
    expect(connectorCandidate.acceptUrl).not.toContain('/connect?');
  });

  it('totalPending is threaded into the payload', async () => {
    const { hookCalls } = mockBackendWithCategories();

    await handleDailyDigest(mockApi, cfg);
    const prompt = hookCalls[0].body?.message ?? '';

    const inputMatch = prompt.match(/===== INPUT =====\n([\s\S]*?)\n===== END INPUT =====/);
    const payload = JSON.parse(inputMatch![1]);
    expect(payload.totalPending).toBe(5);
  });
});
