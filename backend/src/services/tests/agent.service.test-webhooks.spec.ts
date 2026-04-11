import { describe, it, expect, mock } from 'bun:test';

import type {
  AgentTransportRow,
  AgentWithRelations,
} from '../../adapters/agent.database.adapter';

const jobs: unknown[] = [];
mock.module('../../queues/webhook.queue', () => ({
  webhookQueue: {
    addJob: async (_name: string, data: unknown) => {
      jobs.push(data);
    },
  },
}));

import { AgentService } from '../agent.service';

function makeAgent(overrides: Partial<AgentWithRelations> = {}): AgentWithRelations {
  return {
    id: 'agent-1',
    ownerId: 'user-1',
    name: 'Test',
    description: null,
    type: 'personal',
    status: 'active',
    metadata: {},
    transports: [],
    permissions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeTransport(
  events: string[],
  active = true,
  id = 't-1',
): AgentTransportRow {
  return {
    id,
    agentId: 'agent-1',
    channel: 'webhook',
    config: { url: 'https://example.com/hook', secret: 'ssh', events },
    priority: 0,
    active,
    failureCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('AgentService.testWebhooks', () => {
  it('enqueues one delivery per active webhook transport', async () => {
    jobs.length = 0;
    const fakeDb = {
      getAgentWithRelations: async () =>
        makeAgent({
          transports: [
            makeTransport(['negotiation.turn_received'], true, 't-1'),
            makeTransport(['negotiation.completed'], true, 't-2'),
            makeTransport(['negotiation.turn_received'], false, 't-3'),
          ],
        }),
    };
    const service = new AgentService(fakeDb as never);
    const result = await service.testWebhooks('agent-1', 'user-1');
    expect(result).toEqual({ delivered: 2 });
    expect(jobs).toHaveLength(2);
  });

  it('rejects non-owned agent', async () => {
    jobs.length = 0;
    const fakeDb = {
      getAgentWithRelations: async () => makeAgent({ ownerId: 'someone-else' }),
    };
    const service = new AgentService(fakeDb as never);
    await expect(service.testWebhooks('agent-1', 'user-1')).rejects.toThrow(
      /not found/i,
    );
  });

  it('returns delivered: 0 when agent has no active webhook transports', async () => {
    jobs.length = 0;
    const fakeDb = {
      getAgentWithRelations: async () => makeAgent({ transports: [] }),
    };
    const service = new AgentService(fakeDb as never);
    const result = await service.testWebhooks('agent-1', 'user-1');
    expect(result).toEqual({ delivered: 0 });
  });
});
