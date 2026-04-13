import { eq, and, sql, asc } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import * as convSchema from '../schemas/conversation.schema';
import * as dbSchema from '../schemas/database.schema';
import { conversationDatabaseAdapter } from '../adapters/database.adapter';
import { negotiationTimeoutQueue } from '../queues/negotiation-timeout.queue';
import { negotiationClaimTimeoutQueue } from '../queues/negotiation-claim-timeout.queue';
import { log } from '../lib/log';
import type { NegotiationTurn } from '@indexnetwork/protocol';

const logger = log.service.from('NegotiationPollingService');

// ─────────────────────────────────────────────────────────────────────────────
// Error classes
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when a referenced resource does not exist. Maps to HTTP 404. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Thrown when a state conflict prevents the operation. Maps to HTTP 409. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PickupResult {
  negotiationId: string;
  taskId: string;
  opportunity: { id: string; reasoning: string; actors: unknown[]; status: string } | null;
  turn: {
    number: number;
    deadline: string;
    history: Array<{ turnNumber: number; agent: 'source' | 'candidate'; action: string; message: string | null | undefined }>;
    counterpartyAction: string;
  };
}

export interface RespondInput {
  action: 'propose' | 'accept' | 'reject' | 'counter' | 'question';
  message?: string | null;
  assessment: {
    reasoning: string;
    suggestedRoles: {
      ownUser: 'agent' | 'patient' | 'peer';
      otherUser: 'agent' | 'patient' | 'peer';
    };
  };
}

/** Shape of the task metadata JSONB for negotiation tasks. */
interface NegotiationTaskMetadata {
  type: 'negotiation';
  sourceUserId: string;
  candidateUserId: string;
  maxTurns?: number;
  opportunityId?: string;
}

/** Default maximum turns before a negotiation is force-finalized. */
const DEFAULT_MAX_TURNS = 6;

/** Claim timeout: 6 hours in milliseconds. */
const CLAIM_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/** Response timeout: 24 hours in milliseconds. */
const RESPONSE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NegotiationPollingService
 *
 * Provides the business logic for polling-based negotiation delivery.
 * External agents call {@link pickup} to claim the next pending turn, then
 * call {@link respond} to submit their response. This replaces the previous
 * webhook-based push delivery model.
 *
 * RESPONSIBILITIES:
 * - Pickup: find the oldest pending turn for a user's agent, atomically claim it
 * - Respond: validate the claim, persist the turn, evaluate termination, advance state
 * - Timeout orchestration: cancel/enqueue 24h and 6h timeouts as state transitions
 */
