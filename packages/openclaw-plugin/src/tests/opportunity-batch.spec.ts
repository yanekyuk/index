import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { handle as handleOpportunityBatch, _resetForTesting } from '../polling/ambient-discovery/ambient-discovery.poller.js';
import type { OpenClawPluginApi, SubagentRunOptions } from '../lib/openclaw/plugin-api.js';

interface FakeApi {
  api: OpenClawPluginApi;
  subagentCalls: SubagentRunOptions[];
  waitForRunCalls: Array<{ runId: string; timeoutMs: number }>;
  getSessionMessagesCalls: string[];
  logger: {
    warn: ReturnType<typeof mock>;
    error: ReturnType<typeof mock>;
    info: ReturnType<typeof mock>;
    debug: ReturnType<typeof mock>;
  };
}

function buildFakeApi(
  deliveryConfigured = true,
  configGetModel?: unknown,
  evaluatorContent = 'Opportunity: Alice is a TypeScript engineer.',
): FakeApi {
  const subagentCalls: SubagentRunOptions[] = [];
  const waitForRunCalls: Array<{ runId: string; timeoutMs: number }> = [];
  const getSessionMessagesCalls: string[] = [];
  const logger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };

  const api: OpenClawPluginApi = {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: deliveryConfigured
      ? { deliveryChannel: 'telegram', deliveryTarget: '69340471' }
      : {},
    runtime: {
      subagent: {
        run: async (opts) => {
          subagentCalls.push(opts);
          return { runId: `fake-run-id-${subagentCalls.length}` };
        },
        waitForRun: async (opts) => {
          waitForRunCalls.push(opts);
          return { result: null };
        },
        getSessionMessages: async ({ sessionKey }) => {
          getSessionMessagesCalls.push(sessionKey);
          return { messages: [{ role: 'assistant', content: evaluatorContent }] };
        },
      },
    },
    logger,
    registerHttpRoute: mock(() => {}),
    ...(configGetModel !== undefined && {
      configGet: async () => configGetModel,
    }),
  };

  return { api, subagentCalls, waitForRunCalls, getSessionMessagesCalls, logger };
}

const BASE_URL = 'http://localhost:3001';
const AGENT_ID = 'agent-123';
const API_KEY = 'test-api-key';

const SAMPLE_CANDIDATE = {
  opportunityId: 'opp-abc',
  counterpartUserId: 'user-alice-123',
  rendered: {
    headline: 'Great match found',
    personalizedSummary: 'Alice is looking for a TypeScript engineer.',
    suggestedAction: 'Send a connection request to Alice.',
    narratorRemark: 'This looks like a perfect fit.',
  },
};

