import { describe, it, expect, beforeEach, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Module mocks — must be registered BEFORE the controller is imported so that
// the module-level singletons inside agent.controller.ts resolve to our fakes.
// ---------------------------------------------------------------------------

const touchLastSeenMock = mock(async (_agentId: string): Promise<void> => {});
const getByIdMock = mock(async (_agentId: string, _userId: string) => ({ id: _agentId }));

mock.module('../../services/agent.service', () => ({
  agentService: {
    touchLastSeen: touchLastSeenMock,
    getById: getByIdMock,
    listForUser: mock(async () => []),
    create: mock(async () => ({})),
    update: mock(async () => ({})),
    delete: mock(async () => {}),
    addTransport: mock(async () => ({})),
    removeTransport: mock(async () => {}),
    grantPermission: mock(async () => ({})),
    revokePermission: mock(async () => {}),
    listTokens: mock(async () => []),
    createToken: mock(async () => ({})),
    revokeToken: mock(async () => {}),
    hasPermission: mock(async () => true),
    findAuthorizedAgents: mock(async () => []),
    grantDefaultSystemPermissions: mock(async () => {}),
  },
}));

const negotiationPickupMock = mock(async (_agentId: string, _userId: string) => null);

mock.module('../../services/negotiation-polling.service', () => ({
  negotiationPollingService: {
    pickup: negotiationPickupMock,
    respond: mock(async () => ({})),
  },
  NotFoundError: class NotFoundError extends Error {},
  ConflictError: class ConflictError extends Error {},
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

const testMessagePickupMock = mock(async (_agentId: string) => null);

mock.module('../../services/agent-test-message.service', () => ({
  AgentTestMessageService: class {
    pickup = testMessagePickupMock;
    enqueue = mock(async () => ({}));
    confirmDelivered = mock(async () => {});
  },
}));

const opportunityPickupMock = mock(async (_agentId: string) => null);

mock.module('../../services/opportunity-delivery.service', () => ({
  OpportunityDeliveryService: class {
    pickupPending = opportunityPickupMock;
    confirmDelivered = mock(async () => {});
  },
}));

// Guards: bypass auth so we can call handlers directly
mock.module('../../guards/auth.guard', () => ({
  AuthGuard: {},
  AuthOrApiKeyGuard: {},
}));

// ---------------------------------------------------------------------------
// Import controller after mocks are in place
// ---------------------------------------------------------------------------
const { AgentController } = await import('../agent.controller');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_AGENT_ID = 'agent-123';
const TEST_USER_ID = 'user-456';

const mockUser = { id: TEST_USER_ID, email: 'test@example.com' };

function makeController() {
  return new AgentController();
}

function makeParams(id: string): Record<string, string> {
  return { id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentController pickup endpoints heartbeat', () => {
  let controller: AgentController;

  beforeEach(() => {
    controller = makeController();
    touchLastSeenMock.mockClear();
    negotiationPickupMock.mockClear();
    testMessagePickupMock.mockClear();
    opportunityPickupMock.mockClear();
    getByIdMock.mockClear();
  });

  it('pickupNegotiation bumps lastSeenAt before querying pending turns', async () => {
    const req = new Request('http://localhost/agents/agent-123/negotiations/pickup', { method: 'POST' });

    await controller.pickupNegotiation(req, mockUser as never, makeParams(TEST_AGENT_ID));

    expect(touchLastSeenMock).toHaveBeenCalledWith(TEST_AGENT_ID);
    expect(negotiationPickupMock).toHaveBeenCalled();
  });

  it('pickupTestMessage bumps lastSeenAt before querying pending test messages', async () => {
    const req = new Request('http://localhost/agents/agent-123/test-messages/pickup', { method: 'POST' });

    await controller.pickupTestMessage(req, mockUser as never, makeParams(TEST_AGENT_ID));

    expect(touchLastSeenMock).toHaveBeenCalledWith(TEST_AGENT_ID);
    expect(testMessagePickupMock).toHaveBeenCalled();
  });

  it('pickupOpportunity bumps lastSeenAt before querying pending deliveries', async () => {
    const req = new Request('http://localhost/agents/agent-123/opportunities/pickup', { method: 'POST' });

    await controller.pickupOpportunity(req, mockUser as never, makeParams(TEST_AGENT_ID));

    expect(touchLastSeenMock).toHaveBeenCalledWith(TEST_AGENT_ID);
    expect(opportunityPickupMock).toHaveBeenCalled();
  });

  it('bumps lastSeenAt even when nothing pending (empty poll)', async () => {
    // All three pickup mocks already return null (empty). Verify heartbeat fires regardless.
    const negReq = new Request('http://localhost/agents/agent-123/negotiations/pickup', { method: 'POST' });
    const msgReq = new Request('http://localhost/agents/agent-123/test-messages/pickup', { method: 'POST' });
    const oppReq = new Request('http://localhost/agents/agent-123/opportunities/pickup', { method: 'POST' });

    await controller.pickupNegotiation(negReq, mockUser as never, makeParams(TEST_AGENT_ID));
    await controller.pickupTestMessage(msgReq, mockUser as never, makeParams(TEST_AGENT_ID));
    await controller.pickupOpportunity(oppReq, mockUser as never, makeParams(TEST_AGENT_ID));

    expect(touchLastSeenMock).toHaveBeenCalledTimes(3);
    expect(touchLastSeenMock).toHaveBeenNthCalledWith(1, TEST_AGENT_ID);
    expect(touchLastSeenMock).toHaveBeenNthCalledWith(2, TEST_AGENT_ID);
    expect(touchLastSeenMock).toHaveBeenNthCalledWith(3, TEST_AGENT_ID);
  });
});
