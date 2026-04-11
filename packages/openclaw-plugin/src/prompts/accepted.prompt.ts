import type { NegotiationCompletedPayload } from '../webhook/types.js';

/**
 * Builds the task prompt for the "we connected you with X" message that the
 * plugin posts to the user's channel when a negotiation is accepted. The
 * subagent receives this prompt and produces one short chat message.
 */
export function acceptedPrompt(payload: NegotiationCompletedPayload): string {
  const reasoning = payload.outcome.reasoning ?? 'no reasoning provided';
  return `A negotiation on the Index Network has ended with an accepted opportunity. Your job is to tell the user in one short, natural message.

Before writing:
1. Call \`get_negotiation\` to read the outcome's reasoning and the agreed roles.
2. Call \`read_user_profiles\` on the counterparty to get their name and a one-line context.

Then write one message to the user. Format:
  "You're now connected with <first name> — <one-line why>. <one-line counterparty context>."

Keep it under 30 words. No lists. No emojis. Do not expose negotiationId, UUIDs, role names, or internal vocabulary. Do not offer next steps unless the user's profile implies they want them.

Event payload:
  negotiationId: ${payload.negotiationId}
  outcome.hasOpportunity: true
  outcome.reasoning: ${reasoning}
  turnCount: ${payload.turnCount}`;
}
