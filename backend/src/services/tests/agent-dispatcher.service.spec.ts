import { describe, it, expect, beforeEach } from 'bun:test';
import type { NegotiationTimeoutQueue, NegotiationTurnPayload } from '@indexnetwork/protocol';

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

const payload: NegotiationTurnPayload = {
  negotiationId: 'n-1',
  ownUser: { id: 'user-1', intents: [], profile: {} },
  otherUser: { id: 'user-2', intents: [], profile: {} },
  indexContext: { networkId: 'net-1' },
  seedAssessment: { reasoning: '', valencyRole: '' },
  history: [],
  isFinalTurn: false,
  isDiscoverer: true,
};

const scope = { action: 'manage:negotiations', scopeType: 'negotiation' as const };

describe('AgentDispatcherImpl.dispatch', () => {
  let enqueuedCalls: number;
  let enqueuedArgs: { authorizedAgents: AgentWithRelations[] } | null;
  let agents: AgentWithRelations[];
  let dispatcher: AgentDispatcherImpl;

  beforeEach(() => {
    enqueuedCalls = 0;
    enqueuedArgs = null;
    agents = [];
    dispatcher = new AgentDispatcherImpl(
      { findAuthorizedAgents: async () => agents },
      {
        enqueueDeliveries: async (opts: { authorizedAgents: AgentWithRelations[] }) => {
          enqueuedCalls++;
          enqueuedArgs = { authorizedAgents: opts.authorizedAgents };
        },
      },
      { enqueueTimeout: async () => {} } as unknown as NegotiationTimeoutQueue,
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
    expect(enqueuedArgs?.authorizedAgents).toHaveLength(1);
    expect(enqueuedArgs?.authorizedAgents[0]?.id).toBe('agent-1');
  });

  it('forwards only personal agents with matching webhook transports', async () => {
    agents = [
      makeAgent({ id: 'agent-match', transports: [makeWebhookTransport(['negotiation.turn_received'])] }),
      makeAgent({ id: 'agent-no-transport', transports: [] }),
      makeAgent({ id: 'agent-wrong-event', transports: [makeWebhookTransport(['opportunity.created'])] }),
      makeAgent({ id: 'agent-inactive', transports: [makeWebhookTransport(['negotiation.turn_received'], false)] }),
    ];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(res.reason).toBe('waiting');
    expect(enqueuedArgs?.authorizedAgents.map((a) => a.id)).toEqual(['agent-match']);
  });

  it('accepts agent when one of its transports matches', async () => {
    agents = [makeAgent({ transports: [
      makeWebhookTransport(['opportunity.created']),
      makeWebhookTransport(['negotiation.turn_received']),
    ]})];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(res.reason).toBe('waiting');
    expect(enqueuedArgs?.authorizedAgents).toHaveLength(1);
  });

  it('returns timeout for short-timeout calls regardless of transport state (chat path, unchanged)', async () => {
    agents = [makeAgent({ transports: [makeWebhookTransport(['negotiation.turn_received'])] })];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 30_000 });
    expect(res).toEqual({ handled: false, reason: 'timeout' });
    expect(enqueuedCalls).toBe(0);
  });
});