export class NegotiationPollingService {
  /**
   * Picks up the next pending negotiation turn for an agent.
   *
   * Idempotent: if the agent already has a claimed turn, returns that turn
   * without re-claiming. Otherwise finds the oldest `waiting_for_agent` task
   * where the user is a participant and atomically transitions it to `claimed`.
   *
   * @param agentId - The agent claiming the turn
   * @param userId - The user the agent represents
   * @returns The pickup result with opportunity context and turn history, or null if nothing pending
   */
  async pickup(agentId: string, userId: string): Promise<PickupResult | null> {
    // 1. Check if agent already has a claimed turn (idempotency)
    const [existingClaim] = await db
      .select()
      .from(convSchema.tasks)
      .where(
        and(
          eq(convSchema.tasks.state, 'claimed'),
          eq(convSchema.tasks.claimedByAgentId, agentId),
          sql`${convSchema.tasks.metadata}->>'type' = 'negotiation'`,
        ),
      )
      .limit(1);

    if (existingClaim) {
      logger.info('[NegotiationPollingService] Returning existing claimed turn', {
        agentId,
        taskId: existingClaim.id,
      });
      return this.buildPickupResult(existingClaim);
    }

    // 2. Find oldest task in waiting_for_agent where user is source or candidate
    const [pendingTask] = await db
      .select()
      .from(convSchema.tasks)
      .where(
        and(
          eq(convSchema.tasks.state, 'waiting_for_agent'),
          sql`${convSchema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`(
            ${convSchema.tasks.metadata}->>'sourceUserId' = ${userId}
            OR ${convSchema.tasks.metadata}->>'candidateUserId' = ${userId}
          )`,
        ),
      )
      .orderBy(asc(convSchema.tasks.createdAt))
      .limit(1);

    if (!pendingTask) {
      return null;
    }

    // 3. Atomically transition to claimed (WHERE state = 'waiting_for_agent' prevents races)
    const now = new Date();
    const [claimed] = await db
      .update(convSchema.tasks)
      .set({
        state: 'claimed',
        claimedByAgentId: agentId,
        claimedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(convSchema.tasks.id, pendingTask.id),
          eq(convSchema.tasks.state, 'waiting_for_agent'),
        ),
      )
      .returning();

    if (!claimed) {
      // Another agent won the race
      logger.info('[NegotiationPollingService] Lost race to claim task', {
        agentId,
        taskId: pendingTask.id,
      });
      return null;
    }

    // 4. Cancel 24h timeout (no longer waiting unclaimed)
    await negotiationTimeoutQueue.cancelTimeout(claimed.id);

    // 5. Enqueue 6h claim timeout
    const messages = await conversationDatabaseAdapter.getMessagesForConversation(claimed.conversationId);
    const turnNumber = messages.length;
    await negotiationClaimTimeoutQueue.enqueueTimeout(claimed.id, turnNumber, agentId);

    logger.info('[NegotiationPollingService] Turn claimed', {
      agentId,
      userId,
      taskId: claimed.id,
      turnNumber,
    });

    // 6. Return pickup result
    return this.buildPickupResult(claimed);
  }

  /**
   * Submits a response for a claimed negotiation turn.
   *
   * Validates that the task is in `claimed` state and owned by the given agent,
   * persists the turn as a message, then evaluates whether the negotiation should
   * terminate (accept/reject/max turns) or continue.
   *
   * @param agentId - The agent submitting the response
   * @param userId - The user the agent represents
   * @param negotiationId - The task ID of the negotiation
   * @param input - The agent's response (action, message, assessment)
   * @returns Success confirmation
   * @throws {NotFoundError} If the negotiation task does not exist
   * @throws {ConflictError} If the task is not claimed or not claimed by this agent
   */
  async respond(
    agentId: string,
    _userId: string,
    negotiationId: string,
    input: RespondInput,
  ): Promise<{ success: true }> {
    // 1. Load task and verify state
    const task = await conversationDatabaseAdapter.getTask(negotiationId);
    if (!task) {
      throw new NotFoundError(`Negotiation ${negotiationId} not found`);
    }

    if (task.state !== 'claimed') {
      throw new ConflictError(
        `Negotiation ${negotiationId} is in state '${task.state}', expected 'claimed'`,
      );
    }

    if (task.claimedByAgentId !== agentId) {
      throw new ConflictError(
        `Negotiation ${negotiationId} is claimed by a different agent`,
      );
    }

    const meta = task.metadata as NegotiationTaskMetadata | null;
    if (meta?.type !== 'negotiation') {
      throw new NotFoundError(`Task ${negotiationId} is not a negotiation`);
    }

    // 2. Cancel 6h claim timeout
    await negotiationClaimTimeoutQueue.cancelTimeout(negotiationId);

    // 3. Determine current speaker
    const messages = await conversationDatabaseAdapter.getMessagesForConversation(task.conversationId);
    const currentTurnCount = messages.length;
    const currentSpeaker: 'source' | 'candidate' = currentTurnCount % 2 === 0 ? 'source' : 'candidate';
    const senderId = currentSpeaker === 'source'
      ? `agent:${meta.sourceUserId}`
      : `agent:${meta.candidateUserId}`;

    // 4. Persist the turn as a message
    const turn: NegotiationTurn = {
      action: input.action,
      message: input.message ?? null,
      assessment: input.assessment,
    };

    await conversationDatabaseAdapter.createMessage({
      conversationId: task.conversationId,
      senderId,
      role: 'agent',
      parts: [{ kind: 'data' as const, data: turn }],
      taskId: task.id,
    });

    const newTurnCount = currentTurnCount + 1;
    const maxTurns = meta.maxTurns ?? DEFAULT_MAX_TURNS;

    // 5. Evaluate: accept/reject/maxTurns -> finalize, else -> waiting_for_agent + re-arm timeout
    if (input.action === 'accept' || input.action === 'reject' || newTurnCount >= maxTurns) {
      // Parse full history for outcome building
      const history = this.parseHistory(messages);
      const fullHistory = [...history, turn];
      const nextSpeaker: 'source' | 'candidate' = currentSpeaker === 'source' ? 'candidate' : 'source';

      const outcome = this.buildOutcome(
        fullHistory,
        newTurnCount,
        input.action,
        meta.sourceUserId,
        meta.candidateUserId,
        nextSpeaker,
      );

      await conversationDatabaseAdapter.updateTaskState(task.id, 'completed');
      await conversationDatabaseAdapter.createArtifact({
        taskId: task.id,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: outcome }],
        metadata: { hasOpportunity: outcome.hasOpportunity, turnCount: newTurnCount },
      });

      const outcomeStr = input.action === 'accept' ? 'accepted'
        : input.action === 'reject' ? 'rejected'
        : 'turn_cap';

      logger.info('[NegotiationPollingService] Negotiation finalized', {
        negotiationId,
        outcome: outcomeStr,
        turnCount: newTurnCount,
      });
    } else {
      // Continue: set to waiting_for_agent and re-arm 24h timeout
      await conversationDatabaseAdapter.updateTaskState(task.id, 'waiting_for_agent');

      await negotiationTimeoutQueue.enqueueTimeout(negotiationId, newTurnCount, RESPONSE_TIMEOUT_MS);

      logger.info('[NegotiationPollingService] Turn submitted, waiting for next agent', {
        negotiationId,
        action: input.action,
        turnCount: newTurnCount,
      });
    }

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Builds a {@link PickupResult} from a task row.
   * Loads the opportunity (if referenced) and reconstructs turn history.
   */
  private async buildPickupResult(task: convSchema.Task): Promise<PickupResult> {
    const meta = task.metadata as NegotiationTaskMetadata;

    // Load opportunity if referenced
    let opportunity: PickupResult['opportunity'] = null;
    if (meta.opportunityId) {
      const [oppRow] = await db
        .select({
          id: dbSchema.opportunities.id,
          detection: dbSchema.opportunities.detection,
          actors: dbSchema.opportunities.actors,
          status: dbSchema.opportunities.status,
        })
        .from(dbSchema.opportunities)
        .where(eq(dbSchema.opportunities.id, meta.opportunityId))
        .limit(1);

      if (oppRow) {
        const detection = oppRow.detection as { reasoning?: string } | null;
        opportunity = {
          id: oppRow.id,
          reasoning: detection?.reasoning ?? '',
          actors: oppRow.actors as unknown[],
          status: oppRow.status,
        };
      }
    }

    // Load turn history
    const messages = await conversationDatabaseAdapter.getMessagesForConversation(task.conversationId);
    const turnNumber = messages.length;

    const history: PickupResult['turn']['history'] = messages.map((m, idx) => {
      const dp = (m.parts as Array<{ kind?: string; data?: NegotiationTurn }>)?.find(
        (p) => p.kind === 'data',
      );
      const turnData = dp?.data;
      const speaker: 'source' | 'candidate' = idx % 2 === 0 ? 'source' : 'candidate';
      return {
        turnNumber: idx,
        agent: speaker,
        action: turnData?.action ?? 'unknown',
        message: turnData?.message,
      };
    });

    // Counterparty action = action from the last turn (the turn that triggered this pickup)
    const lastTurn = history.length > 0 ? history[history.length - 1] : null;
    const counterpartyAction = lastTurn?.action ?? 'none';

    // Deadline = claimedAt + 6 hours
    const claimedAt = task.claimedAt ?? new Date();
    const deadline = new Date(claimedAt.getTime() + CLAIM_TIMEOUT_MS);

    return {
      negotiationId: task.conversationId,
      taskId: task.id,
      opportunity,
      turn: {
        number: turnNumber,
        deadline: deadline.toISOString(),
        history,
        counterpartyAction,
      },
    };
  }

  /**
   * Parses negotiation turn history from raw message rows.
   */
  private parseHistory(
    messages: Array<{ parts: unknown[] }>,
  ): NegotiationTurn[] {
    return messages
      .map((m) => {
        const dp = (m.parts as Array<{ kind?: string; data?: unknown }>)?.find(
          (p) => p.kind === 'data',
        );
        return dp?.data as NegotiationTurn;
      })
      .filter(Boolean);
  }

  /**
   * Builds a negotiation outcome from the full turn history.
   * Follows the same pattern as {@link NegotiationTimeoutQueue.buildOutcome}.
   *
   * @param history - Complete turn history including the final turn
   * @param turnCount - Total number of turns
   * @param lastAction - The action of the final turn
   * @param sourceUserId - The source (discoverer) user ID
   * @param candidateUserId - The candidate user ID
   * @param currentSpeaker - Who would speak next (used to determine accepter perspective)
   */
  private buildOutcome(
    history: NegotiationTurn[],
    turnCount: number,
    lastAction: string,
    sourceUserId: string,
    candidateUserId: string,
    currentSpeaker: string,
  ): { hasOpportunity: boolean; agreedRoles: Array<{ userId: string; role: string }>; reasoning: string; turnCount: number; reason?: string } {
    const hasOpportunity = lastAction === 'accept';
    const atCap = lastAction === 'counter';

    let agreedRoles: Array<{ userId: string; role: string }> = [];
    if (hasOpportunity && history.length >= 2) {
      const acceptTurn = history[history.length - 1];
      const precedingTurn = history[history.length - 2];
      const accepterIsSource = currentSpeaker === 'candidate';
      const [sourceRole, candidateRole] = accepterIsSource
        ? [acceptTurn.assessment.suggestedRoles.ownUser, precedingTurn.assessment.suggestedRoles.ownUser]
        : [precedingTurn.assessment.suggestedRoles.ownUser, acceptTurn.assessment.suggestedRoles.ownUser];
      agreedRoles = [
        { userId: sourceUserId, role: sourceRole },
        { userId: candidateUserId, role: candidateRole },
      ];
    }

    return {
      hasOpportunity,
      agreedRoles,
      reasoning: history[history.length - 1]?.assessment.reasoning ?? '',
      turnCount,
      ...(atCap && { reason: 'turn_cap' as const }),
    };
  }
}

/** Singleton negotiation polling service instance. */
export const negotiationPollingService = new NegotiationPollingService();
