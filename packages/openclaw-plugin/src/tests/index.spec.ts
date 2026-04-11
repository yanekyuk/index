import { beforeEach, describe, expect, mock, test } from 'bun:test';
import crypto from 'node:crypto';
import type { ServerResponse } from 'node:http';

import register from '../index.js';
import type {
  OpenClawPluginApi,
  RouteHandler,
  RouteOptions,
  SubagentRunOptions,
} from '../plugin-api.js';

import { mockRequest } from './helpers/mock-http.js';

const SECRET = 'unit-test-secret-abcdefghijklmnop';

interface FakeApi {
  api: OpenClawPluginApi;
  registered: Map<string, RouteOptions>;
  subagentCalls: SubagentRunOptions[];
  logger: { warn: ReturnType<typeof mock>; error: ReturnType<typeof mock>; info: ReturnType<typeof mock>; debug: ReturnType<typeof mock> };
}

function buildFakeApi(config: Record<string, unknown>): FakeApi {
  const registered = new Map<string, RouteOptions>();
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
    registerHttpRoute: (opts) => {
      registered.set(opts.path, opts);
    },
  };

  return { api, registered, subagentCalls, logger };
}

function fakeResponse(): ServerResponse & { _status: number; _body: string } {
  const res = {
    statusCode: 0,
    _status: 0,
    _body: '',
    end(body?: string) {
      this._status = this.statusCode;
      this._body = body ?? '';
      return this as unknown as ServerResponse;
    },
  };
  return res as unknown as ServerResponse & { _status: number; _body: string };
}

