import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handle, _resetForTesting } from '../polling/accepted-opportunity/accepted-opportunity.poller.js';
import { _resetForTesting as _resetOnboardingStatus } from '../polling/onboarding/onboarding.status.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

function makeApi(): OpenClawPluginApi {
  return {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: {},
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

const cfg = { baseUrl: 'https://test.example.com', agentId: 'agent-1', apiKey: 'key-abc' };

let originalFetch: typeof global.fetch;

beforeEach(() => { originalFetch = global.fetch; _resetForTesting(); _resetOnboardingStatus(); });
afterEach(() => { global.fetch = originalFetch; _resetForTesting(); _resetOnboardingStatus(); });

describe('accepted-opportunity poller onboarding guard', () => {
  it('returns "empty" without hitting backend when onboarding is not complete', async () => {
    global.fetch = mock(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/api/agents/me')) {
        return new Response(JSON.stringify({ agent: {}, onboardingCompletedAt: null }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const result = await handle(makeApi(), cfg);
    expect(result).toBe('empty');
  });
});
