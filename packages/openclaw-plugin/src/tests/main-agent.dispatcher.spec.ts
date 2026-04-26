import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  detectNoReply,
  dispatchToMainAgent,
  type DispatchContext,
} from '../lib/delivery/main-agent.dispatcher.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

describe('detectNoReply', () => {
  it.each([
    'NO_REPLY',
    'no_reply',
    'NoReply',
    '  NO_REPLY\n',
    'NO_REPLY then more text',
    'noreply',
  ])('detects suppression in %p', (input) => {
    expect(detectNoReply(input)).toBe(true);
  });

  it.each([
    'Hello — here is your digest',
    'I picked NO_REPLY out of curiosity', // not at start
    '',
    '   ',
  ])('does not detect suppression in %p', (input) => {
    expect(detectNoReply(input)).toBe(false);
  });
});

describe('dispatchToMainAgent', () => {
  let mockApi: OpenClawPluginApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockApi = {
      id: 'test-plugin',
      name: 'Test Plugin',
      pluginConfig: {},
      config: {
        gateway: { port: 18789, auth: { token: 'tok' } },
      },
      runtime: {
        subagent: {
          run: mock(async () => ({ runId: 'unused' })),
          waitForRun: mock(async () => ({ result: null })),
          getSessionMessages: mock(async () => ({ messages: [] })),
        },
        agent: {
          resolveAgentDir: () => '/tmp/agent',
          resolveAgentWorkspaceDir: () => '/tmp/workspace',
          resolveAgentIdentity: () => ({ id: 'main', sessionId: 'main:session' }),
          resolveAgentTimeoutMs: () => 60_000,
          runEmbeddedAgent: mock(async () => ({ text: 'Hello user' })),
        },
      },
      logger: {
        debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}),
      },
      registerHttpRoute: mock(() => {}),
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const ctx: DispatchContext = {
    prompt: 'PROMPT',
    idempotencyKey: 'k1',
    allowSuppress: true,
  };

  it('SDK happy path returns deliveredText', async () => {
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.suppressedByNoReply).toBe(false);
    expect(out.deliveredText).toBe('Hello user');
  });

  it('SDK NO_REPLY sets suppressedByNoReply', async () => {
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockResolvedValueOnce({
      text: 'NO_REPLY',
    });
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.suppressedByNoReply).toBe(true);
  });

  it('empty SDK reply is treated as suppression', async () => {
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockResolvedValueOnce({
      text: '   ',
    });
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.suppressedByNoReply).toBe(true);
  });

  it('SDK throws → falls back to /hooks/agent', async () => {
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('not supported'),
    );
    const capturedUrls: string[] = [];
    global.fetch = mock(async (input: RequestInfo, _init?: RequestInit) => {
      capturedUrls.push(String(input));
      return new Response(JSON.stringify({ status: 'ok', text: 'Hello via hooks' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.deliveredText).toBe('Hello via hooks');
    expect(out.suppressedByNoReply).toBe(false);
    expect(capturedUrls).toHaveLength(1);
    expect(capturedUrls[0]).toContain('/hooks/agent');
  });

  it('SDK missing entirely → falls back to /hooks/agent', async () => {
    delete mockApi.runtime.agent;
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ status: 'ok', text: 'Hi' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.deliveredText).toBe('Hi');
  });

  it('both SDK and hooks fail → returns null deliveredText', async () => {
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error('boom'),
    );
    global.fetch = mock(async () =>
      new Response('server error', { status: 500 }),
    ) as unknown as typeof fetch;
    const out = await dispatchToMainAgent(mockApi, ctx);
    expect(out.deliveredText).toBeNull();
    expect(out.error).toBe('network_error');
  });
});