function signBody(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function signedRequest(event: string, payload: Record<string, unknown>, secret: string) {
  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  return mockRequest({
    headers: {
      'x-index-signature': signBody(body, secret),
      'x-index-event': event,
    },
    body,
  });
}

async function callHandler(handler: RouteHandler, req: ReturnType<typeof signedRequest>) {
  const res = fakeResponse();
  await handler(req, res);
  return res;
}

const WEBHOOK_PATH = '/index-network/webhook';

function getHandler(fake: FakeApi): RouteHandler {
  const route = fake.registered.get(WEBHOOK_PATH);
  if (!route) throw new Error(`route ${WEBHOOK_PATH} not registered`);
  return route.handler;
}

describe('register(api)', () => {
  let fake: FakeApi;

  beforeEach(() => {
    fake = buildFakeApi({ webhookSecret: SECRET });
    register(fake.api);
  });

  test('registers exactly one HTTP route at /index-network/webhook', () => {
    expect(fake.registered.size).toBe(1);
    expect(fake.registered.has(WEBHOOK_PATH)).toBe(true);
  });

  test('registered route declares auth: plugin and match: exact', () => {
    const opts = fake.registered.get(WEBHOOK_PATH)!;
    expect(opts.auth).toBe('plugin');
    expect(opts.match).toBe('exact');
  });

  describe('negotiation.turn_received dispatch', () => {
    test('launches silent subagent on valid turn_received delivery', async () => {
      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.turn_received',
        {
          negotiationId: 'neg-1',
          turnNumber: 1,
          counterpartyAction: 'propose',
          counterpartyMessage: null,
          deadline: '2026-04-12T00:00:00.000Z',
        },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(1);
      expect(fake.subagentCalls[0].deliver).toBe(false);
      expect(fake.subagentCalls[0].sessionKey).toBe('index:negotiation:neg-1');
      expect(fake.subagentCalls[0].message).toContain('negotiationId="neg-1"');
    });

    test('returns 401 on bad signature and does not run subagent', async () => {
      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.turn_received',
        { negotiationId: 'neg-1', turnNumber: 1, counterpartyAction: 'propose', deadline: '' },
        'wrong-secret',
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(401);
      expect(fake.subagentCalls).toHaveLength(0);
    });
  });

  describe('negotiation.completed dispatch', () => {
    test('runs delivered subagent when outcome.hasOpportunity is true', async () => {
      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.completed',
        {
          negotiationId: 'neg-1',
          turnCount: 3,
          outcome: { hasOpportunity: true, reasoning: 'strong fit' },
        },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(1);
      expect(fake.subagentCalls[0].deliver).toBe(true);
      expect(fake.subagentCalls[0].sessionKey).toBe('index:event:neg-1');
      expect(fake.subagentCalls[0].message).toContain('connected with');
    });

    test('does NOT run subagent when outcome.hasOpportunity is false', async () => {
      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.completed',
        {
          negotiationId: 'neg-1',
          turnCount: 5,
          outcome: { hasOpportunity: false, reason: 'turn_cap' },
        },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(0);
    });

    test('does NOT run subagent when outcome is missing', async () => {
      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.completed',
        { negotiationId: 'neg-1', turnCount: 5 },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(0);
    });

    test('returns 401 on bad signature', async () => {
      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.completed',
        { negotiationId: 'neg-1', outcome: { hasOpportunity: true }, turnCount: 1 },
        'wrong',
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(401);
      expect(fake.subagentCalls).toHaveLength(0);
    });
  });

  describe('unknown event header', () => {
    test('returns 400 without invoking the subagent', async () => {
      const handler = getHandler(fake);
      const req = signedRequest('negotiation.unknown', { negotiationId: 'neg-1' }, SECRET);

      const res = await callHandler(handler, req);

      expect(res._status).toBe(400);
      expect(fake.subagentCalls).toHaveLength(0);
    });

    test('returns 400 when X-Index-Event header is missing', async () => {
      const handler = getHandler(fake);
      const body = JSON.stringify({
        event: 'negotiation.turn_received',
        payload: {},
        timestamp: '',
      });
      const req = mockRequest({
        headers: {
          'x-index-signature': 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex'),
        },
        body,
      });

      const res = await callHandler(handler, req);

      expect(res._status).toBe(400);
      expect(fake.subagentCalls).toHaveLength(0);
    });
  });

  describe('with missing webhookSecret', () => {
    test('logs a warning and rejects all requests', async () => {
      fake = buildFakeApi({});
      register(fake.api);

      expect(fake.logger.warn).toHaveBeenCalled();

      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.turn_received',
        { negotiationId: 'neg-1', turnNumber: 1, counterpartyAction: 'propose', deadline: '' },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(401);
      expect(fake.subagentCalls).toHaveLength(0);
    });

    test('accepts requests after webhookSecret is set post-registration', async () => {
      fake = buildFakeApi({});
      register(fake.api);

      (fake.api.pluginConfig as Record<string, unknown>).webhookSecret = SECRET;

      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.turn_received',
        {
          negotiationId: 'neg-1',
          turnNumber: 1,
          counterpartyAction: 'propose',
          counterpartyMessage: null,
          deadline: '2026-04-12T00:00:00.000Z',
        },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(1);
    });
  });

  describe('webhookSecret rotation without reload', () => {
    test('handler picks up the rotated secret on the next request', async () => {
      fake = buildFakeApi({ webhookSecret: 'first-secret-aaaaaaaaaaaaaaaa' });
      register(fake.api);
      const handler = getHandler(fake);

      const firstReq = signedRequest(
        'negotiation.turn_received',
        {
          negotiationId: 'neg-1',
          turnNumber: 1,
          counterpartyAction: 'propose',
          counterpartyMessage: null,
          deadline: '2026-04-12T00:00:00.000Z',
        },
        'first-secret-aaaaaaaaaaaaaaaa',
      );
      expect((await callHandler(handler, firstReq))._status).toBe(202);

      (fake.api.pluginConfig as Record<string, unknown>).webhookSecret =
        'second-secret-bbbbbbbbbbbbbbbb';

      const rotatedReq = signedRequest(
        'negotiation.turn_received',
        {
          negotiationId: 'neg-2',
          turnNumber: 1,
          counterpartyAction: 'propose',
          counterpartyMessage: null,
          deadline: '2026-04-12T00:00:00.000Z',
        },
        'second-secret-bbbbbbbbbbbbbbbb',
      );
      expect((await callHandler(handler, rotatedReq))._status).toBe(202);

      const staleReq = signedRequest(
        'negotiation.turn_received',
        {
          negotiationId: 'neg-3',
          turnNumber: 1,
          counterpartyAction: 'propose',
          counterpartyMessage: null,
          deadline: '2026-04-12T00:00:00.000Z',
        },
        'first-secret-aaaaaaaaaaaaaaaa',
      );
      expect((await callHandler(handler, staleReq))._status).toBe(401);
    });

    test('negotiationMode rotation without reload is honored on next request', async () => {
      fake = buildFakeApi({
        webhookSecret: SECRET,
        negotiationMode: 'enabled',
      });
      register(fake.api);
      const handler = getHandler(fake);

      const enabledReq = signedRequest(
        'negotiation.turn_received',
        {
          negotiationId: 'neg-1',
          turnNumber: 1,
          counterpartyAction: 'propose',
          counterpartyMessage: null,
          deadline: '2026-04-12T00:00:00.000Z',
        },
        SECRET,
      );
      expect((await callHandler(handler, enabledReq))._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(1);

      (fake.api.pluginConfig as Record<string, unknown>).negotiationMode = 'disabled';

      const disabledReq = signedRequest(
        'negotiation.turn_received',
        {
          negotiationId: 'neg-2',
          turnNumber: 1,
          counterpartyAction: 'propose',
          counterpartyMessage: null,
          deadline: '2026-04-12T00:00:00.000Z',
        },
        SECRET,
      );
      expect((await callHandler(handler, disabledReq))._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(1);
    });
  });

  describe('with negotiationMode: disabled', () => {
    test('turn webhook returns 202 without running subagent', async () => {
      fake = buildFakeApi({ webhookSecret: SECRET, negotiationMode: 'disabled' });
      register(fake.api);

      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.turn_received',
        {
          negotiationId: 'neg-1',
          turnNumber: 1,
          counterpartyAction: 'propose',
          counterpartyMessage: null,
          deadline: '2026-04-12T00:00:00.000Z',
        },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(0);
    });

    test('completed webhook still posts accepted notification', async () => {
      fake = buildFakeApi({ webhookSecret: SECRET, negotiationMode: 'disabled' });
      register(fake.api);

      const handler = getHandler(fake);
      const req = signedRequest(
        'negotiation.completed',
        {
          negotiationId: 'neg-1',
          turnCount: 3,
          outcome: { hasOpportunity: true, reasoning: 'strong fit' },
        },
        SECRET,
      );

      const res = await callHandler(handler, req);

      expect(res._status).toBe(202);
      expect(fake.subagentCalls).toHaveLength(1);
    });
  });
});
