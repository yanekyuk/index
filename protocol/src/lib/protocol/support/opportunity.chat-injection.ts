/**
 * Opportunity chat injection — now a no-op.
 * Opportunities are rendered from DB data in the chat UI,
 * not injected as XMTP messages.
 */

import type { Opportunity } from '../interfaces/database.interface';

export async function injectOpportunityIntoExistingChat(
  _opportunity: Opportunity,
): Promise<void> {
  // No-op: opportunities are shown via GET /xmtp/chat-context
}
