/**
 * Enriched payload shapes for webhook deliveries, plus pure builder functions
 * that map from in-scope runtime data to outbound Hermes-friendly payloads.
 *
 * Builders are pure — no DB access, no side effects. Each emit site must pass
 * everything the builder needs. Unit tests live in `./tests/webhook-payloads.spec.ts`.
 */

import type { Opportunity } from '@indexnetwork/protocol';
import type { NegotiationTurnPayload } from '@indexnetwork/protocol';

// ─────────────────────────────────────────────────────────────────────────────
// opportunity.created
// ─────────────────────────────────────────────────────────────────────────────

export interface OpportunityCreatedActor {
  user_id: string | undefined;
  network_id: string | undefined;
  role: string | undefined;
}

export interface OpportunityCreatedPayload {
  opportunity_id: string;
  status: string;
  url: string;
  category: string;
  reasoning: string;
  confidence: number;
  signals: unknown[];
  actors: OpportunityCreatedActor[];
  source: string;
  created_at: string;
  expires_at: string | null;
}

/**
 * Map an in-scope Opportunity to the Hermes-friendly webhook payload.
 *
 * @param opts.opportunity - The full Opportunity object from the event bus.
 * @param opts.appUrl - Base URL for building deep links (e.g. `https://index.network`).
 */
export function buildOpportunityCreatedPayload(opts: {
  opportunity: Opportunity;
  appUrl: string;
}): OpportunityCreatedPayload {
  const { opportunity, appUrl } = opts;
  return {
    opportunity_id: opportunity.id,
    status: opportunity.status,
    url: `${appUrl}/opportunities/${opportunity.id}`,
    category: opportunity.interpretation.category,
    reasoning: opportunity.interpretation.reasoning,
    confidence: opportunity.interpretation.confidence,
    signals: (opportunity.interpretation.signals as unknown[] | undefined) ?? [],
    actors: (opportunity.actors ?? []).map((a) => ({
      user_id: (a as { userId?: string }).userId,
      network_id: (a as { networkId?: string }).networkId,
      role: (a as { role?: string }).role,
    })),
    source: opportunity.detection.source,
    created_at: new Date(opportunity.createdAt).toISOString(),
    expires_at: opportunity.expiresAt ? new Date(opportunity.expiresAt).toISOString() : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// negotiation.turn_received
// ─────────────────────────────────────────────────────────────────────────────

/** Number of most-recent turns embedded verbatim in the payload. */
export const RECENT_TURNS_WINDOW = 3;

export interface NegotiationParticipant {
  user_id: string;
  name: string | undefined;
  /** Valency role from the seed assessment — typically 'agent' | 'patient' | 'peer', but widened to string to match the protocol's `SeedAssessment.valencyRole`. */
  role: string;
}

export interface NegotiationRecentTurn {
  turn_index: number;
  action: 'propose' | 'accept' | 'reject' | 'counter' | 'question';
  message: string | null;
  reasoning: string;
}

export interface NegotiationHistoryDigest {
  total_turns: number;
  actions_so_far: Array<'propose' | 'accept' | 'reject' | 'counter' | 'question'>;
  own_intents: Array<{ id: string; title: string; description: string | undefined }>;
  other_intents: Array<{ id: string; title: string; description: string | undefined }>;
}

export interface NegotiationTurnReceivedPayload {
  negotiation_id: string;
  url: string;
  turn_number: number;
  deadline: string;
  counterparty_action: 'propose' | 'accept' | 'reject' | 'counter' | 'question' | null;
  counterparty_message: string | null;
  counterparty_reasoning: string | null;
  sender: NegotiationParticipant;
  own_user: NegotiationParticipant;
  objective: string;
  index_context: { network_id: string; prompt: string | undefined };
  discovery_query: string | undefined;
  recent_turns: NegotiationRecentTurn[];
  history_digest: NegotiationHistoryDigest;
}

/**
 * Map an in-memory NegotiationTurnPayload into the Hermes-friendly shape.
 *
 * All data is already in scope at the agent-dispatcher emit site — this
 * function does no DB access and is trivially unit-testable.
 */
export function buildNegotiationTurnReceivedPayload(opts: {
  turnPayload: NegotiationTurnPayload;
  userId: string;
  turnNumber: number;
  deadlineIso: string;
  appUrl: string;
}): NegotiationTurnReceivedPayload {
  const { turnPayload, userId, turnNumber, deadlineIso, appUrl } = opts;
  const { ownUser, otherUser, history, seedAssessment, indexContext, discoveryQuery } = turnPayload;

  const lastTurn = history.length > 0 ? history[history.length - 1] : null;
  const recentSlice = history.slice(Math.max(0, history.length - RECENT_TURNS_WINDOW));
  const recentBaseIndex = Math.max(0, history.length - RECENT_TURNS_WINDOW);

  return {
    negotiation_id: turnPayload.negotiationId,
    url: `${appUrl}/negotiations/${turnPayload.negotiationId}`,
    turn_number: turnNumber,
    deadline: deadlineIso,
    counterparty_action: lastTurn?.action ?? null,
    counterparty_message: lastTurn?.message ?? null,
    counterparty_reasoning: lastTurn?.assessment.reasoning ?? null,
    sender: {
      user_id: otherUser.id,
      name: otherUser.profile?.name,
      role: seedAssessment.valencyRole,
    },
    own_user: {
      user_id: userId,
      name: ownUser.profile?.name,
      role: seedAssessment.valencyRole,
    },
    objective: seedAssessment.reasoning,
    index_context: { network_id: indexContext.networkId, prompt: indexContext.prompt },
    discovery_query: discoveryQuery,
    recent_turns: recentSlice.map((turn, i) => ({
      turn_index: recentBaseIndex + i + 1,
      action: turn.action,
      message: turn.message ?? null,
      reasoning: turn.assessment.reasoning,
    })),
    history_digest: {
      total_turns: history.length,
      actions_so_far: history.map((t) => t.action),
      own_intents: ownUser.intents.map((intent) => ({
        id: intent.id,
        title: intent.title,
        description: intent.description,
      })),
      other_intents: otherUser.intents.map((intent) => ({
        id: intent.id,
        title: intent.title,
        description: intent.description,
      })),
    },
  };
}
