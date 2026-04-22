import { describe, expect, mock, test } from 'bun:test';

import { dispatchDelivery } from '../delivery.dispatcher.js';
import type { OpenClawPluginApi, SubagentRunResult } from '../plugin-api.js';

function makeApi(
  runResult: SubagentRunResult,
  pluginConfig: Record<string, unknown> = { deliveryChannel: 'telegram', deliveryTarget: '69340471' },
  configGetModel?: unknown,
): OpenClawPluginApi {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    pluginConfig,
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
    ...(configGetModel !== undefined && {
      configGet: async () => configGetModel,
    }),
  } as OpenClawPluginApi;
}

describe('dispatchDelivery', () => {
  test('builds session key from pluginConfig and calls subagent.run with deliver: true', async () => {
    const runResult: SubagentRunResult = { runId: 'run-abc-123' };
    const api = makeApi(runResult);

    const request = {
      rendered: { headline: 'New match found', body: 'Alice is looking for a TypeScript engineer.' },
      idempotencyKey: 'idem-001',
    };

    const result = await dispatchDelivery(api, request);

    expect(result).toEqual(runResult);
    expect(api.runtime.subagent.run).toHaveBeenCalledTimes(1);

    const callArgs = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(callArgs.sessionKey).toBe('agent:main:telegram:direct:69340471');
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
      idempotencyKey: 'idem-002',
    };

    await dispatchDelivery(api, request);

    const callArgs = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(callArgs.message).toContain('# Opportunity Update');
    expect(callArgs.message).toContain('Bob wants to connect about the seed round.');
  });

  test('passes model string from configGet to subagent', async () => {
    const api = makeApi({ runId: 'run-model-1' }, undefined, 'anthropic/claude-sonnet-4-6');

    await dispatchDelivery(api, {
      rendered: { headline: 'h', body: 'b' },
      idempotencyKey: 'idem-model-1',
    });

    const callArgs = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(callArgs.model).toBe('anthropic/claude-sonnet-4-6');
  });

  test('passes primary from configGet object to subagent', async () => {
    const api = makeApi({ runId: 'run-model-2' }, undefined, { primary: 'anthropic/claude-opus-4-6' });

    await dispatchDelivery(api, {
      rendered: { headline: 'h', body: 'b' },
      idempotencyKey: 'idem-model-2',
    });

    const callArgs = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(callArgs.model).toBe('anthropic/claude-opus-4-6');
  });

  test('passes undefined model when configGet is absent', async () => {
    const api = makeApi({ runId: 'run-model-3' });

    await dispatchDelivery(api, {
      rendered: { headline: 'h', body: 'b' },
      idempotencyKey: 'idem-model-3',
    });

    const callArgs = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(callArgs.model).toBeUndefined();
  });

  test('returns null and skips subagent.run when deliveryChannel is missing', async () => {
    const api = makeApi({ runId: 'unused' }, { deliveryTarget: '123' });

    const result = await dispatchDelivery(api, {
      rendered: { headline: 'h', body: 'b' },
      idempotencyKey: 'idem-003',
    });

    expect(result).toBeNull();
    expect(api.runtime.subagent.run).not.toHaveBeenCalled();
    expect(api.logger.warn).toHaveBeenCalled();
  });

  test('returns null and skips subagent.run when deliveryTarget is missing', async () => {
    const api = makeApi({ runId: 'unused' }, { deliveryChannel: 'telegram' });

    const result = await dispatchDelivery(api, {
      rendered: { headline: 'h', body: 'b' },
      idempotencyKey: 'idem-004',
    });

    expect(result).toBeNull();
    expect(api.runtime.subagent.run).not.toHaveBeenCalled();
    expect(api.logger.warn).toHaveBeenCalled();
  });
});
