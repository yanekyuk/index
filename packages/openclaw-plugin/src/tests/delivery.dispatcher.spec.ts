import { describe, expect, mock, test } from 'bun:test';

import { dispatchDelivery } from '../lib/delivery/delivery.dispatcher.js';
import type { OpenClawPluginApi, SubagentRunResult } from '../lib/openclaw/plugin-api.js';

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
        waitForRun: mock(() => Promise.resolve({ result: null })),
        getSessionMessages: mock(() => Promise.resolve({ messages: [] })),
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
  test('calls subagent.run with deliver:true and correct sessionKey', async () => {
    const api = makeApi({ runId: 'run-abc-123' });

    const result = await dispatchDelivery(api, {
      contentType: 'ambient_discovery',
      content: 'Alice is looking for a TypeScript engineer.',
      idempotencyKey: 'idem-001',
    });

    expect(result).toEqual({ runId: 'run-abc-123' });
    expect(api.runtime.subagent.run).toHaveBeenCalledTimes(1);

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.sessionKey).toBe('agent:main:telegram:direct:69340471');
    expect(call.idempotencyKey).toBe('idem-001');
    expect(call.deliver).toBe(true);
    expect(call.message).toContain('Alice is looking for a TypeScript engineer.');
  });

  test('prompt includes channel style block', async () => {
    const api = makeApi({ runId: 'run-channel' });

    await dispatchDelivery(api, {
      contentType: 'test_message',
      content: 'Hello world',
      idempotencyKey: 'idem-channel',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.message).toContain('Telegram');
    expect(call.message).toContain('Hello world');
  });

  test('prompt includes content-type context for daily_digest', async () => {
    const api = makeApi({ runId: 'run-ct-digest' });

    await dispatchDelivery(api, {
      contentType: 'daily_digest',
      content: 'Three opportunities today.',
      idempotencyKey: 'idem-digest',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.message).toContain('Daily digest');
    expect(call.message).toContain('Three opportunities today.');
  });

  test('prompt includes content-type context for ambient_discovery', async () => {
    const api = makeApi({ runId: 'run-ct-ambient' });

    await dispatchDelivery(api, {
      contentType: 'ambient_discovery',
      content: 'New match found.',
      idempotencyKey: 'idem-ambient',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.message).toContain('Real-time opportunity alert');
    expect(call.message).toContain('New match found.');
  });

  test('prompt includes URL embedding rules for semantic link placement', async () => {
    const api = makeApi({ runId: 'run-url-embed' });

    await dispatchDelivery(api, {
      contentType: 'ambient_discovery',
      content: '---\nopportunityId: opp-1\nname: Alice\nprofileUrl: https://dev.index.network/u/abc123\n---',
      idempotencyKey: 'idem-url-embed',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.message).toContain('URL embedding rules');
    expect(call.message).toContain('Link the person\'s name to their profileUrl');
    expect(call.message).toContain('Do NOT add separate link sections');
  });

  test('passes model string from configGet to subagent', async () => {
    const api = makeApi({ runId: 'run-model-1' }, undefined, 'anthropic/claude-sonnet-4-6');

    await dispatchDelivery(api, {
      contentType: 'test_message',
      content: 'hi',
      idempotencyKey: 'idem-model-1',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.model).toBe('anthropic/claude-sonnet-4-6');
  });

  test('passes primary from configGet object to subagent', async () => {
    const api = makeApi({ runId: 'run-model-2' }, undefined, { primary: 'anthropic/claude-opus-4-6' });

    await dispatchDelivery(api, {
      contentType: 'test_message',
      content: 'hi',
      idempotencyKey: 'idem-model-2',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.model).toBe('anthropic/claude-opus-4-6');
  });

  test('passes undefined model when configGet is absent', async () => {
    const api = makeApi({ runId: 'run-model-3' });

    await dispatchDelivery(api, {
      contentType: 'test_message',
      content: 'hi',
      idempotencyKey: 'idem-model-3',
    });

    const call = (api.runtime.subagent.run as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.model).toBeUndefined();
  });

  test('returns null and skips subagent.run when deliveryChannel is missing', async () => {
    const api = makeApi({ runId: 'unused' }, { deliveryTarget: '123' });

    const result = await dispatchDelivery(api, {
      contentType: 'test_message',
      content: 'hi',
      idempotencyKey: 'idem-003',
    });

    expect(result).toBeNull();
    expect(api.runtime.subagent.run).not.toHaveBeenCalled();
    expect(api.logger.warn).toHaveBeenCalled();
  });

  test('returns null and skips subagent.run when deliveryTarget is missing', async () => {
    const api = makeApi({ runId: 'unused' }, { deliveryChannel: 'telegram' });

    const result = await dispatchDelivery(api, {
      contentType: 'test_message',
      content: 'hi',
      idempotencyKey: 'idem-004',
    });

    expect(result).toBeNull();
    expect(api.runtime.subagent.run).not.toHaveBeenCalled();
    expect(api.logger.warn).toHaveBeenCalled();
  });
});
