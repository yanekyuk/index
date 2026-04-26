import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handle as handleTestMessagePickup } from '../polling/test-message/test-message.poller.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

interface FetchSink {
  pickupCalls: number;
  hookCalls: Array<{ url: string; body?: unknown }>;
  deliveredCalls: Array<{ url: string; body?: unknown }>;
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

function mockBackend(opts: {
  pickupStatus?: number;
  pickupBody?: unknown;
  hookStatus?: number;
}): FetchSink {
  const sink: FetchSink = { pickupCalls: 0, hookCalls: [], deliveredCalls: [] };
  global.fetch = mock(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/test-messages/pickup')) {
      sink.pickupCalls += 1;
      const status = opts.pickupStatus ?? 200;
      if (status === 204) return new Response(null, { status: 204 });
      const bodyStr = JSON.stringify(opts.pickupBody ?? {
        id: 'msg-1',
        content: 'Test content',
        reservationToken: 'tok-1',
      });
      return new Response(bodyStr, { status, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/hooks/agent')) {
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      sink.hookCalls.push({ url, body });
      return new Response(JSON.stringify({ status: 'sent' }), { status: opts.hookStatus ?? 200 });
    }
    if (url.endsWith('/delivered')) {
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      sink.deliveredCalls.push({ url, body });
      return new Response('{}', { status: 200 });
    }
    return new Response('not-found', { status: 404 });
  }) as unknown as typeof fetch;
  return sink;
}

describe('handleTestMessagePickup (hooks-only path)', () => {
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
    baseUrl: 'http://localhost:3001',
    agentId: 'agent-123',
    apiKey: 'k',
  };

  it('returns false when pickup returns 204 (no message pending)', async () => {
    const sink = mockBackend({ pickupStatus: 204 });
    const result = await handleTestMessagePickup(mockApi, cfg);
    expect(result).toBe(false);
    expect(sink.hookCalls).toHaveLength(0);
  });

  it('returns false when pickup fails (5xx)', async () => {
    const sink = mockBackend({ pickupStatus: 500 });
    const result = await handleTestMessagePickup(mockApi, cfg);
    expect(result).toBe(false);
    expect(sink.hookCalls).toHaveLength(0);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });

  it('happy path: pickup → hook dispatch → delivered confirm with reservationToken', async () => {
    const sink = mockBackend({
      pickupBody: { id: 'msg-abc', content: 'Hello from test!', reservationToken: 'res-token-xyz' },
    });
    const result = await handleTestMessagePickup(mockApi, cfg);
    expect(result).toBe(true);
    expect(sink.hookCalls).toHaveLength(1);
    expect(sink.deliveredCalls).toHaveLength(1);
    const confirmBody = sink.deliveredCalls[0].body as { reservationToken: string };
    expect(confirmBody.reservationToken).toBe('res-token-xyz');
    expect(sink.deliveredCalls[0].url).toContain('/test-messages/msg-abc/delivered');
  });

  it('idempotency-key encodes message id and reservation token', async () => {
    const sink = mockBackend({
      pickupBody: { id: 'msg-abc', content: 'X', reservationToken: 'tok-xyz' },
    });
    await handleTestMessagePickup(mockApi, cfg);
    const hookBody = sink.hookCalls[0].body as { message: string };
    expect(hookBody.message).toContain('Delivery verification');
  });

  it('does NOT call /delivered when dispatch fails', async () => {
    const sink = mockBackend({ hookStatus: 500 });
    const result = await handleTestMessagePickup(mockApi, cfg);
    expect(result).toBe(false);
    expect(sink.deliveredCalls).toHaveLength(0);
  });

  it('does NOT call /delivered when hooks config is missing (config_error)', async () => {
    mockApi.config = { gateway: { port: 18789 } };
    const sink = mockBackend({});
    const result = await handleTestMessagePickup(mockApi, cfg);
    expect(result).toBe(false);
    expect(sink.hookCalls).toHaveLength(0);
    expect(sink.deliveredCalls).toHaveLength(0);
  });

  it('mainAgentToolUse=enabled flows into the hook prompt', async () => {
    mockApi.pluginConfig = { mainAgentToolUse: 'enabled' };
    const sink = mockBackend({
      pickupBody: { id: 'msg-tu', content: 'Tool test', reservationToken: 'tok-tu' },
    });
    await handleTestMessagePickup(mockApi, cfg);
    expect(sink.hookCalls).toHaveLength(1);
    const body = sink.hookCalls[0].body as { message: string };
    expect(body.message).toContain('You may call Index Network MCP tools');
  });
});
