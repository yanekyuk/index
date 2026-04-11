import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentDispatcherImpl } from '../agent-dispatcher.service';
import type { AgentWithRelations } from '../../adapters/agent.database.adapter';

function makeAgent(overrides: Partial<AgentWithRelations> = {}): AgentWithRelations {
  return {
    id: 'agent-1',
    ownerId: 'user-1',
    name: 'Test Agent',
    description: null,
    type: 'personal',
    status: 'active',
    metadata: {},
    transports: [],
    permissions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AgentWithRelations;
}

function makeWebhookTransport(events: string[], active = true) {
  return {
    id: `t-${Math.random()}`,
    agentId: 'agent-1',
    channel: 'webhook' as const,
    config: { url: 'https://example.com/hook', secret: 's', events },
    priority: 0,
    active,
    failureCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const payload = {
  negotiationId: 'n-1',
  history: [],
  seedAssessment: { verdict: 'pending' },
  users: { a: {}, b: {} },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const scope = { action: 'manage:negotiations', scopeType: 'negotiation' as const };

describe('AgentDispatcherImpl.dispatch', () => {
  let enqueuedCalls: number;
  let agents: AgentWithRelations[];
  let dispatcher: AgentDispatcherImpl;

  beforeEach(() => {
    enqueuedCalls = 0;
    agents = [];
    dispatcher = new AgentDispatcherImpl(
      { findAuthorizedAgents: async () => agents },
      { enqueueDeliveries: async () => { enqueuedCalls++; } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { enqueueTimeout: async () => {} } as any,
    );
  });

  it('returns no_agent when personal agent has no webhook transport', async () => {
    agents = [makeAgent({ transports: [] })];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(res).toEqual({ handled: false, reason: 'no_agent' });
    expect(enqueuedCalls).toBe(0);
  });

  it('returns no_agent when webhook transport is subscribed to wrong event', async () => {
    agents = [makeAgent({ transports: [makeWebhookTransport(['opportunity.created'])] })];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(res).toEqual({ handled: false, reason: 'no_agent' });
    expect(enqueuedCalls).toBe(0);
  });

  it('returns no_agent when webhook transport is inactive', async () => {
    agents = [makeAgent({ transports: [makeWebhookTransport(['negotiation.turn_received'], false)] })];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(res).toEqual({ handled: false, reason: 'no_agent' });
    expect(enqueuedCalls).toBe(0);
  });

  it('enqueues delivery and returns waiting when a matching active transport exists', async () => {
    agents = [makeAgent({ transports: [makeWebhookTransport(['negotiation.turn_received'])] })];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(res.reason).toBe('waiting');
    expect(enqueuedCalls).toBe(1);
  });

  it('returns timeout for short-timeout calls regardless of transport state (chat path, unchanged)', async () => {
    agents = [makeAgent({ transports: [makeWebhookTransport(['negotiation.turn_received'])] })];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 30_000 });
    expect(res).toEqual({ handled: false, reason: 'timeout' });
    expect(enqueuedCalls).toBe(0);
  });
});
