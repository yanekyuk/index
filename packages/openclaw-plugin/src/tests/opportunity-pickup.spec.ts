import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { _resetForTesting, handleOpportunityPickup } from '../index.js';
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
    pluginConfig: {},
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

const SAMPLE_PAYLOAD = {
  opportunityId: 'opp-abc',
  reservationToken: 'res-token-xyz',
  reservationExpiresAt: '2026-04-16T00:00:00.000Z',
  rendered: {
    headline: 'Great match found',
    personalizedSummary: 'Alice is looking for a TypeScript engineer.',
    suggestedAction: 'Send a connection request to Alice.',
    narratorRemark: 'This looks like a perfect fit.',
  },
};

describe('handleOpportunityPickup', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    _resetForTesting();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    _resetForTesting();
  });

  test('returns false on 204 — no dispatch, no confirm', async () => {
    const fetchCalls: string[] = [];
    global.fetch = mock(async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityPickup(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    // Only the pickup call, no confirm
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain('/opportunities/pickup');
    expect(fake.logger.warn).not.toHaveBeenCalled();
  });

  test('on 200, dispatches delivery with rendered body and headline, then confirms', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      fetchCalls.push({ url: urlStr, init });

      if (urlStr.includes('/opportunities/pickup')) {
        return new Response(JSON.stringify(SAMPLE_PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      // confirm endpoint
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityPickup(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(result).toBe(true);

    // Subagent dispatched once with deliver: true
    expect(fake.subagentCalls).toHaveLength(1);
    const call = fake.subagentCalls[0];
    expect(call.deliver).toBe(true);

    // Message should contain the headline and body content
    expect(call.message).toContain(SAMPLE_PAYLOAD.rendered.headline);
    expect(call.message).toContain(SAMPLE_PAYLOAD.rendered.personalizedSummary);
    expect(call.message).toContain(SAMPLE_PAYLOAD.rendered.suggestedAction);
    expect(call.message).toContain(SAMPLE_PAYLOAD.rendered.narratorRemark);

    // Confirm POST should have been made
    expect(fetchCalls).toHaveLength(2);
    const confirmCall = fetchCalls[1];
    expect(confirmCall.url).toContain(`/opportunities/${SAMPLE_PAYLOAD.opportunityId}/delivered`);
    expect(confirmCall.init?.method).toBe('POST');
  });

  test('on non-2xx error (e.g. 500), logs warn, returns false, no dispatch', async () => {
    global.fetch = mock(async () => {
      return new Response('Internal Server Error', { status: 500 });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    const result = await handleOpportunityPickup(fake.api, BASE_URL, AGENT_ID, API_KEY);

    expect(result).toBe(false);
    expect(fake.subagentCalls).toHaveLength(0);
    expect(fake.logger.warn).toHaveBeenCalled();
    const warnArgs = fake.logger.warn.mock.calls[0] as string[];
    expect(warnArgs[0]).toContain('500');
  });

  test('dispatches with correct sessionKey and idempotencyKey format', async () => {
    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('/opportunities/pickup')) {
        return new Response(JSON.stringify(SAMPLE_PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityPickup(fake.api, BASE_URL, AGENT_ID, API_KEY);

    const call = fake.subagentCalls[0];
    expect(call.sessionKey).toBe(`index:delivery:opportunity:${SAMPLE_PAYLOAD.opportunityId}`);
    expect(call.idempotencyKey).toBe(
      `index:delivery:opportunity:${SAMPLE_PAYLOAD.opportunityId}:${SAMPLE_PAYLOAD.reservationToken}`,
    );
  });

  test('confirm POST includes reservationToken in body', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      fetchCalls.push({ url: urlStr, init });
      if (urlStr.includes('/opportunities/pickup')) {
        return new Response(JSON.stringify(SAMPLE_PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const fake = buildFakeApi();
    await handleOpportunityPickup(fake.api, BASE_URL, AGENT_ID, API_KEY);

    const confirmCall = fetchCalls[1];
    const confirmBody = JSON.parse(confirmCall.init?.body as string);
    expect(confirmBody.reservationToken).toBe(SAMPLE_PAYLOAD.reservationToken);
  });
});
