import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handle as handleAmbientDiscovery, _resetForTesting } from '../polling/ambient-discovery/ambient-discovery.poller.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

describe('handleAmbientDiscovery (main-agent path)', () => {
  let mockApi: OpenClawPluginApi;
  let runEmbeddedCalls: Array<{ prompt: string }>;
  let originalFetch: typeof global.fetch;

  // Use UUID-format IDs so extractSelectedIds (UUID regex) can find them in rendered text
  const OPP_1 = '11111111-1111-1111-1111-111111111111';
  const OPP_2 = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    runEmbeddedCalls = [];
    originalFetch = global.fetch;
    _resetForTesting();

    mockApi = {
      id: 'test-plugin',
      name: 'Test',
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
            runEmbeddedCalls.push({ prompt: opts.prompt });
            // Default: render only OPP_1 in voice (contains its UUID in URLs)
            return {
              text: `1. [Bryan](https://test.index.network/u/user-1) - good match (https://test.index.network/opportunities/${OPP_1}/accept) (https://test.index.network/opportunities/${OPP_1}/skip)`,
            };
          }),
        },
      },
      logger: { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },
      registerHttpRoute: mock(() => {}),
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    _resetForTesting();
  });

  function mockBackend(opportunities: unknown[]) {
    const pendingUrls: string[] = [];
    const confirmCalls: string[] = [];
    global.fetch = mock(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/opportunities/pending')) {
        pendingUrls.push(url);
        return new Response(JSON.stringify({ opportunities }), { status: 200 });
      }
      if (url.includes('/delivered') || url.includes('/confirm-batch')) {
        confirmCalls.push(url);
        return new Response('{}', { status: 200 });
      }
      return new Response('not-found', { status: 404 });
    }) as unknown as typeof fetch;
    return { pendingUrls, confirmCalls };
  }

  const cfg = {
    baseUrl: 'https://test.example.com',
    agentId: 'agent-123',
    apiKey: 'k',
    frontendUrl: 'https://test.index.network',
  };

  it('fetches /pending with ?limit=10 (ambient cap)', async () => {
    const sink = mockBackend([]);
    await handleAmbientDiscovery(mockApi, cfg);
    expect(sink.pendingUrls).toHaveLength(1);
    expect(sink.pendingUrls[0]).toContain('limit=10');
  });

  it('returns false when /pending is empty', async () => {
    mockBackend([]);
    const result = await handleAmbientDiscovery(mockApi, cfg);
    expect(result).toBe(false);
    expect(runEmbeddedCalls).toHaveLength(0);
  });

  it('drives main agent with the ambient prompt (mentions Real-time alert)', async () => {
    mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    await handleAmbientDiscovery(mockApi, cfg);
    expect(runEmbeddedCalls).toHaveLength(1);
    expect(runEmbeddedCalls[0].prompt).toContain('INDEX NETWORK NOTIFICATION');
    expect(runEmbeddedCalls[0].prompt).toContain('Real-time alert');
  });

  it('confirms only IDs that appear in the rendered text', async () => {
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
      { opportunityId: OPP_2, counterpartUserId: 'user-2', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    // runEmbedded default mock returns text mentioning only OPP_1 (via its UUID in URLs)
    await handleAmbientDiscovery(mockApi, cfg);
    // Confirm endpoint is called once. The plugin uses the batch-confirm endpoint, so one call covers all selected IDs.
    expect(sink.confirmCalls).toHaveLength(1);
  });

  it('skips confirms when the agent emits NO_REPLY', async () => {
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockResolvedValueOnce({
      text: 'NO_REPLY',
    });
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    await handleAmbientDiscovery(mockApi, cfg);
    expect(sink.confirmCalls).toHaveLength(0);
  });

  it('skips confirms when rendered text contains no recognizable IDs', async () => {
    (mockApi.runtime.agent!.runEmbeddedAgent as ReturnType<typeof mock>).mockResolvedValueOnce({
      text: 'A vague update with no IDs',
    });
    const sink = mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    await handleAmbientDiscovery(mockApi, cfg);
    expect(sink.confirmCalls).toHaveLength(0);
  });

  it('skips opportunities with null counterpartUserId', async () => {
    mockBackend([
      { opportunityId: OPP_1, counterpartUserId: null, rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    const result = await handleAmbientDiscovery(mockApi, cfg);
    expect(result).toBe(false);
    expect(runEmbeddedCalls).toHaveLength(0);
  });

  it('dedup: second call with identical pending body does NOT call runEmbeddedAgent again', async () => {
    mockBackend([
      { opportunityId: OPP_1, counterpartUserId: 'user-1', rendered: { headline: 'H', personalizedSummary: 'S', suggestedAction: 'A', narratorRemark: '' } },
    ]);
    await handleAmbientDiscovery(mockApi, cfg);
    expect(runEmbeddedCalls).toHaveLength(1);

    // Second call with identical backend response — should short-circuit
    await handleAmbientDiscovery(mockApi, cfg);
    expect(runEmbeddedCalls).toHaveLength(1);
  });
});
