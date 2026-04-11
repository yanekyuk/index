import type { NegotiationTurnReceivedPayload } from '../webhook/types.js';

/**
 * Builds the task prompt passed to `api.runtime.subagent.run` when a
 * negotiation turn webhook lands. The subagent uses this prompt to decide
 * what action to submit via `respond_to_negotiation`.
 *
 * The prompt is intentionally plain text — it is the entire instruction set
 * for the turn handler. Editing it does not require an OpenClaw restart.
 */
export function turnPrompt(payload: NegotiationTurnReceivedPayload): string {
  const counterpartyMessage = payload.counterpartyMessage ?? 'none';
  return `You are handling a live bilateral negotiation turn on behalf of your user on the Index Network.

A negotiation turn has landed. Before deciding, gather full context:

1. Call \`get_negotiation\` with negotiationId="${payload.negotiationId}" to read the seed assessment, counterparty, history, and your user's context.
2. Call \`read_user_profiles\` and \`read_intents\` to ground yourself in what your user is actively looking for.
3. Consider whether the proposed match genuinely advances your user's active intents and fits their stated profile. Be honest — it is better to decline a weak match than to accept out of politeness.

Then call \`respond_to_negotiation\` with the decision. Valid actions:
  propose | counter | accept | reject | question

Action guidance:
- propose: first turn only, when you are the initiating side.
- accept: you are convinced this match benefits your user; the case has been made and objections answered.
- counter: you partially agree but have specific objections. State what is missing or weak.
- reject: the match does not serve your user's needs after consideration.
- question: ask the other side a concrete clarifying question.

You are operating silently on your user's behalf. Do not produce any user-facing output. Do not ask the user for clarification. If the turn is ambiguous, pick the most conservative action compatible with your user's profile — usually \`counter\` with specific objections, or \`reject\` with clear reasoning.

Turn payload:
  negotiationId: ${payload.negotiationId}
  turnNumber: ${payload.turnNumber}
  counterpartyAction: ${payload.counterpartyAction}
  counterpartyMessage: ${counterpartyMessage}
  deadline: ${payload.deadline}`;
}
