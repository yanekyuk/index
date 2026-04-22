import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { handle as handleTestMessagePickup } from '../polling/test-message/test-message.poller.js';
import type { OpenClawPluginApi, SubagentRunOptions } from '../lib/openclaw/plugin-api.js';

interface FakeApi {
  api: OpenClawPluginApi;
  subagentCalls: SubagentRunOptions[];
  logger: {
    warn: ReturnType<typeof mock>;
    error: ReturnType<typeof mock>;
    info: ReturnType<typeof mock>;
    debug: ReturnType<typeof mock>;
  };
}

function buildFakeApi(): FakeApi {
  const subagentCalls: SubagentRunOptions[] = [];
  const logger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };

  const api: OpenClawPluginApi = {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: { deliveryChannel: 'telegram', deliveryTarget: '69340471' },
    runtime: {
      subagent: {
        run: async (opts) => {
          subagentCalls.push(opts);
          return { runId: 'fake-run-id' };
        },
      },
    },
    logger,
    registerHttpRoute: mock(() => {}),
  };

  return { api, subagentCalls, logger };
}

const BASE_URL = 'http://localhost:3001';
const AGENT_ID = 'agent-123';
const API_KEY = 'test-api-key';

describe('handleTestMessagePickup', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('204 response → returns false, no dispatch, no confirm POST', async () => {
    const fetchCalls: string[] = [];
    global.fetch = mock(async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleTestMessagePickup(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    // Only the pickup call, no confirm
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain('/test-messages/pickup');
    expect(fake.logger.warn).not.toHaveBeenCalled();
  });

  test('200 response → dispatches subagent with deliver: true, then POSTs confirm with reservationToken', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      fetchCalls.push({ url: urlStr, init });

      if (urlStr.includes('/test-messages/pickup')) {
        return new Response(
          JSON.stringify({
            id: 'msg-abc',
            content: 'Hello from test!',
            reservationToken: 'res-token-xyz',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // confirm endpoint
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleTestMessagePickup(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(true);

    // Subagent should have been called once with deliver: true
    expect(fake.subagentCalls).toHaveLength(1);
    const call = fake.subagentCalls[0];
    expect(call.deliver).toBe(true);
    expect(call.sessionKey).toBe('agent:main:telegram:direct:69340471');
    expect(call.idempotencyKey).toBe('index:delivery:test:msg-abc:res-token-xyz');

    // Confirm POST should have been made
    expect(fetchCalls).toHaveLength(2);
    const confirmCall = fetchCalls[1];
    expect(confirmCall.url).toContain('/test-messages/msg-abc/delivered');
    expect(confirmCall.init?.method).toBe('POST');
    const confirmBody = JSON.parse(confirmCall.init?.body as string);
    expect(confirmBody.reservationToken).toBe('res-token-xyz');
  });

  test('non-2xx response → returns false, logs warn, no dispatch', async () => {
    global.fetch = mock(async () => {
      return new Response('Internal Server Error', { status: 500 });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleTestMessagePickup(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    expect(fake.logger.warn).toHaveBeenCalled();
    const warnArgs = fake.logger.warn.mock.calls[0] as string[];
    expect(warnArgs[0]).toContain('500');
  });

  test('confirm failure is logged as warning but does not throw', async () => {
    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('/test-messages/pickup')) {
        return new Response(
          JSON.stringify({ id: 'msg-def', content: 'Test', reservationToken: 'tok-1' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // Confirm fails with a network-level error
      throw new Error('Connection refused');
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    // Should not throw
    const result = await handleTestMessagePickup(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(true);
    expect(fake.subagentCalls).toHaveLength(1);
    expect(fake.logger.warn).toHaveBeenCalled();
    const warnArgs = fake.logger.warn.mock.calls[0] as string[];
    expect(warnArgs[0]).toContain('Connection refused');
  });
});
