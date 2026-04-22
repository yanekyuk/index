import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { register, _resetForTesting } from '../index.js';
import type {
  OpenClawPluginApi,
  SubagentRunOptions,
} from '../lib/openclaw/plugin-api.js';

interface FakeApi {
  api: OpenClawPluginApi;
  subagentCalls: SubagentRunOptions[];
  configSetCalls: Array<{ path: string; value: unknown }>;
  logger: { warn: ReturnType<typeof mock>; error: ReturnType<typeof mock>; info: ReturnType<typeof mock>; debug: ReturnType<typeof mock> };
}

function buildFakeApi(
  config: Record<string, unknown>,
  opts?: { mcpServers?: Record<string, unknown> },
): FakeApi {
  const subagentCalls: SubagentRunOptions[] = [];
  const configSetCalls: FakeApi['configSetCalls'] = [];
  const logger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };

  const api: OpenClawPluginApi = {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: config,
    config: {
      mcp: { servers: (opts?.mcpServers || {}) as any },
    },
    runtime: {
      subagent: {
        run: async (o) => {
          subagentCalls.push(o);
          return { runId: 'fake-run-id' };
        },
      },
    },
    logger,
    registerHttpRoute: mock(() => {}),
    registerCli: mock(() => {}),
    configSet: mock(async (path: string, value: unknown) => {
      configSetCalls.push({ path, value });
    }),
  };

  return { api, subagentCalls, configSetCalls, logger };
}

describe('register(api)', () => {
  afterEach(() => {
    _resetForTesting();
  });

  test('logs warning and does not start polling without agentId/apiKey', () => {
    const fake = buildFakeApi({});
    register(fake.api);

    expect(fake.logger.warn).toHaveBeenCalled();
    expect(fake.logger.info).not.toHaveBeenCalled();
  });

  test('logs info and starts polling with agentId and apiKey', () => {
    const fake = buildFakeApi({ agentId: 'agent-1', apiKey: 'key-1' });
    register(fake.api);

    expect(fake.logger.warn).not.toHaveBeenCalled();
    expect(fake.logger.info).toHaveBeenCalled();
  });

  test('prevents duplicate registration', () => {
    const fake = buildFakeApi({ agentId: 'agent-1', apiKey: 'key-1' });
    register(fake.api);
    register(fake.api);

    // info should only be called once for "polling started"
    const infoCalls = fake.logger.info.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('polling started'),
    );
    expect(infoCalls.length).toBe(1);

    // debug should log the duplicate skip
    expect(fake.logger.debug).toHaveBeenCalled();
  });

  test('auto-registers MCP server when not present', () => {
    const fake = buildFakeApi(
      { agentId: 'agent-1', apiKey: 'key-1', protocolUrl: 'https://protocol.index.network' },
      { mcpServers: {} },
    );
    register(fake.api);

    expect(fake.configSetCalls.length).toBe(1);
    expect(fake.configSetCalls[0].path).toBe('mcp.servers.index-network');
    expect(fake.configSetCalls[0].value).toEqual({
      url: 'https://protocol.index.network/mcp',
      transport: 'streamable-http',
      headers: { 'x-api-key': 'key-1' },
    });
  });

  test('skips MCP registration when already correct', () => {
    const fake = buildFakeApi(
      { agentId: 'agent-1', apiKey: 'key-1', protocolUrl: 'https://protocol.index.network' },
      {
        mcpServers: {
          'index-network': {
            url: 'https://protocol.index.network/mcp',
            transport: 'streamable-http',
            headers: { 'x-api-key': 'key-1' },
          },
        },
      },
    );
    register(fake.api);

    expect(fake.configSetCalls.length).toBe(0);
  });

  test('updates MCP server when apiKey changes', () => {
    const fake = buildFakeApi(
      { agentId: 'agent-1', apiKey: 'new-key', protocolUrl: 'https://protocol.index.network' },
      {
        mcpServers: {
          'index-network': {
            url: 'https://protocol.index.network/mcp',
            transport: 'streamable-http',
            headers: { 'x-api-key': 'old-key' },
          },
        },
      },
    );
    register(fake.api);

    expect(fake.configSetCalls.length).toBe(1);
    expect((fake.configSetCalls[0].value as any).headers['x-api-key']).toBe('new-key');
  });

  test('uses default protocolUrl https://protocol.index.network when not set', () => {
    const fake = buildFakeApi(
      { agentId: 'agent-1', apiKey: 'key-1' },
      { mcpServers: {} },
    );
    register(fake.api);

    expect(fake.configSetCalls.length).toBe(1);
    expect((fake.configSetCalls[0].value as any).url).toBe('https://protocol.index.network/mcp');
  });

  test('warns user to run openclaw index-network setup when not configured', () => {
    const fake = buildFakeApi({});
    register(fake.api);

    const warnMsg = fake.logger.warn.mock.calls[0]?.[0];
    expect(warnMsg).toContain('openclaw index-network setup');
  });
});
