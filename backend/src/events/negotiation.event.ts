/**
 * Hooks called on negotiation lifecycle events.
 * Currently unused — webhook delivery has been replaced by polling.
 */
export const NegotiationEvents = {
  onStarted: null as ((data: {
    negotiationId: string;
    userId: string;
    counterpartyId: string;
    counterpartyName?: string;
  }) => void) | null,

  onTurnReceived: null as ((data: {
    negotiationId: string;
    userId: string;
    turnNumber: number;
    counterpartyAction: string;
    counterpartyMessage?: string;
    deadline: string;
  }) => void) | null,

  onCompleted: null as ((data: {
    negotiationId: string;
    userId: string;
    outcome: string;
    turnCount: number;
  }) => void) | null,
};
