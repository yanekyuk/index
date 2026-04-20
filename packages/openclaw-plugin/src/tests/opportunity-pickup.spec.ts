import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { _resetForTesting, handleOpportunityBatch } from '../index.js';
import type { OpenClawPluginApi, SubagentRunOptions } from '../plugin-api.js';

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

const SAMPLE_OPPORTUNITY = {
  opportunityId: 'opp-abc',
  rendered: {
    headline: 'Great match found',
    personalizedSummary: 'Alice is looking for a TypeScript engineer.',
    suggestedAction: 'Send a connection request to Alice.',
    narratorRemark: 'This looks like a perfect fit.',
  },
};

const SAMPLE_BATCH_RESPONSE = {
  opportunities: [SAMPLE_OPPORTUNITY],
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

  test('returns false when opportunities array is empty', async () => {
    const fetchCalls: string[] = [];
    global.fetch = mock(async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      return new Response(JSON.stringify({ opportunities: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityBatch(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain('/opportunities/pending');
  });

  test('on 200 with opportunities, launches evaluator subagent with deliver: true', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      fetchCalls.push({ url: urlStr, init });
      return new Response(JSON.stringify(SAMPLE_BATCH_RESPONSE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityBatch(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(result).toBe(true);

    // Subagent dispatched once with deliver: true
    expect(fake.subagentCalls).toHaveLength(1);
    const call = fake.subagentCalls[0];
    expect(call.deliver).toBe(true);

    // Message should contain opportunity content
    expect(call.message).toContain(SAMPLE_OPPORTUNITY.rendered.headline);
    expect(call.message).toContain(SAMPLE_OPPORTUNITY.rendered.personalizedSummary);
    expect(call.message).toContain(SAMPLE_OPPORTUNITY.rendered.suggestedAction);
    expect(call.message).toContain(SAMPLE_OPPORTUNITY.rendered.narratorRemark);

    // Only the pending fetch call — no confirm call
    expect(fetchCalls).toHaveLength(1);
  });

  test('on non-2xx error (e.g. 500), logs warn, returns false, no dispatch', async () => {
    global.fetch = mock(async () => {
      return new Response('Internal Server Error', { status: 500 });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityBatch(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    expect(fake.logger.warn).toHaveBeenCalled();
    const warnArgs = fake.logger.warn.mock.calls[0] as string[];
    expect(warnArgs[0]).toContain('500');
  });

  test('dispatches with correct sessionKey and idempotencyKey format', async () => {
    global.fetch = mock(async () => {
      return new Response(JSON.stringify(SAMPLE_BATCH_RESPONSE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityBatch(fake.api, BASE_URL, AGENT_ID, API_KEY);

    const call = fake.subagentCalls[0];
    expect(call.sessionKey).toBe('agent:main:telegram:direct:69340471');
    expect(call.idempotencyKey).toMatch(/^index:delivery:opportunity-batch:agent-123:[a-z0-9]+$/);
  });

  test('returns false and warns when delivery routing not configured', async () => {
    global.fetch = mock(async () => {
      return new Response(JSON.stringify(SAMPLE_BATCH_RESPONSE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    // Override pluginConfig to remove delivery routing
    (fake.api as OpenClawPluginApi).pluginConfig = {};
    const result = await handleOpportunityBatch(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    expect(fake.logger.warn).toHaveBeenCalled();
    const warnArgs = fake.logger.warn.mock.calls[0] as string[];
    expect(warnArgs[0]).toContain('delivery routing not configured');
  });

  test('same batch of IDs always produces same idempotencyKey', async () => {
    const batchResponse = {
      opportunities: [
        { ...SAMPLE_OPPORTUNITY, opportunityId: 'opp-1' },
        { ...SAMPLE_OPPORTUNITY, opportunityId: 'opp-2' },
      ],
    };

    let callCount = 0;
    global.fetch = mock(async () => {
      callCount++;
      return new Response(JSON.stringify(batchResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const fake1 = buildFakeApi();
    await handleOpportunityBatch(fake1.api, BASE_URL, AGENT_ID, API_KEY);

    const fake2 = buildFakeApi();
    await handleOpportunityBatch(fake2.api, BASE_URL, AGENT_ID, API_KEY);

    expect(fake1.subagentCalls[0].idempotencyKey).toBe(fake2.subagentCalls[0].idempotencyKey);
    expect(callCount).toBe(2);
  });
});
