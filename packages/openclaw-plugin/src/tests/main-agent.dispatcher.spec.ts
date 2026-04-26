import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

let homeDir: string;
mock.module('node:os', () => ({
  homedir: () => homeDir,
  tmpdir,
}));

const {
  dispatchToMainAgent,
} = await import('../lib/delivery/main-agent.dispatcher.js');
type DispatchContext = import('../lib/delivery/main-agent.dispatcher.js').DispatchContext;
type OpenClawPluginApi = import('../lib/openclaw/plugin-api.js').OpenClawPluginApi;

describe('dispatchToMainAgent', () => {
  let mockApi: OpenClawPluginApi;
  let originalFetch: typeof global.fetch;
  let captured: Array<{ url: string; init?: RequestInit }>;

  function writeSessions(sessions: Record<string, unknown>): void {
    const sessionsDir = joinPath(homeDir, '.openclaw', 'agents', 'main', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(joinPath(sessionsDir, 'sessions.json'), JSON.stringify(sessions));
  }

  beforeEach(() => {
    originalFetch = global.fetch;
    homeDir = mkdtempSync(joinPath(tmpdir(), 'openclaw-plugin-test-'));
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
    rmSync(homeDir, { recursive: true, force: true });
  });

  const ctx: DispatchContext = {
    prompt: 'PROMPT BODY',
    idempotencyKey: 'key-1',
  };

  function mockOk(status = 200, body: unknown = { ok: true, runId: 'r1' }): void {
    global.fetch = mock(async (input: RequestInfo, init?: RequestInit) => {
      captured.push({ url: String(input), init });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  }

  it('targets the most recent chat-bound session via sessionKey + channel + to', async () => {
    writeSessions({
      'agent:main:telegram:direct:69340471': {
        sessionId: 'sess-tg',
        lastTo: 'telegram:69340471',
        updatedAt: 1000,
      },
      'agent:main:hook:abc-123': {
        // plugin-internal — should be skipped even if newer
        sessionId: 'sess-hook',
        lastTo: 'telegram:69340471',
        updatedAt: 9999,
      },
      'agent:main:main': {
        sessionId: 'sess-main',
        updatedAt: 9999,
      },
    });
    mockOk();
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.delivered).toBe(true);
    expect(out.unboundFallback).toBe(false);

    expect(captured).toHaveLength(1);
    const call = captured[0];
    expect(call.url).toBe('http://127.0.0.1:18789/hooks/agent');
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer hooks-tok-secret');
    expect(headers['idempotency-key']).toBe('key-1');
    const body = JSON.parse(call.init?.body as string) as Record<string, unknown>;
    expect(body.message).toBe('PROMPT BODY');
    expect(body.deliver).toBe(true);
    expect(body.wakeMode).toBe('now');
    expect(body.sessionKey).toBe('agent:main:telegram:direct:69340471');
    expect(body.channel).toBe('telegram');
    expect(body.to).toBe('telegram:69340471');
  });

  it('picks most-recently-updated chat session when multiple exist', async () => {
    writeSessions({
      'agent:main:telegram:direct:111': {
        lastTo: 'telegram:111',
        updatedAt: 100,
      },
      'agent:main:whatsapp:direct:222': {
        lastTo: 'whatsapp:222',
        updatedAt: 500,
      },
      'agent:main:discord:dm:333': {
        lastTo: 'discord:333',
        updatedAt: 250,
      },
    });
    mockOk();
    await dispatchToMainAgent(mockApi, ctx);
    const body = JSON.parse(captured[0].init?.body as string) as Record<string, unknown>;
    expect(body.sessionKey).toBe('agent:main:whatsapp:direct:222');
    expect(body.channel).toBe('whatsapp');
    expect(body.to).toBe('whatsapp:222');
  });

  it('falls back to channel:last and flags unboundFallback when no chat session exists', async () => {
    // No sessions.json written.
    mockOk();
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.delivered).toBe(true);
    expect(out.unboundFallback).toBe(true);

    const body = JSON.parse(captured[0].init?.body as string) as Record<string, unknown>;
    expect(body.channel).toBe('last');
    expect(body.sessionKey).toBeUndefined();
    expect(body.to).toBeUndefined();
  });

  it('falls back when sessions.json contains only non-chat entries', async () => {
    writeSessions({
      'agent:main:hook:abc': { lastTo: 'telegram:1', updatedAt: 9999 },
      'agent:main:main': { updatedAt: 9999 },
      'agent:main:index:foo': { lastTo: 'telegram:2', updatedAt: 9999 },
    });
    mockOk();
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.unboundFallback).toBe(true);
    const body = JSON.parse(captured[0].init?.body as string) as Record<string, unknown>;
    expect(body.channel).toBe('last');
    expect(body.sessionKey).toBeUndefined();
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
