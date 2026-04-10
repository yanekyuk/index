import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';

import { verifyAndParse } from '../webhook/verify.js';
import { mockRequest } from './helpers/mock-http.js';

const SECRET = 'test-secret-abcdefghijklmnopqrstuvwx';

function signBody(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function buildSignedRequest(event: string, payload: Record<string, unknown>, secret: string) {
  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  return mockRequest({
    headers: {
      'x-index-signature': signBody(body, secret),
      'x-index-event': event,
      'content-type': 'application/json',
    },
    body,
  });
}

describe('verifyAndParse', () => {
  test('returns parsed payload on valid signature and matching event', async () => {
    const req = buildSignedRequest('negotiation.turn_received', { negotiationId: 'neg-1', turnNumber: 1 }, SECRET);
    const result = await verifyAndParse<{ negotiationId: string; turnNumber: number }>(
      req,
      SECRET,
      'negotiation.turn_received',
    );
    expect(result).toEqual({ negotiationId: 'neg-1', turnNumber: 1 });
  });

  test('returns null on signature mismatch', async () => {
    const req = buildSignedRequest('negotiation.turn_received', { negotiationId: 'neg-1' }, 'wrong-secret');
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('returns null on missing signature header', async () => {
    const body = JSON.stringify({ event: 'negotiation.turn_received', payload: {}, timestamp: '' });
    const req = mockRequest({
      headers: { 'x-index-event': 'negotiation.turn_received' },
      body,
    });
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('returns null on missing event header', async () => {
    const body = JSON.stringify({ event: 'negotiation.turn_received', payload: {}, timestamp: '' });
    const req = mockRequest({
      headers: { 'x-index-signature': signBody(body, SECRET) },
      body,
    });
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('returns null when event header does not match expected', async () => {
    const req = buildSignedRequest('negotiation.completed', { negotiationId: 'neg-1' }, SECRET);
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('returns null on malformed JSON body', async () => {
    const body = 'not-json';
    const req = mockRequest({
      headers: {
        'x-index-signature': signBody(body, SECRET),
        'x-index-event': 'negotiation.turn_received',
      },
      body,
    });
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('returns null when secret is empty', async () => {
    const req = buildSignedRequest('negotiation.turn_received', {}, '');
    const result = await verifyAndParse(req, '', 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('returns null when wrapper is missing payload field', async () => {
    const body = JSON.stringify({ event: 'negotiation.turn_received', timestamp: '' });
    const req = mockRequest({
      headers: {
        'x-index-signature': signBody(body, SECRET),
        'x-index-event': 'negotiation.turn_received',
      },
      body,
    });
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });

  test('uses timing-safe comparison (does not throw on length mismatch)', async () => {
    const body = JSON.stringify({ event: 'negotiation.turn_received', payload: {}, timestamp: '' });
    const req = mockRequest({
      headers: {
        'x-index-signature': 'sha256=short',
        'x-index-event': 'negotiation.turn_received',
      },
      body,
    });
    const result = await verifyAndParse(req, SECRET, 'negotiation.turn_received');
    expect(result).toBeNull();
  });
});
