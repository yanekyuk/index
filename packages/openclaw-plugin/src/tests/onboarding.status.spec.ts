import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  isOnboardingComplete,
  _resetForTesting,
} from '../polling/onboarding/onboarding.status.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

function makeApi(): OpenClawPluginApi {
  return {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: {},
    config: {},
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

beforeEach(() => {
  originalFetch = global.fetch;
  _resetForTesting();
});

afterEach(() => {
  global.fetch = originalFetch;
  _resetForTesting();
});

describe('isOnboardingComplete', () => {
  it('returns false when onboardingCompletedAt is null', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ agent: {}, onboardingCompletedAt: null }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await isOnboardingComplete(makeApi(), cfg);
    expect(result).toBe(false);
  });

  it('returns true when onboardingCompletedAt is a non-null ISO string', async () => {
    global.fetch = mock(async () =>
      new Response(
        JSON.stringify({ agent: {}, onboardingCompletedAt: '2026-05-05T10:00:00.000Z' }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const result = await isOnboardingComplete(makeApi(), cfg);
    expect(result).toBe(true);
  });

  it('caches true — second call with same API key never hits backend', async () => {
    let callCount = 0;
    global.fetch = mock(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ agent: {}, onboardingCompletedAt: '2026-05-05T10:00:00.000Z' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await isOnboardingComplete(makeApi(), cfg);
    await isOnboardingComplete(makeApi(), cfg);
    expect(callCount).toBe(1);
  });

  it('re-queries when API key changes even if previously cached true', async () => {
    let callCount = 0;
    global.fetch = mock(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ agent: {}, onboardingCompletedAt: '2026-05-05T10:00:00.000Z' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await isOnboardingComplete(makeApi(), { ...cfg, apiKey: 'key-abc' });
    await isOnboardingComplete(makeApi(), { ...cfg, apiKey: 'key-xyz' });
    expect(callCount).toBe(2);
  });

  it('returns false conservatively on network error', async () => {
    global.fetch = mock(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const result = await isOnboardingComplete(makeApi(), cfg);
    expect(result).toBe(false);
  });

  it('returns false conservatively on non-2xx response', async () => {
    global.fetch = mock(async () =>
      new Response('Unauthorized', { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await isOnboardingComplete(makeApi(), cfg);
    expect(result).toBe(false);
  });
});
