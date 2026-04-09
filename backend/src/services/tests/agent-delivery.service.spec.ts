import { describe, expect, it, mock } from 'bun:test';

import { AgentDeliveryService } from '../agent-delivery.service';

type MockWebhook = {
  id: string;
  url: string;
  secret: string;
};

type DeliveryAgent = Parameters<AgentDeliveryService['enqueueDeliveries']>[0]['authorizedAgents'][number];

function createAgentWithRelations(overrides: Partial<DeliveryAgent> = {}): DeliveryAgent {
  return {
    id: 'agent-1',
    transports: [],
    ...overrides,
  };
}

function createTransportRow(overrides: Partial<DeliveryAgent['transports'][number]> = {}): DeliveryAgent['transports'][number] {
  return {
    id: 'transport-1',
    agentId: 'agent-1',
    channel: 'webhook',
    config: { url: 'https://example.com/hook', events: ['negotiation.turn_received'] },
    priority: 0,
    active: true,
    failureCount: 0,
    ...overrides,
  };
}

describe('AgentDeliveryService', () => {
  it('allows webhook lookup without requiring a queue dependency', async () => {
    const findByUserAndEvent = mock(() => Promise.resolve([{ id: 'hook-1' }]));
    const service = new AgentDeliveryService({ findByUserAndEvent });

    const result = await service.hasWebhookForEvent('user-1', 'negotiation.turn_received');

    expect(result).toBe(true);
  });

  it('reports whether legacy webhook lookup finds any subscriptions', async () => {
    const findByUserAndEvent = mock(() => Promise.resolve([{ id: 'hook-1' }]));
    const service = new AgentDeliveryService(
      { findByUserAndEvent },
      { addJob: mock(() => Promise.resolve(undefined)) },
    );

    const result = await service.hasWebhookForEvent('user-1', 'negotiation.turn_received');

    expect(result).toBe(true);
    expect(findByUserAndEvent).toHaveBeenCalledWith('user-1', 'negotiation.turn_received');
  });

  it('fans out legacy webhook deliveries without changing payloads or job IDs', async () => {
    const hookA: MockWebhook = {
      id: 'hook-a',
      url: 'https://example.com/a',
      secret: 'secret-a',
    };
    const hookB: MockWebhook = {
      id: 'hook-b',
      url: 'https://example.com/b',
      secret: 'secret-b',
    };
    const addJob = mock(() => Promise.resolve(undefined));
    const service = new AgentDeliveryService(
      { findByUserAndEvent: mock(() => Promise.resolve([hookA, hookB])) },
      { addJob },
      () => new Date('2026-04-08T12:00:00.000Z'),
    );

    await service.enqueueLegacyWebhookFanout({
      userId: 'user-1',
      event: 'negotiation.completed',
      payload: {
        negotiationId: 'neg-1',
        outcome: 'accepted',
        turnCount: 3,
      },
      getJobId: (hook) => `webhook-neg-completed-${hook.id}-neg-1`,
    });

    expect(addJob).toHaveBeenCalledTimes(2);
    expect(addJob).toHaveBeenNthCalledWith(
      1,
      'deliver_webhook',
      {
        webhookId: 'hook-a',
        url: 'https://example.com/a',
        secret: 'secret-a',
        event: 'negotiation.completed',
        payload: {
          negotiationId: 'neg-1',
          outcome: 'accepted',
          turnCount: 3,
        },
        timestamp: '2026-04-08T12:00:00.000Z',
      },
      { jobId: 'webhook-neg-completed-hook-a-neg-1' },
    );
    expect(addJob).toHaveBeenNthCalledWith(
      2,
      'deliver_webhook',
      {
        webhookId: 'hook-b',
        url: 'https://example.com/b',
        secret: 'secret-b',
        event: 'negotiation.completed',
        payload: {
          negotiationId: 'neg-1',
          outcome: 'accepted',
          turnCount: 3,
        },
        timestamp: '2026-04-08T12:00:00.000Z',
      },
      { jobId: 'webhook-neg-completed-hook-b-neg-1' },
    );
  });

  it('does not enqueue anything when no legacy webhooks match', async () => {
    const addJob = mock(() => Promise.resolve(undefined));
    const service = new AgentDeliveryService(
      { findByUserAndEvent: mock(() => Promise.resolve([])) },
      { addJob },
    );

    await service.enqueueLegacyWebhookFanout({
      userId: 'user-1',
      event: 'opportunity.created',
      payload: { opportunityId: 'opp-1' },
      getJobId: (hook) => `webhook-opp-created-${hook.id}-opp-1`,
    });

    expect(addJob).not.toHaveBeenCalled();
  });

  it('prefers authorized agent webhook transports before legacy fallback', async () => {
    const addJob = mock(() => Promise.resolve(undefined));
    const service = new AgentDeliveryService(
      { findByUserAndEvent: mock(() => Promise.resolve([{ id: 'legacy-hook', url: 'https://legacy.example.com', secret: 'legacy' }])) },
      { addJob },
      () => new Date('2026-04-08T12:00:00.000Z'),
    );

    await service.enqueueDeliveries({
      userId: 'user-1',
      event: 'negotiation.turn_received',
      payload: { negotiationId: 'neg-1' },
      getJobId: (target) => `job-${target.id}`,
      authorizedAgents: [
        createAgentWithRelations({
          id: 'agent-1',
          transports: [
            createTransportRow({
              id: 'transport-1',
              agentId: 'agent-1',
              config: { url: 'https://agent.example.com', secret: 'agent-secret', events: ['negotiation.turn_received'] },
              priority: 1,
            }),
          ],
        }),
      ],
    });

    expect(addJob).toHaveBeenCalledTimes(1);
    expect(addJob).toHaveBeenCalledWith(
      'deliver_webhook',
      expect.objectContaining({
        webhookId: 'transport-1',
        url: 'https://agent.example.com',
        secret: 'agent-secret',
        event: 'negotiation.turn_received',
      }),
      { jobId: 'job-transport-1' },
    );
  });

  it('falls back to legacy webhooks when no eligible agent transport exists', async () => {
    const addJob = mock(() => Promise.resolve(undefined));
    const service = new AgentDeliveryService(
      { findByUserAndEvent: mock(() => Promise.resolve([{ id: 'legacy-hook', url: 'https://legacy.example.com', secret: 'legacy' }])) },
      { addJob },
      () => new Date('2026-04-08T12:00:00.000Z'),
    );

    await service.enqueueDeliveries({
      userId: 'user-1',
      event: 'negotiation.turn_received',
      payload: { negotiationId: 'neg-1' },
      getJobId: (target) => `job-${target.id}`,
      authorizedAgents: [],
    });

    expect(addJob).toHaveBeenCalledTimes(1);
    expect(addJob).toHaveBeenCalledWith(
      'deliver_webhook',
      expect.objectContaining({ webhookId: 'legacy-hook' }),
      { jobId: 'job-legacy-hook' },
    );
  });

  it('falls back to legacy webhooks when agent transports are not subscribed to the event', async () => {
    const addJob = mock(() => Promise.resolve(undefined));
    const service = new AgentDeliveryService(
      { findByUserAndEvent: mock(() => Promise.resolve([{ id: 'legacy-hook', url: 'https://legacy.example.com', secret: 'legacy' }])) },
      { addJob },
      () => new Date('2026-04-08T12:00:00.000Z'),
    );

    await service.enqueueDeliveries({
      userId: 'user-1',
      event: 'negotiation.completed',
      payload: { negotiationId: 'neg-1' },
      getJobId: (target) => `job-${target.id}`,
      authorizedAgents: [
        createAgentWithRelations({
          id: 'agent-1',
          transports: [
            createTransportRow({
              id: 'transport-1',
              agentId: 'agent-1',
              config: { url: 'https://agent.example.com', events: ['negotiation.started'] },
            }),
          ],
        }),
      ],
    });

    expect(addJob).toHaveBeenCalledTimes(1);
    expect(addJob).toHaveBeenCalledWith(
      'deliver_webhook',
      expect.objectContaining({ webhookId: 'legacy-hook' }),
      { jobId: 'job-legacy-hook' },
    );
  });

  it('falls back to legacy webhooks when agent transports are inactive', async () => {
    const addJob = mock(() => Promise.resolve(undefined));
    const service = new AgentDeliveryService(
      { findByUserAndEvent: mock(() => Promise.resolve([{ id: 'legacy-hook', url: 'https://legacy.example.com', secret: 'legacy' }])) },
      { addJob },
      () => new Date('2026-04-08T12:00:00.000Z'),
    );

    await service.enqueueDeliveries({
      userId: 'user-1',
      event: 'negotiation.turn_received',
      payload: { negotiationId: 'neg-1' },
      getJobId: (target) => `job-${target.id}`,
      authorizedAgents: [
        createAgentWithRelations({
          id: 'agent-1',
          transports: [
            createTransportRow({
              id: 'transport-1',
              agentId: 'agent-1',
              config: { url: 'https://agent.example.com', events: ['negotiation.turn_received'] },
              active: false,
            }),
          ],
        }),
      ],
    });

    expect(addJob).toHaveBeenCalledTimes(1);
    expect(addJob).toHaveBeenCalledWith(
      'deliver_webhook',
      expect.objectContaining({ webhookId: 'legacy-hook' }),
      { jobId: 'job-legacy-hook' },
    );
  });

  it('skips non-webhook agent transports', async () => {
    const addJob = mock(() => Promise.resolve(undefined));
    const service = new AgentDeliveryService(
      { findByUserAndEvent: mock(() => Promise.resolve([{ id: 'legacy-hook', url: 'https://legacy.example.com', secret: 'legacy' }])) },
      { addJob },
      () => new Date('2026-04-08T12:00:00.000Z'),
    );

    await service.enqueueDeliveries({
      userId: 'user-1',
      event: 'negotiation.turn_received',
      payload: { negotiationId: 'neg-1' },
      getJobId: (target) => `job-${target.id}`,
      authorizedAgents: [
        createAgentWithRelations({
          id: 'agent-1',
          transports: [
            createTransportRow({
              id: 'transport-1',
              agentId: 'agent-1',
              channel: 'mcp',
              config: {},
            }),
          ],
        }),
      ],
    });

    expect(addJob).toHaveBeenCalledTimes(1);
    expect(addJob).toHaveBeenCalledWith(
      'deliver_webhook',
      expect.objectContaining({ webhookId: 'legacy-hook' }),
      { jobId: 'job-legacy-hook' },
    );
  });

  it('dispatches to multiple eligible transports sorted by priority', async () => {
    const addJob = mock(() => Promise.resolve(undefined));
    const service = new AgentDeliveryService(
      { findByUserAndEvent: mock(() => Promise.resolve([])) },
      { addJob },
      () => new Date('2026-04-08T12:00:00.000Z'),
    );

    await service.enqueueDeliveries({
      userId: 'user-1',
      event: 'negotiation.turn_received',
      payload: { negotiationId: 'neg-1' },
      getJobId: (target) => `job-${target.id}`,
      authorizedAgents: [
        createAgentWithRelations({
          id: 'agent-1',
          transports: [
            createTransportRow({
              id: 'transport-low',
              agentId: 'agent-1',
              config: { url: 'https://low.example.com', events: ['negotiation.turn_received'] },
              priority: 1,
            }),
            createTransportRow({
              id: 'transport-high',
              agentId: 'agent-1',
              config: { url: 'https://high.example.com', events: ['negotiation.turn_received'] },
              priority: 10,
            }),
          ],
        }),
      ],
    });

    expect(addJob).toHaveBeenCalledTimes(2);
    expect(addJob).toHaveBeenNthCalledWith(
      1,
      'deliver_webhook',
      expect.objectContaining({ webhookId: 'transport-high' }),
      { jobId: 'job-transport-high' },
    );
    expect(addJob).toHaveBeenNthCalledWith(
      2,
      'deliver_webhook',
      expect.objectContaining({ webhookId: 'transport-low' }),
      { jobId: 'job-transport-low' },
    );
  });
});