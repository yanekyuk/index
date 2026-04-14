import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import register, { _resetForTesting } from '../index.js';
import type {
  OpenClawPluginApi,
  SubagentRunOptions,
} from '../plugin-api.js';

interface FakeApi {
  api: OpenClawPluginApi;
  subagentCalls: SubagentRunOptions[];
  logger: { warn: ReturnType<typeof mock>; error: ReturnType<typeof mock>; info: ReturnType<typeof mock>; debug: ReturnType<typeof mock> };
}

function buildFakeApi(config: Record<string, unknown>): FakeApi {
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
    pluginConfig: config,
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
});
