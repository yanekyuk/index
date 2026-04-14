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

/**
 * Concrete AgentDispatcher that bridges the agent registry to the negotiation graph.
 * Checks for personal agents and parks the turn for polling pickup.
 */
export class AgentDispatcherImpl implements AgentDispatcher {
  constructor(
    private agentService: AgentLookup,
    private timeoutQueue: NegotiationTimeoutQueue | undefined,
  ) {}

  /**
   * Attempt to dispatch a negotiation turn to a personal agent.
   *
   * For long-timeout calls (>60 s), parks the turn in waiting_for_agent and
   * enqueues a 24h timeout. The agent picks up via the polling endpoint.
   * For short-timeout calls (chat), returns timeout so the graph uses the system agent.
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
        // Enqueue 24h timeout — agent has 24h to pick up before system agent takes over
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

        logger.info('Turn parked for polling pickup', {
          userId,
          negotiationId: payload.negotiationId,
          agentCount: personalAgents.length,
        });

        return { handled: false, reason: 'waiting', resumeToken: payload.negotiationId };
      } catch (err) {
        logger.error('Failed to park turn for polling', {
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
