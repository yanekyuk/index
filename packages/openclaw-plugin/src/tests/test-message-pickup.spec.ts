import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handle as handleTestMessagePickup } from '../polling/test-message/test-message.poller.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

describe('handleTestMessagePickup (main-agent path)', () => {
  let mockApi: OpenClawPluginApi;
  let runEmbeddedCalls: Array<{ prompt: string; runId: string }>;
  let originalFetch: typeof global.fetch;

  const BASE_URL = 'http://localhost:3001';
  const AGENT_ID = 'agent-123';
  const API_KEY = 'test-api-key';

  const cfg = { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY };

  beforeEach(() => {
    runEmbeddedCalls = [];
    originalFetch = global.fetch;

    mockApi = {
      id: 'indexnetwork-openclaw-plugin',
      name: 'Index Network',
      pluginConfig: { mainAgentToolUse: 'disabled' },
      config: { gateway: { port: 18789 } },
      runtime: {
        subagent: {
          run: mock(async () => ({ runId: 'unused' })),
          waitForRun: mock(async () => ({ result: null })),
          getSessionMessages: mock(async () => ({ messages: [] })),
        },
        agent: {
          resolveAgentDir: () => '/tmp/agent',
          resolveAgentWorkspaceDir: () => '/tmp/ws',
          resolveAgentIdentity: () => ({ id: 'main', sessionId: 'main' }),
          resolveAgentTimeoutMs: () => 60_000,
          runEmbeddedAgent: mock(async (opts) => {
            runEmbeddedCalls.push({ prompt: opts.prompt, runId: opts.runId });
            return { text: 'Here is your delivery verification: Hello from test!' };
          }),
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

  it('returns false when pickup endpoint returns 204 (no message pending)', async () => {
    const fetchCalls: string[] = [];
    global.fetch = mock(async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const result = await handleTestMessagePickup(mockApi, cfg);

    expect(result).toBe(false);
    expect(runEmbeddedCalls).toHaveLength(0);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain('/test-messages/pickup');
  });

  it('returns false when pickup endpoint fails (5xx)', async () => {
    global.fetch = mock(async () => {
      return new Response('Internal Server Error', { status: 500 });
    }) as unknown as typeof fetch;

    const result = await handleTestMessagePickup(mockApi, cfg);

    expect(result).toBe(false);
    expect(runEmbeddedCalls).toHaveLength(0);
    expect(mockApi.logger.warn).toHaveBeenCalled();
    const warnArgs = (mockApi.logger.warn as ReturnType<typeof mock>).mock.calls[0] as string[];
    expect(warnArgs[0]).toContain('500');
  });

  it('happy path: pickup returns reservation → main agent renders → confirm called with reservationToken', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      fetchCalls.push({ url: urlStr, init });

      if (urlStr.includes('/test-messages/pickup')) {
        return new Response(
          JSON.stringify({ id: 'msg-abc', content: 'Hello from test!', reservationToken: 'res-token-xyz' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await handleTestMessagePickup(mockApi, cfg);

    expect(result).toBe(true);
    expect(runEmbeddedCalls).toHaveLength(1);

    // Confirm POST made with correct reservationToken
    expect(fetchCalls).toHaveLength(2);
    const confirmCall = fetchCalls[1];
    expect(confirmCall.url).toContain('/test-messages/msg-abc/delivered');
    expect(confirmCall.init?.method).toBe('POST');
    const confirmBody = JSON.parse(confirmCall.init?.body as string);
    expect(confirmBody.reservationToken).toBe('res-token-xyz');

    // Idempotency key encodes the message id and token
    expect(runEmbeddedCalls[0].runId).toBe('index:delivery:test:msg-abc:res-token-xyz');
  });

  it('prompt contains "Delivery verification" and does NOT contain "NO_REPLY" clause', async () => {
    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('/test-messages/pickup')) {
        return new Response(
          JSON.stringify({ id: 'msg-1', content: 'Test content', reservationToken: 'tok-1' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    await handleTestMessagePickup(mockApi, cfg);

    expect(runEmbeddedCalls).toHaveLength(1);
    const prompt = runEmbeddedCalls[0].prompt;
    expect(prompt).toContain('Delivery verification');
    // allowSuppress=false: NO_REPLY clause must NOT appear in the prompt
    expect(prompt).not.toContain('NO_REPLY');
  });

  it('agent emits NO_REPLY anyway → error log emitted and no confirm call made', async () => {
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockResolvedValueOnce({
      text: 'NO_REPLY',
    });

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      fetchCalls.push({ url: urlStr, init });
      if (urlStr.includes('/test-messages/pickup')) {
        return new Response(
          JSON.stringify({ id: 'msg-nr', content: 'Test content', reservationToken: 'tok-nr' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await handleTestMessagePickup(mockApi, cfg);

    expect(result).toBe(false);
    expect(mockApi.logger.error).toHaveBeenCalled();
    const errorArgs = (mockApi.logger.error as ReturnType<typeof mock>).mock.calls[0] as string[];
    expect(errorArgs[0]).toContain('NO_REPLY');
    // Only pickup call — no confirm
    const confirmCalls = fetchCalls.filter((c) => c.url.includes('/delivered'));
    expect(confirmCalls).toHaveLength(0);
  });

  it('dispatcher returns network_error → no confirm call made', async () => {
    // Make the SDK throw and the hooks port unavailable so both paths fail
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('SDK unavailable'),
    );
    // Remove gateway config so hooks fallback is unavailable too
    mockApi.config = {};

    const fetchCalls: Array<{ url: string }> = [];
    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url);
      fetchCalls.push({ url: urlStr });
      if (urlStr.includes('/test-messages/pickup')) {
        return new Response(
          JSON.stringify({ id: 'msg-ne', content: 'Test content', reservationToken: 'tok-ne' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await handleTestMessagePickup(mockApi, cfg);

    expect(result).toBe(false);
    const confirmCalls = fetchCalls.filter((c) => c.url.includes('/delivered'));
    expect(confirmCalls).toHaveLength(0);
  });

  it('mainAgentToolUse=enabled flows into the prompt (tool use permitted)', async () => {
    mockApi.pluginConfig = { mainAgentToolUse: 'enabled' };

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('/test-messages/pickup')) {
        return new Response(
          JSON.stringify({ id: 'msg-tu', content: 'Tool test', reservationToken: 'tok-tu' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    await handleTestMessagePickup(mockApi, cfg);

    expect(runEmbeddedCalls).toHaveLength(1);
    expect(runEmbeddedCalls[0].prompt).toContain('You may call Index Network MCP tools');
  });
});
