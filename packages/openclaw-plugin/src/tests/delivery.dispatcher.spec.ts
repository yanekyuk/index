import { describe, expect, mock, test } from 'bun:test';

import { dispatchDelivery } from '../delivery.dispatcher.js';
import type { OpenClawPluginApi, SubagentRunResult } from '../plugin-api.js';

function makeApi(runResult: SubagentRunResult): OpenClawPluginApi {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    pluginConfig: {},
    runtime: {
      subagent: {
        run: mock(() => Promise.resolve(runResult)),
      },
    },
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
    registerHttpRoute: mock(() => {}),
  } as OpenClawPluginApi;
}

describe('dispatchDelivery', () => {
  test('calls subagent.run with deliver: true, sessionKey, idempotencyKey, and a message containing headline + body', async () => {
    const runResult: SubagentRunResult = { runId: 'run-abc-123' };
    const api = makeApi(runResult);

    const request = {
      rendered: { headline: 'New match found', body: 'Alice is looking for a TypeScript engineer.' },
      sessionKey: 'session-xyz',
      idempotencyKey: 'idem-001',
    };

    const result = await dispatchDelivery(api, request);

    expect(result).toEqual(runResult);
    expect(api.runtime.subagent.run).toHaveBeenCalledTimes(1);

    const callArgs = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(callArgs.sessionKey).toBe('session-xyz');
    expect(callArgs.idempotencyKey).toBe('idem-001');
    expect(callArgs.deliver).toBe(true);
    expect(callArgs.message).toContain('New match found');
    expect(callArgs.message).toContain('Alice is looking for a TypeScript engineer.');
  });

  test('the prompt interpolates both headline and body', async () => {
    const api = makeApi({ runId: 'run-999' });

    const request = {
      rendered: {
        headline: 'Opportunity Update',
        body: 'Bob wants to connect about the seed round.',
      },
      sessionKey: 'session-abc',
      idempotencyKey: 'idem-002',
    };

    await dispatchDelivery(api, request);

    const callArgs = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(callArgs.message).toContain('# Opportunity Update');
    expect(callArgs.message).toContain('Bob wants to connect about the seed round.');
  });
});
