import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it } from 'bun:test';
import { mock } from 'bun:test';

const mockAdd = mock(async () => ({ id: 'job-1', name: 'deliver_webhook', data: {} }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd }),
    createWorker: mockCreateWorker,
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

import { buildWebhookRequestHeaders } from '../webhook.queue';

describe('buildWebhookRequestHeaders', () => {
  it('includes signature, event, and delivery-id headers', () => {
    const headers = buildWebhookRequestHeaders({
      signatureHex: 'abc123',
      event: 'opportunity.created',
      deliveryId: 'webhook-opp-created-hook-1-opp-42',
    });
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Index-Signature']).toBe('sha256=abc123');
    expect(headers['X-Index-Event']).toBe('opportunity.created');
    expect(headers['X-Request-ID']).toBe('webhook-opp-created-hook-1-opp-42');
  });

  it('preserves the sha256= prefix exactly (no double-prefix)', () => {
    const headers = buildWebhookRequestHeaders({
      signatureHex: 'deadbeef',
      event: 'negotiation.turn_received',
      deliveryId: 'negotiation-turn:neg-1:3:hook-1',
    });
    expect(headers['X-Index-Signature']).toBe('sha256=deadbeef');
    expect(headers['X-Request-ID']).toBe('negotiation-turn:neg-1:3:hook-1');
  });
});
