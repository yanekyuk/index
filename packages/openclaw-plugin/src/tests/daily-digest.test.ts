import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handle as handleDailyDigest } from '../polling/daily-digest/daily-digest.poller.js';
import type { OpenClawPluginApi, SubagentRunOptions } from '../lib/openclaw/plugin-api.js';

describe('handleDailyDigest', () => {
  let mockApi: OpenClawPluginApi;
  let subagentRunCalls: SubagentRunOptions[];
  let originalFetch: typeof global.fetch;

  const EVALUATOR_CONTENT = 'Digest: opp-1 matches your goals. opp-2 is also relevant.';

  beforeEach(() => {
    subagentRunCalls = [];
    originalFetch = global.fetch;

    mockApi = {
      id: 'test-plugin',
      name: 'Test Plugin',
      pluginConfig: {
        deliveryChannel: 'telegram',
        deliveryTarget: '12345',
      },
      runtime: {
        subagent: {
          run: mock(async (opts) => {
            subagentRunCalls.push(opts);
            return { runId: `run-${subagentRunCalls.length}` };
          }),
          waitForRun: mock(async () => ({ result: null })),
          getSessionMessages: mock(async () => ({
            messages: [{ role: 'assistant', content: EVALUATOR_CONTENT }],
          })),
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

  it('phase 1: evaluator runs with deliver:false on daily-digest session key', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H1', personalizedSummary: 'S1', suggestedAction: 'A1', narratorRemark: '' } },
          { opportunityId: 'opp-2', counterpartUserId: 'user-2', rendered: { headline: 'H2', personalizedSummary: 'S2', suggestedAction: 'A2', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://test.index.network',
      maxCount: 5,
    });

    expect(subagentRunCalls[0].deliver).toBe(false);
    expect(subagentRunCalls[0].sessionKey).toMatch(/^index:daily-digest:agent-123:\d{4}-\d{2}-\d{2}$/);
  });

  it('phase 1: evaluator prompt contains top-N instruction and candidate data', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H1', personalizedSummary: 'S1', suggestedAction: 'A1', narratorRemark: '' } },
          { opportunityId: 'opp-2', counterpartUserId: 'user-2', rendered: { headline: 'H2', personalizedSummary: 'S2', suggestedAction: 'A2', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://test.index.network',
      maxCount: 5,
    });

    expect(subagentRunCalls[0].message).toContain('daily digest');
    expect(subagentRunCalls[0].message).toContain('top 2'); // min(5, 2 available)
    expect(subagentRunCalls[0].message).toContain('opp-1');
    expect(subagentRunCalls[0].message).toContain('opp-2');
  });

  it('phase 2: delivery subagent runs with deliver:true on telegram session key', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H1', personalizedSummary: 'S1', suggestedAction: 'A1', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://test.index.network',
      maxCount: 5,
    });

    expect(result).toBe(true);
    expect(subagentRunCalls).toHaveLength(2);
    expect(subagentRunCalls[1].deliver).toBe(true);
    expect(subagentRunCalls[1].sessionKey).toBe('agent:main:telegram:direct:12345');
  });

  it('delivery idempotency key contains daily-digest and a date', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H1', personalizedSummary: 'S1', suggestedAction: 'A1', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://test.index.network',
      maxCount: 5,
    });

    expect(subagentRunCalls[1].idempotencyKey).toContain('daily-digest');
    expect(subagentRunCalls[1].idempotencyKey).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('phase 2: delivery message contains evaluator output', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H1', personalizedSummary: 'S1', suggestedAction: 'A1', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://test.index.network',
      maxCount: 5,
    });

    expect(subagentRunCalls[1].message).toContain(EVALUATOR_CONTENT);
  });

  it('phase 2: delivery message includes frontendUrl in prompt', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H1', personalizedSummary: 'S1', suggestedAction: 'A1', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://dev.index.network',
      maxCount: 5,
    });

    expect(subagentRunCalls[1].message).toContain('https://dev.index.network');
  });

  it('returns false when no opportunities pending', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://test.index.network',
      maxCount: 10,
    });

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(0);
  });

  it('returns false when delivery routing not configured', async () => {
    mockApi.pluginConfig = {};

    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://test.index.network',
      maxCount: 10,
    });

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(0);
  });

  it('returns false on fetch network error', async () => {
    global.fetch = mock(async () => { throw new Error('Network error'); }) as unknown as typeof fetch;

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://test.index.network',
      maxCount: 10,
    });

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(0);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });

  it('returns false on non-200 response', async () => {
    global.fetch = mock(async () =>
      new Response('Internal Server Error', { status: 500 }),
    ) as unknown as typeof fetch;

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://test.index.network',
      maxCount: 10,
    });

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(0);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });

  it('returns false when waitForRun times out', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    mockApi.runtime.subagent.waitForRun = async () => { throw new Error('Evaluator timed out'); };

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://test.index.network',
      maxCount: 10,
    });

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(1);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });

  it('returns false when getSessionMessages fails', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    mockApi.runtime.subagent.getSessionMessages = async () => { throw new Error('Session not found'); };

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://test.index.network',
      maxCount: 10,
    });

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(1);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });

  it('returns false when evaluator subagent dispatch throws', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        opportunities: [
          { opportunityId: 'opp-1', counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    mockApi.runtime.subagent.run = mock(async () => { throw new Error('Subagent runtime error'); });

    const result = await handleDailyDigest(mockApi, {
      baseUrl: 'https://test.example.com',
      agentId: 'agent-123',
      apiKey: 'api-key-123',
      frontendUrl: 'https://test.index.network',
      maxCount: 10,
    });

    expect(result).toBe(false);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });
});
