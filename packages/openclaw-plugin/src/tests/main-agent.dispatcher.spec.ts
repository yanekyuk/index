import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  dispatchToMainAgent,
  type DispatchContext,
} from '../lib/delivery/main-agent.dispatcher.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

describe('dispatchToMainAgent', () => {
  let mockApi: OpenClawPluginApi;
  let originalFetch: typeof global.fetch;
  let captured: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    originalFetch = global.fetch;
    captured = [];
    mockApi = {
      id: 'test-plugin',
      name: 'Test Plugin',
      pluginConfig: {},
      config: {
        gateway: { port: 18789, auth: { token: 'gateway-tok' } },
        hooks: { enabled: true, token: 'hooks-tok-secret', path: '/hooks' },
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
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const ctx: DispatchContext = {
    prompt: 'PROMPT BODY',
    idempotencyKey: 'key-1',
  };

  function mockOk(status = 200, body: unknown = { status: 'sent' }): void {
    global.fetch = mock(async (input: RequestInfo, init?: RequestInit) => {
      captured.push({ url: String(input), init });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  }

  it('happy path: posts to /hooks/agent with bearer token, deliver:true, channel:last', async () => {
    mockOk();
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.delivered).toBe(true);
    expect(out.error).toBeUndefined();

    expect(captured).toHaveLength(1);
    const call = captured[0];
    expect(call.url).toBe('http://127.0.0.1:18789/hooks/agent');
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer hooks-tok-secret');
    expect(headers['idempotency-key']).toBe('key-1');
    const body = JSON.parse(call.init?.body as string) as Record<string, unknown>;
    expect(body.message).toBe('PROMPT BODY');
    expect(body.deliver).toBe(true);
    expect(body.channel).toBe('last');
    expect(body.wakeMode).toBe('now');
  });

  it('honors custom hooks.path', async () => {
    mockApi.config = {
      ...mockApi.config,
      hooks: { enabled: true, token: 'hooks-tok-secret', path: '/my-hooks/' },
    };
    mockOk();
    await dispatchToMainAgent(mockApi, ctx);
    expect(captured[0].url).toBe('http://127.0.0.1:18789/my-hooks/agent');
  });

  it('returns config_error and skips fetch when hooks.token is missing', async () => {
    mockApi.config = {
      gateway: { port: 18789 },
      hooks: { enabled: true },
    };
    let fetchCalled = false;
    global.fetch = mock(async () => {
      fetchCalled = true;
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;

    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.delivered).toBe(false);
    expect(out.error).toBe('config_error');
    expect(fetchCalled).toBe(false);
  });

  it('returns config_error when hooks.enabled=false', async () => {
    mockApi.config = {
      gateway: { port: 18789 },
      hooks: { enabled: false, token: 'tok' },
    };
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.delivered).toBe(false);
    expect(out.error).toBe('config_error');
  });

  it('returns config_error when gateway.port is missing', async () => {
    mockApi.config = {
      gateway: {},
      hooks: { enabled: true, token: 'tok' },
    };
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.delivered).toBe(false);
    expect(out.error).toBe('config_error');
  });

  it('returns unauthorized on 401', async () => {
    mockOk(401, { error: 'bad token' });
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.delivered).toBe(false);
    expect(out.error).toBe('unauthorized');
  });

  it('returns unauthorized on 403', async () => {
    mockOk(403, { error: 'forbidden' });
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.error).toBe('unauthorized');
  });

  it('returns network_error on 5xx', async () => {
    mockOk(500, 'internal');
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.delivered).toBe(false);
    expect(out.error).toBe('network_error');
  });

  it('returns network_error when fetch throws', async () => {
    global.fetch = mock(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.delivered).toBe(false);
    expect(out.error).toBe('network_error');
  });
});
