import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handleDailyDigest, _resetForTesting } from '../index.js';
import type { OpenClawPluginApi } from '../plugin-api.js';

describe('handleDailyDigest', () => {
  let mockApi: OpenClawPluginApi;
  let subagentRunCalls: Array<{ message: string; idempotencyKey: string }>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    _resetForTesting();
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
            subagentRunCalls.push({ message: opts.message, idempotencyKey: opts.idempotencyKey });
            return { runId: 'test-run-id' };
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
    _resetForTesting();
  });

  it('dispatches digest with top N prompt when opportunities exist', async () => {
    const mockResponse = {
      opportunities: [
        {
          opportunityId: 'opp-1',
          rendered: {
            headline: 'Headline 1',
            personalizedSummary: 'Summary 1',
            suggestedAction: 'Action 1',
            narratorRemark: '',
          },
        },
        {
          opportunityId: 'opp-2',
          rendered: {
            headline: 'Headline 2',
            personalizedSummary: 'Summary 2',
            suggestedAction: 'Action 2',
            narratorRemark: '',
          },
        },
      ],
    };

    global.fetch = mock(async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await handleDailyDigest(
      mockApi,
      'https://test.example.com',
      'agent-123',
      'api-key-123',
      5,
    );

    expect(result).toBe(true);
    expect(subagentRunCalls).toHaveLength(1);
    expect(subagentRunCalls[0].message).toContain('daily digest');
    expect(subagentRunCalls[0].message).toContain('top 2'); // min(5, 2 available)
    expect(subagentRunCalls[0].message).toContain('opp-1');
    expect(subagentRunCalls[0].message).toContain('opp-2');
    expect(subagentRunCalls[0].idempotencyKey).toContain('daily-digest');
    expect(subagentRunCalls[0].idempotencyKey).toMatch(/\d{4}-\d{2}-\d{2}/); // date included
  });

  it('returns false when no opportunities pending', async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ opportunities: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await handleDailyDigest(
      mockApi,
      'https://test.example.com',
      'agent-123',
      'api-key-123',
    );

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(0);
  });

  it('returns false when delivery routing not configured', async () => {
    mockApi.pluginConfig = {}; // No deliveryChannel/deliveryTarget

    const mockResponse = {
      opportunities: [
        {
          opportunityId: 'opp-1',
          rendered: {
            headline: 'H',
            personalizedSummary: 'S',
            suggestedAction: 'A',
            narratorRemark: '',
          },
        },
      ],
    };

    global.fetch = mock(async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await handleDailyDigest(
      mockApi,
      'https://test.example.com',
      'agent-123',
      'api-key-123',
    );

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(0);
  });

  it('returns false on fetch network error', async () => {
    global.fetch = mock(async () => {
      throw new Error('Network error');
    }) as unknown as typeof fetch;

    const result = await handleDailyDigest(
      mockApi,
      'https://test.example.com',
      'agent-123',
      'api-key-123',
    );

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(0);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });

  it('returns false on non-200 response', async () => {
    global.fetch = mock(async () =>
      new Response('Internal Server Error', { status: 500 }),
    ) as unknown as typeof fetch;

    const result = await handleDailyDigest(
      mockApi,
      'https://test.example.com',
      'agent-123',
      'api-key-123',
    );

    expect(result).toBe(false);
    expect(subagentRunCalls).toHaveLength(0);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });

  it('returns false when subagent dispatch throws', async () => {
    const mockResponse = {
      opportunities: [
        {
          opportunityId: 'opp-1',
          rendered: {
            headline: 'H',
            personalizedSummary: 'S',
            suggestedAction: 'A',
            narratorRemark: '',
          },
        },
      ],
    };

    global.fetch = mock(async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    ) as unknown as typeof fetch;

    mockApi.runtime.subagent.run = mock(async () => {
      throw new Error('Subagent runtime error');
    });

    const result = await handleDailyDigest(
      mockApi,
      'https://test.example.com',
      'agent-123',
      'api-key-123',
    );

    expect(result).toBe(false);
    expect(mockApi.logger.warn).toHaveBeenCalled();
  });
});
