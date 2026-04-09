import type {
  AgentDispatcher,
  AgentDispatchResult,
  NegotiationTurnPayload,
} from '@indexnetwork/protocol';
import type { NegotiationTimeoutQueue } from '@indexnetwork/protocol';

import type { AgentWithRelations } from '../adapters/agent.database.adapter';

import { log } from '../lib/log';

const logger = log.service.from('AgentDispatcherImpl');

/** Subset of AgentService needed by the dispatcher. */
interface AgentLookup {
  findAuthorizedAgents(
    userId: string,
    action: string,
    scope: { type: 'global' | 'node' | 'network'; id?: string },
  ): Promise<AgentWithRelations[]>;
}

/** Subset of AgentDeliveryService needed by the dispatcher. */
interface AgentDelivery {
  enqueueDeliveries(opts: {
    userId: string;
    authorizedAgents: AgentWithRelations[];
    event: string;
    payload: Record<string, unknown>;
    getJobId: (target: { id: string }) => string;
  }): Promise<unknown>;
}

/**
 * Concrete AgentDispatcher that bridges the agent registry to the negotiation graph.
 * Tries personal agents via transports, falls back to system agent.
 */
export class AgentDispatcherImpl implements AgentDispatcher {
  constructor(
    private agentService: AgentLookup,
    private deliveryService: AgentDelivery,
    private timeoutQueue: NegotiationTimeoutQueue | undefined,
  ) {}

  /**
   * Attempt to dispatch a negotiation turn to a personal agent.
   *
   * For long-timeout calls (>60 s), enqueues a webhook delivery and a timeout job,
   * then returns `waiting` so the negotiation graph can yield.
   * For short-timeout calls (chat), personal-agent transports are not synchronous yet,
   * so the method returns `timeout` and lets the graph fall back to the system agent.
   *
   * @param userId - The user whose agent should handle this turn
   * @param scope - Permission scope for agent resolution
   * @param payload - Turn context (users, history, seed assessment)
   * @param options - Timeout configuration
   * @returns Handled result with turn, or unhandled result with reason
   */
  async dispatch(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
    payload: NegotiationTurnPayload,
    options: { timeoutMs: number },
  ): Promise<AgentDispatchResult> {
    // Negotiation permissions are scoped to networks, so map 'negotiation' → 'network'
    // to ensure the adapter queries the correct permission scope.
    const resolvedScopeType = scope.scopeType === 'negotiation' ? 'network' : scope.scopeType;

    const authorizedAgents = await this.agentService.findAuthorizedAgents(
      userId,
      scope.action,
      { type: resolvedScopeType as 'global' | 'node' | 'network', id: scope.scopeId },
    );

    const personalAgents = authorizedAgents.filter((a) => a.type === 'personal');

    if (personalAgents.length === 0) {
      return { handled: false, reason: 'no_agent' };
    }

    const isLongTimeout = options.timeoutMs > 60_000;

    if (isLongTimeout) {
      try {
        const turnNumber = payload.history.length + 1;
        const lastTurn = payload.history[payload.history.length - 1];

        await this.deliveryService.enqueueDeliveries({
          userId,
          authorizedAgents: personalAgents,
          event: 'negotiation.turn_received',
          payload: {
            negotiationId: payload.negotiationId,
            userId,
            turnNumber,
            counterpartyAction: lastTurn?.action ?? 'propose',
            deadline: new Date(Date.now() + options.timeoutMs).toISOString(),
          },
          getJobId: (target) => `negotiation-turn:${payload.negotiationId}:${turnNumber}:${target.id}`,
        });

        if (this.timeoutQueue) {
          await this.timeoutQueue
            .enqueueTimeout(payload.negotiationId, payload.history.length, options.timeoutMs)
            .catch((err: unknown) =>
              logger.error('Failed to enqueue negotiation timeout', {
                negotiationId: payload.negotiationId,
                error: err,
              }),
            );
        }

        return { handled: false, reason: 'waiting', resumeToken: payload.negotiationId };
      } catch (err) {
        logger.error('Failed to dispatch to personal agent (long timeout)', {
          userId,
          negotiationId: payload.negotiationId,
          error: err,
        });
        return { handled: false, reason: 'timeout' };
      }
    }

    // Short timeout (chat): personal agent transports are async-only; synchronous
    // response is not implemented yet. Return timeout so the graph falls back to
    // the system negotiator agent.
    logger.info('Short timeout dispatch — falling back to system agent', {
      userId,
      timeoutMs: options.timeoutMs,
    });
    return { handled: false, reason: 'timeout' };
  }

  /**
   * Check whether a user has an authorized personal agent for the given scope.
   *
   * @param userId - The user to check
   * @param scope - Permission scope for agent resolution
   * @returns `true` if at least one personal agent is authorized
   */
  async hasPersonalAgent(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
  ): Promise<boolean> {
    // Negotiation permissions are scoped to networks (see dispatch() for rationale).
    const resolvedScopeType = scope.scopeType === 'negotiation' ? 'network' : scope.scopeType;

    const agents = await this.agentService.findAuthorizedAgents(
      userId,
      scope.action,
      { type: resolvedScopeType as 'global' | 'node' | 'network', id: scope.scopeId },
    );
    return agents.some((a) => a.type === 'personal');
  }
}