describe('handleOpportunityBatch', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    _resetForTesting();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    _resetForTesting();
  });

  test('returns false and no subagent when /pending returns empty array', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
  });

  test('returns false and logs warn when /pending returns non-2xx', async () => {
    global.fetch = mock(async () =>
      new Response('Internal Server Error', { status: 500 }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    expect(fake.logger.warn).toHaveBeenCalled();
  });

  test('returns false when delivery routing not configured', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi(false);
    const result = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    expect(fake.logger.warn).toHaveBeenCalled();
  });

  test('phase 1: evaluator runs with deliver:false on own session key', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fake.subagentCalls[0].deliver).toBe(false);
    expect(fake.subagentCalls[0].sessionKey).toBe(`index:ambient-discovery:${AGENT_ID}`);
  });

  test('phase 1: evaluator prompt contains candidate data', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    const message = fake.subagentCalls[0].message;
    expect(message).toContain(SAMPLE_CANDIDATE.opportunityId);
    expect(message).toContain(SAMPLE_CANDIDATE.rendered.headline);
    expect(message).toContain(SAMPLE_CANDIDATE.rendered.personalizedSummary);
    expect(message).toContain(SAMPLE_CANDIDATE.rendered.suggestedAction);
    expect(message).toContain('user-alice-123');
  });

  test('waitForRun is called with evaluator runId', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fake.waitForRunCalls).toHaveLength(1);
    expect(fake.waitForRunCalls[0].runId).toBe('fake-run-id-1');
    expect(fake.waitForRunCalls[0].timeoutMs).toBeGreaterThan(0);
  });

  test('getSessionMessages is called with evaluator session key', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fake.getSessionMessagesCalls).toHaveLength(1);
    expect(fake.getSessionMessagesCalls[0]).toBe(`index:ambient-discovery:${AGENT_ID}`);
  });

  test('phase 2: delivery subagent runs with deliver:true on telegram session key', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(true);
    expect(fake.subagentCalls).toHaveLength(2);
    expect(fake.subagentCalls[1].deliver).toBe(true);
    expect(fake.subagentCalls[1].sessionKey).toBe('agent:main:telegram:direct:69340471');
  });

  test('phase 2: delivery message contains evaluator output', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi(true, undefined, 'Evaluated: Alice is a great match.');
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fake.subagentCalls[1].message).toContain('Evaluated: Alice is a great match.');
  });

  test('returns false when waitForRun times out', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    fake.api.runtime.subagent.waitForRun = async () => { throw new Error('Evaluator timed out'); };
    const result = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(1);
    expect(fake.logger.warn).toHaveBeenCalled();
    const warnArgs = fake.logger.warn.mock.calls[0] as string[];
    expect(warnArgs[0]).toContain('timed out');
  });

  test('returns false when getSessionMessages fails', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    fake.api.runtime.subagent.getSessionMessages = async () => { throw new Error('Session not found'); };
    const result = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(1);
    expect(fake.logger.warn).toHaveBeenCalled();
    const warnArgs = fake.logger.warn.mock.calls[0] as string[];
    expect(warnArgs[0]).toContain('Session not found');
  });

  test('returns false without dispatching delivery when evaluator produces no output', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi(true, undefined, ''); // empty evaluator output
    const result = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(1); // only evaluator, no delivery
  });

  test('idempotency keys are stable for the same batch regardless of order', async () => {
    const candidates = [SAMPLE_CANDIDATE, { ...SAMPLE_CANDIDATE, opportunityId: 'opp-xyz' }];

    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: candidates }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake1 = buildFakeApi();
    await handleOpportunityBatch(fake1.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    _resetForTesting();

    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [...candidates].reverse() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake2 = buildFakeApi();
    await handleOpportunityBatch(fake2.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fake1.subagentCalls[0].idempotencyKey).toBe(fake2.subagentCalls[0].idempotencyKey);
    expect(fake1.subagentCalls[1].idempotencyKey).toBe(fake2.subagentCalls[1].idempotencyKey);
  });

  test('passes model to both evaluator and delivery subagent', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi(true, 'anthropic/claude-sonnet-4-6');
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fake.subagentCalls[0].model).toBe('anthropic/claude-sonnet-4-6');
    expect(fake.subagentCalls[1].model).toBe('anthropic/claude-sonnet-4-6');
  });

  test('calls /api/agents/:agentId/opportunities/pending with GET', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      return new Response(JSON.stringify({ opportunities: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain(`/agents/${AGENT_ID}/opportunities/pending`);
    expect(fetchCalls[0].init?.method).toBe('GET');
  });

  test('does not re-launch subagents on second call with identical opportunity set', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [SAMPLE_CANDIDATE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const first = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });
    const second = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(fake.subagentCalls).toHaveLength(2); // only from first call
  });

  test('re-launches subagents when opportunity set changes', async () => {
    const SECOND_CANDIDATE = {
      opportunityId: 'opp-xyz',
      counterpartUserId: 'user-bob-456',
      rendered: {
        headline: 'Another match',
        personalizedSummary: 'Bob is looking for a designer.',
        suggestedAction: 'Connect with Bob.',
        narratorRemark: 'Solid fit.',
      },
    };

    let callCount = 0;
    global.fetch = mock(async () => {
      callCount++;
      const opportunities = callCount === 1
        ? [SAMPLE_CANDIDATE]
        : [SAMPLE_CANDIDATE, SECOND_CANDIDATE];
      return new Response(JSON.stringify({ opportunities }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const first = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });
    const second = await handleOpportunityBatch(fake.api, { baseUrl: BASE_URL, agentId: AGENT_ID, apiKey: API_KEY });

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(fake.subagentCalls).toHaveLength(4); // 2 per successful call
  });
});
